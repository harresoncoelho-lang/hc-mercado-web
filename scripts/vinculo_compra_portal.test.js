const test=require('node:test'),assert=require('node:assert/strict');
const {criarHandler}=require('../netlify/functions/vinculo-compra-portal');
const id='11111111-1111-4111-8111-111111111111';
const base={acao:'confirmar',empresaId:id,processoId:id,versaoEsperada:0,processoSnapshot:'a'.repeat(32),dados:{ano:'2026',numero:'41',compra:'78882005000412026',url:'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/cadastro-propostas?compra=78882005000412026'}};
test('caller autenticado encaminha contrato sem revisor/CNPJ fornecidos',async()=>{
 let sent;const h=criarHandler({autenticar:async()=>({ok:true,userId:id}),contexto:async()=>({request:async(path,options)=>{sent={path,body:JSON.parse(options.body)};return{json:async()=>({status:200,vinculo:{versao:1}})};}})});
 const r=await h({httpMethod:'POST',headers:{},body:JSON.stringify(base)});assert.equal(r.statusCode,200);assert.equal(sent.body.p_processo,id);assert.equal(sent.body.userId,undefined);
 for(const invalid of [{...base,revisor:id},{...base,dados:{...base.dados,url:'https://evil.test'}},{...base,versaoEsperada:-1}])assert.equal((await h({httpMethod:'POST',body:JSON.stringify(invalid)})).statusCode,400);
});
test('sessão alterada e conflito CAS não viram confirmação',async()=>{
 let calls=0;const h=criarHandler({autenticar:async()=>({ok:true,userId:++calls===1?id:'outro'}),contexto:async()=>({request:()=>{throw Error('Não deve gravar');}})});
 assert.equal((await h({httpMethod:'POST',body:JSON.stringify(base)})).statusCode,403);
 const conflict=criarHandler({autenticar:async()=>({ok:true,userId:id}),contexto:async()=>({request:async()=>({json:async()=>({status:409,erro:'Alterado'})})})});
 assert.equal((await conflict({httpMethod:'POST',body:JSON.stringify(base)})).statusCode,409);
});

test('rota Cloudflare real encaminha handler e recusa fora da allowlist',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');let observed;
 const handler=criarHandler({autenticar:async()=>({ok:true,userId:id}),contexto:async()=>({request:async(path,options)=>{observed=JSON.parse(options.body);return{json:async()=>({status:200,versao:1})};}})});
 let source=fs.readFileSync(require.resolve('../functions/api/[nome].js'),'utf8');
 const scope={Response,process:{env:{}},executarHandler:require('../netlify/functions/_adaptador_cloudflare').executarHandler};
 for(const match of source.matchAll(/import \* as (\w+) from "([^"]+)";/g))scope[match[1]]=match[1]==='vinculoCompraPortal'?{handler}:{};
 source=source.replace(/^import .*;$/gm,'').replace('export async function onRequest','async function onRequest');vm.createContext(scope);vm.runInContext(source,scope);
 const request=new Request('https://example.test/api/vinculo-compra-portal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(base)});
 const result=await scope.onRequest({params:{nome:'vinculo-compra-portal'},env:{},request});assert.equal(result.status,200);assert.equal(observed.p_processo,id);
 assert.equal((await scope.onRequest({params:{nome:'nao-permitido'},env:{},request})).status,404);
});

test('UI real usa rota restrita, campos separados e texto seguro no status',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');const html=fs.readFileSync(require.resolve('../processos.html'),'utf8');
 const start=html.indexOf('  async function montarVinculoCompra(p){'),end=html.indexOf('  async function visualizarRelatorio',start);
 const events={};const status={textContent:''};const elements=Object.fromEntries(['url','compra','numero','ano','conferido'].map(key=>[key,{value:'',checked:false,addEventListener(){}}]));
 const form={elements,hidden:true,addEventListener(name,fn){events[name]=fn;}};
 const alvo={isConnected:true,innerHTML:'',querySelector:selector=>selector==='form'?form:status};let requested;
 const session={user:{id},access_token:'fixture'};
 const scope={estado:{empresaId:id},$:key=>key==='d-vinculo-compra'?alvo:{dataset:{processoId:id}},sb:{auth:{getSession:async()=>({data:{session}})}},fetch:async(url)=>{requested=url;return{ok:true,json:async()=>({versao:0,processoSnapshot:'a'.repeat(32),cnpj:'12345678000195',uasg:'788820',sistema:'<img src=x onerror=alert(1)>'})};},Error};
 vm.createContext(scope);vm.runInContext(html.slice(start,end),scope);await scope.montarVinculoCompra({id});
 assert.equal(requested,'/api/vinculo-compra-portal');assert.match(status.textContent,/<img/);assert.doesNotMatch(alvo.innerHTML,/<img/);assert.equal(form.hidden,false);
 assert.match(html,/name="url_origem"/);assert.match(alvo.innerHTML,/name="url"/);
});

