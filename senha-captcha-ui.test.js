const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chaveHCaptcha, aplicarChaveHCaptcha, alternarSenha, CHAVE_PRODUCAO, CHAVE_TESTE } = require("./senha-captcha-ui.js");

test("chave de teste só em localhost, 127.0.0.1 e [::1]", () => {
  for (const h of ["localhost", "127.0.0.1", "[::1]", "LOCALHOST"]) assert.equal(chaveHCaptcha(h), CHAVE_TESTE);
  for (const h of ["licitaplena.com.br", "www.licitaplena.com.br", "localhost.evil.com", "", undefined]) assert.equal(chaveHCaptcha(h), CHAVE_PRODUCAO);
  assert.equal(CHAVE_TESTE, "10000000-ffff-ffff-ffff-000000000001");
});

test("aplicarChaveHCaptcha troca o data-sitekey de todos os widgets", () => {
  const els = [{ dataset: {} }, { dataset: {} }];
  const doc = { querySelectorAll: () => els };
  aplicarChaveHCaptcha(doc, "127.0.0.1");
  assert.deepEqual(els.map((e) => e.dataset.sitekey), [CHAVE_TESTE, CHAVE_TESTE]);
  aplicarChaveHCaptcha(doc, "licitaplena.com.br");
  assert.equal(els[0].dataset.sitekey, CHAVE_PRODUCAO);
});

test("olho alterna tipo do campo, aria-pressed, aria-label e ícone", () => {
  const campo = { type: "password" };
  const attrs = {}; const classes = new Set();
  const btn = {
    dataset: { alvo: "senha" }, title: "",
    setAttribute: (k, v) => { attrs[k] = v; },
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
  };
  const doc = { getElementById: (id) => (id === "senha" ? campo : null) };
  assert.equal(alternarSenha(btn, doc), true);
  assert.equal(campo.type, "text");
  assert.deepEqual(attrs, { "aria-pressed": "true", "aria-label": "Ocultar senha" });
  assert.ok(classes.has("senha-visivel"));
  alternarSenha(btn, doc);
  assert.equal(campo.type, "password");
  assert.deepEqual(attrs, { "aria-pressed": "false", "aria-label": "Mostrar senha" });
  assert.ok(!classes.has("senha-visivel"));
});

test("páginas de acesso usam o olho e a chave por host, sem botão de texto nem chave fixa no widget", () => {
  for (const f of ["login", "cadastro", "convite", "admin"]) {
    const html = fs.readFileSync(`${__dirname}/${f}.html`, "utf8");
    assert.ok(html.includes("senha-captcha-ui.js"), f);
    assert.ok(html.includes("aplicarChaveHCaptcha"), f);
    assert.ok(!/>Mostrar senha</.test(html), f);
    assert.ok(/aria-label="Mostrar senha"/.test(html), f);
  }
});
