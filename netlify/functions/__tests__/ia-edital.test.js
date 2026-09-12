const test = require("node:test");
const assert = require("node:assert/strict");

function carregarComModelo(modelo) {
  const caminho = require.resolve("../lib/ia-edital");
  const anterior = process.env.GROQ_MODEL;
  if (modelo) process.env.GROQ_MODEL = modelo;
  else delete process.env.GROQ_MODEL;
  delete require.cache[caminho];
  const modulo = require("../lib/ia-edital");
  if (anterior === undefined) delete process.env.GROQ_MODEL;
  else process.env.GROQ_MODEL = anterior;
  return modulo;
}

test("ia-edital usa GPT-OSS 20B como modelo padrão suportado", async () => {
  const fetchOriginal = global.fetch;
  const modelos = [];
  global.fetch = async (_url, opcoes) => {
    modelos.push(JSON.parse(opcoes.body).model);
    return { ok: true, json: async () => ({ choices: [{ message: { content: "Resumo pronto" } }] }) };
  };
  try {
    const { __test } = carregarComModelo(null);
    const resposta = await __test.chamarGroq("chave-teste", [{ role: "user", content: "teste" }]);
    assert.equal(resposta.ok, true);
    assert.deepEqual(modelos, ["openai/gpt-oss-20b"]);
  } finally {
    global.fetch = fetchOriginal;
  }
});

test("ia-edital troca automaticamente um modelo aposentado pelo modelo suportado", async () => {
  const fetchOriginal = global.fetch;
  const modelos = [];
  global.fetch = async (_url, opcoes) => {
    const modelo = JSON.parse(opcoes.body).model;
    modelos.push(modelo);
    if (modelo === "modelo-aposentado") {
      return { ok: false, status: 404, text: async () => '{"error":{"code":"model_not_found"}}' };
    }
    return { ok: true, json: async () => ({ choices: [{ message: { content: "Resumo pronto" } }] }) };
  };
  try {
    const { __test } = carregarComModelo("modelo-aposentado");
    const resposta = await __test.chamarGroq("chave-teste", [{ role: "user", content: "teste" }]);
    assert.equal(resposta.ok, true);
    assert.deepEqual(modelos, ["modelo-aposentado", "openai/gpt-oss-20b"]);
  } finally {
    global.fetch = fetchOriginal;
  }
});

test("consulta o cache antes de consumir a cota de IA", () => {
  const fs = require("node:fs");
  const fonte = fs.readFileSync(require.resolve("../lib/ia-edital"), "utf8");
  assert.ok(fonte.indexOf('storeResumos.get(edital.numeroControlePNCP') < fonte.indexOf('verificarLimiteDiario(sessao.userId, "ia-edital", 40)'));
});

test("síntese longa valida interface sem ferramentas antes de encaminhar a fonte integral", async () => {
  const fetchOriginal = global.fetch;
  const chamadas = [];
  const fonte = "Fonte oficial extensa. ".repeat(2000);
  global.fetch = async (_url, opcoes) => {
    const corpo = JSON.parse(opcoes.body); chamadas.push(corpo);
    return { ok: true, json: async () => ({ choices: [{ message: { content: chamadas.length === 1 ? '{"ok":true}' : '{"resumoGeral":"Síntese"}' } }] }) };
  };
  try {
    const resultado = await carregarComModelo(null).__test.chamarSinteseEdital("chave-teste", [{ role: "user", content: fonte }]);
    assert.equal(resultado.ok, true);
    assert.equal(chamadas.length, 2);
    assert.ok(!chamadas[0].messages[0].content.includes(fonte));
    assert.equal(chamadas[1].messages[0].content, fonte);
    for (const chamada of chamadas) {
      assert.equal(chamada.model, "groq/compound-mini");
      assert.deepEqual(chamada.compound_custom, { tools: { enabled_tools: [] } });
      assert.equal(chamada.tool_choice, "none");
      assert.equal(chamada.reasoning_effort, undefined);
    }
  } finally { global.fetch = fetchOriginal; }
});

test("não envia fonte se o provedor rejeitar a desativação de ferramentas", async () => {
  const fetchOriginal = global.fetch;
  let chamadas = 0;
  global.fetch = async () => { chamadas++; return { ok: false, status: 400, text: async () => '{"error":{"message":"unsupported parameter"}}' }; };
  try {
    const resultado = await carregarComModelo(null).__test.chamarSinteseEdital("chave-teste", [{ role: "user", content: "Fonte. ".repeat(2000) }]);
    assert.equal(resultado.ok, false);
    assert.equal(chamadas, 1);
  } finally { global.fetch = fetchOriginal; }
});

test("rejeita resposta do sistema longo que informe ferramentas executadas", async () => {
  const fetchOriginal = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"ok":true}', executed_tools: [{ type: "web_search" }] } }] }) });
  try {
    const resultado = await carregarComModelo(null).__test.chamarSinteseEdital("chave-teste", [{ role: "user", content: "Fonte. ".repeat(2000) }]);
    assert.equal(resultado.ok, false);
    assert.match(resultado.erro, /ferramentas/);
  } finally { global.fetch = fetchOriginal; }
});

