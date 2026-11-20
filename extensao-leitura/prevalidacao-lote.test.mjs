import test from 'node:test';
import assert from 'node:assert/strict';
import { validarLote } from './prevalidacao-lote.mjs';

function fixture(size) {
  const catalogo = Array.from({ length: size }, (_, i) => ({ id: String(i + 1), quantidade: '2', grupo: null, exigidos: ['marca', 'modelo', 'fabricante'] }));
  const linhas = catalogo.map(item => ({ id: item.id, quantidade: '2', unitario: '1.2345', marca: 'Marca fictícia', modelo: 'Modelo fictício', fabricante: 'Fabricante fictício' })).reverse();
  return { catalogo, linhas };
}
for (const size of [206, 1001, 2500]) test(`${size} itens por ID, lotes de revisão de dez sem teto de mil`, () => {
  const input = fixture(size); const before = JSON.stringify(input);
  const result = validarLote(input.catalogo, input.linhas);
  assert.equal(result.valido, true); assert.equal(result.lotesRevisao.length, Math.ceil(size / 10));
  assert.equal(result.itens[0].id, String(size)); assert.equal(result.itens[0].totalExato, '2.46900000');
  assert.equal(result.totalExato, `${Math.floor(size * 24690 / 10000)}.${String(size * 24690 % 10000).padStart(4, '0')}0000`);
  assert.equal(result.writeAuthorized, false); assert.equal(JSON.stringify(input), before);
});
test('duplicidade, ID desconhecido, campo exigido e grupo incompleto invalidam lote inteiro', () => {
  for (const mutate of [x => x.linhas.push(x.linhas[0]), x => x.linhas[0].id = '99', x => x.linhas[0].marca = '', x => { x.catalogo.forEach(i => i.grupo = 'G'); x.linhas.pop(); }]) {
    const input = fixture(2); mutate(input); const result = validarLote(input.catalogo, input.linhas);
    assert.equal(result.valido, false); assert.equal(result.itens.length, 0); assert.equal(result.totalExato, null);
  }
});
test('precisão, locale, valores zero/negativos e quantidade divergente são recusados', () => {
  for (const value of ['1.00001', '1,25', '1e2', '-1', '0', 1.25, 'NaN']) {
    const input = fixture(1); input.linhas[0].unitario = value; assert.equal(validarLote(input.catalogo, input.linhas).valido, false);
  }
  const input = fixture(1); input.linhas[0].quantidade = '3'; assert.equal(validarLote(input.catalogo, input.linhas).valido, false);
});
test('quantidade fracionária é contrato local; total não representável em quatro casas exige revisão', () => {
  const input = fixture(1); input.catalogo[0].quantidade = input.linhas[0].quantidade = '0.0001'; input.linhas[0].unitario = '0.0001';
  const result = validarLote(input.catalogo, input.linhas);
  assert.equal(result.valido, true); assert.equal(result.totalExato, '0.00000001');
  assert.equal(result.requerRevisaoPrecisao, true); assert.equal(result.writeAuthorized, false);
});
test('catálogo inválido e lote vazio não autorizam revisão parcial', () => {
  const input = fixture(1);
  for (const catalogo of [null, [], [input.catalogo[0], input.catalogo[0]], [{ ...input.catalogo[0], exigidos: ['desconhecido'] }]]) assert.equal(validarLote(catalogo, input.linhas).valido, false);
  assert.equal(validarLote(input.catalogo, []).valido, false);
});

test('grupo completo é aceito; associação vem do catálogo, nunca da ordem da planilha', () => {
  const input = fixture(3); input.catalogo[0].grupo = input.catalogo[1].grupo = 'G1';
  input.linhas = input.linhas.filter(item => item.id !== '3');
  const result = validarLote(input.catalogo, input.linhas);
  assert.equal(result.valido, true); assert.deepEqual(result.itens.map(i => [i.id, i.grupo]), [['2', 'G1'], ['1', 'G1']]);
  input.linhas[0].grupo = 'G2';
  assert.equal(validarLote(input.catalogo, input.linhas).valido, false);
});

test('subset embaralhado gera lote de revisão, nunca página do portal', () => {
  const input = fixture(206);
  input.linhas = ['201', '11'].map(id => input.linhas.find(item => item.id === id));
  const result = validarLote(input.catalogo, input.linhas);
  assert.equal(result.valido, true);
  assert.deepEqual(result.lotesRevisao, [['201', '11']]);
  assert.equal('paginas' in result, false);
});
