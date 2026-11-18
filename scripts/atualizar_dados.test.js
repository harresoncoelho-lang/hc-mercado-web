const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const codigo = fs.readFileSync(path.join(__dirname, "atualizar_dados.js"), "utf8").replace(/\r\n/g, "\n");
const inicioHash = codigo.indexOf("function hashProgressoAtas(");
const hashProgressoAtas = vm.runInNewContext(codigo.slice(inicioHash, codigo.indexOf("\n}\n", inicioHash) + 2) + "; hashProgressoAtas", { require });
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

test("recuperação dispensa UFs coletadas nas últimas 6 horas", () => {
  const coberturaPorUf = Object.fromEntries(["AM", "RR", "SP", "AC", "AL"].map((uf) => [uf, { atualizadoEm: "2026-09-11T20:00:00Z" }]));
  assert.deepEqual(Array.from(contexto.ufsPendentesDeAtualizacao({ coberturaPorUf }, new Date("2026-09-12T01:59:00Z"))), []);
  assert.equal(contexto.ufsPendentesDeAtualizacao({ coberturaPorUf }, new Date("2026-09-12T02:00:00Z")).length, 5);
});

test("recuperação mantém UF antiga não concluída como pendente", async () => {
  const inicioColeta = codigo.indexOf("async function coletarOportunidadesAbertas(");
  const fimColeta = codigo.indexOf("\n// ---------- Mercado", inicioColeta);
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

test("chaveOportunidade usa numeroControlePNCP quando existe, senão objeto+orgao+uf", () => {
  const inicioChave = codigo.indexOf("function chaveOportunidade(");
  const fimChave = codigo.indexOf("\n}", inicioChave) + 2;
  const ambiente = vm.createContext({});
  vm.runInContext(codigo.slice(inicioChave, fimChave), ambiente);
  assert.equal(ambiente.chaveOportunidade({ numeroControlePNCP: "123-1-000001/2026", objeto: "x", orgao: "y", uf: "AM" }), "123-1-000001/2026");
  assert.equal(ambiente.chaveOportunidade({ numeroControlePNCP: null, objeto: "Pregão", orgao: "Prefeitura", uf: "AM" }), "Pregão|Prefeitura|AM");
});

test("prazo PNCP permanece ativo durante leitura do corpo e é limpo após falha", async () => {
  let timer;
  let chamadas = 0;
  let limpezas = 0;
  const ambiente = vm.createContext({
    AbortController,
    console: { log() {} },
    esperarComBackoff: async () => {},
    setTimeout: (callback) => { timer = { callback, ativo: true }; return timer; },
    clearTimeout: (referencia) => { referencia.ativo = false; limpezas += 1; },
    fetch: async (_url, { signal }) => {
      chamadas += 1;
      return { ok: true, status: 200, text: async () => {
        if (timer.ativo) timer.callback(); // O corpo só chega depois do prazo.
        if (signal.aborted) { const erro = new Error("corpo atrasado"); erro.name = "AbortError"; throw erro; }
        return '{"resultado":"atrasado"}';
      } };
    },
  });
  vm.runInContext(codigo.slice(codigo.indexOf("async function fetchComRetentativa("), codigo.indexOf("async function lerJsonExistente(")), ambiente);
  assert.equal(await ambiente.fetchComRetentativa("https://exemplo.invalid", 2, 100), null);
  assert.equal(chamadas, 2);
  assert.equal(limpezas, 2);
});

function ambienteMain(falharEm) {
  const eventos = [];
  const arquivos = new Map([["data/contratos_meta.json", "anterior"], ["data/mercado_meta.json", "anterior"]]);
  const ambiente = vm.createContext({
    process: { env: {}, cwd: () => "." }, UFS: ["AM"], RETENCAO_DIAS: 730, hashProgressoAtas,
    console: { log() {}, warn() {} }, iniciarFase() {}, LIMITE_MINUTOS_CONTRATOS: 1, LIMITE_MINUTOS_MERCADO: 1,
    fsTeste: { mkdir: async () => {}, rename: async (origem, destino) => { eventos.push(destino); arquivos.set(destino, arquivos.get(origem)); arquivos.delete(origem); }, writeFile: async (nome, dado) => { eventos.push(nome); arquivos.set(nome, dado); } },
    pathTeste: { join: (...partes) => partes.filter((p) => p !== ".").join("/") },
    hidratarContratosDoSupabase: async () => {}, hidratarMercadoDoSupabase: async () => {}, hidratarOportunidadesDoSupabase: async () => {},
    coletarContratos: async () => ({ registros: [], dataFinal: "novo" }),
    coletarMercadoSegmentos: async () => ({ atas: [], janelasPendentes: [] }),
    coletarOportunidadesAbertas: async () => ({ registros: [], ufsComFalha: [], ufsOkNaExecucao: ["AM"] }),
    ...Object.fromEntries(["sincronizarContratosNoSupabase", "sincronizarMercadoNoSupabase", "sincronizarOportunidadesNoSupabase"].map((nome) => [nome, async () => { eventos.push(nome); if (falharEm === nome) throw new Error("timeout simulado"); }])),
    salvarBlob: async (_tabela, chave) => { eventos.push(chave); if (falharEm === "salvarBlob" && chave === "oportunidades_meta") throw new Error("timeout simulado"); },
  });
  const fonte = codigo.slice(codigo.indexOf("async function main()"), codigo.indexOf("\nmodule.exports ="))
    .replace('await import("node:fs/promises")', "fsTeste").replace('await import("node:path")', "pathTeste");
  vm.runInContext(fonte, ambiente);
  return { ambiente, eventos, arquivos };
}

for (const etapa of ["Contratos", "Mercado", "Oportunidades"]) {
  test(`falha na persistência de ${etapa} rejeita e preserva checkpoint/base local`, async () => {
    const { ambiente, arquivos, eventos } = ambienteMain(`sincronizar${etapa}NoSupabase`);
    await assert.rejects(ambiente.main(), /timeout simulado/);
    const nome = etapa === "Contratos" ? "contratos" : etapa === "Mercado" ? "mercado" : "oportunidades";
    if (etapa !== "Oportunidades") assert.equal(arquivos.get(`data/${nome}_meta.json`), "anterior");
    else assert.ok(!eventos.includes("oportunidades_meta"));
    assert.ok(!eventos.includes(`data/${nome === "contratos" ? "contratos_recentes" : nome === "mercado" ? "mercado_segmentos" : "oportunidades_abertas"}.json`));
  });
}

test("metadado remoto com falha rejeita execução e mantém base local anterior", async () => {
  const { ambiente, eventos } = ambienteMain("salvarBlob");
  await assert.rejects(ambiente.main(), /timeout simulado/);
  assert.ok(!eventos.includes("data/oportunidades_abertas.json"));
});

test("sucesso confirma linhas antes dos checkpoints e arquivos locais", async () => {
  const { ambiente, eventos } = ambienteMain();
  await ambiente.main();
  assert.ok(eventos.indexOf("sincronizarContratosNoSupabase") < eventos.indexOf("data/contratos_meta.json"));
  assert.ok(eventos.indexOf("sincronizarMercadoNoSupabase") < eventos.indexOf("data/mercado_meta.json"));
  assert.ok(eventos.indexOf("oportunidades_meta") < eventos.indexOf("data/oportunidades_abertas.json"));
});

test("página nacional perdida mantém coleta parcial", async () => {
  const ambiente = vm.createContext({ tempoRestanteMs: () => 60000, fetchComRetentativa: async () => null });
  vm.runInContext(codigo.slice(codigo.indexOf("async function buscarPaginasEmLote"), codigo.indexOf("// ---------- Coleta complementar")), ambiente);
  const resultado = await ambiente.buscarPaginasEmLote(() => "simulado", 1, 2, 1, () => {});
  assert.equal(resultado.parcial, true);
});

test("scan nacional retoma páginas e invalida cursor de uma fonte alterada", async () => {
  let restante = 60000;
  let alterar = false;
  const paginas = [];
  const ambiente = vm.createContext({ tempoRestanteMs: () => restante,
    fetchComRetentativa: async (url) => {
      const numero = Number(url.split("=")[1]);
      if (numero === 2) restante = 0;
      return { numeroPagina: numero, totalPaginas: 3, totalRegistros: 3,
        data: [{ numeroControlePNCP: `${alterar ? "novo" : "contrato"}-${numero}` }] };
    },
  });
  vm.runInContext(codigo.slice(codigo.indexOf("async function buscarPaginasEmLote"), codigo.indexOf("// ---------- Coleta complementar")), ambiente);
  const coletar = (cursor) => ambiente.buscarPaginasEmLote((p) => `pagina=${p}`, 1, 1, 1,
    (_dado, numero) => paginas.push(numero), cursor);
  const parcial = await coletar();
  assert.equal(parcial.parcial, true);
  parcial.progresso.iniciadoEm = new Date(Date.now() - 24 * 3600000).toISOString();
  restante = 60000;
  paginas.length = 0;
  const concluida = await coletar(JSON.parse(JSON.stringify(parcial.progresso || null)));
  assert.equal(concluida.parcial, false);
  assert.deepEqual(paginas, [3]);
  restante = 60000;
  alterar = true;
  paginas.length = 0;
  const alterada = await coletar(parcial.progresso);
  assert.equal(alterada.parcial, true);
  assert.deepEqual(paginas, [1, 2]);
});

for (const nome of ["sincronizarContratosNoSupabase", "sincronizarMercadoNoSupabase"]) {
  test(`${nome} propaga falha após lote parcial`, async () => {
    const ambiente = vm.createContext({ upsertEmLotes: async () => { throw new Error("lote 2 falhou"); }, console: { log() {} }, RETENCAO_DIAS: 730 });
    const inicioFuncao = codigo.indexOf(`async function ${nome}(`);
    const fimFuncao = codigo.indexOf("\n}\n", inicioFuncao) + 2;
    vm.runInContext(codigo.slice(inicioFuncao, fimFuncao), ambiente);
    await assert.rejects(ambiente[nome]({ registros: [], novosNaExecucao: [], atas: [] }), /lote 2 falhou/);
  });
}


function ambienteOportunidades(existentes, buscar, tempo = () => 15000) {
  const ambiente = vm.createContext({
    UFS: ["AM"], RETENCAO_DIAS_OPORTUNIDADES: 120,
    process: { env: { INTERVALO_MS_OPORTUNIDADES: "0" } }, console: { log() {} },
    iniciarFase() {}, tempoRestanteMs: tempo, URL,
    lerJsonExistente: async () => existentes,
    fmtData: () => "20271028", fetchComRetentativa: buscar,
    extrairAmparoLegal: () => null, extrairFonteOrcamentaria: () => null,
  });
  vm.runInContext(codigo.slice(inicio, codigo.indexOf("\n// ---------- Mercado", inicio)), ambiente);
  return ambiente;
}

function paginaOportunidades(numero, prefixo = "edital") {
  return { numeroPagina: numero, totalPaginas: 23, totalRegistros: 23,
    data: [{ numeroControlePNCP: `${prefixo}-${numero}`, objetoCompra: `Objeto ${numero}` }] };
}

test("oportunidades coleta além de 20 páginas antes de confirmar a UF", async () => {
  const ambiente = ambienteOportunidades(null, async (url) => paginaOportunidades(Number(new URL(url).searchParams.get("pagina"))));
  const resultado = await ambiente.coletarOportunidadesAbertas("ignorado");
  assert.equal(resultado.registros.length, 23);
  assert.equal(resultado.registros.at(-1).numeroControlePNCP, "edital-23");
  assert.deepEqual(Array.from(resultado.ufsComFalha), []);
  assert.equal(resultado.coberturaPorUf.AM.registrosColetados, 23);
});

for (const mudou of [false, true]) {
  test(`oportunidades ${mudou ? "invalida cursor quando fonte muda" : "retoma após orçamento sem perder páginas"}`, async () => {
    let restante = 15000;
    const antigo = { registros: [], coberturaPorUf: { AM: { atualizadoEm: "2020-01-01" } } };
    const primeira = ambienteOportunidades(antigo, async (url) => {
      const numero = Number(new URL(url).searchParams.get("pagina"));
      if (numero === 20) restante = 0;
      return paginaOportunidades(numero);
    }, () => restante);
    const parcial = await primeira.coletarOportunidadesAbertas("ignorado");
    assert.deepEqual(Array.from(parcial.ufsComFalha), ["AM"]);
    assert.equal(parcial.coberturaPorUf.AM.atualizadoEm, "2020-01-01");
    const paginas = [];
    const segunda = ambienteOportunidades(JSON.parse(JSON.stringify(parcial)), async (url) => {
      const numero = Number(new URL(url).searchParams.get("pagina"));
      paginas.push(numero);
      return paginaOportunidades(numero, mudou ? "novo" : "edital");
    });
    const concluida = await segunda.coletarOportunidadesAbertas("ignorado");
    assert.equal(concluida.coberturaPorUf.AM.registrosColetados, 23);
    assert.deepEqual(Array.from(concluida.ufsComFalha), []);
    if (mudou) assert.equal(concluida.registros.filter((r) => r.numeroControlePNCP.startsWith("novo-")).length, 23);
    else assert.deepEqual(paginas, [1, 21, 22, 23, 1]);
  });
}

test("oportunidades não confirma UF se a fonte mudar durante a paginação", async () => {
  let primeiras = 0;
  const ambiente = ambienteOportunidades(null, async (url) => {
    const numero = Number(new URL(url).searchParams.get("pagina"));
    if (numero === 1) primeiras++;
    return paginaOportunidades(numero, primeiras > 1 ? "alterado" : "edital");
  });
  const resultado = await ambiente.coletarOportunidadesAbertas("ignorado");
  assert.deepEqual(Array.from(resultado.ufsComFalha), ["AM"]);
  assert.equal(resultado.coberturaPorUf.AM, undefined);
});

class DataRetencaoFixa extends Date {
  constructor(valor) { super(arguments.length ? valor : "2026-10-28T12:00:00Z"); }
  static now() { return Date.parse("2026-10-28T12:00:00Z"); }
}

test("retenção preserva edital antigo aberto, encerrado recente e data desconhecida do cache e PNCP", async () => {
  const registro = (id, encerramento) => ({ numeroControlePNCP: id, publicacao: "2023-01-01", encerramento });
  const ambiente = vm.createContext({
    Date: DataRetencaoFixa, UFS: ["AM"], RETENCAO_DIAS_OPORTUNIDADES: 120,
    process: { env: { INTERVALO_MS_OPORTUNIDADES: "0" } }, console: { log() {} },
    iniciarFase() {}, tempoRestanteMs: () => 15000, fmtData: () => "20271028",
    lerJsonExistente: async () => ({ registros: [
      registro("aberto-cache", "2027-01-01"), registro("encerrado-antigo", "2026-01-01"),
      registro("encerrado-recente", "2026-10-20"), registro("sem-data", null), registro("data-invalida", "2026-02-30"),
      registro("dia-limite", "2026-06-30T00:00:00Z"), registro("antes-limite", "2026-06-29T23:59:00Z"),
    ] }),
    fetchComRetentativa: async () => ({ totalPaginas: 1, data: [{ numeroControlePNCP: "aberto-pncp", dataPublicacaoPncp: "2023-01-01", dataEncerramentoProposta: "2027-01-01" }] }),
    extrairAmparoLegal: () => null, extrairFonteOrcamentaria: () => null,
  });
  vm.runInContext(codigo.slice(inicio, codigo.indexOf("\n// ---------- Mercado", inicio)), ambiente);
  const resultado = await ambiente.coletarOportunidadesAbertas("ignorado");
  assert.deepEqual(Array.from(resultado.registros, (r) => r.numeroControlePNCP).sort(),
    ["aberto-cache", "aberto-pncp", "data-invalida", "dia-limite", "encerrado-recente", "sem-data"]);
});

test("persistência poda pela data de encerramento e preserva encerramento desconhecido como null", async () => {
  let linhas;
  let poda;
  const ambiente = vm.createContext({
    Date: DataRetencaoFixa, RETENCAO_DIAS_OPORTUNIDADES: 120, console: { log() {} },
    chaveOportunidade: (r) => r.numeroControlePNCP,
    upsertEmLotes: async (_tabela, valores) => { linhas = valores; return valores.length; },
    removerMaisAntigosQue: async (...args) => { poda = args; },
  });
  const inicioSync = codigo.indexOf("async function sincronizarOportunidadesNoSupabase(");
  const fonteData = codigo.slice(codigo.indexOf("function dataEncerramentoIso("), codigo.indexOf("async function coletarOportunidadesAbertas("));
  vm.runInContext(fonteData + codigo.slice(inicioSync, codigo.indexOf("\n}\n", inicioSync) + 2), ambiente);
  await ambiente.sincronizarOportunidadesNoSupabase({ registros: [
    { numeroControlePNCP: "aberto", publicacao: "2023-01-01", encerramento: "2027-01-01T10:00:00-03:00" },
    { numeroControlePNCP: "sem-data", publicacao: "2023-01-01", encerramento: null },
    { numeroControlePNCP: "invalida", publicacao: "2023-01-01", encerramento: "2026-02-30" },
  ] });
  assert.deepEqual(poda, ["oportunidades_abertas", "encerramento", "2026-06-30"]);
  assert.deepEqual(Array.from(linhas, (r) => r.encerramento), ["2027-01-01", null, null]);
  assert.equal(linhas[2].dado.encerramento, "2026-02-30");
});

test("contratos parciais preservam cursor e contratos anteriores", async () => {
  const ambiente = vm.createContext({
    lerJsonExistente: async () => ({ registros: [{ numeroControlePNCP: "antigo" }], dataFinal: "20261001" }),
    DIAS_HISTORICO_INICIAL: 30, FOLGA_DIAS: 2, RETENCAO_DIAS: 730, TAMANHO_PAGINA: 100, CONCORRENCIA_PAGINAS: 1,
    fmtData: (d) => d.toISOString().slice(0, 10).replace(/-/g, ""),
    buscarPaginasEmLote: async () => ({ parcial: true, paginasVarridas: 1, totalPaginas: 2 }),
    UFS: ["AM"], coletarContratosComplementarPorUf: async () => ({ registros: [], ufsComFalha: [] }), chaveRegistro: (r) => r.numeroControlePNCP,
    console: { log() {} },
  });
  vm.runInContext(codigo.slice(codigo.indexOf("async function coletarContratos("), codigo.indexOf("// ---------- Oportunidades")), ambiente);
  const resultado = await ambiente.coletarContratos("ignorado");
  assert.equal(resultado.dataFinal, "20261001");
  assert.equal(resultado.registros[0].numeroControlePNCP, "antigo");
});

test("cobertura parcial não termina com sucesso verde após persistir dados úteis", async () => {
  const { ambiente, eventos } = ambienteMain();
  ambiente.coletarOportunidadesAbertas = async () => ({ registros: [], ufsComFalha: ["AM"], ufsOkNaExecucao: [] });
  await assert.rejects(ambiente.main(), /cobertura.*AM/i);
  assert.ok(eventos.includes("oportunidades_meta"));
});

for (const tipo of ["Contratos", "Mercado", "Oportunidades"]) {
  test(`falha de hidratação de ${tipo} não permite coleta sem base íntegra`, async () => {
    const nome = `hidratar${tipo}DoSupabase`;
    const comeco = codigo.indexOf(`async function ${nome}(`);
    const final = codigo.indexOf("\n}\n", comeco) + 2;
    const ambiente = vm.createContext({
      lerJsonExistente: async () => ({ dataFinal: "20261001" }),
      buscarBlob: async () => { throw new Error("leitura falhou"); },
      baixarTodasAsLinhas: async () => { throw new Error("leitura falhou"); },
      console: { log() {} },
    });
    vm.runInContext(codigo.slice(comeco, final), ambiente);
    await assert.rejects(ambiente[nome]("ignorado", "ignorado"), /leitura falhou/);
  });
}

test("contratos complementares sem orçamento deixam todas UFs pendentes", async () => {
  const ambiente = vm.createContext({ UFS: ["AM", "SP"], iniciarFase() {}, LIMITE_MINUTOS_CONTRATOS_UF: 1,
    contarRegistrosPorUf: () => new Map([["AM", 0], ["SP", 0]]), CONCORRENCIA_UF_CONTRATOS: 1,
    tempoRestanteMs: () => 0, console: { log() {} },
  });
  vm.runInContext(codigo.slice(codigo.indexOf("async function coletarContratosComplementarPorUf("), codigo.indexOf("// ---------- Contratos históricos")), ambiente);
  const resultado = await ambiente.coletarContratosComplementarPorUf([]);
  assert.deepEqual(Array.from(resultado.ufsComFalha), ["AM", "SP"]);
});

test("contratos complementares retomam além da sexta página", async () => {
  let restante = 60000;
  const paginas = [];
  const conhecidos = Array.from({ length: 301 }, (_, i) => ({ numeroControlePNCP: `contrato-${i + 1}` }));
  const ambiente = vm.createContext({ UFS: ["AM"], URLSearchParams, iniciarFase() {}, LIMITE_MINUTOS_CONTRATOS_UF: 1,
    contarRegistrosPorUf: () => new Map([["AM", 301]]), CONCORRENCIA_UF_CONTRATOS: 1, MAX_PAGINAS_POR_UF_CONTRATOS: 6,
    tempoRestanteMs: () => restante, console: { log() {} },
    fetchComRetentativa: async (url) => {
      const pagina = Number(new URL(url).searchParams.get("pagina"));
      paginas.push(pagina);
      return { total: 301, items: Array.from({ length: pagina === 7 ? 1 : 50 }, (_, i) => ({ numero_controle_pncp: `contrato-${(pagina - 1) * 50 + i + 1}` })) };
    },
  });
  vm.runInContext(codigo.slice(codigo.indexOf("async function coletarContratosComplementarPorUf("), codigo.indexOf("// ---------- Contratos históricos")), ambiente);
  const primeira = await ambiente.coletarContratosComplementarPorUf(conhecidos);
  assert.deepEqual(Array.from(primeira.ufsComFalha), ["AM"]);
  paginas.length = 0;
  restante = 60000;
  const segunda = await ambiente.coletarContratosComplementarPorUf(conhecidos, primeira.progressoPorUf);
  assert.deepEqual(Array.from(segunda.ufsComFalha), []);
  assert.deepEqual(paginas, [1, 7, 1]);
});

test("falha ao escrever metadado local preserva checkpoint anterior", async () => {
  const { ambiente, arquivos } = ambienteMain();
  const escrever = ambiente.fsTeste.writeFile;
  ambiente.fsTeste.writeFile = async (nome, dado) => {
    if (nome.includes("contratos_meta.json")) {
      arquivos.set(nome, "truncado");
      throw new Error("disco falhou");
    }
    return escrever(nome, dado);
  };
  await assert.rejects(ambiente.main(), /disco falhou/);
  assert.equal(arquivos.get("data/contratos_meta.json"), "anterior");
});

async function coletarMercadoSimulado(cenario, opcoes = {}) {
  const referencia = { numeroControlePNCPAta: "ata-teste", numeroControlePNCPCompra: "compra-teste" };
  let restante = 60000;
  const ambiente = vm.createContext({
    lerJsonExistente: async () => opcoes.existentes || ({ dataFinal: "20261001", atas: [], filaPendente: [referencia], janelasPendentes: [{ inicio: "20261001", fim: "20261002" }] }),
    FOLGA_DIAS: 2, RETENCAO_DIAS: 730, SEGMENTOS: [], CONCORRENCIA_ATAS: 1, hashProgressoAtas,
    fmtData: () => "20261027", tempoRestanteMs: () => restante, URL, gerarJanelas: () => [],
    partesNumeroControle: () => ({ cnpj: "teste", ano: "2026", sequencial: 1 }),
    console: { log() {} }, situacaoSemVencedor: () => false, segmentosQueBatem: () => [],
    normalizarDocumentoFornecedor: (valor) => valor,
    fetchComRetentativa: async (url) => {
      if (opcoes.buscar) return opcoes.buscar(url, (valor) => { restante = valor; });
      if (url.includes("/atas?")) return { data: [], totalPaginas: 1 };
      if (url.includes("/itens?")) {
        if (cenario === "falha-itens") return null;
        if (cenario === "tempo") restante = 9000;
        const data = Array.from({ length: cenario === "limite" ? 31 : 2 }, (_, indice) => ({ numeroItem: indice + 1, descricao: "Item" }));
        return cenario === "mais-paginas" ? { data, totalPaginas: 2 } : data;
      }
      if (url.includes("/resultados")) return cenario === "falha-resultados" ? null : [{ niFornecedor: "fornecedor", valorTotalHomologado: 10 }];
      return { unidadeOrgao: { ufSigla: "AM" } };
    },
  });
  vm.runInContext(codigo.slice(codigo.indexOf("async function coletarMercadoSegmentos("), codigo.indexOf("// ----------------------------------------------------------------------------", codigo.indexOf("async function coletarMercadoSegmentos("))), ambiente);
  return ambiente.coletarMercadoSegmentos("ignorado");
}

for (const cenario of ["falha-itens", "falha-resultados", "tempo", "mais-paginas"]) {
  test(`ata incompleta permanece pendente: ${cenario}`, async () => {
    const mercado = await coletarMercadoSimulado(cenario);
    assert.equal(mercado.filaPendente.length, 1);
    assert.equal(mercado.filaPendente[0].numeroControlePNCPAta, "ata-teste");
    assert.equal(mercado.atas.length, 0);
    assert.equal(mercado.parcial, true);
  });
}

test("ata só confirma enriquecimento após consultar todos os resultados", async () => {
  const mercado = await coletarMercadoSimulado("sucesso");
  assert.equal(mercado.filaPendente.length, 0);
  assert.equal(mercado.parcial, false);
  assert.equal(mercado.atas[0].enriquecida, true);
  assert.equal(mercado.atas[0].situacaoColetada, true);
  assert.equal(mercado.atas[0].itens.length, 2);
});

test("ata com mais de 30 itens consulta todos os vencedores", async () => {
  const mercado = await coletarMercadoSimulado("limite");
  assert.equal(mercado.filaPendente.length, 0);
  assert.equal(mercado.atas[0]?.itens.length, 31);
});

function fonteAta(url) {
  if (url.includes("/atas?")) return { data: [], totalPaginas: 1 };
  if (url.includes("/itens?")) {
    const pagina = Number(new URL(url).searchParams.get("pagina"));
    return Array.from({ length: pagina === 1 ? 50 : 1 }, (_, i) => ({ numeroItem: pagina === 1 ? i + 1 : 51, descricao: "Item" }));
  }
  if (url.includes("/resultados")) return [{ niFornecedor: "fornecedor", valorTotalHomologado: 10 }];
  return { numeroControlePNCP: "compra-teste", unidadeOrgao: { ufSigla: "AM" } };
}

test("ata pagina todos os itens e retoma resultados sem repetir os já persistidos", async () => {
  const parcial = await coletarMercadoSimulado("paginada", { buscar: (url, parar) => {
    if (url.includes("/itens/2/resultados")) parar(0);
    return fonteAta(url);
  } });
  assert.equal(parcial.filaPendente.length, 1);
  assert.equal(parcial.atas.length, 0);
  const repetidos = [];
  const concluido = await coletarMercadoSimulado("paginada", { existentes: JSON.parse(JSON.stringify(parcial)), buscar: (url) => {
    if (/\/itens\/[12]\/resultados/.test(url)) repetidos.push(url);
    return fonteAta(url);
  } });
  assert.equal(concluido.atas[0]?.itens.length, 51);
  assert.equal(concluido.filaPendente.length, 0);
  assert.equal(repetidos.length, 0);
  assert.equal(Object.keys(concluido.progressoAtas || {}).length, 0);
});

test("ata invalida progresso se os itens mudarem", async () => {
  const parcial = await coletarMercadoSimulado("paginada", { buscar: (url, parar) => {
    if (url.includes("/itens/2/resultados")) parar(0);
    return fonteAta(url);
  } });
  const concluido = await coletarMercadoSimulado("paginada", { existentes: JSON.parse(JSON.stringify(parcial)), buscar: (url) => {
    const dado = fonteAta(url);
    if (url.includes("/itens?")) dado[0].descricao = "Item atualizado";
    return dado;
  } });
  assert.equal(concluido.atas[0]?.itens[0].descricao, "Item atualizado");
});

for (const divergencia of ["resultado", "compra"]) {
  test(`ata rejeita ${divergencia} associado a outra compra`, async () => {
    const mercado = await coletarMercadoSimulado("paginada", { buscar: (url) => {
      if (divergencia === "resultado" && url.includes("/resultados")) return [{ numeroControlePNCPCompra: "outra-compra", numeroItem: 1, niFornecedor: "incorreto" }];
      if (divergencia === "compra" && url.includes("/api/consulta/v1/orgaos/")) return { numeroControlePNCP: "outra-compra", unidadeOrgao: { ufSigla: "AM" } };
      return fonteAta(url);
    } });
    assert.equal(mercado.atas.length, 0);
    assert.equal(mercado.filaPendente.length, 1);
  });
}

test("janelas de atas retomam página pendente sem duplicar referências", async () => {
  const existentes = { dataFinal: "20261001", atas: [], filaPendente: [], janelasPendentes: [{ inicio: "20261001", fim: "20261002" }] };
  const listar = (numero) => ({ numeroPagina: numero, totalPaginas: 3, totalRegistros: 3,
    data: [{ numeroControlePNCPAta: `ata-${numero}`, numeroControlePNCPCompra: "compra-teste" }] });
  const parcial = await coletarMercadoSimulado("janelas", { existentes, buscar: (url, parar) => {
    if (url.includes("/atas?")) {
      const numero = Number(new URL(url).searchParams.get("pagina"));
      if (numero === 2) parar(0);
      return listar(numero);
    }
    return fonteAta(url);
  } });
  assert.equal(parcial.dataFinal, "20261001");
  const paginas = [];
  const concluido = await coletarMercadoSimulado("janelas", { existentes: JSON.parse(JSON.stringify(parcial)), buscar: (url) => {
    if (url.includes("/atas?")) {
      const numero = Number(new URL(url).searchParams.get("pagina"));
      paginas.push(numero); return listar(numero);
    }
    return fonteAta(url);
  } });
  assert.equal(concluido.atas.length, 3);
  assert.equal(concluido.filaPendente.length, 0);
  assert.deepEqual(paginas, [1, 3, 1]);
});

test("atas retomam no dia seguinte revalidando a consulta", async () => {
  const parcial = await coletarMercadoSimulado("paginada", { buscar: (url, parar) => {
    if (url.includes("/itens/2/resultados")) parar(0);
    return fonteAta(url);
  } });
  parcial.progressoAtas["ata-teste"].iniciadoEm = new Date(Date.now() - 24 * 3600000).toISOString();
  const repetidos = [];
  const concluido = await coletarMercadoSimulado("paginada", { existentes: parcial, buscar: (url) => {
    if (/\/itens\/[12]\/resultados/.test(url)) repetidos.push(url);
    return fonteAta(url);
  } });
  assert.equal(concluido.atas[0]?.itens.length, 51);
  assert.equal(repetidos.length, 0);
});

test("progresso das atas fica no blob remoto antes do checkpoint, fora do metadado versionado", async () => {
  const { ambiente, arquivos, eventos } = ambienteMain();
  const progressoAtas = { ata: { compra: "compra", itens: [{ numeroItem: 1 }] } };
  ambiente.coletarMercadoSegmentos = async () => ({ atualizadoEm: "2026-10-28T12:00:00Z", atas: [], progressoAtas });
  let blob;
  ambiente.salvarBlob = async (_tabela, chave, dado) => {
    eventos.push(chave);
    if (chave === "mercado_coleta_pendente") blob = dado;
  };
  await ambiente.main();
  assert.deepEqual(JSON.parse(JSON.stringify(blob)), { atualizadoEm: "2026-10-28T12:00:00Z", progressoAtas, hash: hashProgressoAtas(progressoAtas),
    idsJanelas: [], hashIdsJanelas: hashProgressoAtas([]) });
  assert.ok(eventos.indexOf("mercado_coleta_pendente") < eventos.indexOf("data/mercado_meta.json"));
  assert.equal(JSON.parse(arquivos.get("data/mercado_meta.json")).progressoAtas, undefined);
});

test("IDs de scans ficam no blob remoto antes do checkpoint, fora dos metadados versionados", async () => {
  const { ambiente, arquivos, eventos } = ambienteMain();
  const blobs = {};
  ambiente.coletarContratos = async () => ({ atualizadoEm: "checkpoint-contratos", registros: [],
    consultaPendente: { dataInicial: "20261001", dataFinal: "20261002", paginacao: { proximaPagina: 2, ids: ["contrato-1"] } } });
  ambiente.coletarMercadoSegmentos = async () => ({ atualizadoEm: "checkpoint-atas", atas: [],
    janelasPendentes: [{ inicio: "20261001", fim: "20261002", proximaPagina: 2, ids: ["ata-1"] }] });
  ambiente.salvarBlob = async (_tabela, chave, dado) => { eventos.push(chave); blobs[chave] = dado; };
  await ambiente.main();
  assert.deepEqual(Array.from(blobs.contratos_coleta_pendente?.ids || []), ["contrato-1"]);
  assert.deepEqual(JSON.parse(JSON.stringify(blobs.mercado_coleta_pendente?.idsJanelas || [])), [["ata-1"]]);
  assert.equal(blobs.contratos_coleta_pendente.hash, hashProgressoAtas(["contrato-1"]));
  assert.equal(blobs.mercado_coleta_pendente.hashIdsJanelas, hashProgressoAtas([["ata-1"]]));
  assert.ok(eventos.indexOf("contratos_coleta_pendente") < eventos.indexOf("data/contratos_meta.json"));
  assert.ok(eventos.indexOf("mercado_coleta_pendente") < eventos.indexOf("data/mercado_meta.json"));
  assert.equal(JSON.parse(arquivos.get("data/contratos_meta.json")).consultaPendente.paginacao.ids, undefined);
  assert.equal(JSON.parse(arquivos.get("data/mercado_meta.json")).janelasPendentes[0].ids, undefined);
});

test("falha no blob de IDs do scan nacional preserva checkpoint e base anteriores", async () => {
  const { ambiente, arquivos, eventos } = ambienteMain();
  ambiente.salvarBlob = async (_tabela, chave) => { if (chave === "contratos_coleta_pendente") throw new Error("blob indisponível"); };
  await assert.rejects(ambiente.main(), /blob indisponível/);
  assert.equal(arquivos.get("data/contratos_meta.json"), "anterior");
  assert.ok(!eventos.includes("data/contratos_recentes.json"));
});

for (const etapa of ["Contratos", "Mercado"]) {
  for (const cenario of ["confirmado", "outro-checkpoint", "corrompido", "legado"]) {
    test(`hidratação de ${etapa} valida IDs do scan ${cenario}`, async () => {
      const contratos = etapa === "Contratos";
      const ids = [contratos ? "contrato-1" : "ata-1"];
      const meta = { atualizadoEm: "atual", consultaPendente: { paginacao: { proximaPagina: 2 } },
        janelasPendentes: [{ inicio: "20261001", fim: "20261002", proximaPagina: 2 }] };
      const pendente = cenario === "legado" ? null : { atualizadoEm: cenario === "outro-checkpoint" ? "anterior" : "atual",
        ids, hash: contratos ? hashProgressoAtas(ids) : hashProgressoAtas({}),
        progressoAtas: {}, idsJanelas: [ids], hashIdsJanelas: hashProgressoAtas([ids]) };
      if (cenario === "corrompido") pendente[contratos ? "hash" : "hashIdsJanelas"] = "corrompido";
      let gravado;
      const ambiente = vm.createContext({ lerJsonExistente: async () => meta, buscarBlob: async () => pendente,
        baixarTodasAsLinhas: async () => [], console: { log() {} }, hashProgressoAtas,
        fsTeste: { writeFile: async (_caminho, valor) => { gravado = JSON.parse(valor); } } });
      const nome = `hidratar${etapa}DoSupabase`;
      const comeco = codigo.indexOf(`async function ${nome}(`);
      vm.runInContext(codigo.slice(comeco, codigo.indexOf("\n}\n", comeco) + 2).replace('await import("node:fs/promises")', "fsTeste"), ambiente);
      if (cenario === "corrompido") {
        await assert.rejects(ambiente[nome]("ignorado", "ignorado"), /integridade/i);
        assert.equal(gravado, undefined);
      } else {
        await ambiente[nome]("ignorado", "ignorado");
        const recuperados = contratos ? gravado.consultaPendente.paginacao.ids : gravado.janelasPendentes[0].ids;
        assert.deepEqual(recuperados, cenario === "confirmado" ? ids : undefined);
      }
    });
  }
}

test("falha no blob de progresso das atas preserva checkpoint anterior", async () => {
  const { ambiente, arquivos } = ambienteMain();
  ambiente.salvarBlob = async (_tabela, chave) => { if (chave === "mercado_coleta_pendente") throw new Error("blob indisponível"); };
  await assert.rejects(ambiente.main(), /blob indisponível/);
  assert.equal(arquivos.get("data/mercado_meta.json"), "anterior");
});

for (const mesmoCheckpoint of [true, false]) {
  test(`hidratação ${mesmoCheckpoint ? "recupera" : "ignora"} progresso de atas ${mesmoCheckpoint ? "confirmado" : "de outro checkpoint"}`, async () => {
    let gravado;
    const progressoAtas = { ata: { compra: "compra" } };
    const ambiente = vm.createContext({
      lerJsonExistente: async () => ({ atualizadoEm: "checkpoint-atual" }),
      buscarBlob: async () => ({ atualizadoEm: mesmoCheckpoint ? "checkpoint-atual" : "outro", progressoAtas, hash: hashProgressoAtas(progressoAtas) }),
      hashProgressoAtas,
      baixarTodasAsLinhas: async () => [], console: { log() {} },
      fsTeste: { writeFile: async (_caminho, valor) => { gravado = JSON.parse(valor); } },
    });
    const comeco = codigo.indexOf("async function hidratarMercadoDoSupabase(");
    vm.runInContext(codigo.slice(comeco, codigo.indexOf("\n}\n", comeco) + 2).replace('await import("node:fs/promises")', "fsTeste"), ambiente);
    await ambiente.hidratarMercadoDoSupabase("ignorado", "ignorado");
    assert.deepEqual(gravado.progressoAtas, mesmoCheckpoint ? progressoAtas : {});
  });
}

test("hidratação rejeita progresso de atas corrompido antes de sobrescrever a base", async () => {
  let escreveu = false;
  const ambiente = vm.createContext({
    lerJsonExistente: async () => ({ atualizadoEm: "checkpoint-atual" }),
    buscarBlob: async () => ({ atualizadoEm: "checkpoint-atual", progressoAtas: { ata: {} }, hash: "corrompido" }),
    baixarTodasAsLinhas: async () => [], console: { log() {} }, hashProgressoAtas,
    fsTeste: { writeFile: async () => { escreveu = true; } },
  });
  const comeco = codigo.indexOf("async function hidratarMercadoDoSupabase(");
  vm.runInContext(codigo.slice(comeco, codigo.indexOf("\n}\n", comeco) + 2).replace('await import("node:fs/promises")', "fsTeste"), ambiente);
  await assert.rejects(ambiente.hidratarMercadoDoSupabase("ignorado", "ignorado"), /integridade/i);
  assert.equal(escreveu, false);
});

test("hidratação aceita metadado legado sem blob de progresso", async () => {
  let gravado;
  const ambiente = vm.createContext({
    lerJsonExistente: async () => ({ dataFinal: "20261001" }), buscarBlob: async () => null,
    baixarTodasAsLinhas: async () => [], console: { log() {} }, hashProgressoAtas,
    fsTeste: { writeFile: async (_caminho, valor) => { gravado = JSON.parse(valor); } },
  });
  const comeco = codigo.indexOf("async function hidratarMercadoDoSupabase(");
  vm.runInContext(codigo.slice(comeco, codigo.indexOf("\n}\n", comeco) + 2).replace('await import("node:fs/promises")', "fsTeste"), ambiente);
  await ambiente.hidratarMercadoDoSupabase("ignorado", "ignorado");
  assert.deepEqual(gravado.progressoAtas, {});
});

test("integridade do progresso tolera ordenação de chaves do JSONB preservando ordem dos itens", () => {
  const ambiente = vm.createContext({ require });
  const comeco = codigo.indexOf("function hashProgressoAtas(");
  vm.runInContext(codigo.slice(comeco, codigo.indexOf("\n}\n", comeco) + 2), ambiente);
  const primeiro = { z: 2, a: { d: 4, b: 1 }, itens: [{ numero: 2 }, { numero: 1 }] };
  const reordenado = { itens: [{ numero: 2 }, { numero: 1 }], a: { b: 1, d: 4 }, z: 2 };
  assert.equal(ambiente.hashProgressoAtas(primeiro), ambiente.hashProgressoAtas(reordenado));
  assert.notEqual(ambiente.hashProgressoAtas(primeiro), ambiente.hashProgressoAtas({ ...reordenado, itens: [...reordenado.itens].reverse() }));
});

test("falha na reconferência de itens preserva os resultados para retomada", async () => {
  let primeiras = 0;
  const parcial = await coletarMercadoSimulado("paginada", { buscar: (url) => {
    if (url.includes("/itens?pagina=1") && ++primeiras > 1) return null;
    return fonteAta(url);
  } });
  assert.equal(parcial.filaPendente.length, 1);
  let repetidos = 0;
  const concluido = await coletarMercadoSimulado("paginada", { existentes: parcial, buscar: (url) => {
    if (url.includes("/resultados")) repetidos++;
    return fonteAta(url);
  } });
  assert.equal(concluido.atas[0]?.itens.length, 51);
  assert.equal(repetidos, 0);
});

test("scan nacional recusa vazio contraditório sem avançar cobertura", async () => {
  const ambiente = vm.createContext({ tempoRestanteMs: () => 60000,
    fetchComRetentativa: async () => ({ data: [], totalPaginas: 0, totalRegistros: 1 }) });
  vm.runInContext(codigo.slice(codigo.indexOf("async function buscarPaginasEmLote"), codigo.indexOf("// ---------- Coleta complementar")), ambiente);
  const resultado = await ambiente.buscarPaginasEmLote(() => "simulado", 1, 1, 1, () => {});
  assert.equal(resultado.parcial, true);
});

for (const cenario of ["repetido", "truncado", "sem-id", "repetido-na-retomada"]) {
  test(`scan nacional não conclui páginas com registro ${cenario}`, async () => {
    let interromper = cenario === "repetido-na-retomada";
    const ambiente = vm.createContext({ tempoRestanteMs: () => 60000,
      fetchComRetentativa: async (url) => {
        const pagina = Number(url.split("=")[1]);
        if (interromper && pagina === 2) return null;
        return { numeroPagina: pagina, totalPaginas: 2, totalRegistros: cenario === "truncado" ? 3 : 2,
          data: [{ numeroControlePNCP: cenario === "sem-id" ? undefined : cenario === "truncado" ? `contrato-${pagina}` : "contrato-1" }] };
      } });
    vm.runInContext(codigo.slice(codigo.indexOf("async function buscarPaginasEmLote"), codigo.indexOf("// ---------- Coleta complementar")), ambiente);
    const coletar = (anterior) => ambiente.buscarPaginasEmLote((p) => `pagina=${p}`, 1, 1, 1, () => {}, anterior);
    let resultado = await coletar();
    if (interromper) {
      assert.equal(resultado.parcial, true);
      interromper = false;
      resultado = await coletar(JSON.parse(JSON.stringify(resultado.progresso)));
    }
    assert.equal(resultado.parcial, true);
    assert.ok(!resultado.progresso || resultado.progresso.proximaPagina <= 2);
  });
}

test("scan nacional retoma lacuna concorrente sem contar novamente páginas posteriores", async () => {
  let falhar = true;
  let liberarSegunda;
  const segunda = new Promise((resolve) => { liberarSegunda = resolve; });
  const paginas = [];
  const ambiente = vm.createContext({ tempoRestanteMs: () => 60000,
    fetchComRetentativa: async (url) => {
      const pagina = Number(url.split("=")[1]);
      if (falhar && pagina === 2) { await segunda; return null; }
      if (pagina === 3) liberarSegunda();
      return { numeroPagina: pagina, totalPaginas: 3, totalRegistros: 3, data: [{ numeroControlePNCP: `contrato-${pagina}` }] };
    } });
  vm.runInContext(codigo.slice(codigo.indexOf("async function buscarPaginasEmLote"), codigo.indexOf("// ---------- Coleta complementar")), ambiente);
  const coletar = (anterior) => ambiente.buscarPaginasEmLote((p) => `pagina=${p}`, 1, 1, 2, (_dado, pagina) => paginas.push(pagina), anterior);
  const parcial = await coletar();
  assert.equal(parcial.parcial, true);
  assert.deepEqual(paginas, [1, 3]);
  falhar = false;
  paginas.length = 0;
  const concluido = await coletar(JSON.parse(JSON.stringify(parcial.progresso)));
  assert.equal(concluido.parcial, false);
  assert.deepEqual(paginas, [2, 3]);
});

test("scan nacional reinicia cursor legado que não preservou IDs", async () => {
  let interromper = true;
  const ambiente = vm.createContext({ tempoRestanteMs: () => 60000,
    fetchComRetentativa: async (url) => {
      const pagina = Number(url.split("=")[1]);
      return interromper && pagina === 2 ? null : { numeroPagina: pagina, totalPaginas: 2, totalRegistros: 2,
        data: [{ numeroControlePNCP: `contrato-${pagina}` }] };
    } });
  vm.runInContext(codigo.slice(codigo.indexOf("async function buscarPaginasEmLote"), codigo.indexOf("// ---------- Coleta complementar")), ambiente);
  const coletar = (anterior) => ambiente.buscarPaginasEmLote((p) => `pagina=${p}`, 1, 1, 1, () => {}, anterior);
  const parcial = await coletar();
  parcial.progresso.ids = [];
  interromper = false;
  const concluido = await coletar(parcial.progresso);
  assert.equal(concluido.parcial, false);
});

test("janela de atas reinicia cursor legado que não preservou IDs", async () => {
  let interromper = true;
  const buscar = (url) => {
    if (url.includes("/atas?")) {
      const pagina = Number(new URL(url).searchParams.get("pagina"));
      return interromper && pagina === 2 ? null : { numeroPagina: pagina, totalPaginas: 2, totalRegistros: 2,
        data: [{ numeroControlePNCPAta: `ata-${pagina}`, numeroControlePNCPCompra: "compra-teste" }] };
    }
    return fonteAta(url);
  };
  const parcial = await coletarMercadoSimulado("legado", { buscar,
    existentes: { dataFinal: "20261001", atas: [], filaPendente: [], janelasPendentes: [{ inicio: "20261001", fim: "20261002" }] } });
  parcial.janelasPendentes[0].ids = [];
  interromper = false;
  const concluido = await coletarMercadoSimulado("legado", { existentes: parcial, buscar });
  assert.equal(concluido.parcial, false);
  assert.equal(concluido.atas.length, 2);
});

test("ata retoma páginas com totais válidos antes de confirmar enriquecimento", async () => {
  let interromper = true;
  const buscar = (url) => {
    if (url.includes("/itens?")) {
      const pagina = Number(new URL(url).searchParams.get("pagina"));
      if (interromper && pagina === 2) return null;
      return { numeroPagina: pagina, totalPaginas: 2, totalRegistros: 2, data: [{ numeroItem: pagina, descricao: "Item" }] };
    }
    return fonteAta(url);
  };
  const parcial = await coletarMercadoSimulado("paginada", { buscar });
  assert.equal(parcial.parcial, true);
  interromper = false;
  const concluido = await coletarMercadoSimulado("paginada", { existentes: JSON.parse(JSON.stringify(parcial)), buscar });
  assert.equal(concluido.parcial, false);
  assert.equal(concluido.atas[0].itens.length, 2);
});

for (const cenario of ["truncado", "total-registros-alterado", "total-paginas-alterado", "total-alterado-na-retomada"]) {
  test(`ata não confirma itens com total ${cenario}`, async () => {
    let interromper = cenario === "total-alterado-na-retomada";
    let resultadosConsultados = 0;
    const buscar = (url) => {
      if (url.includes("/itens?")) {
        const pagina = Number(new URL(url).searchParams.get("pagina"));
        if (interromper && pagina === 2) return null;
        return { numeroPagina: pagina,
          totalPaginas: cenario === "total-paginas-alterado" && pagina === 2 ? 1 : 2,
          totalRegistros: cenario === "truncado" || (cenario.includes("alterado") && cenario !== "total-paginas-alterado" && pagina === 2) ? 3 : 2,
          data: [{ numeroItem: pagina, descricao: "Item" }] };
      }
      if (url.includes("/resultados")) resultadosConsultados++;
      return fonteAta(url);
    };
    let mercado = await coletarMercadoSimulado(cenario, { buscar });
    if (interromper) {
      assert.equal(mercado.parcial, true);
      interromper = false;
      mercado = await coletarMercadoSimulado(cenario, { existentes: JSON.parse(JSON.stringify(mercado)), buscar });
    }
    assert.equal(mercado.parcial, true);
    assert.equal(mercado.atas.length, 0);
    assert.equal(mercado.filaPendente.length, 1);
    assert.equal(resultadosConsultados, 0);
  });
}

for (const cenario of ["repetido", "truncado", "sem-id", "repetido-na-retomada"]) {
  test(`janela de atas não conclui páginas com registro ${cenario}`, async () => {
    let interromper = cenario === "repetido-na-retomada";
    const buscar = (url) => {
      if (url.includes("/atas?")) {
        const pagina = Number(new URL(url).searchParams.get("pagina"));
        if (interromper && pagina === 2) return null;
        return { numeroPagina: pagina, totalPaginas: 2, totalRegistros: cenario === "truncado" ? 3 : 2,
          data: [{ numeroControlePNCPAta: cenario === "sem-id" ? undefined : cenario === "truncado" ? `ata-${pagina}` : "ata-1",
            numeroControlePNCPCompra: "compra-teste" }] };
      }
      return fonteAta(url);
    };
    let mercado = await coletarMercadoSimulado(cenario, { buscar,
      existentes: { dataFinal: "20261001", atas: [], filaPendente: [], janelasPendentes: [{ inicio: "20261001", fim: "20261002" }] } });
    if (interromper) {
      assert.equal(mercado.parcial, true);
      interromper = false;
      mercado = await coletarMercadoSimulado(cenario, { existentes: JSON.parse(JSON.stringify(mercado)), buscar });
    }
    assert.equal(mercado.parcial, true);
    assert.equal(mercado.dataFinal, "20261001");
    assert.equal(mercado.janelasPendentes.length, 1);
    assert.ok((mercado.janelasPendentes[0].proximaPagina || 1) <= 2);
  });
}

for (const rota of ["/itens?", "/resultados", "/atas?"]) {
  test(`mercado mantém pendência para vazio contraditório em ${rota}`, async () => {
    const resultado = await coletarMercadoSimulado("invalido", { buscar: (url) => url.includes(rota)
      ? { data: [], totalPaginas: 0, totalRegistros: 1 } : fonteAta(url) });
    assert.equal(resultado.parcial, true);
  });
}

test("cursor de oportunidades vencido reinicia a consulta com preservação do histórico", async () => {
  let restante = 15000;
  const parcial = await ambienteOportunidades(null, async (url) => {
    const numero = Number(new URL(url).searchParams.get("pagina"));
    if (numero === 20) restante = 0;
    return paginaOportunidades(numero);
  }, () => restante).coletarOportunidadesAbertas("ignorado");
  parcial.paginasPendentesPorUf.AM.iniciadoEm = new Date(Date.now() - 7 * 3600000).toISOString();
  const paginas = [];
  const concluido = await ambienteOportunidades(parcial, async (url) => {
    const numero = Number(new URL(url).searchParams.get("pagina")); paginas.push(numero);
    return paginaOportunidades(numero);
  }).coletarOportunidadesAbertas("ignorado");
  assert.ok(paginas.includes(2));
  assert.equal(concluido.registros.length, 23);
  assert.deepEqual(Array.from(concluido.ufsComFalha), []);
});

function ambienteRateLimit(respostas) {
  const esperas = [];
  const ambiente = vm.createContext({
    AbortController,
    console: { log() {} },
    esperarComBackoff: async () => {},
    // O prazo de rede (25s) não é espera de rate limit; só registra pausas reais.
    setTimeout: (callback, ms) => { if (ms !== 100) { esperas.push(ms); callback(); } return {}; },
    clearTimeout: () => {},
    fetch: async () => respostas.shift(),
  });
  vm.runInContext(codigo.slice(codigo.indexOf("async function fetchComRetentativa("), codigo.indexOf("async function lerJsonExistente(")), ambiente);
  return { ambiente, esperas };
}

const resposta429 = (retryAfter) => ({ ok: false, status: 429, headers: { get: (nome) => (nome === "retry-after" ? retryAfter : null) } });
const resposta200 = { ok: true, status: 200, text: async () => '{"data":[],"totalPaginas":0}' };

test("429 respeita Retry-After em segundos antes de tentar de novo", async () => {
  const { ambiente, esperas } = ambienteRateLimit([resposta429("7"), resposta200]);
  assert.equal(JSON.stringify(await ambiente.fetchComRetentativa("https://exemplo.invalid", 2, 100)), '{"data":[],"totalPaginas":0}');
  assert.deepEqual(esperas, [7000]);
});

test("429 com limitador global delega a pausa ao chamador em vez de dormir sozinho", async () => {
  const pausas = [];
  const { ambiente, esperas } = ambienteRateLimit([resposta429("30"), resposta429(null), resposta200]);
  const dados = await ambiente.fetchComRetentativa("https://exemplo.invalid", 4, 100, "", null, (retryAfter, tentativa) => pausas.push([retryAfter, tentativa]));
  assert.equal(JSON.stringify(dados), '{"data":[],"totalPaginas":0}');
  assert.deepEqual(pausas, [["30", 0], [null, 1]]);
  assert.deepEqual(esperas, []);
});

test("espera após 429 dobra sem Retry-After e respeita o teto", () => {
  const { ambiente } = ambienteRateLimit([]);
  const semCabecalho = ambiente.esperaAposRateLimitMs(null, 2, 5000);
  assert.ok(semCabecalho >= 20000 && semCabecalho < 20300);
  assert.equal(ambiente.esperaAposRateLimitMs("600", 0, 5000), 60000);
  const data = new Date(Date.now() + 12000).toUTCString();
  const porData = ambiente.esperaAposRateLimitMs(data, 0, 1000);
  assert.ok(porData > 10000 && porData <= 12000);
});

test("contratos: upsert envia só o que veio da fonte nesta execução, com atualizado_em", async () => {
  const contrato = (id) => ({ numeroControlePNCP: id, objeto: id, dataAssinatura: "2026-11-10" });
  const enviados = [];
  const ambiente = vm.createContext({
    UFS: ["AM"], RETENCAO_DIAS: 730, FOLGA_DIAS: 2, DIAS_HISTORICO_INICIAL: 30, TAMANHO_PAGINA: 100, CONCORRENCIA_PAGINAS: 1,
    console: { log() {} }, fmtData: () => "20261118", segmentosQueBatem: () => [],
    chaveRegistro: (r) => r.numeroControlePNCP,
    lerJsonExistente: async () => ({ dataFinal: "20261117", registros: [contrato("hidratado"), contrato("recoletado")] }),
    buscarPaginasEmLote: async (_url, _p, _t, _c, aoReceber) => {
      aoReceber({ data: ["recoletado", "inedito"].map((id) => ({ numeroControlePNCP: id, objetoContrato: id, dataAssinatura: "2026-11-10" })) });
      return { paginasVarridas: 1, totalPaginas: 1, parcial: false, progresso: null };
    },
    coletarContratosComplementarPorUf: async () => ({ registros: [contrato("por-uf")], ufsComFalha: [], progressoPorUf: {} }),
    upsertEmLotes: async (_tabela, linhas) => { enviados.push(...linhas); return linhas.length; },
    removerMaisAntigosQue: async () => {},
  });
  const trecho = (nome, fim) => codigo.slice(codigo.indexOf(nome), codigo.indexOf(fim, codigo.indexOf(nome)));
  vm.runInContext(trecho("async function coletarContratos(", "\n// ---------- Oportunidades") +
    trecho("async function sincronizarContratosNoSupabase(", "\nasync function hidratarMercadoDoSupabase("), ambiente);
  const contratos = await ambiente.coletarContratos("ignorado");
  assert.equal(contratos.registros.length, 4);
  await ambiente.sincronizarContratosNoSupabase(contratos);
  assert.deepEqual(enviados.map((l) => l.numero_controle_pncp), ["recoletado", "inedito", "por-uf"]);
  assert.ok(enviados.every((l) => Number.isFinite(Date.parse(l.atualizado_em))));
});
