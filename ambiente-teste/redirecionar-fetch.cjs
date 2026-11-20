// Trava de isolamento: functions e robôs têm a URL de produção fixa no código. Este fetch global
// troca essa origem pelo Supabase local, troca a chave pública de produção pela anon local e
// RECUSA qualquer outro *.supabase.co. O resto da rede (PNCP, compras.gov) segue normal.
// Robôs: AMBIENTE_TESTE_REDIRECIONAR=1 node -r ./ambiente-teste/redirecionar-fetch.cjs scripts/<robo>.js
const fs = require('node:fs'), path = require('node:path');
const PROD = 'https://lsqjamqvmrcyrvowndiu.supabase.co';
const PROD_ANON = 'sb_publishable_yH695cc52QUKYfFEgV5RwQ_0a8GLIeb';

function reescrever(url, op, chaves) {
  const u = new URL(String(url instanceof Request ? url.url : url));
  if (u.origin === PROD) {
    const local = new URL(u.pathname + u.search, chaves.API_URL);
    const headers = new Headers(op?.headers || (url instanceof Request ? url.headers : undefined));
    for (const nome of ['apikey', 'authorization']) {
      const v = headers.get(nome);
      if (v && v.includes(PROD_ANON)) headers.set(nome, v.replace(PROD_ANON, chaves.ANON_KEY));
    }
    return [local.href, { ...op, headers }];
  }
  if (/\.supabase\.(co|in|net)$/i.test(u.hostname)) throw new Error(`ambiente-teste: acesso a ${u.hostname} bloqueado (só Supabase local)`);
  return [url, op];
}

function instalar(chaves) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(chaves.API_URL)) throw new Error('ambiente-teste: API_URL não é local');
  const original = globalThis.fetch;
  globalThis.fetch = (url, op) => { const [u, o] = reescrever(url, op, chaves); return original(u, o); };
}

if (process.env.AMBIENTE_TESTE_REDIRECIONAR === '1') {
  const chaves = JSON.parse(fs.readFileSync(path.join(__dirname, 'chaves.local.json'), 'utf8'));
  instalar(chaves);
  process.env.SUPABASE_SERVICE_ROLE_KEY = chaves.SERVICE_ROLE_KEY;
}
module.exports = { instalar, reescrever };
