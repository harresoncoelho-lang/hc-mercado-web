const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.resolve(__dirname, '..', '..', '..');

// Carrega o controlador real (e o core) num contexto isolado, como o navegador faria.
function carregarControlador() {
  // URLSearchParams: o core lê o link direto (?empresa=&processo=) com a API do navegador.
  const contexto = { globalThis: { URLSearchParams } };
  vm.runInNewContext(fs.readFileSync(path.join(raiz, 'app-comercial-core.js'), 'utf8'), contexto);
  vm.runInNewContext(fs.readFileSync(path.join(raiz, 'app-comercial-controlador.js'), 'utf8'), contexto);
  return contexto.globalThis.LicitaPlenaComercialControlador;
}

const IDS = ['login', 'area', 'empresa-bloco', 'sair', 'tentar', 'login-entrar', 'app-aviso', 'kit', 'identificacao', 'contexto-atual', 'empresa-ativa', 'processo-bloco', 'processo-ativo', 'app-login', 'hoje', 'hoje-titulo', 'hoje-estado', 'hoje-lista', 'voltar-hoje', 'area-titulo', 'novo-processo-bloco', 'novo-processo-titulo', 'novo-processo-empresa', 'novo-processo-erro', 'novo-processo-salvar', 'novo-processo-cancelar', 'form-novo-processo', 'itens-processo'];

function criarDom() {
  const mapa = new Map();
  for (const id of IDS) {
    mapa.set(id, { id, hidden: false, disabled: false, value: '', textContent: '', dataset: {}, filhos: [], focused: false,
      replaceChildren(...n) { this.filhos = n; }, focus() { this.focused = true; }, scrollIntoView() {} });
  }
  return {
    getElementById: (id) => mapa.get(id),
    // Elemento mínimo: suficiente para as opções de seletor e para o Hoje (article, h2, li, p, button).
    createElement: () => {
      const e = { value: '', textContent: '', className: '', type: '', dataset: {}, filhos: [], attrs: {},
        append(...n) { this.filhos.push(...n); }, replaceChildren(...n) { this.filhos = n; }, setAttribute(k, v) { this.attrs[k] = v; } };
      return e;
    },
    mapa,
  };
}

function resposta(status, corpo) {
  return { ok: status >= 200 && status < 300, status, json: async () => corpo };
}

function adiar() {
  let resolve; let reject;
  const p = new Promise((a, b) => { resolve = a; reject = b; });
  return { p, resolve, reject };
}

function memoria() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}

// Servidor QA simulado: estado de sessão, respostas configuráveis por rota.
function criarServidor(opcoes = {}) {
  const estado = { logado: false, empresas: opcoes.empresas || [], contextos: opcoes.contextos || [
    { empresaId: 'a1', processoId: 'pa' }, { empresaId: 'b1', processoId: 'pb' },
  ], autorizados: opcoes.autorizados || ['a1'], paginadas: opcoes.paginadas || [] };
  const chamadas = [];
  const corpos = [];
  // Catálogo como o handler real (contextos-operacao): só pares que o vínculo autoriza, com rótulos de exibição.
  // divergente:true simula catálogo que lista par que o consultar recusa (o Hoje lista; abrir é barrado).
  const catalogo = () => {
    const contextos = estado.contextos.filter((c) => opcoes.divergente || estado.autorizados.includes(c.empresaId))
      .map((c) => ({ numero: 'QA-' + c.processoId, ...c }));
    const empresas = estado.empresas.length ? estado.empresas
      : [...new Set(contextos.map((c) => c.empresaId))].map((id) => ({ empresaId: id, razaoSocial: 'Empresa ' + id.toUpperCase() }));
    return { contextos, empresas };
  };
  const roteador = {
    login: null, logout: null, sessao: null, kit: null, criar: null,
  };
  const fetch = async (url, op = {}) => {
    const metodo = (op.method || 'GET').toUpperCase();
    chamadas.push(`${metodo} ${url}`);
    if (url === '/qa/login') {
      if (roteador.login) return roteador.login(op);
      estado.logado = true;
      return resposta(200, { ok: true });
    }
    if (url === '/qa/logout') {
      if (roteador.logout) return roteador.logout(op);
      estado.logado = false;
      return resposta(200, { ok: true });
    }
    if (url === '/qa/session') {
      if (roteador.sessao) return roteador.sessao(op);
      if (!estado.logado) return resposta(401, {});
      return resposta(200, { userId: 'u1', accessToken: 'qa-cookie-session', ...catalogo() });
    }
    if (url === '/api/criar-processo') {
      const corpo = JSON.parse(op.body);
      corpos.push({ rota: 'criar-processo', ...corpo });
      if (roteador.criar) { const r = await roteador.criar(corpo); if (r) return r; }
      if (!estado.autorizados.includes(corpo.empresaId)) return resposta(403, {});
      return resposta(201, { processo: { id: corpo.tentativaId, empresa_id: corpo.empresaId, numero: corpo.numero ?? null, objeto: corpo.objeto } });
    }
    if (url === '/api/kit-documentos') {
      const corpo = JSON.parse(op.body);
      corpos.push(corpo);
      if (roteador.kit) { const r = await roteador.kit(corpo); if (r) return r; }
      if (!estado.autorizados.includes(corpo.empresaId)) return resposta(403, {});
      // Mesma guarda do handler real (netlify/functions/kit-documentos.js, linha 82): paginado sem itensPaginados:true → 409.
      if (estado.paginadas.includes(corpo.empresaId) && corpo.itensPaginados !== true) return resposta(409, { erro: 'Atualize a interface para selecionar todos os itens por página.' });
      return resposta(200, { empresa: { id: corpo.empresaId, razaoSocial: 'Empresa ' + corpo.empresaId.toUpperCase() }, processo: { id: corpo.processoId, numero: 'QA-' + corpo.processoId } });
    }
    throw new Error('rota não prevista: ' + url);
  };
  return { fetch, estado, roteador, chamadas, corpos };
}

function criarModulos() {
  const log = [];
  const sujo = { kit: false, ident: false, itens: false };
  const kit = {
    montar(o) {
      log.push({ tipo: 'kit.montar', contexto: o.contexto, hook: typeof o.aoConferirIdentificacao === 'function', fn: o.aoConferirIdentificacao, obter: o.obterSessao });
      return { fechar() { log.push({ tipo: 'kit.fechar' }); }, temAlteracoesNaoSalvas: () => sujo.kit,
        atualizarItens() { log.push({ tipo: 'kit.atualizarItens', contexto: o.contexto }); } };
    },
  };
  const identificacao = {
    montar() {
      return {
        abrir(empresaId, usuarioId) { log.push({ tipo: 'ident.abrir', empresaId, usuarioId }); },
        limpar(m) { log.push({ tipo: 'ident.limpar', m }); },
        temAlteracoesNaoSalvas: () => sujo.ident,
      };
    },
  };
  // Itens do processo: módulo falso com o mesmo contrato (montar/fechar/temAlteracoesNaoSalvas).
  const itens = {
    montar(o) {
      log.push({ tipo: 'itens.montar', contexto: o.contexto, aoSalvar: o.aoSalvar });
      return { fechar() { log.push({ tipo: 'itens.fechar' }); }, temAlteracoesNaoSalvas: () => sujo.itens };
    },
  };
  return { kit, identificacao, itens, log, sujo };
}

function criar(opcoes = {}) {
  const C = carregarControlador();
  const dom = criarDom();
  const srv = criarServidor(opcoes);
  const mod = criarModulos();
  const storage = opcoes.storage || memoria();
  const ctrl = C.criarControlador({ doc: dom, fetch: srv.fetch, storage, kit: mod.kit, identificacao: mod.identificacao, itens: mod.itens, confirmar: opcoes.confirmar || null, busca: opcoes.busca || '' });
  return { C, dom, srv, mod, storage, ctrl, el: (id) => dom.getElementById(id) };
}

// Login leva ao Hoje (sem módulo montado). Para testar o processo, abre-se o primeiro par autorizado pelo próprio Hoje.
async function entrarEAbrir(t) {
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  const par = t.srv.estado.contextos.find((c) => t.srv.estado.autorizados.includes(c.empresaId));
  if (par && t.ctrl.estado().tela === 'area') await t.ctrl.abrirProcesso(par.empresaId, par.processoId);
}

const montagens = (mod) => mod.log.filter((e) => e.tipo === 'kit.montar').length;
const fechamentos = (mod) => mod.log.filter((e) => e.tipo === 'kit.fechar').length;

