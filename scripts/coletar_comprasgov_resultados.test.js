const test = require("node:test");
const assert = require("node:assert/strict");
const { chaveResultado, normalizarResultado, somarDias, gravarComDivisao } = require("./coletar_comprasgov_resultados");

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

test("timeout 57014 divide o lote ao meio e grava tudo que couber", async () => {
  const tamanhos = [];
  const upsert = async (_tabela, lote) => {
    tamanhos.push(lote.length);
    if (lote.length > 25) throw new Error('Supabase REST comprasgov_resultados?on_conflict=chave -> HTTP 500: {"code":"57014"}');
  };
  const linhas = Array.from({ length: 120 }, (_, i) => ({ chave: String(i) }));
  assert.equal(await gravarComDivisao(linhas, upsert, 100, 10), 120);
  assert.deepEqual(tamanhos, [100, 50, 25, 25, 50, 25, 25, 20]);
});

test("timeout persistente no lote mínimo sobe marcado com as linhas já gravadas", async () => {
  const upsert = async (_tabela, lote) => {
    if (lote.some((l) => l.chave === "3")) throw new Error("canceling statement due to statement timeout");
  };
  const linhas = Array.from({ length: 4 }, (_, i) => ({ chave: String(i) }));
  await assert.rejects(gravarComDivisao(linhas, upsert, 4, 1), (erro) => erro.timeoutBanco === true && erro.gravadas === 3);
});

test("erro do banco que não é timeout não é dividido", async () => {
  let chamadas = 0;
  const upsert = async () => { chamadas += 1; throw new Error("HTTP 401: chave inválida"); };
  await assert.rejects(gravarComDivisao([{ chave: "a" }, { chave: "b" }], upsert, 2, 1), (erro) => !erro.timeoutBanco);
  assert.equal(chamadas, 1);
});
