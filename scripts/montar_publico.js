// Monta a pasta publico/ que o Cloudflare Pages publica.
//
// Por quê: publicar a raiz do repositório subiria node_modules, scripts, supabase e .github, e o
// Pages tem limite de 20.000 arquivos por deploy. Aqui entra só o que o site realmente serve:
// as páginas HTML, os JS/imagens da raiz referenciados por elas, data/ e o _headers.
// O Netlify continua publicando a raiz ("publish = .") e não usa este script.

const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..");
const DESTINO = path.join(RAIZ, "publico");

// Arquivos da raiz que nunca são servidos (configuração de ferramentas).
const IGNORADOS = new Set(["eslint.config.js", "package.json", "package-lock.json", "skills-lock.json", "biome.jsonc"]);
const EXTENSOES_SERVIDAS = new Set([".html", ".js", ".png", ".svg", ".ico", ".jpg", ".jpeg", ".webp", ".css", ".txt", ".xml", ".webmanifest"]);

function arquivosDaRaiz() {
  return fs.readdirSync(RAIZ, { withFileTypes: true })
    .filter((e) => e.isFile() && !IGNORADOS.has(e.name) && EXTENSOES_SERVIDAS.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .concat("_headers");
}

function montarPublico() {
  fs.rmSync(DESTINO, { recursive: true, force: true });
  fs.mkdirSync(DESTINO, { recursive: true });
  const copiados = arquivosDaRaiz();
  for (const nome of copiados) fs.copyFileSync(path.join(RAIZ, nome), path.join(DESTINO, nome));
  fs.cpSync(path.join(RAIZ, "data"), path.join(DESTINO, "data"), { recursive: true });
  return copiados;
}

if (require.main === module) {
  const copiados = montarPublico();
  console.log(`publico/: ${copiados.length} arquivos da raiz + data/`);
}

module.exports = { montarPublico, arquivosDaRaiz };