test('login ok monta só o contexto autorizado, desabilita o botão enquanto pendente e reabilita depois', async () => {
  const t = criar({ autorizados: ['a1'] });
  const login = adiar();
  t.srv.roteador.login = () => { t.srv.estado.logado = true; return login.p; };
  const pendente = t.ctrl.entrar('operador-a@qa.invalid', 'segredo-de-teste');
  assert.equal(t.el('login-entrar').disabled, true);
  assert.equal(t.ctrl.estado().ocupado, true);
  login.resolve(resposta(200, { ok: true }));
  await pendente;
  assert.equal(t.el('login-entrar').disabled, false);
  assert.equal(t.el('login').hidden, true);
  assert.equal(t.el('sair').hidden, false);
  // Login leva ao Hoje; nenhum módulo é montado sem ação explícita do usuário.
  assert.equal(t.el('hoje').hidden, false);
  assert.equal(t.el('area').hidden, true);
  assert.equal(montagens(t.mod), 0);
  await t.ctrl.abrirProcesso('a1', 'pa');
  assert.equal(t.el('area').hidden, false);
  assert.equal(montagens(t.mod), 1);
  const montado = t.mod.log.find((e) => e.tipo === 'kit.montar').contexto;
  assert.deepEqual(JSON.parse(JSON.stringify(montado)), { empresaId: 'a1', processoId: 'pa' });
  assert.equal(t.mod.log.some((e) => e.tipo === 'ident.abrir' && e.empresaId === 'a1'), true);
  assert.equal(t.mod.log.some((e) => e.empresaId === 'b1' || e.contexto?.empresaId === 'b1'), false);
});

test('logout com resposta OK limpa áreas e anuncia encerramento', async () => {
  const t = criar({ autorizados: ['a1'] });
  await entrarEAbrir(t);
  await t.ctrl.sair();
  assert.equal(t.ctrl.estado().tela, 'login');
  assert.equal(t.el('app-aviso').textContent, 'Sessão encerrada.');
  assert.equal(t.el('app-aviso').dataset.estado, 'ok');
  assert.equal(fechamentos(t.mod) >= 1, true);
  assert.equal(t.el('sair').hidden, true);
});

test('logout com falha de rede não anuncia encerramento, limpa áreas e oferece nova tentativa', async () => {
  const t = criar({ autorizados: ['a1'] });
  await entrarEAbrir(t);
  const montadasAntes = montagens(t.mod);
  t.srv.roteador.logout = async () => { throw new Error('rede caiu'); };
  await t.ctrl.sair();
  assert.doesNotMatch(t.el('app-aviso').textContent, /encerrada/);
  assert.equal(t.el('app-aviso').dataset.estado, 'erro');
  assert.equal(t.ctrl.estado().tela, 'erro-sair');
  assert.equal(t.el('sair').hidden, false);
  assert.equal(t.el('sair').disabled, false);
  assert.equal(t.el('area').hidden, true);
  assert.ok(fechamentos(t.mod) >= 1);
  assert.equal(montagens(t.mod), montadasAntes, 'não deve remontar dados');
});

test('logout com HTTP 500 é tratado como falha', async () => {
  const t = criar({ autorizados: ['a1'] });
  await entrarEAbrir(t);
  t.srv.roteador.logout = async () => resposta(500, {});
  await t.ctrl.sair();
  assert.doesNotMatch(t.el('app-aviso').textContent, /encerrada/);
  assert.equal(t.ctrl.estado().tela, 'erro-sair');
});

test('login atrasado não remonta após logout feito antes da resposta', async () => {
  const t = criar({ autorizados: ['a1'] });
  const login = adiar();
  t.srv.roteador.login = () => login.p;
  const pendente = t.ctrl.entrar('operador-a@qa.invalid', 'x');
  await t.ctrl.sair();
  login.resolve(resposta(200, { ok: true }));
  await pendente;
  assert.equal(montagens(t.mod), 0);
  assert.equal(t.ctrl.estado().tela, 'login');
  assert.equal(t.el('area').hidden, true);
});

test('verificação de sessão atrasada não monta depois de logout', async () => {
  const t = criar({ autorizados: ['a1'] });
  await entrarEAbrir(t);
  const montadasAntes = montagens(t.mod);
  const sessao = adiar();
  t.srv.roteador.sessao = () => sessao.p;
  const iniciando = t.ctrl.iniciar();
  await t.ctrl.sair();
  sessao.resolve(resposta(200, { userId: 'u1', accessToken: 'x', contextos: [{ empresaId: 'a1', processoId: 'pa' }] }));
  await iniciando;
  assert.equal(montagens(t.mod), montadasAntes);
  assert.equal(t.ctrl.estado().tela, 'login');
});

test('401 depois de sessão ativa mostra expiração, limpa áreas e não entra em laço', async () => {
  const t = criar({ autorizados: ['a1'] });
  await entrarEAbrir(t);
  let consultas = 0;
  t.srv.roteador.sessao = async () => { consultas += 1; return resposta(401, {}); };
  await t.ctrl.iniciar();
  assert.equal(consultas, 1);
  assert.equal(t.ctrl.estado().tela, 'login');
  assert.equal(t.el('app-aviso').textContent, 'Sua sessão expirou. Entre novamente.');
  assert.equal(t.el('app-aviso').dataset.estado, 'erro');
  assert.ok(fechamentos(t.mod) >= 1);
});

test('401 na primeira verificação mostra login sem aviso de expiração', async () => {
  const t = criar({ autorizados: ['a1'] });
  await t.ctrl.iniciar();
  assert.equal(t.ctrl.estado().tela, 'login');
  assert.equal(t.el('app-aviso').textContent, '');
});

test('erro ao verificar sessão mostra Tentar de novo, sem dados antigos, e a nova tentativa funciona', async () => {
  const t = criar({ autorizados: ['a1'] });
  t.srv.estado.logado = true;
  t.srv.roteador.sessao = async () => { throw new Error('rede'); };
  await t.ctrl.iniciar();
  assert.equal(t.ctrl.estado().tela, 'erro-sessao');
  assert.equal(t.el('tentar').hidden, false);
  assert.equal(t.el('area').hidden, true);
  assert.equal(montagens(t.mod), 0);
  assert.equal(t.el('app-aviso').dataset.estado, 'erro');
  t.srv.roteador.sessao = null;
  await t.ctrl.tentarNovamente();
  assert.equal(t.ctrl.estado().tela, 'area');
  assert.equal(montagens(t.mod), 0, 'retorno ao Hoje não monta módulo sozinho');
  await t.ctrl.abrirProcesso('a1', 'pa');
  assert.equal(montagens(t.mod), 1);
});

test('sem empresa autorizada mostra estado vazio, distinto de erro, e não monta módulos', async () => {
  const t = criar({ autorizados: [] });
  await entrarEAbrir(t);
  assert.equal(t.ctrl.estado().tela, 'sem-contexto');
  assert.equal(t.el('app-aviso').dataset.estado, 'vazio');
  assert.equal(t.el('app-aviso').textContent, 'Nenhuma empresa autorizada para esta conta.');
  assert.equal(montagens(t.mod), 0);
});

test('preferência salva de empresa não autorizada cai na primeira autorizada', async () => {
  const storage = memoria();
  storage.setItem('licitaplena.contextoPreferido', JSON.stringify({ empresaId: 'b1', processoId: 'pb' }));
  const t = criar({ autorizados: ['a1'], storage });
  await entrarEAbrir(t);
  const montado = t.mod.log.find((e) => e.tipo === 'kit.montar').contexto;
  assert.equal(montado.empresaId, 'a1');
});

test('trocar empresa fecha o módulo anterior e monta o novo contexto', async () => {
  const t = criar({ autorizados: ['a1', 'b1'] });
  await entrarEAbrir(t);
  await t.ctrl.selecionarIndice(1);
  const montados = t.mod.log.filter((e) => e.tipo === 'kit.montar');
  assert.equal(montados.at(-1).contexto.empresaId, 'b1');
  assert.ok(fechamentos(t.mod) >= 1);
});

test('hook de conferência é passado ao kit e foca a identificação dentro da casca', async () => {
  const t = criar({ autorizados: ['a1'] });
  await entrarEAbrir(t);
  const montagem = t.mod.log.find((e) => e.tipo === 'kit.montar');
  assert.equal(montagem.hook, true);
  const alvo = t.el('identificacao');
  assert.equal(alvo.focused, false);
  montagem.fn({ empresaId: 'a1', processoId: 'pa' });
  assert.equal(alvo.focused, true);
});

test('erro de login mantém a tela de login, reabilita o botão e não expõe detalhe', async () => {
  const t = criar({ autorizados: ['a1'] });
  t.srv.roteador.login = async () => resposta(401, { erro: 'senha errada técnico' });
  await entrarEAbrir(t);
  assert.equal(t.ctrl.estado().tela, 'login');
  assert.equal(t.el('login-entrar').disabled, false);
  assert.equal(t.el('app-aviso').textContent, 'Não foi possível entrar. Confira os dados e tente de novo.');
  assert.equal(t.el('app-aviso').dataset.estado, 'erro');
});

