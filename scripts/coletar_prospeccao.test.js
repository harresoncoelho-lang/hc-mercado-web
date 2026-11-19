const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("./coletar_prospeccao");

const EM = "2026-11-19T12:00:00.000Z";
const contrato = {
  numero_controle_pncp: "04378626000197-2-000051/2025", item_url: "/contratos/04378626000197/2025/51", uf: "AM",
  orgao_cnpj: "04378626000197", orgao_nome: "FUNDACAO UNIVERSIDADE DO AMAZONAS", description: "SERVIÇOS DE LIMPEZA", title: "Contrato nº 00027/2025",
  data_inicio_vigencia: "2025-09-22", data_fim_vigencia: "2027-03-22", valor_global: 1439999, tipo_contrato_nome: "Contrato (termo inicial)",
  fornecedor_ni: "10446523000110", fornecedor_nome: "PRESTA SERVICOS TECNICOS LTDA", usuario_nome: "Contratos.gov.br",
};

test("hojeBrasilia usa UTC-3 (02h UTC ainda é o dia anterior)", () => {
  assert.equal(P.hojeBrasilia(Date.parse("2026-11-20T02:00:00Z")), "2026-11-19");
  assert.equal(P.hojeBrasilia(Date.parse("2026-11-20T02:00:00Z"), 30), "2026-12-19");
});

test("contratoInteressa: dentro do horizonte; empenho, cancelado e fora da janela não", () => {
  assert.ok(P.contratoInteressa(contrato, "2026-11-19", "2027-05-18"));
  assert.ok(!P.contratoInteressa({ ...contrato, data_fim_vigencia: "2027-09-22" }, "2026-11-19", "2027-05-18"));
  assert.ok(!P.contratoInteressa({ ...contrato, data_fim_vigencia: "2026-11-18" }, "2026-11-19", "2027-05-18"));
  assert.ok(!P.contratoInteressa({ ...contrato, tipo_contrato_nome: "Empenho" }, "2026-11-19", "2027-05-18"));
  assert.ok(!P.contratoInteressa({ ...contrato, cancelado: true }, "2026-11-19", "2027-05-18"));
});

test("linhaContrato: link oficial, busca sem acento, fornecedor PF não é gravado (LGPD)", () => {
  const l = P.linhaContrato(contrato, EM);
  assert.equal(l.link, "https://pncp.gov.br/app/contratos/04378626000197/2025/51");
  assert.equal(l.data_ref, "2027-03-22");
  assert.match(l.busca, /servicos de limpeza/);
  assert.equal(l.fornecedor_cnpj, "10446523000110");
  const pf = P.linhaContrato({ ...contrato, fornecedor_ni: "12345678901", fornecedor_nome: "FULANO" }, EM);
  assert.equal(pf.fornecedor_cnpj, null);
  assert.equal(pf.fornecedor_nome, null);
});

// E2E 19/11/2026: contrato com pessoa física trazia só o CPF no objeto ("016.471.242-98") e ele ia para o banco.
test("linhaContrato/linhaAta: CPF no objeto sai mascarado, também do texto de busca (LGPD)", () => {
  for (const f of [P.linhaContrato, P.linhaAta]) {
    const l = f({ ...contrato, description: "Locação de imóvel de 016.471.242-98 e 93793162249" }, EM);
    assert.doesNotMatch(JSON.stringify(l), /016\.471\.242-98|93793162249/);
    assert.match(l.objeto, /Locação de imóvel de \*\*\*\.\*\*\*\.\*\*\*-\*\*/);
  }
});

test("linhaItemAta: saldo = homologado ao fornecedor - empenhado, nunca negativo", () => {
  const ata = P.linhaAta({ numero_controle_pncp: "04378626000197-1-000121/2025-000001", item_url: "/atas/04378626000197/2025/121/1", uf: "AM", orgao_cnpj: "04378626000197", description: "Mobiliário", permite_adesao: true, data_fim_vigencia: "2026-12-29" }, EM);
  const item = { numeroControlePncpAta: ata.id.slice(4), numeroItem: "00005", codigoItem: 391199, descricaoItem: "ARMÁRIO ESTANTE", quantidadeHomologadaVencedor: 3, quantidadeEmpenhada: 1, valorUnitario: 742, maximoAdesao: 6, niFornecedor: "48619375000160", nomeRazaoSocialFornecedor: "D DE C NOBRE AZEVEDO", dataVigenciaFinal: "2026-12-29" };
  const l = P.linhaItemAta(item, ata, EM);
  assert.equal(l.saldo, 2);
  assert.equal(l.maximo_adesao, 6);
  assert.equal(l.catmat, "391199");
  assert.equal(l.fonte, "comprasgov_arp");
  assert.equal(l.uf, "AM");
  assert.equal(P.linhaItemAta({ ...item, quantidadeEmpenhada: 9 }, ata, EM).saldo, 0);
});

