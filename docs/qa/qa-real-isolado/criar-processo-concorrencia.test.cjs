// Concorrência real do handler de cadastro: duas chamadas em voo, controladas por promise deferred.
// O handler é o arquivo real; só _auth e fetch são substituídos (usuário e REST fictícios).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const HANDLER = path.resolve(__dirname, '..', '..', '..', 'netlify', 'functions', 'criar-processo.js');
const AUTH = path.resolve(__dirname, '..', '..', '..', 'netlify', 'functions', '_auth.js');
const ORG = 'a1000000-0000-4000-8000-000000000001', EMP = 'a1000000-0000-4000-8000-000000000002';
const USU1 = '258eddfe-d761-4ec9-ae63-ee5e5b8db408', USU2 = '358eddfe-d761-4ec9-ae63-ee5e5b8db409';

function adiar() { let resolve; const p = new Promise(r => { resolve = r; }); return { p, resolve }; }

// Um único módulo do handler (um só mapa emAndamento, como em produção). _auth identifica o usuário pelo token.
function carregarHandler() {
  delete require.cache[HANDLER];
  require.cache[AUTH] = { id: AUTH, filename: AUTH, loaded: true, children: [], paths: [], exports: {
    cabecalhosPadrao: () => ({}),
    exigirUsuarioLogado: async (event) => {
      const t = (event.headers && event.headers.authorization) || '';
      if (t === 'Bearer TOKEN-USU1') return { ok: true, userId: USU1 };
      if (t === 'Bearer TOKEN-USU2') return { ok: true, userId: USU2 };
      return { ok: false, status: 401, erro: 'Sessão inválida.' };
    },
  } };
  return require(HANDLER).handler;
}

// REST fictício com gate: a primeira gravação espera o deferred; `chegou` avisa que a gravação começou.
function instalarRest(banco, gate) {
  const original = global.fetch;
  let chegou; const cheguei = new Promise(r => { chegou = r; });
  // Sinal: a segunda leitura de membros (pedido concorrente já em voo, antes do ponto de compartilhar) aconteceu.
  let membrosVistos = 0; let doisChegaram; const dois = new Promise(r => { doisChegaram = r; });
  global.fetch = async (url, op = {}) => {
    const u = new URL(url), m = (op.method || 'GET').toUpperCase(), tabela = u.pathname.replace('/rest/v1/', '');
    const json = (corpo, status = 200) => ({ ok: status < 300, status, json: async () => corpo, text: async () => JSON.stringify(corpo) });
    if (tabela === 'clientes') return json([{ status: 'aprovado' }]);
    if (tabela === 'operacao_empresas') return json([{ id: EMP, organizacao_id: ORG }]);
    if (tabela === 'operacao_membros') { membrosVistos += 1; if (membrosVistos === 2) doisChegaram(); return json([{ papel: 'gestor', empresa_id: null }]); }
    if (tabela === 'operacao_processos' && m === 'GET') {
      const id = u.searchParams.get('id'), numero = u.searchParams.get('numero');
      if (id) return json(banco.linhas.filter(l => 'eq.' + l.id === id).map(({ criado_por, empresa_id, organizacao_id, id: i, objeto, numero: n, orgao, modalidade }) => ({ id: i, empresa_id, organizacao_id, objeto, numero: n, orgao, modalidade, criado_por })));
      if (numero) return json([]);
    }
    if (tabela === 'operacao_processos' && m === 'POST') {
      const corpo = JSON.parse(op.body);
      if (!gate.aberto) { chegou(); await gate.p; }
      if (banco.linhas.some(l => l.id === corpo.id)) return json({}, 409);
      banco.linhas.push(corpo); banco.inserts += 1;
      return json([corpo], 201);
    }
    throw Error('destino inesperado ' + m + ' ' + tabela);
  };
  // Espera o segundo pedido alcançar o ponto de compartilhar antes de liberar a gravação.
  const segundoEmVoo = async () => { await dois; await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r)); };
  return { cheguei, segundoEmVoo, restaurar: () => { global.fetch = original; } };
}

const evento = (corpo, usuario = USU1) => ({ httpMethod: 'POST', headers: { authorization: usuario === USU2 ? 'Bearer TOKEN-USU2' : 'Bearer TOKEN-USU1' }, body: JSON.stringify(corpo) });
const dados = (extra = {}) => ({ empresaId: EMP, tentativaId: randomUUID(), objeto: 'Aquisição fictícia', numero: 'PE-CONC-1', orgao: 'Órgão', modalidade: 'Pregão', ...extra });

