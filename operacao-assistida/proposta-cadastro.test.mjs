import test from 'node:test';
import assert from 'node:assert/strict';
import endpoint from '../netlify/functions/kit-documentos.js';
import { propostaParaLote } from './proposta-para-lote.mjs';
import { criarCadastro } from './criar-cadastro.mjs';
const ID = { empresa: '11111111-1111-1111-1111-111111111111', processo: '22222222-2222-2222-2222-222222222222', item: '33333333-3333-3333-3333-333333333333', org: '44444444-4444-4444-4444-444444444444', doc: '55555555-5555-5555-5555-555555555555' };
async function fixture(t, quantity = '2.000', price = '12.50', size = 1, cnpj = '11222333000181', opcionaisAusentes = false, expectedStatus = 200) {
  const contextoKit = {
    userId: 'usuario',
    empresa: { id: ID.empresa, organizacao_id: ID.org, razao_social: 'Empresa QA', cnpj },
    processo: { id: ID.processo, empresa_id: ID.empresa, organizacao_id: ID.org, numero: '41/2026', orgao: 'Órgão fictício', documentos_exigidos: [] },
    perfil: { empresa_id: ID.empresa, organizacao_id: ID.org, versao: 1, confirmado_em: '2026-11-01', dados_confirmados: { endereco: 'Rua QA', representante: 'Ana', cargo: 'Sócia' }, proveniencia: [] },
    itens: [{ id: ID.item, organizacao_id: ID.org, processo_id: ID.processo, tipo: 'item', identificador: 'não usar como ID de portal', descricao: 'Material fictício', quantidade: quantity, valor_unitario_proposta: price, marca: 'Marca QA', modelo: 'Modelo QA' }],
  };
  const raw = { id: ID.doc, empresa_id: ID.empresa, processo_id: ID.processo, organizacao_id: ID.org, versao: 1, tipo: 'proposta', dados: { proposta: { itemIds: [ID.item], unidades: { [ID.item]: 'un' }, validade: '30 dias', prazoEntrega: '10 dias', pagamento: 'Após entrega' } }, criado_por: 'usuario', atualizado_por: 'usuario' };
  for (let i = 1; i < size; i++) contextoKit.itens.push({ ...contextoKit.itens[0], id: `33333333-3333-3333-3333-${String(i).padStart(12, '0')}`, identificador: `rótulo ${i}`, marca: `Marca ${i}` });
  raw.dados.proposta.itemIds = contextoKit.itens.map(i => i.id).reverse();
  raw.dados.proposta.unidades = Object.fromEntries(raw.dados.proposta.itemIds.map(id => [id, 'un']));
  if (opcionaisAusentes) for (const item of contextoKit.itens) { item.marca = null; item.modelo = null; }
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(url); let data;
    if (url.includes('/auth/v1/user')) data = { id: contextoKit.userId };
    else if (url.includes('/clientes?')) data = [{ status: 'aprovado' }];
    else if (url.includes('/rpc/identificacao_empresa_habilitada')) data = true;
    else if (url.includes('/operacao_empresas?')) data = [contextoKit.empresa];
    else if (url.includes('/operacao_membros?')) data = [{ usuario_id: contextoKit.userId, organizacao_id: ID.org, empresa_id: ID.empresa, papel: 'operador' }];
    else if (url.includes('/operacao_processos?')) data = [contextoKit.processo];
    else if (url.includes('/operacao_itens_resultado?')) {
      const filtro = new URL(url).searchParams.get('id');
      const ids = filtro?.startsWith('in.(') ? filtro.slice(4, -1).split(',') : null;
      data = ids ? contextoKit.itens.filter(item => ids.includes(item.id)) : contextoKit.itens;
    }
    else if (url.includes('/operacao_identificacao_empresa?')) data = [contextoKit.perfil];
    else if (url.includes('/operacao_documentos?')) data = [];
    else if (url.includes('/operacao_kit_documentos?')) data = [raw];
    else throw new Error('Destino não previsto na fixture');
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  });
  const old = process.env.IDENTIFICACAO_EMPRESA_LOCAL; process.env.IDENTIFICACAO_EMPRESA_LOCAL = '1';
  t.after(() => { if (old === undefined) delete process.env.IDENTIFICACAO_EMPRESA_LOCAL; else process.env.IDENTIFICACAO_EMPRESA_LOCAL = old; });
  const run = async acao => {
    const result = await endpoint.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer FIXTURE' }, body: JSON.stringify({ acao, empresaId: ID.empresa, processoId: ID.processo, documentoId: ID.doc, versaoEsperada: 1 }) });
    assert.equal(result.statusCode, expectedStatus); return JSON.parse(result.body);
  };
  const prepared = await run('preparar');
  if (expectedStatus !== 200) return { prepared };
  Object.assign(raw, { revisao_hash: prepared.revisaoHash, revisao_previa: prepared.previa, revisao_versao: 1, revisado_por: 'usuario', revisado_em: '2026-11-01' });
  const abertura = await run('abrir'); assert.equal(abertura.revisaoVigente, true);
  const contextoPortal = { cnpj: contextoKit.empresa.cnpj, uasg: '788820', number: '41', year: '2026', purchaseId: '78882005000412026' };
  const confiavel = { contextoKit, vinculo: { empresaId: ID.empresa, processoId: ID.processo, organizacaoId: ID.org, contextoPortal }, catalogo: contextoKit.itens.map((_, i) => ({ id: String(201 + i), quantidade: quantity, grupo: null, exigidos: ['marca', 'modelo'] })), mapeamento: contextoKit.itens.map((item, i) => ({ itemKitId: item.id, itemPortalId: String(201 + i) })) };
  const snapshot = { url: `https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/cadastro-propostas?compra=${contextoPortal.purchaseId}`, headings: ['Pregão Eletrônico N° 41/2026', 'UASG 788820'], supplierLabels: [`CNPJ do fornecedor: ${contextoPortal.cnpj}`], notices: [], collectionComplete: true };
  return { abertura, snapshot, confiavel, calls, raw };
}

