'use strict';
// Bootstrap temporário e local: recebe apenas publicKey/serviceKey por formulário em 127.0.0.1,
// valida e chama o iniciar() do launcher existente. Não guarda, não imprime e não grava chaves.
const http = require('node:http');
const crypto = require('node:crypto');

const PORTA_QA = 53820;
const LIMITE_CORPO = 16 * 1024;
const TTL_PADRAO_MS = 5 * 60 * 1000;
const PROJETO_QA = 'https://luguscapasskcsficckf.supabase.co';
const MSG_GENERICA = 'Não foi possível iniciar com estes dados. Recarregue a página e tente de novo.';
const CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; img-src 'none'";

const CONFIG_FIXA = Object.freeze({
  authUrl: PROJETO_QA,
  restUrl: PROJETO_QA,
  storageUrl: PROJETO_QA,
  emailsPermitidos: Object.freeze(['operador-a@qa.invalid', 'operador-b@qa.invalid']),
  contextos: Object.freeze([
    Object.freeze({ empresaId: 'a1000000-0000-4000-8000-000000000002', processoId: 'a1000000-0000-4000-8000-000000000003' }),
    Object.freeze({ empresaId: 'b1000000-0000-4000-8000-000000000002', processoId: 'b1000000-0000-4000-8000-000000000003' }),
  ]),
  iaOrganizacoes: Object.freeze(['a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001']),
});

function montarConfig(publicKey, serviceKey) {
  const fixa = JSON.parse(JSON.stringify(CONFIG_FIXA));
  return { ...fixa, publicKey, serviceKey };
}

class ErroHttp extends Error {
  constructor(status) { super('erro http'); this.status = status; }
}

function igual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let total = 0;
    let excedeu = false;
    req.on('data', (parte) => {
      if (excedeu) return;
      total += parte.length;
      if (total > LIMITE_CORPO) { excedeu = true; reject(new ErroHttp(413)); return; }
      partes.push(parte);
    });
    req.on('end', () => { if (!excedeu) resolve(Buffer.concat(partes).toString('utf8')); });
    req.on('error', () => reject(new ErroHttp(400)));
  });
}

function lerCampos(texto, tipo) {
  let campos;
  if (tipo.startsWith('application/x-www-form-urlencoded')) {
    const p = new URLSearchParams(texto);
    campos = { publicKey: p.get('publicKey'), serviceKey: p.get('serviceKey'), csrf: p.get('csrf') };
  } else if (tipo.startsWith('application/json')) {
    let o;
    try { o = JSON.parse(texto); } catch { throw new ErroHttp(400); }
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new ErroHttp(400);
    campos = { publicKey: o.publicKey, serviceKey: o.serviceKey, csrf: o.csrf };
  } else {
    throw new ErroHttp(415);
  }
  const formato = /^[\x21-\x7e]{16,8192}$/;
  if (typeof campos.publicKey !== 'string' || !formato.test(campos.publicKey)) throw new ErroHttp(400);
  if (typeof campos.serviceKey !== 'string' || !formato.test(campos.serviceKey)) throw new ErroHttp(400);
  if (typeof campos.csrf !== 'string') throw new ErroHttp(403);
  return campos;
}

function paginaFormulario(csrf) {
  return '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bootstrap QA local</title>' +
    '<style>body{font:16px system-ui;max-width:520px;margin:24px auto;padding:0 16px}label{display:grid;gap:4px;margin:12px 0;font-weight:600}input{padding:10px;font:inherit}button{padding:10px 14px;font:inherit;font-weight:700}</style>' +
    '<h1>Configuração QA local</h1><p>Use somente as chaves QA existentes. Esta página expira em 5 minutos e não guarda os valores.</p>' +
    '<form method="post" action="" autocomplete="off"><input type="hidden" name="csrf" value="' + csrf + '">' +
    '<label>Chave pública QA <input name="publicKey" type="text" required autocomplete="off" spellcheck="false" maxlength="8192"></label>' +
    '<label>Chave de serviço QA <input name="serviceKey" type="password" required autocomplete="off" maxlength="8192"></label>' +
    '<button type="submit">Inicializar QA</button></form></body></html>';
}

