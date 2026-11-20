const test = require("node:test");
const assert = require("node:assert/strict");
const { handler } = require("../monte-busca-ia");

const evento = (descricao, metodo = "POST") => ({ httpMethod: metodo, headers: { origin: "https://licitaplena.com.br" }, body: JSON.stringify({ descricao }) });
const ok = { autenticar: async () => ({ ok: true, userId: "u1" }), limitar: async () => ({ ok: true }), env: { GROQ_API_KEY: "g" } };

test("sugere palavras e manda à IA só a descrição limpa de dado pessoal", async () => {
  let enviado;
  const r = await handler(evento("vendo material de limpeza, contato joao@x.com 92 99999-1234"), { ...ok,
    responder: async (mensagens) => { enviado = JSON.stringify(mensagens); return { ok: true, texto: '{"palavras":["Limpeza"],"variacoes":["limpezas"],"exclusoes":["obra"]}' }; } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(JSON.parse(r.body), { palavras: ["limpeza"], variacoes: ["limpezas"], exclusoes: ["obra"] });
  assert.ok(!/joao@x|99999/.test(enviado));
  assert.ok(/<vendo>vendo material de limpeza/.test(enviado));
});
test("sem login, método errado, descrição curta e sem provedor não chamam a IA nem gastam cota", async () => {
  const falha = { responder: async () => assert.fail("IA chamada"), limitar: async () => assert.fail("cota gasta") };
  assert.equal((await handler(evento("limpeza"), { ...falha, autenticar: async () => ({ ok: false, status: 401, erro: "x" }), env: {} })).statusCode, 401);
  assert.equal((await handler(evento("limpeza", "GET"), { ...ok, ...falha })).statusCode, 405);
  assert.equal((await handler(evento("oi"), { ...ok, ...falha })).statusCode, 400);
  assert.equal((await handler(evento("material de limpeza"), { ...ok, ...falha, env: {} })).statusCode, 503);
});
test("limite diário vira 429 e não chama a IA", async () => {
  const r = await handler(evento("material de limpeza"), { ...ok, limitar: async () => ({ ok: false, status: 429, erro: "Limite" }), responder: async () => assert.fail("IA chamada") });
  assert.equal(r.statusCode, 429);
});
test("IA fora do ar ou resposta sem palavras dá 502", async () => {
  assert.equal((await handler(evento("material de limpeza"), { ...ok, responder: async () => ({ ok: false }) })).statusCode, 502);
  assert.equal((await handler(evento("material de limpeza"), { ...ok, responder: async () => ({ ok: true, texto: "não sei" }) })).statusCode, 502);
});
