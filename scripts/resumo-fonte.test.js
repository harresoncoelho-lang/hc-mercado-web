const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const html = fs.readFileSync(require("node:path").join(__dirname, "../painel.html"), "utf8");
test("cobertura sem contagem de caracteres não declara envio integral à IA", () => {
  const modelo = require("../resumo-modelo");
  const resultado = modelo.montar({ coberturaSintese: { requisitosIdentificados: 2, requisitosSintetizados: 0 } });
  const cobertura = resultado.secoes.find(s => s.titulo === "Cobertura da análise");
  const texto = cobertura.campos.find(c => c.rotulo === "Síntese dos documentos").valor;
  assert.match(texto, /não confirmada/i);
  assert.doesNotMatch(texto, /undefined|integral enviada/);
});
test("enriquecimento PNCP não sobrescreve prazo documental e destaca divergência entre eventos", () => {
  const trecho = html.slice(html.indexOf("  function aplicarDadosOficiaisNaEstruturaIA("), html.indexOf("  function montarEstruturaContingenciaLocal("));
  const c = vm.createContext({}); vm.runInContext(trecho, c);
  const r = c.aplicarDadosOficiaisNaEstruturaIA({ prazosDocumentais: { proposta: "06/11/2026 às 08:00 [Edital, página 3]" }, prazos: { limiteEnvioPropostas: "06/11/2026 às 08:00 [Edital, página 3]" } }, { encerramento: "2026-11-06T09:00:00" });
  assert.match(r.prazos.limiteEnvioPropostas, /08:00/);
  assert.equal(r.dadosOficiais.prazoFinal, "2026-11-06T09:00:00");
  assert.match(r.pendenciasParaConferencia.join(" "), /PNCP/);
});
