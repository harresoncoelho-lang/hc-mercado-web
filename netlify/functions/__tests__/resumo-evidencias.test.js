const test = require("node:test");
const assert = require("node:assert/strict");
const { conferirEvidenciasDoResumo } = require("../_resumo_evidencias");

test("CRM-TO: remove certificado e falência sem fonte, preservando exigência técnica real", () => {
  const d = { textoEdital: "6.2. A habilitação será verificada por meio do Sicaf. 12.3. Atestado de capacidade técnica para gestão de estágios.", estrutura: {
    documentosCredenciamento: ["Credenciamento no Compras.gov.br com certificado digital (2.1)"],
    documentosHabilitacao: [{categoria:"Econômico-financeira",texto:"Ausência de falência e recuperação judicial no SICAF"}, {categoria:"Técnica",texto:"Atestado de capacidade técnica para gestão de estágios (12.3)"}]
  }};
  const r = conferirEvidenciasDoResumo(d);
  assert.deepEqual(r.estrutura.documentosCredenciamento, []);
  assert.equal(r.estrutura.documentosHabilitacao.length,1);
  assert.equal(r.validacaoExigencias.removidas.length,2);
  assert.equal(d.estrutura.documentosHabilitacao.length,2);
});

test("preserva exigências explicitamente presentes, inclusive acentos e quebras de linha", () => {
  const texto = "Apresentar CERTIFICADO\nDIGITAL. Certidão de falência e recuperação judicial.";
  const itens = ["Certificado digital", "Certidão de falência e recuperação judicial"];
  assert.deepEqual(conferirEvidenciasDoResumo({textoEdital:texto,estrutura:{documentosCredenciamento:itens}}).estrutura.documentosCredenciamento,itens);
});

test("sem texto oficial não apaga listas e não declara conferência", () => {
  const d={estrutura:{documentosCredenciamento:["Certificado digital"]}};
  assert.deepEqual(conferirEvidenciasDoResumo(d),d);
});

test("aviso do DOU legível não torna o edital integral", () => {
 const d={textoEdital:"Aviso de licitação",estrutura:{resumoGeral:"Apenas o aviso no DOU foi anexado.",coberturaLeitura:{parcial:false,documentosLidos:["edital.zip"],documentosNaoLidos:[]},pendenciasParaConferencia:[]}};
 const r=conferirEvidenciasDoResumo(d);
 assert.equal(r.estrutura.coberturaLeitura.parcial,true);
 assert.equal(r.estrutura.coberturaLeitura.editalIntegralAusente,true);
 assert.deepEqual(r.estrutura.coberturaLeitura.documentosLidos,["edital.zip"]);
 assert.deepEqual(conferirEvidenciasDoResumo(r),r);
});

test("aviso que acompanha edital completo não é rebaixado", () => {
 const d={textoEdital:"Edital e Termo de Referência",estrutura:{resumoGeral:"Aviso e edital completo lidos.",coberturaLeitura:{parcial:false,documentosLidos:["Edital.pdf","aviso.pdf"],documentosNaoLidos:[]}}};
 assert.equal(conferirEvidenciasDoResumo(d).estrutura.coberturaLeitura.parcial,false);
});
