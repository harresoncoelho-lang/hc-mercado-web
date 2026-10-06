const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { requisitosDaEstrutura, idPncp } = require("../operacao-edital");

test("checklist usa somente requisitos de habilitação e declarações de fonte lida", () => {
  const requisitos = requisitosDaEstrutura({
    fonteLida: true,
    documentosHabilitacao: [" Certidão Federal [Edital, 5.1] ", "Certidão Federal [Edital, 5.1]", "Não informado"],
    declaracoesExigidas: ["Declaração de inexistência de impedimento [Edital, 5.2]"],
    requisitosProposta: ["Valor da proposta"],
  });
  assert.deepEqual(requisitos, ["Certidão Federal [Edital, 5.1]", "Declaração de inexistência de impedimento [Edital, 5.2]"]);
  assert.deepEqual(requisitosDaEstrutura({ fonteLida: false, documentosHabilitacao: ["Não comprovado"] }), []);
  assert.deepEqual(requisitosDaEstrutura({ fonteLida: true, modoDegradado: true, documentosHabilitacao: ["Indevido"] }), []);
});

test("identifica apenas controle PNCP válido no processo", () => {
  assert.equal(idPncp({ origem_externa_id: "12345678000199-1-12/2026" }), "12345678000199-1-12/2026");
  assert.equal(idPncp({ origem_externa_id: "objeto|órgão|data", numero: "12345678000199-1-12/2026" }), "12345678000199-1-12/2026");
  assert.equal(idPncp({ origem_externa_id: "objeto|órgão|data" }), null);
});

test("relatório usa prévia interna e impressão para salvar PDF, sem popup", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "processos.html"), "utf8");
  assert.match(html, /id="modal-relatorio"/);
  assert.match(html, /id="relatorio-frame"/);
  assert.match(html, /visualizarRelatorio\(rel\.dataset\.relatorio\)/);
  assert.match(html, /frame\.contentWindow\.print\(\)/);
  assert.doesNotMatch(html, /window\.open\("","_blank"/);
});

test("prévia recebe todos os registros do processo sem abrir outra guia", async () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "processos.html"), "utf8");
  const inicio = html.indexOf("  async function visualizarRelatorio(id){");
  const fim = html.indexOf("  function editarProcesso(id){", inicio);
  assert.ok(inicio >= 0 && fim > inicio);
  const frame = { srcdoc: "" }, botao = { disabled: false }, modal = { classList: { contains: () => true } };
  let recebido;
  const estado = { detalhesCarregados: true, empresaId: "e", empresas: [{ id: "e", razao_social: "Empresa" }], processos: [{ id: "p", empresa_id: "e" }],
    itens: [{ processo_id: "p" }, { processo_id: "outro" }], prazos: [{ processo_id: "p" }], empenhos: [], ocorrencias: [], contratos: [], anexos: [] };
  const contexto = { estado, $: id => ({ "relatorio-frame": frame, "btn-salvar-pdf": botao, "modal-relatorio": modal })[id],
    abrir: () => {}, fechar: () => {}, aviso: () => assert.fail("Sem erro esperado"), itensOficiais: new Map([["p", []]]), falhasItens: new Set(), consultasItens: new Set(),
    LicitaRelatorioOperacional: { gerarHtml: dados => { recebido = dados; return "<html>relatório</html>"; } }, resultadoDoProcesso: () => ({ situacao: "nao_apurado" }) };
  await vm.runInNewContext(`${html.slice(inicio, fim)}; visualizarRelatorio`, contexto)("p");
  assert.equal(frame.srcdoc, "<html>relatório</html>");
  assert.equal(recebido.itens.length, 1);
  assert.equal(recebido.prazos.length, 1);
  assert.equal(recebido.empresa.razao_social, "Empresa");
});

test("edição humana impede que novo resumo substitua checklist ou restaure item excluído", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "processos.html"), "utf8");
  assert.match(html, /checklist_editado_manualmente:true/);
  assert.match(html, /\.eq\("checklist_editado_manualmente",false\)/);
});

test("checklist espera o resumo progressivo antes de gravar requisitos", async () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "processos.html"), "utf8");
  const inicio = html.indexOf("  async function preencherChecklistDoResumo(processo){");
  const fim = html.indexOf("  function renderizarItensOficiais(processo){", inicio);
  assert.ok(inicio >= 0 && fim > inicio);
  const chamadas = [], gravacoes = [];
  const respostas = [
    { disponivel: false, requisitos: [] },
    { emProcessamento: true, progresso: { aguardarSegundos: 1 } },
    { fonteLida: true, estrutura: { documentosHabilitacao: ["Certidão fiscal [Edital, 7.1]"] } },
  ];
  const consulta = { eq() { return this; }, select() { return Promise.resolve({ data: [{ id: "p1", atualizado_em: "novo" }], error: null }); } };
  const contexto = { LicitaOperacaoEdital: require("../operacao-edital"), consultasChecklist: new Set(), checklistIndisponivel: new Set(),
    estado: { orgId: "org" }, sb: { auth: { getSession: async () => ({ data: { session: { access_token: "token" } } }) },
      from: () => ({ update: dados => { gravacoes.push(dados); return consulta; } }) },
    fetch: async (_url, opcoes) => { chamadas.push(JSON.parse(opcoes.body).modo); const status = chamadas.length === 2 ? 202 : 200; return { ok: true, status, json: async () => respostas.shift() }; },
    $: () => ({ classList: { contains: () => false } }), console, setTimeout: resolva => resolva(), abrirDossie: () => assert.fail("Modal fechado") };
  const processo = { id: "p1", empresa_id: "empresa", origem_externa_id: "12345678000199-1-12/2026", atualizado_em: "antigo", documentos_exigidos: [] };
  await vm.runInNewContext(`${html.slice(inicio, fim)}; preencherChecklistDoResumo`, contexto)(processo);
  assert.deepEqual(chamadas, ["consulta_requisitos", "resumo", "resumo"]);
  assert.equal(gravacoes.length, 1);
  assert.equal(processo.documentos_exigidos[0], "Certidão fiscal [Edital, 7.1]");
  assert.equal(processo.atualizado_em, "novo");
});
