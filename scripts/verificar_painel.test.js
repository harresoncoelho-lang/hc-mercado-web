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

test("resumo dos filtros não depende de helper declarado em script posterior", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
  const inicio = html.indexOf('const CHAVE = "hc_oportunidades_filtros_colapsado"');
  const fim = html.indexOf("// Histórico de Compras segue", inicio);
  const bloco = html.slice(inicio, fim);
  assert.ok(inicio >= 0 && fim > inicio);
  assert.doesNotMatch(bloco, /ufsDoSelect\(/);
  assert.doesNotMatch(bloco, /textoUfs\(/);
});

test("status usa a atualização real das tabelas que migraram para o Supabase", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
  assert.match(html, /tabelaSupabase: "contratos"/);
  assert.match(html, /tabelaSupabase: "mercado_atas"/);
  assert.match(html, /await aguardarSupabaseAutenticado\(\);/);
});
