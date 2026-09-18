const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const codigo = fs.readFileSync(path.join(__dirname, "atualizar_dados.js"), "utf8");
// Trecho de fila/rate limit: da 1ª constante do bloco até a função de coleta.
const inicio = codigo.indexOf("const JANELA_RETENTATIVA_UF_MS");
const fim = codigo.indexOf("\nasync function coletarOportunidadesAbertas", inicio);
const inicioColeta = codigo.indexOf("async function coletarOportunidadesAbertas(");
const fimColeta = codigo.indexOf("\n// ---------- Mercado", inicioColeta);
const UFS_TESTE = ["AM", "RR", "SP", "AC", "AL"];
const contexto = vm.createContext({ UFS: UFS_TESTE });
vm.runInContext(codigo.slice(inicio, fim), contexto);

test("recuperação inclui UF antiga, falha explícita e cobertura desconhecida (mais defasada primeiro)", () => {
  const existentes = {
    ufsComFalha: ["SP"],
    coberturaPorUf: {
      AM: { atualizadoEm: "2026-09-03T18:38:42Z" },
      RR: { atualizadoEm: "2026-09-11T12:00:00Z" },
      SP: { atualizadoEm: "2026-09-11T12:00:00Z" },
      AC: { atualizadoEm: "invalido" },
    },
  };
  // AC (data inválida) e AL (sem cobertura) contam como nunca coletadas: vêm primeiro, na ordem
  // de UFS; depois AM (a mais antiga) e SP. RR foi coletada hoje e fica de fora.
  assert.deepEqual(Array.from(contexto.ufsPendentesDeAtualizacao(existentes, new Date("2026-09-11T14:00:00Z"))), ["AC", "AL", "AM", "SP"]);
  assert.equal(existentes.coberturaPorUf.AM.atualizadoEm, "2026-09-03T18:38:42Z");
});

test("recuperação dispensa UFs coletadas no mesmo dia UTC", () => {
  const coberturaPorUf = Object.fromEntries(UFS_TESTE.map((uf) => [uf, { atualizadoEm: "2026-09-11T00:00:00Z" }]));
  assert.deepEqual(Array.from(contexto.ufsPendentesDeAtualizacao({ coberturaPorUf }, new Date("2026-09-11T23:59:00Z"))), []);
  assert.equal(contexto.ufsPendentesDeAtualizacao({ coberturaPorUf }, new Date("2026-09-12T00:00:00Z")).length, 5);
});

test("frescorMaxMs troca a regra 'coletada hoje' por 'mais velha que N horas'", () => {
  const agora = new Date("2026-09-11T14:00:00Z");
  const coberturaPorUf = {
    AM: { atualizadoEm: "2026-09-11T13:00:00Z" }, // 1h: fresca
    RR: { atualizadoEm: "2026-09-11T09:00:00Z" }, // 5h: pendente com limite de 3h
    SP: { atualizadoEm: "2026-09-11T10:30:00Z" }, // 3,5h: pendente
    AC: { atualizadoEm: "2026-09-11T13:30:00Z", completa: false, ultimoStatus: "parcial" }, // parcial mas fresca
    AL: { atualizadoEm: "2026-09-11T13:45:00Z" },
  };
  const pendentes = Array.from(contexto.ufsPendentesDeAtualizacao({ coberturaPorUf }, agora, { frescorMaxMs: 3 * 3600 * 1000 }));
  assert.deepEqual(pendentes, ["RR", "SP"]);
});

test("ufsPermitidas restringe a fila ao shard", () => {
  const pendentes = contexto.ufsPendentesDeAtualizacao({ coberturaPorUf: {} }, new Date("2026-09-11T14:00:00Z"), { ufsPermitidas: new Set(["SP", "AM"]) });
  assert.deepEqual(Array.from(pendentes), ["AM", "SP"]);
});

