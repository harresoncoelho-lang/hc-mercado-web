const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const codigo = fs.readFileSync(path.join(__dirname, "atualizar_dados.js"), "utf8");
const inicio = codigo.indexOf("function ufsPendentesDeAtualizacao(");
const fim = codigo.indexOf("\nasync function coletarOportunidadesAbertas", inicio);
const contexto = vm.createContext({ UFS: ["AM", "RR", "SP", "AC", "AL"] });
vm.runInContext(codigo.slice(inicio, fim), contexto);

test("recuperação inclui UF antiga, falha explícita e cobertura desconhecida", () => {
  const existentes = {
    ufsComFalha: ["SP"],
    coberturaPorUf: {
      AM: { atualizadoEm: "2026-09-03T18:38:42Z" },
      RR: { atualizadoEm: "2026-09-11T12:00:00Z" },
      SP: { atualizadoEm: "2026-09-11T12:00:00Z" },
      AC: { atualizadoEm: "invalido" },
    },
  };
  assert.deepEqual(Array.from(contexto.ufsPendentesDeAtualizacao(existentes, new Date("2026-09-11T14:00:00Z"))), ["AM", "SP", "AC", "AL"]);
  assert.equal(existentes.coberturaPorUf.AM.atualizadoEm, "2026-09-03T18:38:42Z");
});

test("recuperação dispensa UFs coletadas no mesmo dia UTC", () => {
  const coberturaPorUf = Object.fromEntries(["AM", "RR", "SP", "AC", "AL"].map((uf) => [uf, { atualizadoEm: "2026-09-11T00:00:00Z" }]));
  assert.deepEqual(Array.from(contexto.ufsPendentesDeAtualizacao({ coberturaPorUf }, new Date("2026-09-11T23:59:00Z"))), []);
  assert.equal(contexto.ufsPendentesDeAtualizacao({ coberturaPorUf }, new Date("2026-09-12T00:00:00Z")).length, 5);
});

test("recuperação mantém UF antiga não concluída como pendente", async () => {
  const inicioColeta = codigo.indexOf("async function coletarOportunidadesAbertas(");
  const fimColeta = codigo.indexOf("\n// O painel não deve", inicioColeta);
  const existentes = { ufsComFalha: [], registros: [], coberturaPorUf: { AM: { atualizadoEm: "2026-09-03T00:00:00Z" } } };
  const chamadas = [];
  const ambiente = vm.createContext({
    UFS: ["AM", "RR"], RETENCAO_DIAS_OPORTUNIDADES: 120,
    process: { env: { RECUPERAR_UFS_PENDENTES: "1", CONCORRENCIA_UF_OPORTUNIDADES: "1", INTERVALO_MS_OPORTUNIDADES: "0" } },
    console: { log() {} }, iniciarFase() {}, tempoRestanteMs: () => 15000,
    lerJsonExistente: async () => existentes, fmtData: () => "20270911",
    fetchComRetentativa: async (url) => { chamadas.push(url); return url.includes("uf=AM") ? { data: [], totalPaginas: 0 } : null; },
  });
  vm.runInContext(codigo.slice(inicio, fim) + codigo.slice(inicioColeta, fimColeta), ambiente);
  const resultado = await ambiente.coletarOportunidadesAbertas("ignorado");
  assert.equal(chamadas.length, 2);
  assert.deepEqual(Array.from(resultado.ufsOkNaExecucao), ["AM"]);
  assert.deepEqual(Array.from(resultado.ufsComFalha), ["RR"]);
});

test("projeção usa frescor da UF e deixa cobertura desconhecida como null", async () => {
  const inicioProjecao = codigo.indexOf("async function gravarBoletinsPorUf(");
  const fimProjecao = codigo.indexOf("\n// ---------- Mercado", inicioProjecao);
  const ambiente = vm.createContext({ UFS: ["AM", "RR"] });
  vm.runInContext(codigo.slice(inicioProjecao, fimProjecao), ambiente);
  const gravados = {};
  await ambiente.gravarBoletinsPorUf({ mkdir: async () => {}, writeFile: async (arquivo, texto) => { gravados[path.basename(arquivo)] = JSON.parse(texto); } }, path, "temporario", {
    atualizadoEm: "2026-09-06T11:20:12Z", coberturaPorUf: { AM: { atualizadoEm: "2026-09-03T18:38:42Z" } }, registros: [],
  });
  assert.equal(gravados["AM.json"].atualizadoEm, "2026-09-03T18:38:42Z");
  assert.equal(gravados["RR.json"].atualizadoEm, null);
});
