const { PGlite } = require('C:/Users/harre/AppData/Local/LicitaPlena/qa-postgres/node_modules/@electric-sql/pglite');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const sql = name => fs.readFileSync(path.join(__dirname, '../../supabase', name), 'utf8');
(async () => {
 const db = new PGlite(); let checks = 0;
 const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const org=id(1), other=id(2), company=id(11), second=id(12), foreign=id(13), proc=id(21), doc=id(31);
 const user={owner:id(101),operator:id(102),reader:id(103),orgreader:id(104),outsider:id(105)};
 const as = async who => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[who || '']); await db.exec(`set role ${who?'authenticated':'anon'}`); };
 const denied = async (query, params=[]) => { let r; try { r=await db.query(query,params); } catch(e) { assert.match(e.message,/permission denied|row-level security|escopo|Empresa indisponível|somente leitura|check constraint|foreign key/i); checks++; return; } assert.equal(Math.max(r.affectedRows ?? 0,r.rows.length),0,`Escrita indevida: ${query}`); checks++; };
 try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create table auth.users(id uuid primary key,email text);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create schema storage; create table storage.buckets(id text primary key,name text,public boolean);
   create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
   alter table storage.objects enable row level security;
   create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
   create table public.clientes(id uuid primary key,status text,nome text,empresa text,cnpj text);
   create table public.admins(email text,role text);
   grant usage on schema auth,storage,public to anon,authenticated,service_role;
   grant execute on function auth.uid() to anon,authenticated,service_role;`);
  for(const f of ['operacao_licitacoes.sql','operacao_acompanhamento.sql','limite_cnpjs_operacao.sql','acesso_empresa_convites.sql','identificacao_empresa.sql']) await db.exec(sql(f));
  await db.exec('grant select,insert,update,delete on all tables in schema public,storage to authenticated; grant select,insert,update,delete on all tables in schema public,storage to anon; grant all on all tables in schema public,storage to service_role; revoke all on public.operacao_identificacao_empresa from anon,authenticated; grant select on public.operacao_identificacao_empresa to authenticated;');
  for(const [name,uid] of Object.entries(user)) await db.query("insert into auth.users values($1,$2);",[uid,`${name}@example.test`]);
  await db.query('insert into operacao_organizacoes(id,nome,owner_id) values($1,\'Org\',$3),($2,\'Outra\',$4)',[org,other,user.owner,user.outsider]);
  await db.query("insert into operacao_empresas(id,organizacao_id,razao_social,cnpj) values($1,$4,'Empresa','11222333000181'),($2,$4,'Segunda','2'),($3,$5,'Outra','3')",[company,second,foreign,org,other]);
  await db.query("insert into operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values($1,$3,'gestor',null),($1,$4,'operador',$2),($1,$5,'leitura',$2),($1,$6,'leitura',null),($7,$8,'gestor',null)",[org,company,user.owner,user.operator,user.reader,user.orgreader,other,user.outsider]);
  await db.query("insert into operacao_processos(id,organizacao_id,empresa_id,objeto) values($1,$2,$3,'Processo')",[proc,org,company]);
  await db.query("insert into operacao_documentos(id,organizacao_id,empresa_id,tipo,arquivo_caminho) values($1,$2,$3,'Contrato',$4)",[doc,org,company,`${org}/${company}/doc.pdf`]);
  const records = [
   ['operacao_empresas',{organizacao_id:org,razao_social:'QA',ativo:false}],
   ['operacao_documentos',{organizacao_id:org,empresa_id:company,tipo:'QA'}],
   ['operacao_processos',{organizacao_id:org,empresa_id:company,objeto:'QA'}],
   ['operacao_contratos',{organizacao_id:org,processo_id:proc,numero:'QA'}],
   ['operacao_itens_resultado',{organizacao_id:org,processo_id:proc,identificador:'QA'}],
   ['operacao_agenda',{organizacao_id:org,empresa_id:company,categoria:'outro',titulo:'QA',vencimento:'2030-01-01'}],
   ['operacao_prazos_processo',{organizacao_id:org,processo_id:proc,categoria:'outro',titulo:'QA',vencimento:'2030-01-01'}],
   ['operacao_empenhos',{organizacao_id:org,processo_id:proc,numero:'QA'}],
   ['operacao_ocorrencias',{organizacao_id:org,processo_id:proc,descricao:'QA',ocorrido_em:'2030-01-01'}],
   ['operacao_anexos_processo',{organizacao_id:org,processo_id:proc,tipo:'outro',titulo:'QA',arquivo_nome:'qa.pdf',arquivo_caminho:`${org}/${company}/qa.pdf`}],
   ['operacao_renovacoes_documento',{documento_id:doc}],
   ['storage.objects',{bucket_id:'operacao-documentos',name:`${org}/${company}/qa.pdf`}]
  ];
  const insert = (table,row) => [`insert into ${table}(${Object.keys(row)}) values(${Object.keys(row).map((_,i)=>'$'+(i+1))}) returning id`,Object.values(row)];
  // Seed one row per table as trusted migration owner, before exercising RLS.
  const seeded=[]; for(const [table,row] of records) seeded.push((await db.query(...insert(table,row))).rows[0].id);
  if(process.argv.includes('--legacy')) {
   await db.query('update operacao_documentos set arquivo_caminho=$1 where id=$2',[`${org}/${second}/wrong.pdf`,doc]);
   await assert.rejects(()=>db.exec(sql('seguranca_operacao.sql')),/Escopo legado inconsistente/);
   await db.exec('rollback');
   assert.equal((await db.query("select to_regprocedure('public.pode_escrever_org_operacao(uuid)') as fn")).rows[0].fn,null);
   assert.equal((await db.query('select count(*)::int as n from operacao_documentos')).rows[0].n,2);
   console.log('SQL real PGlite: legado inconsistente rejeitado; transação revertida e dados preservados.'); return;
  }
  if(!process.argv.includes('--baseline')) { await db.exec(sql('seguranca_operacao.sql')); await db.exec(sql('seguranca_operacao.sql')); const legacy=await db.exec(fs.readFileSync(path.join(__dirname,'testar-identificacao-empresa-local.sql'),'utf8')); assert(legacy.some(r=>r.rows.some(row=>row.confirmou===true))); checks++; }
  for(const who of [user.reader,user.orgreader]) {
   await as(who);
   for(let i=0;i<records.length;i++) { const [table,row]=records[i]; const target=table==='operacao_empresas'?company:seeded[i]; assert((await db.query(`select id from ${table} where id=$1`,[target])).rows.length); checks++;
    await denied(...insert(table,row)); const column=Object.keys(row).find(k=>k!=='organizacao_id') || 'id';
    await denied(`update ${table} set ${column}=${column} where id=$1 returning id`,[target]);
    await denied(`delete from ${table} where id=$1 returning id`,[target]);
   }
  }
  for(const who of [user.operator,user.owner]) { await as(who); for(const [table,row] of records.filter(([t])=>t!=='operacao_empresas')) { const r=await db.query(...insert(table,{...row,...(row.numero?{numero:who}:{}),...(row.identificador?{identificador:who}:{})})); const rid=r.rows[0].id; assert.equal((await db.query(`update ${table} set id=id where id=$1 returning id`,[rid])).rows.length,1); assert.equal((await db.query(`delete from ${table} where id=$1 returning id`,[rid])).rows.length,1); checks+=3; } }
  await as(user.owner);
  const owned=await db.query(...insert('operacao_empresas',{organizacao_id:org,razao_social:'Nova legítima',ativo:false}));
  assert.equal((await db.query('update operacao_empresas set razao_social=$1 where id=$2 returning id',['Editada',owned.rows[0].id])).rows.length,1);
  assert.equal((await db.query('delete from operacao_empresas where id=$1 returning id',[owned.rows[0].id])).rows.length,1); checks+=3;
  for(const who of [user.reader,user.orgreader]) {
   await as(who); await denied(...insert('operacao_tipos_documento',{organizacao_id:org,nome:'Tipo indevido'}));
   await denied('insert into operacao_membros(organizacao_id,usuario_id,papel) values($1,$2,$3)',[org,user.outsider,'gestor']);
  }
  await as(user.owner); await denied(...insert('operacao_documentos',{organizacao_id:org,empresa_id:company,tipo:'QA',arquivo_caminho:`${org}/${second}/x.pdf`}));
  await denied(...insert('operacao_anexos_processo',{organizacao_id:org,processo_id:proc,tipo:'outro',titulo:'QA',arquivo_nome:'x',arquivo_caminho:`${org}/${second}/x.pdf`}));
  await denied(...insert('operacao_processos',{organizacao_id:org,empresa_id:foreign,objeto:'QA'}));
  for(const table of ['operacao_documentos','operacao_processos']) {
   const target=table==='operacao_documentos'?doc:proc;
   assert.equal((await db.query(`update ${table} set empresa_id=empresa_id where id=$1 returning id`,[target])).rows.length,1); checks++;
   await denied(`update ${table} set empresa_id=$1 where id=$2 returning id`,[second,target]);
  }
  await as(user.operator); await denied(...insert('operacao_documentos',{organizacao_id:org,empresa_id:second,tipo:'QA'}));
  await as(user.outsider);
  for(let i=0;i<records.length;i++) { const table=records[i][0],target=table==='operacao_empresas'?company:seeded[i]; assert.equal((await db.query(`select id from ${table} where id=$1`,[target])).rows.length,0); checks++; }
  await as(null); for(const [table,row] of records) { await denied(...insert(table,row)); await denied(`select id from ${table}`); }
  await as(user.owner); assert.equal((await db.query('select public.identificacao_empresa_habilitada() as ok')).rows[0].ok,true); checks++;
  await db.exec('reset role; alter table storage.objects disable row level security');
  await as(user.owner); assert.equal((await db.query('select public.identificacao_empresa_habilitada() as ok')).rows[0].ok,false,'Gate deve fechar sem RLS em storage.objects'); checks++;
  await db.exec('reset role; alter table storage.objects enable row level security');
  await as(user.owner); assert.equal((await db.query('select public.identificacao_empresa_habilitada() as ok')).rows[0].ok,true,'Gate deve recuperar após reativar RLS em storage.objects'); checks++;

  await as(user.reader); await assert.rejects(()=>db.query('select public.confirmar_identificacao_empresa($1,$2,$3,$4,$5,$6)',[company,user.reader,'Empresa','11222333000181','{}','[]']),/permission denied/); checks++;
  await db.exec('reset role; set role service_role'); await assert.rejects(()=>db.query('select public.confirmar_identificacao_empresa($1,$2,$3,$4,$5,$6)',[company,user.reader,'Empresa','11222333000181','{"endereco":"Rua","representante":"Pessoa","cargo":"Diretor"}','[]']),/Empresa indisponível|somente leitura/); checks++;
  await db.exec('reset role; set role service_role');
  const confirmArgs=[company,user.operator,'Empresa','11222333000181','{"endereco":"Rua","representante":"Pessoa","cargo":"Diretor"}','[]'];
  assert.equal((await db.query('select (public.confirmar_identificacao_empresa($1,$2,$3,$4,$5,$6)).confirmado_por as usuario',confirmArgs)).rows[0].usuario,user.operator); checks++;
  await assert.rejects(()=>db.query('select public.confirmar_identificacao_empresa($1,$2,$3,$4,$5,$6)',[foreign,user.operator,'Outra','3',confirmArgs[4],'[]']),/Empresa indisponível/); checks++;
  const wrongEvidence=JSON.stringify([{documentoId:doc,arquivoCaminho:`${org}/${second}/wrong.pdf`,hash:'a'.repeat(64)}]);
  await assert.rejects(()=>db.query('select public.confirmar_identificacao_empresa($1,$2,$3,$4,$5,$6)',[...confirmArgs.slice(0,5),wrongEvidence]),/Documento inválido/);
  assert.equal((await db.query('select versao from operacao_identificacao_empresa where empresa_id=$1',[company])).rows[0].versao,1); checks+=2;
  await denied(...insert('operacao_documentos',{organizacao_id:org,empresa_id:foreign,tipo:'Inválido'}));
  await denied(...insert('operacao_anexos_processo',{organizacao_id:org,processo_id:proc,tipo:'outro',titulo:'Inválido',arquivo_nome:'x',arquivo_caminho:`${org}/${second}/x.pdf`}));
  await db.exec('reset role; drop policy operacao_documentos_da_empresa_escrita on operacao_documentos');
  await as(user.owner); assert.equal((await db.query('select public.identificacao_empresa_habilitada() as ok')).rows[0].ok,false); checks++;
  await db.exec('reset role'); await db.exec(sql('seguranca_operacao.sql'));
  await db.exec('alter policy operacao_documentos_da_empresa_escrita on operacao_documentos using(true) with check(true)');
  await as(user.owner); assert.equal((await db.query('select public.identificacao_empresa_habilitada() as ok')).rows[0].ok,false); checks++;
  console.log(`SQL real PGlite: ${checks} verificações aprovadas; migração repetida, leitura, CRUD, isolamento e RPC.`);
 } finally { await db.close(); }
})().catch(e=>{ console.error(e); process.exitCode=1; });
