const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../_licitacao_anterior");
const { validarConsulta, chaveConsulta, handler } = require("../licitacao-anterior");

test("casamento: CATMAT igual é alto, PDM igual é médio, CATMAT diferente sem PDM não casa", () => {
  assert.equal(L.casar({ catmat: "463574" }, { catmat: "463574" }).confianca, "alta");
  assert.equal(L.casar({ catmat: "1", pdm: "19766" }, { catmat: "2", pdm: "19766" }).confianca, "media");
  assert.equal(L.casar({ catmat: "1", descricao: "café torrado" }, { catmat: "2", descricao: "café torrado" }), null);
});

test("casamento por palavras exige o nome do produto em comum (baixa confiança)", () => {
  const c = L.casar({ descricao: "Café torrado e moído, pacote 500 g" }, { descricao: "CAFÉ, APRESENTAÇÃO: TORRADO MOÍDO, TIPO: SUPERIOR" });
  assert.equal(c.confianca, "baixa");
  assert.equal(L.casar({ descricao: "Papel A4 sulfite branco" }, { descricao: "Pasta suspensa papel A4 branco" }), null);
  assert.equal(L.casar({ descricao: "" }, { descricao: "café" }), null);
  assert.deepEqual(L.palavras("Aquisição de café, apresentação: torrado 500g"), ["cafe", "torrado"]);
});

test("melhor casamento escolhe o mais forte entre os itens do edital", () => {
  const m = L.melhorCasamento([{ numero: 1, descricao: "café torrado" }, { numero: 2, catmat: "463574" }], { catmat: "463574", descricao: "café torrado" });
  assert.equal(m.alvo.numero, 2);
  assert.equal(m.casamento.confianca, "alta");
});

test("marca: suja vira null, útil fica; chave junta acentos e caixa", () => {
  assert.equal(L.normalizarMarca("500GR", "Café"), null);
  assert.equal(L.normalizarMarca("Conforme Termo de Re", "Café"), null);
  assert.equal(L.normalizarMarca("", "Café"), null);
  assert.equal(L.normalizarMarca("GARCIA", "Café torrado"), "GARCIA");
  assert.equal(L.chaveMarca("PILÃO"), L.chaveMarca("pilao"));
});

test("fornecedor pessoa física nunca guarda CPF nem nome", () => {
  assert.deepEqual(L.fornecedor("123.456.789-01", "Maria da Silva", "r1"), { fornecedor_chave: "pf:r1", fornecedor_ni: null, fornecedor_nome: "Pessoa física" });
  assert.equal(L.fornecedor("38350458000143", "C R DA SILVA", "x").fornecedor_ni, "38350458000143");
  // MEI: a razão social pública traz o CPF do titular; o CPF sai, a raiz do CNPJ ("58.206.106") fica.
  assert.equal(L.fornecedor("11111111000191", "BRUNA ALMEIDA 97048143215", "x").fornecedor_nome, "BRUNA ALMEIDA");
  assert.equal(L.fornecedor("11111111000191", "FULANO 123.456.789-01 ME", "x").fornecedor_nome, "FULANO ME");
  assert.equal(L.fornecedor("58206106000191", "58.206.106 THIAGO", "x").fornecedor_nome, "58.206.106 THIAGO");
  // Variações com espaço e barra (revisão de 19/11): também saem.
  assert.equal(L.fornecedor("11111111000191", "FULANA DE TAL 970 481 432 15", "x").fornecedor_nome, "FULANA DE TAL");
  assert.equal(L.fornecedor("11111111000191", "FULANA 970.481.432/15 ME", "x").fornecedor_nome, "FULANA ME");
});

test("link de origem: só https e host oficial; outro host cai no link do Compras.gov", () => {
  assert.equal(L.linkOficial("https://cnetmobile.estaleiro.serpro.gov.br/x?compra=1"), "https://cnetmobile.estaleiro.serpro.gov.br/x?compra=1");
  for (const ruim of ["http://pncp.gov.br/app", "javascript:alert(1)", "https://pncp.gov.br.mal.com/x", "https://u:s@pncp.gov.br/", "https://evil.com/?pncp.gov.br", null, "lixo"]) assert.equal(L.linkOficial(ruim), null, ruim);
  const base = { item_url: "/compras/12345678000195/2025/7", numero_controle_pncp: "x" };
  const oficial = "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/landing?destino=acompanhamento-compra&compra=78882005900332025";
  assert.equal(L.compraDaBusca({ ...base, link_sistema_origem: "https://golpe.com/?compra=78882005900332025" }).link_origem, oficial);
  assert.equal(L.compraDaBusca({ ...base, link_sistema_origem: "javascript:alert(1)//?compra=78882005900332025" }).link_origem, oficial);
  assert.equal(L.compraDaBusca({ ...base, link_sistema_origem: "https://golpe.com/x" }).link_origem, null);
});