test('segundo login enquanto um está pendente é ignorado', async () => {
  const t = criar({ autorizados: ['a1'] });
  const login = adiar();
  let chamadas = 0;
  t.srv.roteador.login = () => { chamadas += 1; return login.p; };
  const primeiro = t.ctrl.entrar('operador-a@qa.invalid', 'x');
  await entrarEAbrir(t);
  login.resolve(resposta(200, { ok: true }));
  await primeiro;
  assert.equal(chamadas, 1);
});

// Callback obterSessao efetivamente entregue ao kit.montar (é o que os módulos reais chamam).
const obterDoKit = (t) => t.mod.log.find((e) => e.tipo === 'kit.montar').obter;
const sessaoU2 = () => resposta(200, { userId: 'u2', accessToken: 'x', contextos: [{ empresaId: 'a1', processoId: 'pa' }], empresas: [{ empresaId: 'a1', razaoSocial: 'Empresa A1' }] });

test('obterSessao do kit: 401 com sessão ativa limpa a casca, mostra expiração e não repete a consulta', async () => {
  const t = criar({ autorizados: ['a1'] });
  await entrarEAbrir(t);
  const obter = obterDoKit(t);
  let consultas = 0;
  t.srv.roteador.sessao = async () => { consultas += 1; return resposta(401, {}); };
  const r = await obter();
  assert.equal(r, null);
  assert.equal(consultas, 1);
  assert.equal(t.ctrl.estado().tela, 'login');
  assert.equal(t.el('area').hidden, true);
  assert.equal(t.el('app-aviso').textContent, 'Sua sessão expirou. Entre novamente.');
  assert.equal(t.el('app-aviso').dataset.estado, 'erro');
  assert.ok(fechamentos(t.mod) >= 1);
  assert.ok(t.mod.log.some((e) => e.tipo === 'ident.limpar'));
});

test('obterSessao do kit: falha de rede mostra erro com Tentar de novo e dados limpos; nova tentativa restaura', async () => {
  const t = criar({ autorizados: ['a1'] });
  await entrarEAbrir(t);
  const obter = obterDoKit(t);
  t.srv.roteador.sessao = async () => { throw new Error('rede caiu'); };
  assert.equal(await obter(), null);
  assert.equal(t.ctrl.estado().tela, 'erro-sessao');
  assert.equal(t.el('tentar').hidden, false);
  assert.equal(t.el('area').hidden, true);
  assert.equal(t.el('app-aviso').textContent, 'Não foi possível verificar sua sessão. Tente de novo.');
  assert.ok(fechamentos(t.mod) >= 1);
  t.srv.roteador.sessao = null;
  await t.ctrl.tentarNovamente();
  assert.equal(t.ctrl.estado().tela, 'area');
});

test('obterSessao do kit: resposta tardia após logout é descartada e não entrega dados nem remonta', async () => {
  const t = criar({ autorizados: ['a1'] });
  await entrarEAbrir(t);
  const obter = obterDoKit(t);
  const tarde = adiar();
  t.srv.roteador.sessao = () => tarde.p;
  const pendente = obter();
  await t.ctrl.sair();
  const montadasAntes = montagens(t.mod);
  tarde.resolve(resposta(200, { userId: 'u1', accessToken: 'x', contextos: [] }));
  assert.equal(await pendente, null);
  assert.equal(montagens(t.mod), montadasAntes);
  assert.equal(t.ctrl.estado().tela, 'login');
});

test('obterSessao do kit: resposta tardia do usuário anterior não afeta o novo usuário logado', async () => {
  const t = criar({ autorizados: ['a1'] });
  await entrarEAbrir(t);
  const obterAntigo = obterDoKit(t);
  const tarde = adiar();
  t.srv.roteador.sessao = () => tarde.p;
  const pendente = obterAntigo();
  await t.ctrl.sair();
  t.srv.roteador.sessao = async () => sessaoU2();
  await t.ctrl.entrar('operador-b@qa.invalid', 'x');
  assert.equal(t.ctrl.estado().tela, 'area');
  const montadasNovo = montagens(t.mod);
  tarde.resolve(resposta(200, { userId: 'u1', accessToken: 'x', contextos: [] }));
  assert.equal(await pendente, null);
  assert.equal(t.ctrl.estado().tela, 'area', 'resposta antiga não derruba o novo usuário');
  assert.equal(montagens(t.mod), montadasNovo);
});

test('obterSessao do kit: usuário divergente na mesma época limpa a casca e avisa para entrar de novo', async () => {
  const t = criar({ autorizados: ['a1'] });
  await entrarEAbrir(t);
  const obter = obterDoKit(t);
  t.srv.roteador.sessao = async () => sessaoU2();
  assert.equal(await obter(), null);
  assert.equal(t.ctrl.estado().tela, 'login');
  assert.equal(t.el('app-aviso').textContent, 'Sua sessão mudou. Entre novamente.');
  assert.equal(t.el('area').hidden, true);
});

test('obterSessao do kit: resposta válida do mesmo usuário devolve a sessão', async () => {
  const t = criar({ autorizados: ['a1'] });
  await entrarEAbrir(t);
  const r = await obterDoKit(t)();
  assert.equal(r.userId, 'u1');
  assert.equal(t.ctrl.estado().tela, 'area');
});

// Cenário do caso real: B200 autorizada e paginada; A403 não autorizada.
const cenarioB200 = (extra = {}) => criar({ ...extra,
  contextos: [{ empresaId: 'b200', processoId: 'pb200' }, { empresaId: 'a403', processoId: 'pa403' }],
  autorizados: ['b200'],
  paginadas: ['b200'],
});

test('consultar só roda ao abrir o processo e sempre com itensPaginados:true', async () => {
  const t = cenarioB200();
  await t.ctrl.entrar('operador-b@qa.invalid', 'x');
  assert.equal(t.srv.corpos.filter((c) => c.acao === 'consultar').length, 0, 'montar o Hoje não consulta processo');
  await t.ctrl.abrirProcesso('b200', 'pb200');
  const consultas = t.srv.corpos.filter((c) => c.acao === 'consultar');
  assert.equal(consultas.length, 1);
  assert.ok(consultas.every((c) => c.itensPaginados === true));
});

test('Hoje mostra objeto, situação e prazo do catálogo como texto', async () => {
  const t = criar({ autorizados: ['a1'], contextos: [{ empresaId: 'a1', processoId: 'pa', objeto: '<b>Papel</b>', status: 'triagem', prazo: '2026-12-01T13:00:00+00:00' }] });
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  const textos = [];
  const varrer = (n) => { if (n.className === 'hoje-detalhe') textos.push(n.textContent); for (const f of n.filhos || []) varrer(f); };
  varrer(t.el('hoje-lista'));
  assert.equal(textos.length, 1);
  assert.match(textos[0], /^<b>Papel<\/b> · Situação: triagem · Sessão: 01\/12\/2026/);
});

test('100 processos = 1 requisição para montar o Hoje', async () => {
  const contextos = Array.from({ length: 100 }, (_, i) => ({ empresaId: 'a1', processoId: 'p' + i }));
  const t = criar({ contextos, autorizados: ['a1'] });
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  assert.equal(t.ctrl.estado().tela, 'area');
  assert.equal(t.ctrl.estado().autorizados.length, 100);
  assert.deepEqual(t.srv.chamadas, ['POST /qa/login', 'GET /qa/session']);
});

test('catálogo divergente: par listado que o consultar recusa (403) não monta nada e sai da lista', async () => {
  const t = cenarioB200({ divergente: true });
  await t.ctrl.entrar('operador-b@qa.invalid', 'x');
  assert.equal(t.ctrl.estado().autorizados.length, 2);
  await t.ctrl.abrirProcesso('a403', 'pa403');
  assert.equal(montagens(t.mod), 0);
  assert.equal(t.mod.log.some((e) => e.tipo === 'ident.abrir' || e.tipo === 'itens.montar'), false);
  assert.equal(t.ctrl.estado().visao, 'hoje');
  assert.equal(t.el('app-aviso').textContent, 'Este processo não está disponível para sua conta.');
  assert.deepEqual(JSON.parse(JSON.stringify(t.ctrl.estado().autorizados)), ['Empresa B200 · Processo QA-pb200']);
  assert.equal(botoesDe(t.el('hoje-lista')).some((b) => b.processo === 'pa403'), false);
});

test('consultar com ids divergentes ao abrir é recusado como não autorizado', async () => {
  const t = cenarioB200();
  t.srv.roteador.kit = async (c) => resposta(200, { empresa: { id: 'outra', razaoSocial: 'X' }, processo: { id: c.processoId, numero: '1' } });
  await t.ctrl.entrar('operador-b@qa.invalid', 'x');
  await t.ctrl.abrirProcesso('b200', 'pb200');
  assert.equal(montagens(t.mod), 0);
  assert.equal(t.ctrl.estado().autorizados.length, 0);
});

