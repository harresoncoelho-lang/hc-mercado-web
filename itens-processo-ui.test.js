const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('./itens-processo-ui');

test('editar item: valor ofertado abaixo do preço mínimo gravado é recusado antes de enviar', () => {
  const item = { valorUnitarioMinimo: '36.15' };
  assert.equal(I.abaixoDoMinimo(item, '35.90'), 'O valor ofertado R$ 35,90 está abaixo do seu preço mínimo R$ 36,15. Ajuste o valor ou o mínimo.');
  assert.equal(I.abaixoDoMinimo(item, '36.15'), null);
  assert.equal(I.abaixoDoMinimo({ valorUnitarioMinimo: null }, '1.00'), null);
  assert.equal(I.abaixoDoMinimo(undefined, '1.00'), null);
  assert.equal(I.abaixoDoMinimo({ valorUnitarioMinimo: '1234.50' }, '999.99'), 'O valor ofertado R$ 999,99 está abaixo do seu preço mínimo R$ 1.234,50. Ajuste o valor ou o mínimo.');
});
