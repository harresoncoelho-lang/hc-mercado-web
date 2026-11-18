// Cadastro e edição de itens do processo por CNPJ, pelo handler real do kit (kit-documentos.js) e _itens_processo.js.
// Substituídos apenas: _auth (usuário pelo token), contexto de identificação (REST fictício com filtros) e fetch
// do PostgREST de operacao_itens_resultado (com a regra de membership da RLS). Nenhum dado real.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

process.env.IDENTIFICACAO_EMPRESA_LOCAL = '1';
const FN = path.resolve(__dirname, '..', '..', '..', 'netlify', 'functions');
const AUTH = path.join(FN, '_auth.js');
const CTX = path.join(FN, '_empresa_identificacao_contexto.js');
const KIT = path.join(FN, 'kit-documentos.js');

const USU_A = '258eddfe-d761-4ec9-ae63-ee5e5b8db408', USU_B = '358eddfe-d761-4ec9-ae63-ee5e5b8db409';
const ORG_A = 'a1000000-0000-4000-8000-000000000001', ORG_B = 'b1000000-0000-4000-8000-000000000001';
const EMP_A = 'a1000000-0000-4000-8000-000000000002', EMP_B = 'b1000000-0000-4000-8000-000000000002';
const PROC_A = 'a1000000-0000-4000-8000-000000000003', PROC_A2 = 'a1000000-0000-4000-8000-000000000004';
const PROC_B = 'b1000000-0000-4000-8000-000000000003';
const TOKEN = { 'Bearer TOKEN-A': USU_A, 'Bearer TOKEN-B': USU_B };

function banco() {
  return {
    empresas: [{ id: EMP_A, organizacao_id: ORG_A, razao_social: 'EMPRESA FICTÍCIA A', cnpj: '11222333000181', ativo: true },
      { id: EMP_B, organizacao_id: ORG_B, razao_social: 'EMPRESA FICTÍCIA B', cnpj: '11222333000262', ativo: true }],
    membros: [{ usuario_id: USU_A, organizacao_id: ORG_A, empresa_id: null, papel: 'gestor' },
      { usuario_id: USU_B, organizacao_id: ORG_B, empresa_id: null, papel: 'gestor' }],
    processos: [{ id: PROC_A, empresa_id: EMP_A, organizacao_id: ORG_A, numero: 'PE-FICT-A-1', orgao: 'Órgão fictício', documentos_exigidos: [] },
      { id: PROC_A2, empresa_id: EMP_A, organizacao_id: ORG_A, numero: 'PE-FICT-A-2', orgao: 'Órgão fictício', documentos_exigidos: [] },
      { id: PROC_B, empresa_id: EMP_B, organizacao_id: ORG_B, numero: 'PE-FICT-B-1', orgao: 'Órgão fictício', documentos_exigidos: [] }],
    itens: [],
    chamadas: [],       // registro de cada escrita que chegou ao "banco"
    falharProxima: 0,   // falhas transitórias (503) simuladas antes de gravar
  };
}

// Filtros mínimos do PostgREST: eq.X, in.(...) e select/order/limit ignorados.
function filtrar(linhas, sp) {
  let r = linhas;
  for (const [k, v] of sp) {
    if (k === 'select' || k === 'order' || k === 'limit') continue;
    if (v.startsWith('eq.')) { const x = decodeURIComponent(v.slice(3)); r = r.filter(l => String(l[k]) === x); }
  }
  return r;
}

