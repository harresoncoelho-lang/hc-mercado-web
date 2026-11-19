const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../_analise_cnpj");
const { coletarNaHora } = require("../analise-cnpj");

const resposta = (corpo, status = 200) => ({ ok: status < 400, status, json: async () => corpo });

test("CNPJ: dígito verificador e repetidos", () => {
  assert.equal(A.cnpjValido("48885922000150"), true);
  assert.equal(A.cnpjValido("48885922000151"), false);
  assert.equal(A.cnpjValido("11111111111111"), false);
  assert.equal(A.cnpjValido("1234567890"), false);
});

test("meses do arquivo: do mais novo para trás, nunca antes de 2022", () => {
  assert.deepEqual(A.mesesJanela(Date.UTC(2026, 10, 19), 3), ["2026/11", "2026/10", "2026/09"]);
  assert.deepEqual(A.mesesJanela(Date.UTC(2022, 1, 5), 12), ["2022/02", "2022/01"]);
});

test("fornecedores do PNCP: CNPJ vai com máscara, CPF é descartado, ids juntados por CNPJ", async () => {
  const urls = [];
  const b = { json: async (u) => { urls.push(u); return { items: [
    { id: "318274", ni: "48.277.272/0001-60", nome: "T V PEREIRA SUPRIMENTOS LTDA", total: 28 },
    { id: "72618", ni: "38.611.681/0001-05", nome: "T V PEREIRA ENGENHARIA LTDA", total: 5 },
    { id: "72619", ni: "38.611.681/0001-05", nome: "T V PEREIRA ENGENHARIA", total: 4 },
    { id: "9", ni: "123.456.789-01", nome: "FULANO", total: 99 }] }; } };
  const lista = await A.sugerirFornecedores(b, "48277272000160");
  assert.match(urls[0], /q=48\.277\.272%2F0001-60/);
  assert.deepEqual(lista.map((f) => f.cnpj), ["48277272000160", "38611681000105"]);
  assert.deepEqual(lista[1].ids, ["72618", "72619"]);
  await A.sugerirFornecedores(b, "T V Pereira");
  assert.match(urls[1], /q=T%20V%20Pereira/);
});

const CAB = String.fromCharCode(0xfeff) + '"numero_uasg";"id_compra";"id_compra_item";"numero_controle_pncp";"codigo_modalidade";"numero_compra";"ano_compra";"objeto";"numero_item";"descricao";"sigla_unidade_fornecimento";"quantidade_solicitada";"identificacao_participante";"nome_participante";"porte_empresa_participante";"uf";"municipio";"valor_proposta_calculado";"valor_lance_calculado";"valor_negociado_julgamento_calculado";"id";"origem_melhor_valor";"situacao_proposta";"situacao_item";"homologado";"classificacao";"data_hora_inclusao";"data_hora_alteracao";"data_hora_alteracao_homologacao"';
const linha = (id, item, ni, nome, sp, sitItem, cls, lance) =>
  `"788820";"${id}";"x";"00394502002864-1-003596/2025";"5";"90033";"2025";"Gêneros secos";"${item}";"Café";"PCT";"10";"${ni}";"${nome}";"1";"AM";"Manaus";"30";"${lance}";"";"${item}${cls}";"L";"${sp}";"${sitItem}";"S";"${cls}";"2025-08-01 10:00:00";"";"2025-09-02 11:00:00"`;

test("arquivo de propostas: linhas do CNPJ + vencedor do item, sem CPF, sem lote, com situação crua", () => {
  const f = A.criarFiltroCnpjs(new Set(["48885922000150"]));
  for (const l of [CAB,
    linha("78882005900332025", 107, "38350458000143", "C R DA SILVA", "6", "1", "1", "17"),
    linha("78882005900332025", 107, "48885922000150", "F M DE MORAES", "", "1", "2", "18.5"),
    linha("78882005900332025", 107, "11122233344", "FULANA", "", "1", "3", "19"),
    linha("78882005900332025", 108, "48885922000150", "F M DE MORAES", "2", "8", "1", "20"),
    linha("78882005900332025", 109, "38350458000143", "C R DA SILVA", "6", "1", "1", "5"),
    linha("78882005900332025", -1, "48885922000150", "F M DE MORAES", "", "1", "1", "5"),
    linha("98750105000072026", 1, "38350458000143", "C R DA SILVA", "6", "1", "1", "9")]) f.linha(l);
  const r = f.resultado();
  assert.equal(r.compras.length, 1);
  assert.equal(r.compras[0].link_pncp, "https://pncp.gov.br/app/editais/00394502002864/2025/3596");
  assert.equal(r.compras[0].modalidade, "Pregão");
  assert.equal(r.compras[0].uasg, "788820");
  const chaves = r.participacoes.map((p) => `${p.numero_item}|${p.fornecedor_chave}`).sort();
  assert.deepEqual(chaves, ["107|38350458000143", "107|48885922000150", "108|48885922000150"]);
  const recusada = r.participacoes.find((p) => p.numero_item === 108);
  assert.equal(recusada.situacao_proposta, "2");
  assert.equal(recusada.classificacao, 1);
  assert.equal(recusada.data_resultado, "2025-09-02");
  assert.equal(r.itens.find((i) => i.numero_item === 108).situacao_item, "Fracassado");
  assert.equal(r.itens.find((i) => i.numero_item === 107).situacao_item, null);
  assert.ok(!JSON.stringify(r).includes("11122233344"));
});

