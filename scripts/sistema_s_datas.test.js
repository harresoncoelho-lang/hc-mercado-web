const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
const inicio = html.indexOf("  function dataBrParaIso(");
const fim = html.indexOf("  // Busca oportunidades abertas do Sistema S/AM", inicio);
assert.ok(inicio >= 0 && fim > inicio, "normalização do Sistema S deve existir");
const contexto = vm.createContext({});
vm.runInContext(html.slice(inicio, fim), contexto);

test("SENAC/AM mantém abertura sem fabricar data de publicação", () => {
  const registro = vm.runInContext('normalizarSistemaS({ fonte: "SENAC/AM", numero: "007/2026", dataAbertura: "15/10/2026" })', contexto);
  assert.equal(registro.encerramento, "2026-10-15");
  assert.equal(registro.publicacao, null);
});

test("SESC/AM preserva publicação e abertura como campos distintos", () => {
  const registro = vm.runInContext('normalizarSistemaS({ fonte: "SESC/AM", dataPublicacao: "05/10/2026", dataAbertura: "15/10/2026" })', contexto);
  assert.equal(registro.publicacao, "2026-10-05");
  assert.equal(registro.encerramento, "2026-10-15");
});
