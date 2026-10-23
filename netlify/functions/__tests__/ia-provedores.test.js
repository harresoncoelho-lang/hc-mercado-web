const test = require("node:test");
const assert = require("node:assert/strict");
const { responderComFallback, haProvedorConfigurado, montarProvedoresCompat } = require("../_ia_provedores");

const MENSAGENS = [{ role: "user", content: "oi" }];
const OPCOES = { maxTokens: 100 };
const resp = (status, corpo = {}) => ({ ok: status < 300, status, json: async () => corpo, text: async () => "" });
const ok = (texto) => resp(200, { choices: [{ message: { content: texto }, finish_reason: "stop" }] });

function fetchPorHost(regras, chamadas = []) {
  return async (url, opcoes) => {
    const host = new URL(url).host;
    const modelo = JSON.parse(opcoes.body).model;
    chamadas.push(`${host.split(".")[0]}/${modelo}`);
    const r = regras[host];
    if (r instanceof Error) throw r;
    return typeof r === "function" ? r(modelo) : r;
  };
}
const HOST_GEMINI = "generativelanguage.googleapis.com";
const HOST_OR = "openrouter.ai";
const HOST_CF = "api.cloudflare.com";
const groqFalha = async () => ({ ok: false, erro: "limite da Groq" });

test('Groq com espaços e compatível truncado não contam como sucesso', async () => {
  const r = await responderComFallback(MENSAGENS, OPCOES, { env: { GROQ_API_KEY: 'g', GEMINI_API_KEY: 'k' },
    groq: async () => ({ ok: true, texto: '   ' }),
    fetchFn: async () => resp(200, { choices: [{ message: { content: 'Resposta truncada' }, finish_reason: 'length' }] }) });
  assert.equal(r.ok, false);
  assert.ok(r.erro?.trim());
});

test("Groq 429 cai para o Gemini, que responde", async () => {
  const chamadas = [];
  const r = await responderComFallback(MENSAGENS, OPCOES, {
    env: { GROQ_API_KEY: "g", GEMINI_API_KEY: "k" }, groq: groqFalha,
    fetchFn: fetchPorHost({ [HOST_GEMINI]: ok("resposta gemini") }, chamadas),
  });
  assert.deepEqual([r.ok, r.texto, r.provedor, r.modelo], [true, "resposta gemini", "gemini", "gemini-3.8-flash"]);
  assert.deepEqual(chamadas, ["generativelanguage/gemini-3.8-flash"]);
});

test("pula provedores sem chave e segue modelo a modelo até o sucesso", async () => {
  const chamadas = [];
  const r = await responderComFallback(MENSAGENS, OPCOES, {
    env: { GEMINI_API_KEY: "k", OPENROUTER_API_KEY: "o", OPENROUTER_MODELOS: "m1,m2", CLOUDFLARE_AI_TOKEN: "sem-conta" },
    groq: async () => assert.fail("Groq sem chave não deve ser chamada"),
    fetchFn: fetchPorHost({ [HOST_GEMINI]: resp(503), [HOST_OR]: (m) => (m === "m1" ? resp(429) : ok("do openrouter")) }, chamadas),
  });
  assert.equal(r.provedor, "openrouter");
  assert.deepEqual(chamadas, ["generativelanguage/gemini-3.8-flash", "openrouter/m1", "openrouter/m2"]);
});

test("timeout, resposta vazia e 401 passam ao Cloudflare, o último da cadeia", async () => {
  const chamadas = [];
  const r = await responderComFallback(MENSAGENS, OPCOES, {
    env: { GEMINI_API_KEY: "k", GEMINI_MODELOS_PERGUNTA: "g1", OPENROUTER_API_KEY: "o", OPENROUTER_MODELOS: "m1", CLOUDFLARE_ACCOUNT_ID: "c", CLOUDFLARE_AI_TOKEN: "t" },
    fetchFn: fetchPorHost({ [HOST_GEMINI]: Object.assign(new Error("x"), { name: "AbortError" }), [HOST_OR]: ok("   "), [HOST_CF]: ok("do cloudflare") }, chamadas),
  });
  assert.deepEqual([r.provedor, r.modelo], ["cloudflare", "@cf/openai/gpt-oss-120b"]);
  assert.deepEqual(chamadas, ["generativelanguage/g1", "openrouter/m1", "api/@cf/openai/gpt-oss-120b"]);
});