function compor(f, perderResposta = false) {
  const lote = propostaParaLote(f.abertura, f.snapshot, f.confiavel);
  const fonte = new Map(), chamadas = [];
  const porta = {
    tipo: 'ficticia',
    async lerPagina({ cursor }) {
      const i = Number(cursor ?? 0), ids = f.confiavel.catalogo.map(x => x.id);
      return { contexto: lote.contexto, ids: ids.slice(i, i + 10), proximo: i + 10 < ids.length ? String(i + 10) : null };
    },
    async aplicar(c) {
      chamadas.push(c.id); fonte.set(c.id, structuredClone(c));
      if (perderResposta) { perderResposta = false; throw Error('Resposta perdida após aplicação fictícia'); }
      return { status: 'aplicado', comando: structuredClone(c) };
    },
    async conciliar(c) { return fonte.has(c.id) ? { status: 'aplicado', comando: structuredClone(fonte.get(c.id)) } : null; },
  };
  const resultado = criarCadastro(f.abertura, f.snapshot, f.confiavel, porta, () => 100);
  return { ...resultado, fonte, chamadas };
}
function autorizar(motor, id = 'operador-autorizou-simulacao') {
  return motor.autorizar({ id, vinculo: motor.vinculo, expiraEm: 200 });
}

for (const cnpj of ['11222333000181', '12345678000195']) test(`handler → revisão → contexto → lote → cadastro fictício ${cnpj}`, async t => {
  const f = await fixture(t, '2.000', '12.50', 12, cnpj), calls = f.calls.length;
  const p = compor(f);
  assert.equal(p.lote.valido, true); assert.equal(p.lote.writeAuthorized, false);
  await p.motor.executar(); assert.equal(p.chamadas.length, 0, 'revisão documental não autoriza cadastro');
  assert.equal(autorizar(p.motor), true);
  assert.equal((await p.motor.executar()).estado, 'concluido');
  assert.equal(p.fonte.size, 12); assert.equal(f.calls.length, calls);
  for (const c of p.fonte.values()) {
    assert.equal(c.contexto.cnpj, cnpj); assert.equal(c.item.unitario, '12.5000');
    assert.equal(c.item.totalExato, '25.00000000'); assert.ok(c.item.marca); assert.ok(c.item.modelo);
  }
  const errado = structuredClone(f); errado.snapshot.supplierLabels = [`CNPJ do fornecedor: ${cnpj === '11222333000181' ? '12345678000195' : '11222333000181'}`];
  assert.equal(compor(errado).motor, null);
});

