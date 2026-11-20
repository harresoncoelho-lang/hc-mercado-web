import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateTransport } from './private-transport.mjs';
const url='https://staging.example.test';
const config={authProjectUrl:url,dataProjectUrl:url,allowedProjectUrls:[url],publicKey:'sb_publishable_FAKE'};
const jwt=role=>`eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({role})).toString('base64url')}.fake`;
const input={projectUrl:url,authorization:`Bearer ${jwt('authenticated')}`};
const query='id=eq.11111111-1111-1111-1111-111111111111&select=id%2Cstatus&limit=2';
const rows=t=>t.readRows({...input,method:'GET',resource:'clientes',query});
const json=(data,headers={})=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json',...headers}});
const range=(total=1)=>({'content-range':`0-0/${total}`,'preference-applied':'count=exact'});
test('configuração exige mesmo destino autorizado e apenas chave pública',()=>{
 for(const c of [{...config,dataProjectUrl:'https://other.example.test'},{...config,allowedProjectUrls:[]},{...config,publicKey:'sb_secret_FAKE'},{...config,publicKey:jwt('service_role')}]) assert.throws(()=>createPrivateTransport({config:c,fetchImpl:()=>{}}),/transporte_indisponivel/);
 assert.ok(createPrivateTransport({config:{...config,publicKey:jwt('anon')},fetchImpl:()=>{}}));
});
test('auth e REST usam GET JWT usuário chave pública sem cache nem redirect',async()=>{
 const calls=[];const t=createPrivateTransport({config,fetchImpl:async r=>{calls.push(r);return r.url.endsWith('/auth/v1/user')?json({id:'user'}):json([{id:'one'}],range());}});
 assert.deepEqual(await t.verifySession(input),{id:'user'});assert.deepEqual(await rows(t),[{id:'one'}]);
 for(const r of calls){assert.ok(r instanceof Request);assert.equal(r.method,'GET');assert.equal(r.redirect,'error');assert.equal(r.cache,'no-store');assert.equal(r.headers.get('apikey'),config.publicKey);assert.equal(r.headers.get('authorization'),input.authorization);}
 assert.equal(calls[1].headers.get('prefer'),'count=exact');
});
test('truncamento, contagem desconhecida, intervalo inválido ou total divergente recusam',async()=>{
 for(const headers of [{},range(3),{'content-range':'0-0/*','preference-applied':'count=exact'},{'content-range':'1-1/1','preference-applied':'count=exact'},range(0)]){
 const t=createPrivateTransport({config,fetchImpl:async()=>json([{id:'one'}],headers)});await assert.rejects(rows(t),/transporte_indisponivel/);}
 const t=createPrivateTransport({config,fetchImpl:async()=>json([],{'content-range':'*/0','preference-applied':'count=exact'})});assert.deepEqual(await rows(t),[]);
});
test('destino recurso escrita query injetada ou token privilegiado não chegam ao fetch',async()=>{
 let calls=0;const t=createPrivateTransport({config,fetchImpl:async()=>{calls++;return json({});}});
 for(const extra of [{projectUrl:'https://evil.test'},{resource:'rpc/x'},{method:'POST'},{query:query+'&offset=1'},{query:query+'&limit=2'},{authorization:`Bearer ${jwt('service_role')}`},{authorization:'Bearer sb_secret_bad'}])await assert.rejects(t.readRows({...input,method:'GET',resource:'clientes',query,...extra}),/transporte_indisponivel/);
 assert.equal(calls,0);
});
test('HTTP inválido redirect JSON ruim e erros de rede são redigidos',async()=>{
 for(const f of [async()=>new Response('senha=SECRET',{status:503}),async()=>Response.redirect('https://evil.test'),async()=>new Response('not json',{headers:{'content-type':'application/json'}}),async()=>{throw Error('Bearer SECRET SQL');}]){
 const t=createPrivateTransport({config,fetchImpl:f});await assert.rejects(t.verifySession(input),e=>e.message==='transporte_indisponivel');}
});
test('limites finitos de tempo e bytes abortam inclusive body pendente',async()=>{
 const t=createPrivateTransport({config,timeoutMs:10,fetchImpl:()=>new Promise(()=>{})});await assert.rejects(t.verifySession(input),/transporte_indisponivel/);
 const large=createPrivateTransport({config,maxResponseBytes:32,fetchImpl:async()=>json({x:'x'.repeat(64)})});await assert.rejects(large.verifySession(input),/transporte_indisponivel/);
 const stream=createPrivateTransport({config,timeoutMs:10,fetchImpl:async()=>new Response(new ReadableStream({start(){}}),{headers:{'content-type':'application/json'}})});await assert.rejects(stream.verifySession(input),/transporte_indisponivel/);
});

test('factory privada conecta transporte fake e preserva revisão de acesso em cada consulta',async()=>{
 const {createPrivateReadHandler}=await import('./private-handler.mjs');
 const user='11111111-1111-1111-1111-111111111111', org='22222222-2222-2222-2222-222222222222', empresa='33333333-3333-3333-3333-333333333333';let count=0;
 const transport=createPrivateTransport({config,fetchImpl:async request=>{
  count++;const path=new URL(request.url).pathname;
  if(path==='/auth/v1/user')return json({id:user});
  const data=path.endsWith('/clientes')?[{id:user,status:'aprovado'}]:path.endsWith('/operacao_membros')?[{usuario_id:user,organizacao_id:org,empresa_id:null,papel:'leitura'}]:[{id:empresa,organizacao_id:org,cnpj:'11222333000181',razao_social:'Empresa fictícia',ativo:true}];
  return json(data,range());
 }});
 const handler=createPrivateReadHandler({config:{...config,enabled:true},...transport});
 const response=await handler(new Request('https://app.example.test/read',{method:'POST',headers:{Authorization:input.authorization,'content-type':'application/json'},body:JSON.stringify({ferramenta:'listar_empresas_autorizadas',organizacaoId:org})}));
 assert.equal(response.status,200);assert.equal(count,8);assert.deepEqual((await response.json()).records,[{id:empresa,nome:'Empresa fictícia'}]);
});
test('cap de mil linhas com total maior não vira carteira completa silenciosa',async()=>{
 const t=createPrivateTransport({config,fetchImpl:async()=>json(Array.from({length:1000},()=>({id:'fake'})),{'content-range':'0-999/1001','preference-applied':'count=exact'})});
 await assert.rejects(t.readRows({...input,method:'GET',resource:'operacao_empresas',query:'organizacao_id=eq.22222222-2222-2222-2222-222222222222&ativo=eq.true&select=id%2Corganizacao_id%2Crazao_social%2Ccnpj%2Cativo&order=id.asc&limit=1001'}),/transporte_indisponivel/);
});