test("PCA: PNCP e PGC viram a mesma forma, com link da página do PCA no PNCP", () => {
  const org = { nome: "FUNDACAO UNIVERSIDADE DO AMAZONAS" };
  const pncp = P.linhaPcaPncp({ cnpj: "04378626000197", anoPca: 2027, sequencialPca: 1, numeroItem: 9, descricao: "Papel A4", codigoItem: "461806", quantidade: 10, valorUnitario: 25, valorTotal: 250, dataDesejada: "2027-03-01", codigoUnidade: "154039" }, org, "AM", EM);
  assert.equal(pncp.id, "pca:04378626000197-2027-1#9");
  assert.equal(pncp.link, "https://pncp.gov.br/app/pca/04378626000197/2027");
  const pgc = P.linhaPgc({ orgao: "04378626000197", codigoUasg: "154039", anoPcaProjetoCompra: 2027, numeroArtefato: 135, ordemDfd: 5, codigoItemCatalogo: "408845", descricaoItemCatalogo: "XILAZINA", descricaoObjetoDfd: "Medicamentos", quantidadeItem: 2, valorUnitarioItem: 50, valorTotalItem: 100, dataPrevistaFormalizacaoDemanda: "2027-07-30T00:00:00" }, org, "AM", EM);
  assert.equal(pgc.fonte, "pgc");
  assert.equal(pgc.data_ref, "2027-07-30");
  assert.equal(pgc.catmat, "408845");
  assert.equal(pgc.link, "https://pncp.gov.br/app/pca/04378626000197/2027");
});

test("semRepetir: mesma chave fica uma vez (a última)", () => {
  assert.deepEqual(P.semRepetir([{ id: "a", v: 1 }, { id: "b" }, { id: "a", v: 2 }]), [{ id: "a", v: 2 }, { id: "b" }]);
});

test("obter: 204/404 = null; 400 não repete; 5xx repete e desiste", async () => {
  let chamadas = 0;
  const f = (status) => async () => { chamadas++; return { status, ok: status < 300, json: async () => ({}) }; };
  assert.equal(await P.obter("https://x/a", { fetch: f(204), pausaMs: 0 }), null);
  chamadas = 0;
  await assert.rejects(P.obter("https://x/a", { fetch: f(400), pausaMs: 0 }), /HTTP 400/);
  assert.equal(chamadas, 1);
});

// Fonte devolveu UTF-8 lido como Windows-1252 (visto no banco: 5.412 unidade_nome com "SAÃšDE").
test("desfazerMojibake: conserta Ã‡/Ãš/Ã£, deixa texto correto e sequências inválidas intactos", () => {
  assert.equal(P.desfazerMojibake("FUNDAÃ‡ÃƒO UNIVERSIDADE"), "FUNDAÇÃO UNIVERSIDADE");
  assert.equal(P.desfazerMojibake("SECRETARIA DE ESTADO DE SAÃšDE"), "SECRETARIA DE ESTADO DE SAÚDE");
  assert.equal(P.desfazerMojibake("AÃ§Ã£o MÃ©dica"), "Ação Médica");
  for (const ok of ["FUNDAÇÃO", "AÇÃO", "SAÚDE ÃO", "Ã", "ÃO PAULO", "ÂNGULO"]) assert.equal(P.desfazerMojibake(ok), ok);
  assert.equal(P.desfazerMojibake(null), "");
});

test("mojibake é corrigido na gravação (campo e texto de busca), CPF continua mascarado", () => {
  const l = P.linhaContrato({ ...contrato, unidade_nome: "SECRETARIA DE SAÃšDE", orgao_nome: "FUNDAÃ‡ÃƒO X", description: "ManutenÃ§Ã£o 016.471.242-98" }, EM);
  assert.equal(l.unidade_nome, "SECRETARIA DE SAÚDE");
  assert.equal(l.orgao_nome, "FUNDAÇÃO X");
  assert.equal(l.busca, "manutencao fundacao x");
});

