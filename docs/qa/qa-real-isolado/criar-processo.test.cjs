// Cadastro de processo para empresa autorizada, pela rota QA real (servidor + handler copiado) com REST fictício.
// O REST fictício aplica a checagem de vínculo da RLS e a PK do id; a idempotência usa o id estável da tentativa.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { criarServidor } = require('./servidor.cjs');
const { preparar, QA } = require('./isolamento.cjs');

const U = '258eddfe-d761-4ec9-ae63-ee5e5b8db408', TOK = 'TOKEN-USUARIO-FICTICIO';
const ORG_A = 'a1000000-0000-4000-8000-000000000001', ORG_B = 'b1000000-0000-4000-8000-000000000001';
const EMP_A = 'a1000000-0000-4000-8000-000000000002', EMP_A2 = 'a1000000-0000-4000-8000-000000000005';
const EMP_B = 'b1000000-0000-4000-8000-000000000002';
const PROC_A = 'a1000000-0000-4000-8000-000000000003';

function banco() {
  return {
    clientes: [{ id: U, status: 'aprovado' }],
    operacao_empresas: [
      { id: EMP_A, organizacao_id: ORG_A, razao_social: 'EMPRESA FICTÍCIA A', ativo: true },
      { id: EMP_A2, organizacao_id: ORG_A, razao_social: 'EMPRESA FICTÍCIA A2 (sem processo)', ativo: true },
      { id: EMP_B, organizacao_id: ORG_B, razao_social: 'EMPRESA FICTÍCIA B', ativo: true },
    ],
    operacao_membros: [{ usuario_id: U, organizacao_id: ORG_A, empresa_id: null, papel: 'gestor' }],
    operacao_processos: [{ id: PROC_A, empresa_id: EMP_A, organizacao_id: ORG_A, numero: 'PE-FICT-A-001', objeto: 'Objeto fictício A', criado_por: U }],
    inserts: [],
  };
}

// Filtros mínimos do PostgREST usados pelo código: eq.X e in.(a,b).
function filtrar(linhas, sp) {
  let r = linhas;
  for (const [k, v] of sp) {
    if (k === 'select') continue;
    if (v.startsWith('eq.')) { const x = decodeURIComponent(v.slice(3)); r = r.filter(l => String(l[k]) === x); }
    else if (v.startsWith('in.(')) { const lista = v.slice(4, -1).split(','); r = r.filter(l => lista.includes(String(l[k]))); }
  }
  return r;
}

// Opções de falha do REST fictício: perder a resposta depois de gravar, ou atrasar a gravação.
function fetchFicticio(b, falhas = {}) {
  return async (url, op = {}) => {
    const u = new URL(url), metodo = (op.method || 'GET').toUpperCase();
    if (u.pathname === '/auth/v1/token') return Response.json({ access_token: TOK, expires_in: 60, user: { id: U } });
    if (u.pathname === '/auth/v1/user') return new Headers(op.headers).get('authorization') === 'Bearer ' + TOK ? Response.json({ id: U, email: 'operador-a@qa.invalid' }) : new Response('{}', { status: 401 });
    const tabela = u.pathname.replace('/rest/v1/', '');
    if (!Array.isArray(b[tabela])) throw Error('Destino inesperado ' + u.pathname);
    if (metodo === 'GET') return Response.json(filtrar(b[tabela], u.searchParams));
    if (metodo === 'POST' && tabela === 'operacao_processos') {
      const corpo = JSON.parse(op.body);
      const empresaOk = b.operacao_empresas.some(e => e.id === corpo.empresa_id && e.organizacao_id === corpo.organizacao_id);
      const vinculo = b.operacao_membros.some(m => m.usuario_id === U && m.organizacao_id === corpo.organizacao_id && ['gestor', 'operador'].includes(m.papel) && (m.empresa_id === null || m.empresa_id === corpo.empresa_id));
      if (!empresaOk || !vinculo) return new Response('{}', { status: 403 });
      if (b.operacao_processos.some(x => x.id === corpo.id)) return new Response('{}', { status: 409 }); // PK
      const linha = { ...corpo, status: 'triagem' };
      if (falhas.atrasar) await new Promise(r => setTimeout(r, falhas.atrasar));
      b.operacao_processos.push(linha); b.inserts.push(linha);
      if (falhas.perderResposta) { falhas.perderResposta = false; throw new Error('conexão caiu após gravar'); }
      return Response.json([linha], { status: 201 });
    }
    throw Error('Método inesperado ' + metodo + ' ' + u.pathname);
  };
}

function req(port, rota, corpo, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ agent: false, hostname: '127.0.0.1', port, path: rota, method: corpo === undefined ? 'GET' : 'POST', headers: { origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json', ...headers } }, s => {
      let text = ''; s.on('data', x => text += x); s.on('end', () => resolve({ status: s.statusCode, headers: s.headers, text }));
    });
    r.on('error', reject);
    if (corpo !== undefined) r.end(typeof corpo === 'string' ? corpo : JSON.stringify(corpo)); else r.end();
  });
}

