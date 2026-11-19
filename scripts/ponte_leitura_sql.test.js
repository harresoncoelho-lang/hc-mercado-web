const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
// PGlite em memória executa SQL real, mas serializa operações: não ensaia locks entre sessões.
// Usa migrações preservadas do repositório, não comprova paridade com banco remoto atual.
test('canal leitura SQL real: nonce, recibo, replay, revisão e cancelamento',async()=>{
 const db=new PGlite();const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const sql=name=>fs.readFileSync(path.join(__dirname,'../supabase',name),'utf8');
 const as=async(uid)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec('set role authenticated');};
 const dados={numero:'00041',ano:'2026',compra:'78882005000412026',url:'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/cadastro-propostas?compra=78882005000412026'};
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
  await as(id(102));let state=await rpc();const saved=await rpc(11,21,'confirmar',state);assert.equal(saved.status,200);
  await db.exec('reset role');await db.exec(sql('ponte_leitura.sql'));await db.exec(sql('correspondencias_leitura.sql'));
  await db.query("insert into operacao_itens_resultado(id,organizacao_id,processo_id,identificador) values($1,$2,$3,'interno fixture')",[id(51),id(1),id(21)]);
  await db.query("insert into operacao_kit_documentos(id,organizacao_id,empresa_id,processo_id,tipo,dados,versao,criado_por,atualizado_por,revisao_hash,revisao_previa,revisao_versao,revisado_por,revisado_em) values($1,$2,$3,$4,'proposta',jsonb_build_object('proposta',jsonb_build_object('itemIds',jsonb_build_array('00000000-0000-4000-8000-000000000051'))),1,$5,$5,$6,'{}',1,$5,now())",[id(31),id(1),id(11),id(21),id(102),'a'.repeat(64)]);
  await as(id(102));
  const observation={contexto:{cnpj:'11222333000181',uasg:'788820',number:'41',year:'2026',purchaseId:dados.compra},pagina:{parcial:true,itens:[{id:'1',descricao:'Fictício',quantidadeSolicitada:'6',unidade:'Unidade',grupo:null,exigencias:null}]},writeAuthorized:false,origem:'relato_usuario'};
  const bridge=async(action,attempt=41,patch={})=>{const args={p_acao:action,p_tentativa:id(attempt),p_documento:id(31),p_versao:1,p_hash:'a'.repeat(64),p_vinculo:1,p_nonce_hash:'b'.repeat(64),p_observacao:action==='registrar'?observation:null,...patch};return(await db.query(`select operacao_ponte_leitura(${Object.keys(args).map((k,i)=>k+'=> $'+(i+1)).join(',')}) as r`,Object.values(args))).rows[0].r;};
  assert.equal((await bridge('iniciar')).status,200);
  assert.equal((await bridge('iniciar',42)).status,409);
  assert.equal((await bridge('registrar',41,{p_nonce_hash:'c'.repeat(64)})).status,409);
  assert.equal((await bridge('registrar',41,{p_observacao:{...observation,pagina:{...observation.pagina,itens:[{...observation.pagina.itens[0],quantidadeSolicitada:'9'.repeat(65)}]}}})).status,400);
  await db.exec('reset role');await db.query('update operacao_tentativas_leitura set processo_id=$1 where id=$2',[id(22),id(41)]);await as(id(102));
  assert.equal((await bridge('registrar')).status,409);
  await db.exec('reset role');await db.query('update operacao_tentativas_leitura set processo_id=$1 where id=$2',[id(21),id(41)]);await as(id(102));
  await as(id(103));assert.equal((await bridge('registrar')).status,403);await as(id(102));
  await assert.rejects(db.query('update operacao_kit_documentos set processo_id=$1 where id=$2',[id(22),id(31)]));
  await db.exec('reset role');
  await db.exec(`create function falhar_observacao_fixture() returns trigger language plpgsql as $$begin raise exception 'fixture rollback';end$$;create trigger falhar_fixture before insert on operacao_observacoes_leitura for each row execute function falhar_observacao_fixture();`);
  await as(id(102));await assert.rejects(bridge('registrar'),/fixture rollback/);
  await db.exec('reset role');
  assert.equal((await db.query('select estado from operacao_tentativas_leitura where id=$1',[id(41)])).rows[0].estado,'pendente');
  assert.equal((await db.query('select count(*)::int as n from operacao_observacoes_leitura')).rows[0].n,0);
  await db.exec('drop trigger falhar_fixture on operacao_observacoes_leitura');await as(id(102));
  const receipt=await bridge('registrar');assert.equal(receipt.status,200);assert.equal(receipt.writeAuthorized,false);
  assert.equal((await bridge('registrar')).recibo,receipt.recibo);
  const mapas=async(acao='consultar',patch={})=>{const args={p_acao:acao,p_documento:id(31),p_versao:1,p_hash:'a'.repeat(64),p_vinculo:1,p_recibo:acao==='confirmar'?receipt.recibo:null,p_mapa_versao:acao==='confirmar'?0:null,p_pares:acao==='confirmar'?[{itemId:id(51),portalId:'1'}]:null,...patch};return(await db.query(`select operacao_correspondencias_leitura(${Object.keys(args).map((k,i)=>k+'=> $'+(i+1)).join(',')}) as r`,Object.values(args))).rows[0].r;};
  let lista=await mapas();assert.equal(lista.status,200);assert.equal(lista.recibos.length,1);assert.equal(lista.recibos[0].correspondencia,null);
  assert.equal((await mapas('consultar',{p_cursor:receipt.recibo})).status,200);
  assert.equal((await mapas('consultar',{p_cursor:id(999)})).status,400);
  for(const [column,foreign,original] of [['empresa_id',id(12),id(11)],['processo_id',id(22),id(21)],['organizacao_id',id(2),id(1)]]){
   await db.exec('reset role');await db.query(`update operacao_tentativas_leitura set ${column}=$1 where id=$2`,[foreign,id(41)]);await as(id(102));
   assert.equal((await mapas()).recibos.length,0);
   assert.equal((await mapas('consultar',{p_cursor:receipt.recibo})).status,400,`cursor fora de ${column}`);
   await db.exec('reset role');await db.query(`update operacao_tentativas_leitura set ${column}=$1 where id=$2`,[original,id(41)]);await as(id(102));
  }
  assert.equal((await mapas('confirmar',{p_pares:[{itemId:id(51),portalId:'99'}]})).status,400);
  assert.equal((await mapas('confirmar',{p_pares:[{itemId:id(52),portalId:'1'}]})).status,400);
  assert.equal((await mapas('confirmar',{p_pares:[{itemId:id(51),portalId:'1'},{itemId:id(51),portalId:'1'}]})).status,400);
  const confirmado=await mapas('confirmar');assert.equal(confirmado.status,200);assert.equal(confirmado.lote,null);assert.equal(confirmado.writeAuthorized,false);
  assert.equal((await mapas('confirmar')).status,409);
  lista=await mapas();assert.deepEqual(lista.recibos[0].correspondencia.pares,[{itemId:id(51),portalId:'1'}]);
  assert.equal((await mapas('confirmar',{p_mapa_versao:1})).versaoCorrespondencia,2);
  await db.exec('reset role');assert.equal((await db.query('select count(*)::int as n from operacao_correspondencias_leitura_historico')).rows[0].n,1);
  await db.query("update operacao_tentativas_leitura set expira_em=now()-interval '1 second' where id=$1",[id(41)]);await as(id(102));
  assert.equal((await mapas()).recibos[0].correspondencia.versao,2);
  await db.exec('reset role');await db.query("update operacao_tentativas_leitura set expira_em=now()+interval '5 minutes' where id=$1",[id(41)]);await as(id(103));assert.equal((await mapas()).status,403);await as(id(102));

  await db.exec('reset role');await db.query("update operacao_membros set papel='leitura' where usuario_id=$1",[id(102)]);await as(id(102));
  assert.equal((await bridge('registrar')).status,403);assert.equal((await mapas()).status,403);
  await db.exec('reset role');await db.query("update operacao_membros set papel='operador' where usuario_id=$1",[id(102)]);await as(id(102));
  assert.equal((await bridge('registrar',41,{p_observacao:{...observation,pagina:{...observation.pagina,itens:[{...observation.pagina.itens[0],id:'2'}]}}})).status,409);
  await assert.rejects(db.query('select * from operacao_observacoes_leitura'));
  assert.equal((await bridge('iniciar',42)).status,200);
  await db.exec('reset role');await db.query('update operacao_tentativas_leitura set expira_em=now()-interval \'1 second\' where id=$1',[id(42)]);await as(id(102));
  assert.equal((await bridge('registrar',42)).status,409);
  assert.equal((await bridge('cancelar',42,{p_documento:null,p_versao:null,p_hash:null,p_vinculo:null,p_nonce_hash:null})).status,200);
  assert.equal((await bridge('iniciar',43)).status,200);
  await db.exec('reset role');await db.query("update operacao_kit_documentos set versao=2,revisao_hash=null,revisao_versao=null,revisao_previa=null,revisado_por=null,revisado_em=null where id=$1",[id(31)]);await as(id(102));
  assert.equal((await bridge('registrar',43)).status,409);assert.equal((await mapas()).status,409);
  assert.equal((await bridge('cancelar',43,{p_documento:null,p_versao:null,p_hash:null,p_vinculo:null,p_nonce_hash:null})).status,200);
  await db.exec('reset role');assert.equal((await db.query('select count(*)::int as n from operacao_observacoes_leitura')).rows[0].n,1);
 }finally{await db.close();}
});

