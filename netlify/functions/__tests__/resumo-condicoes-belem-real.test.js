const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { conferirEvidenciasDoResumo } = require("../_resumo_evidencias");
const { localizarReferencia, paginasDaFonte } = require("../_edital_operacional");
const pasta = path.resolve(__dirname, "../../../docs/qa/editais-reais-novos/08928517000157-116");
const fonte = fs.readFileSync(path.join(pasta, "fonte-produto.txt"), "utf8");

test("referência sem sufixo técnico PNCP encontra aviso e mantém rejeição de ambiguidade", () => {
  const paginas = paginasDaFonte(fonte);
  assert.ok(localizarReferencia("Aviso de Contratação Direta, página 1", paginas));
  assert.equal(localizarReferencia("Aviso de Contratação Direta (#9), página 1", paginas), null);
  const duplicada = fonte + "\n--- Aviso de Contratacao Direta (#3) ---\n[Página 1]\nOutro aviso.";
  assert.equal(localizarReferencia("Aviso de Contratação Direta, página 1", paginasDaFonte(duplicada)), null);
});

test("saída Belém recupera condições operacionais omitidas pela síntese, sem aprovação de IA", () => {
  const estrutura = { detalhes: { preferenciaMeEpp: "Tratamento diferenciado ME/EPP" }, prazos: { vigenciaContrato: "Até final de 2026" }, analiseCritica: { previsaoReajuste: "IPCA após um ano" } };
  const r = conferirEvidenciasDoResumo({ textoEdital: fonte, estrutura }).estrutura;
  assert.match(r.identificacao.modalidade, /DISPENSA DE LICITAÇÃO/);
  assert.match(r.identificacao.numero, /DV00041\/2026/);
  assert.match(r.detalhes.preferenciaMeEpp, /preferencialmente apenas/);
  assert.match(r.detalhes.preferenciaMeEpp, /restrita.*participa[cç][aã]o/i);
  assert.match(r.analiseCritica.previsaoReajuste, /data do orçamento estimado/);
  assert.match(r.analiseCritica.previsaoReajuste, /obrigações iniciadas e concluídas após/);
  assert.match(r.prazos.vigenciaContrato, /podendo ser prorrogada/);
  assert.match(r.condicoesPagamento, /trinta dias, contados do período de adimplemento/);
  const complementos = r.outrasInformacoesRelevantes.join("\n");
  assert.match(complementos, /7\.4\..*sempre que solicitado/);
  assert.match(complementos, /7\.5\..*sede ou filial/);
  assert.match(complementos, /15\.1\..*desde que o Contratado não tenha concorrido/);
  assert.match(r.orgao.email, /licitacaobelem2024@gmail\.com/);
  assert.match(r.prazos.limiteEnvioPropostas, /22\s+de Outubro de 2026.*12:00/);
  assert.match(r.itens.observacoes, /UND 110/);
  assert.match(JSON.stringify(r.questionamentosDocumentais), /preferencialmente/);
  assert.doesNotMatch(JSON.stringify(r), /CAPAG|Belém\s*-\s*PA\b/);
  assert.notEqual(r.aprovado, true);
  assert.notEqual(r.aprovacaoIA, true);
});