function registroTemporario(t) {
  const dir = fs.mkdtempSync(path.join(__dirname, '.sandbox', 'criados-teste-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'criados.json');
}

async function subir(t, { empresasQA = [EMP_A2], b = banco(), falhas = {}, registro = registroTemporario(t) } = {}) {
  const copia = preparar({ authUrl: QA, restUrl: QA, storageUrl: QA, publicKey: 'sb_publishable_qa_ficticia' });
  const s = criarServidor({ copia, serviceKey: 'SERVICE-FICTICIO', emailsPermitidos: ['operador-a@qa.invalid'], contextos: [{ empresaId: EMP_A, processoId: PROC_A }], empresasQA, registroCriados: registro, fetchImpl: fetchFicticio(b, falhas) });
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const fechar = () => new Promise(r => s.close(r));
  t.after(fechar);
  const port = s.address().port;
  const login = await req(port, '/qa/login', { email: 'operador-a@qa.invalid', password: 'FICTICIA' });
  assert.equal(login.status, 200);
  return { port, b, registro, fechar, cookie: login.headers['set-cookie'][0].split(';')[0] };
}

const criar = (s, corpo, cookie = s.cookie) => req(s.port, '/api/criar-processo', corpo, cookie ? { cookie } : {});
const base = (extra = {}) => ({ empresaId: EMP_A2, tentativaId: randomUUID(), objeto: 'Aquisição fictícia de equipamentos', numero: 'PE-FICT-A2-001', orgao: 'Órgão fictício', modalidade: 'Pregão', ...extra });
const descoberta = async s => JSON.parse((await req(s.port, '/qa/session', undefined, { cookie: s.cookie })).text);

test('sem sessão QA a criação é recusada antes de qualquer leitura ou escrita', async t => {
  const s = await subir(t);
  assert.equal((await criar(s, base(), null)).status, 401);
  assert.equal(s.b.inserts.length, 0);
});

test('empresa autorizada sem processo: cria com o id da tentativa e a descoberta passa a listá-lo', async t => {
  const s = await subir(t);
  const corpo = base();
  const r = await criar(s, corpo);
  assert.equal(r.status, 201);
  const p = JSON.parse(r.text).processo;
  assert.equal(p.id, corpo.tentativaId, 'o id do processo é o da tentativa');
  assert.equal(p.empresa_id, EMP_A2);
  assert.equal(s.b.inserts[0].organizacao_id, ORG_A, 'organização vem do vínculo, não do cliente');
  assert.equal(s.b.inserts[0].criado_por, U);
  const sessao = await descoberta(s);
  assert.ok(sessao.contextos.some(c => c.empresaId === EMP_A2 && c.processoId === p.id));
  assert.ok(sessao.empresas.some(e => e.empresaId === EMP_A2), 'empresa sem processo aparece');
  assert.ok(!sessao.contextos.some(c => c.processoId !== PROC_A && c.processoId !== p.id), 'nenhum outro processo entra');
});

test('repetição com o mesmo id reaproveita a linha, sem nova gravação e sem duplicar', async t => {
  const s = await subir(t);
  const corpo = base();
  assert.equal((await criar(s, corpo)).status, 201);
  const segundo = await criar(s, corpo);
  assert.equal(segundo.status, 200);
  assert.equal(JSON.parse(segundo.text).reaproveitado, true);
  assert.equal(s.b.inserts.length, 1);
});

test('resposta perdida após gravar: reconcilia pelo id e devolve o mesmo processo, sem segunda linha', async t => {
  const s = await subir(t, { falhas: { perderResposta: true } });
  const corpo = base();
  const r = await criar(s, corpo);
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.text).processo.id, corpo.tentativaId);
  assert.equal(s.b.inserts.length, 1);
});

test('mesmo id com outros campos normalizados é conflito distinto e não grava', async t => {
  const s = await subir(t);
  const corpo = base();
  assert.equal((await criar(s, corpo)).status, 201);
  const r = await criar(s, { ...corpo, objeto: 'Outro objeto fictício' });
  assert.equal(r.status, 409);
  assert.match(JSON.parse(r.text).erro, /outros dados/);
  assert.equal(s.b.inserts.length, 1);
});

test('mesmo id com espaços a mais nos campos é o mesmo cadastro (normalização)', async t => {
  const s = await subir(t);
  const corpo = base({ objeto: 'Aquisição fictícia de equipamentos' });
  assert.equal((await criar(s, corpo)).status, 201);
  assert.equal((await criar(s, { ...corpo, objeto: '  Aquisição fictícia de equipamentos  ' })).status, 200);
});

test('clique duplo com o mesmo id: as duas respostas são o mesmo processo e uma só gravação', async t => {
  const s = await subir(t, { falhas: { atrasar: 60 } });
  const corpo = base();
  const [a, b] = await Promise.all([criar(s, corpo), criar(s, corpo)]);
  assert.ok([200, 201].includes(a.status) && [200, 201].includes(b.status));
  assert.equal(JSON.parse(a.text).processo.id, JSON.parse(b.text).processo.id);
  assert.equal(s.b.inserts.length, 1);
});

