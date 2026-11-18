const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { criarServidor } = require('./servidor.cjs');
const { preparar, QA } = require('./isolamento.cjs');

const raiz = path.resolve(__dirname, '..', '..', '..');

function get(port, rota) {
  return new Promise((resolve, reject) => {
    const r = http.request({ agent: false, host: '127.0.0.1', port, path: rota, method: 'GET', headers: { host: `127.0.0.1:${port}` } }, (res) => {
      let texto = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { texto += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, texto }));
    });
    r.on('error', reject);
    r.end();
  });
}

async function subir(t) {
  const copia = preparar({ authUrl: QA, restUrl: QA, storageUrl: QA, publicKey: 'sb_publishable_qa_ficticia' });
  const s = criarServidor({
    copia,
    serviceKey: 'SERVICE-SECRETA',
    emailsPermitidos: ['operador-a@qa.invalid'],
    contextos: [{ empresaId: '11111111-1111-4111-8111-111111111111', processoId: '22222222-2222-4222-8222-222222222222' }],
    fetchImpl: async () => Response.json({ id: 'qa' }),
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => s.close(r)));
  return s.address().port;
}

function carregarCore() {
  const contexto = { globalThis: {} };
  vm.runInNewContext(fs.readFileSync(path.join(raiz, 'app-comercial-core.js'), 'utf8'), contexto);
  return contexto.globalThis.LicitaPlenaComercialCore;
}

test('rota /app serve a casca comercial sem texto de harness nem script inline', async (t) => {
  const port = await subir(t);
  const r = await get(port, '/app');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/html/);
  for (const id of ['login', 'app-login', 'login-entrar', 'area', 'empresa-ativa', 'sair', 'tentar', 'tema', 'identificacao', 'kit', 'contexto-atual', 'app-aviso']) {
    assert.match(r.texto, new RegExp(`id="${id}"`), `falta #${id}`);
  }
  assert.doesNotMatch(r.texto, /Harness QA|Teste de integração|qa-ia|demo\.js|Dados inventados|Preencher exemplo/);
  assert.doesNotMatch(r.texto, /<script>(?!<\/script>)/);
  assert.match(r.texto, /<input name="password" type="password" required autocomplete="current-password">/);
  for (const src of ['/kit-documentos-ui.js', '/empresa-identificacao-ui.js', '/operacao-identificacao.js', '/app-comercial-core.js', '/app-comercial-controlador.js', '/app-comercial.js']) {
    assert.match(r.texto, new RegExp(`<script src="${src.replace(/[.\/]/g, (c) => '\\' + c)}"></script>`));
  }
  assert.doesNotMatch(r.texto, /https?:\/\/(?!127\.0\.0\.1)/);
  assert.match(r.texto, /Homologação · dados fictícios/);
});

