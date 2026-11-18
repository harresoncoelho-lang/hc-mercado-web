import test from 'node:test';
import assert from 'node:assert/strict';
import endpoint from '../netlify/functions/kit-documentos.js';


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


import ponte from '../netlify/functions/_ponte_leitura.js';
import {criarReceptor} from '../extensao-leitura/ponte-receptor.mjs';
test('UI real → handler → RPC double → receptor e popup reais → recibo parcial',async t=>{
 const f=await fixture(t);const fs=await import('node:fs'),vm=await import('node:vm');
 const originalFetch=globalThis.fetch;let record=null,observations=0,delayRegistro=false,releaseRegistro,mapa=null,delayMapa=false,releaseMapa;
 t.mock.method(globalThis,'fetch',async(url,op)=>{
  if(url.includes('/rpc/operacao_vinculo_compra'))return new Response(JSON.stringify({status:200,vinculo:{versao:1,cnpj_revisado:'11222333000181',uasg_revisada:'788820',numero:'41',ano:'2026',compra:'78882005000412026'}}));
  if(url.includes('/rpc/operacao_correspondencias_leitura')){
   const b=JSON.parse(op.body);let result;
   if(b.p_acao==='consultar')result={status:200,recibos:[{id:ID.doc,criadoEm:'2026-11-02',itens:[{id:'1',descricao:'<img src=x onerror=alert(1)>',quantidadeSolicitada:'6',unidade:'Unidade'}],correspondencia:mapa}],nextCursor:null,lote:null,writeAuthorized:false};
   else{assert.equal(b.p_mapa_versao,mapa?.versao||0);assert.deepEqual(b.p_pares,[{itemId:ID.item,portalId:'1'}]);mapa={versao:(mapa?.versao||0)+1,pares:b.p_pares};if(delayMapa)await new Promise(resolve=>releaseMapa=resolve);result={status:200,recibo:ID.doc,versaoCorrespondencia:mapa.versao,lote:null,writeAuthorized:false};}
   return new Response(JSON.stringify(result));
  }
  if(url.includes('/rpc/operacao_ponte_leitura')){const b=JSON.parse(op.body);let result;
   if(b.p_acao==='iniciar'){record=b;result={status:200,tentativaId:b.p_tentativa,expiraEm:new Date(Date.now()+290000).toISOString(),writeAuthorized:false};}
   else if(b.p_acao==='registrar'){assert.equal(b.p_tentativa,record.p_tentativa);assert.equal(b.p_nonce_hash,record.p_nonce_hash);assert.equal(b.p_observacao.origem,'relato_usuario');observations++;if(delayRegistro)await new Promise(resolve=>releaseRegistro=resolve);result={status:200,recibo:ID.doc,writeAuthorized:false};}
   else result={status:200,cancelada:true};
   return new Response(JSON.stringify(result));
  }
  return originalFetch(url,op);
 });
 const handler=endpoint.criarHandler({ponteLeitura:ponte.criarPonteLeitura({requestCancelar:async(event,path,op)=>globalThis.fetch('https://fixture.invalid'+path,op)})});
 const elements=new Map(),node=key=>{if(!elements.has(key))elements.set(key,{value:'',dataset:{},hidden:false,disabled:false,textContent:'',classList:{toggle(){}},setAttribute(){},focus(){},events:{},addEventListener(n,fn){this.events[n]=fn;},querySelectorAll(){return [];},querySelector(){return null;}});return elements.get(key);};
 const form=node('form');form.elements=new Proxy({},{get:(_,k)=>node('field:'+k)});form.reset=()=>{};
 const alvo={ownerDocument:{activeElement:null,createElement:()=>node('created'),body:{append(){}}},innerHTML:'',querySelector:node,querySelectorAll:()=>[],setAttribute(){},replaceChildren(){}};
 const receiver=criarReceptor({origem:'https://fixture.invalid',caminho:'/processos.html'});
 let receivePage,receiveExtension,disPage,disExtension;
 const extensionPort={sender:{url:'https://fixture.invalid/processos.html',frameId:0,tab:{id:7},documentId:'fixture-document'},onMessage:{addListener(fn){receiveExtension=fn;}},onDisconnect:{addListener(fn){disExtension=fn;}},postMessage(m){receivePage(m);},disconnect(){disPage?.();disExtension?.();}};
 const pagePort={onMessage:{addListener(fn){receivePage=fn;}},onDisconnect:{addListener(fn){disPage=fn;}},postMessage(m){receiveExtension(m);},disconnect(){disPage?.();disExtension?.();}};
 const actions=[];const requisitar=async(_,op)=>{const b=JSON.parse(op.body);actions.push(b.acao);let r;
  if(b.acao==='consultar')r={statusCode:200,body:JSON.stringify({empresa:{razaoSocial:'Empresa QA',cnpj:'11222333000181'},processo:{numero:'41/2026',orgao:'QA'},itens:[],pendencias:[]})};
  else if(b.acao==='listar')r={statusCode:200,body:JSON.stringify({documentos:[f.abertura.documento]})};
  else if(b.acao==='confirmarRevisao')r={statusCode:200,body:JSON.stringify({documento:f.abertura.documento})};
  else r=await handler({httpMethod:'POST',headers:{authorization:'Bearer FIXTURE'},body:op.body});
  return {ok:r.statusCode<400,status:r.statusCode,json:async()=>JSON.parse(r.body)};
 };
 const ui={globalThis:{crypto:{randomUUID:()=>ID.doc},fetch:requisitar},setTimeout,clearTimeout};vm.runInNewContext(fs.readFileSync(new URL('../kit-documentos-ui.js',import.meta.url),'utf8'),ui);
 const mounted=ui.globalThis.LicitaKitDocumentos.montar({alvo,contexto:{empresaId:ID.empresa,processoId:ID.processo},obterSessao:async()=>({userId:'usuario',accessToken:'FIXTURE'}),requisitar,canalLeitura:{extensionId:'a'.repeat(32),runtime:{connect(){assert.equal(receiver.conectar(extensionPort),true);return pagePort;}}}});
 t.after(()=>mounted.fechar());
 const flush=async()=>{for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));};await flush();
 node('[data-lista]').events.click({target:{closest:()=>({dataset:{abrir:ID.doc}})}});await flush();form.events.submit({preventDefault(){}});await flush();node('[data-revisado]').events.change({target:{checked:true}});await flush();
 assert.equal(node('[data-iniciar-leitura]').disabled,false);node('[data-iniciar-leitura]').events.click();await flush();assert.ok(record);
 const popupNodes=new Map();const pnode=key=>{if(!popupNodes.has(key))popupNodes.set(key,{value:'',hidden:true,textContent:'',addEventListener(n,fn){this[n]=fn;}});return popupNodes.get(key);};
 const snap={...f.snapshot,paginaObservada:{completa:true,itens:[{id:'1',descricao:'Material fictício',quantidadeSolicitada:'6',unidade:'Unidade',grupo:null,exigencias:null}]}};
 globalThis.document={getElementById:pnode};globalThis.licitaplenaPonteLeitura=receiver;t.after(()=>{delete globalThis.document;delete globalThis.licitaplenaPonteLeitura;delete globalThis.chrome;});
 globalThis.chrome={tabs:{query:async()=>[{id:91,url:snap.url}]},scripting:{executeScript:async()=>[{frameId:0,result:snap}]}};
 await import('../extensao-leitura/popup.mjs?composicao');await pnode('adopt').click();await pnode('read').click();await flush();
 assert.equal(observations,1);assert.match(node('[data-canal-status]').textContent,/Relato parcial registrado/);
 assert.ok(actions.includes('iniciarLeitura'));assert.ok(actions.includes('registrarLeitura'));assert.equal(node('[data-exportar]').disabled,false);
 node('[data-carregar-relatos]').events.click();await flush();
 node('[data-recibo]').value=ID.doc;node('[data-recibo]').events.change();
 assert.match(node('[data-pares]').innerHTML,/&lt;img/);assert.doesNotMatch(node('[data-pares]').innerHTML,/<img/);
 node('[data-pares]').querySelectorAll=()=>[{value:ID.item,dataset:{parPortal:'1'}}];
 node('[data-pares-revisados]').checked=true;node('[data-pares-revisados]').events.change();node('[data-salvar-pares]').events.click();await flush();
 assert.equal(mapa.versao,1);assert.match(node('[data-pares-status]').textContent,/salvas/);
 node('[data-carregar-relatos]').events.click();await flush();node('[data-recibo]').value=ID.doc;node('[data-recibo]').events.change();assert.match(node('[data-pares-status]').textContent,/versao 1/);
 delayMapa=true;node('[data-pares-revisados]').checked=true;node('[data-salvar-pares]').events.click();await flush();assert.equal(typeof releaseMapa,'function');
 node('[data-recibo]').value='';node('[data-recibo]').events.change();releaseMapa();await flush();assert.doesNotMatch(node('[data-pares-status]').textContent,/salvas/);assert.equal(node('[data-salvar-pares]').disabled,true);
 delayRegistro=true;node('[data-iniciar-leitura]').events.click();await flush();const oldCallback=receivePage;
 await pnode('adopt').click();await pnode('read').click();await flush();assert.equal(typeof releaseRegistro,'function');
 node('[data-cancelar-leitura]').events.click();await flush();assert.equal(node('[data-iniciar-leitura]').disabled,false);
 node('[data-iniciar-leitura]').events.click();await flush();const newer=record.p_tentativa;
 releaseRegistro();await flush();assert.match(node('[data-canal-status]').textContent,/Abra a extensão/);
 await oldCallback({tipo:'mensagem-inválida'});await flush();assert.equal(receiver.obterTentativa().tentativaId,newer);
 node('[data-cancelar-leitura]').events.click();await flush();
 mounted.fechar();
});
test('handler default fechado e cancelamento anterior à preparação/revisão',async t=>{
 const f=await fixture(t);const base={empresaId:ID.empresa,processoId:ID.processo,documentoId:ID.doc,versaoEsperada:1};
 const request=b=>({httpMethod:'POST',headers:{authorization:'Bearer FIXTURE'},body:JSON.stringify(b)});
 assert.equal((await endpoint.handler(request({...base,acao:'iniciarLeitura'}))).statusCode,503);
 let cancelled=0;const h=endpoint.criarHandler({ponteLeitura:async({body})=>{assert.equal(body.acao,'cancelarLeitura');cancelled++;return{status:200,cancelada:true};}});
 f.raw.revisao_hash=null;f.raw.dados=null;
 assert.equal((await h(request({acao:'cancelarLeitura',tentativaId:ID.doc}))).statusCode,200);assert.equal(cancelled,1);
 assert.equal((await h(request({acao:'cancelarLeitura',tentativaId:ID.doc,empresaId:ID.empresa}))).statusCode,400);
});
test('receptor expira porta, recusa concorrente/origem diferente e não restaura após restart',()=>{
 let now=1000;const receiver=criarReceptor({origem:'https://fixture.invalid',caminho:'/processos.html',agora:()=>now});
 const make=(url='https://fixture.invalid/processos.html')=>{const p={sender:{url,frameId:0,tab:{id:7},documentId:'doc'},onMessage:{addListener(fn){p.receive=fn;}},onDisconnect:{addListener(fn){p.close=fn;}},disconnect(){p.disconnected=true;p.close?.();},postMessage(){}};return p;};
 assert.equal(receiver.conectar(make('https://outro.invalid/processos.html')),false);
 const first=make();assert.equal(receiver.conectar(first),true);assert.equal(receiver.conectar(make()),false);
 now+=300001;const second=make();assert.equal(receiver.conectar(second),true);assert.equal(first.disconnected,true);
 first.receive({});
 receiver.cancelar('tentativa-antiga');
 assert.equal(receiver.vincularPortal('tentativa-antiga',{}),false);
 assert.equal(receiver.concluir('tentativa-antiga',{},{}),false);
 assert.notEqual(second.disconnected,true,'callback antigo não pode desconectar nova porta');
 second.disconnect();assert.equal(receiver.obterTentativa(),null);
 const restarted=criarReceptor({origem:'https://fixture.invalid',caminho:'/processos.html',agora:()=>now});assert.equal(restarted.obterTentativa(),null);
});
