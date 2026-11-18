const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('C:/Users/harre/AppData/Local/LicitaPlena/qa-postgres/node_modules/@electric-sql/pglite');
// PGlite em memória executa SQL real, mas serializa operações: não ensaia locks entre sessões.
// Usa migrações preservadas do repositório, não comprova paridade com banco remoto atual.
test('baseline operacional preservada: vínculo, escopo por empresa, revogação e triggers',async()=>{
 const db=new PGlite();const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const sql=name=>fs.readFileSync(path.join(__dirname,'../supabase',name),'utf8');
 const as=async(uid)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec('set role authenticated');};
 const dados={numero:'41',ano:'2026',compra:'78882005000412026',url:'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/cadastro-propostas?compra=78882005000412026'};
 const rpc=async(empresa=11,proc=21,acao='consultar',state=null)=>(await db.query('select operacao_vinculo_compra($1,$2,$3,$4,$5,$6) as r',[id(empresa),id(proc),acao,state?.versao??null,state?.processoSnapshot??null,dados])).rows[0].r;
 try{
  // Mesma preparação de auth/storage do harness testar-kit-persistencia-local.cjs.
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create table auth.users(id uuid primary key,email text);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create schema storage;create table storage.buckets(id text primary key,name text,public boolean);
   create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
   alter table storage.objects enable row level security;
   create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
   create table public.clientes(id uuid primary key,status text,nome text,empresa text,cnpj text);
   create table public.admins(email text,role text);
   grant usage on schema auth,storage,public to anon,authenticated,service_role;
   grant execute on function auth.uid() to anon,authenticated,service_role;`);
  for(const file of ['operacao_licitacoes.sql','operacao_acompanhamento.sql','limite_cnpjs_operacao.sql','acesso_empresa_convites.sql','identificacao_empresa.sql','seguranca_operacao.sql','kit_documentos.sql'])await db.exec(sql(file));
  await db.exec(sql('vinculo_compra_portal.sql'));
  for(const n of [101,102,103]){await db.query('insert into auth.users values($1,$2)',[id(n),`fixture${n}@example.invalid`]);await db.query("insert into clientes(id,status) values($1,'aprovado')",[id(n)]);}
  await db.query("insert into operacao_organizacoes(id,nome,owner_id) values($1,'Org A',$3),($2,'Org B',$4)",[id(1),id(2),id(101),id(103)]);
  for(const [n,org,cnpj] of [[11,1,'11222333000181'],[12,1,'11222333000262'],[13,2,'11222333000343']])await db.query("insert into operacao_empresas(id,organizacao_id,razao_social,cnpj) values($1,$2,'Fictícia',$3)",[id(n),id(org),cnpj]);
  await db.query("insert into operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values($1,$3,'gestor',null),($1,$4,'operador',$5),($2,$6,'gestor',null)",[id(1),id(2),id(101),id(102),id(11),id(103)]);
  for(const [n,empresa,org] of [[21,11,1],[22,12,1],[23,13,2]])await db.query("insert into operacao_processos(id,empresa_id,organizacao_id,objeto,sistema,uasg,numero,url_origem) values($1,$2,$3,'Objeto fictício','Compras.gov.br','788820','41/2026','https://pncp.gov.br/fixture')",[id(n),id(empresa),id(org)]);
  await as(id(102));let state=await rpc();assert.equal(state.status,200);const saved=await rpc(11,21,'confirmar',state);assert.equal(saved.status,200);
  assert.equal((await rpc(12,22)).status,403);assert.equal((await rpc(13,23)).status,403);assert.equal((await rpc(11,22)).status,404);
  assert.equal((await rpc(11,21,'confirmar',state)).status,409);
  await assert.rejects(db.query('select * from operacao_vinculos_compra'));await assert.rejects(db.query('select * from operacao_vinculos_compra_historico'));
  await db.exec('reset role');await db.query("update clientes set status='pendente' where id=$1",[id(102)]);await as(id(102));assert.equal((await rpc()).status,403);
  await db.exec('reset role');await db.query("update clientes set status='aprovado' where id=$1",[id(102)]);
  await db.query("update operacao_processos set numero='42/2026' where id=$1",[id(21)]);await as(id(102));state=await rpc();assert.ok(state.vinculo.invalidado_em);assert.equal(state.versao,2);
  assert.equal((await rpc(11,21,'confirmar',saved)).status,409);
  assert.equal((await rpc(11,21,'confirmar',state)).status,200);
  await db.exec('reset role');await db.query("update operacao_empresas set cnpj='12345678000195' where id=$1",[id(11)]);await as(id(102));state=await rpc();assert.ok(state.vinculo.invalidado_em);assert.equal(state.cnpj,'12345678000195');
  await db.exec('reset role');const history=(await db.query('select snapshot from operacao_vinculos_compra_historico order by versao')).rows;assert.equal(history.length,3);assert.equal(history[1].snapshot.motivo_invalidacao,'Processo alterado');
 }finally{await db.close();}
});