test('arquivos estáticos da casca são servidos com tipo correto e sem recurso externo', async (t) => {
  const port = await subir(t);
  const casos = [
    ['/app-comercial.js', /text\/javascript/],
    ['/app-comercial-core.js', /text\/javascript/],
    ['/app-comercial-controlador.js', /text\/javascript/],
    ['/app-comercial.css', /text\/css/],
    ['/ds-tokens.css', /text\/css/],
  ];
  for (const [rota, tipo] of casos) {
    const r = await get(port, rota);
    assert.equal(r.status, 200, rota);
    assert.match(r.headers['content-type'], tipo, rota);
    assert.doesNotMatch(r.texto, /@import|https?:\/\//, rota);
  }
  assert.match(fs.readFileSync(path.join(raiz, 'app-comercial.css'), 'utf8'), /@media \(max-width:640px\)/);
});

test('autorizarContextos só mantém contexto que o handler confirma com ids coincidentes', async () => {
  const core = carregarCore();
  const A = { empresaId: 'a', processoId: 'pa' };
  const B = { empresaId: 'b', processoId: 'pb' };
  const C = { empresaId: 'c', processoId: 'pc' };
  const autorizados = await core.autorizarContextos([A, B, C, A], async (c) => {
    if (c.empresaId === 'a') return { ok: true, empresa: { id: 'a', razaoSocial: 'Empresa A' }, processo: { id: 'pa', numero: 'QA-A-51' } };
    if (c.empresaId === 'b') return { ok: false };
    if (c.empresaId === 'c') throw new Error('falha de rede');
    return { ok: true };
  });
  assert.deepEqual(JSON.parse(JSON.stringify(autorizados)), [{ empresaId: 'a', processoId: 'pa', empresaRotulo: 'Empresa A', processoRotulo: 'Processo QA-A-51', rotulo: 'Empresa A · Processo QA-A-51' }]);
});

test('resposta com ids divergentes não autoriza o contexto', async () => {
  const core = carregarCore();
  const autorizados = await core.autorizarContextos([{ empresaId: 'a', processoId: 'pa' }], async () => ({
    ok: true, empresa: { id: 'outra', razaoSocial: 'X' }, processo: { id: 'pa', numero: '1' },
  }));
  assert.equal(autorizados.length, 0);
});

test('contextosDoCatalogo monta o Hoje só com empresas do catálogo, sem repetir par e com exibição em texto', () => {
  const core = carregarCore();
  const empresas = [{ empresaId: 'a', razaoSocial: ' Empresa A ' }, { empresaId: 'b', razaoSocial: 7 }];
  const lista = core.contextosDoCatalogo([
    { empresaId: 'a', processoId: 'pa', numero: '10/2026', objeto: 'Papel', status: 'triagem', prazo: '2026-12-01T13:00:00+00:00' },
    { empresaId: 'a', processoId: 'pa' },
    { empresaId: 'b', processoId: 'pb', numero: 5, objeto: { x: 1 } },
    { empresaId: 'fora', processoId: 'px', numero: '1' },
    { empresaId: 'a', processoId: '' },
    null,
  ], empresas);
  assert.deepEqual(JSON.parse(JSON.stringify(lista)), [
    { empresaId: 'a', processoId: 'pa', empresaRotulo: 'Empresa A', processoRotulo: 'Processo 10/2026', rotulo: 'Empresa A · Processo 10/2026', objeto: 'Papel', status: 'triagem', prazo: '2026-12-01T13:00:00+00:00' },
    { empresaId: 'b', processoId: 'pb', empresaRotulo: 'Empresa', processoRotulo: 'Processo sem número', rotulo: 'Empresa · Processo sem número', objeto: '', status: '', prazo: '' },
  ]);
  assert.equal(core.contextosDoCatalogo(null, null).length, 0);
});

test('preferência nunca concede acesso: não autorizada cai no primeiro autorizado', () => {
  const core = carregarCore();
  const autorizados = [{ empresaId: 'a', processoId: 'pa', rotulo: 'A' }];
  assert.equal(core.escolherContexto(autorizados, { empresaId: 'b', processoId: 'pb' }).empresaId, 'a');
  assert.equal(core.escolherContexto(autorizados, null).empresaId, 'a');
  assert.equal(core.escolherContexto([], { empresaId: 'a', processoId: 'pa' }), null);
});

test('preferência salva e lida com validação; storage quebrado não lança', () => {
  const core = carregarCore();
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  core.gravarPreferencia({ empresaId: 'a', processoId: 'pa', rotulo: 'A' }, storage);
  assert.equal(mem.get(core.CHAVE_EMPRESA), 'a');
  assert.equal(core.lerPreferencia(storage), 'a');
  mem.delete(core.CHAVE_EMPRESA);
  mem.set(core.CHAVE_PREFERENCIA_ANTIGA, '{nao-json');
  assert.equal(core.lerPreferencia(storage), null);
  const quebrado = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } };
  assert.equal(core.lerPreferencia(quebrado), null);
  assert.doesNotThrow(() => core.gravarPreferencia({ empresaId: 'a', processoId: 'pa' }, quebrado));
});

test('mensagens da casca são genéricas e não expõem detalhe técnico', () => {
  const core = carregarCore();
  for (const m of [core.MSG_LOGIN, core.MSG_SEM_CONTEXTO, core.MSG_SESSAO_ENCERRADA]) {
    assert.doesNotMatch(m, /erro|stack|token|service|chave|QA/i);
  }
});

test('app-comercial.js e o controlador compilam como script clássico', () => {
  for (const f of ['app-comercial.js', 'app-comercial-controlador.js']) {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(raiz, f), 'utf8')), f);
  }
});

