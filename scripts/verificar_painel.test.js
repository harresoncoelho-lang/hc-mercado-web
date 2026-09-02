const assert = require("node:assert/strict");
const test = require("node:test");

const { verificarScriptsInline } = require("./verificar_painel");

test("painel mantém todos os scripts inline sintaticamente válidos", () => {
  assert.ok(verificarScriptsInline() > 0);
});

test("boletim sincroniza o Kanban com um dossiê operacional", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
  assert.match(html, /sincronizarDossieOperacional/);
  assert.match(html, /origem_externa_id/);
});
