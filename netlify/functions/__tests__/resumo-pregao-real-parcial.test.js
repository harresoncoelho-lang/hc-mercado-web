const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { aplicarPrazosDaFonte, extrairRequisitosOperacionais } = require("../_edital_operacional");
const { conferirEvidenciasDoResumo } = require("../_resumo_evidencias");
const pasta = path.resolve(__dirname, "../../../docs/qa/editais-reais-novos/88124961000159-125");
const fonte = fs.readFileSync(path.join(pasta, "fonte-produto.txt"), "utf8");

test("prazo do interessado não incorpora resposta do órgão e pagamento conserva remissão", () => {
  const est = aplicarPrazosDaFonte({}, fonte);
  assert.match(est.prazos.limiteEsclarecimentos, /23\.6\..*03.*dias úteis anteriores/);
  assert.doesNotMatch(est.prazos.limiteEsclarecimentos, /23\.3\.|resposta à impugnação/);
  assert.match(est.prazos.limiteImpugnacao, /23\.1\..*3.*dias úteis antes/);
  assert.match(est.prazos.limiteImpugnacao, /23\.2\..*pregaobanrisul\.com\.br/);
  const r = conferirEvidenciasDoResumo({ textoEdital: fonte, estrutura: est }).estrutura;
  assert.match(r.condicoesPagamento, /22\.1\..*anexo III/);
  assert.doesNotMatch(r.condicoesPagamento, /30 dias|trinta dias|10 dias/);
});

test("menção interna a declaração não duplica toda habilitação jurídica como declaração", () => {
  const requisitos = extrairRequisitosOperacionais(fonte);
  assert.ok(requisitos.documentosHabilitacao.some(item => /11\.1\.1\. Habilitação Jurídica/.test(item)));
  assert.ok(!requisitos.declaracoesExigidas.some(item => /^11\.1\.1\. Habilitação Jurídica/.test(item)));
});
