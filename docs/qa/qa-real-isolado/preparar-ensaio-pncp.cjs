// Preparação local: não conecta ao banco e não executa SQL.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const raiz=path.resolve(__dirname,'../../..');
const nomes=['importacao_item_pncp.sql','testar_importacao_pncp.sql'];
const fontes=nomes.map(nome=>({nome,texto:fs.readFileSync(path.join(raiz,'supabase',nome),'utf8').replaceAll('\r\n','\n')}));
function corpo(f,i){let s=f.texto;if(!/^begin;$/m.test(s))throw Error('Wrapper inicial divergente');s=s.replace(/^begin;\n/m,'');
 if(i===0){if(!/commit;\nnotify pgrst,'reload schema';\s*$/.test(s))throw Error('Wrapper migração divergente');s=s.replace(/commit;\nnotify pgrst,'reload schema';\s*$/,'');}
 else {if(!/^rollback;$/m.test(s))throw Error('Rollback ausente');s=s.replace(/^rollback;\n?/m,'');}
 if(/^(begin|commit|rollback);$/m.test(s)||/^notify /m.test(s)||s.includes('$pncp_fonte'+i+'$'))throw Error('Wrapper residual/delimitador');
 return `\n-- Fonte original preservada: supabase/${f.nome}\nexecute $pncp_fonte${i}$\n${s}\n$pncp_fonte${i}$;\n`;
}
const catalogo=`with namespaces as(select oid,nspname from pg_namespace where nspname in('public','auth','storage')),
 rel as(select c.*,n.nspname from pg_class c join namespaces n on n.oid=c.relnamespace where c.relkind in('r','p','v','m','f','S')),
 fun as(select p.*,n.nspname from pg_proc p join namespaces n on n.oid=p.pronamespace where p.prokind in('f','p'))
 select jsonb_build_object(
 'relacoes',(select coalesce(jsonb_agg(jsonb_build_array(nspname,relname,relkind,relowner,relacl::text,relrowsecurity,relforcerowsecurity,reloptions) order by nspname,relname),'[]') from rel),
 'colunas',(select coalesce(jsonb_agg(jsonb_build_array(r.nspname,r.relname,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,a.attacl::text,pg_get_expr(d.adbin,d.adrelid)) order by r.nspname,r.relname,a.attnum),'[]') from rel r join pg_attribute a on a.attrelid=r.oid and a.attnum>0 and not a.attisdropped left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum),
 'funcoes',(select coalesce(jsonb_agg(jsonb_build_array(nspname,oid::regprocedure::text,proowner,proacl::text,proconfig,prosecdef,prorettype,md5(pg_get_functiondef(oid))) order by nspname,oid::regprocedure::text),'[]') from fun),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_array(r.nspname,r.relname,c.conname,pg_get_constraintdef(c.oid,true)) order by r.nspname,r.relname,c.conname),'[]') from rel r join pg_constraint c on c.conrelid=r.oid),
 'indices',(select coalesce(jsonb_agg(jsonb_build_array(r.nspname,r.relname,pg_get_indexdef(i.indexrelid)) order by r.nspname,r.relname,i.indexrelid::regclass::text),'[]') from rel r join pg_index i on i.indrelid=r.oid),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname),'[]') from pg_policies p where schemaname in('public','auth','storage')),
 'triggers',(select coalesce(jsonb_agg(jsonb_build_array(r.nspname,r.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true)) order by r.nspname,r.relname,t.tgname),'[]') from rel r join pg_trigger t on t.tgrelid=r.oid where not t.tgisinternal),
 'schemas',(select coalesce(jsonb_agg(jsonb_build_array(nspname,nspowner,nspacl::text) order by nspname),'[]') from pg_namespace where nspname in('public','auth','storage')),
 'defaultacl',(select coalesce(jsonb_agg(to_jsonb(d) order by oid),'[]') from pg_default_acl d)
 )`;
