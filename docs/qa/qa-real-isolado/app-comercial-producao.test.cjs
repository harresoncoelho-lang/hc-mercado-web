// Modo produção do sistema CRM (sistema.html): Supabase Auth no navegador + catálogo de /api/contextos-operacao.
// Usa o controlador real com um cliente Supabase fictício; nenhuma rota /qa/* pode ser chamada.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.resolve(__dirname, '..', '..', '..');
function carregar() {
  const contexto = { globalThis: {} };
  vm.runInNewContext(fs.readFileSync(path.join(raiz, 'app-comercial-core.js'), 'utf8'), contexto);
  vm.runInNewContext(fs.readFileSync(path.join(raiz, 'app-comercial-controlador.js'), 'utf8'), contexto);
  return contexto.globalThis.LicitaPlenaComercialControlador;
}

function criarDom() {
  const mapa = new Map();
  const no = (id) => ({ id, hidden: false, disabled: false, value: '', textContent: '', dataset: {}, filhos: [],
    replaceChildren(...n) { this.filhos = n; }, append(...n) { this.filhos.push(...n); }, setAttribute() {}, focus() {}, scrollIntoView() {} });
  return { getElementById: (id) => { if (!mapa.has(id)) mapa.set(id, no(id)); return mapa.get(id); }, createElement: () => no('') };
}

const resposta = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });

// Cliente Supabase fictício: sessão local trocável e status do cadastro configurável.
function criarCliente({ status = 'aprovado', loginOk = true } = {}) {
  const estado = { sessao: null, saidas: 0, status };
  const cliente = {
    auth: {
      async signInWithPassword({ email }) {
        if (!loginOk) return { data: null, error: { message: 'Invalid login credentials' } };
        estado.sessao = { access_token: 'TOKEN-1', user: { id: 'u1', email } };
        return { data: { user: estado.sessao.user, session: estado.sessao }, error: null };
      },
      async getSession() { return { data: { session: estado.sessao }, error: null }; },
      async signOut() { estado.sessao = null; estado.saidas += 1; return { error: null }; },
    },
    from(tabela) {
      assert.equal(tabela, 'clientes');
      return { select: () => ({ eq: (col, id) => ({ single: async () => ({ data: id === 'u1' ? { status: estado.status } : null, error: null }) }) }) };
    },
  };
  return { cliente, estado };
}

function criar(opcoes = {}) {
  const C = carregar();
  const { cliente, estado } = criarCliente(opcoes);
  const chamadas = [];
  const catalogo = opcoes.catalogo || { userId: 'u1', empresas: [{ empresaId: 'a1', razaoSocial: 'Empresa A' }], contextos: [{ empresaId: 'a1', processoId: 'pa', numero: '1' }] };
  const fetch = async (url, op = {}) => {
    if (url.startsWith('/qa/')) throw new Error('rota QA chamada em produção: ' + url);
    chamadas.push({ url, auth: op.headers?.Authorization || null, corpo: op.body ? JSON.parse(op.body) : null });
    if (url === '/api/contextos-operacao') {
      if (op.headers?.Authorization !== 'Bearer ' + estado.sessao?.access_token) return resposta(401, {});
      return estado.status === 'aprovado' ? resposta(200, catalogo) : resposta(403, {});
    }
    if (url === '/api/kit-documentos') {
      const c = JSON.parse(op.body);
      if (c.acao === 'consultar') return resposta(200, { empresa: { id: c.empresaId, razaoSocial: 'Empresa A' }, processo: { id: c.processoId, numero: '1' } });
      return resposta(200, {});
    }
    if (url === '/api/criar-processo') {
      const c = JSON.parse(op.body);
      return resposta(201, { processo: { id: c.tentativaId, empresa_id: c.empresaId, numero: null, objeto: c.objeto } });
    }
    throw new Error('rota não prevista: ' + url);
  };
  let requisitarItens = null;
  const autenticacao = C.criarAutenticacaoSupabase({ cliente, fetch });
  const logins = [];
  const ctrl = C.criarControlador({ doc: criarDom(), fetch, storage: null, autenticacao, pedirLogin: opcoes.redirecionar ? (m) => logins.push(m) : null,
    kit: { montar: () => ({ fechar() {} }) },
    identificacao: { montar: () => ({ abrir() {}, limpar() {} }) },
    itens: { montar: (o) => { requisitarItens = o.requisitar; return { fechar() {} }; } },
  });
  return { ctrl, estado, chamadas, autenticacao, logins, MSG: C.MSG, itens: () => requisitarItens };
}