test('B200 aparece como autorizada, A403 não aparece e 403 não vira erro de carregamento', async () => {
  const t = cenarioB200();
  await t.ctrl.entrar('operador-b@qa.invalid', 'x');
  assert.equal(t.ctrl.estado().tela, 'area');
  assert.deepEqual(JSON.parse(JSON.stringify(t.ctrl.estado().autorizados)), ['Empresa B200 · Processo QA-pb200']);
  await t.ctrl.abrirProcesso('b200', 'pb200');
  const montado = t.mod.log.find((e) => e.tipo === 'kit.montar').contexto;
  assert.equal(JSON.parse(JSON.stringify(montado)).empresaId, 'b200');
  assert.equal(t.el('app-aviso').textContent, '');
});

test('guarda do handler: consultar paginado sem itensPaginados:true responde 409 (simulação)', async () => {
  const t = cenarioB200();
  const r = await t.srv.fetch('/api/kit-documentos', { method: 'POST', body: JSON.stringify({ acao: 'consultar', empresaId: 'b200', processoId: 'pb200' }) });
  assert.equal(r.status, 409);
  const ok = await t.srv.fetch('/api/kit-documentos', { method: 'POST', body: JSON.stringify({ acao: 'consultar', empresaId: 'b200', processoId: 'pb200', itensPaginados: true }) });
  assert.equal(ok.status, 200);
});

test('409 ao abrir não é confundido com não autorizado: avisa, não monta e mantém o par na lista', async () => {
  const t = cenarioB200();
  t.srv.roteador.kit = async () => resposta(409, {});
  await t.ctrl.entrar('operador-b@qa.invalid', 'x');
  await t.ctrl.abrirProcesso('b200', 'pb200');
  assert.equal(t.ctrl.estado().tela, 'area');
  assert.equal(t.ctrl.estado().visao, 'hoje');
  assert.equal(t.el('app-aviso').textContent, 'Não foi possível abrir o processo. Tente de novo.');
  assert.equal(t.el('app-aviso').dataset.estado, 'erro');
  assert.equal(montagens(t.mod), 0);
  assert.deepEqual(JSON.parse(JSON.stringify(t.ctrl.estado().autorizados)), ['Empresa B200 · Processo QA-pb200']);
});

test('falha de rede ao abrir avisa sem montar; nova tentativa de abrir monta B200', async () => {
  const t = cenarioB200();
  t.srv.roteador.kit = async () => { throw new Error('rede caiu'); };
  await t.ctrl.entrar('operador-b@qa.invalid', 'x');
  await t.ctrl.abrirProcesso('b200', 'pb200');
  assert.equal(montagens(t.mod), 0);
  assert.equal(t.el('app-aviso').textContent, 'Não foi possível abrir o processo. Tente de novo.');
  t.srv.roteador.kit = null;
  await t.ctrl.abrirProcesso('b200', 'pb200');
  assert.equal(montagens(t.mod), 1);
});

test('somente 403 em todos os contextos mostra sem empresa autorizada, não erro', async () => {
  const t = criar({ contextos: [{ empresaId: 'a403', processoId: 'pa403' }], autorizados: [] });
  await t.ctrl.entrar('operador-b@qa.invalid', 'x');
  assert.equal(t.ctrl.estado().tela, 'sem-contexto');
  assert.equal(t.el('app-aviso').dataset.estado, 'vazio');
});

// Seleção separada: empresa escolhe os processos autorizados dela; processo não troca de empresa.
const TRES_PARES = [{ empresaId: 'a1', processoId: 'pa' }, { empresaId: 'a1', processoId: 'pa2' }, { empresaId: 'b1', processoId: 'pb' }];

test('seleção separa empresa e processo: processos listados são só da empresa ativa', async () => {
  const t = criar({ autorizados: ['a1', 'b1'], contextos: TRES_PARES });
  await entrarEAbrir(t);
  assert.deepEqual(t.el('empresa-ativa').filhos.map((o) => o.value), ['a1', 'b1']);
  assert.deepEqual(t.el('processo-ativo').filhos.map((o) => o.value), ['pa', 'pa2']);
  assert.equal(t.el('processo-bloco').hidden, false);
  await t.ctrl.selecionarProcesso('pa2');
  assert.equal(t.mod.log.filter((e) => e.tipo === 'kit.montar').at(-1).contexto.processoId, 'pa2');
  await t.ctrl.selecionarProcesso('pb');
  assert.equal(t.mod.log.filter((e) => e.tipo === 'kit.montar').at(-1).contexto.processoId, 'pa2', 'processo de outra empresa é ignorado');
  await t.ctrl.selecionarEmpresa('b1');
  const ultimo = t.mod.log.filter((e) => e.tipo === 'kit.montar').at(-1).contexto;
  assert.deepEqual({ empresaId: ultimo.empresaId, processoId: ultimo.processoId }, { empresaId: 'b1', processoId: 'pb' });
  assert.deepEqual(t.el('processo-ativo').filhos.map((o) => o.value), ['pb']);
});

test('troca de empresa limpa o módulo anterior; resposta antiga da empresa anterior não entrega dados', async () => {
  const t = criar({ autorizados: ['a1', 'b1'], contextos: TRES_PARES });
  await entrarEAbrir(t);
  const montagemA = t.mod.log.find((e) => e.tipo === 'kit.montar' && e.contexto.empresaId === 'a1');
  const fechamentosAntes = fechamentos(t.mod);
  const seg = adiar();
  t.srv.roteador.sessao = () => seg.p;
  const pendente = montagemA.obter();
  await t.ctrl.selecionarEmpresa('b1');
  assert.ok(fechamentos(t.mod) > fechamentosAntes, 'módulo da empresa anterior foi fechado');
  seg.resolve(resposta(200, { userId: 'u1', accessToken: 'qa-cookie-session', contextos: TRES_PARES }));
  assert.equal(await pendente, null, 'resposta obsoleta não entrega sessão ao módulo antigo');
  assert.equal(t.mod.log.filter((e) => e.tipo === 'kit.montar').at(-1).contexto.empresaId, 'b1');
});

test('empresa sem processo autorizado não aparece e não pode ser selecionada', async () => {
  const t = criar({ autorizados: ['a1'], contextos: [{ empresaId: 'a1', processoId: 'pa' }, { empresaId: 'b1', processoId: 'pb' }] });
  await entrarEAbrir(t);
  assert.deepEqual(t.el('empresa-ativa').filhos.map((o) => o.value), ['a1'], 'b1 foi recusada pelo handler e não aparece');
  const antes = montagens(t.mod);
  await t.ctrl.selecionarEmpresa('b1');
  assert.equal(montagens(t.mod), antes);
  const semNada = criar({ autorizados: [], contextos: [{ empresaId: 'a1', processoId: 'pa' }] });
  await semNada.ctrl.entrar('operador-a@qa.invalid', 'x');
  assert.equal(semNada.ctrl.estado().tela, 'sem-contexto');
  assert.equal(montagens(semNada.mod), 0);
});

// Alterações não salvas: a troca de empresa/processo só acontece com confirmação explícita.
function confirmador(resposta) {
  const chamadas = [];
  const fn = (mensagem) => { chamadas.push(mensagem); return resposta; };
  fn.chamadas = chamadas;
  return fn;
}

test('cancelar a troca com alterações não salvas preserva rascunho, módulos e seletores', async () => {
  const confirmar = confirmador(false);
  const t = criar({ autorizados: ['a1', 'b1'], contextos: TRES_PARES, confirmar });
  await entrarEAbrir(t);
  t.mod.sujo.kit = true;
  const montagensAntes = montagens(t.mod), fechamentosAntes = fechamentos(t.mod);
  await t.ctrl.selecionarEmpresa('b1');
  assert.equal(confirmar.chamadas.length, 1);
  assert.match(confirmar.chamadas[0], /não salvas/);
  assert.equal(montagens(t.mod), montagensAntes, 'nenhum módulo novo foi montado');
  assert.equal(fechamentos(t.mod), fechamentosAntes, 'módulo atual não foi fechado');
  assert.equal(t.el('empresa-ativa').value, 'a1', 'seletor de empresa volta ao contexto atual');
  assert.equal(t.el('processo-ativo').value, 'pa', 'seletor de processo volta ao contexto atual');
  assert.equal(t.el('contexto-atual').textContent, 'Empresa A1 · Processo QA-pa');
  assert.equal(t.ctrl.estado().tela, 'area');
});

test('cancelar a troca de processo também preserva o contexto', async () => {
  const t = criar({ autorizados: ['a1', 'b1'], contextos: TRES_PARES, confirmar: confirmador(false) });
  await entrarEAbrir(t);
  t.mod.sujo.ident = true;
  await t.ctrl.selecionarProcesso('pa2');
  assert.equal(t.el('processo-ativo').value, 'pa');
  assert.equal(t.mod.log.filter((e) => e.tipo === 'kit.montar').at(-1).contexto.processoId, 'pa');
});

