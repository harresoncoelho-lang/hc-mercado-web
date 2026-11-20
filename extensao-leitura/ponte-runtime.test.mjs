import test from 'node:test';
import assert from 'node:assert/strict';
import { criarWorkerLeitura } from './ponte-worker.mjs';
import { criarClienteLeitura } from './ponte-cliente.mjs';
const ext='a'.repeat(32),url='https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/cadastro-propostas?compra=78882005000412026';
const context={cnpj:'12345678000195',uasg:'788820',number:'41',year:'2026',purchaseId:'78882005000412026'};
function event(){const listeners=[];return{addListener:f=>listeners.push(f),fire:x=>listeners.forEach(f=>f(x))};}
function pair(sender){const a={onMessage:event(),onDisconnect:event()},b={sender,onMessage:event(),onDisconnect:event()};let closed=false;for(const [x,y]of[[a,b],[b,a]]){x.postMessage=m=>{if(closed)throw Error('closed');queueMicrotask(()=>y.onMessage.fire(structuredClone(m)));};x.disconnect=()=>{if(!closed){closed=true;a.onDisconnect.fire();b.onDisconnect.fire();}};}return[a,b];}
function fixture(){const runtime={id:ext,onConnect:event(),onConnectExternal:event(),getURL:p=>`chrome-extension://${ext}/${p}`};let latest;runtime.connect=()=>{const[a,b]=pair({id:ext,url:runtime.getURL('popup.html')});b.name='licitaplena-leitura-popup';latest=b;runtime.onConnect.fire(b);return a;};const worker=criarWorkerLeitura({runtime,origem:'https://fixture.invalid',caminho:'/processos.html'});const external=(attempt='00000000-0000-4000-8000-000000000001')=>{const[a,b]=pair({url:'https://fixture.invalid/processos.html',frameId:0,tab:{id:1},documentId:'doc'});b.name='licitaplena-leitura-v1';runtime.onConnectExternal.fire(b);a.postMessage({tipo:'iniciarLeitura',tentativaId:attempt,nonce:'n'.repeat(43),contexto:context,documentoId:'00000000-0000-4000-8000-000000000002',versao:1,revisaoHash:'a'.repeat(64),expiraEm:new Date(Date.now()+290000).toISOString(),geracao:1});return a;};return{runtime,worker,external,latest:()=>latest};}
test('cliente async → worker → receptor preserva contexto e não expõe nonce no popup',async()=>{const f=fixture(),external=f.external();await Promise.resolve();let receipt;external.onMessage.addListener(m=>receipt=m);const c=criarClienteLeitura(f.runtime);const attempt=await c.obterTentativa();assert.equal('nonce'in attempt,false);assert.equal(await c.vincularPortal(attempt.tentativaId,{id:7,url}),true);const snapshot={url,headings:['Pregão Eletrônico N° 41/2026','UASG 788820'],supplierLabels:['CNPJ do fornecedor: 12345678000195'],notices:[],collectionComplete:true,paginaObservada:{completa:true,itens:[{id:'1',descricao:'Item fictício',quantidadeSolicitada:'1',unidade:'Unidade',grupo:null,exigencias:null}]}};assert.equal(await c.concluir(attempt.tentativaId,snapshot,{id:7,url}),true);assert.equal(receipt.nonce,'n'.repeat(43));c.fechar();});
test('popup fechado invalida tentativa; segunda porta e remetente estranho recusados',async()=>{const f=fixture();f.external();await Promise.resolve();const c=criarClienteLeitura(f.runtime);const a=await c.obterTentativa();const second=criarClienteLeitura(f.runtime);await assert.rejects(second.obterTentativa());const[x,y]=pair({id:'b'.repeat(32),url:f.runtime.getURL('popup.html')});f.runtime.onConnect.fire(y);x.onMessage.fire({});assert.equal(await c.vincularPortal(a.tentativaId,{id:7,url}),true);c.fechar();const next=criarClienteLeitura(f.runtime);assert.equal(await next.obterTentativa(),null);next.fechar();});
test('timeout e resposta antiga não restauram cliente; worker reiniciado não tem tentativa',async()=>{const f=fixture();f.external();await Promise.resolve();const c=criarClienteLeitura(f.runtime,{timeoutMs:5});const p=c.obterTentativa();f.latest().postMessage=()=>{};await assert.rejects(p);await assert.rejects(c.obterTentativa());const fresh=fixture(),next=criarClienteLeitura(fresh.runtime);assert.equal(await next.obterTentativa(),null);next.fechar();});


test('cancelamento e m�todos antigos n�o atingem tentativa nova; payload inv�lido fecha pr�pria porta',async()=>{
 const f=fixture();f.external();await Promise.resolve();const c=criarClienteLeitura(f.runtime);const a=await c.obterTentativa();
 await c.cancelar(a.tentativaId);f.external('00000000-0000-4000-8000-000000000003');await Promise.resolve();const b=await c.obterTentativa();
 assert.equal(await c.cancelar(a.tentativaId),true);assert.equal(await c.vincularPortal(a.tentativaId,{id:7,url}),false);
 assert.equal(await c.vincularPortal(b.tentativaId,{id:7,url}),true);
 await assert.rejects(c.concluir(b.tentativaId,null,{id:7,url}));
 const fresh=criarClienteLeitura(f.runtime);assert.equal(await fresh.obterTentativa(),null);fresh.fechar();
});

test('popup real usa cliente async e worker, sem global compartilhado',async t=>{
 const f=fixture();let receipt;f.external().onMessage.addListener(m=>receipt=m);await Promise.resolve();
 const nodes={};const node=id=>nodes[id]??=( {value:'',textContent:'',disabled:false,addEventListener(n,fn){this[n]=fn;}} );
 const snapshot={url,headings:['Preg\u00e3o Eletr\u00f4nico N\u00b0 41/2026','UASG 788820'],supplierLabels:['CNPJ do fornecedor: 12345678000195'],notices:[],collectionComplete:true,paginaObservada:{completa:true,itens:[{id:'1',descricao:'Item fict�cio',quantidadeSolicitada:'1',unidade:'Unidade',grupo:null,exigencias:null}]}};
 globalThis.document={getElementById:node};globalThis.chrome={runtime:{...f.runtime,getManifest:()=>({background:{service_worker:'worker-qa.mjs'}})},tabs:{query:async()=>[{id:7,url}]},scripting:{executeScript:async()=>[{frameId:0,result:snapshot}]}};
 let closed;globalThis.addEventListener=(event,fn)=>{assert.equal(event,'pagehide');closed=fn;};
 t.after(()=>{closed?.();delete globalThis.chrome;delete globalThis.document;delete globalThis.addEventListener;});
 await import('./popup.mjs?runtime-integration');await node('adopt').click();await node('read').click();
 assert.match(node('result').textContent,/Relato enviado/);assert.equal(receipt.snapshot.paginaObservada.itens.length,1);
 assert.equal(node('read').disabled,false);assert.equal(await criarClienteLeitura(f.runtime).obterTentativa().catch(()=>null),null);
});