test("coleta na hora: compras do PNCP viram fila; as do Compras.gov coletadas saem dela", async () => {
  const cnpj = "48885922000150";
  const fetchImpl = async (url) => {
    if (url.includes("/suggest")) return resposta({ items: [{ id: "555", ni: "48.885.922/0001-50", nome: "F. M. DE MORAES LTDA", total: 2 }] });
    if (url.includes("/api/search?")) return resposta({ total: 2, items: [
      { item_url: "/compras/00394502002864/2025/3596", link_sistema_origem: "https://cnetmobile.estaleiro.serpro.gov.br/x?compra=78882005900332025", uf: "AM", orgao_nome: "COMANDO DA MARINHA", data_publicacao_pncp: "2025-08-18" },
      { item_url: "/compras/04312401000123/2025/9", numero_controle_pncp: "04312401000123-1-000009/2025", uf: "RS", usuario_nome: "BLL" }] });
    if (url.includes("1.1_consultar")) return resposta({ resultado: [{ numeroCompra: "90033", anoCompraPncp: 2025, unidadeOrgaoUfSigla: "AM", orgaoEntidadeCnpj: "00394502002864", sequencialCompraPncp: 3596 }] });
    if (url.includes("2.1_consultar")) return resposta({ resultado: [{ idCompraItem: "7888200590033202500107", descricaoResumida: "Café", quantidade: 10, temResultado: true },
      { idCompraItem: "7888200590033202500200", descricaoResumida: "Arroz", quantidade: 5, temResultado: true }] });
    if (url.includes("3.1_consultar")) return resposta({ resultado: [
      { idCompraItem: "7888200590033202500107", niFornecedor: cnpj, nomeRazaoSocialFornecedor: "F. M. DE MORAES LTDA", ordemClassificacaoSrp: 1, valorUnitarioHomologado: 34.89 },
      { idCompraItem: "7888200590033202500200", niFornecedor: "38350458000143", nomeRazaoSocialFornecedor: "C R DA SILVA", ordemClassificacaoSrp: 1, valorUnitarioHomologado: 3 }] });
    throw new Error(`url inesperada ${url}`);
  };
  const r = await coletarNaHora(cnpj, { fetchImpl, agora: Date.UTC(2026, 10, 19) });
  assert.equal(r.total_pncp, 2);
  assert.deepEqual(r.pendentes, ["04312401000123-1-000009/2025"]);
  assert.equal(r.coletadas, 1);
  assert.equal(r.compras.length, 2);
  assert.equal(r.compras.find((c) => c.id_compra === "78882005900332025").uf, "AM");
  assert.deepEqual(r.itens.map((i) => i.numero_item), [107]);
  assert.deepEqual(r.participacoes.map((p) => p.fornecedor_ni), [cnpj]);
  assert.equal(r.meses.length, 24);
  const refeito = await coletarNaHora(cnpj, { fetchImpl, agora: Date.UTC(2026, 10, 19), anterior: { situacao: "completo" } });
  assert.deepEqual(refeito.meses, ["2026/11", "2026/10"]);
});

test("coleta na hora: orçamento curto não perde o que já achou e avisa", async () => {
  const fetchImpl = async (url) => (url.includes("/suggest")
    ? resposta({ items: [{ id: "1", ni: "48.885.922/0001-50", nome: "X", total: 1 }] })
    : resposta({ total: 1, items: [{ item_url: "/compras/00394502002864/2025/3596", link_sistema_origem: "?compra=78882005900332025" }] }));
  const r = await coletarNaHora("48885922000150", { fetchImpl, orcamento: 2 });
  assert.deepEqual(r.pendentes, ["78882005900332025"]);
  assert.match(r.avisos.join(" "), /robô completa/);
});

