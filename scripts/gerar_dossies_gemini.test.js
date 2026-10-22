const test = require("node:test");
const assert = require("node:assert/strict");

process.env.MAX_TENTATIVAS_DOSSIE = "2";
const { cabeNovoDossie, ajustarAoSchema, schemaParaGemini, corpoGemini, chamarGemini, montarResultado, selecionarCandidatos, dossieCompleto, gerarComEspera, montarProvedores, chamarCadeia, corpoCompat, GeminiSobrecarregado, CotaEsgotada, VERSAO_DOSSIE } = require("./gerar_dossies_gemini");
const contrato = require("../netlify/functions/_resumo_gateway_contrato");
const { estruturaValida } = require("../netlify/functions/_resumo_gateway");

function respostaGemini(status, corpo) {
  return { status, ok: status >= 200 && status < 300, json: async () => corpo, text: async () => JSON.stringify(corpo) };
}

function saidaModelo(texto = "{}") {
  return respostaGemini(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: texto }] } }], usageMetadata: { totalTokenCount: 10 } });
}

test("resposta vazia do modelo gratuito não impede o próximo modelo já configurado", async () => {
  const provedores = montarProvedores({ OPENROUTER_API_KEY: "teste", OPENROUTER_MODELOS: "a:free,b:free" });
  let chamadas = 0;
  const fetchFn = async () => respostaGemini(200, ++chamadas === 1
    ? { choices: [{ finish_reason: "stop", message: { content: "" } }] }
    : { choices: [{ finish_reason: "stop", message: { content: '{"estrutura":{}}' } }] });
  const resultado = await chamarCadeia({}, "fonte", { provedores, fetchFn });
  assert.equal(resultado.modelo, "b:free");
  assert.equal(chamadas, 2);
});

test("ajuste ao schema descarta chaves extras, preenche ausentes e passa na validação do contrato", () => {
  const ajustado = ajustarAoSchema({ estrutura: { resumoGeral: "Pregão de papel.", campoInventado: "x", documentosHabilitacao: [{ categoria: "Inexistente" }] } }, contrato.schema);
  assert.equal(ajustado.estrutura.resumoGeral, "Pregão de papel.");
  assert.equal(ajustado.estrutura.campoInventado, undefined);
  assert.equal(ajustado.estrutura.identificacao.objeto, "Não informado");
  assert.deepEqual(ajustado.estrutura.declaracoesExigidas, []);
  assert.ok(contrato.schema.properties.estrutura.properties.documentosHabilitacao.items.properties.categoria.enum.includes(ajustado.estrutura.documentosHabilitacao[0].categoria));
  assert.ok(estruturaValida(ajustado));
});

test("schema enviado ao Gemini não leva marcações exclusivas da OpenAI", () => {
  assert.ok(!JSON.stringify(schemaParaGemini(contrato.schema)).includes("additionalProperties"));
  assert.ok(corpoGemini({}, "fonte").generationConfig.responseJsonSchema);
  assert.equal(corpoGemini({}, "fonte", false).generationConfig.responseJsonSchema, undefined);
});

test("cota esgotada interrompe sem consumir tentativa", async () => {
  await assert.rejects(chamarGemini({}, "fonte", { apiKey: "k", fetchFn: async () => respostaGemini(429, {}) }), CotaEsgotada);
});

test("cota esgotada em um modelo passa ao próximo, que tem cota própria", async () => {
  let chamadas = 0;
  const primeiroSemCota = async () => (++chamadas === 1 ? respostaGemini(429, {}) : saidaModelo('{"estrutura":{}}'));
  assert.equal((await chamarGemini({}, "fonte", { apiKey: "k", fetchFn: primeiroSemCota, modelos: ["a", "b"] })).modelo, "b");
});

test("modelo indisponível passa ao próximo e schema recusado repete só com JSON", async () => {
  const chamadas = [];
  const fetchFn = async (url, opcoes) => {
    chamadas.push({ url, comSchema: Boolean(JSON.parse(opcoes.body).generationConfig.responseJsonSchema) });
    if (chamadas.length === 1) return respostaGemini(404, {});
    if (chamadas.length === 2) return respostaGemini(400, { error: { message: "Invalid JSON schema" } });
    return saidaModelo('{"estrutura":{}}');
  };
  const resultado = await chamarGemini({}, "fonte", { apiKey: "k", fetchFn, modelos: ["a", "b"] });
  assert.equal(resultado.modelo, "b");
  assert.deepEqual(chamadas.map((c) => [c.url.includes("/b:"), c.comSchema]), [[false, true], [true, true], [true, false]]);
});