test("UF que falhou há pouco vai pro fim da fila, pra não monopolizar a cota", () => {
  const agora = Date.parse("2026-09-11T14:00:00Z");
  const cobertura = {
    AM: { atualizadoEm: "2026-09-01T00:00:00Z", ultimoStatus: "rate_limit", tentativaEm: "2026-09-11T13:50:00Z" }, // a mais velha, mas falhou há 10 min
    SP: { atualizadoEm: "2026-09-05T00:00:00Z" },
    AC: { atualizadoEm: "2026-09-04T00:00:00Z", ultimoStatus: "rate_limit", tentativaEm: "2026-09-11T10:00:00Z" }, // falhou há 4h: volta à fila normal
  };
  assert.deepEqual(Array.from(contexto.ordenarUfsPorDefasagem(["AM", "SP", "AC", "RR"], cobertura, agora)), ["RR", "AC", "SP", "AM"]);
});

test("retryAfterMs aceita segundos, data HTTP e lixo", () => {
  assert.equal(contexto.retryAfterMs("120"), 120000);
  assert.equal(contexto.retryAfterMs("Fri, 11 Sep 2026 14:01:00 GMT", Date.parse("2026-09-11T14:00:00Z")), 60000);
  assert.equal(contexto.retryAfterMs("Fri, 11 Sep 2026 13:00:00 GMT", Date.parse("2026-09-11T14:00:00Z")), 0);
  assert.equal(contexto.retryAfterMs("xpto"), 0);
  assert.equal(contexto.retryAfterMs(null), 0);
});

function ambienteDeFetch(respostas, extra = {}) {
  const chamadas = [];
  const ambiente = vm.createContext({
    UFS: UFS_TESTE,
    console: { log() {} },
    setTimeout, clearTimeout, AbortController,
    tempoRestanteMs: () => 600000,
    esperarComBackoff: async () => {},
    fetch: async (url) => { chamadas.push(url); const r = respostas.shift(); return typeof r === "function" ? r() : r; },
    ...extra,
  });
  vm.runInContext(codigo.slice(inicio, fim), ambiente);
  return { ambiente, chamadas };
}
const resposta = (status, corpo, headers = {}) => ({
  status, ok: status >= 200 && status < 300, body: null,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  text: async () => (corpo === undefined ? "" : JSON.stringify(corpo)),
});

test("429 pausa e tenta a MESMA página de novo; intervalo aumenta e cooldown reseta no sucesso", async () => {
  const { ambiente, chamadas } = ambienteDeFetch([resposta(429, undefined, { "retry-after": "0" }), resposta(200, { data: [{}], totalPaginas: 1 })]);
  const lim = ambiente.criarLimitadorPncp({ intervaloMs: 0, cooldownInicialMs: 1, cooldownMaxMs: 4 });
  const r = await ambiente.buscarPaginaPropostas("https://pncp/x", lim, { rotulo: "t" });
  assert.equal(chamadas.length, 2);
  assert.equal(r.dados.data.length, 1);
  assert.equal(lim.total429, 1);
  assert.equal(lim.esgotado, false);
  assert.equal(lim.cooldownMs, 1, "cooldown volta ao inicial depois do sucesso");
});

test("429 persistente devolve rate_limit e marca o limitador como esgotado", async () => {
  const respostas = Array.from({ length: 10 }, () => resposta(429));
  const { ambiente, chamadas } = ambienteDeFetch(respostas);
  const lim = ambiente.criarLimitadorPncp({ intervaloMs: 0, cooldownInicialMs: 1, cooldownMaxMs: 2 });
  const r = await ambiente.buscarPaginaPropostas("https://pncp/x", lim, { maxCiclos429: 2 });
  assert.equal(r.erro, "rate_limit");
  assert.equal(lim.esgotado, true);
  assert.equal(chamadas.length, 3, "1 tentativa + 2 ciclos de retentativa");
});

test("429 com pausa maior que o tempo restante desiste na hora, sem esperar", async () => {
  const { ambiente, chamadas } = ambienteDeFetch([resposta(429, undefined, { "retry-after": "3600" })], { tempoRestanteMs: () => 60000 });
  const lim = ambiente.criarLimitadorPncp({ intervaloMs: 0, cooldownInicialMs: 1 });
  const r = await ambiente.buscarPaginaPropostas("https://pncp/x", lim);
  assert.equal(r.erro, "rate_limit");
  assert.equal(chamadas.length, 1);
});

