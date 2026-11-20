const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { descobrirContextos, MAX_LINHAS, MAX_PARES } = require('./descoberta-contextos.cjs');
const { criarServidor } = require('./servidor.cjs');
const { preparar, QA } = require('./isolamento.cjs');

const USER = '258eddfe-d761-4ec9-ae63-ee5e5b8db408';
const ORG_A = 'a1000000-0000-4000-8000-000000000001', ORG_B = 'b1000000-0000-4000-8000-000000000001';
const EMP_A = 'a1000000-0000-4000-8000-000000000002', EMP_B = 'b1000000-0000-4000-8000-000000000002';
const PROC_A = 'a1000000-0000-4000-8000-000000000003', PROC_A2 = 'a1000000-0000-4000-8000-000000000005';
const PROC_B = 'b1000000-0000-4000-8000-000000000003';
const base = { restUrl: QA, publicKey: 'sb_publishable_qa_ficticia', token: 'TOKEN-FICTICIO', userId: USER };
const uid = (prefixo, n) => `${prefixo}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const membro = (org, empresa = null, papel = 'operador') => ({ usuario_id: USER, organizacao_id: org, empresa_id: empresa, papel });
const ALLOW = [{ empresaId: EMP_A, processoId: PROC_A }];

// Fonte fictícia: devolve o que foi configurado, ignorando filtros (pior caso para o módulo).
function fonte(tabelas) {
  const urls = [];
  const transporte = async url => {
    urls.push(url);
    const tabela = new URL(url).pathname.replace('/rest/v1/', '');
    if (!(tabela in tabelas)) throw Error('tabela inesperada ' + tabela);
    return Response.json(tabelas[tabela]);
  };
  return { transporte, urls };
}

test('par autorizado não some atrás de 150 registros irrelevantes; limite não trunca a lista', async () => {
  const irrelevantesEmp = Array.from({ length: 150 }, (_, i) => ({ id: uid('e', i + 1), organizacao_id: ORG_B, ativo: true }));
  const irrelevantesProc = Array.from({ length: 150 }, (_, i) => ({ id: uid('f', i + 1), empresa_id: uid('e', i + 1), organizacao_id: ORG_B }));
  const f = fonte({
    operacao_empresas: [...irrelevantesEmp, { id: EMP_A, organizacao_id: ORG_A }],
    operacao_membros: [membro(ORG_A)],
    operacao_processos: [...irrelevantesProc, { id: PROC_A, empresa_id: EMP_A, organizacao_id: ORG_A }],
  });
  assert.deepEqual(await descobrirContextos({ ...base, transporte: f.transporte, allowlist: ALLOW }), ALLOW);
});

test('consultas só contêm ids da allowlist; ids de fora nunca são pedidos à fonte', async () => {
  const f = fonte({ operacao_empresas: [], operacao_membros: [], operacao_processos: [] });
  await descobrirContextos({ ...base, transporte: f.transporte, allowlist: [...ALLOW, { empresaId: EMP_B, processoId: PROC_B }] });
  const texto = f.urls.map(decodeURIComponent).join('\n');
  for (const id of [EMP_A, EMP_B, PROC_A, PROC_B]) assert.match(texto, new RegExp(id));
  assert.doesNotMatch(texto, /a1000000-0000-4000-8000-000000000005/);
  assert.ok(f.urls.every(u => !/limit=|offset=/.test(u)), 'sem limite fixo nem paginação implícita');
});

test('linha extra devolvida pela fonte não entra no resultado', async () => {
  const f = fonte({
    operacao_empresas: [{ id: EMP_A, organizacao_id: ORG_A }, { id: EMP_B, organizacao_id: ORG_B }],
    operacao_membros: [membro(ORG_A), membro(ORG_B)],
    operacao_processos: [{ id: PROC_A, empresa_id: EMP_A, organizacao_id: ORG_A }, { id: PROC_B, empresa_id: EMP_B, organizacao_id: ORG_B }, { id: PROC_A2, empresa_id: EMP_A, organizacao_id: ORG_A }],
  });
  assert.deepEqual(await descobrirContextos({ ...base, transporte: f.transporte, allowlist: ALLOW }), ALLOW);
});

test('organização, vínculo, papel e atividade são validados para cada par da allowlist', async () => {
  const pares = [{ empresaId: EMP_A, processoId: PROC_A }, { empresaId: EMP_B, processoId: PROC_B }];
  const casos = [
    ['processo de outra organização', { operacao_empresas: [{ id: EMP_A, organizacao_id: ORG_A }], operacao_membros: [membro(ORG_A)], operacao_processos: [{ id: PROC_A, empresa_id: EMP_A, organizacao_id: ORG_B }] }],
    ['membro só de outra organização', { operacao_empresas: [{ id: EMP_A, organizacao_id: ORG_A }], operacao_membros: [membro(ORG_B)], operacao_processos: [{ id: PROC_A, empresa_id: EMP_A, organizacao_id: ORG_A }] }],
    ['papel de leitor', { operacao_empresas: [{ id: EMP_A, organizacao_id: ORG_A }], operacao_membros: [membro(ORG_A, null, 'leitor')], operacao_processos: [{ id: PROC_A, empresa_id: EMP_A, organizacao_id: ORG_A }] }],
    ['empresa inativa (ausente na fonte)', { operacao_empresas: [], operacao_membros: [membro(ORG_A)], operacao_processos: [{ id: PROC_A, empresa_id: EMP_A, organizacao_id: ORG_A }] }],
    ['vínculo restrito a outra empresa', { operacao_empresas: [{ id: EMP_A, organizacao_id: ORG_A }], operacao_membros: [membro(ORG_A, EMP_B)], operacao_processos: [{ id: PROC_A, empresa_id: EMP_A, organizacao_id: ORG_A }] }],
  ];
  for (const [nome, tabelas] of casos) {
    const f = fonte(tabelas);
    assert.deepEqual(await descobrirContextos({ ...base, transporte: f.transporte, allowlist: pares }).then(r => r.filter(x => x.empresaId === EMP_A)), [], nome);
  }
  const ok = fonte({ operacao_empresas: [{ id: EMP_A, organizacao_id: ORG_A }], operacao_membros: [membro(ORG_A, EMP_A)], operacao_processos: [{ id: PROC_A, empresa_id: EMP_A, organizacao_id: ORG_A }] });
  assert.deepEqual(await descobrirContextos({ ...base, transporte: ok.transporte, allowlist: ALLOW }), ALLOW, 'vínculo da própria empresa vale');
});

test('resposta no limite de linhas falha fechado em vez de truncar', async () => {
  const f = fonte({
    operacao_empresas: [{ id: EMP_A, organizacao_id: ORG_A }],
    operacao_membros: Array.from({ length: MAX_LINHAS }, (_, i) => membro(ORG_A, null, 'operador')),
    operacao_processos: [{ id: PROC_A, empresa_id: EMP_A, organizacao_id: ORG_A }],
  });
  await assert.rejects(descobrirContextos({ ...base, transporte: f.transporte, allowlist: ALLOW }), /incompleta/);
});

test('entradas inválidas falham antes de qualquer consulta', async () => {
  const f = fonte({ operacao_empresas: [], operacao_membros: [], operacao_processos: [] });
  const tentar = (extra, msg) => assert.rejects(descobrirContextos({ ...base, transporte: f.transporte, ...extra }), msg);
  await tentar({ allowlist: [] }, /Allowlist QA inválida/);
  await tentar({ allowlist: [{ empresaId: 'nao-uuid', processoId: PROC_A }] }, /Allowlist QA inválida/);
  await tentar({ allowlist: Array.from({ length: MAX_PARES + 1 }, (_, i) => ({ empresaId: uid('e', i + 1), processoId: uid('f', i + 1) })) }, /Allowlist QA inválida/);
  await tentar({ allowlist: ALLOW, userId: 'nao-uuid' }, /Sessão inválida/);
  await tentar({ allowlist: ALLOW, token: '' }, /Sessão inválida/);
  assert.equal(f.urls.length, 0, 'nenhuma consulta feita com entrada inválida');
});

test('falha HTTP da fonte propaga como erro', async () => {
  const transporte = async () => new Response('x', { status: 503 });
  await assert.rejects(descobrirContextos({ ...base, transporte, allowlist: ALLOW }), /indisponível/);
});

test('servidor: /qa/session devolve só o par da allowlist mesmo com linhas extras da fonte', async t => {
  const copia = preparar({ authUrl: QA, restUrl: QA, storageUrl: QA, publicKey: 'sb_publishable_qa_ficticia' });
  const s = criarServidor({ copia, serviceKey: 'SERVICE-SECRETA', emailsPermitidos: ['operador-a@qa.invalid'], contextos: ALLOW, fetchImpl: async url => {
    const u = new URL(url);
    if (u.pathname === '/auth/v1/token') return Response.json({ access_token: 'TOKEN-FICTICIO', expires_in: 60, user: { id: USER } });
    if (u.pathname === '/rest/v1/operacao_empresas') return Response.json([{ id: EMP_A, organizacao_id: ORG_A }, { id: EMP_B, organizacao_id: ORG_B }]);
    if (u.pathname === '/rest/v1/operacao_membros') return Response.json([membro(ORG_A), membro(ORG_B)]);
    if (u.pathname === '/rest/v1/operacao_processos') return Response.json([{ id: PROC_A, empresa_id: EMP_A, organizacao_id: ORG_A }, { id: PROC_A2, empresa_id: EMP_A, organizacao_id: ORG_A }, { id: PROC_B, empresa_id: EMP_B, organizacao_id: ORG_B }]);
    throw Error('Destino inesperado ' + u.pathname);
  } });
  await new Promise(r => s.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => s.close(r)));
  const porta = s.address().port;
  const req = (rota, corpo, cookie) => new Promise((resolve, reject) => {
    const r = http.request({ agent: false, hostname: '127.0.0.1', port: porta, path: rota, method: corpo === undefined ? 'GET' : 'POST', headers: { origin: `http://127.0.0.1:${porta}`, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } }, res => {
      let text = ''; res.on('data', b => text += b); res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    r.on('error', reject); if (corpo !== undefined) r.write(JSON.stringify(corpo)); r.end();
  });
  const cabecalho = await new Promise((resolve, reject) => {
    const r = http.request({ agent: false, hostname: '127.0.0.1', port: porta, path: '/qa/login', method: 'POST', headers: { origin: `http://127.0.0.1:${porta}`, 'content-type': 'application/json' } }, res => { res.resume(); res.on('end', () => resolve(res.headers['set-cookie'][0].split(';')[0])); });
    r.on('error', reject); r.end(JSON.stringify({ email: 'operador-a@qa.invalid', password: 'ficticia' }));
  });
  const sessao = JSON.parse((await req('/qa/session', undefined, cabecalho)).text);
  assert.deepEqual(sessao.contextos, ALLOW);
  assert.doesNotMatch(JSON.stringify(sessao), /TOKEN-FICTICIO|SERVICE-SECRETA/);
  assert.equal((await req('/api/kit-documentos', { acao: 'consultar', empresaId: EMP_A, processoId: PROC_A2 }, cabecalho)).status, 403, 'processo fora da allowlist segue recusado no POST');
});