// Teste real 19/11: unidade "000000001" (Licitações-E BB) estourava o check uasg ~ '^\d{1,8}$' e a análise por CNPJ dava 502.
test("uasg da busca do PNCP: cabe na coluna (1 a 8 dígitos); UASG de 6 dígitos fica igual", () => {
  const base = { item_url: "/compras/12345678000195/2025/7", numero_controle_pncp: "x" };
  assert.equal(L.compraDaBusca({ ...base, unidade_codigo: "000000001" }).uasg, "1");
  assert.equal(L.compraDaBusca({ ...base, unidade_codigo: "093028" }).uasg, "093028");
  assert.equal(L.compraDaBusca({ ...base, unidade_codigo: "277" }).uasg, "277");
  assert.equal(L.compraDaBusca({ ...base, unidade_codigo: "1234567890" }).uasg, null);
  assert.equal(L.compraDaBusca({ ...base, unidade_codigo: "" }).uasg, null);
});

const U = "22222222-2222-4222-8222-222222222222";
async function comFetchHandler(status, limiteUso, fn) {
  const anterior = global.fetch, chaveAnterior = process.env.SUPABASE_SERVICE_ROLE_KEY, chamadas = [];
  process.env.SUPABASE_SERVICE_ROLE_KEY = "srv";
  global.fetch = async (url, op = {}) => {
    const u = new URL(url);
    chamadas.push(u.pathname);
    if (u.pathname === "/auth/v1/user") return Response.json({ id: U });
    if (u.pathname === "/rest/v1/clientes") return Response.json([{ status }]);
    if (u.pathname === "/rest/v1/rpc/incrementar_uso") { chamadas.push(JSON.parse(op.body).p_funcao); return Response.json(limiteUso); }
    return Response.json({ items: [{ codigo: "788820", nome: "BASE NAVAL" }] });
  };
  try { return await fn(chamadas); } finally {
    global.fetch = anterior;
    if (chaveAnterior === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = chaveAnterior;
  }
}
const pedido = (corpo) => ({ httpMethod: "POST", headers: { authorization: "Bearer T" }, body: JSON.stringify(corpo) });

test("handler: cadastro não aprovado 403 antes de qualquer fonte; órgãos com cota própria", async () => {
  await comFetchHandler("pendente", 1, async (chamadas) => {
    assert.equal((await handler(pedido({ acao: "orgaos", q: "base naval" }))).statusCode, 403);
    assert.equal((await handler(pedido({ acao: "consultar", uasg: "788820", catmat: "1" }))).statusCode, 403);
    assert.ok(!chamadas.some((c) => c.startsWith("/api/")));
  });
  await comFetchHandler("aprovado", 1, async (chamadas) => {
    const r = await handler(pedido({ acao: "orgaos", q: "base naval" }));
    assert.equal(r.statusCode, 200);
    assert.deepEqual(JSON.parse(r.body).orgaos, [{ uasg: "788820", nome: "BASE NAVAL" }]);
    assert.ok(chamadas.includes("licitacao-anterior-orgaos"));
  });
  await comFetchHandler("aprovado", 301, async (chamadas) => {
    assert.equal((await handler(pedido({ acao: "orgaos", q: "base naval" }))).statusCode, 429);
    assert.ok(!chamadas.some((c) => c.startsWith("/api/")));
  });
});

test("id do Compras.gov: decifra e lê o texto do idCompraItem (o número JSON perde precisão)", () => {
  assert.deepEqual(L.decifrarIdCompra("78882005900332025"), { uasg: "788820", modalidade: 5, numero: "90033", ano: 2025, lei14133: true });
  assert.equal(L.decifrarIdCompra("123"), null);
  assert.equal(L.idDaLinhaPesquisa({ idCompra: 7.888200590033202e16, idCompraItem: "7888200590033202500107" }), "78882005900332025");
  assert.equal(L.idDaLinhaPesquisa({ idCompra: 7.888200590033202e16 }), null);
});

const CAB = '﻿"numero_uasg";"id_compra";"id_compra_item";"numero_controle_pncp";"codigo_modalidade";"numero_compra";"ano_compra";"objeto";"numero_item";"descricao";"sigla_unidade_fornecimento";"quantidade_solicitada";"identificacao_participante";"nome_participante";"porte_empresa_participante";"uf";"municipio";"valor_proposta_calculado";"valor_lance_calculado";"valor_negociado_julgamento_calculado";"id";"origem_melhor_valor";"situacao_proposta";"situacao_item";"homologado";"classificacao"';
const linha = (id, item, ni, nome, porte, uf, prop, lance, neg, idp, cls) =>
  `"788820";"${id}";"x";"y";"5";"90033";"2025";"Obj; com ponto e vírgula e ""aspas""";"${item}";"Café";"";"10";"${ni}";"${nome}";"${porte}";"${uf}";"Manaus";"${prop}";"${lance}";"${neg}";"${idp}";"P";"";"1";"S";"${cls}"`;

test("CSV ; com aspas dobradas", () => {
  assert.deepEqual(L.lerLinhaCsv('"a";"b ""c"" ; d";""'), ["a", 'b "c" ; d', ""]);
});

test("filtro de propostas: só compras/itens pedidos, ordem por classificação, CPF fora, teto por item", () => {
  const f = L.criarFiltroPropostas(new Map([["78882005900332025", new Set([107])]]));
  f.linha(CAB);
  f.linha(linha("78882005900332025", 107, "11111111000191", "SEGUNDA LTDA", "2", "AM", "20.00", "18.50", "", "2", "2"));
  f.linha(linha("78882005900332025", 107, "38350458000143", "C R DA SILVA", "1", "AM", "19.00", "17.10", "17.00", "1", "1"));
  f.linha(linha("78882005900332025", 107, "12345678901", "PESSOA FISICA REAL", "5", "PA", "25.00", "", "", "3", ""));
  f.linha(linha("78882005900332025", 108, "22222222000191", "OUTRO ITEM", "1", "AM", "1", "", "", "4", "1"));
  f.linha(linha("99999905900012025", 107, "33333333000191", "OUTRA COMPRA", "1", "AM", "1", "", "", "5", "1"));
  const { linhas, itens } = f.resultado();
  assert.equal(itens, 1);
  assert.deepEqual(linhas.map((l) => l.fornecedor_nome), ["C R DA SILVA", "SEGUNDA LTDA", "Pessoa física"]);
  assert.equal(linhas[0].porte, "ME");
  assert.equal(linhas[0].valor_negociado, 17);
  assert.equal(linhas[1].valor_negociado, null);
  assert.equal(linhas[2].fornecedor_ni, null);
  assert.ok(!JSON.stringify(linhas).includes("12345678901"));
  assert.ok(!JSON.stringify(linhas).includes("PESSOA FISICA REAL"));

  const g = L.criarFiltroPropostas(new Map([["78882005900332025", new Set([1])]]));
  g.linha(CAB);
  for (let i = 0; i < 40; i++) g.linha(linha("78882005900332025", 1, String(10000000000000 + i), `F${i}`, "1", "AM", "1", "", "", String(i), String(i + 1)));
  assert.equal(g.resultado().linhas.length, L.MAX_PROPOSTAS_ITEM);
});

test("meses do arquivo de propostas: mês da publicação e o seguinte, desde 2022, com teto", () => {
  assert.deepEqual(L.mesesDePropostas([{ data_publicacao: "2025-12-18" }, { data_publicacao: "2021-03-01" }], 4), ["2026/01", "2025/12"]);
  assert.deepEqual(L.mesesDePropostas([{ data_publicacao: "2025-08-18" }, { data_publicacao: "2024-04-12" }], 3), ["2025/09", "2025/08", "2024/05"]);
  assert.deepEqual(L.mesesDePropostas([{ data_publicacao: null }], 4), []);
});

// Fontes falsas: Pesquisa de Preços, busca do PNCP, itens e resultados.
function fontes({ resultados } = {}) {
  const chamadas = [];
  const resp = (corpo, status = 200) => ({ ok: status < 400, status, json: async () => corpo });
  const fetchImpl = async (url) => {
    chamadas.push(url);
    const u = new URL(url);
    if (u.pathname.endsWith("1_consultarMaterial")) return resp({ resultado: [
      { idCompraItem: "7888200590033202500107", numeroItemCompra: 107, niFornecedor: "38350458000143", nomeFornecedor: "C R DA SILVA", precoUnitario: 17, marca: "250G", descricaoItem: "Café", codigoPdm: "19766", dataCompra: "2025-11-11" },
      { idCompraItem: "7888200590038202400005", numeroItemCompra: 5, niFornecedor: "39435028000197", nomeFornecedor: "ECOMMERCE HN LTDA", precoUnitario: 11.3, marca: "GARCIA", descricaoItem: "Café", codigoPdm: "19766", dataCompra: "2025-04-17" },
      { idCompraItem: "7888200500026202200011", numeroItemCompra: 11, niFornecedor: "37636059000180", nomeFornecedor: "ANTIGA", precoUnitario: 14, marca: "TRES CORAÇÕES", descricaoItem: "Café", dataCompra: "2022-08-24" },
    ] });
    if (u.pathname === "/api/search") {
      const id = u.searchParams.get("q");
      const seq = id === "78882005900332025" ? "3596" : "19521";
      return resp({ items: [{ item_url: `/compras/00394502002864/${id.slice(-4)}/${seq}`, link_sistema_origem: `https://x/?compra=${id}`, numero_controle_pncp: `00394502002864-1-00${seq}/${id.slice(-4)}`,
        unidade_codigo: "788820", numero: id.slice(8, 13), data_publicacao_pncp: id.endsWith("2025") ? "2025-08-18T07:00" : "2025-01-23T07:00", modalidade_licitacao_nome: "Pregão - Eletrônico", usuario_nome: "Compras.gov.br" }] });
    }
    if (u.pathname.endsWith("/itens") && u.pathname.includes("/3596/")) return resp([
      { numeroItem: 107, catalogoCodigoItem: "463574", descricao: "Café", valorUnitarioEstimado: 23.33, situacaoCompraItemNome: "Homologado", temResultado: true },
      { numeroItem: 108, catalogoCodigoItem: "463574", descricao: "Café", valorUnitarioEstimado: 35.62, situacaoCompraItemNome: "Fracassado", temResultado: false },
      { numeroItem: 1, catalogoCodigoItem: "111", descricao: "Arroz", valorUnitarioEstimado: 5, situacaoCompraItemNome: "Homologado", temResultado: true },
    ]);
    if (u.pathname.endsWith("/itens")) return resp([{ numeroItem: 5, catalogoCodigoItem: "463574", descricao: "Café", valorUnitarioEstimado: 14.35, situacaoCompraItemNome: "Homologado", temResultado: true }]);
    if (u.pathname.endsWith("/resultados")) return resp(resultados || [
      { niFornecedor: "38350458000143", nomeRazaoSocialFornecedor: "C R DA SILVA", ordemClassificacaoSrp: 1, situacaoCompraItemResultadoNome: "Informado", valorUnitarioHomologado: 17, porteFornecedorNome: "ME" },
      { niFornecedor: "12345678901", tipoPessoa: "PF", nomeRazaoSocialFornecedor: "JOAO PESSOA", ordemClassificacaoSrp: 2, situacaoCompraItemResultadoNome: "Informado cadastro de reserva", valorUnitarioHomologado: 17 },
      { niFornecedor: "48885922000150", nomeRazaoSocialFornecedor: "DESISTIU LTDA", ordemClassificacaoSrp: 3, situacaoCompraItemResultadoNome: "Cancelado", motivoCancelamento: "Não assinou a ata." },
    ]);
    return resp(null, 404);
  };
  return { fetchImpl, chamadas };
}

test("coleta: descobre pela Pesquisa de Preços, completa pelo PNCP, acha o fracassado e respeita o período", async () => {
  const { fetchImpl } = fontes();
  const r = await L.coletar({ uasg: "788820", alvos: [{ numero: 3, catmat: "463574", descricao: "café" }], excluir: ["99999905900012026"], desdeAno: 2023, fetchImpl });
  assert.deepEqual(r.compras.map((c) => c.id_compra).sort(), ["78882005900332025", "78882005900382024"]);
  const fracassado = r.itens.find((i) => i.numero_item === 108);
  assert.equal(fracassado.situacao_item, "Fracassado");
  assert.ok(!r.itens.some((i) => i.numero_item === 1), "item de outro produto não casa");
  const v = r.participacoes.find((p) => p.numero_item === 107 && p.fornecedor_ni === "38350458000143");
  assert.equal(v.marca, null); assert.equal(v.marca_declarada, "250G"); assert.equal(v.ordem_classificacao, 1);
  const cancelado = r.participacoes.find((p) => p.situacao_resultado === "Cancelado");
  assert.equal(cancelado.motivo_cancelamento, "Não assinou a ata.");
  assert.ok(!JSON.stringify(r).includes("12345678901") && !JSON.stringify(r).includes("JOAO PESSOA"), "CPF e nome de pessoa física fora");
  assert.ok(r.casamentos.every((c) => c.item_edital === 3 && c.confianca === "alta"));
  assert.equal(r.parcial, false);
});

test("coleta: orçamento esgotado devolve o que tem, marcado parcial, sem passar do teto de chamadas", async () => {
  const { fetchImpl, chamadas } = fontes();
  const r = await L.coletar({ uasg: "788820", alvos: [{ catmat: "463574" }], desdeAno: 2023, fetchImpl, orcamento: 3 });
  assert.equal(chamadas.length, 3);
  assert.equal(r.parcial, true);
  assert.ok(r.avisos.some((a) => /robô completa/.test(a)));
  // Participação só entra com o item (FK do banco).
  const itens = new Set(r.itens.map((i) => `${i.id_compra}|${i.numero_item}`));
  assert.ok(r.participacoes.every((p) => itens.has(`${p.id_compra}|${p.numero_item}`)));
});

test("coleta: fonte fora do ar vira aviso, não exceção", async () => {
  const r = await L.coletar({ uasg: "788820", alvos: [{ catmat: "463574" }], desdeAno: 2023,
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  assert.deepEqual(r.compras, []);
  assert.ok(r.avisos.some((a) => /Pesquisa de Preços indisponível/.test(a)));
});

test("gravar: upsert por grupo de colunas, na ordem compra -> item -> participação", async () => {
  const pedidos = [];
  const rest = async (caminho, op) => { pedidos.push({ caminho, linhas: JSON.parse(op.body) }); return { ok: true }; };
  await L.gravar(rest, { compras: [{ id_compra: "1" }], itens: [{ id_compra: "1", numero_item: 1 }],
    participacoes: [{ id_compra: "1", numero_item: 1, fornecedor_chave: "a", marca: "X" }, { id_compra: "1", numero_item: 1, fornecedor_chave: "a", ordem_classificacao: 1 }] });
  assert.deepEqual(pedidos.map((p) => p.caminho.split("?")[0]), ["historico_compras", "historico_itens", "historico_participacoes", "historico_participacoes"]);
  assert.ok(!("ordem_classificacao" in pedidos[2].linhas[0]), "a linha da marca não manda ordem (não apaga o PNCP)");
});

test("consulta avulsa: valida órgão, produto e período; chave estável", () => {
  assert.match(validarConsulta({ uasg: "", catmat: "1" }).erro, /órgão/);
  assert.match(validarConsulta({ uasg: "788820" }).erro, /CATMAT/);
  assert.match(validarConsulta({ uasg: "788820", catmat: "1", anos: 5 }).erro, /1 a 3/);
  const c = validarConsulta({ uasg: "788820", palavras: "  Café  torrado ", anos: 2 });
  assert.deepEqual(c, { uasg: "788820", catmat: null, palavras: "Café torrado", anos: 2 });
  assert.equal(chaveConsulta(c, 2024), chaveConsulta({ ...c, palavras: "café, TORRADO" }, 2024));
});

test("coleta pelos dados abertos (3 chamadas por compra): CATMAT do item, todos os resultados e motivo do cancelamento", async () => {
  const chamadas = [];
  const resp = (corpo) => ({ ok: true, status: 200, json: async () => corpo });
  const fetchImpl = async (url) => {
    chamadas.push(url);
    const u = new URL(url);
    if (u.pathname.endsWith("1_consultarMaterial")) return resp({ resultado: [{ idCompraItem: "1930280590008202500021", numeroItemCompra: 21, niFornecedor: "41513533000154", nomeFornecedor: "ROYAL", marca: "YPÊ", descricaoItem: "Detergente", codigoPdm: "7" }] });
    if (u.pathname.endsWith("1.1_consultarContratacoes_PNCP_14133_Id")) return resp({ resultado: [{ numeroControlePNCP: "04407029000143-1-000051/2025", orgaoEntidadeCnpj: "04407029000143", anoCompraPncp: 2025, sequencialCompraPncp: 51, numeroCompra: "90008", modalidadeNome: "Pregão - Eletrônico", dataPublicacaoPncp: "2025-12-11T07:03:38", unidadeOrgaoCodigoUnidade: "193028" }] });
    if (u.pathname.endsWith("2.1_consultarItensContratacoes_PNCP_14133_Id")) return resp({ resultado: [
      { idCompraItem: "1930280590008202500021", codItemCatalogo: 999, codigoPdm: "7", descricaoResumida: "Detergente", valorUnitarioEstimado: 60, situacaoCompraItemNome: "Homologado", temResultado: true },
      { idCompraItem: "1930280590008202500030", codItemCatalogo: 999, codigoPdm: "7", descricaoResumida: "Detergente", valorUnitarioEstimado: 9, situacaoCompraItemNome: "Fracassado", temResultado: false },
      { idCompraItem: "1930280590008202500001", codItemCatalogo: 429961, codigoPdm: "1", descricaoResumida: "Álcool", temResultado: true },
    ], paginasRestantes: 0 });
    if (u.pathname.endsWith("3.1_consultarResultadoItensContratacoes_PNCP_14133_Id")) return resp({ resultado: [
      { idCompraItem: "1930280590008202500021", niFornecedor: "41513533000154", nomeRazaoSocialFornecedor: "ROYAL", ordemClassificacaoSrp: 1, situacaoCompraItemResultadoNome: "Cancelado", motivoCancelamento: "Não assinou a ata.", porteFornecedorNome: "ME" },
      { idCompraItem: "1930280590008202500021", niFornecedor: "22222222000191", nomeRazaoSocialFornecedor: "RESERVA", ordemClassificacaoSrp: 2, situacaoCompraItemResultadoNome: "Informado cadastro de reserva", valorUnitarioHomologado: 55 },
      { idCompraItem: "1930280590008202500001", niFornecedor: "33333333000191", nomeRazaoSocialFornecedor: "ALCOOL", ordemClassificacaoSrp: 1 },
    ], paginasRestantes: 0 });
    throw new Error(`chamada inesperada ${url}`);
  };
  const r = await L.coletar({ uasg: "193028", alvos: [{ numero: 4, catmat: "999", descricao: "detergente" }], desdeAno: 2024, fetchImpl });
  assert.equal(chamadas.length, 4, "1 Pesquisa de Preços + 3 dados abertos, nenhuma ao PNCP");
  assert.equal(r.compras[0].numero_controle_pncp, "04407029000143-1-000051/2025");
  assert.deepEqual(r.itens.map((i) => [i.numero_item, i.situacao_item]).sort(), [[21, "Homologado"], [30, "Fracassado"]]);
  const p21 = r.participacoes.filter((p) => p.numero_item === 21);
  assert.deepEqual(p21.map((p) => p.fornecedor_nome).sort(), ["RESERVA", "ROYAL"]);
  const royal = p21.find((p) => p.fornecedor_nome === "ROYAL");
  assert.equal(royal.motivo_cancelamento, "Não assinou a ata.");
  assert.equal(royal.marca, "YPÊ", "marca da Pesquisa de Preços e resultado do mesmo fornecedor numa linha só");
  assert.ok(!r.participacoes.some((p) => p.fornecedor_nome === "ALCOOL"), "resultado de item não casado fica de fora");
});

test("marca: sobras sem marca ('O MESMO', 'USO GERAL', 'ORIGINAL') viram não informada", () => {
  for (const m of ["O MESMO", "USO GERAL", "Original", "ONDULADAS"]) assert.equal(L.normalizarMarca(m, "Caixa de papelão"), null, m);
  assert.equal(L.normalizarMarca("JOCAR", "Pincel atômico"), "JOCAR");
});
