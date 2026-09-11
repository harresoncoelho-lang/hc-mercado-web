const test = require("node:test");
const assert = require("node:assert/strict");

function carregarComModelo(modelo) {
  const caminho = require.resolve("../ia-edital");
  const anterior = process.env.GROQ_MODEL;
  if (modelo) process.env.GROQ_MODEL = modelo;
  else delete process.env.GROQ_MODEL;
  delete require.cache[caminho];
  const modulo = require("../ia-edital");
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
  const fonte = fs.readFileSync(require.resolve("../ia-edital"), "utf8");
  assert.ok(fonte.indexOf('storeResumos.get(edital.numeroControlePNCP') < fonte.indexOf('verificarLimiteDiario(sessao.userId, "ia-edital", 40)'));
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
    assert.deepEqual(resultado.diagnostico, { status: 413, codigo: "rate_limit_exceeded", limites: { limit: 8000, requested: 59598, used: 42 } });
    assert.ok(!JSON.stringify([resultado, logs]).match(/SECRET|DOCUMENTO_PRIVADO/));
  } finally { global.fetch = fetchOriginal; console.warn = warnOriginal; }
});

test("não deixa um rótulo operacional engolir o texto seguinte do portal", () => {
  const { __test } = carregarComModelo(null);
  const texto = "Critério de Julgamento - Menor preço por item MODO DE DISPUTA - Aberto PREFERÊNCIA ME/EPP - Sim";
  assert.equal(__test.valorRotuladoDoTexto(texto, "Critério de Julgamento"), "Menor preço por item");
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