test('outra tentativa da mesma empresa em andamento é recusada com limite explícito, sem gravar', async t => {
  const s = await subir(t, { falhas: { atrasar: 80 } });
  const primeira = criar(s, base());
  await new Promise(r => setTimeout(r, 15));
  const segunda = await criar(s, base());
  assert.equal(segunda.status, 409);
  assert.match(JSON.parse(segunda.text).erro, /em andamento/);
  assert.equal((await primeira).status, 201);
  assert.equal(s.b.inserts.length, 1);
});

test('número já existente na mesma empresa é recusado sem gravar (checagem prévia, não unique)', async t => {
  const s = await subir(t, { empresasQA: [EMP_A] });
  const r = await criar(s, base({ empresaId: EMP_A, numero: 'PE-FICT-A-001' }));
  assert.equal(r.status, 409);
  assert.equal(s.b.inserts.length, 0);
});

test('campos inválidos e campos não permitidos são recusados antes da escrita', async t => {
  const s = await subir(t);
  const casos = [
    { objeto: '' }, { objeto: 'ab' }, { objeto: 'x'.repeat(501) }, { numero: 'x'.repeat(61) }, { orgao: 'x'.repeat(201) },
    { numero: 'PE\u0007' },
    { organizacao_id: ORG_B }, { status: 'arquivado' }, { criado_por: 'outro' },
  ];
  for (const extra of casos) assert.equal((await criar(s, base(extra))).status, 400, JSON.stringify(extra));
  assert.equal((await criar(s, base({ empresaId: 'nao-uuid' }))).status, 403, 'empresa inválida fecha antes do handler');
  assert.equal((await criar(s, base({ tentativaId: 'nao-uuid' }))).status, 403, 'tentativa inválida fecha antes do handler');
  assert.equal((await criar(s, '{ruim')).status, 400);
  assert.equal(s.b.inserts.length, 0);
});

test('CNPJ de outra organização não grava: fora dos fixtures o servidor recusa; com fixture, o vínculo do token recusa', async t => {
  const fora = await subir(t);
  assert.equal((await criar(fora, base({ empresaId: EMP_B }))).status, 403);
  assert.equal(fora.b.inserts.length, 0);

  const dentro = await subir(t, { empresasQA: [EMP_A2, EMP_B] });
  assert.equal((await criar(dentro, base({ empresaId: EMP_B }))).status, 403, 'usuário sem vínculo na organização B não grava');
  assert.equal(dentro.b.inserts.length, 0);
});

test('descoberta sobrevive a relogin e a reinício: o registro durável devolve o processo criado, sem processos alheios', async t => {
  const b = banco();
  const registro = registroTemporario(t);
  const primeira = await subir(t, { b, registro });
  const corpo = base();
  assert.equal((await criar(primeira, corpo)).status, 201);
  await primeira.fechar();

  // Reinício do servidor com o mesmo registro e o mesmo banco.
  const segunda = await subir(t, { b, registro });
  const sessao = await descoberta(segunda);
  assert.ok(sessao.contextos.some(c => c.processoId === corpo.tentativaId), 'processo criado sobrevive ao reinício');
  assert.ok(sessao.contextos.some(c => c.processoId === PROC_A));
  assert.equal(sessao.contextos.filter(c => c.processoId !== PROC_A && c.processoId !== corpo.tentativaId).length, 0, 'não devolve todos os processos da empresa');
  const conteudo = fs.readFileSync(registro, 'utf8');
  assert.doesNotMatch(conteudo, /TOKEN|senha|FICTICIA|objeto|Aquisição/i, 'registro guarda só ids');
});

test('ID de linha alheia existente não vira par do usuário: 409, sem registro e sem aparecer na descoberta', async t => {
  const b = banco();
  const alheio = 'c1000000-0000-4000-8000-000000000009';
  b.operacao_processos.push({ id: alheio, empresa_id: EMP_A2, organizacao_id: ORG_A, numero: null, objeto: 'Objeto de outro usuário', criado_por: '358eddfe-d761-4ec9-ae63-ee5e5b8db409' });
  const registro = registroTemporario(t);
  const s = await subir(t, { b, registro });
  const r = await criar(s, base({ tentativaId: alheio }));
  assert.equal(r.status, 409);
  assert.equal(b.inserts.length, 0);
  assert.equal(fs.existsSync(registro) ? JSON.parse(fs.readFileSync(registro, 'utf8')).length : 0, 0, 'nada registrado após recusa');
  const sessao = await descoberta(s);
  assert.equal(sessao.contextos.some(c => c.processoId === alheio), false);
});

test('registro corrompido impede o servidor de subir (falha fechada, sem filtrar em silêncio)', async t => {
  const registro = registroTemporario(t);
  fs.writeFileSync(registro, JSON.stringify([{ userId: U, empresaId: EMP_A, processoId: 'nao-uuid' }]));
  await assert.rejects(() => subir(t, { registro }), /corrompido/);
});