test('aceitar a troca descarta as alterações e monta o novo contexto', async () => {
  const confirmar = confirmador(true);
  const t = criar({ autorizados: ['a1', 'b1'], contextos: TRES_PARES, confirmar });
  await entrarEAbrir(t);
  t.mod.sujo.kit = true;
  await t.ctrl.selecionarEmpresa('b1');
  assert.equal(confirmar.chamadas.length, 1);
  assert.ok(fechamentos(t.mod) >= 1, 'módulo anterior fechado');
  assert.equal(t.mod.log.filter((e) => e.tipo === 'kit.montar').at(-1).contexto.empresaId, 'b1');
});

test('sem alterações não pede confirmação; revisão confirmada (sem pendência) não bloqueia', async () => {
  const confirmar = confirmador(false);
  const t = criar({ autorizados: ['a1', 'b1'], contextos: TRES_PARES, confirmar });
  await entrarEAbrir(t);
  t.mod.sujo.kit = true;
  t.mod.sujo.kit = false;
  await t.ctrl.selecionarEmpresa('b1');
  assert.equal(confirmar.chamadas.length, 0);
  assert.equal(t.mod.log.filter((e) => e.tipo === 'kit.montar').at(-1).contexto.empresaId, 'b1');
});

test('sem confirmação disponível, alteração não salva cancela a troca (padrão conservador)', async () => {
  const t = criar({ autorizados: ['a1', 'b1'], contextos: TRES_PARES });
  await entrarEAbrir(t);
  t.mod.sujo.kit = true;
  const antes = montagens(t.mod);
  await t.ctrl.selecionarEmpresa('b1');
  assert.equal(montagens(t.mod), antes);
  assert.equal(t.el('empresa-ativa').value, 'a1');
});

// ---- Painel Hoje ----
// Coleta todos os textos e botões de abrir processo da árvore montada em hoje-lista.
function textosDe(no, acc = []) {
  if (no.textContent) acc.push(no.textContent);
  for (const f of no.filhos || []) textosDe(f, acc);
  return acc;
}
function botoesDe(no, acc = []) {
  if (no.dataset && no.dataset.processo) acc.push({ empresa: no.dataset.empresa, processo: no.dataset.processo });
  for (const f of no.filhos || []) botoesDe(f, acc);
  return acc;
}

test('Hoje lista só os pares autorizados, agrupados por empresa, e não mostra métricas, datas ou prazos', async () => {
  const t = criar({ autorizados: ['a1', 'b1'], contextos: TRES_PARES });
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  assert.equal(t.el('hoje').hidden, false);
  assert.equal(t.el('area').hidden, true);
  assert.deepEqual(botoesDe(t.el('hoje-lista')), [
    { empresa: 'a1', processo: 'pa' }, { empresa: 'a1', processo: 'pa2' }, { empresa: 'b1', processo: 'pb' },
  ]);
  const todos = textosDe(t.el('hoje-lista')).join(' | ');
  assert.doesNotMatch(todos, /\d{2}\/\d{2}|\d+ dias?|prazo|vence|R\$|\d+%/i);
  assert.equal(t.el('hoje-estado').textContent, '');
});

test('Hoje: estado de carregamento, vazio e erro têm textos honestos e distintos', async () => {
  const pendente = criar({ autorizados: ['a1'] });
  const sessao = adiar();
  pendente.srv.roteador.sessao = () => sessao.p;
  const iniciando = pendente.ctrl.iniciar();
  assert.equal(pendente.el('hoje').hidden, false);
  assert.equal(pendente.el('hoje-estado').textContent, 'Carregando empresas e processos autorizados…');
  sessao.resolve(resposta(401, {}));
  await iniciando;

  const vazio = criar({ autorizados: [] });
  await vazio.ctrl.entrar('operador-a@qa.invalid', 'x');
  assert.equal(vazio.el('hoje').hidden, false);
  assert.equal(vazio.el('hoje-estado').textContent, 'Nenhuma empresa autorizada para esta conta.');
  assert.equal(vazio.el('hoje-lista').filhos.length, 0);
});

test('abrirProcesso ignora par que não está na lista autorizada desta sessão', async () => {
  const t = criar({ autorizados: ['a1'], contextos: [{ empresaId: 'a1', processoId: 'pa' }, { empresaId: 'b1', processoId: 'pb' }] });
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  const antes = montagens(t.mod);
  await t.ctrl.abrirProcesso('b1', 'pb');
  await t.ctrl.abrirProcesso('a1', 'pb');
  assert.equal(montagens(t.mod), antes);
  assert.equal(t.ctrl.estado().visao, 'hoje');
  assert.equal(t.el('hoje').hidden, false);
});

test('voltar ao Hoje mantém módulo, contexto e rascunho; reabrir o mesmo processo não remonta', async () => {
  const confirmar = confirmador(false);
  const t = criar({ autorizados: ['a1', 'b1'], contextos: TRES_PARES, confirmar });
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  await t.ctrl.abrirProcesso('a1', 'pa');
  t.mod.sujo.kit = true;
  const montadasAntes = montagens(t.mod), fechadasAntes = fechamentos(t.mod);
  t.ctrl.voltarHoje();
  assert.equal(t.ctrl.estado().visao, 'hoje');
  assert.equal(t.el('hoje').hidden, false);
  assert.equal(t.el('area').hidden, true);
  assert.equal(t.el('hoje-titulo').focused, true);
  assert.equal(fechamentos(t.mod), fechadasAntes, 'voltar não fecha o módulo');
  assert.equal(confirmar.chamadas.length, 0, 'voltar não pede confirmação');
  await t.ctrl.abrirProcesso('a1', 'pa');
  assert.equal(montagens(t.mod), montadasAntes, 'mesmo processo não remonta');
  assert.equal(t.ctrl.estado().visao, 'processo');
});

test('troca de processo pelo Hoje com alteração não salva: cancelar mantém o Hoje e o contexto anterior', async () => {
  const confirmar = confirmador(false);
  const t = criar({ autorizados: ['a1', 'b1'], contextos: TRES_PARES, confirmar });
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  await t.ctrl.abrirProcesso('a1', 'pa');
  t.mod.sujo.kit = true;
  t.ctrl.voltarHoje();
  const montadasAntes = montagens(t.mod);
  await t.ctrl.abrirProcesso('b1', 'pb');
  assert.equal(confirmar.chamadas.length, 1);
  assert.equal(montagens(t.mod), montadasAntes, 'nenhum módulo novo');
  assert.equal(t.ctrl.estado().visao, 'hoje');
  assert.equal(t.el('hoje').hidden, false);
  assert.equal(t.el('contexto-atual').textContent, 'Empresa A1 · Processo QA-pa');
});

test('troca de processo pelo Hoje com confirmação aceita descarta a alteração e monta o novo par', async () => {
  const confirmar = confirmador(true);
  const t = criar({ autorizados: ['a1', 'b1'], contextos: TRES_PARES, confirmar });
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  await t.ctrl.abrirProcesso('a1', 'pa');
  t.mod.sujo.kit = true;
  t.ctrl.voltarHoje();
  await t.ctrl.abrirProcesso('b1', 'pb');
  assert.equal(confirmar.chamadas.length, 1);
  assert.ok(fechamentos(t.mod) >= 1);
  assert.equal(t.mod.log.filter((e) => e.tipo === 'kit.montar').at(-1).contexto.empresaId, 'b1');
  assert.equal(t.ctrl.estado().visao, 'processo');
});

test('resposta tardia do processo anterior não entrega sessão ao módulo após abrir outro processo', async () => {
  const t = criar({ autorizados: ['a1'], contextos: [{ empresaId: 'a1', processoId: 'pa' }, { empresaId: 'a1', processoId: 'pa2' }] });
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  await t.ctrl.abrirProcesso('a1', 'pa');
  const obterPa = t.mod.log.filter((e) => e.tipo === 'kit.montar')[0].obter;
  const tarde = adiar();
  t.srv.roteador.sessao = () => tarde.p;
  const pendente = obterPa();
  t.ctrl.voltarHoje();
  await t.ctrl.abrirProcesso('a1', 'pa2');
  tarde.resolve(resposta(200, { userId: 'u1', accessToken: 'x', contextos: [] }));
  assert.equal(await pendente, null, 'módulo do processo anterior não recebe sessão tardia');
  assert.equal(t.mod.log.filter((e) => e.tipo === 'kit.montar').at(-1).contexto.processoId, 'pa2');
  assert.equal(t.el('contexto-atual').textContent, 'Empresa A1 · Processo QA-pa2');
});