test("busca_nome: começo da descrição do item + começo do objeto, sem acento, 90 caracteres de cada", () => {
  const item = { numeroControlePncpAta: "x", numeroItem: "1", descricaoItem: "PAPEL A4, GRAMATURA 75 G/M2", numeroAtaRegistroPreco: "00076/2025" };
  const ata = P.linhaAta({ ...contrato, numero_controle_pncp: "x", permite_adesao: true }, EM);
  const l = P.linhaItemAta(item, ata, EM);
  assert.equal(l.busca_nome, "papel a4, gramatura 75 g/m2 servicos de limpeza");
  assert.equal(l.ata_numero, "00076/2025");
  assert.equal(ata.busca_nome, "servicos de limpeza");
  assert.equal(P.nomeBusca(null, "x".repeat(300)).length, 90);
  assert.equal(P.nomeBusca("a".repeat(300), "b".repeat(300)).length, 181);
  // A ficha da impressora cita "papel a4" na especificação, mas o nome do item não: fica fora do nome.
  const imp = P.linhaItemAta({ ...item, descricaoItem: `IMPRESSORA LASER, TENSÃO 220 V, RESOLUÇÃO 1200 X 1200 DPI, VELOCIDADE 40 PPM, DUPLEX AUTOMÁTICO, REDE GIGABIT, BANDEJA PARA PAPEL A4` }, ata, EM);
  assert.ok(imp.busca.includes("papel a4") && imp.busca_nome.startsWith("impressora laser") && !imp.busca_nome.includes("papel a4"));
});

test("somarAdesoes soma a quantidade aprovada de cada órgão; vazio = 0", () => {
  assert.equal(P.somarAdesoes([{ quantidadeAprovadaAdesao: 3 }, { quantidadeAprovadaAdesao: "2.5" }, {}]), 5.5);
  assert.equal(P.somarAdesoes(undefined), 0);
});

test("linhaItemAtaPncp: fornecedor e valor homologados, sem saldo nem adesão; PF não grava fornecedor", () => {
  const ata = P.linhaAta({ ...contrato, numero_controle_pncp: "13272780000170-1-000023/2026-000003", item_url: "/atas/13272780000170/2026/23/3", permite_adesao: true }, EM);
  const item = { numeroItem: 7656466, descricao: "Licença de uso de software", quantidade: 2000, catalogoCodigoItem: null };
  const res = { niFornecedor: "13293239000149", nomeRazaoSocialFornecedor: "C. C. N. DE SENA LTDA", quantidadeHomologada: 2000, valorUnitarioHomologado: 11139, valorTotalHomologado: 22278000 };
  const l = P.linhaItemAtaPncp(item, res, ata, EM);
  assert.equal(l.id, "ata:13272780000170-1-000023/2026-000003#7656466#13293239000149");
  assert.equal(l.fonte, "pncp");
  assert.deepEqual([l.fornecedor_cnpj, l.valor_unitario, l.valor_total, l.quantidade, l.saldo, l.maximo_adesao], ["13293239000149", 11139, 22278000, 2000, null, null]);
  const pf = P.linhaItemAtaPncp(item, { ...res, niFornecedor: "12345678901" }, ata, EM);
  assert.deepEqual([pf.fornecedor_cnpj, pf.fornecedor_nome], [null, null]);
});

test("itensAtaPncp: itens da contratação + resultado; ata por fornecedor só fica com o dele; cancelado fora; memo evita reler", async () => {
  const chamadas = [];
  const fetch = async (url) => {
    chamadas.push(String(url).replace("https://pncp.gov.br/api/pncp/v1/orgaos/", ""));
    const j = /\/resultados$/.test(url)
      ? [{ niFornecedor: "11111111000111", nomeRazaoSocialFornecedor: "A LTDA", valorUnitarioHomologado: 1 }, { niFornecedor: "22222222000122", nomeRazaoSocialFornecedor: "B LTDA", valorUnitarioHomologado: 2 }, { niFornecedor: "33333333000133", dataCancelamento: "2026-01-01", valorUnitarioHomologado: 3 }]
      : [{ numeroItem: 1, descricao: "X", temResultado: true }, { numeroItem: 2, descricao: "Y", temResultado: false }];
    return { status: 200, ok: true, json: async () => j };
  };
  const ctx = { op: { fetch, pausaMs: 0 }, coletadoEm: EM };
  const doc = { item_url: "/atas/13272780000170/2026/23/3" };
  const ata = P.linhaAta({ ...contrato, numero_controle_pncp: "a", item_url: doc.item_url, permite_adesao: true }, EM);
  const memo = new Map();
  const todas = await P.itensAtaPncp(doc, ata, ctx, memo);
  assert.deepEqual(todas.map((l) => l.fornecedor_cnpj), ["11111111000111", "22222222000122"]);
  assert.deepEqual(chamadas, ["13272780000170/compras/2026/23/itens?pagina=1&tamanhoPagina=30", "13272780000170/compras/2026/23/itens/1/resultados"]);
  const so = await P.itensAtaPncp({ ...doc, fornecedor_ni: "22222222000122" }, ata, ctx, memo);
  assert.deepEqual(so.map((l) => l.fornecedor_cnpj), ["22222222000122"]);
  assert.equal(chamadas.length, 2);
  assert.deepEqual(await P.itensAtaPncp({ item_url: "/atas/x/y" }, ata, ctx), []);
});

