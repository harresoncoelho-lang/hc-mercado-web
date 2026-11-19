// Trava de isolamento do ambiente de teste: nada pode sair para o Supabase de produção.
const test = require('node:test');
const assert = require('node:assert/strict');
const { reescrever } = require('./redirecionar-fetch.cjs');

const chaves = { API_URL: 'http://127.0.0.1:54321', ANON_KEY: 'anon-local' };
const PROD = 'https://lsqjamqvmrcyrvowndiu.supabase.co';

test('origem de produção vira a local e a chave pública de produção vira a anon local', () => {
  const [url, op] = reescrever(`${PROD}/rest/v1/clientes?id=eq.1`, { headers: { apikey: 'sb_publishable_yH695cc52QUKYfFEgV5RwQ_0a8GLIeb', Authorization: 'Bearer token-usuario' } }, chaves);
  assert.equal(url, 'http://127.0.0.1:54321/rest/v1/clientes?id=eq.1');
  assert.equal(op.headers.get('apikey'), 'anon-local');
  assert.equal(op.headers.get('authorization'), 'Bearer token-usuario');
});

test('qualquer outro projeto Supabase é recusado; o resto da rede passa intacto', () => {
  assert.throws(() => reescrever('https://outro-projeto.supabase.co/rest/v1/x', {}, chaves), /bloqueado/);
  assert.throws(() => reescrever(new URL('https://abc.supabase.in/auth/v1/user'), {}, chaves), /bloqueado/);
  const op = { method: 'GET' };
  assert.deepEqual(reescrever('https://pncp.gov.br/api/x', op, chaves), ['https://pncp.gov.br/api/x', op]);
});