test("5xx repetido vira erro 'fonte'; 4xx vira 'http'; 204 vira página vazia", async () => {
  let { ambiente } = ambienteDeFetch([resposta(503), resposta(503)]);
  let lim = ambiente.criarLimitadorPncp({ intervaloMs: 0 });
  assert.equal((await ambiente.buscarPaginaPropostas("u", lim, { tentativas: 2 })).erro, "fonte");
  ({ ambiente } = ambienteDeFetch([resposta(404)]));
  lim = ambiente.criarLimitadorPncp({ intervaloMs: 0 });
  assert.equal((await ambiente.buscarPaginaPropostas("u", lim)).erro, "http");
  ({ ambiente } = ambienteDeFetch([resposta(204)]));
  lim = ambiente.criarLimitadorPncp({ intervaloMs: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify((await ambiente.buscarPaginaPropostas("u", lim)).dados)), { data: [], totalPaginas: 0, totalRegistros: 0 });
});

// Ambiente do coletor com busca de página injetada. `buscarPagina(url)` decide o que cada chamada devolve.
function ambienteDeColeta({ existentes, env = {}, ufs = ["AM", "RR"], restanteMs = 600000 }) {
  const ambiente = vm.createContext({
    UFS: ufs, RETENCAO_DIAS_OPORTUNIDADES: 120,
    process: { env: { CONCORRENCIA_UF_OPORTUNIDADES: "1", INTERVALO_MS_OPORTUNIDADES: "0", RECUPERAR_UFS_PENDENTES: "1", ...env } },
    console: { log() {} }, iniciarFase() {}, tempoRestanteMs: () => restanteMs,
    extrairAmparoLegal: () => null, extrairFonteOrcamentaria: () => null,
    lerJsonExistente: async () => existentes, fmtData: () => "20270911",
    setTimeout, clearTimeout, AbortController, esperarComBackoff: async () => {},
  });
  vm.runInContext(codigo.slice(inicio, fim) + codigo.slice(inicioColeta, fimColeta), ambiente);
  return ambiente;
}
const item = (n) => ({ numeroControlePNCP: `X-${n}`, objetoCompra: `obj ${n}`, orgaoEntidade: { razaoSocial: "Orgao" } });

test("recuperação mantém UF antiga não concluída como pendente", async () => {
  const existentes = { ufsComFalha: [], registros: [], coberturaPorUf: { AM: { atualizadoEm: "2026-09-03T00:00:00Z" } } };
  const chamadas = [];
  // 15000ms restantes: abaixo do mínimo pra 2ª passada (20000), como na versão original do teste.
  const ambiente = ambienteDeColeta({ existentes, restanteMs: 15000 });
  const resultado = await ambiente.coletarOportunidadesAbertas("ignorado", {
    buscarPagina: async (url) => { chamadas.push(url); return url.includes("uf=AM") ? { dados: { data: [], totalPaginas: 0 } } : { erro: "fonte" }; },
  });
  assert.equal(chamadas.length, 2);
  assert.match(chamadas[0], /uf=RR/, "RR nunca foi coletada: é a mais defasada e vem primeiro");
  assert.deepEqual(Array.from(resultado.ufsOkNaExecucao), ["AM"]);
  assert.deepEqual(Array.from(resultado.ufsComFalha), ["RR"]);
});

test("UFS_ALVO limita a coleta ao shard e FRESCOR_MAX_HORAS pula UF recém-coletada", async () => {
  const agoraIso = new Date().toISOString();
  const existentes = { registros: [], coberturaPorUf: { RR: { atualizadoEm: agoraIso }, SP: { atualizadoEm: "2020-01-01T00:00:00Z" } } };
  const chamadas = [];
  const ambiente = ambienteDeColeta({ existentes, ufs: ["AM", "RR", "SP", "AC"], env: { UFS_ALVO: "RR,SP,XX", FRESCOR_MAX_HORAS: "3", RECUPERAR_UFS_PENDENTES: "0" } });
  const resultado = await ambiente.coletarOportunidadesAbertas("ignorado", {
    buscarPagina: async (url) => { chamadas.push(url); return { dados: { data: [], totalPaginas: 0 } }; },
  });
  assert.equal(chamadas.length, 1);
  assert.match(chamadas[0], /uf=SP/);
  assert.deepEqual(Array.from(resultado.ufsOkNaExecucao), ["SP"]);
});

