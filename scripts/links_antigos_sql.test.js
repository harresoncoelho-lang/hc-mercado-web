// A limpeza de links antigos do SQL (historico_licitacoes.sql) e a lista de hosts do código não podem se afastar.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { HOSTS_OFICIAIS } = require("../netlify/functions/_licitacao_anterior");

const sql = fs.readFileSync(path.join(__dirname, "../supabase/historico_licitacoes.sql"), "utf8");

test("SQL: o UPDATE de links usa exatamente os hosts oficiais do código, em link_origem e link_pncp, só https", () => {
  const upd = /update public\.historico_compras set([\s\S]*?);\r?\n/.exec(sql)[1];
  const hostsSql = [...new Set([...upd.matchAll(/\^https:\/\/\(([^)]*(?:\([^)]*\)[^)]*)*)\)\(\[\/\?#\]\|\$\)/g)].map((m) => m[1]))];
  assert.equal(hostsSql.length, 1, "uma só lista de hosts no UPDATE");
  const alternativas = hostsSql[0].split("|").flatMap((h) => (h.startsWith("(www") ? ["comprasnet.gov.br", "www.comprasnet.gov.br"] : [h.replace(/\\./g, ".")]));
  assert.deepEqual([...alternativas].sort(), [...HOSTS_OFICIAIS].sort());
  assert.match(upd, /link_origem = case/);
  assert.match(upd, /link_pncp = case/);
  assert.match(upd, /where \(link_origem is not null and link_origem !~\*/, "só toca linha que precisa mudar (idempotente)");
});

test("SQL: colunas novas do ComprasNet antigo e fila por pedido são aditivas", () => {
  assert.match(sql, /alter table public\.historico_compras add column if not exists fonte text/);
  assert.match(sql, /alter table public\.historico_itens add column if not exists motivo_situacao text/);
  const fila = fs.readFileSync(path.join(__dirname, "../supabase/analise_cnpj.sql"), "utf8");
  assert.match(fila, /add column if not exists pedido_em timestamptz/);
});
