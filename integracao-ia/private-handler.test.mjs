import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateReadHandler } from './private-handler.mjs';

const ids = { user: '11111111-1111-1111-1111-111111111111', org: '22222222-2222-2222-2222-222222222222', company: '33333333-3333-3333-3333-333333333333', otherOrg: '44444444-4444-4444-4444-444444444444', otherCompany: '55555555-5555-5555-5555-555555555555' };
const project = 'https://staging.example.test';
const config = () => ({ authProjectUrl: project, dataProjectUrl: project, allowedProjectUrls: [project], enabled: true });
const company = (changes = {}) => ({ id: ids.company, organizacao_id: ids.org, razao_social: 'Empresa fictícia A', cnpj: '11222333000181', ativo: true, ...changes });
function fixture(options = {}) {
  const calls = []; let authCalls = 0;
  const state = { approved: true, member: true, company: company(), ...options };
  const handler = createPrivateReadHandler({ config: config(),
    verifySession: async input => { calls.push({ auth: input }); authCalls++; if (state.authError) throw new Error('jwt=SEGREDO'); return state.sessionInvalid ? null : { id: ids.user }; },
    readRows: async input => {
      calls.push(input); assert.equal(input.authorization, 'Bearer QA_PRIVATE'); assert.equal(input.projectUrl, project); assert.equal(input.method, 'GET');
      const q = new URLSearchParams(input.query);
      if (state.readError) throw Object.assign(new Error('SQL senha=SEGREDO'), { code: state.readErrorCode });
      if (input.resource === 'clientes') { assert.equal(q.get('id'), `eq.${ids.user}`); return [{ id: ids.user, status: state.approved ? 'aprovado' : 'pendente' }]; }
      if (input.resource === 'operacao_membros') {
        assert.equal(q.get('usuario_id'), `eq.${ids.user}`); if (q.get('organizacao_id') !== `eq.${ids.org}`) return [];
        return state.member && !(state.revoke && authCalls > 1) ? [{ usuario_id: ids.user, organizacao_id: ids.org, empresa_id: state.memberCompany ?? null, papel: state.role ?? 'leitura' }] : [];
      }
      if (input.resource === 'operacao_empresas') {
        assert.equal(q.get('organizacao_id'), `eq.${ids.org}`); assert.equal(q.get('ativo'), 'eq.true');
        assert.equal(q.get('order'), 'id.asc'); assert.equal(q.get('limit'), '1001');
        return [state.company];
      }
      throw new Error('Recurso inesperado');
    } });
  const run = async (body = {}, auth = 'Bearer QA_PRIVATE') => {
    const response = await handler(new Request('https://app.example.test/private-read', { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ ferramenta: 'listar_empresas_autorizadas', organizacaoId: ids.org, ...body }) }));
    return { response, data: await response.json() };
  };
  return { run, calls, state, handler };
}

test('factory recusa destinos divergentes ou não allowlisted sem chamar dependências', () => {
  for (const cfg of [{ ...config(), dataProjectUrl: 'https://other.example.test' }, { ...config(), allowedProjectUrls: [] }, { ...config(), authProjectUrl: 'http://staging.example.test' }]) {
    assert.throws(() => createPrivateReadHandler({ config: cfg, verifySession() {}, readRows() {} }), /configuracao_invalida/);
  }
});

test('handler real Request/Response lista apenas empresa autorizada e não expõe credenciais', async () => {
  const f = fixture(); const { response, data } = await f.run();
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(data, { records: [{ id: ids.company, nome: 'Empresa fictícia A' }], hasMore: false, nextOffset: null });
  assert.equal(f.calls.filter(c => c.auth).length, 2);
  assert.equal(JSON.stringify(data).includes('QA_PRIVATE'), false);
  assert.equal(JSON.stringify(data).includes('cnpj'), false);
});

test('sessão ausente ou inválida e verificação indisponível falham fechadas', async () => {
  const absent = fixture(); assert.equal((await absent.run({}, '')).response.status, 401); assert.equal(absent.calls.length, 0);
  const invalid = fixture({ sessionInvalid: true }); assert.equal((await invalid.run()).response.status, 401); assert.equal(invalid.calls.length, 1);
  assert.equal((await fixture({ authError: true }).run()).response.status, 503);
});

test('cliente não aprovado, vínculo removido/inativo e papel desconhecido negam', async () => {
  for (const options of [{ approved: false }, { member: false }, { role: 'admin_inventado' }]) {
    const f = fixture(options); assert.equal((await f.run()).response.status, 403);
    assert.equal(f.calls.some(c => c.resource === 'operacao_empresas'), false);
  }
});

