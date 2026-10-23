// Servidor exclusivo de homologação: páginas reais, serviços locais e CSP sem rede externa.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const raiz = path.resolve(__dirname, '../..');
const privado = 'C:/Users/harre/AppData/Local/LicitaPlena/supabase-homologacao';
const c = JSON.parse(fs.readFileSync(path.join(privado, 'credenciais-locais.json')));
const nativo = global.fetch;
const origem = 'http://127.0.0.1:8792';
const servicos = { '/auth/v1/': 'http://127.0.0.1:55324/', '/rest/v1/': 'http://127.0.0.1:55321/', '/storage/v1/': 'http://127.0.0.1:55325/' };
const registro = path.join(__dirname, 'identificacao-rede-local.json');
const eventos = fs.existsSync(registro) ? JSON.parse(fs.readFileSync(registro)).eventos : [];
const registrar = (rota, status) => { eventos.push({ rota, status }); fs.writeFileSync(path.join(__dirname, 'identificacao-rede-local.json'), JSON.stringify({ data: new Date().toISOString(), eventos }, null, 2)); };
const iaFree=false;
for(const nome of ['GROQ_API_KEY','GEMINI_API_KEY','OPENROUTER_API_KEY','DEFESA_IA_GRATUITA_CONFIRMADA']) delete process.env[nome];
process.env.SUPABASE_SERVICE_ROLE_KEY=c.service;
process.env.IDENTIFICACAO_EMPRESA_LOCAL='1';
global.fetch=(endereco,opcoes={})=>{
 const u=new URL(endereco);assert.equal(u.origin,'https://lsqjamqvmrcyrvowndiu.supabase.co','Rede externa bloqueada');
 const prefixo=Object.keys(servicos).find(p=>u.pathname.startsWith(p));assert(prefixo);
 const headers=new Headers(opcoes.headers);
 // JWT do usuário permanece intacto; service_role somente na RPC backend autorizada.
 headers.set('apikey',headers.get('authorization')==='Bearer '+c.service?c.service:c.anon);
 return nativo(servicos[prefixo]+u.pathname.slice(prefixo.length)+u.search,{...opcoes,headers,redirect:'error'});
};
const banner = `<style>body:before{content:'HOMOLOGAÇÃO LOCAL • BASE DE TESTES • ${iaFree ? 'DEFESA COM IA FREE: ATÉ 2 CHAMADAS' : 'SERVIÇOS EXTERNOS BLOQUEADOS'}';display:block;position:fixed;bottom:0;left:0;right:0;z-index:999999;background:#633b00;color:white;text-align:center;font:11px/20px system-ui;pointer-events:none}</style>`;
const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp' };
const servidor = http.createServer(async (req, res) => {
  const u = new URL(req.url, origem);
  const responder = (status, corpo, tipo = 'application/json; charset=utf-8') => { res.writeHead(status, { 'Content-Type': tipo, 'Cache-Control': 'no-store' }); res.end(corpo); };
  try {
    assert(req.headers.host === '127.0.0.1:8792', 'Host não permitido');
    const prefixo = Object.keys(servicos).find(p => u.pathname.startsWith(p));
    if (prefixo) {
      const partes = []; let bytes = 0;
      for await (const parte of req) { bytes += parte.length; assert(bytes <= 12 * 1024 * 1024); partes.push(parte); }
      const headers = new Headers();
      for (const nome of ['authorization', 'apikey', 'content-type', 'prefer', 'range', 'accept', 'x-upsert', 'x-client-info']) if (req.headers[nome]) headers.set(nome, req.headers[nome]);
      const r = await nativo(servicos[prefixo] + u.pathname.slice(prefixo.length) + u.search, { method: req.method, headers, redirect: 'error', ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(partes) } : {}) });
      for (const nome of ['content-type', 'content-range', 'range-unit', 'preference-applied']) if (r.headers.get(nome)) res.setHeader(nome, r.headers.get(nome));
      res.statusCode = r.status; res.end(Buffer.from(await r.arrayBuffer())); registrar(u.pathname, r.status); return;
    }
    if (u.pathname.startsWith('/api/')) {
      if (!['/api/empresa-identificacao'].includes(u.pathname)) {
        registrar(u.pathname, 503); return responder(503, JSON.stringify({ erro: 'Serviço externo desativado nesta homologação local.' }));
      }
      const partes = []; let bytes = 0;
      for await (const parte of req) { bytes += parte.length; assert(bytes <= 6 * 1024 * 1024); partes.push(parte); }
      if (iaFree && u.pathname === '/api/ia-edital') {
        const corpo = JSON.parse(Buffer.concat(partes).toString());
        if (!modoPermitidoNaSessaoFree(corpo)) return responder(503, JSON.stringify({ erro: 'Nesta sessão, somente a análise jurídica com teto gratuito e a leitura do resumo identificado estão habilitadas.' }));
      }
      const nome = 'empresa-identificacao';
      const { handler } = require(path.join(raiz, 'netlify/functions', nome));
      const r = await handler({ httpMethod: req.method, headers: req.headers, body: Buffer.concat(partes).toString() });
      res.writeHead(r.statusCode, { ...r.headers, 'Access-Control-Allow-Origin': origem });
      res.end(r.isBase64Encoded ? Buffer.from(r.body, 'base64') : r.body); registrar(u.pathname, r.statusCode); return;
    }
    if (req.method !== 'GET') return responder(405, '{}');
    if (u.pathname === '/supabase-config.js') return responder(200, `const SUPABASE_URL=${JSON.stringify(origem)}; const SUPABASE_ANON_KEY=${JSON.stringify(c.anon)};`, tipos['.js']);
    if (['/qa-vendor/supabase.js', '/qa-vendor/xlsx.js', '/qa-vendor/municipios.json'].includes(u.pathname)) return responder(200, fs.readFileSync(path.join(privado, 'vendor', path.basename(u.pathname))), tipos[path.extname(u.pathname)]);
    const relativo = decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname).slice(1);
    const arquivo = path.resolve(raiz, relativo), ext = path.extname(arquivo);
    const raizPublica = !relativo.includes('/') && ['.html', '.js', '.css', '.svg', '.png', '.webp', '.ico'].includes(ext) && !['eslint.config.js'].includes(relativo);
    const dadoPublico = /^data\/(?:capag-municipios|\w+_meta)\.json$/.test(relativo);
    if (!arquivo.startsWith(raiz + path.sep) || (!raizPublica && !dadoPublico && relativo !== 'docs/qa/identificacao-preview.html') || !fs.existsSync(arquivo)) { registrar(u.pathname, 404); return responder(404, '{}'); }
    let corpo = fs.readFileSync(arquivo);
    if (ext === '.html') {
      corpo = corpo.toString().replaceAll('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', '/qa-vendor/supabase.js')
        .replaceAll('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', '/qa-vendor/xlsx.js')
        .replaceAll('https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome', '/qa-vendor/municipios.json')
        .replace(/<script[^>]*src="https:\/\/js\.hcaptcha\.com[^>]*><\/script>/g, '')
        .replace(/<link[^>]*href="https:\/\/fonts\.[^>]*>/g, '').replace('</head>', banner + '</head>');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; form-action 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'");
    }
    responder(200, corpo, tipos[ext] || 'application/octet-stream');
  } catch (_) { registrar(u.pathname, 500); if (!res.headersSent) responder(500, '{"erro":"Falha no ambiente local de homologação."}'); else res.end(); }
});
servidor.listen(8792,'127.0.0.1',()=>console.log('Homologação privada local: http://127.0.0.1:8792/login.html'));
