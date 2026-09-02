const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("central operacional mantém o script inline sintaticamente válido", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "operacao.html"), "utf8");
  const scripts = html.split("<script>").slice(1).map((trecho) => trecho.split("</script>")[0]);
  assert.equal(scripts.length, 1);
  scripts.forEach((script, indice) => new vm.Script(script, { filename: `operacao-inline-${indice + 1}.js` }));
});