test("CNPJ sem resultado no PNCP: nada de compra, mas os meses do arquivo entram na fila", async () => {
  const r = await coletarNaHora("11222333000181", { fetchImpl: async () => resposta({ items: [] }), agora: Date.UTC(2026, 10, 19) });
  assert.equal(r.compras.length, 0);
  assert.equal(r.meses[0], "2026/11");
});

// Handler com fetch falso: login, cadastro, cota (incrementar_uso) e contagens da fila.
async function comFetch({ status = "aprovado", uso = 1, parcial = 0, doSolicitante = 0, org = "o1", linha = null }, fn) {
  const anterior = global.fetch, chamadas = [], envAnterior = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "srv";
  global.fetch = async (url, op = {}) => {
    const u = new URL(url);
    chamadas.push(`${op.method || "GET"} ${u.pathname}${u.search}`);
    if (u.pathname === "/auth/v1/user") return Response.json({ id: "u1" });
    if (u.pathname === "/rest/v1/clientes") return Response.json([{ status }]);
    if (u.pathname === "/rest/v1/rpc/incrementar_uso") return Response.json(uso);
    if (u.pathname === "/rest/v1/operacao_membros") return Response.json(org ? [{ organizacao_id: org }] : []);
    if (u.pathname === "/rest/v1/historico_cnpj_consultas" && op.headers?.Prefer === "count=exact") {
      return new Response("[]", { headers: { "content-range": `*/${u.searchParams.get("solicitante") ? doSolicitante : parcial}` } });
    }
    if (u.pathname === "/rest/v1/historico_cnpj_consultas") return Response.json(op.method === "GET" || !op.method ? (linha ? [linha] : []) : []);
    return Response.json({ items: [] });
  };
  try { return await fn(chamadas); } finally { global.fetch = anterior; process.env.SUPABASE_SERVICE_ROLE_KEY = envAnterior; }
}
const { handler } = require("../analise-cnpj");
const pedido = (corpo) => ({ httpMethod: "POST", headers: { authorization: "Bearer T" }, body: JSON.stringify(corpo) });

test("handler: cadastro não aprovado recebe 403 antes de qualquer fonte", async () => {
  await comFetch({ status: "pendente" }, async (chamadas) => {
    const r = await handler(pedido({ acao: "buscar", q: "pereira" }));
    assert.equal(r.statusCode, 403);
    assert.ok(!chamadas.some((c) => c.includes("/api/search")));
  });
});

test("handler: busca por nome tem cota diária", async () => {
  await comFetch({ uso: 101 }, async (chamadas) => {
    const r = await handler(pedido({ acao: "buscar", q: "pereira" }));
    assert.equal(r.statusCode, 429);
    assert.ok(!chamadas.some((c) => c.includes("/api/search")));
  });
  await comFetch({ uso: 1 }, async () => assert.equal((await handler(pedido({ acao: "buscar", q: "pereira" }))).statusCode, 200));
});

test("handler: fila cheia (global ou da organização) recusa antes de coletar e de gastar cota", async () => {
  await comFetch({ parcial: 200 }, async (chamadas) => {
    const r = await handler(pedido({ acao: "coletar", cnpj: "48885922000150" }));
    assert.equal(r.statusCode, 429);
    assert.match(JSON.parse(r.body).erro, /fila de análises está cheia/);
    assert.ok(!chamadas.some((c) => c.includes("incrementar_uso")));
  });
  await comFetch({ doSolicitante: 10 }, async (chamadas) => {
    const r = await handler(pedido({ acao: "coletar", cnpj: "48885922000150" }));
    assert.equal(r.statusCode, 429);
    assert.match(JSON.parse(r.body).erro, /organização já pediu 10/);
    assert.ok(chamadas.some((c) => c.includes("solicitante=eq.o1")));
  });
  await comFetch({ org: null }, async (chamadas) => {
    const r = await handler(pedido({ acao: "coletar", cnpj: "48885922000150" }));
    assert.equal(r.statusCode, 200);
    assert.ok(chamadas.some((c) => c.includes("solicitante=eq.u1"))); // sem organização: o próprio usuário
    const gravou = chamadas.find((c) => c.startsWith("POST /rest/v1/historico_cnpj_consultas"));
    assert.ok(gravou);
  });
});

