// E14: o Funil não pode apagar as premissas que o gatilho da esteira copiou para o processo.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(require.resolve("./painel.html"), "utf8");
const inicio = html.indexOf("  function dadosStatusOperacional(");
const fim = html.indexOf("  function classePrazoKanban(", inicio);
assert.ok(inicio > 0 && fim > inicio);
const codigo = html.slice(inicio, fim).replace(
  "const { organizacaoId, empresa } = await empresaOperacionalParaDossie(empresaId);",
  'const organizacaoId = "org", empresa = { id: "empresa" };'
);
const PREMISSAS = ["frete", "tributos_percentual", "garantia_percentual", "margem_percentual", "margem_minima_percentual", "premissas_fonte", "premissas_aplicadas_em"];

function preparar(existente) {
  const consultas = [];
  // Linha como o banco guarda depois do gatilho: premissas já copiadas.
  const noBanco = { id: "p1", atualizado_em: "t0", margem_percentual: 20, premissas_fonte: "padrao", documentos_exigidos: [] };
  const banco = {
    from(tabela) {
      const c = { tabela, acao: "select", dados: null, filtros: [] };
      consultas.push(c);
      return {
        select() { return this; },
        eq(campo, valor) { c.filtros.push([campo, valor]); return this; },
        insert(dados) { c.acao = "insert"; c.dados = dados; return this; },
        update(dados) { c.acao = "update"; c.dados = dados; return this; },
        maybeSingle: async () => ({ data: existente, error: null }),
        // Retorno do INSERT: sem o que o gatilho AFTER gravou.
        single: async () => ({ data: { id: "p1", atualizado_em: "t0", documentos_exigidos: [] }, error: null }),
        then(resolve) { resolve({ data: c.acao === "select" && tabela === "operacao_processos" ? [noBanco] : [], error: null }); },
      };
    },
  };
  const ctx = { window: { __sbClient: banco }, Map, Set, Promise, Object, Number, String, Date, console, document: {}, localStorage: { getItem: () => null },
    linkPncp: () => null, numeroOperacional: v => v == null ? null : Number(v), dataOperacional: () => null };
  vm.runInNewContext(`${codigo}\nthis.sincronizar = sincronizarDossieOperacional; this.selo = seloEsteira;`, ctx);
  return { ...ctx, consultas };
}
const edital = { objeto: "Papel", orgao: "Órgão", numeroControlePNCP: "x", valorTotalEstimado: 1000 };

test("processo criado pelo Funil é relido do banco e nenhum salvamento leva campo de premissa", async () => {
  const { sincronizar, consultas } = preparar(null);
  await sincronizar("x", edital, "interesse");
  const iInsert = consultas.findIndex(c => c.tabela === "operacao_processos" && c.acao === "insert");
  const releitura = consultas.findIndex((c, i) => i > iInsert && c.tabela === "operacao_processos" && c.acao === "select" && c.filtros.some(([k, v]) => k === "id" && v === "p1"));
  assert.ok(iInsert >= 0 && releitura > iInsert);
  for (const c of consultas.filter(c => c.dados)) for (const k of PREMISSAS) assert.equal(k in c.dados, false, `${c.acao} enviou ${k}`);
});

test("atualizar processo existente pelo Funil não reenvia premissas", async () => {
  const { sincronizar, consultas } = preparar({ id: "p1", objeto: "Papel", atualizado_em: "t0", margem_percentual: 20, frete: null, premissas_fonte: "padrao", documentos_exigidos: [] });
  await sincronizar("x", edital, "participando");
  const update = consultas.find(c => c.tabela === "operacao_processos" && c.acao === "update");
  for (const k of PREMISSAS) assert.equal(k in update.dados, false, k);
});

test("selo da esteira: falha pede atenção, três feitas = pronto, resto = lendo, sem tarefa = nada", () => {
  const { selo } = preparar(null);
  assert.equal(selo([]), null);
  assert.equal(selo(undefined), null);
  assert.equal(selo(["feito", "falhou", "pendente"]), "atencao");
  assert.equal(selo(["feito", "feito", "feito"]), "pronto");
  assert.equal(selo(["feito", "feito"]), "lendo");
  assert.equal(selo(["feito", "aguardando_leitura", "executando"]), "lendo");
});
