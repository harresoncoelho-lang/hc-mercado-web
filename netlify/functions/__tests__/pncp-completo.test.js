const test = require("node:test");
const assert = require("node:assert/strict");

const { handler: itensHandler } = require("../pncp-itens");
const { handler: detalheHandler } = require("../pncp-detalhe");

function evento() {
  return { queryStringParameters: { cnpj: "04191078000191", ano: "2026", sequencial: "110" } };
}

test("pncp-itens percorre páginas e não limita a primeira lista", async () => {
  const fetchOriginal = global.fetch;
  const urls = [];
  global.fetch = async (url) => {
    urls.push(url);
    const segundaPagina = String(url).includes("pagina=2");
    const itens = segundaPagina
      ? [{ numeroItem: 101, descricao: "Item 101" }]
      : Array.from({ length: 100 }, (_, indice) => ({ numeroItem: indice + 1, descricao: `Item ${indice + 1}` }));
    return { ok: true, json: async () => itens };
  };
  try {
    const resposta = await itensHandler(evento());
    const corpo = JSON.parse(resposta.body);
    assert.equal(resposta.statusCode, 200);
    assert.equal(corpo.itens.length, 101);
    assert.match(urls[0], /pagina=1&tamanhoPagina=100/);
    assert.match(urls[1], /pagina=2&tamanhoPagina=100/);
  } finally {
    global.fetch = fetchOriginal;
  }
});

test("pncp-detalhe normaliza os campos completos retornados pelo PNCP", async () => {
  const fetchOriginal = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      modalidadeNome: "Pregão - Presencial",
      modoDisputaNome: "Aberto",
      amparoLegal: { nome: "Lei 14.133/2021, Art. 28, I" },
      srp: true,
      valorTotalEstimado: 397682.37,
      numeroCompra: "41",
      anoCompra: 2026,
      processo: "41",
      unidadeOrgao: { codigoUnidade: "926235" },
      orgaoEntidade: { esferaId: "F" },
      fontesOrcamentarias: [],
    }),
  });
  try {
    const resposta = await detalheHandler(evento());
    const corpo = JSON.parse(resposta.body);
    assert.equal(resposta.statusCode, 200);
    assert.equal(corpo.detalhe.srp, true);
    assert.equal(corpo.detalhe.modoDisputaNome, "Aberto");
    assert.equal(corpo.detalhe.amparoLegal, "Lei 14.133/2021, Art. 28, I");
    assert.equal(corpo.detalhe.valorTotalEstimado, 397682.37);
    assert.equal(corpo.detalhe.fonteOrcamentaria, null);
  } finally {
    global.fetch = fetchOriginal;
  }
});