test("handler: quem pede de novo uma análise parcial marca pedido_em (o robô atende primeiro); análise completa não volta para a fila", async () => {
  const agora = new Date().toISOString();
  const parcial = { cnpj: "48885922000150", nome: "F M", situacao: "parcial", total_pncp: 3, compras_pendentes: ["x"], meses_pendentes: ["2026/10"], meses_lidos: [], gerado_em: agora, atualizado_em: agora };
  await comFetch({ linha: parcial }, async (chamadas) => {
    const r = await handler(pedido({ acao: "coletar", cnpj: "48885922000150" }));
    assert.equal(r.statusCode, 200);
    assert.equal(JSON.parse(r.body).guardado, true);
    assert.ok(chamadas.some((c) => c.startsWith("PATCH /rest/v1/historico_cnpj_consultas?cnpj=eq.48885922000150")));
    assert.ok(!chamadas.some((c) => c.includes("incrementar_uso")), "cache não gasta cota");
  });
  await comFetch({ linha: { ...parcial, situacao: "completo" } }, async (chamadas) => {
    assert.equal(JSON.parse((await handler(pedido({ acao: "coletar", cnpj: "48885922000150" }))).body).guardado, true);
    assert.ok(!chamadas.some((c) => c.startsWith("PATCH")), "completo não entra na fila de novo");
  });
});

// ---------- parte 2: cadastro da Receita e contratos por fornecedor ----------
test("cadastro da Receita: sócio só com nome (sem CPF), MEI sem CPF na razão social, CNAEs e datas", () => {
  const c = A.cadastroDaReceita({ cnpj: "48885922000150", razao_social: "FULANA DE TAL 97048143215", descricao_situacao_cadastral: "ATIVA",
    data_inicio_atividade: "2025-03-01", capital_social: 5000, porte: "MICRO EMPRESA", opcao_pelo_mei: true, cnae_fiscal: 4751201, cnae_fiscal_descricao: "Comércio varejista",
    cnaes_secundarios: [{ codigo: 0, descricao: "" }, { codigo: 9511800, descricao: "Reparação" }], situacao_especial: "",
    qsa: [{ nome_socio: "FULANA DE TAL", cnpj_cpf_do_socio: "***431432**", qualificacao_socio: "Titular", data_entrada_sociedade: "2025-03-01" }, { nome_socio: "123.456.789-01" }] }, "48885922000150", "brasilapi");
  assert.equal(c.razao_social, "FULANA DE TAL");
  assert.deepEqual(c.socios, [{ nome: "FULANA DE TAL", qualificacao: "Titular", entrada: "2025-03-01" }]);
  assert.deepEqual(c.cnae_principal, { codigo: "4751201", descricao: "Comércio varejista" });
  assert.deepEqual(c.cnaes_secundarios.map((x) => x.codigo), ["9511800"]);
  assert.equal(c.situacao_especial, null);
  assert.equal(c.opcao_mei, true);
  assert.ok(!JSON.stringify(c).includes("431432"));
  assert.equal(A.cadastroDaReceita({ cnpj: "11111111000111" }, "48885922000150", "brasilapi"), null, "resposta de outro CNPJ é descartada");
});

test("cadastro: BrasilAPI fora do ar cai para minhareceita; 404 é CNPJ inexistente (sem tentar a reserva)", async () => {
  const urls = [];
  const fetchImpl = async (u) => { urls.push(u); return u.includes("brasilapi") ? resposta({}, 503) : resposta({ cnpj: "48885922000150", razao_social: "X" }); };
  assert.equal((await A.buscarCadastro(fetchImpl, "48885922000150")).fonte, "minhareceita");
  assert.equal(urls.length, 2);
  urls.length = 0;
  assert.equal(await A.buscarCadastro(async (u) => { urls.push(u); return resposta({}, 404); }, "48885922000150"), null);
  assert.equal(urls.length, 1);
  await assert.rejects(A.buscarCadastro(async () => resposta({}, 500), "48885922000150"));
});

