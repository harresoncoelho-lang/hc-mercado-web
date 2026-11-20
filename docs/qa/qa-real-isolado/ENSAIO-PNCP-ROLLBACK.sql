-- PREPARADO / NÃO EXECUTADO. Exclusivamente QA luguscapasskcsficckf.
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
 consulta_catalogo text:=$catalogo$with namespaces as(select oid,nspname from pg_namespace where nspname in('public','auth','storage')),
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
 )$catalogo$;
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

-- Fonte original preservada: supabase/importacao_item_pncp.sql
execute $pncp_fonte0$
-- PREPARADO LOCALMENTE / NÃO APLICADO. Após schema operação e kit.
create unique index if not exists operacao_itens_id_org_proc_idx on public.operacao_itens_resultado(id,organizacao_id,processo_id);
create table if not exists public.operacao_origens_pncp(
 item_id uuid primary key,organizacao_id uuid not null,processo_id uuid not null,empresa_id uuid not null,
 compra text not null,numero_item integer not null check(numero_item>0),url text not null,
 hash_aplicado text not null,hash_atual text not null,estado text not null check(estado in('importado','fonte_alterada')),
 observado_em timestamptz not null default now(),
 unique(processo_id,compra,numero_item),
 foreign key(item_id,organizacao_id,processo_id) references public.operacao_itens_resultado(id,organizacao_id,processo_id),
 foreign key(processo_id,empresa_id,organizacao_id) references public.operacao_processos(id,empresa_id,organizacao_id)
);
create table if not exists public.operacao_observacoes_pncp(
 item_id uuid not null references public.operacao_origens_pncp(item_id),hash text not null check(hash~'^[a-f0-9]{64}$'),
 snapshot jsonb not null check(octet_length(snapshot::text)<=400000),observado_em timestamptz not null default now(),
 primary key(item_id,hash)
);
create table if not exists public.operacao_cadencia_pncp(origem text primary key,proxima timestamptz not null);
alter table public.operacao_origens_pncp enable row level security;
alter table public.operacao_observacoes_pncp enable row level security;
alter table public.operacao_cadencia_pncp enable row level security;
revoke all on public.operacao_origens_pncp,public.operacao_observacoes_pncp,public.operacao_cadencia_pncp from public,anon,authenticated;
grant select on public.operacao_origens_pncp to authenticated;
create policy origem_pncp_leitura on public.operacao_origens_pncp for select to authenticated using(
 exists(select 1 from public.operacao_membros m join public.operacao_empresas e on e.organizacao_id=m.organizacao_id
 join public.clientes c on c.id=m.usuario_id where c.id=auth.uid() and c.status='aprovado' and e.ativo
 and e.id=operacao_origens_pncp.empresa_id and e.organizacao_id=operacao_origens_pncp.organizacao_id and (m.empresa_id is null or m.empresa_id=e.id))
);
create or replace function public.reservar_importacao_pncp(p_usuario uuid,p_empresa uuid,p_processo uuid,p_organizacao uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if not exists(select 1 from public.clientes c join public.operacao_membros m on m.usuario_id=c.id
 join public.operacao_empresas e on e.organizacao_id=m.organizacao_id
 join public.operacao_processos p on p.empresa_id=e.id and p.organizacao_id=e.organizacao_id
 where c.id=p_usuario and c.status='aprovado' and m.papel in('gestor','operador') and (m.empresa_id is null or m.empresa_id=e.id)
 and e.id=p_empresa and e.ativo and e.organizacao_id=p_organizacao and p.id=p_processo) then raise sqlstate 'PT403' using message='Acesso não autorizado';end if;
 perform pg_advisory_xact_lock(hashtext('importacao-item-pncp-origem'));
 if exists(select 1 from public.operacao_cadencia_pncp where origem='pncp' and proxima>clock_timestamp()) then return false;end if;
 insert into public.operacao_cadencia_pncp values('pncp',clock_timestamp()+interval '7 seconds') on conflict(origem) do update set proxima=excluded.proxima;
 return true;
end $$;
create or replace function public.gravar_importacao_pncp(p_usuario uuid,p_empresa uuid,p_processo uuid,p_organizacao uuid,
 p_compra text,p_numero integer,p_url text,p_hash text,p_item jsonb,p_snapshot jsonb,p_referencia jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare origem public.operacao_origens_pncp; item uuid; estado_saida text; processo public.operacao_processos;
begin
 select * into processo from public.operacao_processos where id=p_processo and empresa_id=p_empresa and organizacao_id=p_organizacao for update;
 if processo.id is null then raise sqlstate 'PT404' using message='Processo indisponível';end if;
 if not exists(select 1 from public.clientes c join public.operacao_membros m on m.usuario_id=c.id join public.operacao_empresas e on e.organizacao_id=m.organizacao_id
 where c.id=p_usuario and c.status='aprovado' and m.papel in('gestor','operador') and (m.empresa_id is null or m.empresa_id=e.id)
 and e.id=p_empresa and e.ativo and e.organizacao_id=p_organizacao) then raise sqlstate 'PT403' using message='Acesso não autorizado';end if;
 if p_referencia is distinct from jsonb_build_object('url_origem',nullif(processo.url_origem,''),'origem_externa_id',nullif(processo.origem_externa_id,''),'numero',nullif(processo.numero,'')) then raise sqlstate 'PT409' using message='Referência do processo alterada';end if;
 if p_compra is null or p_compra!~'^\d{14}-1-[1-9]\d*/\d{4}$' or p_numero not between 1 and 1000000
 or p_url is distinct from 'https://pncp.gov.br/api/pncp/v1/orgaos/'||split_part(p_compra,'-',1)||'/compras/'||split_part(p_compra,'/',2)||'/'||split_part(split_part(p_compra,'-',3),'/',1)||'/itens/'||p_numero::text
 or p_hash is null or p_hash!~'^[a-f0-9]{64}$' or jsonb_typeof(p_item) is distinct from 'object' or p_item-array['numero','descricao','quantidade','unidade']<>'{}'::jsonb
 or p_item->>'numero' is distinct from p_numero::text or jsonb_typeof(p_item->'descricao') is distinct from 'string' or jsonb_typeof(p_item->'unidade') is distinct from 'string' or jsonb_typeof(p_item->'quantidade') is distinct from 'string' or length(p_item->>'descricao') not between 1 and 10000
 or length(p_item->>'unidade') not between 1 and 100 or (p_item->>'quantidade')!~'^(0|[1-9]\d{0,11})(\.\d{1,3})?$'
 or jsonb_typeof(p_snapshot) is distinct from 'object' or octet_length(p_snapshot::text)>400000
 then raise sqlstate 'PT400' using message='Observação inválida';end if;
 if (p_item->>'quantidade')::numeric<=0 then raise sqlstate 'PT400' using message='Quantidade inválida';end if;
 select * into origem from public.operacao_origens_pncp where processo_id=p_processo and compra=p_compra and numero_item=p_numero for update;
 if origem.item_id is null then
  -- Não ligar automaticamente lançamento manual por identificador textual.
  if exists(select 1 from public.operacao_itens_resultado where processo_id=p_processo and organizacao_id=p_organizacao and tipo='item' and identificador=p_numero::text)
  then return jsonb_build_object('estado','colisao_manual');end if;
  insert into public.operacao_itens_resultado(organizacao_id,processo_id,tipo,identificador,descricao,quantidade,fonte_oficial)
  values(p_organizacao,p_processo,'item',p_numero::text,p_item->>'descricao',(p_item->>'quantidade')::numeric,p_url) returning id into item;
  insert into public.operacao_origens_pncp(item_id,organizacao_id,processo_id,empresa_id,compra,numero_item,url,hash_aplicado,hash_atual,estado)
  values(item,p_organizacao,p_processo,p_empresa,p_compra,p_numero,p_url,p_hash,p_hash,'importado');estado_saida:='importado';
 else
  item:=origem.item_id;estado_saida:=case when origem.hash_aplicado=p_hash then 'inalterado' else 'fonte_alterada' end;
  update public.operacao_origens_pncp set hash_atual=p_hash,estado=case when origem.hash_aplicado=p_hash then 'importado' else 'fonte_alterada' end,observado_em=clock_timestamp() where item_id=item;
  -- Oferta, marca/modelo, quantidade e texto do cadastro permanecem intocados.
 end if;
 insert into public.operacao_observacoes_pncp(item_id,hash,snapshot) values(item,p_hash,p_snapshot) on conflict(item_id,hash) do nothing;
 return jsonb_build_object('itemId',item,'estado',estado_saida,'hash',p_hash,'observadoEm',clock_timestamp());
end $$;
revoke all on function public.reservar_importacao_pncp(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.gravar_importacao_pncp(uuid,uuid,uuid,uuid,text,integer,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.reservar_importacao_pncp(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.gravar_importacao_pncp(uuid,uuid,uuid,uuid,text,integer,text,text,jsonb,jsonb,jsonb) to service_role;

$pncp_fonte0$;


-- Fonte original preservada: supabase/testar_importacao_pncp.sql
execute $pncp_fonte1$
-- PREPARADO, NÃO EXECUTADO. Somente clone isolado com migração importacao_item_pncp aplicada.
-- Fixtures sintéticas e rollback; executar como administrador apenas no teste. Não prova RLS via HTTP.
do $$
declare
 ua uuid:=gen_random_uuid(); ub uuid:=gen_random_uuid(); oa uuid:=gen_random_uuid(); ob uuid:=gen_random_uuid();
 ea uuid:=gen_random_uuid(); eb uuid:=gen_random_uuid(); pa uuid:=gen_random_uuid(); pb uuid:=gen_random_uuid();
 res jsonb; primeiro uuid; item_json jsonb; referencia jsonb; documento uuid; estranho uuid:=gen_random_uuid(); ids jsonb; dados jsonb; n integer; d public.operacao_kit_documentos;
begin
 insert into auth.users(id,aud,role,email,raw_user_meta_data,created_at,updated_at)
 values(ua,'authenticated','authenticated',ua||'@qa.invalid','{}',now(),now()),(ub,'authenticated','authenticated',ub||'@qa.invalid','{}',now(),now());
 insert into public.clientes(id,nome,email,status) values(ua,'QA escala A',ua||'@qa.invalid','aprovado'),(ub,'QA escala B',ub||'@qa.invalid','aprovado')
 on conflict(id) do update set status='aprovado';
 insert into public.operacao_organizacoes(id,nome,owner_id) values(oa,'QA A',ua),(ob,'QA B',ub);
 insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values(ea,oa,'QA empresa A','11222333000181'),(eb,ob,'QA empresa B','22333444000181');
 insert into public.operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values(oa,ua,'operador',ea),(ob,ub,'operador',eb);
 insert into public.operacao_processos(id,organizacao_id,empresa_id,objeto,numero) values(pa,oa,ea,'QA fictício','QA-A'),(pb,ob,eb,'QA fictício','QA-B');

 referencia:=jsonb_build_object('url_origem',null,'origem_externa_id',null,'numero','QA-A');
 insert into public.operacao_itens_resultado(organizacao_id,processo_id,tipo,identificador) values(oa,pa,'lote','98');
 item_json:=jsonb_build_object('numero',98,'descricao','Material integral fictício','quantidade','2.000','unidade','UN');
 res:=public.gravar_importacao_pncp(ua,ea,pa,oa,'11222333000181-1-41/2026',98,'https://pncp.gov.br/api/pncp/v1/orgaos/11222333000181/compras/2026/41/itens/98',repeat('a',64),item_json,'{}',referencia);
 primeiro:=(res->>'itemId')::uuid;
 if res->>'estado'<>'importado' then raise exception 'Importação não registrada';end if;
 update public.operacao_itens_resultado set marca='Marca operador',modelo='Modelo operador',valor_unitario_proposta=1.23 where id=primeiro;
 res:=public.gravar_importacao_pncp(ua,ea,pa,oa,'11222333000181-1-41/2026',98,'https://pncp.gov.br/api/pncp/v1/orgaos/11222333000181/compras/2026/41/itens/98',repeat('a',64),item_json,'{}',referencia);
 if (res->>'itemId')::uuid<>primeiro or res->>'estado'<>'inalterado' then raise exception 'Idempotência falhou';end if;
 item_json:=jsonb_set(item_json,'{descricao}','"Descrição retificada"');
 res:=public.gravar_importacao_pncp(ua,ea,pa,oa,'11222333000181-1-41/2026',98,'https://pncp.gov.br/api/pncp/v1/orgaos/11222333000181/compras/2026/41/itens/98',repeat('b',64),item_json,'{}',referencia);
 if res->>'estado'<>'fonte_alterada' then raise exception 'Retificação não sinalizada';end if;
 if not exists(select 1 from public.operacao_itens_resultado where id=primeiro and descricao='Material integral fictício' and marca='Marca operador' and modelo='Modelo operador' and valor_unitario_proposta=1.23 and quantidade=2) then raise exception 'Oferta/cadastro sobrescritos';end if;
 if (select count(*) from public.operacao_observacoes_pncp where item_id=primeiro)<>2 then raise exception 'Histórico não versionado';end if;
 insert into public.operacao_itens_resultado(organizacao_id,processo_id,identificador) values(oa,pa,'99');
 res:= public.gravar_importacao_pncp(ua,ea,pa,oa,'11222333000181-1-41/2026',99,'https://pncp.gov.br/api/pncp/v1/orgaos/11222333000181/compras/2026/41/itens/99',repeat('c',64),jsonb_set(item_json,'{numero}','99'),'{}',referencia);
 if res->>'estado'<>'colisao_manual' then raise exception 'Colisão manual aceita';end if;
 begin
  perform public.gravar_importacao_pncp(ub,ea,pa,oa,'11222333000181-1-41/2026',98,'https://pncp.gov.br/api/pncp/v1/orgaos/11222333000181/compras/2026/41/itens/98',repeat('c',64),item_json,'{}',referencia);
  raise exception 'Outro usuário aceito';
 exception when sqlstate 'PT403' then null;end;
 if has_function_privilege('anon','public.gravar_importacao_pncp(uuid,uuid,uuid,uuid,text,integer,text,text,jsonb,jsonb,jsonb)','EXECUTE')
 or has_function_privilege('authenticated','public.gravar_importacao_pncp(uuid,uuid,uuid,uuid,text,integer,text,text,jsonb,jsonb,jsonb)','EXECUTE')
 or not has_function_privilege('service_role','public.gravar_importacao_pncp(uuid,uuid,uuid,uuid,text,integer,text,text,jsonb,jsonb,jsonb)','EXECUTE')
 or has_table_privilege('authenticated','public.operacao_origens_pncp','INSERT') then raise exception 'ACL de origem inválida';end if;
 -- Cadência global do fluxo: ajuste de fixture somente dentro desta transação revertida.
 update public.operacao_cadencia_pncp set proxima=clock_timestamp()-interval '1 second' where origem='pncp';
 if not public.reservar_importacao_pncp(ua,ea,pa,oa) or public.reservar_importacao_pncp(ua,ea,pa,oa) then raise exception 'Cadência não respeitada';end if;
end $$;

$pncp_fonte1$;

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
