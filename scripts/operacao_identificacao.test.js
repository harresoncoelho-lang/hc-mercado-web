const test = require('node:test');
const assert = require('node:assert/strict');
const { renderizar } = require('../empresa-identificacao-ui');
const { montar, empresaDoLink, retornoAoProcesso } = require('../operacao-identificacao');
const { setImmediate: concluir } = require('node:timers/promises');

function ambiente(contexto = {}) {
  const doc = { createElement(tag) { return { tag, children: [], value: '', checked: false, disabled: false, files: [], append(...nos) { this.children.push(...nos); }, replaceChildren(...nos) { this.children = nos; }, setAttribute(k, v) { this[k] = v; } }; } };
  const host = doc.createElement('div'); host.ownerDocument = doc;
  const buscar = (predicado, e = host) => predicado(e) ? e : e.children.map(filho => buscar(predicado, filho)).find(Boolean);
  const empresa = { id: 'empresaA', razao_social: 'Empresa fictícia', cnpj: '00000000000100' };
  const ui = renderizar(host, { empresaId: empresa.id, solicitar: async () => ({ empresa, perfil: null, documentos: [] }), ...contexto });
  return { host, ui, buscar };
}

test('cadastro independente abre os campos sem ação ou mensagens de minuta', async () => {
  const a = ambiente({ semMinuta: true, aberto: true });
  await a.ui.carregar();
  assert.equal(a.buscar(e => e.tag === 'details').open, true);
  assert.equal(a.buscar(e => /minuta/i.test(e.textContent || '')), undefined);
  assert.equal(a.buscar(e => e.id === 'empresa-identificacao-cnpj').value, '00000000000100');
  assert.equal(a.buscar(e => e.textContent === 'Salvar identificação confirmada').disabled, true);
});

test('cadastro independente confirma apenas após conferência e informa uso em documentos', async () => {
  const pedidos = [];
  const empresa = { id: 'empresaA', razao_social: 'Empresa fictícia', cnpj: '00000000000100' };
  const a = ambiente({ semMinuta: true, solicitar: async p => {
    pedidos.push(p);
    return { empresa, perfil: p.acao === 'confirmar' ? { status: 'confirmado', dados: p.dados } : null, documentos: [] };
  } });
  await a.ui.carregar();
  for (const campo of ['endereco', 'representante', 'cargo']) { const input = a.buscar(e => e.id === `empresa-identificacao-${campo}`); input.value = 'Dado fictício'; input.oninput(); }
  const salvar = a.buscar(e => e.textContent === 'Salvar identificação confirmada');
  assert.equal(salvar.disabled, true);
  const revisao = a.buscar(e => e.id === 'empresa-identificacao-revisao'); revisao.checked = true; revisao.onchange();
  assert.equal(salvar.disabled, false); await salvar.onclick();
  assert.equal(pedidos.at(-1).acao, 'confirmar');
  assert.equal(a.buscar(e => /minuta/i.test(e.textContent || '')), undefined);
  assert.match(a.buscar(e => e.role === 'status').textContent, /documento/i);
});

test('navegação só escolhe empresa autorizada e retorno sempre usa a rota local fixa', () => {
  const empresas = [{ id: 'empresaA' }];
  assert.equal(empresaDoLink('', empresas), undefined);
  assert.equal(empresaDoLink('?empresa=empresaA', empresas), 'empresaA');
  assert.equal(empresaDoLink('?empresa=empresaB', empresas), null);
  assert.equal(empresaDoLink('?empresa=', empresas), null);
  assert.equal(retornoAoProcesso('?empresa=empresaA&processo=//site.invalid', 'empresaA'), null);
  assert.equal(retornoAoProcesso('?empresa=empresaB&processo=00000011-1111-4111-8111-111111111111', 'empresaA'), null);
  assert.equal(retornoAoProcesso('?empresa=empresaA&processo=00000011-1111-4111-8111-111111111111&retorno=https://site.invalid', 'empresaA'), 'processos.html?empresa=empresaA&processo=00000011-1111-4111-8111-111111111111');
});

