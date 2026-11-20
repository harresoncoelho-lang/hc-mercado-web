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

test("etapa historico: /api/consulta fora (5xx ou timeout) usa /api/pncp/v1, sem barra final; 4xx não troca de fonte", async (t) => {
  t.mock.method(console, "warn", () => {});
  for (const falha of [() => resposta({}, 503), () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); }]) {
    const pedidos = [];
    const fontesReserva = async (url) => {
      pedidos.push(url);
      const u = new URL(url);
      if (u.pathname.startsWith("/api/consulta/v1/orgaos/")) return falha();
      if (u.pathname === "/api/pncp/v1/orgaos/00394502002864/compras/2026/4000") return fontes(url.replace("/api/pncp/v1/", "/api/consulta/v1/"));
      return fontes(url);
    };
    const d = await H.etapaHistorico(tarefa, { rest: banco().rest, fetchPncp: fontesReserva, esperar: async () => {}, lerMes: async (mes) => ({ mes, linhas: 0, bytes: 0 }) });
    assert.equal(d.uasg, "788820");
    assert.ok(pedidos.includes("https://pncp.gov.br/api/pncp/v1/orgaos/00394502002864/compras/2026/4000"));
    assert.ok(pedidos.every((p) => !new URL(p).pathname.endsWith("/")));
  }
  const pedidos = [];
  const so400 = async (url) => { pedidos.push(url); return new URL(url).pathname.startsWith("/api/consulta/") ? resposta({}, 400) : fontes(url); };
  await assert.rejects(H.etapaHistorico(tarefa, { rest: banco().rest, fetchPncp: so400, esperar: async () => {} }), /PNCP HTTP 400/);
  assert.equal(pedidos.filter((p) => p.includes("/api/pncp/v1/orgaos/00394502002864/compras/2026/4000")).length, 0);
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

test("arquivo de propostas: teto no CSV descompactado (fluxo real) e no ZIP baixado", async () => {
  const AdmZip = require("adm-zip");
  const z = new AdmZip(); z.addFile("p.csv", Buffer.from("a;b\n".repeat(500000)));
  const zip = z.toBuffer();
  const filtro = { linha() {} };
  const fetchImpl = async () => new Response(zip);
  await assert.rejects(H.lerMesPropostas("2025/09", filtro, { fetchImpl, maxCsv: 100000 }), /CSV passou de/);
  await assert.rejects(H.lerMesPropostas("2025/09", filtro, { fetchImpl, maxZip: 100 }), /grande demais/);
  const ok = await H.lerMesPropostas("2025/09", filtro, { fetchImpl });
  assert.equal(ok.linhas, 500000);
});

test("consultas avulsas: cada rodada pede a limpeza do cache de 30 dias", async () => {
  const rpcs = [];
  const rest = async (caminho, op = {}) => { if (caminho.startsWith("rpc/")) rpcs.push([caminho, JSON.parse(op.body)]); return resposta(caminho.startsWith("rpc/") ? 4 : []); };
  assert.equal(await H.completarConsultas({ rest, lerMes: async () => ({}) }), 0);
  assert.deepEqual(rpcs, [["rpc/historico_limpar_cache", { p_dias: 30 }]]);
});

// ---------- ComprasNet antigo (pregões até 2023, páginas públicas sem captcha) ----------
const fs = require("node:fs");
const path = require("node:path");
const fixture = (n) => fs.readFileSync(path.join(__dirname, "../netlify/functions/__tests__/fixtures/comprasnet-antigo", n));
const ID_IFAM = "15814205000232022"; // IFAM (UASG 158142), pregão 23/2022

