const test = require("node:test");
const assert = require("node:assert/strict");
const { handler } = require("../netlify/functions/pncp-itens");

test("consulta paginada busca só a página pedida e devolve continuidade", async () => {
  const original = global.fetch;
  const chamadas = [];
  global.fetch = async url => {
    chamadas.push(String(url));
    return { ok: true, json: async () => Array.from({ length: 100 }, (_, indice) => ({ numeroItem: 101 + indice, descricao: "Produto" })) };
  };
  try {
    const resposta = await handler({ queryStringParameters: { cnpj: "04477782000105", ano: "2026", sequencial: "14", pagina: "2" } });
    const dados = JSON.parse(resposta.body);
    assert.equal(resposta.statusCode, 200);
    assert.equal(chamadas.length, 1);
    assert.match(chamadas[0], /pagina=2&tamanhoPagina=100/);
    assert.equal(dados.itens.length, 100);
    assert.equal(dados.proximaPagina, 3);
  } finally { global.fetch = original; }
});

test("página final curta encerra a navegação", async () => {
  const original = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => [{ numeroItem: 1175, descricao: "Último produto" }] });
  try {
    const resposta = await handler({ queryStringParameters: { cnpj: "04477782000105", ano: "2026", sequencial: "14", pagina: "12" } });
    const dados = JSON.parse(resposta.body);
    assert.equal(dados.itens.length, 1);
    assert.equal(dados.proximaPagina, null);
  } finally { global.fetch = original; }
});
