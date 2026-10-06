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

test("checklist converte documentos estruturados sem perder o texto oficial", () => {
  const requisitos = requisitosDaEstrutura({ fonteLida: true,
    documentosHabilitacao: [{ texto: "Certidão federal (Edital 9.2)", categoria: "Fiscal" }, { categoria: "Sem texto" }],
    declaracoesExigidas: ["Declaração de ciência (Edital 5.4)"],
  });
  assert.deepEqual(requisitos, ["Certidão federal (Edital 9.2)", "Declaração de ciência (Edital 5.4)"]);
});

test("identifica apenas controle PNCP válido no processo", () => {
  assert.equal(idPncp({ origem_externa_id: "12345678000199-1-12/2026" }), "12345678000199-1-12/2026");
  assert.equal(idPncp({ origem_externa_id: "objeto|órgão|data", numero: "12345678000199-1-12/2026" }), "12345678000199-1-12/2026");
  assert.equal(idPncp({ origem_externa_id: "objeto|órgão|data" }), null);
  assert.equal(idPncp({ origem_externa_id: "objeto|órgão|data", numero: "003/2026", url_origem: "https://pncp.gov.br/app/editais/04477782000105/2026/14" }), "04477782000105-1-14/2026");
  assert.equal(idPncp({ url_origem: "https://outro.exemplo/app/editais/04477782000105/2026/14" }), null);
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
  assert.equal(recebido.empresa.razao_social, "Empresa");
  assert.equal(recebido.itens[0].processo_id, "p");
});

test("carteira não mostra nem dispara o checklist do resumo", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "processos.html"), "utf8");
  assert.doesNotMatch(html, /Checklist de habilitação|preencherChecklistDoResumo|data-retry-checklist/);
  assert.doesNotMatch(html, /name="documentos_exigidos"/);
});

test("itens oficiais ficam recolhidos e carregam página somente ao abrir", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "processos.html"), "utf8");
  const abertura = html.slice(html.indexOf("  function abrirDossie(id){"), html.indexOf("  async function visualizarRelatorio(id){"));
  assert.doesNotMatch(abertura, /carregarItensOficiais\(p\)/);
  assert.match(html, /data-alternar-itens/);
  assert.match(html, /&pagina=\$\{pagina\}/);
  assert.match(html, /class="itens-lista"/);
});