test("resposta cortada por limite de saída é falha, não dossiê", async () => {
  const fetchFn = async () => respostaGemini(200, { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{" }] } }] });
  await assert.rejects(chamarGemini({}, "fonte", { apiKey: "k", fetchFn, modelos: ["a"] }), /resposta_incompleta_MAX_TOKENS/);
});

test("data da fonte ausente no resumo vira pendência em vez de derrubar o dossiê", () => {
  const agora = Date.parse("2026-10-08T12:00:00Z");
  const resultado = montarResultado({ estrutura: { resumoGeral: "Resumo." } }, "Sessão em 20/10/2026 às 9h.", { documentosLidos: ["Edital.pdf"] }, agora);
  assert.equal(resultado.versao, VERSAO_DOSSIE);
  assert.equal(resultado.revisaoPrazos, false);
  assert.equal(resultado.prazosEmConferencia, true);
  assert.equal(resultado.metodoResumo, "sintese_gemini");
  assert.deepEqual(resultado.estrutura.documentosConsultados, ["Edital.pdf"]);
  assert.match(resultado.estrutura.pendenciasParaConferencia.at(-1), /20\/10\/2026/);
});

test("seleção põe cliques antes do boletim e pula pronto, repetido e esgotado", () => {
  const candidatos = selecionarCandidatos({
    fila: [{ numero_controle_pncp: "clique2", pedido_em: "2026-10-08T10:00:00Z" }, { numero_controle_pncp: "clique1", pedido_em: "2026-10-08T09:00:00Z" }],
    boletim: [
      { numero_controle_pncp: "velho", publicacao: "2026-10-01" },
      { numero_controle_pncp: "clique1", publicacao: "2026-10-07" },
      { numero_controle_pncp: "pronto", publicacao: "2026-10-08" },
      { numero_controle_pncp: "esgotado", publicacao: "2026-10-08" },
      { numero_controle_pncp: "novo", publicacao: "2026-10-07" },
    ],
    dossiesProntos: new Set(["pronto"]),
    tentativas: new Map([["esgotado", 2], ["novo", 1]]),
    limite: 10,
  });
  assert.deepEqual(candidatos.map((c) => `${c.origem}:${c.numero}`), ["clique:clique1", "clique:clique2", "boletim:novo", "boletim:velho"]);
});

test("seleção respeita o teto restante do dia", () => {
  const boletim = ["a", "b", "c"].map((numero) => ({ numero_controle_pncp: numero, publicacao: "2026-10-08" }));
  const base = { fila: [], boletim, dossiesProntos: new Set(), tentativas: new Map() };
  assert.equal(selecionarCandidatos({ ...base, limite: 2 }).length, 2);
  assert.equal(selecionarCandidatos({ ...base, limite: -5 }).length, 0);
});

test("edital novo dos filtros não fica atrás de novas tentativas antigas", () => {
  const candidatos = selecionarCandidatos({
    fila: [
      { numero_controle_pncp: "antigo", origem: "boletim", pedido_em: "2026-10-20" },
      { numero_controle_pncp: "pedido-novo", origem: "clique", pedido_em: "2026-10-22" },
    ],
    boletim: [],
    antecipados: [{ numero_controle_pncp: "edital-hoje", publicacao: "2026-10-22" }],
    dossiesProntos: new Set(), tentativas: new Map([["antigo", 1]]), limite: 2,
  });
  assert.deepEqual(candidatos.map((c) => c.numero), ["pedido-novo", "edital-hoje"]);
});

test("preparação inclui edital do filtro sem clique nem envio e preserva prioridades e teto", () => {
  const candidatos = selecionarCandidatos({
    fila: [{ numero_controle_pncp: "pedido", origem: "clique", pedido_em: "2026-10-21" }],
    boletim: [{ numero_controle_pncp: "ja-enviado", publicacao: "2026-10-20" }],
    antecipados: [
      { numero_controle_pncp: "ainda-nao-enviado", publicacao: "2026-10-21" },
      { numero_controle_pncp: "pedido", publicacao: "2026-10-21" },
      { numero_controle_pncp: "pronto", publicacao: "2026-10-21" },
      { numero_controle_pncp: "esgotado", publicacao: "2026-10-21" },
    ],
    dossiesProntos: new Set(["pronto"]), tentativas: new Map([["esgotado", 2]]), limite: 2,
  });
  assert.deepEqual(candidatos, [{ numero: "pedido", origem: "clique" }, { numero: "ainda-nao-enviado", origem: "boletim" }]);
});

test("prazos só contam como revisados quando todas as datas da fonte estão no resumo", () => {
  const resultado = montarResultado({ estrutura: { resumoGeral: "Sessão em 20/10/2026.", identificacao: { dataSessao: "20/10/2026" } } }, "Sessão em 20/10/2026 às 9h.", { documentosLidos: [] }, Date.parse("2026-10-08T12:00:00Z"));
  assert.equal(resultado.revisaoPrazos, true);
  assert.equal(resultado.prazosEmConferencia, false);
});

test("dossiê só sai da fila quando é da versão atual e leu todos os documentos", () => {
  assert.equal(dossieCompleto({ versao: VERSAO_DOSSIE, status: "pronto" }), true);
  assert.equal(dossieCompleto({ versao: VERSAO_DOSSIE, status: "parcial" }), false);
  assert.equal(dossieCompleto({ versao: VERSAO_DOSSIE - 1, status: "pronto" }), false);
  assert.equal(dossieCompleto(undefined), false);
});

test("modelo sobrecarregado passa ao próximo e, se todos estiverem, para sem gastar tentativa", async () => {
  const urls = [];
  const sobrecarregado = async (url) => { urls.push(url); return respostaGemini(503, {}); };
  await assert.rejects(chamarGemini({}, "fonte", { apiKey: "k", fetchFn: sobrecarregado, modelos: ["a", "b"] }), CotaEsgotada);
  assert.equal(urls.length, 2);
  let chamadas = 0;
  const segundoResponde = async () => (++chamadas === 1 ? respostaGemini(503, {}) : saidaModelo('{"estrutura":{}}'));
  assert.equal((await chamarGemini({}, "fonte", { apiKey: "k", fetchFn: segundoResponde, modelos: ["a", "b"] })).modelo, "b");
});

test("sobrecarga espera e repete o mesmo edital; cota esgotada encerra sem esperar", async () => {
  const prazoFinal = Date.now() + 3600000;
  const esperas = [];
  const esperar = async (ms) => { esperas.push(ms); };
  let chamadas = 0;
  const gerarDepoisDeDuas = async () => {
    chamadas += 1;
    if (chamadas <= 2) throw new GeminiSobrecarregado("sobrecarga");
    return { modelo: "a" };
  };
  assert.deepEqual(await gerarComEspera("n", { prazoFinal, gerar: gerarDepoisDeDuas, esperar }), { modelo: "a" });
  assert.equal(esperas.length, 2);

  esperas.length = 0;
  await assert.rejects(gerarComEspera("n", { prazoFinal, gerar: async () => { throw new CotaEsgotada("429"); }, esperar }), CotaEsgotada);
  assert.equal(esperas.length, 0);

  await assert.rejects(gerarComEspera("n", { prazoFinal, gerar: async () => { throw new GeminiSobrecarregado("sempre"); }, esperar }), GeminiSobrecarregado);
  assert.equal(esperas.length, 3);
});

test("sobrecarga não espera além do tempo da rodada", async () => {
  const esperas = [];
  await assert.rejects(gerarComEspera("n", { prazoFinal: Date.now() + 1000, gerar: async () => { throw new GeminiSobrecarregado("x"); }, esperar: async (ms) => esperas.push(ms) }), GeminiSobrecarregado);
  assert.equal(esperas.length, 0);
});

// --- Cadeia de provedores ---

function respostaCompat(texto = '{"estrutura":{}}', finish = "stop") {
  return respostaGemini(200, { choices: [{ finish_reason: finish, message: { content: texto } }], usage: { total_tokens: 7 } });
}

// Roteia por host e registra o que foi chamado; `regras` mapeia "gemini"|"mistral"|"openrouter" para uma função(modelo, corpo).
function fetchPorProvedor(regras, chamadas = []) {
  return async (url, opcoes) => {
    const provedor = url.includes("googleapis") ? "gemini" : url.includes("mistral") ? "mistral" : url.includes("cloudflare") ? "cloudflare" : "openrouter";
    const modelo = provedor === "gemini" ? url.split("/models/")[1].split(":")[0] : JSON.parse(opcoes.body).model;
    chamadas.push(`${provedor}/${modelo}`);
    return regras[provedor](modelo, JSON.parse(opcoes.body));
  };
}

const ENV_TODOS = { GEMINI_API_KEY: "g", MISTRAL_API_KEY: "m", OPENROUTER_API_KEY: "o", OPENROUTER_MODELOS: "or-a:free,or-b:free" };

test("Gemini sem cota em todos os modelos: Mistral responde e fica registrado no dossiê", async () => {
  const chamadas = [];
  const fetchFn = fetchPorProvedor({ gemini: () => respostaGemini(429, {}), mistral: () => respostaCompat() }, chamadas);
  const r = await chamarCadeia({}, "fonte", { provedores: montarProvedores(ENV_TODOS), fetchFn });
  assert.equal(r.provedor, "mistral");
  assert.equal(r.modelo, "mistral-medium-latest");
  assert.equal(r.uso.totalTokenCount, 7);
  const dossie = montarResultado(r.saida, "fonte", {}, Date.now(), r);
  assert.equal(dossie.provedorIA, "mistral");
  assert.equal(dossie.modeloIA, "mistral-medium-latest");
  assert.equal(dossie.metodoResumo, "sintese_gemini");
});

test("Gemini e Mistral esgotados: OpenRouter responde", async () => {
  const fetchFn = fetchPorProvedor({ gemini: () => respostaGemini(429, {}), mistral: () => respostaGemini(429, {}), openrouter: (m) => (m === "or-a:free" ? respostaGemini(404, {}) : respostaCompat()) });
  const r = await chamarCadeia({}, "fonte", { provedores: montarProvedores(ENV_TODOS), fetchFn });
  assert.deepEqual([r.provedor, r.modelo], ["openrouter", "or-b:free"]);
});

test("todos com 429: cota esgotada, que não gasta a tentativa do edital", async () => {
  const fetchFn = fetchPorProvedor({ gemini: () => respostaGemini(429, {}), mistral: () => respostaGemini(429, {}), openrouter: () => respostaGemini(429, {}) });
  const erro = await chamarCadeia({}, "fonte", { provedores: montarProvedores(ENV_TODOS), fetchFn }).catch((e) => e);
  assert.ok(erro instanceof CotaEsgotada);
  assert.ok(!(erro instanceof GeminiSobrecarregado));
});

test("todos com 5xx ou timeout: sobrecarga, que ativa a espera", async () => {
  const fetchFn = fetchPorProvedor({ gemini: () => respostaGemini(503, {}), mistral: () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); }, openrouter: () => respostaGemini(502, {}) });
  await assert.rejects(chamarCadeia({}, "fonte", { provedores: montarProvedores(ENV_TODOS), fetchFn }), GeminiSobrecarregado);
});

test("cota esgotada num provedor e sobrecarga em outro contam como sobrecarga (vale esperar)", async () => {
  const fetchFn = fetchPorProvedor({ gemini: () => respostaGemini(429, {}), mistral: () => respostaGemini(503, {}) });
  await assert.rejects(chamarCadeia({}, "fonte", { provedores: montarProvedores({ GEMINI_API_KEY: "g", MISTRAL_API_KEY: "m" }), fetchFn }), GeminiSobrecarregado);
});

test("provedor sem chave é ignorado, e OpenRouter sem lista de modelos também", async () => {
  assert.deepEqual(montarProvedores({ MISTRAL_API_KEY: "m" }).map((p) => p.nome), ["mistral"]);
  assert.deepEqual(montarProvedores({ GEMINI_API_KEY: "g", OPENROUTER_API_KEY: "o" }).map((p) => p.nome), ["gemini"]);
  assert.deepEqual(montarProvedores({ OPENROUTER_API_KEY: "o", OPENROUTER_MODELOS: "x:free" }).map((p) => p.nome), ["openrouter"]);
  assert.deepEqual(montarProvedores({}), []);
  const chamadas = [];
  const fetchFn = fetchPorProvedor({ mistral: () => respostaCompat() }, chamadas);
  await chamarCadeia({}, "fonte", { provedores: montarProvedores({ MISTRAL_API_KEY: "m", MISTRAL_MODELOS: "" }), fetchFn });
  assert.deepEqual(chamadas, ["mistral/mistral-medium-latest"]);
});

test("modelo esgotado não é chamado de novo no edital seguinte da mesma rodada", async () => {
  const chamadas = [];
  const fetchFn = fetchPorProvedor({ gemini: () => respostaGemini(429, {}), mistral: (m) => (m === "mistral-medium-latest" ? respostaGemini(429, {}) : respostaCompat()) }, chamadas);
  const opcoes = { provedores: montarProvedores({ GEMINI_API_KEY: "g", MISTRAL_API_KEY: "m" }), fetchFn, esgotados: new Set() };
  await chamarCadeia({}, "fonte", opcoes);
  chamadas.length = 0;
  const r = await chamarCadeia({}, "fonte", opcoes);
  assert.equal(r.modelo, "mistral-small-latest");
  assert.deepEqual(chamadas, ["mistral/mistral-small-latest"]);
});

test("response_format recusado: repete uma vez sem ele e não volta a pedir na rodada", async () => {
  const corpos = [];
  const fetchFn = fetchPorProvedor({ mistral: (m, corpo) => { corpos.push(Boolean(corpo.response_format)); return corpo.response_format ? respostaGemini(400, { error: { message: "unsupported" } }) : respostaCompat(); } });
  const opcoes = { provedores: montarProvedores({ MISTRAL_API_KEY: "m" }), fetchFn, esgotados: new Set() };
  assert.equal((await chamarCadeia({}, "fonte", opcoes)).provedor, "mistral");
  assert.deepEqual(corpos, [true, false]);
  await chamarCadeia({}, "fonte", opcoes);
  assert.deepEqual(corpos, [true, false, false]);
});

test("outro 4xx é falha do edital e a cadeia não segue adiante", async () => {
  const chamadas = [];
  const fetchFn = fetchPorProvedor({ gemini: () => respostaGemini(400, { error: { message: "texto muito grande" } }), mistral: () => respostaCompat() }, chamadas);
  await assert.rejects(chamarCadeia({}, "fonte", { provedores: montarProvedores({ GEMINI_API_KEY: "g", MISTRAL_API_KEY: "m" }), fetchFn }), /gemini_http_400/);
  assert.ok(!chamadas.some((c) => c.startsWith("mistral")));
});

test("saída em bloco ```json é aceita e o edital grande é cortado para caber no contexto", async () => {
  const r = await chamarCadeia({}, "x", { provedores: montarProvedores({ MISTRAL_API_KEY: "m" }), fetchFn: fetchPorProvedor({ mistral: () => respostaCompat('```json\n{"estrutura":{"resumoGeral":"ok"}}\n```') }) });
  assert.equal(r.saida.estrutura.resumoGeral, "ok");
  const corpo = corpoCompat({}, "a".repeat(500000), "m");
  assert.ok(corpo.messages[1].content.length < 210000);
  assert.ok(corpo.messages[0].content.includes("JSON Schema"));
});

test("Cloudflare Workers AI só entra na cadeia com ID da conta e token, como último provedor", async () => {
  const nomes = (env) => montarProvedores(env).map((p) => p.nome);
  assert.deepEqual(nomes({ GEMINI_API_KEY: "g", CLOUDFLARE_AI_TOKEN: "t" }), ["gemini"]);
  assert.deepEqual(nomes({ GEMINI_API_KEY: "g", CLOUDFLARE_ACCOUNT_ID: "conta" }), ["gemini"]);
  const completo = { ...ENV_TODOS, CLOUDFLARE_ACCOUNT_ID: "conta", CLOUDFLARE_AI_TOKEN: "t" };
  assert.deepEqual(nomes(completo), ["gemini", "mistral", "openrouter", "cloudflare"]);
  const chamadas = [];
  const fetchFn = fetchPorProvedor({ gemini: () => respostaGemini(429, {}), mistral: () => respostaGemini(429, {}), openrouter: () => respostaGemini(429, {}), cloudflare: () => respostaCompat() }, chamadas);
  const r = await chamarCadeia({}, "fonte", { provedores: montarProvedores(completo), fetchFn });
  assert.deepEqual([r.provedor, r.modelo], ["cloudflare", "@cf/openai/gpt-oss-120b"]);
});


test("rodada de oito minutos não inicia outro edital com só 39 segundos", () => {
  const minuto = 60000;
  assert.equal(cabeNovoDossie({ inicio: 0, agora: 441000, limite: 8 * minuto, maiorDuracao: 441000 }), false);
  assert.equal(cabeNovoDossie({ inicio: 0, agora: 2 * minuto, limite: 8 * minuto, maiorDuracao: 2 * minuto }), true);
  assert.equal(cabeNovoDossie({ inicio: 0, agora: 4 * minuto, limite: 8 * minuto, maiorDuracao: 2 * minuto }), false);
});

test("reserva inclui margem e adapta-se a um edital lento sem impedir o primeiro", () => {
  const minuto = 60000;
  assert.equal(cabeNovoDossie({ inicio: 0, agora: 0, limite: 8 * minuto }), true);
  assert.equal(cabeNovoDossie({ inicio: 0, agora: 6 * minuto, limite: 12 * minuto, maiorDuracao: 6 * minuto }), false);
  assert.equal(cabeNovoDossie({ inicio: 0, agora: 8 * minuto, limite: 8 * minuto }), false);
});
