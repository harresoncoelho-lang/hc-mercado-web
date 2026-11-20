const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('./reforma-tributaria.js');

test('2026 (teste): R$ 1.000,00 dá CBS 9,00 e IBS 1,00, sem provisório', () => {
  const r = R.calcularCbsIbs({ valorCentavos: 100000n, ano: 2026, regime: 'presumido' });
  assert.equal(r.ok, true); assert.equal(r.aplica, true);
  assert.equal(r.cbs, 900n); assert.equal(r.ibs, 100n); assert.equal(r.total, 1000n);
  assert.equal(r.provisoria, false); assert.match(r.aviso, /PIS\/Cofins/);
});

test('2027 provisório: CBS 11,2% e IBS 0,1% (0,05 + 0,05)', () => {
  const r = R.calcularCbsIbs({ valorCentavos: 100000n, ano: 2027, regime: 'real' });
  assert.equal(r.cbs, 11200n); assert.equal(r.ibsUf, 50n); assert.equal(r.ibsMun, 50n); assert.equal(r.total, 11300n);
  assert.equal(r.provisoria, true); assert.equal(r.aviso, R.AVISO_PROVISORIA);
  assert.equal(r.aliquotaCbs, 11200n); assert.equal(r.aliquotaIbs, 100n);
});

test('redução de 60% e de 30% aplicada sobre CBS e IBS', () => {
  const r60 = R.calcularCbsIbs({ valorCentavos: 100000n, ano: 2033, reducao: 60 });
  assert.equal(r60.cbs, 4520n); assert.equal(r60.ibs, 7080n); assert.equal(r60.aliquotaCbs, 4520n);
  const r30 = R.calcularCbsIbs({ valorCentavos: 100000n, ano: 2033, reducao: 30 });
  assert.equal(r30.cbs, 7910n); assert.equal(r30.ibs, 12390n);
});

test('arredonda meio para cima por tributo (centavos)', () => {
  // 0,9% de R$ 0,50 = 0,45 centavo → 0; de R$ 0,56 = 0,504 → 1 (meio para cima a partir de 0,5)
  assert.equal(R.calcularCbsIbs({ valorCentavos: 50n, ano: 2026 }).cbs, 0n);
  assert.equal(R.calcularCbsIbs({ valorCentavos: 56n, ano: 2026 }).cbs, 1n);
  assert.equal(R.calcularCbsIbs({ valorCentavos: 0n, ano: 2026 }).total, 0n);
});

test('valor alto continua exato em BigInt', () => {
  const r = R.calcularCbsIbs({ valorCentavos: 999999999999999n, ano: 2027 });
  assert.equal(r.cbs, 112000000000000n); // 11,2% de 9.999.999.999.999,99 = 1.119.999.999.999,99888 → 1.120.000.000.000,00
});

test('Simples Nacional e MEI ficam fora do regime regular', () => {
  for (const regime of ['simples', 'mei']) {
    const r = R.calcularCbsIbs({ valorCentavos: 100000n, ano: 2027, regime });
    assert.equal(r.ok, true); assert.equal(r.aplica, false); assert.equal(r.cbs, undefined); assert.match(r.aviso, /DAS/);
  }
  assert.match(R.calcularCbsIbs({ valorCentavos: 100n, ano: 2026, regime: 'simples' }).aviso, /teste de 2026/);
});

test('entradas inválidas devolvem erro em vez de número', () => {
  assert.equal(R.calcularCbsIbs({ valorCentavos: 100, ano: 2026 }).ok, false);
  assert.equal(R.calcularCbsIbs({ valorCentavos: -1n, ano: 2026 }).ok, false);
  assert.equal(R.calcularCbsIbs({ valorCentavos: 100n, ano: 2025 }).ok, false);
  assert.equal(R.calcularCbsIbs({ valorCentavos: 100n, ano: 2034 }).ok, false);
  assert.equal(R.calcularCbsIbs({ valorCentavos: 100n, ano: 2026, reducao: 50 }).ok, false);
  assert.equal(R.calcularCbsIbs().ok, false);
});

test('tabela cobre 2026 a 2033 sem buraco e IBS só cresce', () => {
  assert.deepEqual(R.ANOS, [2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033]);
  for (let k = 1; k < R.ANOS.length; k++) {
    const a = R.ALIQUOTAS[R.ANOS[k - 1]], b = R.ALIQUOTAS[R.ANOS[k]];
    assert.ok(b.ibsUf + b.ibsMun >= a.ibsUf + a.ibsMun);
  }
});