test('variáveis usadas pelos módulos reais resolvem para tokens do DS (tema claro e escuro)', () => {
  const css = fs.readFileSync(path.join(raiz, 'app-comercial.css'), 'utf8');
  const tokens = fs.readFileSync(path.join(raiz, 'ds-tokens.css'), 'utf8');
  const modulos = fs.readFileSync(path.join(raiz, 'kit-documentos.css'), 'utf8') + fs.readFileSync(path.join(raiz, 'operacao-identificacao.css'), 'utf8');
  const usados = new Set([...modulos.matchAll(/var\(--([a-z-]+)/g)].map((m) => m[1]));
  const definidos = new Set([...(css + tokens).matchAll(/--([a-z-]+)\s*:/g)].map((m) => m[1]));
  const faltando = [...usados].filter((n) => !definidos.has(n));
  assert.deepEqual(faltando, []);
  assert.match(tokens, /\[data-theme="dark"\]/);
  assert.match(css, /:root\{--azul:var\(--action-strong\)/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,6}\b/, 'casca não deve usar cor fixa');
});

test('hash dos tokens confere com a origem do Design System', () => {
  const crypto = require('node:crypto');
  const h = crypto.createHash('sha256').update(fs.readFileSync(path.join(raiz, 'ds-tokens.css'))).digest('hex');
  assert.equal(h, '0d83dd5138d78e07314edb38f03c1dfb83d08b1bd62599259a40258195a92e6f');
});

test('estilos da identificação: escopados em #identificacao e sem cor fixa (layout real em app-comercial-layout.test.cjs)', () => {
  const css = fs.readFileSync(path.join(raiz, 'app-comercial.css'), 'utf8');
  const secao = css.split('/* Identificação da empresa')[1];
  assert.ok(secao, 'seção de identificação ausente');
  for (const regra of secao.match(/[^{}]+\{[^}]*\}/g) || []) {
    const seletor = regra.split('{')[0].trim();
    if (seletor.startsWith('@') || seletor.startsWith('}')) continue;
    assert.ok(/#identificacao/.test(seletor) || /^@media/.test(seletor), 'seletor fora do escopo: ' + seletor);
  }
  assert.doesNotMatch(secao, /#[0-9a-fA-F]{3,6}\b/);
  const checkbox = secao.match(/#identificacao input\[type="checkbox"\]\{[^}]*\}/);
  assert.ok(checkbox, 'regra de checkbox ausente');
  assert.match(checkbox[0], /width:20px/);
  assert.doesNotMatch(checkbox[0], /width:100%/);
  assert.match(secao, /:focus-visible\{outline:2px solid var\(--focus-ring\)/);
});

test('lerLinkDireto só devolve o par quando empresa e processo são uuid', () => {
  const contexto = { globalThis: { URLSearchParams } };
  vm.runInNewContext(fs.readFileSync(path.join(raiz, 'app-comercial-core.js'), 'utf8'), contexto);
  const core = contexto.globalThis.LicitaPlenaComercialCore;
  const E = '11111111-1111-4111-8111-111111111111';
  const P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  assert.deepEqual(JSON.parse(JSON.stringify(core.lerLinkDireto('?empresa=' + E + '&processo=' + P))), { empresaId: E, processoId: P });
  assert.deepEqual(JSON.parse(JSON.stringify(core.lerLinkDireto('?processo=' + P.toUpperCase() + '&empresa=' + E.toUpperCase()))), { empresaId: E, processoId: P });
  for (const busca of ['', '?', '?empresa=' + E, '?processo=' + P, '?empresa=x&processo=' + P, '?empresa=' + E + '&processo=' + P + 'z',
    '?empresa=' + E + '%27--&processo=' + P, null, undefined, 42]) {
    assert.equal(core.lerLinkDireto(busca), null, String(busca));
  }
});

test('lerTema: claro por padrão, chave nova vence e a chave antiga migra uma vez', () => {
  const core = carregarCore();
  const novo = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
  let s = novo();
  assert.equal(core.lerTema(s), 'claro');
  assert.equal(s.m.size, 0, 'sem preferência, nada é gravado');
  s = novo(); s.setItem('licitaplena.tema', 'dark');
  assert.equal(core.lerTema(s), 'escuro');
  assert.equal(s.getItem('licitaplena_tema'), 'escuro');
  assert.equal(s.getItem('licitaplena.tema'), null, 'chave antiga apagada depois de migrar');
  s = novo(); s.setItem('licitaplena.tema', 'light');
  assert.equal(core.lerTema(s), 'claro');
  assert.equal(s.getItem('licitaplena_tema'), 'claro');
  s = novo(); s.setItem('licitaplena_tema', 'escuro'); s.setItem('licitaplena.tema', 'light');
  assert.equal(core.lerTema(s), 'escuro', 'chave nova vence a antiga');
  s = novo(); s.setItem('licitaplena_tema', 'roxo');
  assert.equal(core.lerTema(s), 'claro');
  assert.equal(core.lerTema({ getItem() { throw new Error('bloqueado'); } }), 'claro');
});

test('lerPreferencia migra a chave antiga de contexto para a chave de empresa do painel', () => {
  const core = carregarCore();
  const m = new Map();
  const s = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  m.set('licitaplena.contextoPreferido', JSON.stringify({ empresaId: 'e1', processoId: 'p1' }));
  assert.equal(core.lerPreferencia(s), 'e1');
  assert.equal(m.get('licitaplena_empresa_operacional_id'), 'e1');
  assert.equal(m.has('licitaplena.contextoPreferido'), false);
  m.set('licitaplena_empresa_operacional_id', 'e2');
  m.set('licitaplena.contextoPreferido', JSON.stringify({ empresaId: 'e1', processoId: 'p1' }));
  assert.equal(core.lerPreferencia(s), 'e2', 'chave nova vence; a antiga não é mais lida');
  assert.equal(core.CHAVE_EMPRESA, 'licitaplena_empresa_operacional_id');
});
