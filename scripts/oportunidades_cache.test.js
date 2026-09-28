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
const registro = (id) => ({ numeroControlePNCP: id, uf: "AM", objeto: "material de expediente" });

function criarContexto({ palavras = "expediente", armazenado = {} } = {}) {
  const armazenamento = new Map(Object.entries(armazenado));
  const elementos = new Map();
  const renderizacoes = [];
  const consultas = [];
  const elemento = (id) => {
    if (!elementos.has(id)) {
      elementos.set(id, { id, value: "", innerHTML: "", disabled: false, textContent: "", hidden: false, style: {},
        before(novo) { elementos.set(novo.id, novo); } });
    }
    return elementos.get(id);
  };
  elemento("op-palavras").value = palavras;
  const contexto = vm.createContext({
    OP_RESULTADO_CHAVE: "hc_oportunidades_resultado",
    OP_RESULTADO_JANELA_MS: 10 * 60 * 1000,
    opBuscaSeq: 0,
    opJaBuscado: false,
    JSON, Date, Number, Array, String,
    localStorage: { getItem: (k) => armazenamento.get(k) ?? null, setItem: (k, v) => armazenamento.set(k, String(v)) },
    document: {
      getElementById: (id) => (elementos.has(id) || id !== "op-resultado-nota" ? elemento(id) : null),
      createElement: () => ({ style: {} }),
    },
    ufsDoSelect: () => ["AM"],
    normalizarUfs: (ufs) => ufs,
    ufEstaSelecionada: () => true,
    classificarEsfera: () => "",
    idOportunidade: (r) => r.numeroControlePNCP,
    escapeHtml: String,
    carregarOportunidadesSupabase: async () => null,
    mesclarComCacheRobo: (lista) => lista,
    buscarExtrasSistemaS: async () => [],
    renderizarPainelBoletim: (_alvo, resultados) => renderizacoes.push(resultados.map((r) => r.numeroControlePNCP)),
    buscarOportunidadesAbertas: (ufs, lista) => new Promise((resolve) => consultas.push({ palavras: lista.join(","), resolve })),
  });
  for (const nome of ["salvarFiltroOportunidades", "lerResultadoOportunidades", "salvarResultadoOportunidades", "definirNotaResultadoOportunidades", "buscarOportunidades"]) {
    vm.runInContext(extrairFuncao(nome), contexto);
  }
  const nota = () => elementos.get("op-resultado-nota")?.textContent || "";
  return { contexto, armazenamento, elemento, renderizacoes, consultas, nota };
}

// Grava um resultado anterior com a mesma chave de filtro que a busca vai calcular.
function comResultadoSalvo(idadeMs, ids) {
  const ambiente = criarContexto();
  const chaveFiltro = JSON.stringify(ambiente.contexto.salvarFiltroOportunidades(["AM"], "", "", "", "expediente", "", { esfera: "", valorMin: "", valorMax: "", codigo: "", orgaoTexto: "" }));
  return criarContexto({ armazenado: { hc_oportunidades_resultado: JSON.stringify({ chaveFiltro, salvoEm: Date.now() - idadeMs, resultados: ids.map(registro), aviso: "" }) } });
}
const tique = () => new Promise((resolve) => setImmediate(resolve));

test("primeira busca mostra loading, busca ao vivo e guarda o resultado", async () => {
  const x = criarContexto();
  const busca = x.contexto.buscarOportunidades();
  assert.match(x.elemento("op-resultado").innerHTML, /Buscando licitações no PNCP/);
  await tique();
  x.consultas[0].resolve({ encontrados: [registro("A")], falhaConexao: false });
  await busca;
  assert.deepEqual(x.renderizacoes, [["A"]]);
  assert.equal(JSON.parse(x.armazenamento.get("hc_oportunidades_resultado")).resultados.length, 1);
});

test("reabrir com o mesmo filtro dentro da janela mostra o salvo sem consultar o PNCP", async () => {
  const x = comResultadoSalvo(60 * 1000, ["A", "B"]);
  await x.contexto.buscarOportunidades({ restauracao: true });
  assert.deepEqual(x.renderizacoes, [["A", "B"]]);
  assert.equal(x.consultas.length, 0);
  assert.doesNotMatch(x.elemento("op-resultado").innerHTML, /Buscando/);
});

test("fora da janela mostra o salvo na hora e atualiza em segundo plano só se houver novidade", async () => {
  const x = comResultadoSalvo(20 * 60 * 1000, ["A"]);
  const busca = x.contexto.buscarOportunidades({ restauracao: true });
  assert.deepEqual(x.renderizacoes, [["A"]]);
  assert.doesNotMatch(x.elemento("op-resultado").innerHTML, /Buscando/);
  assert.match(x.nota(), /conferindo novidades/);
  await tique();
  x.consultas[0].resolve({ encontrados: [registro("A"), registro("N")], falhaConexao: false });
  await busca;
  assert.deepEqual(x.renderizacoes, [["A"], ["A", "N"]]);
  assert.match(x.nota(), /Atualizado com o PNCP/);

  const semNovidade = comResultadoSalvo(20 * 60 * 1000, ["A"]);
  const outra = semNovidade.contexto.buscarOportunidades({ restauracao: true });
  await tique();
  semNovidade.consultas[0].resolve({ encontrados: [registro("A")], falhaConexao: false });
  await outra;
  assert.deepEqual(semNovidade.renderizacoes, [["A"]]);
  assert.match(semNovidade.nota(), /nenhuma novidade/);
});

test("PNCP parcial ou fora do ar não substitui a lista salva", async () => {
  const x = comResultadoSalvo(20 * 60 * 1000, ["A", "B"]);
  const salvo = x.armazenamento.get("hc_oportunidades_resultado");
  const busca = x.contexto.buscarOportunidades({ restauracao: true });
  await tique();
  x.consultas[0].resolve({ encontrados: [], falhaConexao: true });
  await busca;
  assert.deepEqual(x.renderizacoes, [["A", "B"]]);
  assert.equal(x.armazenamento.get("hc_oportunidades_resultado"), salvo);
  assert.match(x.nota(), /não respondeu/);
});

test("filtro diferente mostra loading e resposta atrasada da busca anterior é descartada", async () => {
  const x = comResultadoSalvo(20 * 60 * 1000, ["A"]);
  const primeira = x.contexto.buscarOportunidades({ restauracao: true });
  x.elemento("op-palavras").value = "limpeza";
  const segunda = x.contexto.buscarOportunidades();
  assert.match(x.elemento("op-resultado").innerHTML, /Buscando licitações no PNCP/);
  await tique();
  x.consultas[1].resolve({ encontrados: [registro("L")], falhaConexao: false });
  await segunda;
  x.consultas[0].resolve({ encontrados: [registro("VELHO")], falhaConexao: false });
  await primeira;
  assert.deepEqual(x.renderizacoes, [["A"], ["L"]]);
});
