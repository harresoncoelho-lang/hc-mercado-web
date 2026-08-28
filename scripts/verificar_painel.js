// Validação estática dos scripts embutidos no painel principal.
// O projeto não possui bundler: um erro de sintaxe em qualquer <script> inline
// impediria uma funcionalidade inteira de iniciar no navegador. Este check
// mantém essa garantia barata e independente de ambiente visual.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function verificarScriptsInline(caminhoPainel = path.join(__dirname, "..", "painel.html")) {
  const html = fs.readFileSync(caminhoPainel, "utf8");
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];

  if (scripts.length === 0) {
    throw new Error("Nenhum script inline foi encontrado em painel.html.");
  }

  scripts.forEach((script, indice) => {
    new vm.Script(script[1], { filename: `painel-inline-${indice + 1}.js` });
  });

  return scripts.length;
}

if (require.main === module) {
  const total = verificarScriptsInline();
  console.log(`[verificar-painel] ${total} script(s) inline verificado(s) com sucesso.`);
}

module.exports = { verificarScriptsInline };
