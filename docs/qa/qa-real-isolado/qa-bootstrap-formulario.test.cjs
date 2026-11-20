'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { abrirBootstrap, CONFIG_FIXA, PORTA_QA, LIMITE_CORPO, MSG_GENERICA } = require('./qa-bootstrap-formulario.cjs');

const CHAVE_PUB = 'sb_publishable_TESTE_FICTICIA_0001';
const CHAVE_SERVICO = 'eyJFAKE.SERVICE.TESTE_FICTICIA_0001';

function pedir(porta, caminho, { metodo = 'GET', cabecalhos = {}, corpo } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ agent: false, host: '127.0.0.1', port: porta, path: caminho, method: metodo, headers: cabecalhos }, (res) => {
      let texto = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { texto += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, texto }));
    });
    r.on('error', reject);
    r.end(corpo);
  });
}

function porta(url) { return Number(new URL(url).port); }
function caminhoDe(url) { return new URL(url).pathname; }

function formulario(csrf, extra = {}) {
  return new URLSearchParams({ csrf, publicKey: CHAVE_PUB, serviceKey: CHAVE_SERVICO, ...extra }).toString();
}

function cabecalhosPost(p, corpo, tipo = 'application/x-www-form-urlencoded') {
  return { host: `127.0.0.1:${p}`, origin: `http://127.0.0.1:${p}`, 'content-type': tipo, 'content-length': Buffer.byteLength(corpo) };
}

async function csrfDe(p, caminho) {
  const r = await pedir(p, caminho, { cabecalhos: { host: `127.0.0.1:${p}` } });
  const m = /name="csrf" value="([0-9a-f]{64})"/.exec(r.texto);
  assert.ok(m, 'formulário deve conter csrf');
  return m[1];
}

function fakes({ validar = async () => {}, iniciarImpl } = {}) {
  const chamadas = { validar: [], iniciar: [] };
  const validarEntrada = async (cfg) => { chamadas.validar.push(cfg); return validar(cfg); };
  const iniciar = async (cfg, opts) => { chamadas.iniciar.push({ cfg, opts }); return iniciarImpl ? iniciarImpl(cfg, opts) : { ok: true }; };
  return { chamadas, validarEntrada, iniciar };
}

async function abrir(t, opcoes = {}) {
  const f = fakes(opcoes.fakes);
  const linhas = [];
  const b = await abrirBootstrap({ iniciar: f.iniciar, validarEntrada: f.validarEntrada, saida: (l) => linhas.push(l), ...opcoes.extra });
  t.after(() => b.fechar());
  return { b, p: porta(b.url), caminho: caminhoDe(b.url), chamadas: f.chamadas, linhas };
}

test('GET entrega formulário com cabeçalhos de segurança e campos seguros', async (t) => {
  const { p, caminho } = await abrir(t);
  const r = await pedir(p, caminho, { cabecalhos: { host: `127.0.0.1:${p}` } });
  assert.equal(r.status, 200);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.headers['referrer-policy'], 'same-origin');
  assert.match(r.headers['content-security-policy'], /default-src 'none'/);
  assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.doesNotMatch(r.headers['content-security-policy'], /https?:/);
  assert.equal(r.headers['access-control-allow-origin'], undefined);
  assert.match(r.texto, /name="serviceKey" type="password" required autocomplete="off"/);
  assert.match(r.texto, /autocomplete="off"/);
  assert.doesNotMatch(r.texto, /eyJFAKE|sb_publishable_TESTE/);
});

test('Host, Origin e caminho com nonce são exatos; sem CORS', async (t) => {
  const { p, caminho } = await abrir(t);
  const csrf = await csrfDe(p, caminho);
  const corpo = formulario(csrf);
  const hostErrado = await pedir(p, caminho, { metodo: 'POST', cabecalhos: { ...cabecalhosPost(p, corpo), host: 'externo.invalid' }, corpo });
  assert.equal(hostErrado.status, 403);
  const origemErrada = await pedir(p, caminho, { metodo: 'POST', cabecalhos: { ...cabecalhosPost(p, corpo), origin: 'http://localhost:' + p }, corpo });
  assert.equal(origemErrada.status, 403);
  const semOrigem = await pedir(p, caminho, { metodo: 'POST', cabecalhos: { host: `127.0.0.1:${p}`, 'content-type': 'application/x-www-form-urlencoded' }, corpo });
  assert.equal(semOrigem.status, 403);
  const outroNonce = await pedir(p, '/b/' + '0'.repeat(64), { cabecalhos: { host: `127.0.0.1:${p}` } });
  assert.equal(outroNonce.status, 404);
  const opcoes = await pedir(p, caminho, { metodo: 'OPTIONS', cabecalhos: { host: `127.0.0.1:${p}`, origin: 'http://x.invalid' } });
  assert.equal(opcoes.status, 405);
  assert.equal(opcoes.headers['access-control-allow-origin'], undefined);
});

