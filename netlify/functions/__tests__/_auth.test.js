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
