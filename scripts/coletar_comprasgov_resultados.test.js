const test = require("node:test");
const assert = require("node:assert/strict");
const { chaveResultado, normalizarResultado, somarDias } = require("./coletar_comprasgov_resultados");

test("normaliza resultado somente com campos explícitos e não inventa marca", () => {
  const resultado = {
    idCompraItem: "0901600600028202400018",
    idCompra: "09016006000282024",
    sequencialResultado: 1,
    numeroItemPncp: 18,
    numeroControlePNCPCompra: "46374500000194-1-011357/2024",
    unidadeOrgaoUfSigla: "SP",
    niFornecedor: "52119963000102",
    nomeRazaoSocialFornecedor: "Fornecedor Teste Ltda",
    quantidadeHomologada: 2,
    valorUnitarioHomologado: 40,
    valorTotalHomologado: 80,
    dataResultadoPncp: "2025-01-01T00:00:00",
  };
  const linha = normalizarResultado(resultado, { descricaoResumida: "Filtro de autoclave" }, "2025-01-02T00:00:00Z");
  assert.equal(chaveResultado(resultado), "0901600600028202400018:1");
  assert.equal(linha.dado.item.descricao, "Filtro de autoclave");
  assert.equal(linha.dado.item.marca, null);
  assert.equal(linha.dado.fornecedor.nome, "Fornecedor Teste Ltda");
  assert.equal(linha.dado.resultado.valorTotalHomologado, 80);
});

test("avança datas em UTC sem alterar o dia por fuso local", () => {
  assert.equal(somarDias("2025-12-31", 1), "2026-01-01");
});
