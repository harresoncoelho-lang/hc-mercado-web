const test = require("node:test");
const assert = require("node:assert/strict");

process.env.MAX_DOSSIES_POR_EXECUCAO = "10";
process.env.VERSAO_DOSSIE = "7";
process.env.REPROCESSAR_PARCIAL_APOS_HORAS = "24";
const { prioridadeDoDossie, selecionarCandidatos } = require("./preparar_dossies_editais");

test("prioriza dossiês inéditos antes de qualquer reprocessamento", () => {
  assert.equal(prioridadeDoDossie({}, null), 0);
  assert.equal(prioridadeDoDossie({}, { versao: 6, status: "pronto" }), 1);
  assert.equal(prioridadeDoDossie({}, { versao: 7, status: "erro" }), 2);
});

test("não repete parcial recente e reprocessa parcial vencido", () => {
  const agora = Date.parse("2026-09-10T12:00:00Z");
  assert.equal(prioridadeDoDossie({}, { versao: 7, status: "parcial", atualizado_em: "2026-09-10T04:00:01Z" }, agora), null);
  assert.equal(prioridadeDoDossie({}, { versao: 7, status: "parcial", atualizado_em: "2026-09-09T11:59:59Z" }, agora), 3);
});

test("seleção ignora pronto atual e mantém a ordem de prioridade", () => {
  const registros = [
    { numeroControlePNCP: "pronto", publicacao: "2026-09-10T11:00:00Z" },
    { numeroControlePNCP: "antigo", publicacao: "2026-09-10T10:00:00Z" },
    { numeroControlePNCP: "novo", publicacao: "2026-09-10T09:00:00Z" },
  ];
  const dossies = new Map([
    ["pronto", { versao: 7, status: "pronto" }],
    ["antigo", { versao: 6, status: "pronto" }],
  ]);
  assert.deepEqual(selecionarCandidatos(registros, dossies).map((registro) => registro.numeroControlePNCP), ["novo", "antigo"]);
});
