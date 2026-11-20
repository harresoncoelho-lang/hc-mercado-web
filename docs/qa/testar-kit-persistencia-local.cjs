// PostgreSQL em memória, somente fixtures fictícias; não usa rede nem credenciais.
// Execute explicitamente: PGLITE_MODULE_PATH aponta para uma instalação existente.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
async function testarPersistencia() {
 let PGlite;
 try{({PGlite}=require(process.env.PGLITE_MODULE_PATH||'@electric-sql/pglite'));}
 catch(e){throw new Error('PGlite indisponível. Defina PGLITE_MODULE_PATH para uma instalação existente ou disponibilize @electric-sql/pglite. O gate SQL não foi executado.',{cause:e});}
 const db = new PGlite();let checks=0;
 const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const org=id(1),otherOrg=id(2),empresa=id(11),outra=id(12),externa=id(13),proc=id(21),outroProc=id(22),doc=id(31),doc2=id(32),owner=id(101),operator=id(102),reader=id(103),outsider=id(104),item=id(201);
 const sql=name=>fs.readFileSync(path.join(__dirname,'../../supabase',name),'utf8');
 const ok=(a,b)=>{assert.deepEqual(a,b);checks++;};
 const deny=async(fn,code)=>{await assert.rejects(fn,e=>e.code===code);checks++;};
 const role=async(name,uid='')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec('set role '+name);};
 const dados={declaracao:{titulo:'Declaração fictícia',texto:'',fonte:''}};
 const args=(patch={})=>({p_documento:doc,p_empresa:empresa,p_processo:proc,p_organizacao:org,p_usuario:operator,p_versao:0,p_tipo:'declaracao',p_acao:'salvar',p_dados:dados,p_hash:null,p_previa:null,...patch});
 const rpc=async patch=>{const p=args(patch);return (await db.query(`select to_jsonb(public.gravar_kit_documento(${Object.keys(p).map((k,i)=>k+'=> $'+(i+1)).join(',')})) as r`,Object.values(p))).rows[0].r;};
 try{
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
  for(const f of ['operacao_licitacoes.sql','operacao_acompanhamento.sql','limite_cnpjs_operacao.sql','acesso_empresa_convites.sql','identificacao_empresa.sql','seguranca_operacao.sql'])await db.exec(sql(f));
  await db.exec('grant select on all tables in schema public to authenticated;');
  assert(fs.existsSync(path.join(__dirname,'../../supabase/kit_documentos.sql')),'Migração de peças persistentes deve existir');
  await db.exec(sql('kit_documentos.sql'));await db.exec(sql('kit_documentos.sql'));checks+=2;
  for(const user of [owner,operator,reader,outsider]){await db.query('insert into auth.users values($1,$2)',[user,user+'@example.invalid']);await db.query("insert into clientes(id,status) values($1,'aprovado')",[user]);}
  await db.query("insert into operacao_organizacoes(id,nome,owner_id) values($1,'Fictícia A',$3),($2,'Fictícia B',$4)",[org,otherOrg,owner,outsider]);
  await db.query("insert into operacao_empresas(id,organizacao_id,razao_social,cnpj) values($1,$4,'Fictícia A','11222333000181'),($2,$4,'Fictícia B','11222333000262'),($3,$5,'Fictícia C','11222333000343')",[empresa,outra,externa,org,otherOrg]);
  await db.query("insert into operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values($1,$4,'gestor',null),($1,$5,'operador',$3),($1,$6,'leitura',$3),($2,$7,'gestor',null)",[org,otherOrg,empresa,owner,operator,reader,outsider]);
  await db.query("insert into operacao_processos(id,organizacao_id,empresa_id,objeto) values($1,$3,$4,'Fictício A'),($2,$3,$5,'Fictício B')",[proc,outroProc,org,empresa,outra]);
  await db.query("insert into operacao_itens_resultado(id,organizacao_id,processo_id,identificador) values($1,$2,$3,'1')",[item,org,proc]);
  await role('service_role');
  const first=await rpc();ok(first.versao,1);ok(first.dados,dados);ok((await rpc()).id,doc);
  ok((await rpc({p_documento:doc2})).versao,1);
  ok((await rpc({p_dados:{declaracao:{fonte:'',texto:'',titulo:'Declaração fictícia'}}})).id,doc);
  const race=await Promise.allSettled(['Aba A','Aba B'].map(titulo=>rpc({p_documento:doc2,p_versao:1,p_dados:{declaracao:{titulo}}})));
  ok(race.filter(r=>r.status==='fulfilled').length,1);ok(race.find(r=>r.status==='rejected').reason.code,'PT409');
  await deny(()=>db.query('update public.operacao_kit_documentos set versao=99'),'42501');
  await deny(()=>db.query('delete from public.operacao_kit_documentos'),'42501');
  await deny(()=>rpc({p_dados:{declaracao:{titulo:'Outra intenção'}}}),'PT409');
  await deny(()=>rpc({p_usuario:owner}),'PT409');
  await deny(()=>rpc({p_empresa:outra,p_processo:outroProc}),'PT403');
  await deny(()=>rpc({p_empresa:outra,p_processo:proc,p_usuario:owner}),'PT404');
  await deny(()=>rpc({p_usuario:reader}),'PT403');await deny(()=>rpc({p_usuario:outsider}),'PT403');
  await deny(()=>rpc({p_acao:'confirmarRevisao',p_versao:1,p_hash:'x',p_previa:{texto:'x',fontes:[]}}),'PT400');
  const reviewed=await rpc({p_acao:'confirmarRevisao',p_versao:1,p_hash:'a'.repeat(64),p_previa:{texto:'Prévia fictícia',fontes:['Fictícia']}});ok(reviewed.revisado_por,operator);ok(reviewed.revisao_versao,1);
  const newer=await rpc({p_versao:1,p_dados:{declaracao:{titulo:'Atualizada',texto:'',fonte:''}}});ok(newer.versao,2);ok(newer.revisao_hash,null);ok(newer.revisado_por,null);
  await deny(()=>rpc({p_versao:1}),'PT409');await deny(()=>rpc(),'PT409');
  await deny(()=>rpc({p_acao:'confirmarRevisao',p_versao:1,p_hash:'a'.repeat(64),p_previa:{texto:'Prévia fictícia',fontes:[]}}),'PT409');
  await deny(()=>rpc({p_versao:2,p_tipo:'proposta',p_dados:{proposta:{itemIds:[],unidades:{}}}}),'PT409');
  for(const invalid of [{declaracao:{titulo:23}},{declaracao:{texto:'x'.repeat(20001)}},{declaracao:{cnpj:'forjado'}},{proposta:{itemIds:[item,item]}},{proposta:{itemIds:[id(999)],unidades:{}}},{proposta:{itemIds:[],unidades:{[item]:'un'}}}])await deny(()=>rpc({p_documento:id(90),p_tipo:invalid.proposta?'proposta':'declaracao',p_dados:invalid}),invalid.proposta?.itemIds?.[0]===id(999)?'PT404':'PT400');
  await role('postgres');await db.query("update clientes set status='pendente' where id=$1",[operator]);await role('service_role');await deny(()=>rpc({p_versao:2}),'PT403');
  await role('postgres');await db.query("update clientes set status='aprovado' where id=$1",[operator]);await db.query('update operacao_empresas set ativo=false where id=$1',[empresa]);await role('service_role');await deny(()=>rpc({p_versao:2}),'PT403');
  await role('postgres');await db.query('update operacao_empresas set ativo=true where id=$1',[empresa]);
  for(const who of [operator,reader,owner]){await role('authenticated',who);ok((await db.query('select id from operacao_kit_documentos')).rows.length,2);
   await deny(()=>db.query('update operacao_kit_documentos set versao=99'),'42501');await deny(()=>db.query('delete from operacao_kit_documentos'),'42501');await deny(()=>db.query('insert into operacao_kit_documentos select * from operacao_kit_documentos'),'42501');await deny(()=>rpc(),'42501');}
  await role('authenticated',outsider);ok((await db.query('select id from operacao_kit_documentos')).rows.length,0);
  await role('postgres');await db.query("update clientes set status='pendente' where id=$1",[operator]);await role('authenticated',operator);ok((await db.query('select id from operacao_kit_documentos')).rows.length,0);
  await role('postgres');await db.query("update clientes set status='aprovado' where id=$1",[operator]);await db.query('update operacao_empresas set ativo=false where id=$1',[empresa]);await role('authenticated',operator);ok((await db.query('select id from operacao_kit_documentos')).rows.length,0);
  await role('postgres');await db.query('update operacao_empresas set ativo=true where id=$1',[empresa]);
  await role('anon');await deny(()=>db.query('select id from operacao_kit_documentos'),'42501');await deny(()=>rpc(),'42501');
  await role('postgres');await deny(()=>db.query('update operacao_kit_documentos set empresa_id=$1 where id=$2',[outra,doc]),'PT409');
  await deny(()=>db.query("insert into operacao_kit_documentos(id,organizacao_id,empresa_id,processo_id,tipo,dados,criado_por,atualizado_por) values($1,$2,$3,$4,'declaracao',$5,$6,$6)",[id(95),org,outra,proc,dados,owner]),'23503');
  const checksOriginais=checks;
  // Reproduz a lacuna anterior sem expor conteúdo: readiness de identificação não verifica o kit.
  await db.exec('begin; alter table public.operacao_kit_documentos disable row level security');
  try{
   await role('authenticated',outsider);
   ok((await db.query('select public.identificacao_empresa_habilitada() as pronto')).rows[0].pronto,true);
   ok((await db.query('select count(*)::integer as total from public.operacao_kit_documentos')).rows[0].total,2);
  }finally{await db.exec('rollback');await role('postgres');}
  console.log(`Lacuna reproduzida somente na fixture: readiness=true com RLS do kit desligada; outsider lê 2 peças. ${checksOriginais} verificações originais aprovadas.`);
  assert(fs.existsSync(path.join(__dirname,'../../supabase/verificar_kit_prepublicacao.sql')),'Gate somente leitura do kit deve existir');
  const gate=sql('verificar_kit_prepublicacao.sql');
  const verificar=async()=>{
   const result=await db.exec(gate);
   ok(result.flatMap(r=>r.rows).some(r=>r.status==='KIT_PREPUBLICACAO_OK'),true);
  };
  // O próprio PostgreSQL recusa escritas do verificador em uma transação somente leitura.
  await db.exec('begin read only');
  try{await verificar();}finally{await db.exec('rollback');}
  const assinatura='public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb)';
  const casos=[
   ['tabela ausente', 'alter table public.operacao_kit_documentos rename to kit_ausente', /tabela/i],
   ['RLS desligada', 'alter table public.operacao_kit_documentos disable row level security', /RLS/i],
   ['policy ausente', 'drop policy operacao_kit_documentos_select_empresa on public.operacao_kit_documentos', /policy/i],
   ['policy adicional', 'create policy permissiva_extra on public.operacao_kit_documentos for select to authenticated using(true)', /policy/i],
   ['policy conhecida permissiva', 'alter policy operacao_kit_documentos_select_empresa on public.operacao_kit_documentos using(true)', /policy/i],
   ['policy OR true', "alter policy operacao_kit_documentos_select_empresa on public.operacao_kit_documentos using(public.pode_acessar_empresa_operacao(organizacao_id,empresa_id) or true)", /policy/i],
   ['search_path precede pg_catalog', 'set local search_path=public,pg_catalog', /search_path/i],
   ['policy com helper homônimo', `create schema kit_shadow;
    create function kit_shadow.pode_acessar_empresa_operacao(uuid,uuid) returns boolean language sql as $$select true$$;
    alter policy operacao_kit_documentos_select_empresa on public.operacao_kit_documentos using(
     kit_shadow.pode_acessar_empresa_operacao(organizacao_id,empresa_id)
     and exists(select 1 from public.clientes c where c.id=auth.uid() and c.status='aprovado')
     and exists(select 1 from public.operacao_empresas e where e.id=operacao_kit_documentos.empresa_id and e.organizacao_id=operacao_kit_documentos.organizacao_id and e.ativo));
    set local search_path=kit_shadow,public`, /policy/i],
   ['policy para PUBLIC', 'alter policy operacao_kit_documentos_select_empresa on public.operacao_kit_documentos to public', /policy/i],
   ['SELECT público', 'grant select on public.operacao_kit_documentos to public', /privil.gio/i],
   ['SELECT obrigatório ausente', 'revoke select on public.operacao_kit_documentos from authenticated', /privil.gio/i],
   ['coluna SELECT para anon', 'grant select(dados) on public.operacao_kit_documentos to anon', /privil.gio/i],
   ['DML herdado', 'create role kit_editor; grant update on public.operacao_kit_documentos to kit_editor; grant kit_editor to authenticated', /privil.gio/i],
   ['RPC ausente', `alter function ${assinatura} rename to gravar_kit_ausente`, /RPC/i],
   ['RPC sobrecarregada', 'create function public.gravar_kit_documento(text) returns text language sql as $$select $1$$', /RPC/i],
   ['RPC sem definer', `alter function ${assinatura} security invoker`, /RPC/i],
   ['RPC search_path inseguro', `alter function ${assinatura} set search_path=public`, /RPC/i],
   ['RPC service_role sem EXECUTE', `revoke execute on function ${assinatura} from service_role`, /RPC.*EXECUTE/i],
   ['trigger desligado', 'alter table public.operacao_kit_documentos disable trigger kit_documento_escopo_imutavel', /trigger/i],
   ['trigger ausente', 'drop trigger kit_documento_escopo_imutavel on public.operacao_kit_documentos', /trigger/i],
   ['trigger adicional', 'create trigger kit_extra before update on public.operacao_kit_documentos for each row execute function public.kit_documento_escopo_imutavel()', /trigger/i],
   ['trigger função search_path inseguro', 'alter function public.kit_documento_escopo_imutavel() set search_path=public', /trigger/i],
   ['trigger função EXECUTE público', 'grant execute on function public.kit_documento_escopo_imutavel() to public', /trigger.*EXECUTE/i]
  ];
  for(const quem of ['public','anon','authenticated','service_role']){
   for(const privilegio of ['insert','update','delete','truncate','references','trigger'])casos.push([`${privilegio} para ${quem}`,`grant ${privilegio} on public.operacao_kit_documentos to ${quem}`,/privil.gio/i]);
   for(const privilegio of ['insert','update','references'])casos.push([`${privilegio} por coluna para ${quem}`,`grant ${privilegio}(dados) on public.operacao_kit_documentos to ${quem}`,/privil.gio/i]);
  }
  for(const quem of ['public','anon','authenticated'])casos.push([`RPC EXECUTE para ${quem}`,`grant execute on function ${assinatura} to ${quem}`,/RPC.*EXECUTE/i]);
  for(const [nome,desconfigurar,diagnostico] of casos){
   await db.exec('begin');
   try{
    await db.exec(desconfigurar);
    await assert.rejects(()=>db.exec(gate),e=>e.code==='P0001'&&/Kit pré-publicação:/.test(e.message)&&diagnostico.test(e.message),nome);
    checks++;
   }finally{await db.exec('rollback');}
   await verificar();
  }
  const checksSemDefaults=checks;
  const registros=()=>db.query('select to_jsonb(d) as documento from public.operacao_kit_documentos d order by id').then(r=>r.rows);
  const preservados=await registros();
  // Somente nesta fixture em memória: recria o kit com os defaults permissivos do Supabase.
  await db.exec(`drop table public.operacao_kit_documentos cascade;
   drop function public.kit_documento_escopo_imutavel();
   create role supabase_admin superuser;create role "kit default extra";
   alter default privileges for role supabase_admin in schema public grant all on tables to postgres,anon,authenticated,service_role;
   alter default privileges for role supabase_admin in schema public grant execute on functions to postgres,anon,authenticated,service_role;
   alter default privileges for role supabase_admin in schema public grant all on tables to "kit default extra" with grant option;
   alter default privileges for role supabase_admin in schema public grant execute on functions to "kit default extra" with grant option;
   set role supabase_admin;
   create table public.kit_acl_controle(valor text);insert into public.kit_acl_controle values('preservar');
   create function public.kit_acl_controle() returns text language sql as $$select 'preservar'::text$$;`);
  const ambiente=()=>db.query(`select
   (select jsonb_agg(to_jsonb(d) order by oid) from pg_catalog.pg_default_acl d) as defaults,
   (select jsonb_agg(jsonb_build_array(rolname,rolsuper,rolbypassrls,rolinherit) order by rolname) from pg_catalog.pg_roles) as papeis,
   (select jsonb_agg(to_jsonb(m) order by roleid,member) from pg_catalog.pg_auth_members m) as associacoes,
   (select jsonb_build_array(relowner,relacl) from pg_catalog.pg_class where oid='public.kit_acl_controle'::regclass) as tabela,
   (select jsonb_build_array(proowner,proacl) from pg_catalog.pg_proc where oid='public.kit_acl_controle()'::regprocedure) as funcao,
   (select valor from public.kit_acl_controle) as dado,public.kit_acl_controle() as retorno`).then(r=>r.rows);
  const ambientePreservado=await ambiente();
  const donos=()=>db.query(`select pg_catalog.pg_get_userbyid(relowner) as dono from pg_catalog.pg_class where oid='public.operacao_kit_documentos'::regclass
   union all select pg_catalog.pg_get_userbyid(proowner) from pg_catalog.pg_proc where oid in ('${assinatura}'::regprocedure,'public.kit_documento_escopo_imutavel()'::regprocedure)`).then(r=>r.rows);
  const verificarDefaults=async()=>{
   await db.exec('begin read only;set local search_path=pg_catalog,public');
   try{await verificar();}finally{await db.exec('rollback');}
   ok(await donos(),[{dono:'supabase_admin'},{dono:'supabase_admin'},{dono:'supabase_admin'}]);
   ok(await ambiente(),ambientePreservado);
  };
  await db.exec(sql('kit_documentos.sql'));
  await verificarDefaults();
  await db.query('insert into public.operacao_kit_documentos select * from jsonb_populate_recordset(null::public.operacao_kit_documentos,$1)',[JSON.stringify(preservados.map(r=>r.documento))]);
  // A reaplicação também corrige ACL direta antiga sem perder conteúdo, autoria ou versão.
  await db.exec(`grant all on public.operacao_kit_documentos to postgres,"kit default extra" with grant option;
   grant execute on function ${assinatura} to postgres,"kit default extra" with grant option;
   grant execute on function public.kit_documento_escopo_imutavel() to postgres,service_role,"kit default extra" with grant option;`);
  for(let rodada=0;rodada<2;rodada++){
   await db.exec(sql('kit_documentos.sql'));
   await verificarDefaults();
   ok(await registros(),preservados);
  }
  return {checks,checksOriginais,checksSemDefaults,checksDefaults:checks-checksSemDefaults,casosGate:casos.length,mensagem:`SQL real PGlite: ${checks} verificações aprovadas (${checksSemDefaults} anteriores, incluindo ${checksOriginais} originais, e ${checks-checksSemDefaults} de defaults permissivos); gate somente leitura aprovado com ${casos.length} desconfigurações rejeitadas e revertidas. ACLs extras removidas na criação e reaplicação; donos, dados, defaults, papéis e objetos de controle preservados somente na fixture.`};
 }finally{await db.close();}
}
module.exports={testarPersistencia};
if(require.main===module)testarPersistencia().then(r=>console.log(r.mensagem)).catch(e=>{console.error(e);process.exitCode=1;});
