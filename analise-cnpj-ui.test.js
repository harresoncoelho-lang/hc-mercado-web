const test = require("node:test");
const assert = require("node:assert/strict");
const U = require("./analise-cnpj-ui.js");

const base = { id_compra: "78882005900332025", uf: "AM", modalidade: "Pregão", orgao_nome: "COMANDO DA MARINHA", descricao: "CAFÉ, TORRADO" };
const linhas = [
  // ganhou no PNCP (ordem 1, homologado 17 x 100)
  { ...base, numero_item: 107, ordem_classificacao: 1, valor_homologado: 17, quantidade_homologada: 100, valor_estimado: 20, vencedor_valor: 17 },
  // perdeu em 2º, lance 18,5 contra 17 do vencedor
  { ...base, numero_item: 110, classificacao: 2, valor_lance: 18.5, vencedor_valor: 17, vencedor_nome: "C R DA SILVA", quantidade: 50 },
  // 1º colocado recusado, item fracassado
  { ...base, numero_item: 108, classificacao: 1, situacao_proposta: "2", situacao_item: "Fracassado", valor_lance: 20 },
  // resultado cancelado não é vitória
  { ...base, id_compra: "19302805900142024", uf: "PA", numero_item: 3, ordem_classificacao: 1, valor_homologado: 5, situacao_resultado: "Cancelado", motivo_cancelamento: "Não assinou a ata" },
  // resultado sem posição (fora de SRP) com valor homologado = vencedor
  { ...base, id_compra: "19302805900142024", uf: "PA", numero_item: 4, valor_homologado: 2, quantidade: 10 },
];

test("resumo: vitórias, derrotas, recusa, fracassado como 1º e valor ganho", () => {
  const r = U.resumir(linhas);
  assert.equal(r.disputas, 5);
  assert.equal(r.compras, 2);
  assert.equal(r.vencidas, 2);
  assert.equal(r.naoVencidas, 3);
  assert.equal(r.vitoria, 40);
  assert.equal(r.valorGanho, 17 * 100 + 2 * 10);
  assert.equal(r.recusadas.length, 1);
  assert.deepEqual(r.fracassados1.map((p) => p.numero_item), [108]);
  assert.ok(Math.abs(r.descontoMedioGanha + 15) < 1e-9);
});

test("resumo: perde vs vencedor só nos pares com os dois preços e sem a recusada", () => {
  const r = U.resumir(linhas);
  assert.equal(r.paresComparados, 1);
  assert.equal(r.precoMedioPerde, 18.5);
  assert.equal(r.precoMedioVencedor, 17);
  assert.ok(Math.abs(r.diferencaMediaPerde - 8.8235) < 0.001);
});

test("resumo: grupos por UF e órgão contam disputas e vitórias", () => {
  const r = U.resumir(linhas);
  assert.deepEqual(r.porUf.map((g) => [g.chave, g.disputas, g.vencidas]), [["AM", 3, 1], ["PA", 2, 1]]);
  assert.equal(r.porOrgao[0].chave, "COMANDO DA MARINHA");
  assert.equal(U.resumir([]).vitoria, null);
});

test("motivos gravados: tipo da mensagem e situação da proposta, sem contar o mesmo item duas vezes", () => {
  const m = U.motivosGravados([
    { id_compra: "1", numero_item: 2, tipo: "desclassificacao", texto: "Pregoeiro: recusada", motivo: "Item 12.3.2 do edital", pregoes_gravados: { url: "https://cnetmobile.estaleiro.serpro.gov.br/x", itens: { 2: { descricao: "Café" } } } },
    { id_compra: "1", numero_item: 2, tipo: "recusa", texto: "de novo" },
    { id_compra: "1", numero_item: 3, tipo: "inabilitacao", texto: "Sem atestado" },
    { id_compra: "1", numero_item: 4, tipo: "convocacao", texto: "Envie a proposta" },
  ], [{ id_compra: "1", numero_item: 5, situacao: "Inabilitada" }, { id_compra: "1", numero_item: 6, situacao: "Desclassificada" }, { id_compra: "1", numero_item: 7, situacao: "Aceita" }]);
  assert.equal(m.desclassificacoes, 2);
  assert.equal(m.inabilitacoes, 2);
  assert.equal(m.lista.length, 3);
  assert.equal(m.lista[0].texto, "Item 12.3.2 do edital");
  assert.equal(m.lista[0].descricao, "Café");
});

test("motivos gravados: selo 'não verificado' até 2 leituras de organizações diferentes concordarem", () => {
  const m = U.motivosGravados([
    { id_compra: "1", numero_item: 2, tipo: "inabilitacao", texto: "x" },
    { id_compra: "1", numero_item: 3, tipo: "recusa", texto: "y", leituras_concordantes: 2 },
  ], [{ id_compra: "1", numero_item: 5, situacao: "Inabilitada", leituras_concordantes: 1 }, { id_compra: "1", numero_item: 6, situacao: "Aceita" }]);
  assert.deepEqual(m.lista.map((x) => [x.verificado, x.leituras]), [[false, 1], [true, 2]]);
  assert.equal(m.naoVerificados, 2);
});