test('revisão adulterada e obrigatório ausente impedem criar motor', async t => {
  const f = await fixture(t);
  const alterado = structuredClone(f); alterado.abertura.documento.revisao.hash = '0'.repeat(64);
  assert.equal(compor(alterado).motor, null);
  const obrigatorio = structuredClone(f); obrigatorio.confiavel.catalogo[0].exigidos.push('fabricante');
  assert.equal(compor(obrigatorio).motor, null);
});

test('percurso integrado reconcilia aplicado sem repetir e requer autorização distinta', async t => {
  const f = await fixture(t), p = compor(f, true);
  autorizar(p.motor); assert.equal((await p.motor.executar()).estado, 'incerto');
  assert.equal(p.chamadas.length, 1); assert.equal(autorizar(p.motor, 'b'), false);
  await p.motor.reconciliar(); assert.equal(p.motor.status().pendente, null);
  await p.motor.executar(); assert.equal(p.chamadas.length, 1);
  autorizar(p.motor, 'c'); assert.equal((await p.motor.executar()).estado, 'concluido');
  assert.equal(p.chamadas.length, 1);
});

for (const tamanho of [51, 200, 1000]) test(`contrato candidato integra ${tamanho} itens genuinamente preparados e revisados`, async t => {
  const f = await fixture(t, '2.000', '12.50', tamanho), p = compor(f);
  assert.ok(p.motor); autorizar(p.motor);
  assert.equal((await p.motor.executar()).confirmados.length, tamanho);
  assert.equal(p.fonte.size, tamanho);
  const alterado = structuredClone(f); alterado.confiavel.contextoKit.itens[0].valor_unitario_proposta = '13.00';
  assert.equal(compor(alterado).motor, null, 'item alterado exige revisão nova');
});

test('1001 itens rejeitados no handler e na composição, não apenas por hash obsoleto', async t => {
  const invalido = await fixture(t, '2.000', '12.50', 1001, '11222333000181', false, 400);
  assert.match(JSON.stringify(invalido.prepared), /Itens selecionados inválidos/);
  const f = await fixture(t, '2.000', '12.50', 1000);
  const extra = { ...f.confiavel.contextoKit.itens[0], id: '66666666-6666-6666-6666-666666666666' };
  f.confiavel.contextoKit.itens.push(extra); f.abertura.documento.dados.proposta.itemIds.push(extra.id);
  f.abertura.documento.dados.proposta.unidades[extra.id] = 'un';
  assert.equal(compor(f).motor, null);
  assert.equal(compor(f).lote.motivo, 'dados_kit');
});

test('factory omite opcionais nulos, não propaga campos privados e nasce pausada', async t => {
  const f = await fixture(t, '2.000', '12.50', 1, '11222333000181', true);
  f.confiavel.catalogo[0].exigidos = [];
  f.confiavel.catalogo[0].custoPrivado = 'SEGREDO';
  f.abertura.documento.custoPrivado = 'SEGREDO';
  const p = compor(f);
  assert.ok(p.motor); assert.equal(p.motor.status().estado, 'pausado');
  assert.doesNotMatch(JSON.stringify(p.lote), /SEGREDO|custoPrivado/);
  autorizar(p.motor); assert.equal((await p.motor.executar()).estado, 'concluido');
  assert.doesNotMatch(JSON.stringify([...p.fonte.values()]), /SEGREDO|custoPrivado/);
  const invalid = criarCadastro(f.abertura, f.snapshot, f.confiavel, { tipo: 'real' }, () => 100);
  assert.equal(invalid.motor, null); assert.equal(invalid.motivo, 'contrato_motor');
});




