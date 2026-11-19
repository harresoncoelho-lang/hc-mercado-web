const test = require("node:test");
const assert = require("node:assert/strict");
const { montarVisao, vencedorDe, variacao, linkOficial } = require("./licitacao-anterior-ui.js");

const compra = (id, data) => ({ id_compra: id, numero: id.slice(8, 13), data_publicacao: data, plataforma: "Compras.gov.br" });
const item = (id, n, situacao, estimado) => ({ id_compra: id, numero_item: n, situacao_item: situacao, valor_estimado: estimado, descricao: "Café" });
const cas = (id, n, item_edital = 1) => ({ id_compra: id, numero_item: n, item_edital, confianca: "alta", regra: "mesmo item de catálogo (CATMAT)" });

test("vencedor: 1º do PNCP válido; cancelado não vence; sem PNCP vale a linha da Pesquisa de Preços", () => {
  assert.equal(vencedorDe([{ fornecedor_chave: "a", ordem_classificacao: 2 }, { fornecedor_chave: "b", ordem_classificacao: 1 }]).fornecedor_chave, "b");
  assert.equal(vencedorDe([{ fornecedor_chave: "a", ordem_classificacao: 1, situacao_resultado: "Cancelado" }]), null);
  assert.equal(vencedorDe([{ fornecedor_chave: "pp", marca: "PILÃO" }]).fornecedor_chave, "pp");
  assert.equal(variacao(23.33, 17), -27.1);
  assert.equal(variacao(0, 17), null);
  assert.equal(variacao(null, 17), null);
});

test("visão: só itens casados, mais nova primeiro, fracassado contado, marcas agrupadas sem acento/caixa", () => {
  const v = montarVisao({
    compras: [compra("78882005900042024", "2024-04-12"), compra("78882005900332025", "2025-08-18")],
    itens: [item("78882005900332025", 107, "Homologado", 23.33), item("78882005900332025", 108, "Fracassado", 35.62), item("78882005900332025", 1, "Homologado", 5),
      item("78882005900042024", 27, "Homologado", 21.88), item("78882005900042024", 170, "Homologado", 29.46)],
    participacoes: [
      { id_compra: "78882005900332025", numero_item: 107, fornecedor_chave: "38350458000143", fornecedor_nome: "C R DA SILVA", ordem_classificacao: 1, valor_homologado: 17, marca: null, classificacao: 1, valor_proposta: 19 },
      { id_compra: "78882005900332025", numero_item: 107, fornecedor_chave: "11111111000191", fornecedor_nome: "SEGUNDO", ordem_classificacao: 2, valor_homologado: 17, classificacao: 2, valor_proposta: 20 },
      { id_compra: "78882005900332025", numero_item: 107, fornecedor_chave: "48885922000150", fornecedor_nome: "DESISTIU", ordem_classificacao: 3, situacao_resultado: "Cancelado", motivo_cancelamento: "Não assinou a ata." },
      { id_compra: "78882005900332025", numero_item: 108, fornecedor_chave: "55555555000191", fornecedor_nome: "RECUSADO", classificacao: 1, valor_proposta: 30 },
      { id_compra: "78882005900042024", numero_item: 27, fornecedor_chave: "42343620000173", ordem_classificacao: 1, valor_homologado: 8, marca: "pilão" },
      { id_compra: "78882005900042024", numero_item: 170, fornecedor_chave: "42343620000173", ordem_classificacao: 1, valor_homologado: 23.5, marca: "PILAO" },
    ],
    casamentos: [cas("78882005900332025", 107), cas("78882005900332025", 108), cas("78882005900042024", 27), cas("78882005900042024", 170)],
    alvos: [{ numero: 1, valor_estimado: 20 }],
  });
  assert.deepEqual(v.compras.map((c) => c.compra.id_compra), ["78882005900332025", "78882005900042024"]);
  assert.deepEqual(v.compras[0].itens.map((i) => i.item.numero_item), [107, 108]);
  const i107 = v.compras[0].itens[0];
  assert.equal(i107.vencedor.fornecedor_nome, "C R DA SILVA");
  assert.equal(i107.sobreEstimado, -27.1);
  assert.equal(i107.sobreEstimadoAtual, -15);
  assert.deepEqual(i107.reservas.map((p) => p.fornecedor_nome), ["SEGUNDO"]);
  assert.equal(i107.cancelados[0].motivo_cancelamento, "Não assinou a ata.");
  assert.deepEqual(i107.participantes.map((p) => p.classificacao), [1, 2]);
  assert.equal(v.compras[0].itens[1].ruim, true);
  assert.equal(v.compras[0].itens[1].vencedor, null, "fracassado não tem vencedor");
  assert.equal(v.compras[0].itens[1].primeiroRecusado.fornecedor_nome, "RECUSADO");
  assert.equal(v.ruins, 1);
  assert.deepEqual(v.marcasAceitas, [{ marca: "Pilão", vitorias: 2, ultima: "2024-04-12", compras: 1 }]);
  assert.equal(v.semMarca, 1);
  // Por produto: o item 1 do edital juntou as duas vitórias da Pilão e o vencedor sem marca.
  assert.deepEqual(v.porProduto.map((g) => [g.numero, g.marcasAceitas.map((m) => m.marca), g.semMarca]), [[1, ["Pilão"], 1]]);
});

test("visão vazia não quebra", () => {
  assert.deepEqual(montarVisao({}), { compras: [], marcasAceitas: [], semMarca: 0, porProduto: [], ruins: 0 });
});

test("link na tela: só https em host oficial; o resto não vira href", () => {
  assert.equal(linkOficial("https://pncp.gov.br/app/editais/1/2025/3"), "https://pncp.gov.br/app/editais/1/2025/3");
  assert.equal(linkOficial("https://www.comprasnet.gov.br/x"), "https://www.comprasnet.gov.br/x");
  for (const ruim of ["javascript:alert(1)", "http://pncp.gov.br/x", "https://pncp.gov.br.evil.com/", "data:text/html,x", "", undefined]) assert.equal(linkOficial(ruim), null, String(ruim));
});

test("ver tudo: ata completa do ComprasNet antigo e Acompanhar contratação do Compras.gov, links oficiais e passos", () => {
  const { urlsVerTudo, PASSOS_VER_TUDO, linkOficial } = require("./licitacao-anterior-ui.js");
  const antigo = urlsVerTudo({ id_compra: "15814205000232022", plataforma: "ComprasNet (antigo)" });
  assert.equal(antigo.tipo, "comprasnet-antigo");
  assert.equal(antigo.url, "https://www.comprasnet.gov.br/livre/pregao/AtaEletronico.asp?co_no_uasg=158142&uasg=158142&numprp=232022&codigoModalidade=5&Seq=1");
  assert.ok(linkOficial(antigo.url));
  const novo = urlsVerTudo({ id_compra: "19302805900082025", plataforma: "Compras.gov.br" });
  assert.equal(novo.tipo, "comprasgov");
  assert.equal(novo.url, "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=19302805900082025");
  assert.ok(linkOficial(novo.url));
  assert.equal(urlsVerTudo({ id_compra: "abc" }), null);
  assert.equal(urlsVerTudo({ id_compra: "15814205000232022" }).tipo, "comprasnet-antigo"); // sem plataforma: modalidade 05, número comum, ano <= 2023
  assert.equal(PASSOS_VER_TUDO.length, 3);
  assert.match(PASSOS_VER_TUDO[1].texto, /Ler esta página e gravar/);
  assert.match(PASSOS_VER_TUDO[2].texto, /Atualizar/);
});