test('mesmo id, mesmo usuário e mesmos dados em voo: a segunda chamada compartilha a primeira e não grava de novo', async () => {
  const banco = { linhas: [], inserts: 0 }; const gate = { aberto: false, ...adiar() };
  const rest = instalarRest(banco, gate);
  try {
    const handler = carregarHandler(); const corpo = dados();
    const primeira = handler(evento(corpo));
    await rest.cheguei;
    const segunda = handler(evento(corpo));
    await rest.segundoEmVoo();
    gate.resolve();
    const [a, b] = await Promise.all([primeira, segunda]);
    assert.equal(a.statusCode, 201); assert.equal(b.statusCode, 201);
    assert.equal(JSON.parse(a.body).processo.id, corpo.tentativaId);
    assert.equal(JSON.parse(b.body).processo.id, corpo.tentativaId);
    assert.equal(banco.inserts, 1);
  } finally { rest.restaurar(); }
});

test('mesmo id com outros dados em voo: a segunda chamada é 409 imediato, sem compartilhar sucesso da primeira', async () => {
  const banco = { linhas: [], inserts: 0 }; const gate = { aberto: false, ...adiar() };
  const rest = instalarRest(banco, gate);
  try {
    const handler = carregarHandler(); const corpo = dados();
    const primeira = handler(evento(corpo));
    await rest.cheguei;
    const divergente = await handler(evento({ ...corpo, objeto: 'Outro objeto fictício' }));
    assert.equal(divergente.statusCode, 409);
    assert.match(JSON.parse(divergente.body).erro, /outros dados/);
    gate.resolve();
    const a = await primeira;
    assert.equal(a.statusCode, 201, 'a primeira segue e conclui com os dados originais');
    assert.equal(JSON.parse(a.body).processo.objeto, 'Aquisição fictícia');
    assert.equal(banco.inserts, 1);
  } finally { rest.restaurar(); }
});

test('mesmo id com outros espaços apenas é o mesmo cadastro em voo (normalização)', async () => {
  const banco = { linhas: [], inserts: 0 }; const gate = { aberto: false, ...adiar() };
  const rest = instalarRest(banco, gate);
  try {
    const handler = carregarHandler(); const corpo = dados();
    const primeira = handler(evento(corpo));
    await rest.cheguei;
    const segunda = handler(evento({ ...corpo, objeto: '  Aquisição fictícia  ' }));
    await rest.segundoEmVoo();
    gate.resolve();
    assert.equal((await segunda).statusCode, 201);
    assert.equal((await primeira).statusCode, 201);
    assert.equal(banco.inserts, 1);
  } finally { rest.restaurar(); }
});

test('mesmo id de OUTRO usuário em voo é 409 antes de compartilhar, mesmo com dados idênticos', async () => {
  const banco = { linhas: [], inserts: 0 }; const gate = { aberto: false, ...adiar() };
  const rest = instalarRest(banco, gate);
  try {
    const corpo = dados();
    const handler = carregarHandler();
    const primeira = handler(evento(corpo));
    await rest.cheguei;
    const alheia = await handler(evento(corpo, USU2));
    assert.equal(alheia.statusCode, 409);
    assert.match(JSON.parse(alheia.body).erro, /outro usuário/);
    gate.resolve();
    assert.equal((await primeira).statusCode, 201);
    assert.equal(banco.inserts, 1);
  } finally { rest.restaurar(); }
});

test('linha existente sem criador (ou de outro usuário) não é reaproveitada: 409 e sem escrita', async () => {
  const banco = { linhas: [{ id: '', empresa_id: EMP, organizacao_id: ORG, objeto: 'Aquisição fictícia', numero: null, orgao: null, modalidade: null, criado_por: null }], inserts: 0 };
  const gate = { aberto: true, aoAbrir: null };
  const rest = instalarRest(banco, gate);
  try {
    const corpo = dados();
    banco.linhas[0].id = corpo.tentativaId;
    const r = await carregarHandler()(evento(corpo));
    assert.equal(r.statusCode, 409);
    assert.equal(banco.inserts, 0);
  } finally { rest.restaurar(); }
});