test("todos falham: devolve o erro da Groq; sem Groq, mensagem genérica", async () => {
  const falha = { [HOST_GEMINI]: resp(429) };
  const comGroq = await responderComFallback(MENSAGENS, OPCOES, { env: { GROQ_API_KEY: "g", GEMINI_API_KEY: "k" }, groq: groqFalha, fetchFn: fetchPorHost(falha) });
  assert.deepEqual([comGroq.ok, comGroq.erro], [false, "limite da Groq"]);
  const semGroq = await responderComFallback(MENSAGENS, OPCOES, { env: { GEMINI_API_KEY: "k" }, fetchFn: fetchPorHost(falha) });
  assert.equal(semGroq.ok, false);
  assert.match(semGroq.erro, /indisponíveis/);
});

test("não inicia novo provedor depois do orçamento total de tempo", async () => {
  let relogio = 0;
  const chamadas = [];
  const fetchFn = async (url, opcoes) => { chamadas.push(JSON.parse(opcoes.body).model); relogio += 46000; return resp(503); };
  const r = await responderComFallback(MENSAGENS, OPCOES, { env: { GEMINI_API_KEY: "k" }, fetchFn, agora: () => relogio });
  assert.equal(r.ok, false);
  assert.equal(chamadas.length, 1);
});

test("haProvedorConfigurado e Cloudflare exigem as variáveis certas", () => {
  assert.equal(haProvedorConfigurado({}), false);
  assert.equal(haProvedorConfigurado({ GROQ_API_KEY: "g" }), true);
  assert.equal(haProvedorConfigurado({ CLOUDFLARE_AI_TOKEN: "t" }), false);
  assert.deepEqual(montarProvedoresCompat({ CLOUDFLARE_ACCOUNT_ID: "c", CLOUDFLARE_AI_TOKEN: "t", CLOUDFLARE_AI_MODELO: "@cf/x" })[0].modelos, ["@cf/x"]);
});

test("Groq e Gemini lentos (timeout) ainda deixam tempo para OpenRouter e Cloudflare", async () => {
  let relogio = 0;
  const prazosGroq = [];
  const prazos = [];
  const chamadas = [];
  // Cada provedor lento consome o prazo inteiro que recebeu e então expira.
  const groq = async (_chave, _mensagens, opcoes) => { prazosGroq.push(opcoes.timeoutMs); relogio += opcoes.timeoutMs; return { ok: false, erro: "Erro ao consultar a IA: timeout" }; };
  const fetchFn = async (url, opcoes) => {
    const host = new URL(url).host;
    chamadas.push(host.split(".")[0]);
    if (host === HOST_CF) return ok("do cloudflare");
    const prazo = 12000;
    prazos.push(prazo);
    relogio += prazo;
    throw Object.assign(new Error("x"), { name: "AbortError" });
  };
  const r = await responderComFallback(MENSAGENS, { ...OPCOES, timeoutMs: 20000 }, {
    env: { GROQ_API_KEY: "g", GEMINI_API_KEY: "k", OPENROUTER_API_KEY: "o", OPENROUTER_MODELOS: "m1", CLOUDFLARE_ACCOUNT_ID: "c", CLOUDFLARE_AI_TOKEN: "t" },
    groq, fetchFn, agora: () => relogio,
  });
  assert.deepEqual(prazosGroq, [12000]);
  assert.deepEqual(chamadas, ["generativelanguage", "openrouter", "api"]);
  assert.deepEqual([r.ok, r.provedor], [true, "cloudflare"]);
});