// ---- Limpeza do Hoje nas fronteiras de sessão ----
const TEXTO_A = 'EMPRESA A1';
const cardsA = (t) => botoesDe(t.el('hoje-lista')).filter((b) => b.empresa === 'a1');
const flush = () => new Promise((r) => setImmediate(r));
const sessaoB = () => resposta(200, { userId: 'u2', accessToken: 'x', contextos: [{ empresaId: 'b1', processoId: 'pb' }], empresas: [{ empresaId: 'b1', razaoSocial: 'Empresa B1' }] });

test('Hoje: voltar ao Hoje e trocar processo preservam a lista e o rascunho', async () => {
  const confirmar = confirmador(false);
  const t = criar({ autorizados: ['a1', 'b1'], contextos: TRES_PARES, confirmar });
  await entrarEAbrir(t);
  t.mod.sujo.kit = true;
  t.ctrl.voltarHoje();
  assert.equal(botoesDe(t.el('hoje-lista')).length, 3, 'voltar não apaga a lista');
  await t.ctrl.abrirProcesso('a1', 'pa2');
  assert.equal(confirmar.chamadas.length, 1);
  assert.equal(botoesDe(t.el('hoje-lista')).length, 3, 'troca cancelada não apaga a lista');
  assert.equal(t.mod.sujo.kit, true, 'rascunho preservado');
});

test('A→sair pendente→loginB pendente: nenhum cartão da empresa A aparece em carregamento', async () => {
  const t = criar({ autorizados: ['a1', 'b1'], contextos: TRES_PARES });
  await entrarEAbrir(t);
  t.ctrl.voltarHoje();
  assert.ok(cardsA(t).length > 0);
  const logout = adiar();
  t.srv.roteador.logout = () => logout.p;
  const saindo = t.ctrl.sair();
  assert.equal(botoesDe(t.el('hoje-lista')).length, 0, 'logout pendente sem cartões');
  logout.resolve(resposta(200, { ok: true }));
  await saindo;
  assert.equal(botoesDe(t.el('hoje-lista')).length, 0);
  t.srv.roteador.logout = null;
  const sessao = adiar();
  t.srv.roteador.sessao = () => sessao.p;
  const entrando = t.ctrl.entrar('operador-b@qa.invalid', 'x');
  await flush();
  assert.equal(t.ctrl.estado().tela, 'carregando');
  assert.equal(botoesDe(t.el('hoje-lista')).length, 0, 'sessão B carregando sem cartões A');
  assert.equal(t.el('hoje-estado').textContent, 'Carregando empresas e processos autorizados…');
  sessao.resolve(sessaoB());
  await entrando;
  const bs = botoesDe(t.el('hoje-lista'));
  assert.deepEqual(bs, [{ empresa: 'b1', processo: 'pb' }], 'só cartão B após relogin');
  assert.equal(cardsA(t).length, 0);
});

test('A→sair com falha de rede: sem cartões A na tela de erro', async () => {
  const t = criar({ autorizados: ['a1', 'b1'], contextos: TRES_PARES });
  await entrarEAbrir(t);
  t.srv.roteador.logout = async () => { throw new Error('rede'); };
  await t.ctrl.sair();
  assert.equal(t.ctrl.estado().tela, 'erro-sair');
  assert.equal(botoesDe(t.el('hoje-lista')).length, 0);
});

test('A→relogin com erro de sessão: nenhum cartão A durante nem após o erro', async () => {
  const t = criar({ autorizados: ['a1', 'b1'], contextos: TRES_PARES });
  await entrarEAbrir(t);
  t.ctrl.voltarHoje();
  t.srv.roteador.sessao = async () => { throw new Error('rede'); };
  await t.ctrl.iniciar();
  assert.equal(t.ctrl.estado().tela, 'erro-sessao');
  assert.equal(botoesDe(t.el('hoje-lista')).length, 0);
});

test('A→expiração (401) com sessão ativa: cartões A são removidos', async () => {
  const t = criar({ autorizados: ['a1', 'b1'], contextos: TRES_PARES });
  await entrarEAbrir(t);
  t.ctrl.voltarHoje();
  t.srv.roteador.sessao = async () => resposta(401, {});
  await t.ctrl.iniciar();
  assert.equal(t.ctrl.estado().tela, 'login');
  assert.equal(botoesDe(t.el('hoje-lista')).length, 0);
});

test('A→relogin sem contexto autorizado: estado vazio sem cartões A', async () => {
  const t = criar({ autorizados: ['a1', 'b1'], contextos: TRES_PARES });
  await entrarEAbrir(t);
  t.ctrl.voltarHoje();
  t.srv.roteador.sessao = async () => resposta(200, { userId: 'u2', accessToken: 'x', contextos: [] });
  await t.ctrl.iniciar();
  assert.equal(t.ctrl.estado().tela, 'sem-contexto');
  assert.equal(botoesDe(t.el('hoje-lista')).length, 0);
  assert.equal(t.el('hoje-estado').textContent, 'Nenhuma empresa autorizada para esta conta.');
});

// ---- Cadastro de processo para empresa autorizada ----
const botoesNovo = (t) => { const acc = []; const v = (no) => { if (no.dataset && no.dataset.novoEmpresa) acc.push(no.dataset.novoEmpresa); for (const f of no.filhos || []) v(f); }; v(t.el('hoje-lista')); return acc; };
const criacoes = (t) => t.srv.corpos.filter((c) => c.rota === 'criar-processo');
const EMP_Z = { empresaId: 'z1', razaoSocial: 'EMPRESA FICTÍCIA Z' };
const cenarioZ = (extra = {}) => criar({ autorizados: ['a1', 'z1'], contextos: [{ empresaId: 'a1', processoId: 'pa' }], empresas: [{ empresaId: 'a1', razaoSocial: 'EMPRESA A' }, EMP_Z], ...extra });
const CAMPOS_OK = { objeto: 'Aquisição fictícia de equipamentos', numero: 'PE-FICT-1', orgao: 'Órgão fictício', modalidade: 'Pregão' };

test('Hoje lista empresa autorizada sem processo, com estado honesto e botão Novo processo', async () => {
  const t = cenarioZ();
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  assert.ok(botoesNovo(t).includes('z1'));
  assert.match(textosDe(t.el('hoje-lista')).join(' | '), /Esta empresa ainda não tem processos cadastrados\./);
  assert.equal(botoesDe(t.el('hoje-lista')).some((b) => b.empresa === 'z1'), false);
});

test('Novo processo só abre para empresa autorizada da descoberta', async () => {
  const t = cenarioZ();
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  t.ctrl.abrirNovoProcesso('nao-autorizada');
  assert.equal(t.el('novo-processo-bloco').hidden, true);
  t.ctrl.abrirNovoProcesso('z1');
  assert.equal(t.el('novo-processo-bloco').hidden, false);
  assert.equal(t.el('novo-processo-empresa').textContent, 'Empresa: EMPRESA FICTÍCIA Z');
});

test('campos inválidos são barrados no navegador: nenhum envio', async () => {
  const t = cenarioZ();
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  t.ctrl.abrirNovoProcesso('z1');
  await t.ctrl.criarProcesso({ objeto: 'ab', numero: '' });
  assert.equal(criacoes(t).length, 0);
  assert.match(t.el('novo-processo-erro').textContent, /mínimo de 3 caracteres/);
});

test('cadastro bem-sucedido: usa id da tentativa, lista o processo e abre o kit dele', async () => {
  const t = cenarioZ();
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  t.ctrl.abrirNovoProcesso('z1');
  await t.ctrl.criarProcesso(CAMPOS_OK);
  const envio = criacoes(t);
  assert.equal(envio.length, 1);
  assert.equal(envio[0].empresaId, 'z1');
  assert.match(envio[0].tentativaId, /^[0-9a-f-]{36}$/);
  assert.equal(t.el('novo-processo-bloco').hidden, true);
  const abertos = t.mod.log.filter((e) => e.tipo === 'kit.montar');
  assert.equal(abertos.at(-1).contexto.empresaId, 'z1');
  assert.equal(abertos.at(-1).contexto.processoId, envio[0].tentativaId);
  assert.equal(t.ctrl.estado().visao, 'processo');
});

test('clique duplo envia uma única vez', async () => {
  const t = cenarioZ();
  const espera = adiar();
  t.srv.roteador.criar = () => espera.p;
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  t.ctrl.abrirNovoProcesso('z1');
  const primeiro = t.ctrl.criarProcesso(CAMPOS_OK);
  const segundo = t.ctrl.criarProcesso(CAMPOS_OK);
  espera.resolve(resposta(201, { processo: { id: 'x', empresa_id: 'z1', numero: 'PE-FICT-1', objeto: 'x' } }));
  await Promise.all([primeiro, segundo]);
  assert.equal(criacoes(t).length, 1);
});

