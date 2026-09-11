const assert = require("node:assert/strict");
const test = require("node:test");
const AdmZip = require("adm-zip");
const { __test } = require("../gerar-checklist");

const edital = {
  numero: "413/2026",
  objeto: "Aquisição de materiais hospitalares",
  orgao: "Centro de Serviços Compartilhados",
  modalidade: "Pregão Eletrônico",
  encerramento: "23/09/2026 às 09:15",
};

const resumo = {
  identificacao: { numero: "413/2026", objeto: edital.objeto, modalidade: edital.modalidade },
  sessaoPublica: { data: "23/09/2026", horario: "09:30" },
  detalhes: { criterioJulgamento: "Menor preço por item" },
  documentosHabilitacao: ["Certidão negativa de débitos federais"],
  declaracoesExigidas: ["Declaração de habilitação"],
  resumoGeral: "Resumo operacional para conferência antes da proposta.",
};

test("gera um DOCX real com a estrutura operacional do checklist", () => {
  const arquivo = __test.montarDocx(edital, resumo);
  assert.equal(arquivo.subarray(0, 2).toString(), "PK");
  const zip = new AdmZip(arquivo);
  const documento = zip.readAsText("word/document.xml");
  assert.match(documento, /Checklist de Licitação/);
  assert.match(documento, /Declaração de habilitação/);
  assert.match(documento, /Certidão negativa de débitos federais/);
});
