const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const raiz = path.join(__dirname, "..");
const migracao = fs.readFileSync(path.join(raiz, "supabase", "acesso_empresa_convites.sql"), "utf8");

test("convite mantém script válido e o acesso restrito vinculado à empresa", () => {
  const html = fs.readFileSync(path.join(raiz, "convite.html"), "utf8");
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(scripts.length);
  scripts.forEach((script, i) => new vm.Script(script, { filename: `convite-inline-${i}.js` }));
  assert.match(migracao, /m\.empresa_id is null or m\.empresa_id = e\.id/);
  assert.match(migracao, /lower\(email\) into v_email from auth\.users/);
  assert.match(migracao, /v_email is distinct from v_convite\.email/);
  assert.match(migracao, /v_convite\.revogado_em is not null/);
  assert.match(migracao, /v_convite\.expira_em <= now\(\)/);
  assert.match(migracao, /pode_acessar_processo_operacao\(organizacao_id, processo_id\)/);
  assert.match(migracao, /acesso_arquivo_operacao\(name\)/);
});

test("status do cliente não pode ser autoaprovado após revogação", () => {
  assert.match(migracao, /create trigger proteger_status_cliente_operacao/);
  assert.match(migracao, /m\.usuario_id = auth\.uid\(\) and m\.empresa_id is not null/);
  assert.match(migracao, /update public\.clientes set status = 'rejeitado'/);
  assert.match(migracao, /where c\.id = v_usuario and c\.status = 'aprovado'/);
});