test('reenvio após erro com os mesmos dados usa o mesmo id; dados alterados geram outro id', async () => {
  const t = cenarioZ();
  t.srv.roteador.criar = () => resposta(409, { erro: 'Já existe processo com este número nesta empresa.' });
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  t.ctrl.abrirNovoProcesso('z1');
  await t.ctrl.criarProcesso(CAMPOS_OK);
  assert.equal(t.el('novo-processo-bloco').hidden, false, 'formulário continua aberto');
  assert.equal(t.el('novo-processo-erro').textContent, 'Já existe processo com este número nesta empresa.');
  await t.ctrl.criarProcesso(CAMPOS_OK);
  await t.ctrl.criarProcesso({ ...CAMPOS_OK, numero: 'PE-FICT-2' });
  const ids = criacoes(t).map((c) => c.tentativaId);
  assert.equal(ids.length, 3);
  assert.equal(ids[0], ids[1], 'mesmos dados, mesmo id');
  assert.notEqual(ids[0], ids[2], 'dados alterados, novo id');
});

test('falha de rede mantém o formulário com dados e mensagem genérica', async () => {
  const t = cenarioZ();
  t.srv.roteador.criar = () => { throw new Error('rede'); };
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  t.ctrl.abrirNovoProcesso('z1');
  await t.ctrl.criarProcesso(CAMPOS_OK);
  assert.equal(t.el('novo-processo-erro').textContent, 'Não foi possível cadastrar o processo. Tente de novo.');
  assert.equal(t.el('novo-processo-salvar').disabled, false);
  assert.equal(t.el('novo-processo-bloco').hidden, false);
});

test('sair durante o cadastro: resposta tardia não altera a tela nem lista o processo', async () => {
  const t = cenarioZ();
  const espera = adiar();
  t.srv.roteador.criar = () => espera.p;
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  t.ctrl.abrirNovoProcesso('z1');
  const envio = t.ctrl.criarProcesso(CAMPOS_OK);
  await t.ctrl.sair();
  espera.resolve(resposta(201, { processo: { id: 'p-tardio', empresa_id: 'z1', numero: 'PE-FICT-1', objeto: 'x' } }));
  await envio;
  assert.equal(t.ctrl.estado().tela, 'login');
  assert.equal(t.mod.log.filter((e) => e.tipo === 'kit.montar').length, 0);
  assert.equal(t.el('novo-processo-bloco').hidden, true);
});

// ---- Onboarding: Preparar empresa (identificação existente, sem processo e sem kit) ----
function botoesPreparar(t, no = t.el('hoje-lista'), acc = []) {
  if (no.dataset && no.dataset.prepararEmpresa) acc.push(no.dataset.prepararEmpresa);
  for (const f of no.filhos || []) botoesPreparar(t, f, acc);
  return acc;
}
const idents = (t) => t.mod.log.filter((e) => e.tipo === 'ident.abrir');
const kitsMontados = (t) => t.mod.log.filter((e) => e.tipo === 'kit.montar').length;

test('Hoje oferece Preparar empresa para toda empresa autorizada, inclusive a que não tem processo', async () => {
  const t = cenarioZ();
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  assert.deepEqual(botoesPreparar(t).sort(), ['a1', 'z1']);
});

test('Preparar empresa sem processo monta só a identificação: sem kit, sem processo, kit oculto', async () => {
  const t = cenarioZ();
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  t.ctrl.prepararEmpresa('z1');
  const e = t.ctrl.estado();
  assert.equal(e.visao, 'preparar');
  assert.equal(e.kitMontado, false);
  assert.equal(kitsMontados(t), 0, 'kit nunca montado sem processo');
  assert.deepEqual(idents(t).map((x) => x.empresaId), ['z1']);
  assert.deepEqual(idents(t).map((x) => x.usuarioId), ['u1'], 'identificação recebe só empresa e usuário, nunca processo');
  assert.equal(t.el('area').hidden, false);
  assert.equal(t.el('kit').hidden, true);
  assert.equal(t.el('hoje').hidden, true);
  assert.equal(t.el('novo-processo-bloco').hidden, true, 'novo processo não aparece na preparação');
  assert.equal(t.el('contexto-atual').textContent, 'Preparar empresa: EMPRESA FICTÍCIA Z');
});

test('voltar ao Hoje a partir da preparação preserva o módulo; reabrir a mesma empresa não remonta', async () => {
  const t = cenarioZ();
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  t.ctrl.prepararEmpresa('z1');
  t.ctrl.voltarHoje();
  assert.equal(t.ctrl.estado().visao, 'hoje');
  assert.equal(t.el('hoje').hidden, false);
  assert.equal(t.mod.log.some((e) => e.tipo === 'ident.limpar'), false, 'módulo não é limpo ao voltar');
  t.ctrl.prepararEmpresa('z1');
  assert.equal(idents(t).length, 1, 'mesma empresa reexibida sem nova montagem');
  assert.equal(t.ctrl.estado().visao, 'preparar');
});

test('troca de empresa durante preparação pede confirmação quando há alterações; cancelar mantém a atual', async () => {
  const t = cenarioZ({ confirmar: () => false });
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  t.ctrl.prepararEmpresa('z1');
  t.mod.sujo.ident = true;
  await t.ctrl.selecionarEmpresa('a1');
  assert.equal(t.ctrl.estado().identDe.empresaId, 'z1', 'alterações de z1 preservadas');
  assert.equal(t.el('empresa-ativa').value, 'z1', 'seletor volta à empresa preparada');
  assert.equal(idents(t).length, 1);
});

test('troca confirmada descarta a identificação anterior e monta a nova empresa', async () => {
  let perguntas = 0;
  const t = cenarioZ({ confirmar: () => { perguntas += 1; return true; } });
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  t.ctrl.prepararEmpresa('z1');
  t.mod.sujo.ident = true;
  t.ctrl.prepararEmpresa('a1');
  assert.equal(perguntas, 1, 'uma confirmação para a troca');
  assert.equal(t.ctrl.estado().identDe.empresaId, 'a1');
  assert.equal(idents(t).at(-1).empresaId, 'a1');
  assert.equal(t.mod.log.some((e) => e.tipo === 'ident.limpar'), true, 'módulo anterior limpo após confirmação');
});

test('seletor de empresa sem processo abre a preparação, nunca o kit', async () => {
  const t = cenarioZ();
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  await t.ctrl.abrirProcesso('a1', 'pa');
  const antes = kitsMontados(t);
  await t.ctrl.selecionarEmpresa('z1');
  assert.equal(t.ctrl.estado().visao, 'preparar');
  assert.equal(kitsMontados(t), antes, 'nenhum kit novo para empresa sem processo');
  assert.equal(t.ctrl.estado().kitMontado, false);
});

test('empresa fora da descoberta não monta identificação nem kit (isolamento)', async () => {
  const t = cenarioZ();
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  t.ctrl.prepararEmpresa('b9-fora');
  await t.ctrl.selecionarEmpresa('b9-fora');
  assert.equal(idents(t).length, 0);
  assert.equal(kitsMontados(t), 0);
  assert.equal(t.ctrl.estado().visao, 'hoje');
});

test('sair durante a preparação encerra a identificação e não deixa estado de empresa', async () => {
  const t = cenarioZ();
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  t.ctrl.prepararEmpresa('z1');
  await t.ctrl.sair();
  const e = t.ctrl.estado();
  assert.equal(e.identDe, null);
  assert.equal(e.prepEmpresaId, null);
  assert.equal(e.tela, 'login');
  assert.equal(t.mod.log.some((x) => x.tipo === 'ident.limpar'), true);
});


// ---- Itens do processo: montados só com processo, por CNPJ/processo do contexto, e encerrados com a sessão ----
const itensMontados = (t) => t.mod.log.filter((e) => e.tipo === 'itens.montar');

test('itens do processo montam com o mesmo contexto do kit (empresa + processo) e nunca na preparação', async () => {
  const t = cenarioZ();
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  t.ctrl.prepararEmpresa('z1');
  assert.equal(itensMontados(t).length, 0, 'sem itens na preparação de empresa sem processo');
  assert.equal(t.el('itens-processo').hidden, true);
  await t.ctrl.abrirProcesso('a1', 'pa');
  assert.equal(JSON.stringify(itensMontados(t).map((e) => e.contexto)), JSON.stringify([{ empresaId: 'a1', processoId: 'pa' }]));
  assert.equal(t.el('itens-processo').hidden, false);
  assert.equal(t.ctrl.estado().itensMontado, true);
});

