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

test("rodízio: começa em ponto aleatório da fila mais antiga-primeiro, sem furar prioridade", () => {
  const dia = { a: 1, b: 2, c: 3, d: 4 };
  const registros = ["d", "a", "c", "b"].map((id) => ({ numeroControlePNCP: id, publicacao: `2026-09-0${dia[id]}T00:00:00Z` }));
  const dossies = new Map([["x", { versao: V - 1 }]]);
  const comVersaoVelha = [...registros, { numeroControlePNCP: "x", publicacao: "2026-08-01T00:00:00Z" }];
  const ids = (aleatorio) => selecionarCandidatos(comVersaoVelha, dossies, Date.now(), () => aleatorio).map((r) => r.numeroControlePNCP);
  assert.deepEqual(ids(0), ["a", "b", "c", "d", "x"]);
  assert.deepEqual(ids(0.5), ["c", "d", "a", "b", "x"]);
  // Qualquer edital pode abrir a fila; nenhum fica preso no fim para sempre.
  assert.deepEqual(new Set([0, 0.25, 0.5, 0.75].map((v) => ids(v)[0])), new Set(["a", "b", "c", "d"]));
});