test("diagnóstico de 413 conserva somente código permitido e limites numéricos", async () => {
  const fetchOriginal = global.fetch;
  const warnOriginal = console.warn;
  const logs = [];
  console.warn = (...args) => logs.push(args.join(" "));
  global.fetch = async () => ({ ok: false, status: 413, headers: { get: () => null }, text: async () => JSON.stringify({
    error: { code: "rate_limit_exceeded", message: "Private organization SECRET_ORG. Limit 8000, Requested 59,598; Used 42. Key SECRET_KEY" },
  }) });
  try {
    const resultado = await carregarComModelo(null).__test.chamarGroq("SECRET_KEY", [{ role: "user", content: "DOCUMENTO_PRIVADO" }]);
    assert.equal(resultado.ok, false);
    const { mensagem, ...diagnostico } = resultado.diagnostico;
    assert.deepEqual(diagnostico, { status: 413, codigo: "rate_limit_exceeded", limites: { limit: 8000, requested: 59598, used: 42 }, medidas: [], contexto: false });
    assert.match(mensagem, /Limit 8000/);
    assert.ok(!JSON.stringify([resultado, logs]).match(/SECRET|DOCUMENTO_PRIVADO/));
  } finally { global.fetch = fetchOriginal; console.warn = warnOriginal; }
});

test("diagnóstico 413 redige segredos e conserva somente mensagem técnica limitada e campos numéricos", async () => {
  const originalFetch = global.fetch, originalWarn = console.warn;
  const logs = [];
  console.warn = (...valores) => logs.push(valores);
  global.fetch = async () => ({ ok: false, status: 413, headers: { get: () => null }, text: async () => JSON.stringify({ error: {
    code: "request_too_large", type: "tokens", input_tokens: 12000, output_tokens: 6000, max_tokens: 10000, requested: "segredo-campo",
    message: "Request too large for organization org_privada. Input tokens exceeded maximum 10000. https://privado.invalid/?token=abc usuario@privado.invalid gsk_segredo123 Bearer senha-secreta DocumentoPrivado " + "request ".repeat(300),
  } }) });
  try {
    const resultado = await carregarComModelo(null).__test.chamarGroq("chave-teste", [{ role: "user", content: "dados" }]);
    assert.ok(resultado.diagnostico.mensagem.length <= 800);
    assert.match(resultado.diagnostico.mensagem, /Input tokens exceeded maximum 10000/);
    assert.equal(resultado.diagnostico.limites.input_tokens, 12000);
    assert.equal(resultado.diagnostico.tipo, "tokens");
    assert.equal(resultado.diagnostico.limites.max_tokens, 10000);
    assert.equal(resultado.diagnostico.limites.requested, undefined);
    assert.doesNotMatch(JSON.stringify([resultado, logs]), /org_privada|privado\.invalid|gsk_segredo|senha-secreta|DocumentoPrivado|segredo-campo/);
  } finally { global.fetch = originalFetch; console.warn = originalWarn; }
});

test("não deixa um rótulo operacional engolir o texto seguinte do portal", () => {
  const { __test } = carregarComModelo(null);
  const texto = "Critério de Julgamento - Menor preço por item MODO DE DISPUTA - Aberto PREFERÊNCIA ME/EPP - Sim";
  assert.equal(__test.valorRotuladoDoTexto(texto, "Critério de Julgamento"), "Menor preço por item");
});

test("metadados de resposta sem JSON não incluem conteúdo nem identificadores", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: "CONTEUDO_RESERVADO", reasoning: "RACIOCINIO_RESERVADO" } }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, outro: "SEGREDO" } }) });
  try {
    const resultado = await carregarComModelo(null).__test.chamarGroq("chave-teste", [{ role: "user", content: "Fonte" }]);
    assert.equal(resultado.diagnostico.finalizacao, "stop");
    assert.equal(resultado.diagnostico.caracteres, 18);
    assert.equal(resultado.diagnostico.total_tokens, 120);
    assert.doesNotMatch(JSON.stringify(resultado.diagnostico), /CONTEUDO_RESERVADO|RACIOCINIO_RESERVADO|SEGREDO/);
  } finally { global.fetch = originalFetch; }
});

test("remove combinações artificiais de certidões antes de exibir o dossiê", () => {
  const { __test } = carregarComModelo(null);
  const lista = __test.normalizarListaDoDossie([
    "Certidão negativa de débitos federais",
    "Certidão Negativa de Débitos de Tributos Federais – Receita Federal – Receita Estadual – Receita Municipal – ICMS – PIS/PASEP – COFINS – INSS",
    "Certidão negativa de débitos federais",
    "Certidão negativa de débitos trabalhistas",
  ], 15);
  assert.deepEqual(lista, [
    "Certidão negativa de débitos federais",
    "Certidão negativa de débitos trabalhistas",
  ]);
});
