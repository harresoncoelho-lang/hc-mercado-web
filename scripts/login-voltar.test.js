// ?voltar= do login.html: só caminho interno do próprio site; nada de redirecionador aberto.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../login.html"), "utf8");
const inicio = html.indexOf("  function destinoSeguro(");
const fim = html.indexOf("  const parametros", inicio);
const contexto = { window: { location: { origin: "https://licitaplena.com.br" } }, URL };
vm.runInNewContext(html.slice(inicio, fim) + "\nthis.destinoSeguro = destinoSeguro;", contexto);
const { destinoSeguro } = contexto;

test("caminho interno volta para onde estava", () => {
  assert.equal(destinoSeguro("/sistema"), "/sistema");
  assert.equal(destinoSeguro("/sistema?x=1#y"), "/sistema?x=1#y");
});

test("sem parâmetro ou destino externo cai no painel", () => {
  for (const v of [null, "", "sistema", "https://mal.example/", "//mal.example/x", "/\\mal.example", "javascript:alert(1)", "\\\\mal.example"]) {
    assert.equal(destinoSeguro(v), "painel.html", String(v));
  }
});
