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
  fonteLida: true,
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
  assert.match(documento, /Resumo do Edital/);
  assert.match(documento, /Declaração de habilitação/);
  assert.match(documento, /Certidão negativa de débitos federais/);
});

test("checklist rejeita ficha PNCP, listas vazias e placeholders", () => {
  assert.equal(__test.podeGerarChecklist({}), false);
  assert.equal(__test.podeGerarChecklist({ ...resumo, fonteLida: false }), false);
  assert.equal(__test.podeGerarChecklist({ fonteLida: true, documentosHabilitacao: ["Não localizado no material lido", "Nenhum documento identificado"] }), false);
  assert.equal(__test.podeGerarChecklist({ fonteLida: true, documentosCredenciamento: ["Procuração — item 3.1"] }), true);
});

test("DOCX preserva requisitos extensos, referências, anexos e cobertura parcial", () => {
  const exigencia = `Apresentar procuração com poderes específicos e documentos do representante. ${"Condição expressa no edital. ".repeat(20)}[Edital (#1), página 12]`;
  const estrutura = {
    ...resumo, documentosCredenciamento: [exigencia], requisitosProposta: ["Anexar proposta assinada — item 5.3 [Edital (#1), página 16]"],
    anexosDeclaracoes: "Anexo IV — Modelo de declaração", modoDegradado: true,
    coberturaLeitura: { parcial: true, documentosLidos: ["Edital (#1)"], documentosNaoLidos: ["Termo de referência (#2)"], motivos: ["Anexo escaneado sem texto"] },
  };
  const documento = new AdmZip(__test.montarDocx(edital, estrutura)).readAsText("word/document.xml");
  assert.ok(documento.includes(exigencia));
  assert.match(documento, /Preparação e envio da proposta/);
  assert.match(documento, /Anexar proposta assinada/);
  assert.match(documento, /Anexo IV/);
  assert.match(documento, /Leitura parcial/);
  assert.match(documento, /Termo de referência \(#2\)/);
  assert.match(documento, /Anexo escaneado sem texto/);
});