const resposta = (id, razao = id) => ({ ok: true, json: async () => ({ empresa: { id, razao_social: razao, cnpj: '00000000000100' }, documentos: [], perfil: null }) });
test('controlador não reaplica consulta antiga ao voltar A → B → A', async () => {
  const a = ambiente(), pedidos = []; let liberar;
  const controlador = montar({ alvo: a.host, obterSessao: async () => ({ userId: 'u1', accessToken: 'token-ficticio' }), requisitar: async (url, op) => {
    assert.equal(url, '/api/empresa-identificacao'); assert.equal(op.headers.Authorization, 'Bearer token-ficticio');
    const pedido = JSON.parse(op.body); pedidos.push(pedido);
    if (pedidos.length === 1) return new Promise(resolve => { liberar = resolve; });
    return resposta(pedido.empresaId);
  } });
  controlador.abrir('empresaA', 'u1'); await concluir();
  controlador.abrir('empresaB', 'u1'); await concluir();
  controlador.abrir('empresaA', 'u1'); await concluir();
  liberar(resposta('empresaA', 'Dados antigos')); await concluir();
  assert.equal(a.buscar(e => e.id === 'empresa-identificacao-razao').value, 'empresaA');
  assert.deepEqual(pedidos.map(p => p.empresaId), ['empresaA', 'empresaB', 'empresaA']);
});

test('controlador revalida sessão depois do corpo e elimina dados de sessão anterior', async () => {
  const a = ambiente(); let liberar, sessao = { userId: 'u1', accessToken: 'token-ficticio' };
  const controlador = montar({ alvo: a.host, obterSessao: async () => sessao, requisitar: async () => ({ ok: true, json: () => new Promise(resolve => { liberar = resolve; }) }) });
  controlador.abrir('empresaA', 'u1'); await concluir();
  sessao = { userId: 'u2', accessToken: 'outro-ficticio' };
  liberar(await resposta('empresaA').json()); await concluir();
  assert.equal(a.buscar(e => e.id === 'empresa-identificacao-razao'), undefined);
  assert.match(a.buscar(e => e.role === 'status').textContent, /sessão mudou/i);
});

test('invalidar contexto enquanto consulta sessão impede o envio posterior', async () => {
  const a = ambiente(); let liberar, pedidos = 0;
  const controlador = montar({ alvo: a.host, obterSessao: () => new Promise(resolve => { liberar = resolve; }), requisitar: async () => { pedidos++; return resposta('empresaA'); } });
  controlador.abrir('empresaA', 'u1'); controlador.limpar('Sua sessão mudou.');
  liberar({ userId: 'u1', accessToken: 'token-ficticio' }); await concluir();
  assert.equal(pedidos, 0); assert.equal(a.buscar(e => e.id === 'empresa-identificacao-razao'), undefined);
});

// Quadro único "Dados da empresa": a identificação vira a 1ª seção e repassa o endereço confirmado ao perfil (UF da sede).
test('quadro único: seção nomeada e endereço confirmado chega ao perfil na carga e ao confirmar', async () => {
  const a = ambiente(), recebidos = [];
  const empresa = { id: 'empresaA', razao_social: 'Empresa fictícia', cnpj: '00000000000100' };
  const confirmado = { status: 'confirmado', dados: { endereco: 'Rua Fictícia, 1 — Manaus/AM', representante: 'Pessoa', cargo: 'Sócia' } };
  const controlador = montar({ alvo: a.host, titulo: 'Identificação e representante', aoAtualizar: r => recebidos.push(r.perfil?.dados?.endereco ?? null),
    obterSessao: async () => ({ userId: 'u1', accessToken: 'token-ficticio' }),
    requisitar: async (_url, op) => { const p = JSON.parse(op.body); return { ok: true, json: async () => ({ empresa, documentos: [], perfil: p.acao === 'confirmar' ? { status: 'confirmado', dados: p.dados } : confirmado }) }; } });
  controlador.abrir('empresaA', 'u1'); await concluir(); await concluir();
  assert.equal(a.buscar(e => e.tag === 'summary').textContent, 'Identificação e representante');
  assert.deepEqual(recebidos, ['Rua Fictícia, 1 — Manaus/AM']);
  const endereco = a.buscar(e => e.id === 'empresa-identificacao-endereco'); endereco.value = 'Av. Fictícia, 2, Belém - PA'; endereco.oninput();
  const revisao = a.buscar(e => e.id === 'empresa-identificacao-revisao'); revisao.checked = true; revisao.onchange();
  await a.buscar(e => e.textContent === 'Salvar identificação confirmada').onclick(); await concluir();
  assert.equal(recebidos.at(-1), 'Av. Fictícia, 2, Belém - PA');
});

test('sem título a identificação mantém o nome antigo (painel e processos usam o mesmo componente)', () => {
  const a = ambiente();
  assert.equal(a.buscar(e => e.tag === 'summary').textContent, 'Dados da empresa');
});