test("sem UF pendente devolve semPendencias sem chamar o PNCP", async () => {
  const agoraIso = new Date().toISOString();
  const existentes = { registros: [], coberturaPorUf: { AM: { atualizadoEm: agoraIso }, RR: { atualizadoEm: agoraIso } } };
  const ambiente = ambienteDeColeta({ existentes, env: { FRESCOR_MAX_HORAS: "3", RECUPERAR_UFS_PENDENTES: "0" } });
  const resultado = await ambiente.coletarOportunidadesAbertas("ignorado", { buscarPagina: async () => { throw new Error("não deveria chamar"); } });
  assert.equal(resultado.semPendencias, true);
});

test("teto de páginas marca a UF como parcial (completa=false) mas conta como coleta feita", async () => {
  const existentes = { registros: [], coberturaPorUf: {} };
  const gravacoes = [];
  const ambiente = ambienteDeColeta({ existentes, ufs: ["AM"], env: { MAX_PAGINAS_UF_OPORTUNIDADES: "2" } });
  const resultado = await ambiente.coletarOportunidadesAbertas("ignorado", {
    buscarPagina: async (url) => ({ dados: { data: [item(url.match(/pagina=(\d+)/)[1] + "a"), item(url.match(/pagina=(\d+)/)[1] + "b")], totalPaginas: 5, totalRegistros: 250 } }),
    aoConcluirUf: async (r) => { gravacoes.push(r); },
  });
  assert.equal(gravacoes.length, 1);
  assert.equal(gravacoes[0].status, "parcial");
  assert.equal(gravacoes[0].completa, false);
  assert.equal(gravacoes[0].totalApi, 250);
  assert.equal(gravacoes[0].registros.length, 4);
  assert.deepEqual(Array.from(resultado.ufsOkNaExecucao), ["AM"]);
  assert.equal(resultado.coberturaPorUf.AM.completa, false);
});

test("falha no meio da UF grava o que já foi lido, mas não avança a cobertura", async () => {
  const existentes = { registros: [], coberturaPorUf: { AM: { atualizadoEm: "2026-09-01T00:00:00Z" } } };
  const gravacoes = [];
  const ambiente = ambienteDeColeta({ existentes, ufs: ["AM"] });
  let paginas = 0;
  const resultado = await ambiente.coletarOportunidadesAbertas("ignorado", {
    buscarPagina: async () => (++paginas === 1 ? { dados: { data: [item(1), item(2)], totalPaginas: 3 } } : { erro: "rate_limit" }),
    aoConcluirUf: async (r) => { gravacoes.push(r); },
  });
  assert.equal(gravacoes.length, 1);
  assert.equal(gravacoes[0].status, "rate_limit");
  assert.equal(gravacoes[0].completa, false);
  assert.equal(gravacoes[0].registros.length, 2);
  assert.deepEqual(Array.from(resultado.ufsComFalha), ["AM"]);
  assert.equal(resultado.coberturaPorUf.AM.atualizadoEm, "2026-09-01T00:00:00Z", "cobertura em memória não avança");
});

test("falha ao gravar o checkpoint deixa a UF pendente", async () => {
  const ambiente = ambienteDeColeta({ existentes: { registros: [], coberturaPorUf: {} }, ufs: ["AM"] });
  const resultado = await ambiente.coletarOportunidadesAbertas("ignorado", {
    buscarPagina: async () => ({ dados: { data: [item(1)], totalPaginas: 1 } }),
    aoConcluirUf: async () => { throw new Error("HTTP 500"); },
  });
  assert.deepEqual(Array.from(resultado.ufsOkNaExecucao), []);
  assert.deepEqual(Array.from(resultado.ufsComFalha), ["AM"]);
  assert.equal(resultado.resumoPorUf.AM.status, "erro");
});

