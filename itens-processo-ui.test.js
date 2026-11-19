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

test('CBS/IBS da Reforma: desligado não muda nada; ligado mostra valores sobre o preço-alvo', () => {
  assert.equal(I.linhaReforma(100000n, { ligado: false, ano: 2027 }), '');
  assert.equal(I.linhaReforma(100000n, undefined), '');
  const l = I.linhaReforma(100000n, { ligado: true, ano: 2027, regime: 'real', reducao: 0 });
  assert.match(l, /CBS R\$ 112,00 \(11,2%\) \+ IBS R\$ 1,00 \(0,1%\) = R\$ 113,00/);
  assert.match(l, /provisórias até o Senado definir/);
  assert.match(I.linhaReforma(100000n, { ligado: true, ano: 2026, regime: 'presumido', reducao: 60 }), /redução de 60%.*CBS R\$ 3,60/);
  assert.match(I.linhaReforma(100000n, { ligado: true, ano: 2027, regime: 'simples', reducao: 0 }), /DAS/);
  assert.match(I.linhaReforma(undefined, { ligado: true, ano: 2027, regime: 'real', reducao: 0 }), /informe custo e margem/);
});

test('preço vindo da busca SINAPI: só valor canônico de 2 casas e código numérico viram botão', () => {
  const ok = I.precoSinapi(JSON.stringify({ codigo: '104658', preco: '269.08', uf: 'AM', referencia: '2026-10-01', tipo: 'composicao', desonerado: false }));
  assert.deepEqual(ok, { preco: '269.08', rotulo: 'Preço SINAPI copiado: composição 104658 AM 10/2026, R$ 269,08.' });
  assert.equal(I.precoSinapi(JSON.stringify({ codigo: '412', preco: '1.02', tipo: 'insumo', desonerado: true })).rotulo, 'Preço SINAPI copiado: insumo 412 desonerado, R$ 1,02.');
  for (const ruim of [null, '', '{', '[]', JSON.stringify({ codigo: '1', preco: '1,02' }), JSON.stringify({ codigo: '1', preco: '0.00' }), JSON.stringify({ codigo: '<b>', preco: '1.00' }), JSON.stringify({ codigo: '1', preco: 1.5 })]) {
    assert.equal(I.precoSinapi(ruim), null, String(ruim));
  }
});
