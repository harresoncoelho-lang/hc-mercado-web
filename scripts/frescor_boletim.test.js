const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
function extrairFuncao(nome) {
  const inicio = html.search(new RegExp(`  (?:async )?function ${nome}\\(`));
  assert.ok(inicio >= 0, `Função ${nome} deve existir`);
  return html.slice(inicio, html.indexOf("\n  }", inicio) + 4);
}
const agora = "2026-09-11T16:00:00Z";
class DataFixa extends Date {
  constructor(...args) { super(...(args.length ? args : [agora])); }
  static now() { return Date.parse(agora); }
}
function criarContexto(base, cache = null) {
  const elementos = new Map();
  const renderizacoes = [];
  const gravacoes = [];
  let consultas = 0;
  const contexto = vm.createContext({
    Date: DataFixa,
    window: {},
    document: { getElementById(id) {
      if (!elementos.has(id)) elementos.set(id, {});
      return elementos.get(id);
    } },
    normalizarUfs: (ufs) => ufs,
    lerFiltroBoletim: () => ({ ufs: ["AM"], palavrasRaw: "material" }),
    lerCacheResultadoBoletim: () => cache,
    carregarCache: async () => base,
    mesclarComCacheRobo: (_lista, registros) => registros,
    renderizarBoletimComCalendario: (registros) => renderizacoes.push(registros),
    salvarCacheResultadoBoletim: (...args) => gravacoes.push(args),
    complementarBoletimComSistemaS: () => {},
    textoUfs: (ufs) => ufs.join(", "),
    buscarOportunidadesAbertas: async () => { consultas++; throw new Error("Consulta automática indevida"); },
    escapeHtml: String,
  });
  for (const nome of ["metaBoletim", "filtrarResultadosDoBoletim", "combinarResultadosDoBoletim", "resultadosDoRoboParaBoletim", "carregarBaseDoRoboParaBoletim", "frescorBaseBoletim", "gerarBoletim"]) {
    vm.runInContext(extrairFuncao(nome), contexto);
  }
  return { contexto, renderizacoes, gravacoes, consultas: () => consultas, elementos };
}
function registro(id, objeto = "material") {
  return { numeroControlePNCP: id, objeto, uf: "AM", publicacao: "2026-09-11T12:00:00Z" };
}

test("frescor considera coleta efetiva e ignora tentativa recente", async () => {
  const { contexto } = criarContexto({ registros: [], atualizadoEm: "2026-09-03T16:00:00Z", ultimaTentativaEm: agora });
  const base = await contexto.carregarBaseDoRoboParaBoletim(["AM"]);
  assert.equal(base.coberturaPorUf.AM.atualizadoEm, "2026-09-03T16:00:00Z");
  assert.match(contexto.frescorBaseBoletim(base), /03\/09\/2026/);
  assert.match(contexto.frescorBaseBoletim(base), /Atualizar boletim/);
});

test("frescor distingue coleta sem data de coleta atual", () => {
  const { contexto } = criarContexto(null);
  assert.match(contexto.frescorBaseBoletim(null), /sem data confirmada/);
  assert.match(contexto.frescorBaseBoletim({ atualizadoEm: "inválida" }), /Atualizar boletim/);
  assert.doesNotMatch(contexto.frescorBaseBoletim({ atualizadoEm: agora }), /desatualizada/);
});

test("edição ao vivo do dia 11 sobrevive à base antiga sem consultar PNCP", async () => {
  const live = registro("novo");
  const ambiente = criarContexto({ atualizadoEm: "2026-09-03T16:00:00Z", registros: [registro("outro")] }, {
    salvoEm: agora, atualizadoAoVivoEm: agora, resultados: [live],
  });
  await ambiente.contexto.gerarBoletim();
  assert.ok(ambiente.renderizacoes.at(-1).some((r) => r.numeroControlePNCP === "novo"));
  assert.equal(ambiente.consultas(), 0);
  assert.match(ambiente.elementos.get("bol-meta").textContent, /03\/09\/2026/);
  assert.equal(ambiente.gravacoes.at(-1)[2], agora);
});

test("coleta mais nova atualiza registro duplicado de edição ao vivo antiga", async () => {
  const ambiente = criarContexto({ atualizadoEm: agora, registros: [registro("mesmo", "corrigido")] }, {
    atualizadoAoVivoEm: "2026-09-10T16:00:00Z", salvoEm: agora, resultados: [registro("mesmo", "anterior")],
  });
  await ambiente.contexto.gerarBoletim();
  assert.equal(ambiente.renderizacoes.at(-1).length, 1);
  assert.equal(ambiente.renderizacoes.at(-1)[0].objeto, "corrigido");
});