test("circuit breaker só conta indisponibilidade da fonte, não rate limit", async () => {
  const ufs = ["AM", "RR", "SP", "AC", "AL"];
  let chamadas = 0;
  let ambiente = ambienteDeColeta({ existentes: { registros: [], coberturaPorUf: {} }, ufs });
  await ambiente.coletarOportunidadesAbertas("ignorado", { buscarPagina: async () => { chamadas += 1; return { erro: "rate_limit" }; } });
  assert.equal(chamadas, ufs.length, "429 não aciona o breaker: todas as UFs são tentadas, e nenhuma é repetida na 2ª passada");

  chamadas = 0;
  ambiente = ambienteDeColeta({ existentes: { registros: [], coberturaPorUf: {} }, ufs });
  await ambiente.coletarOportunidadesAbertas("ignorado", { buscarPagina: async () => { chamadas += 1; return { erro: "fonte" }; } });
  assert.equal(chamadas, 3, "3 falhas de fonte antes do 1º sucesso acionam o breaker");
});

test("rate limit esgotado interrompe a fila: UFs restantes não são tentadas e continuam pendentes", async () => {
  const respostas = Array.from({ length: 50 }, () => resposta(429));
  const chamadasFetch = [];
  const ambiente = ambienteDeColeta({ existentes: { registros: [], coberturaPorUf: {} }, ufs: ["AM", "RR", "SP"], env: { COOLDOWN_429_MS_OPORTUNIDADES: "1", COOLDOWN_429_MAX_MS_OPORTUNIDADES: "2" } });
  ambiente.fetch = async (url) => { chamadasFetch.push(url); return respostas.shift(); };
  const gravacoes = [];
  const resultado = await ambiente.coletarOportunidadesAbertas("ignorado", { aoConcluirUf: async (r) => { gravacoes.push(r); } });
  assert.equal(chamadasFetch.length, 4, "1ª UF gasta 1 tentativa + 3 ciclos; as outras nem saem");
  assert.equal(gravacoes.length, 1, "só a UF tentada registra tentativa");
  assert.equal(gravacoes[0].status, "rate_limit");
  assert.deepEqual([...resultado.ufsComFalha].sort(), ["AM", "RR", "SP"]);
  assert.deepEqual(Array.from(resultado.ufsOkNaExecucao), []);
});

test("chaveOportunidade usa numeroControlePNCP quando existe, senão objeto+orgao+uf", () => {
  const inicioChave = codigo.indexOf("function chaveOportunidade(");
  const fimChave = codigo.indexOf("\n}", inicioChave) + 2;
  const ambiente = vm.createContext({});
  vm.runInContext(codigo.slice(inicioChave, fimChave), ambiente);
  assert.equal(ambiente.chaveOportunidade({ numeroControlePNCP: "123-1-000001/2026", objeto: "x", orgao: "y", uf: "AM" }), "123-1-000001/2026");
  assert.equal(ambiente.chaveOportunidade({ numeroControlePNCP: null, objeto: "Pregão", orgao: "Prefeitura", uf: "AM" }), "Pregão|Prefeitura|AM");
});

// ---- Checkpoint por UF no Supabase ----
function ambienteDeSupabase(upsert) {
  const ini = codigo.indexOf("function chaveOportunidade(");
  const fimBloco = codigo.indexOf("\nasync function main()", ini);
  const ambiente = vm.createContext({ UFS: UFS_TESTE, upsertEmLotes: upsert, console: { log() {} }, STATUS_DE_FALHA_POR_UF: new Set(["rate_limit", "fonte_indisponivel", "erro"]) });
  vm.runInContext(codigo.slice(ini, fimBloco), ambiente);
  return ambiente;
}
const reg = (n, extra = {}) => ({ numeroControlePNCP: `X-${n}`, objeto: `o${n}`, orgao: "org", uf: "AM", publicacao: "2026-09-18T10:00:00", encerramento: "2026-10-01T09:00:00", ...extra });

