const test = require("node:test");
const assert = require("node:assert/strict");

process.env.MAX_DOSSIES_POR_EXECUCAO = "10";
process.env.VERSAO_DOSSIE = "7";
process.env.REPROCESSAR_PARCIAL_APOS_HORAS = "24";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { prioridadeDoDossie, selecionarCandidatos, carregarRecentes } = require("./preparar_dossies_editais");

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

const reg = (n, publicacao) => ({ numeroControlePNCP: `X-${n}`, publicacao });

test("carrega as oportunidades recentes do Supabase em páginas, sem depender de arquivo local", async () => {
  const corte = Date.parse("2026-09-15T00:00:00Z");
  const urls = [];
  const paginas = [
    Array.from({ length: 1000 }, (_, i) => ({ dado: reg(i, "2026-09-18T10:00:00") })),
    [{ dado: reg("fim", "2026-09-16T10:00:00") }, { dado: reg("velho", "2026-09-01T10:00:00") }, { dado: { publicacao: "2026-09-17T10:00:00" } }],
  ];
  const buscar = async (url, opts) => { urls.push({ url, auth: opts.headers.Authorization }); return { ok: true, json: async () => paginas.shift() }; };
  const recentes = await carregarRecentes(corte, { chaveServico: "k", buscar, arquivo: "/nao/existe.json" });
  assert.equal(urls.length, 2);
  assert.match(urls[0].url, /publicacao=gte.2026-09-15/);
  assert.match(urls[1].url, /offset=1000/);
  assert.equal(urls[0].auth, "Bearer k");
  assert.equal(recentes.length, 1001, "descarta o edital velho e o sem numeroControlePNCP");
  assert.equal(recentes.at(-1).numeroControlePNCP, "X-fim", "ordenado do mais recente pro mais antigo");
});

test("sem chave de serviço ou com Supabase fora, usa o arquivo local; sem nenhum dos dois, falha claro", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dossies-"));
  const arquivo = path.join(dir, "oportunidades_abertas.json");
  fs.writeFileSync(arquivo, JSON.stringify({ registros: [reg("a", "2026-09-18T10:00:00")] }));
  const corte = Date.parse("2026-09-15T00:00:00Z");
  assert.equal((await carregarRecentes(corte, { chaveServico: "", arquivo })).length, 1);
  const falha = async () => ({ ok: false, status: 503 });
  assert.equal((await carregarRecentes(corte, { chaveServico: "k", buscar: falha, arquivo })).length, 1);
  await assert.rejects(carregarRecentes(corte, { chaveServico: "k", buscar: falha, arquivo: path.join(dir, "nao-existe.json") }), /sem oportunidades/);
  fs.rmSync(dir, { recursive: true });
});
