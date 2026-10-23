const test = require("node:test");
const assert = require("node:assert/strict");
const defesa = require("../defesa-licitante");
const ponto = { titulo: "Conferir pagamento", pergunta: "Qual regra de pagamento prevalece?", evidencias: [{ documento: "TR.pdf", pagina: "14", numero: "7.17", texto: "Pagamento em 10 dias úteis." }] };
test("minuta referencia provas e pedidos sem inventar fundamento jurídico ou destinatário", () => {
  const r = defesa.prepararMinuta("esclarecimento", ponto, { orgao: "Município de Jutaí", numeroControlePNCP: "04285896000153-1-000061/2026", empresa: "Empresa Exemplo" });
  assert.match(r, /Pedido de esclarecimento/);
  assert.match(r, /TR.pdf.*14.*7.17/);
  assert.match(r, /Qual regra de pagamento prevalece/);
  assert.doesNotMatch(r, /ilegal|inconstitucional|jurisprudência pacífica/i);
  assert.throws(() => defesa.prepararMinuta("impugnacao", { evidencias: [] }, {}), /evidência/i);
});
test("impugnação fica editável com fundamento jurídico pendente, sem acusação automática", () => {
  const r = defesa.prepararMinuta("impugnacao", ponto, { orgao: "Órgão", numeroControlePNCP: "id", empresa: "Empresa" });
  assert.match(r, /Impugnação/);
  assert.match(r, /fundamentação jurídica.*revis/i);
  assert.throws(() => defesa.prepararMinuta("envio", ponto, {}), /Tipo/);
});
test("rascunhos privados têm chave distinta por usuário, empresa e edital e recusam contexto ausente", () => {
  const chave = defesa.chaveRascunho("usuarioA", "empresaA", "edital1");
  for (const args of [["usuarioB", "empresaA", "edital1"], ["usuarioA", "empresaB", "edital1"], ["usuarioA", "empresaA", "edital2"]]) assert.notEqual(defesa.chaveRascunho(...args), chave);
  assert.throws(() => defesa.chaveRascunho("", "empresaA", "edital1"), /conta|empresa/i);
});

test("minuta rejeita provas nulas, malformadas e conteúdo vazio", () => {
  for (const evidencias of [null, "fonte", {}, [], [null], ["trecho"], [{ documento: "Aviso.pdf", texto: "  " }], [{ documento: " ", texto: "Trecho" }], [{ documento: 123, texto: "Trecho" }]]) {
    assert.throws(() => defesa.prepararMinuta("esclarecimento", { evidencias }, {}), /evidência documental/);
  }
});
