const { test } = require("node:test");
const assert = require("node:assert/strict");
const { origemPermitida } = require("../_auth");

test("origemPermitida retorna a própria origem quando está na allowlist", () => {
  const event = { headers: { origin: "https://licitaplena.com.br" } };
  assert.equal(origemPermitida(event), "https://licitaplena.com.br");
});

test("origemPermitida cai para a primeira origem permitida quando a origem não está na allowlist", () => {
  const event = { headers: { origin: "https://site-malicioso.com" } };
  assert.equal(origemPermitida(event), "https://licitaplena.com.br");
});

test("origemPermitida cai para a primeira origem permitida quando não há header de origin", () => {
  const event = { headers: {} };
  assert.equal(origemPermitida(event), "https://licitaplena.com.br");
});

test('auth diferencia sessão inválida de indisponibilidade sem liberar acesso', async () => {
  const { exigirUsuarioLogado } = require('../_auth');
  const anterior = global.fetch;
  try {
    for (const status of [401, 403, 429, 500, 503]) {
      global.fetch = async () => ({ ok: false, status });
      const resultado = await exigirUsuarioLogado({ headers: { authorization: 'Bearer teste' } });
      assert.equal(resultado.ok, false);
      assert.equal(resultado.status, status === 401 || status === 403 ? 401 : 503);
    }
    global.fetch = async () => { throw new Error('rede-segredo'); };
    const resultado = await exigirUsuarioLogado({ headers: { authorization: 'Bearer teste' } });
    assert.equal(resultado.status, 503); assert.doesNotMatch(resultado.erro, /rede-segredo/);
  } finally { global.fetch = anterior; }
});
