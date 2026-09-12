const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'painel.html'), 'utf8');
const trecho = (inicio, fim) => html.slice(html.indexOf(inicio), html.indexOf(fim, html.indexOf(inicio)));
function ambiente(respostas) {
  const elementos = new Map();
  const mensagens = [];
  const timers = new Map();
  const requisicoes = [];
  const cache = new Map();
  let sequencia = 0;
  const elemento = () => ({ disabled: false, children: [], remove() { this.removido = true; }, appendChild(child) { this.children.push(child); }, addEventListener(evento, acao) { this[evento] = acao; }, classList: { remove() {} } });
  const contexto = vm.createContext({
    AbortController, Date, console,
    document: { getElementById(id) { if (!elementos.has(id)) elementos.set(id, elemento()); return elementos.get(id); }, createElement: elemento },
    localStorage: { getItem: (key) => cache.get(key), setItem: (key, value) => cache.set(key, value), removeItem: (key) => cache.delete(key) },
    idOportunidade: (e) => e.id,
    obterTokenSessao: async () => 'token',
    fetch: async (_, opcoes) => { requisicoes.push(opcoes); return respostas.shift()(opcoes); },
    escreverMensagemIA: (texto) => { const el = elemento(); el.textContent = texto; mensagens.push(el); return el; },
    renderizarEstruturaIA: (estrutura) => { contexto.resultado = estrutura; },
    setTimeout: (fn, ms) => { const id = ++sequencia; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  vm.runInContext(trecho('  let iaEditalAtual = null;', '  function escreverMensagemIA(') + trecho('  function bloquearAcoesResumo(', '  async function carregarItensDoResumoIA('), contexto);
  const abrir = (id) => vm.runInContext(`cancelarConsultaResumo(); iaEditalAtual = {id: '${id}'}; bloquearAcoesResumo(true);`, contexto);
  return { contexto, abrir, elementos, mensagens, timers, requisicoes, cache, estado: () => vm.runInContext('({iaCarregando,iaResumoPendente,iaHistorico})', contexto) };
}
const pendente = () => ({ ok: true, status: 202, json: async () => ({ emProcessamento: true, progresso: { concluidas: 1, total: 4, aguardarSegundos: 3 }, resposta: 'Analisando', estrutura: null }) });
const final = () => ({ ok: true, status: 200, json: async () => ({ fonteLida: true, estrutura: { documentosHabilitacao: ['CNPJ'] }, resposta: 'Completo' }) });
const drenar = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
test('resumo pendente bloqueia ações, mostra progresso e consulta novamente até resultado final', async () => {
  const a = ambiente([pendente, final]); a.abrir('A');
  await a.contexto.chamarIA('resumo', null);
  assert.equal(a.estado().iaResumoPendente, true);
  for (const id of ['modal-ia-checklist-email','modal-ia-checklist-doc','modal-ia-imprimir','modal-ia-pergunta','modal-ia-enviar']) assert.equal(a.elementos.get(id).disabled, true);
  assert.match(a.mensagens[0].textContent, /etapa 2 de 4/);
  assert.equal(a.cache.size, 0);
  await a.contexto.chamarIA('pergunta', 'teste'); assert.equal(a.requisicoes.length, 1);
  const timer = [...a.timers.values()][0]; assert.equal(timer.ms, 3000); timer.fn(); await drenar();
  assert.equal(a.requisicoes.length, 2); assert.equal(a.estado().iaResumoPendente, false); assert.equal(a.cache.size, 1);
});
test('fechar o resumo cancela a consulta agendada sem cancelar o trabalho persistido', async () => {
  const a = ambiente([pendente]); a.abrir('A'); await a.contexto.chamarIA('resumo', null);
  const timer = [...a.timers.values()][0]; a.contexto.fecharModalIA();
  assert.equal(a.timers.size, 0); timer.fn(); await drenar(); assert.equal(a.requisicoes.length, 1);
});
test('resposta antiga fora de ordem não altera outro edital nem seu estado de carregamento', async () => {
  let resolverA; let resolverB;
  const a = ambiente([() => new Promise((r) => { resolverA = r; }), () => new Promise((r) => { resolverB = r; })]);
  a.abrir('A'); const primeira = a.contexto.chamarIA('resumo', null); await drenar();
  a.abrir('B'); const segunda = a.contexto.chamarIA('resumo', null); await drenar();
  assert.equal(a.requisicoes[0].signal.aborted, true);
  resolverA(final()); await primeira;
  assert.equal(a.cache.size, 0); assert.equal(a.contexto.resultado, undefined); assert.equal(a.estado().iaCarregando, true);
  resolverB(final()); await segunda;
  assert.equal(a.cache.size, 1); assert.ok([...a.cache.keys()][0].endsWith(':B'));
});
test('502 exige tentativa explícita e não entra em loop de consultas', async () => {
  const a = ambiente([() => ({ ok: false, status: 502, json: async () => ({ erro: 'Tente novamente' }) }), pendente]);
  a.abrir('A'); await a.contexto.chamarIA('resumo', null);
  assert.equal(a.timers.size, 0); assert.equal(a.estado().iaResumoPendente, true);
  const botao = a.mensagens.at(-1).children[0]; assert.equal(botao.textContent, 'Tentar novamente');
  botao.click(); await drenar();
  assert.equal(JSON.parse(a.requisicoes[1].body).retomarAnalise, true);
});
test('cache local rejeita resultados em processamento e degradados', () => {
  const a = ambiente([]);
  for (const dados of [{emProcessamento:true,resposta:'Parcial'}, {modoDegradado:true,resposta:'Ficha'}]) a.contexto.salvarCacheLocalResumo({id:'A'},dados);
  assert.equal(a.cache.size, 0);
});

test('cada etapa consulta a sessão atual e usa o token renovado sem capturar o anterior', async () => {
  const a = ambiente([pendente, final]);
  const sessoes = [{ access_token: 'token-anterior' }, { access_token: 'token-renovado' }];
  let consultas = 0;
  a.contexto.window = { __sbClient: { auth: { getSession: async () => ({ data: { session: sessoes[consultas++] } }) } } };
  vm.runInContext(trecho('  async function obterTokenSessao()', '  function bloquearAcoesResumo('), a.contexto);
  a.abrir('A');
  await a.contexto.chamarIA('resumo', null);
  const timer = [...a.timers.values()][0]; timer.fn(); await drenar();
  assert.equal(consultas, 2);
  assert.equal(a.requisicoes[0].headers.Authorization, 'Bearer token-anterior');
  assert.equal(a.requisicoes[1].headers.Authorization, 'Bearer token-renovado');
});

test('sessão ausente e401 interrompem consultas automáticas e mostram erro', async () => {
  const a = ambiente([() => ({ ok: false, status: 401, json: async () => ({ erro: 'Sessão expirada. Faça login novamente.' }) })]);
  a.contexto.window = { __sbClient: { auth: { getSession: async () => ({ data: { session: null } }) } } };
  vm.runInContext(trecho('  async function obterTokenSessao()', '  function bloquearAcoesResumo('), a.contexto);
  a.abrir('A'); await a.contexto.chamarIA('resumo', null);
  assert.equal(a.requisicoes.length, 1);
  assert.equal(a.timers.size, 0);
  assert.equal(a.estado().iaCarregando, false);
  assert.match(a.mensagens.at(-1).textContent, /Sessão expirada/);
});