test('SQL contém CAS e invalidação de CNPJ/organização; contrato estático, não execução PostgreSQL',()=>{
 const sql=require('node:fs').readFileSync(require.resolve('../supabase/vinculo_compra_portal.sql'),'utf8');
 assert.match(sql,/p_versao is distinct from coalesce\(v.versao,0\)/);assert.match(sql,/p_snapshot is distinct from fingerprint/);
 assert.match(sql,/NEW.cnpj,NEW.organizacao_id,NEW.ativo/);assert.match(sql,/v.cnpj_revisado<>current_cnpj/);
 assert.match(sql,/for share/);assert.match(sql,/for update/);assert.match(sql,/revoke all on public.operacao_vinculos_compra from anon,authenticated/);
});

test('migração real PGlite efêmera: confirmar, replay CAS, CNPJ/processo invalidado e acesso negado',async()=>{
 const {PGlite}=require('@electric-sql/pglite');
 const db=new PGlite();
 try{
  await db.exec(`create role anon; create role authenticated; create schema auth;
   create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   create table public.operacao_empresas(id uuid primary key,organizacao_id uuid,cnpj text,ativo boolean);
   create table public.operacao_processos(id uuid primary key,empresa_id uuid,organizacao_id uuid,sistema text,uasg text,numero text,url_origem text);
   create table public.operacao_membros(usuario_id uuid,organizacao_id uuid,empresa_id uuid,papel text);
   create table public.clientes(id uuid,status text);
   insert into auth.users values('${id}'); insert into clientes values('${id}','aprovado');
   insert into operacao_empresas values('${id}','${id}','12.345.678/0001-95',true);
   insert into operacao_processos values('${id}','${id}','${id}','Compras.gov.br','788820','41/2026','https://pncp.gov.br/fixture');
   insert into operacao_membros values('${id}','${id}',null,'gestor');`);
  await db.exec(require('node:fs').readFileSync(require.resolve('../supabase/vinculo_compra_portal.sql'),'utf8'));
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
  await db.exec('set role authenticated');
  const rpc=async(acao,version=null,snapshot=null)=> (await db.query('select public.operacao_vinculo_compra($1,$2,$3,$4,$5,$6) as result',[id,id,acao,version,snapshot,base.dados])).rows[0].result;
  let state=await rpc('consultar');assert.equal(state.versao,0);
  assert.equal((await rpc(null,state.versao,state.processoSnapshot)).status,403);
  assert.equal((await rpc('consultar')).versao,0);
  const saved=await rpc('confirmar',state.versao,state.processoSnapshot);assert.equal(saved.status,200);assert.equal(saved.vinculo.cnpj_revisado,'12345678000195');assert.equal(saved.vinculo.revisado_por,id);
  assert.equal((await rpc('confirmar',state.versao,state.processoSnapshot)).status,409);
  await assert.rejects(db.query('select * from public.operacao_vinculos_compra'));
  await db.exec("reset role; update operacao_empresas set cnpj='11.222.333/0001-81'; set role authenticated;");
  state=await rpc('consultar');assert.ok(state.vinculo.invalidado_em);assert.equal(state.versao,2);assert.equal(state.cnpj,'11222333000181');
  assert.equal((await rpc('confirmar',1,saved.processoSnapshot)).status,409);
  assert.equal((await rpc('confirmar',state.versao,state.processoSnapshot)).status,200);
  await assert.rejects(db.query('select * from public.operacao_vinculos_compra_historico'));
  await db.exec('reset role');
  const history=(await db.query('select snapshot from operacao_vinculos_compra_historico order by versao')).rows;
  assert.equal(history.length,2);assert.equal(history[0].snapshot.cnpj_revisado,'12345678000195');
  assert.ok(history[1].snapshot.invalidado_em);assert.equal(history[1].snapshot.motivo_invalidacao,'Empresa alterada');
  await db.exec('set role authenticated');
  await db.exec("reset role; update operacao_processos set uasg='123456'; set role authenticated;");
  state=await rpc('consultar');assert.ok(state.vinculo.invalidado_em);assert.equal(state.versao,4);
  await db.exec("reset role; update operacao_membros set papel='leitura'; set role authenticated;");
  assert.equal((await rpc('consultar')).status,403);
  await db.exec("reset role; update operacao_membros set papel='gestor'; update operacao_empresas set organizacao_id='22222222-2222-4222-8222-222222222222'; set role authenticated;");
  assert.equal((await rpc('consultar')).status,403);
  await db.exec('reset role');
  const orgState=(await db.query('select invalidado_em,motivo_invalidacao from operacao_vinculos_compra')).rows[0];
  assert.ok(orgState.invalidado_em);assert.equal(orgState.motivo_invalidacao,'Empresa alterada');
  await db.exec('set role authenticated');
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");await db.exec('set role authenticated');assert.equal((await rpc('consultar')).status,403);
 }finally{await db.close();}
});
