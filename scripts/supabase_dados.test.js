const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const codigo = fs.readFileSync(path.join(__dirname, "supabase_dados.js"), "utf8");

function carregar(fetch) {
  const ambiente = vm.createContext({ fetch, AbortSignal: globalThis.AbortSignal, process: { env: { SUPABASE_SERVICE_ROLE_KEY: "somente-teste" } }, module: { exports: {} } });
  vm.runInContext(codigo, ambiente);
  return ambiente.module.exports;
}

test("falha no segundo lote não apaga base; repetição faz upsert idempotente", async () => {
  const base = new Map([["anterior", { chave: "anterior" }]]);
  let chamadas = 0;
  let falhar = true;
  const api = carregar(async (_url, opcoes) => {
    assert.equal(opcoes.method, "POST");
    assert.match(opcoes.headers.Prefer, /merge-duplicates/);
    chamadas++;
    if (falhar && chamadas === 2) throw new Error("timeout simulado");
    for (const linha of JSON.parse(opcoes.body)) base.set(linha.chave, linha);
    return { ok: true };
  });
  const linhas = [{ chave: "a" }, { chave: "b" }, { chave: "c" }];
  await assert.rejects(api.upsertEmLotes("teste", linhas, "chave", 2), /timeout simulado/);
  assert.deepEqual([...base.keys()], ["anterior", "a", "b"]);
  falhar = false;
  assert.equal(await api.upsertEmLotes("teste", linhas, "chave", 2), 3);
  assert.deepEqual([...base.keys()], ["anterior", "a", "b", "c"]);
});

test("REST usa prazo finito também para upsert", async () => {
  const api = carregar(async (_url, opcoes) => {
    assert.ok(opcoes.signal instanceof globalThis.AbortSignal);
    assert.equal(opcoes.signal.aborted, false);
    return { ok: true };
  });
  await api.upsertEmLotes("teste", [{ chave: "a" }], "chave");
});