const pre=`-- PREPARADO / NÃO EXECUTADO. Exclusivamente QA luguscapasskcsficckf.
-- Revisão independente obrigatória antes de execução. Confira project-ref externamente.
-- SQL não identifica projeto Supabase. Nunca executar em produção.
-- Não exige banco vazio. Usuários existentes são apenas contados/hashed; nenhum é atualizado.
-- Uma sessão sem concorrência; lock/statement timeout finitos. Sem HTTP, SMTP, senha ou token.
-- DDL/RPC/fixtures dentro de subtransação; erro real aborta. Não apagar evidências nem repetir cegamente.
begin;
set local statement_timeout='60s';
set local lock_timeout='5s';
set local idle_in_transaction_session_timeout='90s';
do $qa_pncp$
declare
 baseline jsonb:='[]'; r record; v text; catalogo_antes jsonb; catalogo_depois jsonb;
 tabelas integer:=0; sequencias integer:=0; gates boolean:=false;
 consulta_catalogo text:=$catalogo$${catalogo}$catalogo$;
begin
 if current_database()<>'postgres' or current_user<>'postgres' then raise exception 'Executor/banco QA inesperado';end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('operacao_origens_pncp','operacao_observacoes_pncp','operacao_cadencia_pncp','operacao_itens_id_org_proc_idx'))
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('reservar_importacao_pncp','gravar_importacao_pncp'))
 then raise exception 'Objetos PNCP já presentes: não sobrescrever; diagnosticar baseline';end if;
 if to_regclass('public.operacao_itens_resultado') is null or to_regclass('public.operacao_processos') is null then raise exception 'Pré-requisitos ausentes';end if;
 -- Bloqueia somente relações escritas pelas fixtures; não bloqueia tabelas internas gerenciadas.
 -- Falha42501 anterior em auth.schema_migrations foi preservada, não é schema ausente.
 for r in select * from (values
  ('auth','users'),('public','clientes'),('public','operacao_organizacoes'),
  ('public','operacao_empresas'),('public','operacao_membros'),
  ('public','operacao_processos'),('public','operacao_itens_resultado')
 ) as alvos(schemaname,tablename) order by 1,2 loop
  if to_regclass(format('%I.%I',r.schemaname,r.tablename)) is null
   then raise exception 'Relação necessária ausente: %.%',r.schemaname,r.tablename;end if;
  if not has_table_privilege(current_user,format('%I.%I',r.schemaname,r.tablename),'SELECT')
   or not has_table_privilege(current_user,format('%I.%I',r.schemaname,r.tablename),'UPDATE')
   then raise exception 'Privilégio existente insuficiente para ensaio: %.%; não ampliar grants',r.schemaname,r.tablename;end if;
  execute format('lock table %I.%I in share row exclusive mode',r.schemaname,r.tablename);
 end loop;
 -- Demais relações continuam em snapshots readonly; alteração concorrente faz comparação falhar.

 execute consulta_catalogo into catalogo_antes;
 for r in select schemaname,tablename from pg_tables where schemaname in('public','auth','storage') order by 1,2 loop
  execute format('select count(*)::text||'':''||md5(coalesce(string_agg(x,''|'' order by x),'''')) from(select to_jsonb(t)::text x from %I.%I t)s',r.schemaname,r.tablename) into v;
  baseline:=baseline||jsonb_build_array(jsonb_build_object('tipo','tabela','esquema',r.schemaname,'nome',r.tablename,'valor',v));tabelas:=tabelas+1;
 end loop;
 for r in select schemaname,sequencename from pg_sequences where schemaname in('public','auth','storage') order by 1,2 loop
  execute format('select last_value::text||'':''||is_called::text from %I.%I',r.schemaname,r.sequencename) into v;
  baseline:=baseline||jsonb_build_array(jsonb_build_object('tipo','sequencia','esquema',r.schemaname,'nome',r.sequencename,'valor',v));sequencias:=sequencias+1;
 end loop;
 -- Snapshot contém somente hashes/contagens em memória; não retorna dados pessoais.
 begin
`;
const pos=`
 gates:=true;
 raise exception using errcode='ZP001',message='Rollback controlado após gates PNCP';
 exception when sqlstate 'ZP001' then
  if not gates then raise;end if;
 end;
 if not gates then raise exception 'Gates PNCP incompletos';end if;
 execute consulta_catalogo into catalogo_depois;
 if catalogo_depois is distinct from catalogo_antes then raise exception 'Catálogo/funções/ACL não restaurados';end if;
 for r in select * from jsonb_to_recordset(baseline) as x(tipo text,esquema text,nome text,valor text) loop
  if r.tipo='tabela' then execute format('select count(*)::text||'':''||md5(coalesce(string_agg(x,''|'' order by x),'''')) from(select to_jsonb(t)::text x from %I.%I t)s',r.esquema,r.nome) into v;
  else execute format('select last_value::text||'':''||is_called::text from %I.%I',r.esquema,r.nome) into v;end if;
  if v is distinct from r.valor then raise exception 'Preservação divergente em %.%',r.esquema,r.nome;end if;
 end loop;
 if (select count(*) from pg_tables where schemaname in('public','auth','storage'))<>tabelas
 or (select count(*) from pg_sequences where schemaname in('public','auth','storage'))<>sequencias then raise exception 'Inventário pós-rollback divergente';end if;
 raise notice 'QA_PNCP_GATES_E_ROLLBACK_OK; catálogo md5 %; tabelas %; sequências %',md5(catalogo_antes::text),tabelas,sequencias;
end $qa_pncp$;
select 'QA_PNCP_GATES_E_ROLLBACK_OK' as status,
 (select count(*) from pg_tables where schemaname in('public','auth','storage')) as tabelas_restauradas,
 (select count(*) from pg_sequences where schemaname in('public','auth','storage')) as sequencias_restauradas,
 not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('operacao_origens_pncp','operacao_observacoes_pncp','operacao_cadencia_pncp','operacao_itens_id_org_proc_idx')) as relacoes_pncp_ausentes,
 not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('reservar_importacao_pncp','gravar_importacao_pncp')) as funcoes_pncp_ausentes;
rollback;
-- Linha SELECT de sucesso só é alcançada após todos os testes e comparação pre/post.
-- Erro real não é capturado como sucesso; sequências divergentes não são reajustadas automaticamente.
`;
const sql=pre+fontes.map(corpo).join('\n')+pos;
fs.writeFileSync(path.join(__dirname,'ENSAIO-PNCP-ROLLBACK.sql'),sql);
const manifesto={destino:'luguscapasskcsficckf',executado:false,aprovacaoRevisaoPendente:true,sha256:createHash('sha256').update(sql).digest('hex'),fontes:fontes.map(f=>({arquivo:'supabase/'+f.nome,sha256:createHash('sha256').update(f.texto).digest('hex'),normalizacao:'LF',sha256Original:createHash('sha256').update(fs.readFileSync(path.join(raiz,'supabase',f.nome))).digest('hex')}))};
fs.writeFileSync(path.join(__dirname,'ENSAIO-PNCP-manifesto.json'),JSON.stringify(manifesto,null,2)+'\n');console.log(JSON.stringify({sha256:manifesto.sha256,executado:false}));
