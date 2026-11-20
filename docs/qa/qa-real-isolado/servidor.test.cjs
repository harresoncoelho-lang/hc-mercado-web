const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {criarServidor}=require('./servidor.cjs');
const {preparar,QA}=require('./isolamento.cjs');
function req(port,route,body,headers={}){return new Promise((resolve,reject)=>{const r=http.request({hostname:'127.0.0.1',port,path:route,method:body===undefined?'GET':'POST',headers:{origin:`http://127.0.0.1:${port}`,'content-type':'application/json',...headers}},s=>{let text='';s.on('data',b=>text+=b);s.on('end',()=>resolve({status:s.statusCode,text,headers:s.headers}));});r.on('error',reject);r.end(body===undefined?undefined:JSON.stringify(body));});}
test('sessão QA só cookie, limites HTTP e estáticos sem segredo; nenhum externo',async t=>{
 const copia=preparar({authUrl:QA,restUrl:QA,storageUrl:QA,publicKey:'sb_publishable_qa_ficticia'}),calls=[];
 const s=criarServidor({copia,serviceKey:'SERVICE-SECRETA',emailsPermitidos:['qa@example.invalid'],contextos:[{empresaId:'11111111-1111-1111-1111-111111111111',processoId:'22222222-2222-2222-2222-222222222222'}],fetchImpl:async(url,op)=>{
  if(url.includes('/rest/v1/'))return Response.json([]);calls.push(url);if(url.includes('/token?'))return Response.json({access_token:'TOKEN-PRIVADO',expires_in:60,user:{id:'258eddfe-d761-4ec9-ae63-ee5e5b8db408'}});
  return Response.json({id:'qa'});
 }});
 await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>s.close(r)));const port=s.address().port;
 assert.equal((await req(port,'/',undefined,{host:'externo.invalid'})).status,403);
 assert.equal((await req(port,'/qa/login',{email:'qa@example.invalid',password:'senha'},{origin:'https://externo.invalid'})).status,403);
 assert.equal((await req(port,'/qa/login',{email:'pessoal@example.com',password:'senha'})).status,401);
 assert.equal(calls.length,0);
 const login=await req(port,'/qa/login',{email:'qa@example.invalid',password:'senha'});assert.equal(login.status,200);
 assert.match(login.headers['set-cookie'][0],/HttpOnly; SameSite=Strict/);
 const cookie=login.headers['set-cookie'][0].split(';')[0];assert.doesNotMatch(cookie,/TOKEN-PRIVADO/);
 for(const route of ['/','/demo.js','/kit-documentos-ui.js','/empresa-identificacao-ui.js','/operacao-identificacao.js','/operacao-identificacao.css','/qa/session']){const r=await req(port,route,undefined,{cookie});assert.equal(r.status,200);assert.doesNotMatch(r.text,/TOKEN-PRIVADO|SERVICE-SECRETA|senha/);assert.match(r.headers['content-security-policy'],/connect-src 'self'/);}
  for(const extra of ['outro=ficticio; '+cookie,cookie+'; outro=ficticio'])assert.equal((await req(port,'/qa/session',undefined,{cookie:extra})).status,200);
 for(const invalid of [cookie+'; '+cookie,cookie+'; qa_session=malformado','qa_session=malformado; '+cookie])assert.equal((await req(port,'/qa/session',undefined,{cookie:invalid})).status,401);
 const html=await req(port,'/');assert.match(html.text,/id="identificacao"/);
 const js=await req(port,'/demo.js');assert.match(js.text,/OperacaoIdentificacao\.montar/);assert.match(js.text,/identificacao\.abrir/);assert.match(js.text,/identificacao\?\.limpar/);
  const elements=new Map();const document={getElementById(id){if(!elements.has(id))elements.set(id,{});return elements.get(id);},documentElement:{classList:{toggle(){}}}};
 require('node:vm').runInNewContext(js.text,{document,fetch:async()=>({ok:false})});
 await new Promise(r=>setImmediate(r));assert.equal(elements.get('qa-status').textContent,'Sessão QA não confirmada; entre novamente');
 const form={elements:{email:{value:'qa@example.invalid'},password:{value:'ficticia'}}};
 require('node:vm').runInNewContext(js.text,{document,fetch:async route=>route==='/qa/login'?{ok:true}:{ok:false}});
 await elements.get('qa-login').onsubmit({preventDefault(){},currentTarget:form});
 assert.equal(elements.get('qa-status').textContent,'Sessão QA não confirmada; entre novamente');assert.equal(form.elements.password.value,'');
 assert.equal((await req(port,'/supabase-config.js')).status,404);assert.equal((await req(port,'/operacao.html')).status,404);
 assert.equal((await req(port,'/api/kit-documentos',{})).status,401);
 assert.equal((await req(port,'/api/kit-documentos',{empresaId:'outro',processoId:'outro'},{cookie})).status,403);
 assert.equal((await req(port,'/api/ia-edital',{}, {cookie})).status,404);
 const logout=await req(port,'/qa/logout',{}, {cookie});assert.equal(logout.status,200);
 assert.equal((await req(port,'/qa/session',undefined,{cookie})).status,401);
 assert.ok(calls.every(x=>x.startsWith(QA+'/auth/v1/')));
});
test('identificação usa sessão QA existente e respeita empresa negada pela fonte RLS fictícia',async t=>{
 const a={empresaId:'a1000000-0000-4000-8000-000000000002',processoId:'a1000000-0000-4000-8000-000000000003'};
 const b={empresaId:'b1000000-0000-4000-8000-000000000002',processoId:'b1000000-0000-4000-8000-000000000003'};
 const userId='258eddfe-d761-4ec9-ae63-ee5e5b8db408',calls=[];
 const copia=preparar({authUrl:QA,restUrl:QA,storageUrl:QA,publicKey:'sb_publishable_qa_ficticia'});
 const s=criarServidor({copia,serviceKey:'SERVICE-SECRETA',emailsPermitidos:['operador-a@qa.invalid'],contextos:[a,b],fetchImpl:async(url,op)=>{
  const u=new URL(url);calls.push(u.pathname);
  if(u.pathname==='/auth/v1/token')return Response.json({access_token:'TOKEN-A',expires_in:60,user:{id:userId}});
  assert.equal(new Headers(op.headers).get('authorization'),'Bearer TOKEN-A');
  if(u.pathname==='/auth/v1/user')return Response.json({id:userId});
  if(u.pathname==='/rest/v1/clientes')return Response.json([{id:userId,status:'aprovado'}]);
  if(u.pathname==='/rest/v1/rpc/identificacao_empresa_habilitada')return Response.json(true);
  if(u.pathname==='/rest/v1/operacao_empresas')return Response.json(u.searchParams.get('id')==='eq.'+a.empresaId?[{id:a.empresaId,organizacao_id:'a1000000-0000-4000-8000-000000000001',razao_social:'FICTÍCIA A',cnpj:'11222333000181'}]:[]);
  if(['/rest/v1/operacao_identificacao_empresa','/rest/v1/operacao_documentos'].includes(u.pathname))return Response.json([]);
  throw Error('Destino inesperado');
 }});
 await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>s.close(r)));const port=s.address().port;
 const login=await req(port,'/qa/login',{email:'operador-a@qa.invalid',password:'qa'});const cookie=login.headers['set-cookie'][0].split(';')[0];
 const consultar=id=>req(port,'/api/empresa-identificacao',{acao:'consultar',empresaId:id},{cookie});
 const propria=await consultar(a.empresaId);assert.equal(propria.status,200);assert.equal(JSON.parse(propria.text).empresa.id,a.empresaId);assert.equal(JSON.parse(propria.text).perfil,null);
 const negada=await consultar(b.empresaId);assert.equal(negada.status,404);assert.doesNotMatch(negada.text,/FICTÍCIA A|TOKEN-A|SERVICE-SECRETA/);
 assert.ok(calls.includes('/auth/v1/user'));assert.ok(!calls.includes('/rest/v1/rpc/confirmar_identificacao_empresa'));
});

