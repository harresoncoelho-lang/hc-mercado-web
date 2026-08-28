const test = require("node:test");
const assert = require("node:assert/strict");
const { marcaUtil, selecionarPdms, normalizarResultado } = require("../comprasgov-marcas-produto");

test("selecionarPdms remove duplicados e prioriza descrições que começam pelo produto", () => {
  const pdms = selecionarPdms([
    { codigoPdm: 4416, descricaoPDM: "Caneta permanente" },
    { codigoPdm: 99, descricaoPDM: "Caneta esferográfica" },
    { codigoPdm: 99, descricaoPDM: "Caneta esferográfica" },
  ], "caneta");
  assert.equal(pdms.length, 2);
  assert.equal(pdms[0].codigo, 99);
});

test("normalizarResultado expõe somente marca declarada pela fonte", () => {
  assert.equal(marcaUtil("."), null);
  assert.equal(marcaUtil("NÃO SE APLICA"), null);
  assert.equal(marcaUtil("2025"), null);
  const item = normalizarResultado({ marca: "BIC", nomeFornecedor: "Fornecedor", estado: "SE", precoUnitario: "0.54" }, { codigo: 99, descricao: "Caneta esferográfica" });
  assert.equal(item.marca, "BIC");
  assert.equal(item.uf, "SE");
  assert.equal(item.valorUnitario, 0.54);
});
