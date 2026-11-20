// Tema único entre as páginas: chave licitaplena_tema ("claro" | "escuro"), claro como padrão.
// index/login/cadastro também migram a chave antiga licitaplena.tema ("light" | "dark") uma única vez.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function scriptDoTema(arquivo) {
  const html = fs.readFileSync(path.join(__dirname, "..", arquivo), "utf8");
  const trecho = html.split("<script>").slice(1).map((s) => s.split("</script>")[0]).find((s) => s.includes("licitaplena_tema") && s.includes("dataset.theme"));
  assert.ok(trecho, `${arquivo}: script de tema ausente`);
  return trecho;
}

function rodar(arquivo, inicial) {
  const m = new Map(Object.entries(inicial));
  const raiz = { dataset: {}, classes: new Set(), classList: { add(c) { raiz.classes.add(c); }, remove(c) { raiz.classes.delete(c); } } };
  const localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  vm.runInNewContext(scriptDoTema(arquivo), { localStorage, document: { documentElement: raiz } });
  return { tema: raiz.dataset.theme, claroCss: raiz.classes.has("tema-claro"), m };
}

for (const arquivo of ["index.html", "login.html", "cadastro.html"]) {
  test(`${arquivo}: tema claro por padrão e migração da chave antiga`, () => {
    assert.equal(rodar(arquivo, {}).tema, "light");
    assert.equal(rodar(arquivo, { licitaplena_tema: "escuro" }).tema, "dark");
    const migrado = rodar(arquivo, { "licitaplena.tema": "dark" });
    assert.equal(migrado.tema, "dark");
    assert.equal(migrado.m.get("licitaplena_tema"), "escuro");
    assert.equal(migrado.m.has("licitaplena.tema"), false);
    assert.equal(rodar(arquivo, { licitaplena_tema: "claro", "licitaplena.tema": "dark" }).tema, "light", "chave nova vence");
    const html = fs.readFileSync(path.join(__dirname, "..", arquivo), "utf8");
    assert.doesNotMatch(html, /setItem\("licitaplena\.tema"/);
  });
}

for (const arquivo of ["operacao.html", "processos.html"]) {
  test(`${arquivo}: tema claro por padrão, escuro só quando escolhido`, () => {
    assert.deepEqual([rodar(arquivo, {}).tema, rodar(arquivo, {}).claroCss], ["light", true]);
    assert.deepEqual([rodar(arquivo, { licitaplena_tema: "escuro" }).tema, rodar(arquivo, { licitaplena_tema: "escuro" }).claroCss], ["dark", false]);
  });
}