test('handler preparação operacional autentica e bloqueia ausência de vínculo portal',async t=>{
 await fixture(t);
 const event={httpMethod:'POST',headers:{authorization:'Bearer FIXTURE'},body:JSON.stringify({acao:'prepararOperacao',empresaId:ID.empresa,processoId:ID.processo,documentoId:ID.doc,versaoEsperada:1})};
 const r=await endpoint.handler(event);assert.equal(r.statusCode,409);assert.equal(JSON.parse(r.body).motivo,'vinculo_portal_indisponivel');
 const forged=await endpoint.handler({...event,body:JSON.stringify({...JSON.parse(event.body),catalogo:[]})});assert.equal(forged.statusCode,400);
 const noauth=await endpoint.handler({...event,headers:{}});assert.equal(noauth.statusCode,401);
});
test('handler usa evidência injetada servidor e revisão persistida, não autorização portal',async t=>{
 const f=await fixture(t);let called=0;
 const handler=endpoint.criarHandler({carregarEvidenciaPortal:async scope=>{called++;assert.equal(scope.empresaId,ID.empresa);return {tipo:'portal',vigente:true,snapshot:f.snapshot,...f.confiavel};}});
 const event={httpMethod:'POST',headers:{authorization:'Bearer FIXTURE'},body:JSON.stringify({acao:'prepararOperacao',empresaId:ID.empresa,processoId:ID.processo,documentoId:ID.doc,versaoEsperada:1})};
 const r=await handler(event);assert.equal(r.statusCode,200,r.body);const b=JSON.parse(r.body);assert.equal(b.valido,true);assert.equal(b.writeAuthorized,false);assert.equal(b.lote.itens[0].unitario,'12.5000');assert.doesNotMatch(r.body,/Bearer|custo_unitario|access_token/);
 const old=await handler({...event,body:JSON.stringify({...JSON.parse(event.body),versaoEsperada:2})});assert.equal(old.statusCode,409);assert.equal(called,1);
 const cross=await handler({...event,body:JSON.stringify({...JSON.parse(event.body),empresaId:ID.org})});assert.equal(cross.statusCode,404);assert.equal(called,1);
 f.raw.revisao_hash='0'.repeat(64);const altered=await handler(event);assert.equal(altered.statusCode,409);assert.equal(called,1);
});

test('alteração durante await da evidência impede lote antigo',async t=>{
 const f=await fixture(t);
 const handler=endpoint.criarHandler({carregarEvidenciaPortal:async()=>{f.raw.revisao_hash='0'.repeat(64);return {tipo:'portal',vigente:true,snapshot:f.snapshot,...f.confiavel};}});
 const r=await handler({httpMethod:'POST',headers:{authorization:'Bearer FIXTURE'},body:JSON.stringify({acao:'prepararOperacao',empresaId:ID.empresa,processoId:ID.processo,documentoId:ID.doc,versaoEsperada:1})});assert.equal(r.statusCode,409);
});test('sessão alterada durante leitura de evidência não recebe lote',async t=>{
 const f=await fixture(t);const handler=endpoint.criarHandler({carregarEvidenciaPortal:async()=>{f.confiavel.contextoKit.userId='outro';return {tipo:'portal',vigente:true,snapshot:f.snapshot,...f.confiavel};}});
 const r=await handler({httpMethod:'POST',headers:{authorization:'Bearer FIXTURE'},body:JSON.stringify({acao:'prepararOperacao',empresaId:ID.empresa,processoId:ID.processo,documentoId:ID.doc,versaoEsperada:1})});assert.equal(r.statusCode,403);assert.doesNotMatch(r.body,/12.5000/);
});

