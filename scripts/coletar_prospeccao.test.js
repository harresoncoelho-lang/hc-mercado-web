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
