const test = require('node:test');
const assert = require('node:assert/strict');
const UI = require('./sinapi-ui.js');
const I = require('./itens-processo-ui.js');

test('filtroBusca: só dígitos é código; texto vira palavras sem acento e sem curinga do ILIKE', () => {
  assert.deepEqual(UI.filtroBusca(' 104658 '), { codigo: '104658' });
  assert.deepEqual(UI.filtroBusca('Alvenaria  de BLOCO cerâmico'), { palavras: ['alvenaria', 'de', 'bloco', 'ceramico'] });
  assert.deepEqual(UI.filtroBusca('areia%_*,(x)'), { palavras: ['areia'] });
  assert.ok(UI.filtroBusca('').erro);
  assert.ok(UI.filtroBusca('a % ,').erro);
  assert.equal(UI.filtroBusca('um dois tres quatro cinco seis sete').palavras.length, 6);
});

test('linhaHtml escapa texto vindo do banco', () => {
  const h = UI.linhaHtml({ codigo: '1', descricao: '<img src=x onerror=alert(1)>', unidade: 'M2', preco: '10.5', grupo: null, origem: 'CR' }, 0);
  assert.ok(!h.includes('<img'));
  assert.match(h, /R\$\s?10,50/);
  assert.match(h, /data-usar="0"/);
});

test('o que sinapi.html guarda é aceito pelo formulário do item (mesmo contrato)', () => {
  const l = { uf: 'AM', tipo: 'composicao', desonerado: false, codigo: '104658', preco: 228.76, referencia: '2026-10-01' };
  assert.deepEqual(I.precoSinapi(UI.guardado(l)), { preco: '228.76', rotulo: 'Preço SINAPI copiado: composição 104658 AM 10/2026, R$ 228,76.' });
  assert.equal(I.precoSinapi(UI.guardado({ ...l, preco: '7' })).preco, '7.00');
});
