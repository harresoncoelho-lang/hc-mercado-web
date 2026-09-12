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
  assert.deepEqual(ficha.secoes.map(s => s.titulo), require("./fixtures/pe406-modelo-aprovado.json").secoes.map(s => s.titulo));
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
