const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("dossiê de processos mantém o script inline sintaticamente válido", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "processos.html"), "utf8");
  const scripts = html.split("<script>").slice(1).map((trecho) => trecho.split("</script>")[0]);
  assert.equal(scripts.length, 3);
  scripts.forEach((script, indice) => new vm.Script(script, { filename: `processos-inline-${indice + 1}.js` }));
});

test("dossiê compartilha o tema e a empresa ativa com o painel", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "processos.html"), "utf8");
  assert.match(html, /licitaplena_tema/);
  assert.match(html, /licitaplena_empresa_operacional_id/);
});

test("processo, prazo e empenho terminam de salvar após o evento perder currentTarget", async () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "processos.html"), "utf8");
  const inicio = html.indexOf("  async function salvarProcesso(");
  const fim = html.indexOf('  $("empresa-atual")', inicio);
  assert.ok(inicio > 0 && fim > inicio);
  for (const [funcao, tabela, campos] of [
    ["salvarProcesso", "operacao_processos", [["objeto", "Aquisição de materiais"], ["decisao", "em_analise"]]],
    ["salvarPrazo", "operacao_prazos_processo", [["processo_id", "processo"], ["categoria", "sessao"], ["titulo", "Sessão"], ["vencimento", "2026-10-20T10:00"]]],
    ["salvarEmpenho", "operacao_empenhos", [["processo_id", "processo"], ["numero", "123"], ["status", "emitido"]]],
  ]) {
    const chamadas = [];
    const formulario = { dados: new Map(campos), reset() { chamadas.push("reset"); } };
    const evento = { currentTarget: formulario, preventDefault() {} };
    const contexto = {
      estado: { orgId: "org", empresaId: "empresa", processos: [{ id: "processo" }] },
      FormData: class { constructor(form) { this.dados = form.dados; } get(chave) { return this.dados.get(chave) || null; } },
      sb: { from(nome) {
        assert.equal(nome, tabela);
        return { insert() {
          if (nome === "operacao_processos") return { select: () => ({ async single() { evento.currentTarget = null; chamadas.push("insert"); return { data: { id: "processo", objeto: "Aquisição de materiais" }, error: null }; } }) };
          return Promise.resolve().then(() => { evento.currentTarget = null; chamadas.push("insert"); return { error: null }; });
        } };
      } },
      numero: () => null,
      calcularMinimo: () => null,
      linkSeguro: () => null,
      aviso: () => {},
      fechar: () => chamadas.push("fechar"),
      carregarTudo: async () => chamadas.push("recarregar"),
      abrirDossie: () => chamadas.push("abrir"),
    };
    vm.runInNewContext(`${html.slice(inicio, fim)}\nthis.api = { salvarProcesso, salvarPrazo, salvarEmpenho };`, contexto);
    await contexto.api[funcao](evento);
    assert.deepEqual(chamadas.slice(0, 4), ["insert", "reset", "fechar", "recarregar"], funcao);
  }
});