let B;
function instalar(b) {
  B = b;
  delete require.cache[KIT];
  require.cache[AUTH] = { id: AUTH, filename: AUTH, loaded: true, children: [], paths: [], exports: {
    cabecalhosPadrao: () => ({}),
    exigirUsuarioLogado: async (event) => {
      const u = TOKEN[(event.headers && event.headers.authorization) || ''];
      return u ? { ok: true, userId: u } : { ok: false, status: 401, erro: 'Sessão inválida.' };
    },
  } };
  // Contexto de identificação: mesmas leituras que o kit faz (empresa, membros, processo). Filtros reais por querystring.
  require.cache[CTX] = { id: CTX, filename: CTX, loaded: true, children: [], paths: [], exports: {
    carregarContextoIdentificacao: async (event, userId, empresaId) => {
      const rest = async (p) => {
        const [tabela, qs] = p.split('?'); const sp = new URLSearchParams(qs || '');
        const base = { operacao_empresas: B.empresas, operacao_membros: B.membros, operacao_processos: B.processos }[tabela];
        if (!base) throw Object.assign(Error('tabela fictícia não prevista: ' + tabela), { status: 503 });
        return filtrar(base, [...sp].map(([k, v]) => [k, v]).map(([k, v]) => (k === 'usuario_id' ? ['usuario_id', v] : [k, v])));
      };
      const empresa = B.empresas.find(e => e.id === empresaId && e.ativo);
      if (!empresa) { const e = Object.assign(Error('Empresa indisponível.'), { status: 404 }); throw e; }
      return { empresa, rest, request: async () => { throw Object.assign(Error('não usado'), { status: 503 }); }, validarPerfil: async () => null, documento: () => null, baixar: async () => null, perfilPublico: () => null };
    },
  } };
  // PostgREST de operacao_itens_resultado com a regra de membership da RLS (gestor/operador, org do item).
  global.fetch = async (url, op = {}) => {
    const u = new URL(url), m = (op.method || 'GET').toUpperCase();
    const json = (corpo, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
    if (u.pathname !== '/rest/v1/operacao_itens_resultado') throw Error('destino não previsto: ' + u.pathname);
    const userId = TOKEN[(op.headers && op.headers.Authorization) || ''];
    const temAcesso = (org) => B.membros.some(x => x.usuario_id === userId && x.organizacao_id === org && ['gestor', 'operador'].includes(x.papel));
    if (m === 'GET') return json(filtrar(B.itens, u.searchParams));
    if (m === 'POST') {
      const corpo = JSON.parse(op.body);
      B.chamadas.push({ metodo: 'POST', corpo });
      if (!temAcesso(corpo.organizacao_id)) return json({ message: 'RLS' }, 403);
      if (B.falharProxima > 0) { B.falharProxima -= 1; return json({ message: 'transitório' }, 503); }
      if (B.itens.some(x => x.id === corpo.id)) return json({ message: 'pk' }, 409);
      if (B.itens.some(x => x.processo_id === corpo.processo_id && x.tipo === corpo.tipo && x.identificador === corpo.identificador)) return json({ message: 'unique' }, 409);
      const linha = { ...corpo, atualizado_em: new Date().toISOString() };
      B.itens.push(linha);
      if (B.perderResposta > 0) { B.perderResposta -= 1; throw Error('conexão perdida após gravar'); }
      return json([linha], 201);
    }
    if (m === 'PATCH') {
      const corpo = JSON.parse(op.body);
      B.chamadas.push({ metodo: 'PATCH', url: u.search, corpo });
      const alvo = filtrar(B.itens, u.searchParams);
      if (!alvo.length) return json([], 200);
      if (!temAcesso(alvo[0].organizacao_id)) return json({ message: 'RLS' }, 403);
      if (B.itens.some(x => x !== alvo[0] && x.processo_id === alvo[0].processo_id && x.tipo === alvo[0].tipo && x.identificador === corpo.identificador)) return json({ message: 'unique' }, 409);
      Object.assign(alvo[0], corpo);
      return json([alvo[0]], 200);
    }
    throw Error('método não previsto ' + m);
  };
}

const handler = () => { delete require.cache[KIT]; return require(KIT).criarHandler(); };
const evento = (body, token = 'Bearer TOKEN-A') => ({ httpMethod: 'POST', headers: { authorization: token }, body: JSON.stringify(body) });
const item = (extra = {}) => ({ id: randomUUID(), identificador: '1', descricao: 'Cabo fictício 2,5 mm', quantidade: '2.500', valorUnitario: '1.10', marca: 'Marca fictícia', modelo: 'Modelo fictício', ...extra });
const salvar = (body, token) => handler()(evento({ acao: 'salvarItem', empresaId: body.empresaId || EMP_A, processoId: body.processoId || PROC_A, modo: body.modo || 'criar', item: body.item }, token));
const base = (extra = {}) => ({ acao: 'salvarItem', empresaId: EMP_A, processoId: PROC_A, modo: 'criar', item: item(), ...extra });

test('criar item válido em CNPJ A: org e processo vêm do servidor e os valores voltam exatos', async () => {
  instalar(banco());
  const corpo = base();
  const r = await handler()(evento(corpo));
  assert.equal(r.statusCode, 201);
  const out = JSON.parse(r.body);
  assert.equal(out.item.id, corpo.item.id);
  assert.equal(out.item.quantidade, '2.500');
  assert.equal(out.item.valorUnitario, '1.10');
  assert.equal(B.itens.length, 1);
  assert.equal(B.itens[0].organizacao_id, ORG_A);
  assert.equal(B.itens[0].processo_id, PROC_A);
  assert.equal(B.itens[0].tipo, 'item');
});

test('valores e campos inválidos são recusados antes de qualquer escrita', async () => {
  const casos = [
    { quantidade: '-1' }, { quantidade: 'NaN' }, { quantidade: 'Infinity' }, { quantidade: '1e3' }, { quantidade: 2 },
    { quantidade: '0' }, { quantidade: '0.000' }, { quantidade: '1.2345' }, { quantidade: '.5' }, { quantidade: '1,50' },
    { quantidade: '1000000000000' }, { quantidade: '999999999999.999', valorUnitario: '999999999999.99' }, { valorUnitario: '-0.01' }, { valorUnitario: '0.00' }, { valorUnitario: '1.234' },
    { valorUnitario: 'NaN' }, { valorUnitario: '10000000000000' }, { valorUnitario: null }, { identificador: '' },
    { identificador: 'a\u0000b' }, { descricao: '   ' }, { marca: 'x'.repeat(501) }, { id: 'não-é-uuid' },
    { tipo: 'lote' }, { organizacao_id: ORG_B }, { processo_id: PROC_B }, { situacao: 'ganho' }, { valor_unitario_proposta: '0.01' },
  ];
  for (const caso of casos) {
    instalar(banco());
    const b = base({ item: { ...item(), ...caso } });
    const r = await handler()(evento(b));
    assert.equal(r.statusCode, 400, JSON.stringify(caso) + ' deveria ser 400, veio ' + r.statusCode + ' ' + r.body);
    assert.equal(B.itens.length, 0, 'nada gravado para ' + JSON.stringify(caso));
    assert.equal(B.chamadas.length, 0, 'nenhuma chamada de escrita para ' + JSON.stringify(caso));
  }
});

test('repetição com o mesmo id reaproveita sem nova gravação; mesmo id com outros dados é 409', async () => {
  instalar(banco());
  const corpo = base();
  assert.equal((await handler()(evento(corpo))).statusCode, 201);
  const repetida = await handler()(evento(corpo));
  assert.equal(repetida.statusCode, 200);
  assert.equal(JSON.parse(repetida.body).reaproveitado, true);
  assert.equal(B.itens.length, 1);
  const divergente = await handler()(evento({ ...corpo, item: { ...corpo.item, valorUnitario: '1.20' } }));
  assert.equal(divergente.statusCode, 409);
  assert.match(JSON.parse(divergente.body).erro, /outros dados/);
  assert.equal(B.itens[0].valor_unitario_proposta, '1.10', 'valor original preservado');
});

test('identificador repetido com outro id no mesmo processo é 409 e não sobrescreve o item existente', async () => {
  instalar(banco());
  assert.equal((await handler()(evento(base()))).statusCode, 201);
  const outro = await handler()(evento(base({ item: item({ identificador: '1' }) })));
  assert.equal(outro.statusCode, 409);
  assert.equal(B.itens.length, 1);
});

test('falha transitória não grava; repetição com o mesmo id conclui com uma única linha', async () => {
  instalar(banco());
  const corpo = base();
  B.falharProxima = 1;
  const primeira = await handler()(evento(corpo));
  assert.equal(primeira.statusCode, 503);
  assert.equal(B.itens.length, 0);
  const segunda = await handler()(evento(corpo));
  assert.equal(segunda.statusCode, 201);
  assert.equal(B.itens.length, 1);
});

test('edição altera valores do item do próprio processo; total derivado é exato', async () => {
  instalar(banco());
  const corpo = base();
  await handler()(evento(corpo));
  const editada = await salvar({ modo: 'editar', item: { ...corpo.item, quantidade: '3.000', valorUnitario: '0.50' } });
  assert.equal(editada.statusCode, 200);
  assert.equal(JSON.parse(editada.body).editado, true);
  assert.equal(B.itens[0].quantidade, '3.000');
  assert.equal(B.itens[0].valor_unitario_proposta, '0.50');
  assert.equal(B.itens[0].processo_id, PROC_A, 'processo não muda na edição');
  assert.equal(B.chamadas.filter(c => c.metodo === 'PATCH')[0].corpo.organizacao_id, undefined, 'organização não é regravada pelo cliente');
});

test('ID cruzado: editar item de outro processo da mesma empresa é 404 e nada muda', async () => {
  instalar(banco());
  const naoDoProcesso = base({ processoId: PROC_A2 });
  await handler()(evento(naoDoProcesso));
  const r = await salvar({ processoId: PROC_A, modo: 'editar', item: { ...naoDoProcesso.item, descricao: 'Tentativa de alteração' } });
  assert.equal(r.statusCode, 404);
  assert.equal(B.itens[0].descricao, 'Cabo fictício 2,5 mm');
});

test('ID de item de empresa B usado para criar em A é recusado (409) e não toca o item de B', async () => {
  instalar(banco());
  const deB = { id: randomUUID(), organizacao_id: ORG_B, processo_id: PROC_B, tipo: 'item', identificador: 'B-1', descricao: 'Item de B', quantidade: '1.000', valor_unitario_proposta: '5.00', marca: null, modelo: null, atualizado_em: 'x' };
  B.itens.push(deB);
  const r = await salvar({ modo: 'criar', item: { ...item(), id: deB.id } });
  assert.equal(r.statusCode, 409);
  assert.equal(B.itens.length, 1);
  assert.equal(B.itens[0].descricao, 'Item de B');
});

test('CNPJ B não escreve em A: membro de B pedindo empresa A é 403, sem chamada de escrita', async () => {
  instalar(banco());
  const r = await handler()(evento(base({ empresaId: EMP_A, processoId: PROC_A }), 'Bearer TOKEN-B'));
  assert.equal(r.statusCode, 403);
  assert.equal(B.chamadas.length, 0);
  assert.equal(B.itens.length, 0);
});

test('CNPJ B com empresa B e processo de A é recusado (processo indisponível), sem escrita', async () => {
  instalar(banco());
  const r = await handler()(evento(base({ empresaId: EMP_B, processoId: PROC_A }), 'Bearer TOKEN-B'));
  assert.equal(r.statusCode, 404);
  assert.equal(B.chamadas.length, 0);
});

test('edição de item muda o conteúdo da prévia: o hash de revisão anterior deixa de conferir', () => {
  const { preparar } = require(path.join(FN, '_kit_documentos.js'));
  const ids = randomUUID();
  const base = (quantidade) => ({
    userId: USU_A,
    empresa: { razao_social: 'EMPRESA FICTÍCIA A', cnpj: '11222333000181', id: EMP_A, organizacao_id: ORG_A },
    processo: { numero: 'PE-FICT-A-1', orgao: 'Órgão fictício', id: PROC_A },
    perfil: { invalidado_em: null, dados_confirmados: { endereco: 'Rua fictícia, 1', representante: 'Representante fictício', cargo: 'Diretor' } },
    itens: [{ id: ids, tipo: 'item', identificador: '1', descricao: 'Cabo', quantidade, valor_unitario_proposta: '1.10', marca: null, modelo: null, atualizado_em: '2026-01-01T00:00:00Z' }],
  });
  const corpo = { tipo: 'proposta', proposta: { itemIds: [ids], unidades: { [ids]: 'UN' }, validade: '30 dias', prazoEntrega: '10 dias', pagamento: 'À vista' } };
  const antes = preparar(base('2.500'), corpo).revisaoHash;
  const depois = preparar(base('3.000'), corpo).revisaoHash;
  assert.notEqual(antes, depois);
  assert.equal(preparar(base('2.500'), corpo).revisaoHash, antes, 'mesmo conteúdo, mesmo hash');
});

test('total exato por item: arredondamento meio-para-cima em centavos, sem ponto flutuante', () => {
  const { totalItem } = require(path.join(FN, '_kit_documentos.js'));
  assert.equal(totalItem('2.500', '1.10').toString(), '275');
  assert.equal(totalItem('0.333', '0.01').toString(), '0');
  assert.equal(totalItem('0.500', '0.01').toString(), '1');
  assert.equal(totalItem('1.000', '2.00').toString(), '200');
  // Produto máximo excede o limite do total: o kit recusa (não trunca).
  assert.throws(() => totalItem('999999999999.999', '9999999999999.99'), /Total excede|Confira as pendências/);
});

test('resposta perdida após gravar (fetch lança): reconcilia pelo GET exato e devolve o mesmo item, sem nova linha', async () => {
  instalar(banco());
  const corpo = base();
  B.perderResposta = 1;
  const r = await handler()(evento(corpo));
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(B.itens.length, 1, 'uma única linha gravada');
  assert.equal(JSON.parse(r.body).item.id, corpo.item.id);
  assert.equal(JSON.parse(r.body).reaproveitado, true);
});

test('overflow do total (cada valor válido, produto fora do limite): recusado antes de qualquer escrita', async () => {
  instalar(banco());
  const r = await handler()(evento(base({ item: item({ quantidade: '999999999999.999', valorUnitario: '999999999999.99' }) })));
  assert.equal(r.statusCode, 400);
  assert.equal(B.chamadas.length, 0, 'nenhuma escrita');
});

test('UI espelha o total: overflow do produto é recusado no formulário antes do envio', () => {
  const ui = require('../../../itens-processo-ui.js');
  const v = ui.validarItemCampos({ identificador: '1', descricao: 'x', quantidade: '999999999999.999', valorUnitario: '999999999999.99' });
  assert.equal(v.ok, false);
  assert.ok(v.erros.total, 'erro de total presente');
  assert.equal(ui.validarItemCampos({ identificador: '1', descricao: 'x', quantidade: '2.500', valorUnitario: '1.10' }).ok, true);
});

test('importação PNCP na tela de itens: número do item no limite do handler e resposta tratada como em processos.html', () => {
  const ui = require('../../../itens-processo-ui.js');
  assert.deepEqual(['1', ' 42 ', '1000000'].map(ui.numeroItemImportacao), [1, 42, 1000000]);
  for (const v of ['', '0', '-1', '1.5', '01', '1000001', '1e3', 'abc', null]) assert.equal(ui.numeroItemImportacao(v), null, String(v));
  // Mesma mensagem do handler quando IMPORTACAO_PNCP_LOCAL está desligada.
  const { criarHandler } = require('../../../netlify/functions/importar-item-pncp.js');
  return criarHandler({ enabled: () => false })({ httpMethod: 'POST', headers: {}, body: '{}' }).then((r) => {
    const desligada = ui.respostaImportacao(r.statusCode, JSON.parse(r.body));
    assert.deepEqual(desligada, { ok: false, texto: ui.MSG.desligada });
    assert.deepEqual(ui.respostaImportacao(200, { itemId: 'i1', estado: 'inalterado', mensagem: 'x' }), { ok: true, texto: ui.MSG.inalterado });
    assert.deepEqual(ui.respostaImportacao(200, { itemId: 'i1', estado: 'importado', mensagem: 'Item com origem PNCP armazenado.' }), { ok: true, texto: 'Item com origem PNCP armazenado.' });
    assert.deepEqual(ui.respostaImportacao(200, { estado: 'importado' }), { ok: false, texto: ui.MSG.erroImportar }, 'sem itemId não conta como importado');
    assert.deepEqual(ui.respostaImportacao(429, { erro: 'Aguarde sete segundos antes de consultar outro item.' }), { ok: false, texto: 'Aguarde sete segundos antes de consultar outro item.' });
    assert.deepEqual(ui.respostaImportacao(503, null), { ok: false, texto: ui.MSG.erroImportar });
    assert.equal(ui.respostaImportacao(409, { erro: 'x'.repeat(900) }).texto.length, 300);
  });
});
