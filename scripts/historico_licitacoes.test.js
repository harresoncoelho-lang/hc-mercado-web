const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./historico_licitacoes");
const { executarTarefa } = require("./esteira_processos");

const resposta = (dados, status = 200) => new Response(dados === null ? null : JSON.stringify(dados), { status, headers: { "content-type": "application/json" } });
const PROC = "33333333-3333-3333-3333-333333333333";
const tarefa = { organizacao_id: "o", empresa_id: "e", processo_id: PROC, etapa: "historico", estado: "executando", tentativas: 0, detalhe: {}, criado_por: "u" };

// Banco falso: guarda o que o robô grava em cada tabela.
function banco({ processo = true } = {}) {
  const gravado = {}, patches = [];
  const rest = async (caminho, op = {}) => {
    const tabela = caminho.split("?")[0];
    if (tabela === "operacao_processos") return resposta(processo ? [{ id: PROC, url_origem: null, origem_externa_id: "00394502002864-1-004000/2026", numero: null }] : []);
    if (tabela === "operacao_esteira_tarefas") { patches.push(JSON.parse(op.body)); return resposta([]); }
    if (op.method === "POST") (gravado[tabela] ||= []).push(...JSON.parse(op.body));
    return resposta([]);
  };
  return { rest, gravado, patches };
}

// Edital atual (2 itens, um com CATMAT) e uma contratação anterior do mesmo órgão.
async function fontes(url) {
  const u = new URL(url);
  if (u.pathname.startsWith("/api/consulta/v1/orgaos/")) return resposta({ unidadeOrgao: { codigoUnidade: "788820", nomeUnidade: "CEIMMA" },
    objetoCompra: "Aquisição de gêneros alimentícios", linkSistemaOrigem: "https://x/?compra=78882005900102026", numeroControlePNCP: "00394502002864-1-004000/2026" });
  if (u.pathname.endsWith("/compras/2026/4000/itens")) return resposta([{ numeroItem: 1, catalogoCodigoItem: "463574", descricao: "Café torrado", valorUnitarioEstimado: 20 }]);
  if (u.pathname.endsWith("1_consultarMaterial")) return resposta({ resultado: [{ idCompraItem: "7888200590033202500107", numeroItemCompra: 107, niFornecedor: "38350458000143",
    nomeFornecedor: "C R DA SILVA", marca: "PILÃO", descricaoItem: "Café", codigoPdm: "19766", dataCompra: "2025-11-11" }] });
  if (u.pathname === "/api/search") return resposta({ items: [{ item_url: "/compras/00394502002864/2025/3596", link_sistema_origem: "https://x/?compra=78882005900332025",
    numero_controle_pncp: "00394502002864-1-003596/2025", unidade_codigo: "788820", numero: "90033", data_publicacao_pncp: "2025-08-18T07:00" }] });
  if (u.pathname.endsWith("/2025/3596/itens")) return resposta([{ numeroItem: 107, catalogoCodigoItem: "463574", descricao: "Café", valorUnitarioEstimado: 23.33, situacaoCompraItemNome: "Homologado", temResultado: true }]);
  if (u.pathname.endsWith("/resultados")) return resposta([{ niFornecedor: "38350458000143", nomeRazaoSocialFornecedor: "C R DA SILVA", ordemClassificacaoSrp: 1, situacaoCompraItemResultadoNome: "Informado", valorUnitarioHomologado: 17 }]);
  return resposta(null, 404);
}

test("etapa historico: grava compras/itens/participações e deixa o casamento no detalhe", async () => {
  const { rest, gravado } = banco();
  const meses = [];
  const lerMes = async (mes, filtro) => {
    meses.push(mes);
    if (meses.length > 1) return { mes, linhas: 0, bytes: 0 }; // o 2º mês do arquivo não tem esse item
    filtro.linha('"numero_uasg";"id_compra";"numero_item";"identificacao_participante";"nome_participante";"classificacao";"valor_proposta_calculado"');
    filtro.linha('"788820";"78882005900332025";"107";"11111111000191";"SEGUNDO LTDA";"2";"19.5"');
    return { mes, linhas: 2, bytes: 10 };
  };
  const d = await H.etapaHistorico(tarefa, { rest, fetchPncp: fontes, esperar: async () => {}, lerMes });
  assert.equal(d.uasg, "788820");
  assert.deepEqual(d.compras, ["78882005900332025"]);
  assert.deepEqual(d.casamentos.map((c) => [c.item_edital, c.numero_item, c.confianca]), [[1, 107, "alta"]]);
  assert.deepEqual(meses, ["2025/09", "2025/08"]);
  assert.equal(d.propostas.participacoes, 1);
  assert.equal(gravado.historico_compras.length, 1);
  assert.equal(gravado.historico_itens[0].valor_estimado, 23.33);
  const nomes = gravado.historico_participacoes.map((p) => p.fornecedor_nome);
  assert.ok(nomes.includes("C R DA SILVA") && nomes.includes("SEGUNDO LTDA"));
  assert.equal(gravado.historico_participacoes.find((p) => p.marca)?.marca, "PILÃO");
});

test("esteira: etapa historico vira 'feito' com o detalhe; processo sumido falha de vez", async () => {
  const ok = banco();
  const r = await executarTarefa({ ...tarefa }, { rest: ok.rest, fetchPncp: fontes, esperar: async () => {}, agora: Date.now, lerMes: async (mes) => ({ mes, linhas: 0, bytes: 0 }) });
  assert.equal(r, "feito");
  assert.equal(ok.patches.at(-1).estado, "feito");
  assert.deepEqual(ok.patches.at(-1).detalhe.compras, ["78882005900332025"]);

  const sem = banco({ processo: false });
  assert.equal(await executarTarefa({ ...tarefa }, { rest: sem.rest, fetchPncp: fontes, esperar: async () => {}, agora: Date.now }), "falhou");
});

test("consultas avulsas: completa participantes e marca 'completo'; erro marca 'falhou'", async () => {
  const patches = [];
  const gravado = [];
  const rest = async (caminho, op = {}) => {
    const tabela = caminho.split("?")[0];
    if (tabela === "historico_consultas" && !op.method) return resposta([{ chave: "k", compras: ["78882005900332025"], casamentos: [{ id_compra: "78882005900332025", numero_item: 107 }] }]);
    if (tabela === "historico_compras") return resposta([{ id_compra: "78882005900332025", data_publicacao: "2025-08-18" }]);
    if (op.method === "PATCH") patches.push(JSON.parse(op.body).situacao);
    if (op.method === "POST") gravado.push(...JSON.parse(op.body));
    return resposta([]);
  };
  const lerMes = async (mes, filtro) => {
    filtro.linha('"numero_uasg";"id_compra";"numero_item";"identificacao_participante";"nome_participante";"classificacao"');
    filtro.linha('"788820";"78882005900332025";"107";"11111111000191";"SEGUNDO LTDA";"2"');
    return { mes, linhas: 2, bytes: 1 };
  };
  assert.equal(await H.completarConsultas({ rest, lerMes }), 1);
  assert.deepEqual(patches, ["completo"]);
  assert.equal(gravado[0].fornecedor_nome, "SEGUNDO LTDA");
  patches.length = 0;
  await H.completarConsultas({ rest, lerMes: async () => { throw new Error("HTTP 503"); } });
  assert.deepEqual(patches, ["falhou"]);
});