test('itens somem ao voltar ao Hoje e são desmontados ao trocar de processo', async () => {
  const t = cenarioZ({ autorizados: ['a1', 'z1'], contextos: [{ empresaId: 'a1', processoId: 'pa' }, { empresaId: 'a1', processoId: 'pa2' }] });
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  await t.ctrl.abrirProcesso('a1', 'pa');
  t.ctrl.voltarHoje();
  assert.equal(t.el('itens-processo').hidden, true, 'oculto no Hoje');
  await t.ctrl.abrirProcesso('a1', 'pa2');
  assert.equal(t.mod.log.filter((e) => e.tipo === 'itens.fechar').length >= 1, true, 'módulo anterior encerrado');
  assert.equal(JSON.stringify(itensMontados(t).at(-1).contexto), JSON.stringify({ empresaId: 'a1', processoId: 'pa2' }));
});

test('alterações não salvas em itens pedem confirmação antes de trocar de processo', async () => {
  let perguntas = 0;
  const t = cenarioZ({ autorizados: ['a1', 'z1'], contextos: [{ empresaId: 'a1', processoId: 'pa' }, { empresaId: 'a1', processoId: 'pa2' }], confirmar: () => { perguntas += 1; return false; } });
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  await t.ctrl.abrirProcesso('a1', 'pa');
  t.mod.sujo.itens = true;
  await t.ctrl.abrirProcesso('a1', 'pa2');
  assert.equal(perguntas, 1);
  assert.equal(t.ctrl.estado().identDe.empresaId, 'a1');
  assert.equal(itensMontados(t).length, 1, 'não remontou sem confirmação');
});

test('sair encerra os itens do processo', async () => {
  const t = cenarioZ();
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  await t.ctrl.abrirProcesso('a1', 'pa');
  await t.ctrl.sair();
  assert.equal(t.ctrl.estado().itensMontado, false);
  assert.equal(t.mod.log.some((e) => e.tipo === 'itens.fechar'), true);
});

// ---- Gancho aoSalvar: item salvo renova o catálogo do kit só no mesmo contexto ativo ----
const ultimoAoSalvar = (t) => itensMontados(t).at(-1).aoSalvar;
const atualizacoes = (t) => t.mod.log.filter((e) => e.tipo === 'kit.atualizarItens');

test('item salvo chama atualizarItens do kit do mesmo contexto ativo (uma vez)', async () => {
  const t = cenarioZ({ autorizados: ['a1'], contextos: [{ empresaId: 'a1', processoId: 'pa' }] });
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  await t.ctrl.abrirProcesso('a1', 'pa');
  assert.equal(typeof ultimoAoSalvar(t), 'function', 'gancho entregue ao módulo de itens');
  ultimoAoSalvar(t)();
  assert.equal(atualizacoes(t).length, 1);
  assert.equal(JSON.stringify(atualizacoes(t)[0].contexto), JSON.stringify({ empresaId: 'a1', processoId: 'pa' }));
});

test('contexto trocado: gancho do processo anterior não atualiza o kit do novo processo', async () => {
  const t = cenarioZ({ autorizados: ['a1'], contextos: [{ empresaId: 'a1', processoId: 'pa' }, { empresaId: 'a1', processoId: 'pa2' }] });
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  await t.ctrl.abrirProcesso('a1', 'pa');
  const antigo = ultimoAoSalvar(t);
  await t.ctrl.abrirProcesso('a1', 'pa2');
  antigo();
  assert.equal(atualizacoes(t).length, 0, 'resposta/callback antigo ignorado');
  ultimoAoSalvar(t)();
  assert.equal(atualizacoes(t).length, 1);
  assert.equal(JSON.stringify(atualizacoes(t)[0].contexto), JSON.stringify({ empresaId: 'a1', processoId: 'pa2' }));
});

test('voltar ao Hoje preserva o kit: gancho do MESMO kit ainda atualiza (catálogo e revisão ficam corretos ao reabrir)', async () => {
  const t = cenarioZ({ autorizados: ['a1'], contextos: [{ empresaId: 'a1', processoId: 'pa' }] });
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  await t.ctrl.abrirProcesso('a1', 'pa');
  const cb = ultimoAoSalvar(t);
  t.ctrl.voltarHoje();
  cb();
  assert.equal(atualizacoes(t).length, 1, 'mesmo kit e escopo, mesmo oculto');
});

test('kit fechado (sair) bloqueia o gancho antigo', async () => {
  const t = cenarioZ({ autorizados: ['a1'], contextos: [{ empresaId: 'a1', processoId: 'pa' }] });
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  await t.ctrl.abrirProcesso('a1', 'pa');
  const cb = ultimoAoSalvar(t);
  await t.ctrl.sair();
  cb();
  assert.equal(atualizacoes(t).length, 0, 'sem kit montado, nada é atualizado');
});

// Link direto /sistema?empresa=<uuid>&processo=<uuid> (T4): só abre par do catálogo, e ainda passa por consultar.
const EA = '11111111-1111-4111-8111-111111111111';
const PA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EB = '22222222-2222-4222-8222-222222222222';
const PB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTEXTOS_UUID = [{ empresaId: EA, processoId: PA }, { empresaId: EB, processoId: PB }];
const consultas = (t) => t.srv.corpos.filter((c) => c.acao === 'consultar');

test('link direto com par autorizado abre o processo depois de consultar', async () => {
  const t = criar({ contextos: CONTEXTOS_UUID, autorizados: [EA], busca: '?empresa=' + EA + '&processo=' + PA });
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  assert.equal(montagens(t.mod), 1);
  assert.deepEqual(JSON.parse(JSON.stringify(t.mod.log.find((e) => e.tipo === 'kit.montar').contexto)), { empresaId: EA, processoId: PA });
  assert.deepEqual(consultas(t).map((c) => c.processoId), [PA]);
  assert.equal(t.el('area').hidden, false);
});

test('link direto aceita uuid em maiúsculas', async () => {
  const t = criar({ contextos: CONTEXTOS_UUID, autorizados: [EA], busca: '?empresa=' + EA.toUpperCase() + '&processo=' + PA.toUpperCase() });
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  assert.equal(montagens(t.mod), 1);
});

test('link direto para par fora do catálogo é ignorado com aviso, sem consultar', async () => {
  const t = criar({ contextos: CONTEXTOS_UUID, autorizados: [EA], busca: '?empresa=' + EB + '&processo=' + PB });
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  assert.equal(montagens(t.mod), 0);
  assert.equal(consultas(t).length, 0);
  assert.equal(t.ctrl.estado().visao, 'hoje');
  assert.equal(t.el('app-aviso').textContent, 'Este processo não está disponível para sua conta.');
});

test('link direto com processo de outra empresa (par trocado) é ignorado', async () => {
  const t = criar({ contextos: CONTEXTOS_UUID, autorizados: [EA, EB], busca: '?empresa=' + EA + '&processo=' + PB });
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  assert.equal(montagens(t.mod), 0);
  assert.equal(t.el('app-aviso').textContent, 'Este processo não está disponível para sua conta.');
});

test('link direto que o consultar recusa não monta nada e mostra o aviso', async () => {
  const t = criar({ contextos: CONTEXTOS_UUID, autorizados: [EA], divergente: true, busca: '?empresa=' + EB + '&processo=' + PB });
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  assert.equal(consultas(t).length, 1);
  assert.equal(montagens(t.mod), 0);
  assert.equal(t.el('app-aviso').textContent, 'Este processo não está disponível para sua conta.');
});

test('link direto com parâmetro que não é uuid é ignorado em silêncio', async () => {
  for (const busca of ['?empresa=' + EA, '?empresa=' + EA + '&processo=1 or 1=1', '?empresa=a1&processo=pa', '?processo=' + PA]) {
    const t = criar({ contextos: CONTEXTOS_UUID, autorizados: [EA], busca });
    await t.ctrl.entrar('operador-a@qa.invalid', 'x');
    assert.equal(montagens(t.mod), 0, busca);
    assert.equal(consultas(t).length, 0, busca);
    assert.equal(t.el('app-aviso').textContent, '', busca);
  }
});

test('empresa ativa usa a chave do painel e migra a chave antiga uma vez', async () => {
  const storage = memoria();
  storage.setItem('licitaplena.contextoPreferido', JSON.stringify({ empresaId: 'b1', processoId: 'pb' }));
  const t = criar({ autorizados: ['a1', 'b1'], storage });
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  assert.equal(storage.getItem('licitaplena_empresa_operacional_id'), 'b1');
  assert.equal(storage.getItem('licitaplena.contextoPreferido'), null);
  assert.equal(t.el('empresa-ativa').value, 'b1');
  await t.ctrl.abrirProcesso('a1', 'pa');
  assert.equal(storage.getItem('licitaplena_empresa_operacional_id'), 'a1');
});

test('empresa ativa salva que não está autorizada não é aplicada', async () => {
  const storage = memoria();
  storage.setItem('licitaplena_empresa_operacional_id', 'outra');
  const t = criar({ autorizados: ['a1'], storage });
  await t.ctrl.entrar('operador-a@qa.invalid', 'x');
  assert.notEqual(t.el('empresa-ativa').value, 'outra');
});
