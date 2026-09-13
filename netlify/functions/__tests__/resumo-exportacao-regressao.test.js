const test = require("node:test");
const assert = require("node:assert/strict");
const AdmZip = require("adm-zip");
const email = require("../enviar-resumo-edital").__test;
const checklist = require("../gerar-checklist").__test;
const modelo = require("../../../resumo-modelo");

test("ausência em cache não apaga identificação oficial no modelo comum", () => {
  for (const vazio of [null, "", "Não informado"]) {
    const ficha = modelo.montar({ identificacao: { objeto: vazio, numero: vazio }, orgao: { nome: vazio } }, { objeto: "Objeto oficial", numero: "81/2026", orgao: "Marinha" });
    assert.equal(ficha.objeto, "Objeto oficial");
    assert.equal(ficha.numero, "81/2026");
    assert.match(JSON.stringify(ficha.secoes), /Marinha/);
  }
});

test("modelo geral atende DE81 sem transplantar exigências estaduais de PE406", () => {
  const fixture = require("./fixtures/de81-revisado.json");
  const ficha = modelo.montar(fixture.estrutura, fixture.edital);
  const texto = JSON.stringify(ficha);
  for (const fato of ["SICAF", "60 dias", "último exercício", "3 dias", "nota de empenho OU ordem de compra", "12 meses", "Não é exigida garantia contratual", "10 dias úteis após a liquidação"]) assert.ok(texto.includes(fato), fato);
  assert.doesNotMatch(texto, /CCF|certidão municipal/i);
  assert.deepEqual(ficha.secoes.map(s => s.titulo), ["Identificação da Licitação", "Informações da Sessão Pública", "Órgão Responsável", "Detalhes da Licitação", "Seguro Garantia", "Informações sobre entrega e execução", "Prazos importantes", "Critérios da Proposta e Julgamento", "Resumo dos Itens", "Documentos de habilitação exigidos", "Atestado de capacidade técnica", "Legislação", "Anexos e declarações", "Outras informações relevantes", "Condições de pagamento", "Penalidades e multas", "Análise crítica", "Análise e Considerações do Licitante"]);
});

test("valor monetário é legível sem alterar zero, valores brasileiros ou condições textuais", () => {
  for (const [entrada, esperado] of [[2246.13, "R$ 2.246,13"], ["2246.13", "R$ 2.246,13"], [0, "R$ 0,00"], ["2.246,13", "2.246,13"], ["R$ 2.246,13", "R$ 2.246,13"], ["Valor sigiloso", "Valor sigiloso"]]) {
    const ficha = modelo.montar({ detalhes: { valorEstimado: entrada } });
    assert.equal(ficha.cards[0][1].replace(/\u00a0/g, " "), esperado);
    const detalhe = ficha.secoes.find(s => s.titulo === "Detalhes da Licitação").campos.find(c => c.rotulo === "Valor estimado");
    assert.equal(detalhe.valor.replace(/\u00a0/g, " "), esperado);
  }
});

test("número oficial substitui controle PNCP sem sobrescrever número extraído nem deduzir ano", () => {
  const controle = "01171012000141-1-000005/2026";
  const edital = { numeroControlePNCP: controle, numeroCompra: "406", anoCompra: 2026, modalidade: "Pregão" };
  assert.equal(modelo.montar({ identificacao: { numero: controle } }, edital).numero, "406/2026");
  assert.equal(modelo.montar({ identificacao: { numero: "PE 406/2026 — CSC" } }, edital).numero, "PE 406/2026 — CSC");
  assert.equal(modelo.montar({}, { numeroCompra: "406", numeroControlePNCP: controle }).numero, controle);
  const ficha = modelo.montar({ identificacao: { modalidade: "Pregão" }, dadosOficiais: { modalidade: "Pregão" } }, edital);
  assert.equal(ficha.secoes[0].campos.filter(c => c.rotulo === "Modalidade").length, 1);
});

test("cabeçalho DOCX usa número oficial e mantém controle PNCP quando for a única identificação", () => {
  const controle = "01171012000141-1-000005/2026";
  const resumo = { fonteLida: true, identificacao: { numero: controle }, documentosHabilitacao: ["Certidão fiscal"] };
  const comNumero = new AdmZip(checklist.montarDocx({ numeroControlePNCP: controle, numeroCompra: "406", anoCompra: 2026 }, resumo)).readAsText("word/document.xml");
  assert.match(comNumero, /Número da licitação: 406\/2026/);
  assert.doesNotMatch(comNumero, /Controle PNCP:/);
  const somenteControle = new AdmZip(checklist.montarDocx({ numeroControlePNCP: controle }, resumo)).readAsText("word/document.xml");
  assert.ok(somenteControle.includes(`Controle PNCP: ${controle}`));
});

test("exportações preservam exigências que alteram preparo da proposta e execução", () => {
  const resumo = {
    fonteLida: true,
    coberturaLeitura: { parcial: true },
    entregaExecucao: { prazo: "30 dias após ordem de compra", local: "Almoxarifado central", condicoes: "Substituir materiais rejeitados em 48 horas" },
    atestadoCapacidadeTecnica: "Atestados de 50% das quantidades; aceita somatório",
    prazos: { prazoDocumentoComplementar: "3 horas após solicitação", prazoContrarrazoes: "3 dias úteis", limiteEnvioPropostas: "2026-09-22T09:15:00" },
    analiseCritica: { conflitoPrazosEntrega: "Edital prevê 10 dias; TR prevê 30 dias", permiteSubcontratacao: "Vedada a subcontratação" },
    detalhes: { valorEstimado: "R$ 24.117,46" },
    identificacao: { numero: "406/2026" },
    itens: { totalItens: 22 },
    documentosHabilitacao: ["Certidão de regularidade fiscal"],
  };
  const saidas = {
    email: email.montarConteudoEstruturado(resumo, {}),
    docx: new AdmZip(checklist.montarDocx({}, resumo)).readAsText("word/document.xml"),
  };
  const exigencias = ["30 dias após ordem de compra", "Almoxarifado central", "Substituir materiais rejeitados em 48 horas", "Atestados de 50% das quantidades; aceita somatório", "3 horas após solicitação", "3 dias úteis", "Edital prevê 10 dias; TR prevê 30 dias", "Vedada a subcontratação", "R$ 24.117,46", "406/2026", "22/09/2026"];
  for (const [formato, conteudo] of Object.entries(saidas)) {
    for (const exigencia of exigencias) assert.ok(conteudo.includes(exigencia), `${formato} omitiu ou alterou: ${exigencia}`);
    assert.match(conteudo, />22</, `${formato} alterou quantidade numérica`);
    assert.match(conteudo, /Leitura parcial/);
  }
});
