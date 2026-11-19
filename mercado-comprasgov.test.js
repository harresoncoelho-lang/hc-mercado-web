const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./mercado-comprasgov.js');
const C = require('./catalogo-produtos.js');

const item = (c, extra = {}) => ({ valorUnitarioCentavos: c, codigoPdm: 99, produtoCatalogo: 'Caneta esferográfica', unidade: 'UN', marca: 'BIC', ...extra });

test('resumoPrecos: mínimo, mediana, média e máximo em centavos inteiros', () => {
  assert.deepEqual(M.resumoPrecos([item(50), item(49), item(48)]), { quantidade: 3, minimo: 48, mediana: 49, media: 49, maximo: 50 });
  // Par: mediana = média dos dois do meio, meio centavo para cima; média 50,5 -> 51.
  assert.deepEqual(M.resumoPrecos([item(49), item(50), item(51), item(52)]), { quantidade: 4, minimo: 49, mediana: 51, media: 51, maximo: 52 });
  assert.equal(M.resumoPrecos([item(1), item(2)]).mediana, 2);
  // Valor fora do contrato (float, zero, nulo, texto) não entra na conta.
  assert.deepEqual(M.resumoPrecos([item(0.5), item(0), item(null), item('10'), item(100)]), { quantidade: 1, minimo: 100, mediana: 100, media: 100, maximo: 100 });
  assert.deepEqual(M.resumoPrecos([]), { quantidade: 0, minimo: null, mediana: null, media: null, maximo: null });
  // Soma grande sem perder centavo (BigInt).
  const grande = Number.MAX_SAFE_INTEGER - 1;
  assert.equal(M.resumoPrecos([item(grande), item(grande)]).media, grande);
});

test('filtrar e marcasDe: unidade separa preço e marca agrupa sem diferença de maiúscula', () => {
  const lista = [item(50, { marca: 'bic' }), item(49), item(49), item(4300, { unidade: 'CX', marca: 'sm' }), item(30, { codigoPdm: 1, marca: 'Faber' })];
  assert.equal(M.filtrar(lista, { produto: '99', unidade: 'UN' }).length, 3);
  assert.deepEqual(M.marcasDe(M.filtrar(lista, { produto: '99', unidade: 'UN' })), [{ chave: 'bic', nome: 'BIC', quantidade: 3 }]);
  assert.equal(M.filtrar(lista, { marca: 'bic' }).length, 3);
  assert.equal(M.resumoPrecos(M.filtrar(lista, { produto: '99', unidade: 'CX' })).mediana, 4300);
});

test('termoDoItem: nome curto da descrição do edital', () => {
  assert.equal(M.termoDoItem('CANETA ESFEROGRÁFICA, MATERIAL: PLÁSTICO, COR AZUL'), 'CANETA ESFEROGRÁFICA');
  assert.equal(M.termoDoItem('Papel A4 75g/m² - caixa com 10 resmas'), 'Papel A4 75g/m²');
  assert.equal(M.termoDoItem('Detergente líquido neutro 500 ml frasco plástico biodegradável'), 'Detergente líquido neutro 500 ml frasco');
  assert.equal(M.termoDoItem(null), '');
  assert.ok(M.termoDoItem('x'.repeat(300)).length <= 100);
});

test('brl formata centavos sem float', () => {
  assert.equal(M.brl(123456789), 'R$ 1.234.567,89');
  assert.equal(M.brl(5), 'R$ 0,05');
  assert.equal(M.brl(null), '—');
});

test('produtoParaCatalogo: mediana vira preço de referência com fonte e data; custo fica de fora', () => {
  const r = M.resumoPrecos([item(49), item(50), item(51)]);
  const p = M.produtoParaCatalogo({ produtoCatalogo: 'Caneta esferográfica', descricaoItem: 'CANETA ESFEROGRÁFICA, AZUL', marca: 'BIC', modelo: 'Cristal', fabricante: null, unidade: 'UN', unidadeNome: 'UNIDADE' }, { ...r, marca: 'BIC' }, '2026-11-18');
  assert.equal(p.nome, 'Caneta esferográfica');
  assert.equal(p.preco_referencia, '0.50');
  assert.equal(p.referencia_em, '2026-11-18');
  assert.match(p.referencia_fonte, /mediana de 3 compra\(s\) por UN, marca BIC/);
  assert.equal('custo_unitario' in p, false);
  assert.equal(p.unidade, 'UNIDADE');
  const semPreco = M.produtoParaCatalogo({ produtoCatalogo: 'X', marca: 'Y' }, M.resumoPrecos([]));
  assert.equal(semPreco.preco_referencia, null);
  assert.equal(semPreco.referencia_fonte, null);
});

test('validarReferencia: só aceita preço positivo com fonte curta e data ISO', () => {
  const ok = { preco_referencia: '0.50', referencia_fonte: 'Compras.gov (Pesquisa de Preços): mediana de 3 compra(s)', referencia_em: '2026-11-18' };
  assert.deepEqual(C.validarReferencia(ok), ok);
  assert.equal(C.validarReferencia({ ...ok, preco_referencia: '0' }), null);
  assert.equal(C.validarReferencia({ ...ok, preco_referencia: '1.234' }), null);
  assert.equal(C.validarReferencia({ ...ok, referencia_fonte: '' }), null);
  assert.equal(C.validarReferencia({ ...ok, referencia_fonte: 'x'.repeat(301) }), null);
  assert.equal(C.validarReferencia({ ...ok, referencia_fonte: 'a\nb' }), null);
  assert.equal(C.validarReferencia({ ...ok, referencia_em: '18/11/2026' }), null);
  assert.equal(C.validarReferencia({ preco_referencia: null }), null);
});