test('UI existente abre proposta real revisada e mostra bloqueio autenticado sem perder DOCX',async t=>{
 const f=await fixture(t);const fs=await import('node:fs'),vm=await import('node:vm');const elements=new Map();
 const node=key=>{if(!elements.has(key))elements.set(key,{value:'',dataset:{},hidden:false,disabled:false,textContent:'',classList:{toggle(){}},setAttribute(){},focus(){},events:{},addEventListener(n,fn){this.events[n]=fn;},querySelectorAll(){return [];},querySelector(){return null;}});return elements.get(key);};
 const form=node('form');form.elements=new Proxy({},{get:(_,k)=>node('field:'+k)});form.reset=()=>{};
 const doc={activeElement:null,createElement:()=>node('created'),body:{append(){}}};
 const alvo={ownerDocument:doc,innerHTML:'',querySelector:node,querySelectorAll:()=>[],setAttribute(){},replaceChildren(){this.closed=true;}};
 const actions=[];let operacional=endpoint.handler,adiar=false,liberar;
 const positivo=endpoint.criarHandler({carregarEvidenciaPortal:async()=>({tipo:'portal',vigente:true,snapshot:f.snapshot,...f.confiavel})});
 const requisitar=async(_,op)=>{const b=JSON.parse(op.body);actions.push(b.acao);let r;
 if(b.acao==='consultar')r={statusCode:200,body:JSON.stringify({empresa:{razaoSocial:'Empresa QA',cnpj:'11222333000181'},processo:{numero:'41/2026',orgao:'QA'},itens:[],pendencias:[]})};
 else if(b.acao==='listar')r={statusCode:200,body:JSON.stringify({documentos:[f.abertura.documento]})};
 else if(b.acao==='confirmarRevisao')r={statusCode:200,body:JSON.stringify({documento:f.abertura.documento})};
 else {r=await (b.acao==='prepararOperacao'?operacional:endpoint.handler)({httpMethod:'POST',headers:{authorization:'Bearer FIXTURE'},body:op.body});if(b.acao==='prepararOperacao'&&adiar)await new Promise(resolve=>liberar=resolve);}
 return {ok:r.statusCode<400,status:r.statusCode,json:async()=>JSON.parse(r.body)};};
 const context={globalThis:{crypto:{randomUUID:()=>ID.doc},fetch:requisitar}};vm.runInNewContext(fs.readFileSync(new URL('../kit-documentos-ui.js',import.meta.url),'utf8'),context);
 context.globalThis.LicitaKitDocumentos.montar({alvo,contexto:{empresaId:ID.empresa,processoId:ID.processo},obterSessao:async()=>({userId:'usuario',accessToken:'FIXTURE'}),requisitar});
 const flush=async()=>{for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));};await flush();
 node('[data-lista]').events.click({target:{closest:()=>({dataset:{abrir:ID.doc}})}});await flush();
 assert.equal(node('[data-preparar-operacao]').hidden,true);
 form.events.submit({preventDefault(){}});await flush();
 node('[data-revisado]').events.change({target:{checked:true}});await flush();
 assert.equal(node('[data-preparar-operacao]').hidden,false,JSON.stringify({actions,estado:node('[data-estado]').textContent,aviso:node('[data-aviso]').textContent,descarte:node('[data-descarte]').hidden}));
 node('[data-preparar-operacao]').events.click();await flush();
 assert.ok(actions.includes('prepararOperacao'));assert.match(node('[data-operacao]').textContent,/vínculo com o Compras.gov ainda não verificado/);assert.match(node('[data-operacao]').textContent,/11.222.333\/0001-81/);assert.equal(node('[data-exportar]').disabled,false);
 operacional=positivo;node('[data-preparar-operacao]').events.click();await flush();assert.match(node('[data-operacao]').textContent,/Item 201/);assert.match(node('[data-operacao]').textContent,/Nenhuma proposta ou lance enviado/);
 adiar=true;node('[data-preparar-operacao]').events.click();await flush();
 form.events.input({target:{name:'validade',dataset:{}}});assert.equal(node('[data-operacao]').hidden,true);liberar();await flush();assert.equal(node('[data-operacao]').hidden,true);assert.equal(node('[data-preparar-operacao]').hidden,true);
});