test("checkpoint deduplica chave repetida entre páginas e grava linhas ANTES da cobertura", async () => {
  const chamadas = [];
  const ambiente = ambienteDeSupabase(async (tabela, linhas, conflito) => { chamadas.push({ tabela, linhas: JSON.parse(JSON.stringify(linhas)), conflito }); return linhas.length; });
  await ambiente.sincronizarUfNoSupabase({ uf: "AM", registros: [reg(1), reg(2), reg(1, { objeto: "atualizado" })], totalApi: 3, completa: true, status: "ok", erro: null });
  assert.deepEqual(chamadas.map((c) => c.tabela), ["oportunidades_abertas", "oportunidades_cobertura"]);
  assert.equal(chamadas[0].linhas.length, 2, "X-1 aparece duas vezes e vira uma linha (a mais recente)");
  assert.equal(chamadas[0].linhas.find((l) => l.chave === "X-1").objeto, "atualizado");
  assert.equal(chamadas[0].linhas[0].publicacao, "2026-09-18");
  const cobertura = chamadas[1].linhas[0];
  assert.equal(chamadas[1].conflito, "uf");
  assert.equal(cobertura.uf, "AM");
  assert.equal(cobertura.ultimo_status, "ok");
  assert.equal(cobertura.completa, true);
  assert.equal(cobertura.total_api, 3);
  assert.ok(cobertura.atualizado_em, "sucesso avança atualizado_em");
  assert.equal(cobertura.registros, 3);
});

test("checkpoint de falha grava as linhas lidas mas NÃO avança atualizado_em", async () => {
  const chamadas = [];
  const ambiente = ambienteDeSupabase(async (tabela, linhas) => { chamadas.push({ tabela, linhas: JSON.parse(JSON.stringify(linhas)) }); });
  await ambiente.sincronizarUfNoSupabase({ uf: "AM", registros: [reg(1)], totalApi: null, completa: false, status: "rate_limit", erro: "429" });
  const cobertura = chamadas[1].linhas[0];
  assert.equal(cobertura.ultimo_status, "rate_limit");
  assert.equal(cobertura.ultimo_erro, "429");
  assert.equal("atualizado_em" in cobertura, false);
  assert.equal("registros" in cobertura, false);
  assert.ok(cobertura.tentativa_em);
});

test("se as linhas falham, a cobertura nem é tocada (UF continua pendente)", async () => {
  const tabelas = [];
  const ambiente = ambienteDeSupabase(async (tabela) => { tabelas.push(tabela); if (tabela === "oportunidades_abertas") throw new Error("HTTP 500"); });
  await assert.rejects(ambiente.sincronizarUfNoSupabase({ uf: "AM", registros: [reg(1)], completa: true, status: "ok" }), /HTTP 500/);
  assert.deepEqual(tabelas, ["oportunidades_abertas"]);
});

test("tabela de cobertura inexistente (404) não derruba a coleta; outros erros sim", async () => {
  let ambiente = ambienteDeSupabase(async (tabela) => { if (tabela === "oportunidades_cobertura") throw new Error("Supabase REST oportunidades_cobertura -> HTTP 404: PGRST205"); });
  await ambiente.sincronizarUfNoSupabase({ uf: "AM", registros: [], completa: true, status: "ok" });
  ambiente = ambienteDeSupabase(async (tabela) => { if (tabela === "oportunidades_cobertura") throw new Error("Supabase REST oportunidades_cobertura -> HTTP 500: boom"); });
  await assert.rejects(ambiente.sincronizarUfNoSupabase({ uf: "AM", registros: [], completa: true, status: "ok" }), /HTTP 500/);
});

test("metadado em blob é derivado da tabela de cobertura (atualizadoEm = a mais recente, falhas pelo status)", () => {
  const ambiente = ambienteDeSupabase(async () => {});
  const cobertura = {
    total: 3,
    coberturaPorUf: {
      AM: { atualizadoEm: "2026-09-18T10:00:00Z" },
      RR: { atualizadoEm: "2026-09-18T12:00:00Z" },
      SP: { atualizadoEm: null },
    },
    ufsComFalha: ["SP"],
  };
  const meta = ambiente.metaOportunidadesComCobertura({ retencaoDias: 120, atualizadoEm: "antigo" }, cobertura);
  assert.equal(meta.atualizadoEm, "2026-09-18T12:00:00.000Z");
  assert.deepEqual(Array.from(meta.ufsComFalha), ["SP"]);
  assert.deepEqual(Array.from(meta.ufsOk), ["AM", "RR", "AC", "AL"]);
  assert.equal(meta.retencaoDias, 120);
  assert.equal(ambiente.metaOportunidadesComCobertura({ x: 1 }, null).x, 1, "sem tabela devolve o metadado como veio");
});