test("contrato da busca do PNCP: UF da unidade (sub-rogada vence), outro fornecedor e CPF fora, link do contrato", () => {
  const base = { numero_controle_pncp: "04378626000197-2-000001/2026", fornecedor_ni: "03090004000104", fornecedor_nome: "BMS", uf: "DF", esfera_id: "F",
    valor_global: 10379826.5, data_fim_vigencia: "2027-01-30", ano: "2026", unidade_codigo: "154039" };
  const c = A.contratoDaBusca(base, "03090004000104");
  assert.equal(c.uf, "DF");
  assert.equal(c.link_pncp, "https://pncp.gov.br/app/contratos/04378626000197/2026/1");
  assert.equal(c.vigencia_fim, "2027-01-30");
  assert.equal(A.contratoDaBusca({ ...base, unidade_subrogada_uf: "AM", unidade_subrogada_codigo: "999" }, "03090004000104").uf, "AM");
  assert.equal(A.contratoDaBusca({ ...base, fornecedor_ni: "38350458000143" }, "03090004000104"), null);
  assert.equal(A.contratoDaBusca({ ...base, numero_controle_pncp: "04378626000197-1-000001/2026" }, "03090004000104"), null, "compra não é contrato");
});

test("coleta na hora: traz a 1ª página de contratos do fornecedor e diz se leu tudo", async () => {
  const cnpj = "03090004000104";
  const fetchImpl = async (url) => {
    if (url.includes("/suggest")) return resposta({ items: [{ id: "288035", ni: "03.090.004/0001-04", nome: "BMS", total: 1 }] });
    if (url.includes("tipos_documento=contrato")) return resposta({ total: 150, items: [{ numero_controle_pncp: "04312401000138-2-000003/2024", fornecedor_ni: cnpj, uf: "AM", esfera_id: "E" }] });
    return resposta({ total: 0, items: [] });
  };
  const r = await coletarNaHora(cnpj, { fetchImpl });
  assert.deepEqual(r.contratos.map((c) => c.uf), ["AM"]);
  assert.equal(r.contratos_total, 150);
  assert.equal(r.contratos_completo, false, "150 > 100: o robô lê o resto");
});

test("handler cadastro: cache de 30 dias não gasta cota nem fonte; vencido busca e grava sem CPF; fonte fora devolve o vencido", async () => {
  const { cadastro } = require("../analise-cnpj");
  const responder = (statusCode, body) => ({ statusCode, body });
  const anterior = global.fetch, envAnterior = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "srv";
  const chamadas = [];
  let guardado = [];
  global.fetch = async (url, op = {}) => {
    chamadas.push(`${op.method || "GET"} ${url}`);
    if (String(url).includes("/rest/v1/empresas_cadastro")) return Response.json(op.method === "POST" ? [] : guardado);
    if (String(url).includes("/rpc/incrementar_uso")) return Response.json(1);
    return Response.json({});
  };
  try {
    const agora = Date.UTC(2026, 10, 19);
    guardado = [{ cnpj: "48885922000150", razao_social: "X", consultado_em: new Date(agora - 5 * 864e5).toISOString() }];
    const r1 = await cadastro({ userId: "u1" }, "48885922000150", responder, { agora, fetchImpl: async () => { throw new Error("não devia buscar"); } });
    assert.equal(r1.body.guardado, true);
    assert.ok(!chamadas.some((c) => c.includes("incrementar_uso")));
    guardado = [{ ...guardado[0], consultado_em: new Date(agora - 40 * 864e5).toISOString() }];
    const fonte = async () => resposta({ cnpj: "48885922000150", razao_social: "BMS", qsa: [{ nome_socio: "BENTO", cnpj_cpf_do_socio: "***618002**" }] });
    const r2 = await cadastro({ userId: "u1" }, "48885922000150", responder, { agora, fetchImpl: fonte });
    assert.equal(r2.body.guardado, false);
    assert.ok(chamadas.some((c) => c.startsWith("POST") && c.includes("empresas_cadastro?on_conflict=cnpj")));
    assert.ok(!JSON.stringify(r2.body).includes("618002"));
    const r3 = await cadastro({ userId: "u1" }, "48885922000150", responder, { agora, fetchImpl: async () => { throw new Error("rede"); } });
    assert.deepEqual([r3.statusCode, r3.body.vencido], [200, true]);
    assert.equal((await cadastro({ userId: "u1" }, "123", responder)).statusCode, 400);
  } finally { global.fetch = anterior; process.env.SUPABASE_SERVICE_ROLE_KEY = envAnterior; }
});

test("cadastro: pedaço de CPF mascarado que a Receita põe no nome do MEI também sai", () => {
  const c = A.cadastroDaReceita({ cnpj: "22333444000181", razao_social: "MARLENE DA SILVA ***75059***", nome_fantasia: "LOJA ***.750.59*-**" }, "22333444000181", "brasilapi");
  assert.equal(c.razao_social, "MARLENE DA SILVA");
  assert.ok(!/\d/.test(c.nome_fantasia || ""));
});
