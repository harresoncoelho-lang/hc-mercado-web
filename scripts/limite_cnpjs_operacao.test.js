const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const operacao = fs.readFileSync(path.join(__dirname, "..", "operacao.html"), "utf8");
const admin = fs.readFileSync(path.join(__dirname, "..", "admin.html"), "utf8");
const migracao = fs.readFileSync(path.join(__dirname, "..", "supabase", "limite_cnpjs_operacao.sql"), "utf8");
const inicio = operacao.indexOf("  async function salvarEmpresa(");
const fim = operacao.indexOf("  async function salvarEvento(", inicio);
assert.ok(inicio > 0 && fim > inicio);

test("painel administrativo mantém scripts inline válidos", () => {
  const scripts = [...admin.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(scripts.length > 0);
  scripts.forEach((script, i) => new vm.Script(script, { filename: `admin-inline-${i}.js` }));
});

test("migração reconhece o owner pelo e-mail real e protege o limite no banco", () => {
  assert.match(migracao, /join public\.admins a on lower\(a\.email\) = lower\(u\.email\)/);
  assert.doesNotMatch(migracao, /public\.admins\s+where\s+id\s*=/);
  assert.match(migracao, /check \(limite between 1 and 3\)/);
  assert.match(migracao, /for update;/);
  assert.match(migracao, /before insert or update of ativo, organizacao_id on public\.operacao_empresas/);
});

function preparar(limite, empresas) {
  const chamadas = [];
  const formulario = { reset() { chamadas.push("reset"); }, querySelector() { return botao; } };
  const botao = { disabled: false };
  const contexto = {
    estado: { orgId: "org", empresaId: "primeira", empresas, limiteCnpjs: limite },
    FormData: class { get(campo) { return ({ razao_social: "Empresa nova", cnpj: "", responsavel: "" })[campo]; } },
    normalizarCnpj: () => null,
    sb: { from(tabela) {
      assert.equal(tabela, "operacao_empresas");
      return { insert(dados) {
        chamadas.push(["insert", dados]);
        return { select() { return { single: async () => ({ data: { id: "nova" }, error: null }) }; } };
      } };
    } },
    localStorage: { setItem: (...args) => chamadas.push(["preferencia", ...args]) },
    fecharModal: () => chamadas.push("fechar"),
    carregarEmpresas: async () => chamadas.push("recarregar"),
    aviso: mensagem => chamadas.push(["aviso", mensagem]),
  };
  vm.runInNewContext(`${operacao.slice(inicio, fim)}\nthis.salvar = salvarEmpresa;`, contexto);
  return { salvar: contexto.salvar, formulario, botao, chamadas };
}

test("cliente no limite não consegue abrir um quarto cadastro pela interface", async () => {
  const caso = preparar(3, [{}, {}, {}]);
  await caso.salvar({ currentTarget: caso.formulario, preventDefault() {} });
  assert.equal(caso.chamadas.some(c => Array.isArray(c) && c[0] === "insert"), false);
  assert.match(caso.chamadas.find(c => Array.isArray(c) && c[0] === "aviso")[1], /limite de 3 empresas/);
  assert.equal(caso.botao.disabled, false);
});

test("proprietário ilimitado continua podendo cadastrar empresa", async () => {
  const caso = preparar(null, [{}, {}, {}, {}]);
  await caso.salvar({ currentTarget: caso.formulario, preventDefault() {} });
  assert.equal(caso.chamadas.filter(c => Array.isArray(c) && c[0] === "insert").length, 1);
  assert.ok(caso.chamadas.includes("recarregar"));
  assert.equal(caso.botao.disabled, false);
});
