// Site + functions locais contra o Supabase local (subir.cjs antes).
//   node ambiente-teste/servidor.cjs   ->  http://127.0.0.1:8788
// Serve publico/ (o mesmo que o Cloudflare Pages publica; gerado por npm run build:cloudflare) com os
// cabeçalhos do _headers, e /api/<nome> pelos handlers de netlify/functions via o mesmo adaptador e a
// mesma allowlist de functions/api/[nome].js. Os handlers têm a URL de produção fixa no código: aqui o
// fetch global reescreve essa origem para o Supabase local e recusa qualquer outro *.supabase.co.
// Nenhum arquivo do site é alterado; supabase-config.js é servido em memória com URL/chave locais.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const AQUI = __dirname, RAIZ = path.resolve(AQUI, '..'), PUBLICO = path.join(RAIZ, 'publico');
const PORTA = Number(process.env.PORTA_TESTE || 8788);
const PROD = 'https://lsqjamqvmrcyrvowndiu.supabase.co';
const chaves = JSON.parse(fs.readFileSync(path.join(AQUI, 'chaves.local.json'), 'utf8'));
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(chaves.API_URL)) throw new Error('chaves.local.json não aponta para o Supabase local');

// Ambiente dos handlers: só o que o roteiro liga, nenhuma chave paga (sem GROQ/Transparência/e-mail).
for (const k of Object.keys(process.env)) if (/GROQ|TRANSPARENCIA|ZEPTOMAIL|GEMINI|OPENAI|DOSSIES_EDITAIS_CHAVE|SUPABASE/i.test(k)) delete process.env[k];
Object.assign(process.env, {
  SUPABASE_SERVICE_ROLE_KEY: chaves.SERVICE_ROLE_KEY, IDENTIFICACAO_EMPRESA_LOCAL: '1', IMPORTACAO_PNCP_LOCAL: '1',
  PORTAL_CLIENTE_LIGADO: '1', PORTAL_IP_SALT: crypto.randomBytes(24).toString('hex'), URL: `http://127.0.0.1:${PORTA}`,
});
require('./redirecionar-fetch.cjs').instalar(chaves);

// Mesma allowlist da rota do Cloudflare: lê os imports e o mapa ROTAS de functions/api/[nome].js.
const rota = fs.readFileSync(path.join(RAIZ, 'functions/api/[nome].js'), 'utf8');
const modulos = Object.fromEntries([...rota.matchAll(/import \* as (\w+) from "\.\.\/\.\.\/netlify\/functions\/([^"]+)"/g)].map(m => [m[1], m[2]]));
const corpoRotas = rota.slice(rota.indexOf('const ROTAS = {'), rota.indexOf('};', rota.indexOf('const ROTAS = {')));
const ROTAS = Object.fromEntries([...corpoRotas.matchAll(/^\s*"?([a-z-]+)"?:\s*(\w+),/gm)].map(m => [m[1], path.join(RAIZ, 'netlify/functions', modulos[m[2]])]));
const { executarHandler } = require(path.join(RAIZ, 'netlify/functions/_adaptador_cloudflare.js'));

// _headers: blocos "/caminho*" com "Nome: valor" e "! Nome" (desanexa). A origem de produção vira a local.
function cabecalhosDe(caminho) {
  const h = {};
  let casa = false;
  for (const linha of fs.readFileSync(path.join(RAIZ, '_headers'), 'utf8').split(/\r?\n/)) {
    if (/^\//.test(linha)) { const p = linha.trim(); casa = p.endsWith('*') ? caminho.startsWith(p.slice(0, -1)) : caminho === p; continue; }
    if (!casa || !/^\s+\S/.test(linha) || /^\s*#/.test(linha)) continue;
    const t = linha.trim();
    if (t.startsWith('!')) { delete h[t.slice(1).trim().toLowerCase()]; continue; }
    const i = t.indexOf(':');
    h[t.slice(0, i).trim().toLowerCase()] = t.slice(i + 1).trim().replaceAll(PROD, chaves.API_URL);
  }
  delete h['strict-transport-security'];
  return h;
}
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.txt': 'text/plain', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json' };
const CONFIG = `// Gerado por ambiente-teste/servidor.cjs: Supabase LOCAL (teste).\nconst SUPABASE_URL = ${JSON.stringify(chaves.API_URL)};\nconst SUPABASE_ANON_KEY = ${JSON.stringify(chaves.ANON_KEY)};\n`;

async function api(req, res, nome) {
  if (!Object.hasOwn(ROTAS, nome)) { res.writeHead(404, { 'content-type': 'application/json' }).end('{"erro":"Função não encontrada."}'); return; }
  const partes = []; for await (const p of req) partes.push(p);
  const corpo = Buffer.concat(partes);
  const request = new Request(`http://127.0.0.1:${PORTA}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : corpo });
  const modulo = require(ROTAS[nome]);
  const handler = (modulo.default || modulo).handler || modulo.handler;
  const resposta = await executarHandler(handler, request, {});
  const h = {}; resposta.headers.forEach((v, k) => { h[k] = v; });
  res.writeHead(resposta.status, h).end(Buffer.from(await resposta.arrayBuffer()));
}

function estatico(req, res, caminho) {
  if (caminho === '/supabase-config.js') { res.writeHead(200, { ...cabecalhosDe(caminho), 'content-type': TIPOS['.js'] }).end(CONFIG); return; }
  let arq = path.normalize(path.join(PUBLICO, decodeURIComponent(caminho === '/' ? '/index.html' : caminho)));
  if (!arq.startsWith(PUBLICO + path.sep)) { res.writeHead(403).end(); return; }
  if (!path.extname(arq) && fs.existsSync(arq + '.html')) arq += '.html'; // URL limpa, como no Pages (/sistema, /cliente)
  if (!fs.existsSync(arq) || !fs.statSync(arq).isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }).end('404'); return; }
  res.writeHead(200, { ...cabecalhosDe(caminho), 'content-type': TIPOS[path.extname(arq).toLowerCase()] || 'application/octet-stream' }).end(fs.readFileSync(arq));
}

// publico/ sempre igual ao código atual (o build só escreve publico/, que é gitignored).
spawnSync(process.execPath, [path.join(RAIZ, 'scripts/montar_publico.js')], { stdio: 'inherit' });
http.createServer(async (req, res) => {
  try {
    if (!['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.socket.remoteAddress)) { res.writeHead(403).end(); return; }
    const caminho = new URL(req.url, 'http://x').pathname;
    const m = /^\/api\/([^/]+)$/.exec(caminho);
    if (m) await api(req, res, m[1]); else estatico(req, res, caminho);
  } catch (e) {
    console.error('servidor-teste:', e);
    if (!res.headersSent) res.writeHead(500).end('erro');
  }
}).listen(PORTA, '127.0.0.1', () => console.log(`Site de teste: http://127.0.0.1:${PORTA}  (Supabase local ${chaves.API_URL}; rotas: ${Object.keys(ROTAS).length})`));
