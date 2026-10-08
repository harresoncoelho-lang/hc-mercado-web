const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");

test("adaptador preserva preflight 204 sem corpo e cabeçalhos CORS", async () => {
  const modulo = await import(pathToFileURL(require.resolve("../ia-edital.mjs")).href);
  const resposta = await modulo.default(new globalThis.Request("https://licitaplena.com.br/.netlify/functions/ia-edital", {
    method: "OPTIONS", headers: { origin: "https://licitaplena.com.br" },
  }), { requestId: "qa-preflight" });
  assert.equal(resposta.status, 204);
  assert.equal(await resposta.text(), "");
  assert.equal(resposta.headers.get("access-control-allow-origin"), "https://licitaplena.com.br");
  assert.match(resposta.headers.get("access-control-allow-methods"), /POST/);
});

test("sem dossiê pronto, o endpoint enfileira o pedido e devolve a ficha oficial sem chamar IA nem baixar documento", async () => {
  const originalFetch = global.fetch;
  const variaveis = ["GROQ_API_KEY", "DOSSIES_EDITAIS_CHAVE", "NETLIFY_BLOBS_CONTEXT", "SUPABASE_SERVICE_ROLE_KEY"];
  const anteriores = Object.fromEntries(variaveis.map((chave) => [chave, process.env[chave]]));
  process.env.GROQ_API_KEY = "chave-teste";
  process.env.DOSSIES_EDITAIS_CHAVE = "robo-teste";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "servico-teste";
  delete process.env.NETLIFY_BLOBS_CONTEXT;
  const pedidosFila = [], proibidas = [];
  const responder = (corpo, status = 200) => new globalThis.Response(typeof corpo === "string" ? corpo : JSON.stringify(corpo), { status });
  global.fetch = async (url, opcoes = {}) => {
    if (url.includes("/auth/v1/user")) return responder({ id: "usuario-teste" });
    if (url.includes("/rest/v1/fila_dossies")) { pedidosFila.push(JSON.parse(opcoes.body)); return responder("", 201); }
    if (url.includes("/rest/v1/dossies_editais")) return responder([]);
    if (url.includes("/api/consulta/")) return responder({ objetoCompra: "Objeto oficial" });
    // Download de arquivo, Groq, Gateway ou cota: nada disso pode acontecer no clique.
    proibidas.push(url);
    return responder("", 500);
  };
  try {
    const modulo = await import(pathToFileURL(require.resolve("../ia-edital.mjs")).href);
    const pedir = (headers) => modulo.default(new globalThis.Request("https://licitaplena.com.br/.netlify/functions/ia-edital", {
      method: "POST", headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ modo: "resumo", edital: { numeroControlePNCP: "01171012000141-1-000005/2026", objeto: "OBJETO ADULTERADO", orgao: "ORGAO ADULTERADO" } }),
    }), { requestId: "qa-runtime" });
    const resposta = await pedir({ authorization: "Bearer usuario-teste" });
    assert.equal(resposta.status, 200);
    const corpo = await resposta.json();
    assert.equal(corpo.dossieEmPreparacao, true);
    assert.equal(corpo.modoDegradado, true);
    assert.equal(corpo.estrutura.identificacao.objeto, "Objeto oficial");
    assert.doesNotMatch(JSON.stringify(corpo), /ADULTERADO/);
    assert.match(corpo.estrutura.pendenciasParaConferencia[0], /em preparação/);
    assert.deepEqual(pedidosFila, [[{ numero_controle_pncp: "01171012000141-1-000005/2026", concluido_em: null }]]);
    // O robô antigo não pode encher a fila com a base inteira.
    const robo = await pedir({ "x-licitaplena-dossies-chave": "robo-teste" });
    assert.equal((await robo.json()).dossieEmPreparacao, true);
    assert.equal(pedidosFila.length, 1);
    assert.deepEqual(proibidas, []);
  } finally {
    global.fetch = originalFetch;
    for (const chave of variaveis) { if (anteriores[chave] === undefined) delete process.env[chave]; else process.env[chave] = anteriores[chave]; }
  }
});

test("dossiê do Gemini com prazo em conferência é entregue ao cliente sem marca de prazos revisados", async () => {
  const originalFetch = global.fetch;
  const variaveis = ["NETLIFY_BLOBS_CONTEXT", "SUPABASE_SERVICE_ROLE_KEY"];
  const anteriores = Object.fromEntries(variaveis.map((chave) => [chave, process.env[chave]]));
  process.env.SUPABASE_SERVICE_ROLE_KEY = "servico-teste";
  delete process.env.NETLIFY_BLOBS_CONTEXT;
  const { montarResultado } = require("../../../scripts/gerar_dossies_gemini");
  const dossie = montarResultado({ estrutura: { resumoGeral: "Pregão de papel A4." } }, "Sessão pública em 20/10/2026 às 9h.",
    { documentosLidos: ["Edital.pdf"], documentosNaoLidos: [], parcial: false }, Date.parse("2026-10-08T12:00:00Z"));
  const pedidosFila = [];
  const responder = (corpo, status = 200) => new globalThis.Response(typeof corpo === "string" ? corpo : JSON.stringify(corpo), { status });
  global.fetch = async (url, opcoes = {}) => {
    if (url.includes("/auth/v1/user")) return responder({ id: "usuario-teste" });
    if (url.includes("/rest/v1/fila_dossies")) { pedidosFila.push(opcoes.body); return responder("", 201); }
    if (url.includes("/rest/v1/dossies_editais")) return responder([{ dossie, versao: dossie.versao }]);
    return responder({});
  };
  try {
    const modulo = await import(pathToFileURL(require.resolve("../ia-edital.mjs")).href);
    const resposta = await modulo.default(new globalThis.Request("https://licitaplena.com.br/.netlify/functions/ia-edital", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer usuario-teste" },
      body: JSON.stringify({ modo: "resumo", edital: { numeroControlePNCP: "01171012000141-1-000006/2026" } }),
    }), { requestId: "qa-prazos" });
    const corpo = await resposta.json();
    assert.equal(corpo.doCache, true);
    assert.equal(corpo.revisaoPrazos, false);
    assert.equal(corpo.prazosEmConferencia, true);
    assert.match(corpo.estrutura.pendenciasParaConferencia.at(-1), /20\/10\/2026/);
    assert.deepEqual(pedidosFila, []);
  } finally {
    global.fetch = originalFetch;
    for (const chave of variaveis) { if (anteriores[chave] === undefined) delete process.env[chave]; else process.env[chave] = anteriores[chave]; }
  }
});