test('login aprovado: catálogo e consulta do kit levam o Bearer real do Supabase, nada de /qa/*', async () => {
  const t = criar();
  await t.ctrl.entrar('operador@example.invalid', 'x');
  assert.equal(t.ctrl.estado().tela, 'area');
  assert.deepEqual([...t.ctrl.estado().autorizados], ['Empresa A · Processo 1']);
  assert.deepEqual(t.chamadas.map((c) => c.url), ['/api/contextos-operacao'], 'o Hoje sai do catálogo, sem consultar por processo');
  await t.ctrl.abrirProcesso('a1', 'pa');
  assert.equal(t.chamadas.at(-1).corpo.acao, 'consultar');
  for (const c of t.chamadas) assert.equal(c.auth, 'Bearer TOKEN-1', c.url);
});

test('cadastro não aprovado: login é recusado com aviso e a sessão Supabase é encerrada', async () => {
  const t = criar({ status: 'pendente' });
  await t.ctrl.entrar('novo@example.invalid', 'x');
  assert.equal(t.ctrl.estado().tela, 'login');
  assert.equal(t.estado.sessao, null);
  assert.equal(t.estado.saidas, 1);
  assert.equal(t.chamadas.length, 0, 'nenhum catálogo é pedido');
});

test('sessão antiga de conta não aprovada (403 no catálogo) volta ao login e desloga', async () => {
  const t = criar({ status: 'pendente' });
  t.estado.sessao = { access_token: 'TOKEN-1', user: { id: 'u1' } };
  await t.ctrl.iniciar();
  assert.equal(t.ctrl.estado().tela, 'login');
  assert.equal(t.estado.sessao, null);
});

test('senha errada fica no login; sem sessão local não pede catálogo', async () => {
  const t = criar({ loginOk: false });
  await t.ctrl.entrar('x@example.invalid', 'errada');
  assert.equal(t.ctrl.estado().tela, 'login');
  await t.ctrl.iniciar();
  assert.equal(t.ctrl.estado().tela, 'login');
  assert.equal(t.chamadas.length, 0);
});

test('token renovado: itens e criar-processo usam o token atual, não o do início', async () => {
  const t = criar();
  await t.ctrl.entrar('operador@example.invalid', 'x');
  await t.ctrl.abrirProcesso('a1', 'pa');
  t.estado.sessao = { ...t.estado.sessao, access_token: 'TOKEN-2' };
  await t.itens()('/api/kit-documentos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"acao":"x"}' });
  assert.equal(t.chamadas.at(-1).auth, 'Bearer TOKEN-2');
  t.ctrl.voltarHoje();
  t.ctrl.abrirNovoProcesso('a1');
  await t.ctrl.criarProcesso({ objeto: 'Objeto de teste' });
  const criar_ = t.chamadas.find((c) => c.url === '/api/criar-processo');
  assert.equal(criar_.auth, 'Bearer TOKEN-2');
});

test('catálogo de outro usuário é recusado; cliente ausente falha fechado', async () => {
  const t = criar({ catalogo: { userId: 'outro', empresas: [{ empresaId: 'z', razaoSocial: 'Z' }], contextos: [] } });
  await t.ctrl.entrar('operador@example.invalid', 'x');
  assert.equal(t.ctrl.estado().tela, 'erro-sessao');
  const C = carregar();
  const sem = C.criarAutenticacaoSupabase({ cliente: null, fetch: async () => { throw new Error('não deve chamar'); } });
  assert.equal((await sem.sessao({ comCatalogo: true })).estado, 'erro');
  assert.equal((await sem.entrar('a', 'b')).ok, false);
});

test('sair encerra a sessão Supabase', async () => {
  const t = criar();
  await t.ctrl.entrar('operador@example.invalid', 'x');
  await t.ctrl.sair();
  assert.equal(t.ctrl.estado().tela, 'login');
  assert.equal(t.estado.sessao, null);
});

test('com pedirLogin (produção), cair no login redireciona com o motivo; tela de sistema não pede login', async () => {
  const semSessao = criar({ redirecionar: true });
  await semSessao.ctrl.iniciar();
  assert.deepEqual(semSessao.logins, ['']);
  const pendente = criar({ status: 'pendente', redirecionar: true });
  pendente.estado.sessao = { access_token: 'TOKEN-1', user: { id: 'u1' } };
  await pendente.ctrl.iniciar();
  assert.deepEqual(pendente.logins, [pendente.MSG.naoAprovado]);
  const aprovado = criar({ redirecionar: true });
  aprovado.estado.sessao = { access_token: 'TOKEN-1', user: { id: 'u1' } };
  await aprovado.ctrl.iniciar();
  assert.equal(aprovado.ctrl.estado().tela, 'area');
  assert.deepEqual(aprovado.logins, []);
  await aprovado.ctrl.sair();
  assert.deepEqual(aprovado.logins, ['Sessão encerrada.']);
});