function portalAntigo(pedidos) {
  return async (url, op = {}) => {
    const u = new URL(url);
    pedidos.push({ url: String(url), t: Date.now() });
    const arq = { "/livre/pregao/ata4.asp": "ata4.html", "/livre/pregao/ata2.asp": "ata2.html", "/livre/pregao/FornecedorResultadoDecreto.asp": "fornecedor-ifam.html", "/livre/pregao/termojulg.asp": "termo-ifam.html" }[u.pathname];
    return arq ? new Response(fixture(arq), { status: 200 }) : new Response("x", { status: 404 });
  };
}
const restAntigo = (jaLidas = []) => async (caminho) => resposta(caminho.startsWith("historico_compras?") ? jaLidas.map((id_compra) => ({ id_compra })) : []);

test("ComprasNet antigo: grava fonte, link público, situação e vencedor do item, sem apagar a marca da Pesquisa de Preços", async () => {
  const pedidos = [];
  const compras = [{ id_compra: ID_IFAM, plataforma: "ComprasNet (antigo)", data_publicacao: null }, { id_compra: "78882005900332025", plataforma: "Compras.gov.br" }];
  const r = await H.lerComprasAntigas({ compras, numeros: new Map([[ID_IFAM, new Set([1, 2])], ["78882005900332025", new Set([107])]]) },
    { rest: restAntigo(), fetchImpl: portalAntigo(pedidos), esperar: async () => {}, agora: () => Date.parse("2026-11-19T12:00:00Z") });
  assert.deepEqual(r.resumo, { pregoes: 1, lidos: 1, jaLidos: 0, naoAchados: 0, falhas: 0 });
  assert.deepEqual(r.compras, [{ id_compra: ID_IFAM, link_origem: "https://www.comprasnet.gov.br/livre/pregao/ata2.asp?co_no_uasg=158142&numprp=232022&codigoModalidade=5",
    fonte: "comprasnet-antigo", fonte_lida_em: "2026-11-19T12:00:00.000Z", data_publicacao: "2022-12-05" }]);
  assert.equal(r.itens.length, 2);
  assert.equal(r.itens[0].situacao_item, "Adjudicado");
  assert.equal(r.itens[0].tem_resultado, true);
  assert.ok(!("motivo_situacao" in r.itens[0]), "campo vazio não vai (o upsert por colunas não pode apagar)");
  const p = r.participacoes[0];
  assert.equal(p.fornecedor_ni, "08759521000139");
  assert.equal(p.ordem_classificacao, 1);
  assert.equal(p.valor_homologado, 5689.01);
  assert.equal(p.quantidade_homologada, 36);
  assert.equal(p.data_resultado, "2022-12-05");
  assert.ok(!("marca" in p), "grupo não traz marca: não manda null por cima da marca da Pesquisa de Preços");
  assert.equal(pedidos.length, 4);
  assert.ok(pedidos.every((x) => !/AtaEletronico/i.test(x.url)));
});

test("ComprasNet antigo: marca e descrição ofertada entram quando o item aparece no Resultado por Fornecedor; compra já lida não é relida", async () => {
  const pedidos = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    pedidos.push(u.pathname);
    const arq = { "/livre/pregao/ata4.asp": "ata4.html", "/livre/pregao/ata2.asp": "ata2.html", "/livre/pregao/FornecedorResultadoDecreto.asp": "fornecedor-inpa.html", "/livre/pregao/termojulg.asp": "termo-inpa.html" }[u.pathname];
    const t = fixture(arq).toString("latin1").split("232022").join("132022").split("158142").join("240105");
    return new Response(Buffer.from(t, "latin1"), { status: 200 });
  };
  const id = "24010505000132022";
  const entrada = { compras: [{ id_compra: id, plataforma: "ComprasNet (antigo)", data_publicacao: "2022-12-05" }], numeros: new Map([[id, new Set([1, 4])]]) };
  const r = await H.lerComprasAntigas(entrada, { rest: restAntigo(), fetchImpl, esperar: async () => {} });
  const p1 = r.participacoes.find((x) => x.numero_item === 1);
  assert.equal(p1.marca, "Proc9");
  assert.equal(p1.fabricante, "Proc9");
  assert.equal(p1.modelo, "proc9");
  assert.match(p1.descricao_ofertada, /^Ácido Sulfúrico/);
  assert.equal(p1.valor_homologado, 147.12);
  assert.ok(!("data_publicacao" in r.compras[0]), "data que a Pesquisa de Preços já trouxe não é trocada");
  pedidos.length = 0;
  const de_novo = await H.lerComprasAntigas(entrada, { rest: restAntigo([id]), fetchImpl, esperar: async () => {} });
  assert.equal(de_novo.resumo.jaLidos, 1);
  assert.equal(pedidos.length, 0);
});

