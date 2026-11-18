// Modo produção do sistema CRM (sistema.html): Supabase Auth no navegador + catálogo de /api/contextos-operacao.
// Usa o controlador real com um cliente Supabase fictício; nenhuma rota /qa/* pode ser chamada.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.resolve(__dirname, '..', '..', '..');
// eventos: quando é lista, carrega o agenda-ics.js real e guarda cada evento que o Hoje passa ao botão.
function carregar({ eventos = null } = {}) {
  const contexto = { globalThis: {} };
  if (eventos) {
    vm.runInNewContext(fs.readFileSync(path.join(raiz, 'agenda-ics.js'), 'utf8'), contexto);
    const A = contexto.globalThis.AgendaIcs, real = A.montarBotao;
    A.montarBotao = (doc, ev) => { const r = real(doc, ev); eventos.push({ ev, ics: A.gerarIcs(ev), botao: !!r }); return r; };
  }
  vm.runInNewContext(fs.readFileSync(path.join(raiz, 'app-comercial-core.js'), 'utf8'), contexto);
  vm.runInNewContext(fs.readFileSync(path.join(raiz, 'app-comercial-controlador.js'), 'utf8'), contexto);
  return contexto.globalThis.LicitaPlenaComercialControlador;
}

function criarDom() {
  const mapa = new Map();
  const no = (id) => ({ id, hidden: false, disabled: false, value: '', textContent: '', dataset: {}, filhos: [],
    replaceChildren(...n) { this.filhos = n; }, append(...n) { this.filhos.push(...n); }, setAttribute() {}, addEventListener() {}, focus() {}, scrollIntoView() {} });
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

// Topo do Hoje: certidões e prazos chegam do mesmo catálogo e viram texto (textContent), com a situação escrita.
const EMP = 'aaaaaaaa-0000-4000-8000-000000000002';
const textos = (n) => [n.textContent, ...(n.filhos || []).flatMap(textos)].filter(Boolean);
const links = (n) => [...(n.href ? [n.href] : []), ...(n.filhos || []).flatMap(links)];

test('Hoje mostra certidões vencidas/vencendo e próximos prazos, com situação em texto e link para documentos', async () => {
  const dom = criarDom();
  const C = carregar();
  const { cliente } = criarCliente();
  const catalogo = { userId: 'u1', empresas: [{ empresaId: EMP, razaoSocial: 'Empresa A' }], contextos: [{ empresaId: EMP, processoId: 'pa', numero: '1' }],
    certidoes: [{ empresaId: EMP, tipo: '<b>CND</b>', titulo: '', vencimento: '2026-11-10', dias: -8, situacao: 'vencido' }, { empresaId: EMP, tipo: 'FGTS', titulo: 'CRF', vencimento: '2026-12-01', dias: 13, situacao: 'vencendo' }],
    prazos: [{ id: 'bbbbbbbb-0000-4000-8000-000000000010', origem: 'processo', empresaId: EMP, processoId: 'pa', categoria: 'proposta', titulo: 'Prazo de propostas', vencimento: '2026-11-19T13:00:00+00:00', dias: 1 }] };
  const fetch = async (url, op) => (url === '/api/contextos-operacao' && op.headers.Authorization === 'Bearer TOKEN-1' ? resposta(200, catalogo) : resposta(404, {}));
  const ctrl = C.criarControlador({ doc: dom, fetch, storage: null, autenticacao: C.criarAutenticacaoSupabase({ cliente, fetch }), kit: { montar: () => ({ fechar() {} }) }, identificacao: { montar: () => ({ abrir() {}, limpar() {} }) } });
  await ctrl.entrar('operador@example.invalid', 'x');
  const alvo = dom.getElementById('hoje-alertas');
  assert.equal(alvo.hidden, false);
  const t = textos(alvo);
  assert.ok(t.includes('Certidões vencendo') && t.includes('Próximos prazos'));
  assert.ok(t.includes('<b>CND</b>'), 'texto do banco vai como texto, sem virar HTML');
  assert.ok(t.includes('Atrasado') && t.includes('Atenção'));
  assert.ok(t.includes('Empresa A · Vencida há 8 dias (10/11/2026)'));
  assert.ok(t.includes('Empresa A · Vence em 13 dias (01/12/2026)'));
  assert.ok(t.includes('Amanhã') && t.includes('Prazo de propostas'));
  assert.deepEqual(links(alvo), ['operacao.html?aba=documentos&empresa=' + EMP, 'operacao.html?aba=documentos&empresa=' + EMP]);
});

test('Hoje: "Adicionar à agenda" só em prazo que não venceu, com o id real no UID do Google/ics', async () => {
  const dom = criarDom();
  const eventos = [];
  const C = carregar({ eventos });
  const { cliente } = criarCliente();
  const ID = 'bbbbbbbb-0000-4000-8000-000000000011';
  const catalogo = { userId: 'u1', empresas: [{ empresaId: EMP, razaoSocial: 'Empresa A' }], contextos: [{ empresaId: EMP, processoId: 'pa', numero: '1' }], certidoes: [],
    prazos: [
      { id: 'bbbbbbbb-0000-4000-8000-000000000012', origem: 'agenda', empresaId: EMP, processoId: null, categoria: 'outro', titulo: 'Já passou', vencimento: '2000-01-01T13:00:00+00:00', dias: 0 },
      { id: ID, origem: 'processo', empresaId: EMP, processoId: 'pa', categoria: 'proposta', titulo: 'Proposta futura', vencimento: '2099-01-01T13:00:00+00:00', dias: 3 },
    ] };
  const fetch = async (url, op) => (url === '/api/contextos-operacao' && op.headers.Authorization === 'Bearer TOKEN-1' ? resposta(200, catalogo) : resposta(404, {}));
  const ctrl = C.criarControlador({ doc: dom, fetch, storage: null, autenticacao: C.criarAutenticacaoSupabase({ cliente, fetch }), kit: { montar: () => ({ fechar() {} }) }, identificacao: { montar: () => ({ abrir() {}, limpar() {} }) } });
  await ctrl.entrar('operador@example.invalid', 'x');
  const alvo = dom.getElementById('hoje-alertas');
  const t = textos(alvo);
  assert.ok(t.includes('Já passou'), 'o vencido continua na lista');
  assert.equal(t.filter((x) => x === 'Adicionar à agenda').length, 1, 'só o futuro ganha o botão');
  const google = links(alvo).find((h) => h.startsWith('https://calendar.google.com/'));
  assert.ok(google.includes('text=Proposta%20futura'));
  // O id real vira o UID: igual ao do mesmo prazo baixado em processos.html.
  assert.deepEqual(eventos.map((e) => [e.ev.id, e.botao]), [['bbbbbbbb-0000-4000-8000-000000000012', false], [ID, true]]);
  assert.ok(eventos[1].ics.includes('\r\nUID:' + ID + '@licitaplena.com.br\r\n'));
});

test('bloco que o servidor não leu (null) avisa; catálogo sem os blocos (QA) esconde o topo', async () => {
  const C = carregar();
  const dom = criarDom();
  const { cliente } = criarCliente();
  const catalogo = { userId: 'u1', empresas: [{ empresaId: EMP, razaoSocial: 'Empresa A' }], contextos: [], certidoes: null, prazos: [] };
  const fetch = async () => resposta(200, catalogo);
  const ctrl = C.criarControlador({ doc: dom, fetch, storage: null, autenticacao: C.criarAutenticacaoSupabase({ cliente, fetch }), kit: { montar: () => ({ fechar() {} }) }, identificacao: { montar: () => ({ abrir() {}, limpar() {} }) } });
  await ctrl.entrar('operador@example.invalid', 'x');
  const t = textos(dom.getElementById('hoje-alertas'));
  assert.ok(t.includes('Não foi possível carregar agora. Tente de novo em instantes.'));
  assert.ok(t.includes('Nenhum prazo nos próximos 7 dias.'));
  const semBlocos = criarDom();
  const fetch2 = async () => resposta(200, { ...catalogo, certidoes: undefined, prazos: undefined });
  const ctrl2 = C.criarControlador({ doc: semBlocos, fetch: fetch2, storage: null, autenticacao: C.criarAutenticacaoSupabase({ cliente, fetch: fetch2 }), kit: { montar: () => ({ fechar() {} }) }, identificacao: { montar: () => ({ abrir() {}, limpar() {} }) } });
  await ctrl2.entrar('operador@example.invalid', 'x');
  assert.equal(semBlocos.getElementById('hoje-alertas').hidden, true);
});

test('textos de situação: dias inválidos não viram texto; link só com uuid', () => {
  const contexto = { globalThis: {} };
  vm.runInNewContext(fs.readFileSync(path.join(raiz, 'app-comercial-core.js'), 'utf8'), contexto);
  const core = contexto.globalThis.LicitaPlenaComercialCore;
  assert.equal(core.textoVencimentoCertidao(-1, '2026-11-17'), 'Vencida há 1 dia (17/11/2026)');
  assert.equal(core.textoVencimentoCertidao(0, 'x'), 'Vence hoje');
  assert.equal(core.textoVencimentoCertidao('3', '2026-11-21'), '');
  assert.deepEqual([0, 1, 7, -1, 1.5].map(core.textoDiasPrazo), ['Hoje', 'Amanhã', 'Em 7 dias', '', '']);
  assert.equal(core.linkDocumentos(EMP), 'operacao.html?aba=documentos&empresa=' + EMP);
  assert.equal(core.linkDocumentos('../x'), null);
});