test('cookie de login anterior não autentica nova instância após reinício',async t=>{ // Sem reutilizar socket HTTP do processo encerrado: aqui validamos o cookie, não keep-alive.
 const req=(port,route,body,headers={})=>new Promise((resolve,reject)=>{const r=http.request({agent:false,hostname:'127.0.0.1',port,path:route,method:body===undefined?'GET':'POST',headers:{origin:`http://127.0.0.1:${port}`,'content-type':'application/json',...headers}},s=>{let text='';s.on('data',b=>text+=b);s.on('end',()=>resolve({status:s.statusCode,text,headers:s.headers}));});r.on('error',reject);r.end(body===undefined?undefined:JSON.stringify(body));});
 const copia=preparar({authUrl:QA,restUrl:QA,storageUrl:QA,publicKey:'sb_publishable_qa_ficticia'});
 let chamadas=0;
 const criar=()=>criarServidor({copia,serviceKey:'FICTICIA',emailsPermitidos:['operador-a@qa.invalid'],contextos:[{empresaId:'a1000000-0000-4000-8000-000000000002',processoId:'a1000000-0000-4000-8000-000000000003'}],fetchImpl:async url=>{if(url.includes('/rest/v1/'))return Response.json([]);chamadas++;assert.equal(url,QA+'/auth/v1/token?grant_type=password');return Response.json({access_token:'TOKEN-FICTICIO',expires_in:60,user:{id:'258eddfe-d761-4ec9-ae63-ee5e5b8db408'}});}});
 const primeiro=criar();await new Promise(r=>primeiro.listen(0,'127.0.0.1',r));
 const porta=primeiro.address().port;assert.notEqual(porta,53820);
 let cookie;
 try{
  const login=await req(porta,'/qa/login',{email:'operador-a@qa.invalid',password:'FICTICIA'});assert.equal(login.status,200);
  cookie=login.headers['set-cookie'][0].split(';')[0];assert.equal((await req(porta,'/qa/session',undefined,{cookie})).status,200);
 }finally{await new Promise(r=>primeiro.close(r));}
 const segundo=criar();await new Promise(r=>segundo.listen(porta,'127.0.0.1',r));t.after(()=>new Promise(r=>segundo.close(r)));
 assert.equal((await req(porta,'/qa/session',undefined,{cookie})).status,401);
 assert.equal((await req(porta,'/api/kit-documentos',{acao:'listar',empresaId:'a1000000-0000-4000-8000-000000000002',processoId:'a1000000-0000-4000-8000-000000000003'},{cookie})).status,401);
 assert.equal(chamadas,1,'cookie órfão não deve consultar fonte externa');
 const novoLogin=await req(porta,'/qa/login',{email:'operador-a@qa.invalid',password:'FICTICIA'});assert.equal(novoLogin.status,200);
 const novoCookie=novoLogin.headers['set-cookie'][0].split(';')[0];assert.notEqual(novoCookie,cookie);
 assert.equal((await req(porta,'/qa/session',undefined,{cookie:novoCookie})).status,200);
 assert.equal((await req(porta,'/qa/session',undefined,{cookie})).status,401);assert.equal(chamadas,2);
});
