const test=require('node:test'),assert=require('node:assert/strict');
const decisao=require('../decisao-oportunidade'),envio=require('../enviar-resumo-edital');
const usuario='11111111-1111-4111-8111-111111111111',empresa='33333333-3333-4333-8333-333333333333';
async function ambiente(fn,{provedor=200,resultado={empresa:'Exemplo',decisao:null}}={}) {
 const original=global.fetch,antes={...process.env},chamadas=[];
 process.env.DECISAO_CLIENTE_ATIVA='1';process.env.SUPABASE_SERVICE_ROLE_KEY='teste';process.env.ZEPTOMAIL_TOKEN='teste';
 global.fetch=async(url,options={})=>{
  const body=options.body?JSON.parse(options.body):null;chamadas.push({url,body});
  if(url.includes('/rest/v1/clientes?'))return new Response(JSON.stringify([{status:'aprovado'}]));
  if(url.includes('/auth/v1/user'))return new Response(JSON.stringify({id:usuario,email:'assessor@example.com'}));
  if(url.includes('incrementar_uso'))return new Response('1');
  if(url.includes('api.zeptomail')){if(provedor==='timeout')throw Error('timeout');return new Response('{}',{status:provedor});}
  if(url.includes('criar_decisao'))return new Response('{"ok":true}');
  if(url.includes('marcar_envio'))return new Response('true');
  return new Response(JSON.stringify(resultado));
 };
 try {await fn(chamadas);} finally {global.fetch=original;for(const key of ['DECISAO_CLIENTE_ATIVA','SUPABASE_SERVICE_ROLE_KEY','ZEPTOMAIL_TOKEN']){if(antes[key]===undefined)delete process.env[key];else process.env[key]=antes[key];}}
}
const pedido=(body)=>({httpMethod:'POST',headers:{authorization:'Bearer teste'},body:JSON.stringify(body)});
test('GET apenas informa disponibilidade; consultar não grava decisão; confirmar exige revisão',async()=>ambiente(async chamadas=>{
 assert.equal((await decisao.handler({httpMethod:'GET'})).statusCode,200);assert.equal(chamadas.length,0);
 await decisao.handler(pedido({acao:'consultar',token:'a'.repeat(64)}));assert.equal(chamadas[0].body.p_decisao,null);assert.notEqual(chamadas[0].body.p_hash,'a'.repeat(64));
 assert.equal((await decisao.handler(pedido({acao:'confirmar',token:'a'.repeat(64),decisao:'participar',nome:'Dedé'}))).statusCode,400);
 assert.equal(chamadas.length,1);
}));
test('link desconhecido/expirado e conflito têm respostas distintas',async()=>{
 await ambiente(async()=>assert.equal((await decisao.handler(pedido({acao:'consultar',token:'a'.repeat(64)}))).statusCode,404),{resultado:null});
 await ambiente(async()=>assert.equal((await decisao.handler(pedido({acao:'confirmar',token:'a'.repeat(64),decisao:'participar',nome:'Dedé',confirmado:true}))).statusCode,409),{resultado:{conflito:true}});
});
const dados={destinos:'cliente@example.com',nomeDestino:'Cliente',texto:'Resumo completo',empresaId:empresa,solicitarDecisao:true,edital:{numeroControlePNCP:'11222333000181-1-1/2026',objeto:'Materiais'}};
for(const [provedor,status] of [[200,'enviado'],[400,'falhou'],['timeout','incerto']])test(`envio ${provedor} registra ${status} sem alterar o resumo`,async()=>ambiente(async chamadas=>{
 const r=await envio.handler(pedido(dados));assert.equal(r.statusCode,provedor===200?200:502);
 const criar=chamadas.find(c=>c.url.includes('criar_decisao'));assert.equal(criar.body.p_usuario,usuario);assert.equal(criar.body.p_empresa,empresa);
 const mail=chamadas.find(c=>c.url.includes('api.zeptomail'));assert.match(mail.body.htmlbody,/Resumo completo/);assert.match(mail.body.htmlbody,/Quero participar/);
 assert.equal(chamadas.find(c=>c.url.includes('marcar_envio')).body.p_status,status);
},{provedor}));
test('envio antigo não depende da infraestrutura de decisões; flag desligada recusa opt-in sem transmitir',async()=>ambiente(async chamadas=>{
 process.env.DECISAO_CLIENTE_ATIVA='0';
 assert.equal((await envio.handler(pedido({...dados,solicitarDecisao:false}))).statusCode,200);
 assert.equal(chamadas.some(c=>c.url.includes('criar_decisao')),false);
 assert.doesNotMatch(chamadas.find(c=>c.url.includes('api.zeptomail')).body.htmlbody,/Quero participar/);
 const n=chamadas.filter(c=>c.url.includes('api.zeptomail')).length;
 assert.equal((await envio.handler(pedido(dados))).statusCode,503);
 assert.equal(chamadas.filter(c=>c.url.includes('api.zeptomail')).length,n);
}));
