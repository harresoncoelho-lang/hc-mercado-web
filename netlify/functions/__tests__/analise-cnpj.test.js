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
