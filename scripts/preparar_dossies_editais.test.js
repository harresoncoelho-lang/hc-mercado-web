const test = require("node:test");
const assert = require("node:assert/strict");

process.env.MAX_DOSSIES_POR_EXECUCAO = "10";
process.env.REPROCESSAR_PARCIAL_APOS_HORAS = "24";
const { VERSAO_DOSSIE, prioridadeDoDossie, selecionarCandidatos } = require("./preparar_dossies_editais");
const V = VERSAO_DOSSIE;

test("versão do dossiê é a mesma VERSAO_RESUMO da Function", () => {
  const fonte = require("fs").readFileSync(require("path").join(__dirname, "../netlify/functions/lib/ia-edital.js"), "utf8");
  assert.ok(fonte.includes(`const VERSAO_RESUMO = ${V};`));
});

test("prioriza dossiês inéditos antes de qualquer reprocessamento", () => {
  assert.equal(prioridadeDoDossie({}, null), 0);
  assert.equal(prioridadeDoDossie({}, { versao: V - 1, status: "pronto" }), 1);
  assert.equal(prioridadeDoDossie({}, { versao: V, status: "erro" }), 2);
});

test("não repete parcial recente e reprocessa parcial vencido", () => {
  const agora = Date.parse("2026-09-10T12:00:00Z");
  assert.equal(prioridadeDoDossie({}, { versao: V, status: "parcial", atualizado_em: "2026-09-10T04:00:01Z" }, agora), null);
  assert.equal(prioridadeDoDossie({}, { versao: V, status: "parcial", atualizado_em: "2026-09-09T11:59:59Z" }, agora), 3);
});

test("seleção ignora pronto atual e mantém a ordem de prioridade", () => {
  const registros = [
    { numeroControlePNCP: "pronto", publicacao: "2026-09-10T11:00:00Z" },
    { numeroControlePNCP: "antigo", publicacao: "2026-09-10T10:00:00Z" },
    { numeroControlePNCP: "novo", publicacao: "2026-09-10T09:00:00Z" },
  ];
  const dossies = new Map([
    ["pronto", { versao: V, status: "pronto" }],
    ["antigo", { versao: V - 1, status: "pronto" }],
  ]);
  assert.deepEqual(selecionarCandidatos(registros, dossies).map((registro) => registro.numeroControlePNCP), ["novo", "antigo"]);
});
