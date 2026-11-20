import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { pararChat, vigiarChat } from './acompanhar-chat.mjs';
import { criarWorkerAcompanhar, textoAlerta } from './acompanhar-worker.mjs';

// ---- DOM mínimo: só o que o vigia usa (.classe, descendentes, parentElement, textContent) ----
class No {
  constructor(classe = '', texto = '') { this.className = classe; this.texto = texto; this.filhos = []; this.parentElement = null; }
  add(f) { f.parentElement = this; this.filhos.push(f); return f; }
  get textContent() { return this.texto + this.filhos.map(f => f.textContent).join(''); }
  descendentes() { return this.filhos.flatMap(f => [f, ...f.descendentes()]); }
  querySelectorAll(sel) { const c = sel.slice(1); return this.descendentes().filter(d => d.className.split(/\s+/).includes(c)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
const HOJE = Date.parse('2026-12-01T12:00:00-03:00');
const BASE = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra';
const URL_OK = `${BASE}/item/1?compra=19302805900082025`;
const msgHtml = (corpo, data, extra = '') => `<div class="cp-mensagens-compra ${extra}"><div class="mensagens-texto">${corpo}</div><div class="mensagens-data"><small>${data}</small></div></div>`;
const FIXTURE = readFileSync(new URL('./fixtures/comprasgov-item-19302805900082025-1.html', import.meta.url), 'latin1');

// Monta a lista de mensagens a partir de HTML simples (<div class=cp-mensagens-compra><div class=mensagens-texto>..)
function lista(html) {
  const raiz = new No('root');
  for (const m of html.matchAll(/<div class="cp-mensagens-compra ?([^"]*)"><div class="mensagens-texto">([\s\S]*?)<\/div><div class="mensagens-data"><small>([^<]*)<\/small>/g)) {
    const caixa = raiz.add(new No(`cp-mensagens-compra ${m[1]}`));
    caixa.add(new No('mensagens-texto', m[2]));
    caixa.add(new No('mensagens-data')).add(new No('', m[3]));
  }
  return raiz;
}

function cenario({ href = URL_OK, html = '', agora = HOJE } = {}) {
  const corpo = lista(html);
  const dom = { body: Object.assign(corpo, { innerText: '' }), hidden: false, ouvintes: {}, querySelectorAll: s => corpo.querySelectorAll(s),
    addEventListener(t, f) { this.ouvintes[t] = f; }, removeEventListener(t) { delete this.ouvintes[t]; } };
  const env = { enviadas: [], timers: [], intervalos: [], observadores: [], rede: [], agora };
  const proibido = nome => () => { env.rede.push(nome); throw new Error(`rede: ${nome}`); };
  const janela = { ouvintes: {} };
  Object.assign(janela, {
    URL, Set, RegExp, Promise, String, Math, Number, Array, Object, Infinity, Date: { now: () => env.agora, parse: Date.parse },
    location: { href }, document: dom,
    addEventListener: (t, f) => { janela.ouvintes[t] = f; }, removeEventListener: t => { delete janela.ouvintes[t]; },
    setTimeout: f => { env.timers.push(f); return env.timers.length; }, clearTimeout: () => {},
    setInterval: f => { env.intervalos.push(f); return 1; }, clearInterval: () => { env.intervalos.length = 0; },
    MutationObserver: class { constructor(f) { this.f = f; env.observadores.push(this); this.ativo = false; } observe() { this.ativo = true; } disconnect() { this.ativo = false; } },
    chrome: { runtime: { sendMessage: m => { env.enviadas.push(m); } } },
    fetch: proibido('fetch'), XMLHttpRequest: proibido('XMLHttpRequest'), WebSocket: proibido('WebSocket'), EventSource: proibido('EventSource'),
    navigator: { sendBeacon: proibido('sendBeacon') }, Image: proibido('Image'),
  });
  janela.globalThis = janela;
  const ctx = vm.createContext(janela);
  const rodar = (fn, entrada) => vm.runInContext(`(${fn})(${JSON.stringify(entrada ?? null)})`, ctx);
  const nova = (classe, texto, data) => { const c = corpo.add(new No(`cp-mensagens-compra ${classe}`)); c.add(new No('mensagens-texto', texto)); c.add(new No('mensagens-data')).add(new No('', data)); };
  // Simula a página: muda o DOM, o observer dispara, o debounce vence.
  const mutar = () => { env.observadores.at(-1).f(); env.timers.splice(0).forEach(f => f()); };
  return { janela, env, dom, rodar, nova, mutar, iniciar: e => rodar(vigiarChat, e), parar: () => rodar(pararChat) };
}
const mensagens = env => env.enviadas.filter(m => m.tipo === 'mensagens');
const HIST = msgHtml('Bom dia a todos.', '01/12/2026 09:00');

test('mensagens que já estavam na tela não alertam; nova mensagem do pregoeiro alerta com trecho e hora', () => {
  const c = cenario({ html: HIST });
  assert.deepEqual({ ...c.iniciar({ som: true }) }, { status: 'iniciado', jaNaTela: 1 });
  assert.equal(c.env.enviadas[0].tipo, 'iniciou');
  assert.equal(mensagens(c.env).length, 0);
  c.nova('', 'Senhores, estamos em negociação.', '01/12/2026 11:58');
  c.mutar();
  const [m] = mensagens(c.env);
  assert.equal(m.itens.length, 1);
  assert.deepEqual([m.itens[0].trecho, m.itens[0].hora, m.itens[0].importante, m.som], ['Senhores, estamos em negociação.', '11:58', false, true]);
});

test('destaques: convocação, anexo, prazo, recusa, desclassificação, inabilitação, diligência, habilitação, CNPJ e nome da empresa', () => {
  const c = cenario({ html: HIST });
  c.iniciar({ empresaCnpj: '33.442.649/0001-11', empresaNome: 'Max Distribuidora' });
  const casos = [
    ['Fornecedor convocado para enviar anexo. Prazo até 12:30.', ['convocação', 'anexo', 'prazo'], false],
    ['Proposta RECUSADA por divergência.', ['recusa'], false],
    ['Proposta desclassificada.', ['desclassificação'], false],
    ['Fornecedor inabilitado.', ['inabilitação'], false],
    ['Abertura de diligência ao item 2.', ['diligência'], false],
    ['Documentos de habilitação analisados.', ['habilitação'], false],
    ['Sr. fornecedor CNPJ 33442649000111, aguarde.', [], true],
    ['A empresa MAX DISTRIBUIDORA foi chamada.', [], true],
    ['Sr. fornecedor CNPJ 33.442.649/0001-99, aguarde.', [], false],
  ];
  casos.forEach(([t], i) => c.nova('', t, `01/12/2026 11:${40 + i}`));
  c.mutar();
  const itens = JSON.parse(JSON.stringify(mensagens(c.env).flatMap(m => m.itens)));
  assert.equal(itens.length, casos.length);
  casos.forEach(([, motivos, cita], i) => {
    assert.deepEqual(itens[i].motivos, motivos, itens[i].trecho);
    assert.equal(itens[i].citaEmpresa, cita, itens[i].trecho);
    assert.equal(itens[i].importante, cita || motivos.length > 0, itens[i].trecho);
  });
  assert.deepEqual(itens[0].motivos.includes('habilitação'), false); // "inabilitação" não conta como habilitação
});

test('não duplica: mesma mensagem em várias mutações, e histórico antigo aberto depois não alerta', () => {
  const c = cenario({ html: HIST });
  c.iniciar({});
  c.nova('', 'Prazo encerrado.', '01/12/2026 11:59');
  c.mutar(); c.mutar(); c.mutar();
  assert.equal(mensagens(c.env).flatMap(m => m.itens).length, 1);
  c.nova('', 'Chat aberto agora: mensagem de ontem.', '30/11/2026 10:00'); // usuário abriu um chat antigo
  c.nova('fornecedor', 'Obrigado, pregoeiro.', '01/12/2026 12:00'); // não é do pregoeiro
  c.mutar();
  assert.equal(mensagens(c.env).flatMap(m => m.itens).length, 1);
});

test('reiniciar na mesma compra preserva o que já foi visto; CPF é mascarado no trecho', () => {
  const c = cenario({ html: HIST });
  c.iniciar({});
  c.nova('', 'Participante CPF 123.456.789-09 recusado.', '01/12/2026 11:59');
  c.mutar();
  assert.doesNotMatch(JSON.stringify(c.env.enviadas), /123\.456\.789-09/);
  c.iniciar({}); // novo clique em "Acompanhar"
  assert.equal(c.env.observadores.filter(o => o.ativo).length, 1);
  c.mutar();
  assert.equal(mensagens(c.env).length, 1);
});

test('para ao sair da página, ao ser recarregada e ao encerrar a sessão; avisa o motivo e solta tudo', () => {
  const cenarios = [
    ['saiu', c => { c.janela.location.href = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/home'; c.env.intervalos[0](); }],
    ['saiu', c => { c.janela.location.href = `${BASE}?compra=19302805900082026`; c.env.intervalos[0](); }],
    ['recarregou', c => c.janela.ouvintes.pagehide()],
    ['sessao', c => { c.dom.body.innerText = 'Sua sessão expirou. Entre novamente.'; c.env.intervalos[0](); }],
  ];
  for (const [motivo, agir] of cenarios) {
    const c = cenario({ html: HIST });
    c.iniciar({});
    agir(c);
    assert.deepEqual({ ...c.env.enviadas.at(-1) }, { tipo: 'parou', motivo, compra: 'p:19302805900082025', som: false, gravar: false });
    assert.equal(c.env.observadores[0].ativo, false);
    c.nova('', 'Mensagem depois de parar', '01/12/2026 11:59');
    c.env.observadores[0].f(); c.env.timers.splice(0).forEach(f => f());
    assert.equal(mensagens(c.env).length, 0);
    assert.equal('__lpAcompanhar' in c.janela, false);
  }
  const c = cenario({ html: HIST });
  c.iniciar({});
  c.janela.location.href = `${BASE}/item/2?compra=19302805900082025`; // outro item da mesma compra: continua
  c.env.intervalos[0]();
  assert.equal(c.env.enviadas.some(m => m.tipo === 'parou'), false);
  assert.deepEqual({ ...c.parar() }, { status: 'parado' });
  assert.equal(c.env.enviadas.at(-1).motivo, 'voce');
  assert.deepEqual({ ...c.parar() }, { status: 'nao_estava' });
});

test('páginas fora do portal ou da compra não iniciam', () => {
  for (const href of ['https://example.test/', 'http://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=19302805900082025',
    `${BASE}`, `${BASE}?compra=1`, 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/login?compra=19302805900082025']) {
    const c = cenario({ href });
    assert.deepEqual({ ...c.iniciar({}) }, { status: 'pagina_nao_suportada' }, href);
    assert.equal(c.env.enviadas.length, 0);
  }
  assert.equal(cenario({ href: 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/cadastro-propostas?compra=19302805900082025' }).iniciar({}).status, 'iniciado');
});

test('fixture real do chat: lê as mensagens da página sem alertar e uma nova depois alerta', () => {
  const raiz = new No('root');
  for (const m of FIXTURE.matchAll(/<div class="mensagens-texto">([\s\S]*?)<\/div><div class="mensagens-data"><small>([^<]*)<\/small>/g)) {
    const caixa = raiz.add(new No('cp-mensagens-compra'));
    caixa.add(new No('mensagens-texto', m[1]));
    caixa.add(new No('mensagens-data')).add(new No('', m[2]));
  }
  assert.equal(raiz.querySelectorAll('.mensagens-texto').length, 4);
  const c = cenario();
  c.dom.querySelectorAll = s => [...raiz.querySelectorAll(s), ...c.dom.body.querySelectorAll(s)];
  assert.equal(c.iniciar({ empresaCnpj: '33442649000111' }).jaNaTela, 4);
  assert.equal(mensagens(c.env).length, 0);
});

test('o script injetado não faz rede, não navega, não clica e não recarrega', () => {
  const fonte = `${vigiarChat}`;
  for (const proibido of [/\bfetch\b/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /EventSource/, /\.click\(/, /\.submit\(/, /location\.(assign|replace|reload)/, /location\.href\s*=[^=]/, /history\.(push|replace)State/, /window\.open/, /iframe|hcaptcha/i]) {
    assert.doesNotMatch(fonte, proibido);
  }
  // Execução completa com fetch/XHR/WebSocket/beacon/Image armadilhados: nenhum é tocado.
  const c = cenario({ html: HIST });
  c.iniciar({ som: true, gravar: true });
  c.nova('', 'Convocação com prazo.', '01/12/2026 11:59');
  c.mutar();
  c.env.intervalos[0]();
  c.janela.ouvintes.pagehide();
  assert.deepEqual(c.env.rede, []);
  assert.equal(c.janela.location.href, URL_OK);
});

test('aba oculta conta mensagens não lidas e voltar à aba zera', () => {
  const c = cenario({ html: HIST });
  c.iniciar({});
  c.dom.hidden = true;
  c.nova('', 'Primeira.', '01/12/2026 11:58'); c.mutar();
  c.nova('', 'Segunda.', '01/12/2026 11:59'); c.mutar();
  assert.equal(mensagens(c.env).at(-1).naoLidas, 2);
  c.dom.hidden = false; c.dom.ouvintes.visibilitychange();
  assert.equal(c.env.enviadas.at(-1).tipo, 'visto');
});

// ---- worker ----
function chromeFalso({ abas = [], leitura = { status: 'ok', compra: 'x', itens: [], pendentes: [] }, envio = { ok: true } } = {}) {
  const r = { notificacoes: [], badges: [], exec: [], ouvintes: {}, cliqueAbas: [] };
  r.chrome = {
    runtime: { id: 'ext', getManifest: () => ({ optional_host_permissions: ['https://licitaplena.com.br/*'] }), onMessage: { addListener: f => { r.ouvintes.msg = f; } } },
    action: { setBadgeText: o => r.badges.push(o), setBadgeBackgroundColor: () => {} },
    notifications: { create: (id, o) => r.notificacoes.push({ id, ...o }), clear: () => {}, onClicked: { addListener: f => { r.ouvintes.clique = f; } } },
    tabs: { query: async () => abas, update: async (id, p) => { r.cliqueAbas.push([id, p]); return { windowId: 9 }; } },
    windows: { update: async () => {} },
    scripting: { executeScript: async o => { r.exec.push(o.func.name); return [{ result: o.func.name === 'lerPaginaPregao' ? leitura : envio }]; } },
  };
  return r;
}
const rem = { id: 'ext', tab: { id: 7 } };

test('worker: notificação destacada com trecho/hora, badge, som opcional e sem gravar por padrão', async () => {
  const r = chromeFalso(); criarWorkerAcompanhar(r.chrome);
  const itens = [{ trecho: 'Convocação para anexo', hora: '11:59', motivos: ['convocação', 'anexo'], citaEmpresa: true, importante: true }];
  r.ouvintes.msg({ tipo: 'mensagens', itens, naoLidas: 1, som: true, gravar: false }, rem);
  const n = r.notificacoes[0];
  assert.match(n.title, /IMPORTANTE.*cita sua empresa.*convocação/);
  assert.equal(n.message, '11:59 — Convocação para anexo');
  assert.deepEqual([n.silent, n.requireInteraction], [false, true]);
  assert.deepEqual(r.badges.at(-1), { tabId: 7, text: '1' });
  await Promise.resolve();
  assert.deepEqual(r.exec, []);
  r.ouvintes.msg({ tipo: 'mensagens', itens: [{ trecho: 'Bom dia', hora: null, motivos: [], citaEmpresa: false, importante: false }], naoLidas: 0, som: false }, rem);
  assert.equal(r.notificacoes[1].silent, true);
  assert.equal(textoAlerta([{ trecho: 'a', hora: null, motivos: [], importante: false }, { trecho: 'b', hora: null, motivos: [], importante: false }]).contextMessage, '2 mensagens novas');
});

test('worker: "parei de acompanhar" avisa; parar pelo botão não; remetente estranho é ignorado', () => {
  const r = chromeFalso(); criarWorkerAcompanhar(r.chrome);
  r.ouvintes.msg({ tipo: 'parou', motivo: 'sessao' }, rem);
  assert.match(r.notificacoes[0].title, /Parei de acompanhar/);
  assert.match(r.notificacoes[0].message, /sessão/);
  r.ouvintes.msg({ tipo: 'parou', motivo: 'voce' }, rem);
  assert.equal(r.notificacoes.length, 1);
  r.ouvintes.msg({ tipo: 'parou', motivo: 'saiu' }, { id: 'outra-extensao', tab: { id: 7 } });
  r.ouvintes.msg({ tipo: 'parou', motivo: 'saiu' }, { id: 'ext' });
  assert.equal(r.notificacoes.length, 1);
});

test('worker: gravar só com consentimento, via leitor existente e aba do LicitaPlena; falha avisa uma vez', async () => {
  const r = chromeFalso({ abas: [{ id: 3 }] }); criarWorkerAcompanhar(r.chrome);
  const itens = [{ trecho: 'x', hora: null, motivos: [], importante: false }];
  r.ouvintes.msg({ tipo: 'mensagens', itens, gravar: true }, rem);
  await new Promise(res => setTimeout(res, 10));
  assert.deepEqual(r.exec, ['lerPaginaPregao', 'enviarNaPagina']);
  const sem = chromeFalso({ abas: [] }); criarWorkerAcompanhar(sem.chrome);
  sem.ouvintes.msg({ tipo: 'mensagens', itens, gravar: true }, rem);
  await new Promise(res => setTimeout(res, 10));
  assert.match(sem.notificacoes.at(-1).message, /Abra o LicitaPlena/);
  const pagina = chromeFalso({ leitura: { status: 'pagina_nao_suportada' } }); criarWorkerAcompanhar(pagina.chrome);
  pagina.ouvintes.msg({ tipo: 'mensagens', itens, gravar: true }, rem);
  await new Promise(res => setTimeout(res, 10));
  assert.match(pagina.notificacoes.at(-1).message, /sala de disputa/);
});

test('worker: clicar na notificação traz a aba de volta', async () => {
  const r = chromeFalso(); criarWorkerAcompanhar(r.chrome);
  await r.ouvintes.clique('lp-chat:7:123');
  assert.deepEqual(r.cliqueAbas, [[7, { active: true }]]);
  await r.ouvintes.clique('outra:7:1');
  assert.equal(r.cliqueAbas.length, 1);
});

test('manifesto de produção: permissões mínimas, sem <all_urls>, sem 127.0.0.1, sem content_scripts', () => {
  const m = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(m.permissions, ['activeTab', 'scripting', 'notifications', 'storage']);
  assert.doesNotMatch(JSON.stringify(m), /127\.0\.0\.1|<all_urls>|\*:\/\/\*/);
  assert.equal('content_scripts' in m, false);
  assert.equal('host_permissions' in m, false);
  assert.equal(m.background.service_worker, 'acompanhar-worker.mjs');
});

test('destaques novos: suspensão e aceite ("aceito", "aceita"); bipe só para mensagem importante com som ligado', () => {
  const c = cenario({ html: HIST });
  let bipes = 0;
  c.janela.AudioContext = class { constructor() { bipes++; this.currentTime = 0; this.destination = {}; } createOscillator() { return { frequency: {}, connect() {}, start() {}, stop() {} }; } createGain() { return { gain: {}, connect() {} }; } close() {} };
  c.iniciar({ som: true });
  c.nova('', 'Sessão suspensa até amanhã às 9h.', '01/12/2026 11:50');
  c.nova('', 'Proposta aceita para o item 3.', '01/12/2026 11:51');
  c.mutar();
  const itens = mensagens(c.env).flatMap(m => m.itens);
  assert.deepEqual(itens.map(i => [...i.motivos]), [['suspensão'], ['aceite']]);
  assert.equal(bipes, 1);
  c.nova('', 'Bom dia.', '01/12/2026 11:52'); c.mutar();
  assert.equal(bipes, 1, 'mensagem comum não bipa');
});

test('reconexão: com "desde", o que chegou durante a recarga alerta já na 1ª leitura; o resto não', () => {
  const html = HIST + msgHtml('Mensagem antes da queda.', '01/12/2026 11:40') + msgHtml('Convocação enviada durante a recarga.', '01/12/2026 11:58');
  const c = cenario({ html });
  const r = c.iniciar({ desde: Date.parse('2026-12-01T11:58:30-03:00') });
  assert.equal(r.jaNaTela, 3);
  const itens = mensagens(c.env).flatMap(m => m.itens);
  assert.deepEqual(itens.map(i => i.trecho), ['Convocação enviada durante a recarga.']);
  assert.deepEqual({ ...c.env.enviadas.find(m => m.tipo === 'iniciou') }, { tipo: 'iniciou', empresaCnpj: '', empresaNome: '', jaNaTela: 3, compra: 'p:19302805900082025', som: false, gravar: false });
});

function chromeComSessao(opcoes = {}) {
  const r = chromeFalso(opcoes);
  const guardado = {};
  r.guardado = guardado;
  r.permitido = opcoes.permitido ?? true;
  r.ouvintes.atualizada = null;
  r.ouvintes.removida = null;
  r.chrome.storage = { session: { get: async k => ({ [k]: guardado[k] }), set: async o => Object.assign(guardado, o), remove: async k => { delete guardado[k]; } } };
  r.chrome.permissions = { contains: async () => r.permitido };
  r.chrome.tabs.onUpdated = { addListener: f => { r.ouvintes.atualizada = f; } };
  r.chrome.tabs.onRemoved = { addListener: f => { r.ouvintes.removida = f; } };
  r.reinjecao = opcoes.reinjecao ?? { status: 'iniciado', jaNaTela: 2 };
  const exec = r.chrome.scripting.executeScript;
  r.chrome.scripting.executeScript = async o => (o.func.name === 'vigiarChat' ? (r.exec.push(['vigiarChat', o.args[0]]), [{ result: r.reinjecao }]) : exec(o));
  return r;
}
const esperar = () => new Promise(res => setTimeout(res, 5));

test('worker: aba recarregou -> espera carregar, injeta o vigia de novo com "desde" e não avisa "parei"', async () => {
  const r = chromeComSessao(); criarWorkerAcompanhar(r.chrome);
  r.ouvintes.msg({ tipo: 'iniciou', compra: 'p:x', som: true, gravar: false, empresaCnpj: '33442649000111', empresaNome: 'Max', jaNaTela: 2 }, rem);
  await esperar();
  r.ouvintes.msg({ tipo: 'parou', motivo: 'recarregou', som: true }, rem);
  await esperar();
  assert.equal(r.notificacoes.length, 0);
  assert.equal(r.badges.at(-1).text, '…');
  r.ouvintes.atualizada(7, { status: 'loading' }); await esperar();
  assert.equal(r.exec.length, 0);
  r.ouvintes.atualizada(7, { status: 'complete' }); await esperar();
  const [[nome, entrada]] = r.exec;
  assert.equal(nome, 'vigiarChat');
  assert.deepEqual([entrada.empresaCnpj, entrada.som, typeof entrada.desde], ['33442649000111', true, 'number']);
  r.ouvintes.msg({ tipo: 'iniciou', compra: 'p:x', som: true, jaNaTela: 2 }, rem); await esperar();
  assert.equal(r.notificacoes.length, 0);
  r.ouvintes.atualizada(7, { status: 'complete' }); await esperar();
  assert.equal(r.exec.length, 1, 'carregamento sem recarga pendente não reinjeta');
});

test('worker: reconexão que volta sem chat na tela avisa para reabrir; página que não é mais o pregão avisa "parei"', async () => {
  const r = chromeComSessao(); criarWorkerAcompanhar(r.chrome);
  r.ouvintes.msg({ tipo: 'iniciou', compra: 'p:x', jaNaTela: 2 }, rem); await esperar();
  r.ouvintes.msg({ tipo: 'parou', motivo: 'recarregou' }, rem); await esperar();
  r.ouvintes.atualizada(7, { status: 'complete' }); await esperar();
  r.ouvintes.msg({ tipo: 'iniciou', compra: 'p:x', jaNaTela: 0 }, rem); await esperar();
  assert.match(r.notificacoes.at(-1).title, /não vejo o chat/);

  const s = chromeComSessao({ reinjecao: { status: 'pagina_nao_suportada' } }); criarWorkerAcompanhar(s.chrome);
  s.ouvintes.msg({ tipo: 'iniciou', compra: 'p:x', jaNaTela: 2 }, rem); await esperar();
  s.ouvintes.msg({ tipo: 'parou', motivo: 'recarregou' }, rem); await esperar();
  s.ouvintes.atualizada(7, { status: 'complete' }); await esperar();
  assert.match(s.notificacoes.at(-1).title, /Parei de acompanhar/);
  assert.deepEqual(s.guardado, {});
});

test('worker: sem permissão do portal, ou recargas demais em 10 min, avisa "parei" na hora; fechar a aba avisa e limpa', async () => {
  const sem = chromeComSessao({ permitido: false }); criarWorkerAcompanhar(sem.chrome);
  sem.ouvintes.msg({ tipo: 'iniciou', compra: 'p:x', jaNaTela: 1 }, rem); await esperar();
  sem.ouvintes.msg({ tipo: 'parou', motivo: 'recarregou' }, rem); await esperar();
  assert.match(sem.notificacoes.at(-1).message, /não consegui voltar/);

  const loop = chromeComSessao(); criarWorkerAcompanhar(loop.chrome);
  loop.ouvintes.msg({ tipo: 'iniciou', compra: 'p:x', jaNaTela: 1 }, rem); await esperar();
  for (let i = 0; i < 5; i++) {
    loop.ouvintes.msg({ tipo: 'parou', motivo: 'recarregou' }, rem); await esperar();
    loop.ouvintes.atualizada(7, { status: 'complete' }); await esperar();
    loop.ouvintes.msg({ tipo: 'iniciou', compra: 'p:x', jaNaTela: 1 }, rem); await esperar();
  }
  assert.equal(loop.notificacoes.length, 0);
  loop.ouvintes.msg({ tipo: 'parou', motivo: 'recarregou' }, rem); await esperar();
  assert.match(loop.notificacoes.at(-1).title, /Parei de acompanhar/);

  const fechou = chromeComSessao(); criarWorkerAcompanhar(fechou.chrome);
  fechou.ouvintes.msg({ tipo: 'iniciou', compra: 'p:x', jaNaTela: 1 }, rem); await esperar();
  fechou.ouvintes.msg({ tipo: 'parou', motivo: 'recarregou' }, rem); await esperar();
  fechou.ouvintes.removida(7); await esperar();
  assert.match(fechou.notificacoes.at(-1).message, /fechada/);
  assert.deepEqual(fechou.guardado, {});
});

test('reconexão com "chave" só retoma na mesma compra', () => {
  const c = cenario({ html: HIST });
  assert.equal(c.iniciar({ chave: 'p:19302805900082026' }).status, 'pagina_nao_suportada');
  assert.equal(c.iniciar({ chave: 'p:19302805900082025' }).status, 'iniciado');
});
