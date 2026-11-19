const test = require('node:test');
const assert = require('node:assert/strict');
const { conferir, handler } = require('../conferir-cbs-ibs');

const json = (status, corpo) => new Response(JSON.stringify(corpo), { status });
const fonte = (cbs, ibsUf) => async (url) => (url.includes('aliquota-uniao') ? cbs() : ibsUf());

test('2026: alíquotas oficiais iguais à tabela local', async () => {
  const urls = [];
  const r = await conferir(2026, 'AM', async (url) => { urls.push(url); return url.includes('uniao') ? json(200, { aliquotaReferencia: 0.9 }) : json(200, { aliquotaReferencia: 0.1 }); });
  assert.equal(r.ok, true); assert.equal(r.publicada, true); assert.equal(r.confere, true);
  assert.ok(urls.some((u) => u.includes('codigoUf=13&data=2026-07-01')));
});

test('alíquota oficial diferente é avisada, não escondida', async () => {
  const r = await conferir(2026, 'SP', fonte(() => json(200, { aliquotaReferencia: 1 }), () => json(200, { aliquotaReferencia: 0.1 })));
  assert.equal(r.confere, false); assert.match(r.texto, /diferente da tabela local/);
});

test('404 da calculadora = ano ainda sem alíquota publicada', async () => {
  const r = await conferir(2027, 'DF', fonte(() => json(404, { title: 'Alíquota não encontrada' }), () => json(404, {})));
  assert.equal(r.ok, true); assert.equal(r.publicada, false); assert.match(r.texto, /ainda não publicou/);
});

test('firewall, rede ou resposta estranha: falha fechada', async () => {
  const casos = [
    fonte(() => new Response('<html>Request Rejected</html>', { status: 200 }), () => json(200, { aliquotaReferencia: 0.1 })),
    fonte(() => json(500, {}), () => json(200, { aliquotaReferencia: 0.1 })),
    async () => { throw new Error('timeout'); },
    fonte(() => json(200, { aliquotaReferencia: '0.9' }), () => json(200, { aliquotaReferencia: 0.1 })),
  ];
  for (const buscar of casos) {
    const r = await conferir(2026, 'AM', buscar);
    assert.equal(r.ok, false); assert.match(r.erro, /Não foi possível conferir agora/);
  }
});

test('handler valida ano e UF antes de chamar qualquer serviço', async (t) => {
  t.mock.method(global, 'fetch', async () => { throw new Error('não deveria chamar'); });
  const ev = (q) => ({ httpMethod: 'GET', headers: {}, queryStringParameters: q });
  assert.equal((await handler(ev({ ano: '2025' }))).statusCode, 400);
  assert.equal((await handler(ev({ ano: '2026', uf: 'XX' }))).statusCode, 400);
  assert.equal((await handler({ httpMethod: 'POST', headers: {} })).statusCode, 405);
});

test('handler exige sessão', async () => {
  const r = await handler({ httpMethod: 'GET', headers: {}, queryStringParameters: { ano: '2026', uf: 'AM' } });
  assert.equal(r.statusCode, 401);
});
