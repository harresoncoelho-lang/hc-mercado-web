const test = require('node:test');
const assert = require('node:assert/strict');
const { curvaABC, pct } = require('./curva-abc');

const item = (identificador, quantidade, valorUnitario) => ({ id: identificador, identificador, quantidade, valorUnitario });

test('curva ABC: ordena pelo total e classifica por acumulado (80% / 95%)', () => {
  // Totais: 7000, 1000, 1000, 500, 300, 200 = 10000 reais.
  const r = curvaABC([item('6', '1', '200.00'), item('1', '2', '3500.00'), item('3', '10', '100.00'), item('2', '1', '1000.00'), item('4', '0.5', '1000.00'), item('5', '3', '100.00')]);
  assert.equal(r.total, 1000000n);
  assert.deepEqual(r.linhas.map((l) => [l.item.identificador, l.classe]), [['1', 'A'], ['2', 'A'], ['3', 'B'], ['4', 'B'], ['5', 'C'], ['6', 'C']]);
  assert.deepEqual(r.linhas.map((l) => pct(l.acumulado)), ['70,00%', '80,00%', '90,00%', '95,00%', '98,00%', '100,00%']);
  assert.equal(pct(r.linhas[0].participacao), '70,00%');
  assert.deepEqual([r.resumo.A.itens, r.resumo.B.itens, r.resumo.C.itens], [2, 2, 2]);
  assert.equal(r.resumo.A.total, 800000n);
});

test('curva ABC: primeiro item é sempre A, mesmo passando de 80% sozinho', () => {
  const r = curvaABC([item('1', '1', '850.00'), item('2', '1', '100.00'), item('3', '1', '50.00')]);
  assert.deepEqual(r.linhas.map((l) => l.classe), ['A', 'B', 'C']);
});

test('curva ABC: item sem valor unitário fica fora; lista vazia não divide por zero', () => {
  const r = curvaABC([item('1', '2', null), item('2', '1', '10.00'), item('3', 'abc', '1.00')]);
  assert.equal(r.linhas.length, 1);
  assert.deepEqual(r.semValor.map((i) => i.identificador), ['1', '3']);
  assert.equal(pct(r.linhas[0].acumulado), '100,00%');
  const v = curvaABC([]);
  assert.equal(v.total, 0n);
  assert.deepEqual(v.linhas, []);
  assert.deepEqual(curvaABC(undefined).linhas, []);
});

test('curva ABC: empate no total segue a ordem natural do número do item; quantidade fracionada arredonda centavo', () => {
  const r = curvaABC([item('10', '1', '5.00'), item('2', '1', '5.00')]);
  assert.deepEqual(r.linhas.map((l) => l.item.identificador), ['2', '10']);
  assert.equal(curvaABC([item('1', '0.333', '1.01')]).total, 34n); // 0,33633 -> R$ 0,34
});
