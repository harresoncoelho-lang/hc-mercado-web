const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Arrays criados no vm são de outro realm: [...x] traz para cá antes do deepEqual.
// Extrai KANBAN_COLUNAS, colunasDoFunil e colunaDoCard do painel (funções puras).
const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
const inicio = html.indexOf("  const KANBAN_COLUNAS = [");
const fim = html.indexOf("  function salvarSnapshotKanban(", inicio);
assert.ok(inicio > 0 && fim > inicio);
const contexto = {};
vm.runInNewContext(`${html.slice(inicio, fim)}\nthis.colunasDoFunil = colunasDoFunil; this.colunaDoCard = colunaDoCard;`, contexto);
const { colunasDoFunil, colunaDoCard } = contexto;

const ETAPAS = [
  { id: "e-perdi", nome: "Perdi", ordem: 4, status_sistema: "perdido", chave_sistema: "perdi", cor: "#dc2626" },
  { id: "e-interesse", nome: "Tenho interesse", ordem: 0, status_sistema: "triagem", chave_sistema: "interesse", cor: "#64748b" },
  { id: "e-sessao", nome: "Sessão marcada", ordem: 2, status_sistema: "sessao", chave_sistema: null, cor: "#7c3aed" },
  { id: "e-participando", nome: "Participando", ordem: 1, status_sistema: "preparacao", chave_sistema: "participando", cor: "#2563eb" },
  { id: "e-ganhei", nome: "Ganhei", ordem: 3, status_sistema: "homologado", chave_sistema: "ganhei", cor: "not-a-color" },
];

test("sem etapas (tabela ausente) usa as 4 colunas padrão e a chave do cartão", () => {
  assert.deepEqual([...colunasDoFunil(null).map((c) => c.chave)], ["interesse", "participando", "ganhei", "perdi"]);
  assert.equal(colunaDoCard(null, "ganhei", "e-sessao", "sessao"), "ganhei");
  assert.equal(colunaDoCard(null, "interesse", null, null), "interesse");
});

test("etapa do cartão vale quando o estágio coincide", () => {
  assert.equal(colunaDoCard(ETAPAS, "participando", "e-sessao", "sessao"), "e-sessao");
});

test("estágio divergente ou etapa excluída vai para a etapa protegida da chave", () => {
  // O status mudou fora do Funil (ex.: no sistema) e a etapa ficou para trás.
  assert.equal(colunaDoCard(ETAPAS, "participando", "e-sessao", "recurso"), "e-participando");
  assert.equal(colunaDoCard(ETAPAS, "perdi", "e-sessao", "perdido"), "e-perdi");
  assert.equal(colunaDoCard(ETAPAS, "ganhei", "e-que-nao-existe", "homologado"), "e-ganhei");
  assert.equal(colunaDoCard(ETAPAS, "interesse", null, "triagem"), "e-interesse");
});

test("colunas seguem a ordem das etapas, com nome, ícone e cor segura", () => {
  const colunas = colunasDoFunil(ETAPAS);
  assert.deepEqual([...colunas.map((c) => c.chave)], ["e-interesse", "e-participando", "e-sessao", "e-ganhei", "e-perdi"]);
  assert.deepEqual([...colunas.map((c) => c.titulo)], ["Tenho interesse", "Participando", "Sessão marcada", "Ganhei", "Perdi"]);
  assert.equal(colunas[0].icone, "star");
  assert.equal(colunas[2].icone, "circle");
  assert.equal(colunas[2].cor, "#7c3aed");
  // Cor fora de #rrggbb nunca vai para o style da coluna.
  assert.equal(colunas[3].cor, "var(--border-strong)");
  // Não reordena a lista recebida.
  assert.equal(ETAPAS[0].id, "e-perdi");
});