test("unidades: pula o que já foi feito, para no prazo da rodada e grava o progresso a cada unidade", async () => {
  const est = { feitos: new Set(["b"]) };
  const salvos = [];
  const ctx = { prazoFinal: Date.now() + 60000, salvar: async (e) => salvos.push([...e.feitos]) };
  const rodou = [];
  assert.equal(await P.unidades(["a", "b", "c"], est, ctx, async (k) => rodou.push(k)), true);
  assert.deepEqual(rodou, ["a", "c"]);
  assert.deepEqual(salvos, [["b", "a"], ["b", "a", "c"]]);
  // Prazo estourado no meio: a unidade em andamento fecha, as seguintes ficam para a próxima rodada.
  const est2 = { feitos: new Set() };
  const ctx2 = { prazoFinal: Date.now() + 60000, salvar: async () => {} };
  const r2 = [];
  assert.equal(await P.unidades(["1", "2", "3"], est2, ctx2, async (k) => { r2.push(k); if (k === "2") ctx2.prazoFinal = 0; }), false);
  assert.deepEqual(r2, ["1", "2"]);
  assert.deepEqual([...est2.feitos], ["1", "2"]);
});

test("carregarEstado: retoma o do mesmo dia (mesmo corte de limpeza); outro dia recomeça", async () => {
  const salvo = { dia: "2026-11-19", coletadoEm: "2026-11-19T09:00:00.000Z", feitos: ["irp", "AM:contrato"], orgaos: { AM: { 1: {} } }, comItens: { AM: ["a"] } };
  const mesmo = await P.carregarEstado("2026-11-19", Date.now(), async () => salvo);
  assert.deepEqual([...mesmo.feitos], ["irp", "AM:contrato"]);
  assert.equal(mesmo.coletadoEm, "2026-11-19T09:00:00.000Z");
  const novo = await P.carregarEstado("2026-11-20", Date.parse("2026-11-20T09:00:00Z"), async () => salvo);
  assert.equal(novo.feitos.size, 0);
  assert.equal(novo.coletadoEm, "2026-11-20T09:00:00.000Z");
  assert.equal((await P.carregarEstado("2026-11-19", 0, async () => { throw new Error("sem tabela"); })).feitos.size, 0);
  assert.deepEqual(P.estadoSerializavel(mesmo).feitos, ["irp", "AM:contrato"]);
});

test("consultarAdesoes: pergunta por ata + UASG + item, soma as páginas; 429 sobe como erro (a etapa para sem marcar o item)", async () => {
  const urls = [];
  const paginas = [{ resultado: [{ quantidadeAprovadaAdesao: 10 }], paginasRestantes: 1 }, { resultado: [{ quantidadeAprovadaAdesao: 5 }, { quantidadeAprovadaAdesao: 1 }], paginasRestantes: 0 }];
  const fetch = async (url) => { urls.push(new URL(url)); return { status: 200, ok: true, json: async () => paginas[urls.length - 1] }; };
  const l = { id: "ata:04378626000197-1-000024/2025-000001#00003#21707794000106", ata_numero: "00076/2025", unidade_codigo: "154039" };
  assert.equal(await P.consultarAdesoes(l, { fetch, pausaMs: 0 }), 16);
  assert.deepEqual([urls[0].searchParams.get("numeroAta"), urls[0].searchParams.get("unidadeGerenciadora"), urls[0].searchParams.get("numeroItem"), urls[1].searchParams.get("pagina")], ["00076/2025", "154039", "00003", "2"]);
  const limitado = async () => ({ status: 429, ok: false, json: async () => ({}) });
  await assert.rejects(P.consultarAdesoes(l, { fetch: limitado, pausaMs: 0, tentativas: 1 }), /HTTP 429/);
});
