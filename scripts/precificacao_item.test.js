const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../precificacao-item.js');

test('exemplo do PrecificaJá: 51,20 com 8,5% + margem 22% e 8% dá 73,67 e 61,32', () => {
  const custo = P.lerDinheiro('51,20'), tributos = P.lerPercentual('8,5');
  const alvo = P.precoComMargem(custo, tributos + P.lerPercentual('22'));
  const limite = P.precoComMargem(custo, tributos + P.lerPercentual('8'));
  assert.deepEqual([alvo.ok, limite.ok], [true, true]);
  assert.equal(P.formatarDecimal(alvo.centavos, 2), '73,67');
  assert.equal(P.formatarDecimal(limite.centavos, 2), '61,32');
  assert.equal(P.formatarReais(123456789n), 'R$ 1.234.567,89');
  assert.equal(P.formatarPercentual(tributos), '8,5%');
});

test('percentuais somando 100% ou mais devolvem erro', () => {
  for (const pct of [100000n, 100001n, 250000n]) {
    const r = P.precoComMargem(5120n, pct);
    assert.equal(r.ok, false); assert.match(r.erro, /menor que 100%/);
  }
  assert.equal(P.precoComMargem(5120n, 99999n).ok, true);
  assert.equal(P.precoComMargem(5120n, -1n).ok, false);
});

test('frete rateado pelo peso custo×quantidade soma exatamente o frete', () => {
  const itens = [{ custoCentavos: 1000n, quantidade: 3000n }, { custoCentavos: 333n, quantidade: 7000n }, { custoCentavos: 5n, quantidade: 1000n }];
  for (const frete of [0n, 1n, 2n, 99n, 10001n, 123456789n]) {
    const r = P.freteRateado(itens, frete);
    assert.equal(r.ok, true);
    assert.equal(r.valores.reduce((a, b) => a + b, 0n), frete);
    assert.ok(r.valores.every((v) => v >= 0n));
  }
  // 100 × 3000/(3000+2331+5) = 56,22 → 56; 100 × 2331/5336 = 43,68 → 44; resto 0
  assert.deepEqual(P.freteRateado(itens, 100n).valores, [56n, 44n, 0n]);
  // vários "meio para cima" passariam do frete: nunca deixa o último negativo
  const iguais = [1n, 1n, 1n, 1n].map((c) => ({ custoCentavos: c, quantidade: 1n })).concat({ custoCentavos: 0n, quantidade: 1n });
  const r = P.freteRateado(iguais, 2n);
  assert.equal(r.valores.reduce((a, b) => a + b, 0n), 2n);
  assert.ok(r.valores.every((v) => v >= 0n));
  assert.equal(P.freteRateado([{ custoCentavos: 0n, quantidade: 1n }], 10n).ok, false);
});

test('lance com 4 casas: leitura e escrita em pt-BR', () => {
  assert.equal(P.lerLance('73,6701'), 736701n);
  assert.equal(P.lerLance('73.67'), 736700n);
  assert.equal(P.lerLance('73,67012'), null);
  assert.equal(P.lerLance('1.234,56'), null);
  assert.equal(P.lerLance(' 0,0001 '), 1n);
  assert.equal(P.formatarLance(736701n), '73,6701');
  assert.equal(P.formatarLance(-5n), '-0,0005');
  assert.equal(P.lerDinheiro('1,234'), null);
  assert.equal(P.lerDinheiro('abc'), null);
});

test('selo do simulador nos limites exatos', () => {
  const limite = 6132n, alvo = 7367n;
  assert.equal(P.classificarLance(limite * 100n, limite, alvo).cor, 'amarelo');
  assert.equal(P.classificarLance(alvo * 100n, limite, alvo).cor, 'verde');
  assert.equal(P.classificarLance(alvo * 100n - 1n, limite, alvo).cor, 'amarelo');
  assert.equal(P.classificarLance((limite - 1n) * 100n, limite, alvo).cor, 'vermelho');
  assert.equal(P.classificarLance(limite * 100n - 1n, limite, alvo).cor, 'vermelho');
});

test('prejuízo: lucro negativo por qualquer fração marca o selo', () => {
  const base = 5120n, pct = 8500n;
  // no alvo 73,67: 73,67 × 91,5% − 51,20 = 16,2080 (exato)
  assert.equal(P.lucro(736700n, base, pct), 162080n);
  // ponto de equilíbrio: 51,20 / 0,915 = 55,95628… → 55,9562 ainda é prejuízo; 55,9563 já não
  assert.ok(P.lucro(559562n, base, pct) < 0n);
  assert.ok(P.lucro(559563n, base, pct) >= 0n);
  const vermelho = P.classificarLance(559562n, 6132n, 7367n, P.lucro(559562n, base, pct));
  assert.deepEqual([vermelho.cor, vermelho.prejuizo], ['vermelho', true]);
  assert.match(vermelho.texto, /prejuízo/);
  const semPrejuizo = P.classificarLance(600000n, 6132n, 7367n, P.lucro(600000n, base, pct));
  assert.deepEqual([semPrejuizo.cor, semPrejuizo.prejuizo], ['vermelho', false]);
});

test('valores perto do limite 999999999999999n são exatos ou recusados', () => {
  const L = 999999999999999n;
  assert.deepEqual(P.precoComMargem(L, 0n), { ok: true, centavos: L });
  assert.equal(P.precoComMargem(L, 1n).ok, false);
  assert.equal(P.precoComMargem(L - 10n ** 13n, 1000n).ok, true);
  assert.equal(P.lerDinheiro('9999999999999,99'), L);
  assert.equal(P.lerDinheiro('10000000000000,00'), null);
  assert.equal(P.formatarDecimal(L, 2), '9999999999999,99');
  const r = P.freteRateado([{ custoCentavos: L, quantidade: L }, { custoCentavos: L, quantidade: 1n }], L);
  assert.equal(r.valores[0] + r.valores[1], L);
  assert.equal(P.lucro(L * 100n, L, 0n), 0n);
});

test('fonte sem conversão binária', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'precificacao-item.js'), 'utf8');
  assert.equal(fonte.includes('Number('), false);
  assert.equal(fonte.includes('parseFloat'), false);
  assert.equal(fonte.includes('parseInt'), false);
});
