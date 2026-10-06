const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
const inicioMapas = html.indexOf("  function chaveArmazenamento(nome)");
const fimMapas = html.indexOf("  const OPCOES_STATUS_LICITACAO", inicioMapas);
const inicioEmpresa = html.indexOf("  function statusDoProcessoAcompanhamento(");
const fimEmpresa = html.indexOf("  function classePrazoKanban(", inicioEmpresa);
assert.ok(inicioMapas > 0 && fimMapas > inicioMapas && inicioEmpresa > 0 && fimEmpresa > inicioEmpresa);

test("status e cartões do mesmo edital ficam separados por empresa no navegador", () => {
  const dados = new Map();
  const contexto = {
    localStorage: { getItem: chave => dados.get(chave) || null, setItem: (chave, valor) => dados.set(chave, valor) },
    Set, JSON, Map, Array, Object,
  };
  vm.runInNewContext(`${html.slice(inicioMapas, fimMapas)}
    this.selecionar = id => { empresaOperacionalId = id; };
    this.marcar = definirNoMapa;
    this.ler = lerMapa;`, contexto);
  contexto.selecionar("hcm");
  contexto.marcar("status-licitacao", "edital-1", "interesse");
  contexto.marcar("kanban-editais", "edital-1", { objeto: "Papel" });
  contexto.selecionar("rymo");
  assert.equal(contexto.ler("status-licitacao")["edital-1"], undefined);
  contexto.marcar("status-licitacao", "edital-1", "participando");
  assert.equal(contexto.ler("status-licitacao")["edital-1"], "participando");
  contexto.selecionar("hcm");
  assert.equal(contexto.ler("status-licitacao")["edital-1"], "interesse");
  assert.equal(contexto.ler("kanban-editais")["edital-1"].objeto, "Papel");
  assert.equal(dados.has("hc_status-licitacao"), false);
});

test("o banco reconstitui dois acompanhamentos independentes e ignora processos arquivados", async () => {
  const processos = [
    { id: "p-hcm", empresa_id: "hcm", origem_externa_id: "edital-1", objeto: "Papel", status: "triagem", decisao: "em_analise" },
    { id: "p-rymo", empresa_id: "rymo", origem_externa_id: "edital-1", objeto: "Papel", status: "preparacao", decisao: "participar" },
    { id: "p-arquivado", empresa_id: "rymo", origem_externa_id: "edital-2", objeto: "Caneta", status: "arquivado", decisao: "participar" },
  ];
  const mapas = new Map();
  const banco = {
    from(tabela) {
      const filtros = {};
      const builder = {
        select() { return this; },
        eq(campo, valor) { filtros[campo] = valor; return this; },
        in() { return this; },
        async range() { return { data: processos.filter(p => p.empresa_id === filtros.empresa_id), error: null }; },
        then(resolve) { resolve({ data: [], error: null }); },
      };
      assert.ok(["operacao_processos", "operacao_prazos_processo"].includes(tabela));
      return builder;
    },
  };
  const contexto = {
    window: { __sbClient: banco },
    lerMapa: (nome, empresa) => mapas.get(`${empresa}:${nome}`) || {},
    salvarMapa: (nome, valor, empresa) => mapas.set(`${empresa}:${nome}`, valor),
    Map, Set, Promise, Object, Array, Date, String,
  };
  vm.runInNewContext(`${html.slice(inicioEmpresa, fimEmpresa)}
    this.carregar = carregarAcompanhamentosEmpresa;`, contexto);
  await contexto.carregar("org", "hcm");
  await contexto.carregar("org", "rymo");
  assert.equal(mapas.get("hcm:status-licitacao")["edital-1"], "interesse");
  assert.equal(mapas.get("rymo:status-licitacao")["edital-1"], "participando");
  assert.equal(mapas.get("rymo:status-licitacao")["edital-2"], undefined);
  assert.equal(mapas.get("hcm:kanban-editais")["edital-1"].objeto, "Papel");
});