test("salvoEm legado não faz edição antiga prevalecer sobre coleta corrigida", async () => {
  const ambiente = criarContexto({ atualizadoEm: "2026-09-11T15:00:00Z", registros: [registro("mesmo", "corrigido")] }, {
    salvoEm: agora, resultados: [registro("mesmo", "anterior")],
  });
  await ambiente.contexto.gerarBoletim();
  assert.equal(ambiente.renderizacoes.at(-1)[0].objeto, "corrigido");
});

test("merge remove registros antigos encerrados e mantém recentes da edição", async () => {
  const ambiente = criarContexto({ atualizadoEm: agora, registros: [] }, {
    salvoEm: agora, atualizadoAoVivoEm: agora,
    resultados: [registro("recente"), { ...registro("antigo"), publicacao: "2026-08-01", encerramento: "2026-08-10" }],
  });
  await ambiente.contexto.gerarBoletim();
  assert.equal(ambiente.renderizacoes.at(-1).length, 1);
  assert.equal(ambiente.renderizacoes.at(-1)[0].numeroControlePNCP, "recente");
  assert.equal(ambiente.consultas(), 0);
});

test("precedência considera a coleta de cada UF e preserva IDs ausentes", async () => {
  const ambiente = criarContexto(null, {
    salvoEm: agora, atualizadoAoVivoEm: "2026-09-10T16:00:00Z",
    resultados: [registro("am", "AM antiga"), { ...registro("rr", "RR recente"), uf: "RR" }, { ...registro("exclusivo"), uf: "RR" }],
  });
  ambiente.contexto.carregarBaseDoRoboParaBoletim = async () => ({
    coberturaPorUf: { AM: { atualizadoEm: agora }, RR: { atualizadoEm: "2026-09-03T16:00:00Z" } },
    registros: [registro("am", "AM corrigida"), { ...registro("rr", "RR antiga"), uf: "RR" }],
  });
  await ambiente.contexto.gerarBoletim();
  const resultados = ambiente.renderizacoes.at(-1);
  assert.equal(resultados.find((r) => r.numeroControlePNCP === "am").objeto, "AM corrigida");
  assert.equal(resultados.find((r) => r.numeroControlePNCP === "rr").objeto, "RR recente");
  assert.ok(resultados.some((r) => r.numeroControlePNCP === "exclusivo"));
  assert.equal(resultados.length, 3);
});

test("cache inteiramente expirado não aparece nem na primeira pintura com coleta vazia", async () => {
  const ambiente = criarContexto({ atualizadoEm: agora, registros: [] }, {
    salvoEm: agora, resultados: [{ ...registro("expirado"), publicacao: "2026-08-01", encerramento: "2026-08-10" }],
  });
  await ambiente.contexto.gerarBoletim();
  assert.ok(ambiente.renderizacoes.length > 0);
  assert.ok(ambiente.renderizacoes.every((resultados) => resultados.length === 0));
  assert.equal(ambiente.gravacoes.at(-1)[1].length, 0);
  assert.equal(ambiente.consultas(), 0);
});

test("coleta corrige encerramento antes do filtro de recência sem ressuscitar cache", async () => {
  const antigo = { ...registro("corrigido"), publicacao: "2026-01-01", encerramento: "2099-01-01" };
  const ambiente = criarContexto({ atualizadoEm: agora, registros: [{ ...antigo, encerramento: "2026-01-02" }] }, {
    salvoEm: agora, atualizadoAoVivoEm: "2026-09-10T16:00:00Z", resultados: [antigo],
  });
  await ambiente.contexto.gerarBoletim();
  assert.equal(ambiente.renderizacoes.at(-1).length, 0);
  assert.equal(ambiente.gravacoes.at(-1)[1].length, 0);
});

test("projeção posterior remove PNCP ausente da edição antiga e preserva Sistema S", async () => {
  const ambiente = criarContexto({ atualizadoEm: agora, registros: [] }, {
    salvoEm: agora, atualizadoAoVivoEm: "2026-09-10T16:00:00Z",
    resultados: [registro("retirado"), { ...registro(null, "Sistema S"), link: "https://sistema-s.example/edital" }],
  });
  await ambiente.contexto.gerarBoletim();
  assert.equal(ambiente.renderizacoes.at(-1).length, 1);
  assert.equal(ambiente.renderizacoes.at(-1)[0].objeto, "Sistema S");
});