test('token CSRF ausente ou errado é recusado sem chamar validarEntrada nem iniciar', async (t) => {
  const { p, caminho, chamadas } = await abrir(t);
  for (const csrf of [undefined, 'f'.repeat(64)]) {
    const corpo = formulario(csrf ?? '');
    const r = await pedir(p, caminho, { metodo: 'POST', cabecalhos: cabecalhosPost(p, corpo), corpo });
    assert.equal(r.status, 403);
    assert.doesNotMatch(r.texto, /eyJFAKE|sb_publishable_TESTE/);
  }
  assert.equal(chamadas.validar.length, 0);
  assert.equal(chamadas.iniciar.length, 0);
});

test('corpo inválido, tipo não suportado e JSON quebrado são rejeitados', async (t) => {
  const { p, caminho, chamadas } = await abrir(t);
  const csrf = await csrfDe(p, caminho);
  const semChave = new URLSearchParams({ csrf, publicKey: CHAVE_PUB }).toString();
  let r = await pedir(p, caminho, { metodo: 'POST', cabecalhos: cabecalhosPost(p, semChave), corpo: semChave });
  assert.equal(r.status, 400);
  const curta = formulario(csrf, { publicKey: 'curta' });
  r = await pedir(p, caminho, { metodo: 'POST', cabecalhos: cabecalhosPost(p, curta), corpo: curta });
  assert.equal(r.status, 400);
  const texto = 'x=1';
  r = await pedir(p, caminho, { metodo: 'POST', cabecalhos: cabecalhosPost(p, texto, 'text/plain'), corpo: texto });
  assert.equal(r.status, 415);
  const jsonQuebrado = '{nao-json';
  r = await pedir(p, caminho, { metodo: 'POST', cabecalhos: cabecalhosPost(p, jsonQuebrado, 'application/json'), corpo: jsonQuebrado });
  assert.equal(r.status, 400);
  assert.equal(chamadas.iniciar.length, 0);
});

test('corpo acima de 16 KiB é recusado com 413 sem chamadas', async (t) => {
  const { p, caminho, chamadas } = await abrir(t);
  const csrf = await csrfDe(p, caminho);
  const grande = formulario(csrf, { publicKey: 'a'.repeat(LIMITE_CORPO + 10) });
  const r = await pedir(p, caminho, { metodo: 'POST', cabecalhos: cabecalhosPost(p, grande), corpo: grande }).catch(() => ({ status: 413 }));
  assert.equal(r.status, 413);
  assert.equal(chamadas.validar.length, 0);
  assert.equal(chamadas.iniciar.length, 0);
});

test('envio válido chama validarEntrada antes de iniciar com config fixa e porta 53820, depois encerra', async (t) => {
  const ordem = [];
  const { b, p, caminho, chamadas, linhas } = await abrir(t, {
    fakes: { validar: async () => ordem.push('validar'), iniciarImpl: async () => { ordem.push('iniciar'); return { ok: 'L' }; } },
  });
  assert.ok(linhas.length === 1 && linhas[0].includes(b.url));
  assert.ok(!linhas.join('\n').includes(CHAVE_SERVICO) && !linhas.join('\n').includes(CHAVE_PUB));
  const csrf = await csrfDe(p, caminho);
  const corpo = formulario(csrf);
  const r = await pedir(p, caminho, { metodo: 'POST', cabecalhos: cabecalhosPost(p, corpo), corpo });
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.texto, /eyJFAKE|sb_publishable_TESTE/);
  assert.deepEqual(ordem, ['validar', 'iniciar']);
  assert.equal(chamadas.iniciar[0].opts.port, PORTA_QA);
  assert.equal(PORTA_QA, 53820);
  const cfg = chamadas.iniciar[0].cfg;
  assert.equal(cfg.publicKey, CHAVE_PUB);
  assert.equal(cfg.serviceKey, CHAVE_SERVICO);
  assert.equal(cfg.authUrl, 'https://luguscapasskcsficckf.supabase.co');
  assert.deepEqual(cfg.emailsPermitidos, ['operador-a@qa.invalid', 'operador-b@qa.invalid']);
  assert.deepEqual(cfg.contextos, [
    { empresaId: 'a1000000-0000-4000-8000-000000000002', processoId: 'a1000000-0000-4000-8000-000000000003' },
    { empresaId: 'b1000000-0000-4000-8000-000000000002', processoId: 'b1000000-0000-4000-8000-000000000003' },
  ]);
  assert.deepEqual(cfg.iaOrganizacoes, ['a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001']);
  assert.deepEqual(await b.resultado, { ok: 'L' });
  await assert.rejects(pedir(p, caminho, { cabecalhos: { host: `127.0.0.1:${p}` } }), /ECONNREFUSED/);
});