function abrirBootstrap(opcoes = {}) {
  const { iniciar, validarEntrada } = opcoes;
  if (typeof iniciar !== 'function' || typeof validarEntrada !== 'function') {
    throw new Error('iniciar e validarEntrada são obrigatórios');
  }
  const ttl = opcoes.ttlMs ?? TTL_PADRAO_MS;
  const saida = opcoes.saida ?? (() => {});
  const nonce = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(32).toString('hex');
  const caminho = '/b/' + nonce;
  let estado = 'aberto';
  let portaBootstrap = 0;
  let timer = null;
  let resolver;
  let rejeitar;
  const resultado = new Promise((res, rej) => { resolver = res; rejeitar = rej; });
  resultado.catch(() => {});

  const servidor = http.createServer((req, res) => { tratar(req, res).catch(() => { if (!res.headersSent) enviar(res, 500, MSG_GENERICA); }); });

  function enviar(res, status, corpo, tipo = 'text/plain; charset=utf-8') {
    if (status >= 400) saida('Bootstrap QA: HTTP ' + status);
    res.writeHead(status, {
      'Content-Type': tipo,
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      Connection: 'close',
    });
    res.end(corpo);
  }

  function fechar() {
    if (timer) clearTimeout(timer);
    timer = null;
    servidor.close();
    if (typeof servidor.closeIdleConnections === 'function') servidor.closeIdleConnections();
  }

  function expirar() {
    if (estado !== 'aberto') return;
    estado = 'expirado';
    rejeitar(new Error(MSG_GENERICA));
    fechar();
  }

  async function tratar(req, res) {
    if (req.headers.host !== `127.0.0.1:${portaBootstrap}`) return enviar(res, 403, MSG_GENERICA);
    if (estado === 'expirado') return enviar(res, 410, MSG_GENERICA);
    if (req.url !== caminho) return enviar(res, 404, MSG_GENERICA);
    const origemEsperada = `http://127.0.0.1:${portaBootstrap}`;

    if (req.method === 'GET') {
      if (estado !== 'aberto') return enviar(res, 409, MSG_GENERICA);
      return enviar(res, 200, paginaFormulario(csrf), 'text/html; charset=utf-8');
    }
    if (req.method !== 'POST') return enviar(res, 405, MSG_GENERICA);
    if (req.headers.origin !== origemEsperada) return enviar(res, 403, MSG_GENERICA);
    if (estado !== 'aberto') return enviar(res, 409, MSG_GENERICA);

    let campos;
    try {
      const texto = await lerCorpo(req);
      campos = lerCampos(texto, String(req.headers['content-type'] || ''));
    } catch (erro) {
      const status = erro instanceof ErroHttp ? erro.status : 400;
      return enviar(res, status, MSG_GENERICA);
    }
    if (!igual(campos.csrf, csrf)) return enviar(res, 403, MSG_GENERICA);
    if (estado !== 'aberto') return enviar(res, 409, MSG_GENERICA);

    estado = 'processando';
    const config = montarConfig(campos.publicKey, campos.serviceKey);
    campos = null;
    try {
      await validarEntrada(config);
    } catch {
      estado = 'aberto';
      return enviar(res, 400, MSG_GENERICA);
    }
    let retorno;
    try {
      retorno = await iniciar(config, { port: PORTA_QA });
    } catch {
      estado = 'falhou';
      rejeitar(new Error(MSG_GENERICA));
      enviar(res, 500, MSG_GENERICA);
      return fechar();
    }
    estado = 'concluido';
    enviar(res, 200, 'Inicialização solicitada. Esta janela foi encerrada.');
    resolver(retorno);
    return fechar();
  }

  return new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(0, '127.0.0.1', () => {
      portaBootstrap = servidor.address().port;
      timer = setTimeout(expirar, ttl);
      if (typeof timer.unref === 'function') timer.unref();
      const url = `http://127.0.0.1:${portaBootstrap}${caminho}`;
      saida('Abra no navegador local (expira em ' + Math.round(ttl / 1000) + ' s): ' + url);
      resolve({ url, resultado, fechar });
    });
  });
}

module.exports = { abrirBootstrap, montarConfig, CONFIG_FIXA, PORTA_QA, LIMITE_CORPO, MSG_GENERICA };

if (require.main === module) {
  const launcher = require('./launcher.cjs');
  abrirBootstrap({
    iniciar: launcher.iniciar,
    validarEntrada: launcher.validarEntrada,
    saida: (linha) => console.log(linha),
  }).then((b) => b.resultado)
    .then(() => console.log('Inicialização solicitada.'), () => { console.log(MSG_GENERICA); process.exitCode = 1; });
}