test('organização, empresa ou CNPJ não autorizado não retornam dados', async () => {
  const other = fixture(); assert.equal((await other.run({ organizacaoId: ids.otherOrg })).response.status, 403);
  for (const selector of [{ empresaId: ids.otherCompany, cnpj: '11222333000181' }, { empresaId: ids.company, cnpj: '22333444000181' }]) {
    const f = fixture(); assert.equal((await f.run(selector)).response.status, 403);
  }
});

test('repositório que viola filtro de organização/empresa/atividade é rejeitado', async () => {
  for (const changes of [{ organizacao_id: ids.otherOrg }, { ativo: false }, { cnpj: null }]) {
    assert.notEqual((await fixture({ company: company(changes) }).run()).response.status, 200);
  }
  assert.equal((await fixture({ memberCompany: ids.otherCompany }).run()).response.status, 403);
});

test('revogação entre leitura e resposta nega dados já carregados', async () => {
  const f = fixture({ revoke: true }); const { response, data } = await f.run();
  assert.equal(response.status, 403); assert.equal('records' in data, false);
});

test('request não injeta identidade, endpoints, ferramentas ou dados documentais', async () => {
  for (const extra of [{ usuarioId: ids.user }, { scopes: ['*'] }, { context: {} }, { authProjectUrl: project }, { ferramenta: 'enviar_lance' }, { ferramenta: 'consultar_evidencia_documental' }]) {
    const f = fixture(); const { response } = await f.run(extra);
    assert.ok([400, 404].includes(response.status)); assert.equal(f.calls.length, 0);
  }
});

test('erro interno não expõe mensagem, JWT, query ou SQL', async () => {
  const { response, data } = await fixture({ readError: true }).run();
  assert.equal(response.status, 503); assert.doesNotMatch(JSON.stringify(data), /SEGREDO|SQL|QA_PRIVATE/);
});

test('gate fechado e método inválido não acionam autenticação ou dados', async () => {
  const disabled = createPrivateReadHandler({ config: { ...config(), enabled: false }, verifySession() { throw Error('não chamar'); }, readRows() { throw Error('não chamar'); } });
  assert.equal((await disabled(new Request('https://app.example.test/', { method: 'POST' }))).status, 503);
  const f = fixture(); assert.equal((await f.handler(new Request('https://app.example.test/'))).status, 405); assert.equal(f.calls.length, 0);
});
test('documental aceita corpo maior4KiB até teto explícito; listagem preserva4KiB',async()=>{
 let calls=0;const h=createPrivateReadHandler({config:config(),verifySession:async()=>{calls++;return {id:ids.user};},readRows:async()=>[]});
 const send=text=>h(new Request('https://local.test',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer fake'},body:text}));
 const listing=JSON.stringify({ferramenta:'listar_empresas_autorizadas',organizacaoId:ids.org});assert.equal((await send(listing+' '.repeat(4097))).status,413);assert.equal(calls,0);
 const doc={ferramenta:'verificar_resposta_anexo_selecionado',organizacaoId:ids.org,empresaId:ids.company,cnpj:'11222333000181',processoId:ids.otherOrg,anexoId:ids.otherCompany,resposta:{status:'conclusao',afirmacoes:[]}};
 assert.equal((await send(JSON.stringify(doc)+' '.repeat(5000))).status,503);
});
test('stream acima1MiB é cancelado sem Auth e UTF8 inválido recusado',async()=>{
 let calls=0,cancelled=false;const h=createPrivateReadHandler({config:config(),verifySession:async()=>{calls++;},readRows:async()=>[]});
 const stream=new ReadableStream({pull(c){c.enqueue(new Uint8Array(65536));},cancel(){cancelled=true;}});
 const r=await h(new Request('https://local.test',{method:'POST',headers:{'content-type':'application/json'},body:stream,duplex:'half'}));assert.equal(r.status,413);assert.equal(cancelled,true);assert.equal(calls,0);
 assert.equal((await h(new Request('https://local.test',{method:'POST',headers:{'content-type':'application/json'},body:Uint8Array.of(0xff)}))).status,400);
});

test('negação de autorização estruturada não vira falha genérica',async()=>{const f=fixture({readError:true,readErrorCode:'acesso_negado'});assert.equal((await f.run()).response.status,403);});