test('reutilização após sucesso e concorrência retornam recusa e não repetem a chamada', async (t) => {
  let liberar;
  const segurar = new Promise((r) => { liberar = r; });
  let inicioChegou;
  const chegou = new Promise((r) => { inicioChegou = r; });
  const { b, p, caminho, chamadas } = await abrir(t, {
    fakes: { iniciarImpl: async () => { inicioChegou(); await segurar; return { ok: 1 }; } },
  });
  const csrf = await csrfDe(p, caminho);
  const corpo = formulario(csrf);
  const primeira = pedir(p, caminho, { metodo: 'POST', cabecalhos: cabecalhosPost(p, corpo), corpo });
  await chegou;
  const concorrente = await pedir(p, caminho, { metodo: 'POST', cabecalhos: cabecalhosPost(p, corpo), corpo }).catch((e) => ({ status: 'erro', erro: e }));
  assert.equal(concorrente.status, 409);
  const getConcorrente = await pedir(p, caminho, { cabecalhos: { host: `127.0.0.1:${p}` } });
  assert.equal(getConcorrente.status, 409);
  liberar();
  assert.equal((await primeira).status, 200);
  assert.equal(chamadas.iniciar.length, 1);
  await b.resultado;
});

test('validarEntrada recusando devolve erro genérico, mantém janela e permite nova tentativa', async (t) => {
  let vezes = 0;
  const { b, p, caminho, chamadas } = await abrir(t, {
    fakes: { validar: async () => { vezes += 1; if (vezes === 1) throw new Error('vazou ' + CHAVE_SERVICO); } },
  });
  const csrf = await csrfDe(p, caminho);
  const corpo = formulario(csrf);
  const primeira = await pedir(p, caminho, { metodo: 'POST', cabecalhos: cabecalhosPost(p, corpo), corpo });
  assert.equal(primeira.status, 400);
  assert.equal(primeira.texto, MSG_GENERICA);
  assert.doesNotMatch(primeira.texto, /vazou|eyJFAKE/);
  assert.equal(chamadas.iniciar.length, 0);
  const segunda = await pedir(p, caminho, { metodo: 'POST', cabecalhos: cabecalhosPost(p, corpo), corpo });
  assert.equal(segunda.status, 200);
  await b.resultado;
});

test('falha de iniciar devolve erro genérico, sem vazar a mensagem, e encerra a janela', async (t) => {
  const { b, p, caminho } = await abrir(t, {
    fakes: { iniciarImpl: async () => { throw new Error('falhou com ' + CHAVE_SERVICO); } },
  });
  const csrf = await csrfDe(p, caminho);
  const corpo = formulario(csrf);
  const r = await pedir(p, caminho, { metodo: 'POST', cabecalhos: cabecalhosPost(p, corpo), corpo });
  assert.equal(r.status, 500);
  assert.equal(r.texto, MSG_GENERICA);
  assert.doesNotMatch(r.texto, /falhou|eyJFAKE/);
  await assert.rejects(b.resultado, { message: MSG_GENERICA });
});

test('expiração encerra a janela e recusa qualquer envio posterior', async (t) => {
  const { b, p, caminho, chamadas } = await abrir(t, { extra: { ttlMs: 40 } });
  await assert.rejects(b.resultado, { message: MSG_GENERICA });
  await new Promise((r) => setTimeout(r, 30));
  await assert.rejects(pedir(p, caminho, { cabecalhos: { host: `127.0.0.1:${p}` } }), /ECONNREFUSED/);
  assert.equal(chamadas.iniciar.length, 0);
});

test('nenhuma chave aparece na saída de linha de comando', async (t) => {
  const { b, p, caminho, linhas } = await abrir(t);
  const csrf = await csrfDe(p, caminho);
  const corpo = formulario(csrf);
  await pedir(p, caminho, { metodo: 'POST', cabecalhos: cabecalhosPost(p, corpo), corpo });
  await b.resultado;
  const todas = linhas.join('\n');
  assert.doesNotMatch(todas, /eyJFAKE|sb_publishable_TESTE/);
});
