const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { arquivosDaRaiz } = require("./montar_publico");

test("o publico inclui as páginas, os assets referenciados e o _headers, sem arquivos de ferramenta", () => {
  const arquivos = arquivosDaRaiz();
  for (const esperado of ["index.html", "painel.html", "supabase-config.js", "resumo-modelo.js", "favicon.png", "logo.svg", "_headers"]) {
    assert.ok(arquivos.includes(esperado), `faltou ${esperado}`);
  }
  for (const proibido of ["eslint.config.js", "package.json", "package-lock.json", "netlify.toml"]) {
    assert.ok(!arquivos.includes(proibido), `não deveria publicar ${proibido}`);
  }
});

test("todo src/href local das páginas existe no publico", () => {
  const raiz = path.join(__dirname, "..");
  const publicados = new Set(arquivosDaRaiz());
  const faltando = [];
  for (const pagina of arquivosDaRaiz().filter((n) => n.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(raiz, pagina), "utf8");
    for (const [, ref] of html.matchAll(/(?:src|href)="([A-Za-z0-9_.-]+\.(?:js|png|svg|html|ico))(?:\?[^"]*)?"/g)) {
      if (!publicados.has(ref)) faltando.push(`${pagina} -> ${ref}`);
    }
  }
  assert.deepEqual(faltando, []);
});

test("_headers traz o CSP do netlify.toml e desanexa o Cache-Control em /data/*", () => {
  const raiz = path.join(__dirname, "..");
  const headers = fs.readFileSync(path.join(raiz, "_headers"), "utf8");
  const toml = fs.readFileSync(path.join(raiz, "netlify.toml"), "utf8");
  const csp = toml.match(/Content-Security-Policy = "(.*)"/)[1];
  assert.ok(headers.includes(`Content-Security-Policy: ${csp}`));
  assert.match(headers, /\/data\/\*\n {2}! Cache-Control\n {2}Cache-Control: public, max-age=300, stale-while-revalidate=3600/);
});