test("ComprasNet antigo: item cancelado grava situação e motivo literal, sem vencedor; pregão fora da lista e falha HTTP não derrubam a tarefa", async () => {
  const termo = fixture("termo-cancelado.html").toString("latin1");
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith("ata4.asp")) return new Response(fixture("ata4.html").toString("latin1").split("232022").join("32022").split("158142").join("160014"), { status: 200 });
    if (u.pathname.endsWith("ata2.asp")) return new Response(fixture("ata2.html"), { status: 200 });
    if (u.pathname.endsWith("FornecedorResultadoDecreto.asp")) return new Response(fixture("fornecedor-ifam.html"), { status: 200 });
    return new Response(Buffer.from(termo, "latin1"), { status: 200 });
  };
  const id = "16001405000032022";
  const r = await H.lerComprasAntigas({ compras: [{ id_compra: id, plataforma: "ComprasNet (antigo)" }, { id_compra: "99999905000012021", plataforma: "ComprasNet (antigo)" }],
    numeros: new Map([[id, new Set([3])], ["99999905000012021", new Set([1])]]) }, { rest: restAntigo(), fetchImpl, esperar: async () => {} });
  assert.equal(r.itens[0].situacao_item, "Cancelado no julgamento");
  assert.equal(r.itens[0].motivo_situacao, "Por não haver propostas validas para continuidade do item.");
  assert.equal(r.itens[0].tem_resultado, false);
  assert.equal(r.participacoes.length, 0);
  assert.equal(r.resumo.naoAchados, 1); // o segundo pregão não está na lista do portal
  const falha = await H.lerComprasAntigas({ compras: [{ id_compra: id, plataforma: "ComprasNet (antigo)" }], numeros: new Map([[id, new Set([3])]]) },
    { rest: restAntigo(), fetchImpl: async () => new Response("x", { status: 503 }), esperar: async () => {} });
  assert.equal(falha.resumo.falhas, 1);
  assert.equal(falha.compras.length, 0);
});

test("ComprasNet antigo: pausa mínima de 1,5 s entre as páginas, com relógio falso", async () => {
  let t = 0;
  const esperas = [];
  const mapa = new Map([[ID_IFAM, new Set([1])], ["15814205000242022", new Set([1])]]);
  const fetchImpl = async (url) => {
    const u = new URL(url);
    const arq = { "/livre/pregao/ata4.asp": "ata4.html", "/livre/pregao/ata2.asp": "ata2.html", "/livre/pregao/FornecedorResultadoDecreto.asp": "fornecedor-ifam.html", "/livre/pregao/termojulg.asp": "termo-ifam.html" }[u.pathname];
    const texto = fixture(arq).toString("latin1").split("232022").join(String(Number(u.searchParams.get("numprp") || "232022")));
    return new Response(Buffer.from(texto, "latin1"), { status: 200 });
  };
  await H.lerComprasAntigas({ compras: [...mapa.keys()].map((id_compra) => ({ id_compra, plataforma: "ComprasNet (antigo)" })), numeros: mapa },
    { rest: restAntigo(), fetchImpl, esperar: async (ms) => { esperas.push(ms); t += ms; }, agora: () => t });
  assert.ok(esperas.length >= 3);
  assert.ok(esperas.every((ms) => ms >= 1500));
});
