-- ENSAIO TRANSACIONAL STAGING: executa o delta e seus gates, mas encerra com ROLLBACK.
-- Depois comprova o fingerprint pré-kit e os dados vazios em uma transação readonly nova.
-- Qualquer erro: interromper; ROLLBACK explícito e diagnóstico, sem repetir automaticamente.
-- VARIANTE EXPLÍCITA PARA STAGING, nunca produção. Revisão independente antes da execução.
-- Alvo: luguscapasskcsficckf / vhmjospwgiryrnrndkpd (Free); confirmar conexão fora do SQL.
-- Original SHA-256: 1619e78b9155ba9443b6080fa7d082f3c335d8e8b07015d5d894462149df4c94.
-- Única diferença executável: fingerprint 4550d262d2f09edec1efd68b4c699f67 -> 8abc338413ff0c60770d3aea1c3413d1.
-- Fonte do novo fingerprint: catálogo real pós-bootstrap, SHA-256 5c607e56e58e7aa7b67d16baee150f26ff05e2b599809645777a12f6af51b9ad.
-- Payload, validações, ACLs e gates do original permanecem idênticos. Não reaplicar após COMMIT.
-- CANDIDATO LOCAL. Não aplicado. Publicação/aplicação requer autorização separada.
-- Delta exato do catálogo observado em 2026-10-31T14:23:53Z; não reaplica a base.
-- Repetição após COMMIT aborta no fingerprint: inventarie e revise, não remova a guarda.
-- Em erro, interromper o executor e executar ROLLBACK. Nenhum DROP/TRUNCATE/DELETE.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
set local search_path=pg_catalog,public;
-- Janela exclusiva curta: evita escrita durante a validação de vínculos e DDL.
lock table public.operacao_agenda,public.operacao_anexos_processo,public.operacao_contratos,public.operacao_documentos,public.operacao_empenhos,public.operacao_empresas,public.operacao_itens_resultado,public.operacao_membros,public.operacao_ocorrencias,public.operacao_prazos_processo,public.operacao_processos,public.operacao_renovacoes_documento,public.operacao_tipos_documento,storage.objects in access exclusive mode;
do $preestado$
declare observado jsonb;
begin
 if current_user<>'postgres' then raise exception 'Executor diferente do proprietário esperado; não trocar papel automaticamente'; end if;
 with
relacoes as (
 select c.*,n.nspname as esquema from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('r','p','v','m','f','S') and ((n.nspname='public' and (c.relname like 'operacao\_%' escape '\' or c.relname in ('clientes','admins')))
    or (n.nspname='auth' and c.relname='users')
    or (n.nspname='storage' and c.relname in ('objects','buckets')))
), funcoes as (
 select p.*,n.nspname as esquema from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where p.prokind in ('f','p') and (
  (n.nspname='public' and (p.proname like '%operacao%' or p.proname like '%identificacao_empresa%' or p.proname in ('gravar_kit_documento','kit_documento_escopo_imutavel','configurar_limite_cnpjs_cliente','consultar_limite_cnpjs_cliente')))
  or (n.nspname='auth' and p.proname='uid')
  or p.oid in (select t.tgfoid from pg_trigger t join relacoes r on r.oid=t.tgrelid where not t.tgisinternal)
 )
), secoes as (
 select 'relacoes' as secao,coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'nome',r.relname,'tipo',r.relkind,'dono',pg_get_userbyid(r.relowner),
  'rls',r.relrowsecurity,'force_rls',r.relforcerowsecurity,'opcoes',r.reloptions,
  'acl',r.relacl::text) order by r.esquema,r.relname),'[]'::jsonb) as itens from relacoes r
 union all
 select 'colunas',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'tabela',r.relname,'ordem',a.attnum,'nome',a.attname,
  'tipo',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
  'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid),
  'acl',a.attacl::text) order by r.esquema,r.relname,a.attnum),'[]'::jsonb)
 from relacoes r join pg_attribute a on a.attrelid=r.oid and a.attnum>0 and not a.attisdropped
 left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
 where r.relkind in ('r','p','v','m','f')
 union all
 select 'constraints',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'tabela',r.relname,'nome',c.conname,'tipo',c.contype,
  'validada',c.convalidated,'deferivel',c.condeferrable,'adiada',c.condeferred,
  'definicao',pg_get_constraintdef(c.oid,true)) order by r.esquema,r.relname,c.conname),'[]'::jsonb)
 from relacoes r join pg_constraint c on c.conrelid=r.oid
 union all
 select 'indices',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'tabela',r.relname,'nome',ci.relname,'unico',i.indisunique,
  'valido',i.indisvalid,'pronto',i.indisready,'primario',i.indisprimary,
  'definicao',pg_get_indexdef(i.indexrelid)) order by r.esquema,r.relname,ci.relname),'[]'::jsonb)
 from relacoes r join pg_index i on i.indrelid=r.oid join pg_class ci on ci.oid=i.indexrelid
 union all
 select 'policies',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',schemaname,'tabela',tablename,'nome',policyname,'permissiva',permissive,
  'papeis',roles,'comando',cmd,'using',qual,'check',with_check)
  order by schemaname,tablename,policyname),'[]'::jsonb)
 from pg_policies where (schemaname='public' and (tablename like 'operacao\_%' escape '\' or tablename in ('clientes','admins')))
  or (schemaname='storage' and tablename in ('objects','buckets')) or (schemaname='auth' and tablename='users')
 union all
 select 'triggers',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'tabela',r.relname,'nome',t.tgname,'habilitado',t.tgenabled,
  'funcao',t.tgfoid::regprocedure::text,'definicao',pg_get_triggerdef(t.oid,true))
  order by r.esquema,r.relname,t.tgname),'[]'::jsonb)
 from relacoes r join pg_trigger t on t.tgrelid=r.oid where not t.tgisinternal
 union all
 select 'funcoes',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',f.esquema,'nome',f.proname,'assinatura',f.oid::regprocedure::text,
  'argumentos',pg_get_function_identity_arguments(f.oid),'retorno',pg_get_function_result(f.oid),
  'dono',pg_get_userbyid(f.proowner),'security_definer',f.prosecdef,'volatilidade',f.provolatile,
  'strict',f.proisstrict,'configuracao',f.proconfig,'acl',f.proacl::text,
  'hash_corpo_md5',md5(replace(f.prosrc,chr(13),'')),
  'definicao',case when f.esquema='public' and (f.proname like '%operacao%' or f.proname like '%identificacao_empresa%' or f.proname in ('gravar_kit_documento','kit_documento_escopo_imutavel','configurar_limite_cnpjs_cliente','consultar_limite_cnpjs_cliente')) then pg_get_functiondef(f.oid) else null end)
  order by f.esquema,f.oid::regprocedure::text),'[]'::jsonb) from funcoes f
 union all
 select 'acl_relacoes',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'objeto',r.relname,'concedente',pg_get_userbyid(a.grantor),
  'papel',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
  'privilegio',a.privilege_type,'grant_option',a.is_grantable)
  order by r.esquema,r.relname,a.grantee,a.privilege_type),'[]'::jsonb)
 from relacoes r cross join lateral aclexplode(coalesce(r.relacl,acldefault(case when r.relkind='S' then 's'::"char" else 'r'::"char" end,r.relowner))) a
 union all
 select 'acl_funcoes',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',f.esquema,'objeto',f.oid::regprocedure::text,'concedente',pg_get_userbyid(a.grantor),
  'papel',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
  'privilegio',a.privilege_type,'grant_option',a.is_grantable)
  order by f.esquema,f.oid::regprocedure::text,a.grantee,a.privilege_type),'[]'::jsonb)
 from funcoes f cross join lateral aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
 union all
 select 'schemas',coalesce(jsonb_agg(jsonb_build_object('nome',nspname,'dono',pg_get_userbyid(nspowner),'acl',nspacl::text) order by nspname),'[]'::jsonb)
 from pg_namespace where nspname in ('public','auth','storage')
 union all
 select 'defaults_acl',coalesce(jsonb_agg(jsonb_build_object('dono',pg_get_userbyid(d.defaclrole),
  'esquema',coalesce(n.nspname,'*'),'tipo',d.defaclobjtype,'acl',d.defaclacl::text)
  order by d.defaclrole,d.defaclnamespace,d.defaclobjtype),'[]'::jsonb)
 from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
 where d.defaclnamespace=0 or n.nspname in ('public','auth','storage')
 union all
 select 'papeis',coalesce(jsonb_agg(jsonb_build_object('nome',rolname,'superuser',rolsuper,
  'inherit',rolinherit,'login',rolcanlogin,'create_role',rolcreaterole,'bypass_rls',rolbypassrls) order by rolname),'[]'::jsonb) from pg_roles
 union all
 select 'membros_papeis',coalesce(jsonb_agg(jsonb_build_object('papel',pg_get_userbyid(m.roleid),
  'membro',pg_get_userbyid(m.member),'concedente',pg_get_userbyid(m.grantor),'admin_option',m.admin_option,
  'inherit_option',to_jsonb(m)->'inherit_option','set_option',to_jsonb(m)->'set_option')
  order by m.roleid,m.member),'[]'::jsonb) from pg_auth_members m
 union all
 select 'dependencias_entrada',coalesce(jsonb_agg(jsonb_build_object(
  'objeto',pg_describe_object(d.classid,d.objid,d.objsubid),
  'referencia',pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid),'tipo',d.deptype)
  order by d.classid,d.objid,d.objsubid,d.refobjid,d.refobjsubid),'[]'::jsonb)
 from pg_depend d where (d.refclassid='pg_class'::regclass and d.refobjid in (select oid from relacoes))
  or (d.refclassid='pg_proc'::regclass and d.refobjid in (select oid from funcoes))
), catalogo as (select jsonb_object_agg(secao,itens order by secao) as corpo from secoes)

 select corpo into observado from catalogo;
 if md5(observado::text)<>'8abc338413ff0c60770d3aea1c3413d1' then
  raise exception 'Catálogo divergente: abortado sem alteração. Capture novo inventário e revise o delta';
 end if;
end
$preestado$;

-- Identificação conferida por empresa. Aplicação LOCAL; pode ser reaplicada.
-- Requer acesso_empresa_convites.sql. Não cria bucket; restringe a ACL da função interna de trigger.
do $$ begin
 if to_regprocedure('public.pode_acessar_empresa_operacao(uuid,uuid)') is null or to_regprocedure('public.acesso_arquivo_operacao(text)') is null then raise exception 'Instale primeiro o isolamento por empresa'; end if;
 if not exists(select 1 from storage.buckets where id='operacao-documentos' and public=false) then raise exception 'Bucket privado obrigatório'; end if;
end $$;
create table public.operacao_identificacao_empresa(
 empresa_id uuid primary key, organizacao_id uuid not null,
 dados_confirmados jsonb not null, proveniencia jsonb not null default '[]',
 confirmado_por uuid not null references auth.users(id), confirmado_em timestamptz not null default now(),
 versao bigint not null default 1, invalidado_em timestamptz,
 foreign key(empresa_id,organizacao_id) references public.operacao_empresas(id,organizacao_id) on delete cascade,
 check(jsonb_typeof(dados_confirmados)='object'),check(jsonb_typeof(proveniencia)='array')
);
alter table public.operacao_identificacao_empresa enable row level security;
create policy identificacao_empresa_leitura on public.operacao_identificacao_empresa for select to authenticated using(public.pode_acessar_empresa_operacao(organizacao_id,empresa_id));
revoke all on public.operacao_identificacao_empresa from anon,authenticated;
grant select on public.operacao_identificacao_empresa to authenticated;
grant all on public.operacao_identificacao_empresa to service_role;
create function public.invalidar_identificacao_empresa() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if TG_TABLE_SCHEMA='storage' then
 update public.operacao_identificacao_empresa p set invalidado_em=now() where exists(select 1 from jsonb_array_elements(p.proveniencia) x where x->>'arquivoCaminho'=old.name);
 elsif TG_TABLE_NAME='operacao_empresas' then
 if old.razao_social is distinct from new.razao_social or old.cnpj is distinct from new.cnpj then update public.operacao_identificacao_empresa set invalidado_em=now() where empresa_id=old.id; end if;
 else
 update public.operacao_identificacao_empresa p set invalidado_em=now() where exists(select 1 from jsonb_array_elements(p.proveniencia) x where x->>'documentoId'=old.id::text);
 end if; return null;
end $$;
-- Função interna: os triggers executam sem conceder chamada direta aos papéis da aplicação.
revoke all on function public.invalidar_identificacao_empresa() from public,anon,authenticated,service_role;
create trigger identificacao_documento_alterado after update or delete on public.operacao_documentos for each row execute function public.invalidar_identificacao_empresa();
create trigger identificacao_arquivo_alterado after update or delete on storage.objects for each row when(old.bucket_id='operacao-documentos') execute function public.invalidar_identificacao_empresa();
create trigger identificacao_cadastro_alterado after update on public.operacao_empresas for each row execute function public.invalidar_identificacao_empresa();

-- Segurança operacional incremental e idempotente. Execute no SQL Editor após
-- acesso_empresa_convites.sql e identificacao_empresa.sql. Não apaga dados.

create function public.pode_escrever_org_operacao(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.operacao_membros m where m.organizacao_id=p_org
  and m.usuario_id=auth.uid() and m.empresa_id is null and m.papel in ('gestor','operador'));
$$;
create function public.pode_escrever_empresa_operacao(p_org uuid,p_empresa uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.operacao_empresas e join public.operacao_membros m on m.organizacao_id=e.organizacao_id
  where e.id=p_empresa and e.organizacao_id=p_org and m.usuario_id=auth.uid()
  and m.papel in ('gestor','operador') and (m.empresa_id is null or m.empresa_id=e.id));
$$;
create function public.pode_escrever_processo_operacao(p_org uuid,p_processo uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.operacao_processos p where p.id=p_processo and p.organizacao_id=p_org
  and public.pode_escrever_empresa_operacao(p.organizacao_id,p.empresa_id));
$$;
create function public.arquivo_no_escopo_operacao(p_caminho text,p_org uuid,p_empresa uuid)
returns boolean language sql immutable set search_path = '' as $$
 select p_caminho is null or (p_caminho like p_org::text||'/'||p_empresa::text||'/%'
  and length(split_part(p_caminho,'/',3))>0);
$$;
create function public.escrita_arquivo_operacao(p_caminho text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
 if coalesce(array_length(string_to_array(p_caminho,'/'),1),0)<3 or length(split_part(p_caminho,'/',3))=0 then return false; end if;
 return public.pode_escrever_empresa_operacao(split_part(p_caminho,'/',1)::uuid,split_part(p_caminho,'/',2)::uuid);
exception when invalid_text_representation then return false;
end $$;
revoke all on function public.pode_escrever_org_operacao(uuid),public.pode_escrever_empresa_operacao(uuid,uuid),public.pode_escrever_processo_operacao(uuid,uuid),public.arquivo_no_escopo_operacao(text,uuid,uuid),public.escrita_arquivo_operacao(text) from public,anon;
grant execute on function public.pode_escrever_org_operacao(uuid),public.pode_escrever_empresa_operacao(uuid,uuid),public.pode_escrever_processo_operacao(uuid,uuid),public.arquivo_no_escopo_operacao(text,uuid,uuid),public.escrita_arquivo_operacao(text) to authenticated;
revoke all on function public.bootstrap_operacao(),public.eh_membro_operacao(uuid) from public,anon;
grant execute on function public.bootstrap_operacao(),public.eh_membro_operacao(uuid) to authenticated;

-- Sem migração silenciosa: relações/arquivos legados inconsistentes exigem revisão.
do $$ begin
 if exists(select 1 from public.operacao_documentos d join public.operacao_empresas e on e.id=d.empresa_id where d.organizacao_id<>e.organizacao_id or not public.arquivo_no_escopo_operacao(d.arquivo_caminho,d.organizacao_id,d.empresa_id))
 or exists(select 1 from public.operacao_processos p join public.operacao_empresas e on e.id=p.empresa_id where p.organizacao_id<>e.organizacao_id)
 or exists(select 1 from public.operacao_agenda a join public.operacao_empresas e on e.id=a.empresa_id where a.organizacao_id<>e.organizacao_id)
 or exists(select 1 from public.operacao_prazos_processo a join public.operacao_processos p on p.id=a.processo_id where a.organizacao_id<>p.organizacao_id)
 or exists(select 1 from public.operacao_empenhos a join public.operacao_processos p on p.id=a.processo_id where a.organizacao_id<>p.organizacao_id)
 or exists(select 1 from public.operacao_anexos_processo a join public.operacao_processos p on p.id=a.processo_id where a.organizacao_id<>p.organizacao_id or not public.arquivo_no_escopo_operacao(a.arquivo_caminho,p.organizacao_id,p.empresa_id))
 then raise exception 'Escopo legado inconsistente: revise organização, empresa e caminhos dos documentos/processos antes de aplicar a segurança'; end if;
end $$;

-- FKs compostas impedem vínculos cruzados também no backend que ignora RLS.
do $$ declare r record; begin
 for r in select * from (values
 ('operacao_documentos','empresa_id','operacao_empresas'),
 ('operacao_processos','empresa_id','operacao_empresas'),
 ('operacao_agenda','empresa_id','operacao_empresas'),
 ('operacao_prazos_processo','processo_id','operacao_processos'),
 ('operacao_empenhos','processo_id','operacao_processos')
 ) as t(tabela,coluna,pai) loop
 if not exists(select 1 from pg_constraint where conrelid=('public.'||r.tabela)::regclass and conname=r.tabela||'_escopo_fk') then
 execute format('alter table public.%I add constraint %I foreign key (%I,organizacao_id) references public.%I(id,organizacao_id) on delete cascade',r.tabela,r.tabela||'_escopo_fk',r.coluna,r.pai);
 end if;
 end loop;
 if not exists(select 1 from pg_constraint where conrelid='public.operacao_documentos'::regclass and conname='operacao_documentos_arquivo_escopo') then
 alter table public.operacao_documentos add constraint operacao_documentos_arquivo_escopo check(public.arquivo_no_escopo_operacao(arquivo_caminho,organizacao_id,empresa_id));
 end if;
end $$;
grant execute on function public.arquivo_no_escopo_operacao(text,uuid,uuid) to service_role;

-- Transferir um grafo com arquivos exige uma operação própria, ainda inexistente.
create function public.preservar_escopo_operacao()
returns trigger language plpgsql set search_path = '' as $$
begin
 if old.organizacao_id is distinct from new.organizacao_id or old.empresa_id is distinct from new.empresa_id then
 raise exception 'Escopo não pode ser transferido; crie um novo documento ou processo no CNPJ correto';
 end if;
 return new;
end $$;
create trigger preservar_escopo_operacao before update on public.operacao_documentos for each row execute function public.preservar_escopo_operacao();
create trigger preservar_escopo_operacao before update on public.operacao_processos for each row execute function public.preservar_escopo_operacao();

create function public.validar_arquivo_processo_operacao()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if not exists(select 1 from public.operacao_processos p where p.id=new.processo_id and p.organizacao_id=new.organizacao_id and public.arquivo_no_escopo_operacao(new.arquivo_caminho,p.organizacao_id,p.empresa_id)) then
 raise exception 'Arquivo fora do escopo do processo';
 end if;
 return new;
end $$;
revoke all on function public.preservar_escopo_operacao(),public.validar_arquivo_processo_operacao() from public,anon,authenticated,service_role;
create trigger validar_arquivo_processo_operacao before insert or update on public.operacao_anexos_processo for each row execute function public.validar_arquivo_processo_operacao();


-- Policies conhecidas são alteradas/renomeadas individualmente. Nenhuma é apagada.
alter policy "operacao_agenda_da_empresa" on "public"."operacao_agenda" rename to "operacao_agenda_da_empresa_escrita";
alter policy "operacao_agenda_da_empresa_escrita" on "public"."operacao_agenda" to "authenticated" using (pode_escrever_empresa_operacao(organizacao_id, empresa_id)) with check (pode_escrever_empresa_operacao(organizacao_id, empresa_id));
create policy "operacao_agenda_da_empresa" on "public"."operacao_agenda" for select to "authenticated" using (pode_acessar_empresa_operacao(organizacao_id, empresa_id));
alter policy "operacao_anexos_da_empresa" on "public"."operacao_anexos_processo" rename to "operacao_anexos_da_empresa_escrita";
alter policy "operacao_anexos_da_empresa_escrita" on "public"."operacao_anexos_processo" to "authenticated" using (pode_escrever_processo_operacao(organizacao_id, processo_id)) with check ((pode_escrever_processo_operacao(organizacao_id, processo_id) AND (EXISTS ( SELECT 1
   FROM operacao_processos p
  WHERE ((p.id = operacao_anexos_processo.processo_id) AND (p.organizacao_id = operacao_anexos_processo.organizacao_id) AND arquivo_no_escopo_operacao(operacao_anexos_processo.arquivo_caminho, p.organizacao_id, p.empresa_id))))));
create policy "operacao_anexos_da_empresa" on "public"."operacao_anexos_processo" for select to "authenticated" using (pode_acessar_processo_operacao(organizacao_id, processo_id));
alter policy "operacao_contratos_da_empresa" on "public"."operacao_contratos" rename to "operacao_contratos_da_empresa_escrita";
alter policy "operacao_contratos_da_empresa_escrita" on "public"."operacao_contratos" to "authenticated" using (pode_escrever_processo_operacao(organizacao_id, processo_id)) with check (pode_escrever_processo_operacao(organizacao_id, processo_id));
create policy "operacao_contratos_da_empresa" on "public"."operacao_contratos" for select to "authenticated" using (pode_acessar_processo_operacao(organizacao_id, processo_id));
alter policy "operacao_documentos_da_empresa" on "public"."operacao_documentos" rename to "operacao_documentos_da_empresa_escrita";
alter policy "operacao_documentos_da_empresa_escrita" on "public"."operacao_documentos" to "authenticated" using (pode_escrever_empresa_operacao(organizacao_id, empresa_id)) with check ((pode_escrever_empresa_operacao(organizacao_id, empresa_id) AND arquivo_no_escopo_operacao(arquivo_caminho, organizacao_id, empresa_id)));
create policy "operacao_documentos_da_empresa" on "public"."operacao_documentos" for select to "authenticated" using (pode_acessar_empresa_operacao(organizacao_id, empresa_id));
alter policy "operacao_empenhos_da_empresa" on "public"."operacao_empenhos" rename to "operacao_empenhos_da_empresa_escrita";
alter policy "operacao_empenhos_da_empresa_escrita" on "public"."operacao_empenhos" to "authenticated" using (pode_escrever_processo_operacao(organizacao_id, processo_id)) with check (pode_escrever_processo_operacao(organizacao_id, processo_id));
create policy "operacao_empenhos_da_empresa" on "public"."operacao_empenhos" for select to "authenticated" using (pode_acessar_processo_operacao(organizacao_id, processo_id));
alter policy "operacao_empresas_escrita" on "public"."operacao_empresas" to "authenticated" using (pode_escrever_org_operacao(organizacao_id)) with check (pode_escrever_org_operacao(organizacao_id));
alter policy "operacao_itens_da_empresa" on "public"."operacao_itens_resultado" rename to "operacao_itens_da_empresa_escrita";
alter policy "operacao_itens_da_empresa_escrita" on "public"."operacao_itens_resultado" to "authenticated" using (pode_escrever_processo_operacao(organizacao_id, processo_id)) with check (pode_escrever_processo_operacao(organizacao_id, processo_id));
create policy "operacao_itens_da_empresa" on "public"."operacao_itens_resultado" for select to "authenticated" using (pode_acessar_processo_operacao(organizacao_id, processo_id));
alter policy "operacao_ocorrencias_da_empresa" on "public"."operacao_ocorrencias" rename to "operacao_ocorrencias_da_empresa_escrita";
alter policy "operacao_ocorrencias_da_empresa_escrita" on "public"."operacao_ocorrencias" to "authenticated" using (pode_escrever_processo_operacao(organizacao_id, processo_id)) with check (pode_escrever_processo_operacao(organizacao_id, processo_id));
create policy "operacao_ocorrencias_da_empresa" on "public"."operacao_ocorrencias" for select to "authenticated" using (pode_acessar_processo_operacao(organizacao_id, processo_id));
alter policy "operacao_prazos_da_empresa" on "public"."operacao_prazos_processo" rename to "operacao_prazos_da_empresa_escrita";
alter policy "operacao_prazos_da_empresa_escrita" on "public"."operacao_prazos_processo" to "authenticated" using (pode_escrever_processo_operacao(organizacao_id, processo_id)) with check (pode_escrever_processo_operacao(organizacao_id, processo_id));
create policy "operacao_prazos_da_empresa" on "public"."operacao_prazos_processo" for select to "authenticated" using (pode_acessar_processo_operacao(organizacao_id, processo_id));
alter policy "operacao_processos_da_empresa" on "public"."operacao_processos" rename to "operacao_processos_da_empresa_escrita";
alter policy "operacao_processos_da_empresa_escrita" on "public"."operacao_processos" to "authenticated" using (pode_escrever_empresa_operacao(organizacao_id, empresa_id)) with check (pode_escrever_empresa_operacao(organizacao_id, empresa_id));
create policy "operacao_processos_da_empresa" on "public"."operacao_processos" for select to "authenticated" using (pode_acessar_empresa_operacao(organizacao_id, empresa_id));
alter policy "operacao_renovacoes_da_empresa" on "public"."operacao_renovacoes_documento" rename to "operacao_renovacoes_da_empresa_escrita";
alter policy "operacao_renovacoes_da_empresa_escrita" on "public"."operacao_renovacoes_documento" to "authenticated" using ((EXISTS ( SELECT 1
   FROM operacao_documentos d
  WHERE ((d.id = operacao_renovacoes_documento.documento_id) AND pode_escrever_empresa_operacao(d.organizacao_id, d.empresa_id))))) with check ((EXISTS ( SELECT 1
   FROM operacao_documentos d
  WHERE ((d.id = operacao_renovacoes_documento.documento_id) AND pode_escrever_empresa_operacao(d.organizacao_id, d.empresa_id)))));
create policy "operacao_renovacoes_da_empresa" on "public"."operacao_renovacoes_documento" for select to "authenticated" using ((EXISTS ( SELECT 1
   FROM operacao_documentos d
  WHERE ((d.id = operacao_renovacoes_documento.documento_id) AND pode_acessar_empresa_operacao(d.organizacao_id, d.empresa_id)))));
alter policy "operacao_tipos_escrita" on "public"."operacao_tipos_documento" to "authenticated" using (((organizacao_id IS NOT NULL) AND pode_escrever_org_operacao(organizacao_id))) with check (((organizacao_id IS NOT NULL) AND pode_escrever_org_operacao(organizacao_id)));
alter policy "operacao_arquivos_atualizacao" on "storage"."objects" to "authenticated" using (((bucket_id = 'operacao-documentos'::text) AND escrita_arquivo_operacao(name))) with check (((bucket_id = 'operacao-documentos'::text) AND escrita_arquivo_operacao(name)));
alter policy "operacao_arquivos_envio" on "storage"."objects" to "authenticated" with check (((bucket_id = 'operacao-documentos'::text) AND escrita_arquivo_operacao(name)));
alter policy "operacao_arquivos_exclusao" on "storage"."objects" to "authenticated" using (((bucket_id = 'operacao-documentos'::text) AND escrita_arquivo_operacao(name)));

-- O backend informa o usuário: validar seu papel também ao ignorar RLS.
create function public.confirmar_identificacao_empresa(p_empresa uuid,p_usuario uuid,p_razao text,p_cnpj text,p_dados jsonb,p_proveniencia jsonb) returns public.operacao_identificacao_empresa language plpgsql security definer set search_path=public as $$
declare e public.operacao_empresas; r public.operacao_identificacao_empresa; x jsonb;
begin
 select * into e from public.operacao_empresas where id=p_empresa for update;
 if e.id is null or not exists(select 1 from public.operacao_membros m where m.organizacao_id=e.organizacao_id and m.usuario_id=p_usuario and m.papel in ('gestor','operador') and (m.empresa_id is null or m.empresa_id=e.id)) then raise exception 'Empresa indisponível'; end if;
 if e.razao_social<>p_razao or regexp_replace(e.cnpj,'\D','','g')<>regexp_replace(p_cnpj,'\D','','g') then raise exception 'Cadastro divergente'; end if;
 if jsonb_typeof(p_dados)<>'object' or (p_dados - array['endereco','representante','cargo'])<>'{}'::jsonb or jsonb_typeof(p_proveniencia)<>'array' or jsonb_array_length(p_proveniencia)>3 or (select count(distinct entrada.valor->>'documentoId') from jsonb_array_elements(p_proveniencia) as entrada(valor))>2 then raise exception 'Dados inválidos'; end if;
 if p_dados->>'endereco' is null or p_dados->>'representante' is null or p_dados->>'cargo' is null or length(trim(p_dados->>'endereco')) not between 1 and 500 or length(trim(p_dados->>'representante')) not between 1 and 180 or length(trim(p_dados->>'cargo')) not between 1 and 120 then raise exception 'Dados incompletos'; end if;
 for x in select * from jsonb_array_elements(p_proveniencia) loop
 if not exists(select 1 from public.operacao_documentos d where d.id=(x->>'documentoId')::uuid and d.empresa_id=e.id and d.organizacao_id=e.organizacao_id and d.arquivo_caminho=x->>'arquivoCaminho' and d.arquivo_caminho like e.organizacao_id::text||'/'||e.id::text||'/%') or coalesce(x->>'hash','') !~ '^[a-f0-9]{64}$' then raise exception 'Documento inválido'; end if;
 end loop;
 insert into public.operacao_identificacao_empresa(empresa_id,organizacao_id,dados_confirmados,proveniencia,confirmado_por) values(e.id,e.organizacao_id,p_dados,p_proveniencia,p_usuario)
 on conflict(empresa_id) do update set dados_confirmados=excluded.dados_confirmados,proveniencia=excluded.proveniencia,confirmado_por=excluded.confirmado_por,confirmado_em=now(),invalidado_em=null,versao=operacao_identificacao_empresa.versao+1 returning * into r;
 return r;
end $$;
revoke all on function public.confirmar_identificacao_empresa(uuid,uuid,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.confirmar_identificacao_empresa(uuid,uuid,text,text,jsonb,jsonb) to service_role;


-- Prontidão: definições esperadas, e não só a presença dos nomes das policies.
-- Qualquer policy adicional nas tabelas protegidas fecha o gate.
create function public.identificacao_empresa_habilitada()
returns boolean language sql stable security definer set search_path = public as $$
 with esperado(tabela,nome,comando,qual,checagem) as (values
 ('operacao_empresas','operacao_empresas_leitura','SELECT','pode_acessar_empresa_operacao(organizacao_id, id)',null),
 ('operacao_empresas','operacao_empresas_escrita','ALL','pode_escrever_org_operacao(organizacao_id)','pode_escrever_org_operacao(organizacao_id)'),
 ('operacao_documentos','operacao_documentos_da_empresa','SELECT','pode_acessar_empresa_operacao(organizacao_id, empresa_id)',null),
 ('operacao_documentos','operacao_documentos_da_empresa_escrita','ALL','pode_escrever_empresa_operacao(organizacao_id, empresa_id)','(pode_escrever_empresa_operacao(organizacao_id, empresa_id) AND arquivo_no_escopo_operacao(arquivo_caminho, organizacao_id, empresa_id))'),
 ('objects','operacao_arquivos_leitura','SELECT','((bucket_id = ''operacao-documentos''::text) AND acesso_arquivo_operacao(name))',null),
 ('objects','operacao_arquivos_envio','INSERT',null,'((bucket_id = ''operacao-documentos''::text) AND escrita_arquivo_operacao(name))'),
 ('objects','operacao_arquivos_atualizacao','UPDATE','((bucket_id = ''operacao-documentos''::text) AND escrita_arquivo_operacao(name))','((bucket_id = ''operacao-documentos''::text) AND escrita_arquivo_operacao(name))'),
 ('objects','operacao_arquivos_exclusao','DELETE','((bucket_id = ''operacao-documentos''::text) AND escrita_arquivo_operacao(name))',null)
 ), atual as (select * from pg_policies where (schemaname='public' and tablename in ('operacao_documentos','operacao_empresas')) or (schemaname='storage' and tablename='objects'))
 select auth.uid() is not null
 and exists(select 1 from storage.buckets where id='operacao-documentos' and public=false)
 and exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='storage' and c.relname='objects' and c.relrowsecurity)
 and (select count(*)=3 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('operacao_empresas','operacao_documentos','operacao_identificacao_empresa') and c.relrowsecurity)
 and not exists(select 1 from esperado e full join atual a on a.tablename=e.tabela and a.policyname=e.nome
  where e.nome is null or a.policyname is null or a.cmd<>e.comando or a.permissive<>'PERMISSIVE'
   or a.qual is distinct from e.qual or a.with_check is distinct from e.checagem
   or a.roles is distinct from case when e.nome in ('operacao_empresas_leitura','operacao_arquivos_leitura') then array['public']::name[] else array['authenticated']::name[] end)
 and not exists(select 1 from (values
 ('pode_escrever_org_operacao','c5fa4a20c0df119753f8f2efd99b4264'),
 ('pode_escrever_empresa_operacao','c5e91057ee05d745a22bd2fc89c80322'),
 ('pode_escrever_processo_operacao','7de47c8d343558a2dc2180ad2a4daffc'),
 ('arquivo_no_escopo_operacao','c727f040598b92b257a5322118447d6f'),
 ('escrita_arquivo_operacao','d95ab917f9d1faf6270e16d85dda42fd')
 ) as f(nome,hash) where not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=f.nome and md5(replace(p.prosrc,chr(13),''))=f.hash));
$$;
revoke all on function public.identificacao_empresa_habilitada() from public,anon;
grant execute on function public.identificacao_empresa_habilitada() to authenticated;

-- Peças de declaração/proposta por empresa. Idempotente; aplicar no SQL Editor
-- somente após identificacao_empresa.sql e seguranca_operacao.sql. Sem dados reais.
create unique index operacao_processos_id_empresa_org_idx
 on public.operacao_processos(id,empresa_id,organizacao_id);
create table public.operacao_kit_documentos(
 id uuid primary key,organizacao_id uuid not null,empresa_id uuid not null,processo_id uuid not null,
 tipo text not null check(tipo in ('declaracao','proposta')),dados jsonb not null check(jsonb_typeof(dados)='object'),
 versao integer not null default 1 check(versao>0),
 criado_por uuid not null references auth.users(id),criado_em timestamptz not null default now(),
 atualizado_por uuid not null references auth.users(id),atualizado_em timestamptz not null default now(),
 revisao_hash text,revisao_previa jsonb,revisao_versao integer,
 revisado_por uuid references auth.users(id),revisado_em timestamptz,
 foreign key(processo_id,empresa_id,organizacao_id) references public.operacao_processos(id,empresa_id,organizacao_id),
 check((revisao_hash is null and revisao_previa is null and revisao_versao is null and revisado_por is null and revisado_em is null)
  or (revisao_hash is not null and revisao_hash ~ '^[a-f0-9]{64}$' and revisao_previa is not null and jsonb_typeof(revisao_previa)='object' and revisao_versao is not null and revisao_versao=versao and revisado_por is not null and revisado_em is not null))
);
alter table public.operacao_kit_documentos enable row level security;
create index operacao_kit_documentos_escopo_idx on public.operacao_kit_documentos(organizacao_id,empresa_id,processo_id,atualizado_em desc);
create policy operacao_kit_documentos_select_empresa on public.operacao_kit_documentos for select to authenticated
 using(public.pode_acessar_empresa_operacao(organizacao_id,empresa_id)
  and exists(select 1 from public.clientes c where c.id=auth.uid() and c.status='aprovado')
  and exists(select 1 from public.operacao_empresas e where e.id=operacao_kit_documentos.empresa_id and e.organizacao_id=operacao_kit_documentos.organizacao_id and e.ativo));

create function public.kit_documento_escopo_imutavel() returns trigger
 language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
 if row(new.id,new.organizacao_id,new.empresa_id,new.processo_id,new.tipo,new.criado_por,new.criado_em)
  is distinct from row(old.id,old.organizacao_id,old.empresa_id,old.processo_id,old.tipo,old.criado_por,old.criado_em)
 then raise sqlstate 'PT409' using message='Escopo e autoria da peça são imutáveis';end if;
 return new;
end $$;
create trigger kit_documento_escopo_imutavel before update on public.operacao_kit_documentos
 for each row execute function public.kit_documento_escopo_imutavel();

create function public.gravar_kit_documento(
 p_documento uuid,p_empresa uuid,p_processo uuid,p_organizacao uuid,p_usuario uuid,
 p_versao integer,p_tipo text,p_acao text,p_dados jsonb,p_hash text default null,p_previa jsonb default null
) returns public.operacao_kit_documentos language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare d public.operacao_kit_documentos;v jsonb;x record;item_id text;limite integer;
begin
 if p_documento is null or p_usuario is null or p_versao is null or p_versao<0 or p_versao>2147483646
  or p_tipo is null or p_tipo not in ('declaracao','proposta') or p_acao is null or p_acao not in ('salvar','confirmarRevisao')
 then raise sqlstate 'PT400' using message='Solicitação inválida';end if;
 if not exists(select 1 from public.clientes c join public.operacao_membros m on m.usuario_id=c.id
  join public.operacao_empresas e on e.organizacao_id=m.organizacao_id
  where c.id=p_usuario and c.status='aprovado' and m.papel in ('gestor','operador')
   and e.ativo and e.id=p_empresa and e.organizacao_id=p_organizacao and (m.empresa_id is null or m.empresa_id=e.id))
 then raise sqlstate 'PT403' using message='Acesso não autorizado';end if;
 if not exists(select 1 from public.operacao_processos p where p.id=p_processo and p.empresa_id=p_empresa and p.organizacao_id=p_organizacao)
 then raise sqlstate 'PT404' using message='Processo indisponível';end if;

 if p_dados is null or jsonb_typeof(p_dados)<>'object' or p_dados-array[p_tipo]<>'{}'::jsonb or jsonb_typeof(p_dados->p_tipo) is distinct from 'object' or length(p_dados::text)>50000
 then raise sqlstate 'PT400' using message='Dados inválidos';end if;
 v:=p_dados->p_tipo;
 if (p_tipo='declaracao' and v-array['titulo','texto','fonte']<>'{}'::jsonb)
  or (p_tipo='proposta' and v-array['itemIds','unidades','validade','prazoEntrega','pagamento']<>'{}'::jsonb)
 then raise sqlstate 'PT400' using message='Campo não permitido';end if;
 for x in select key,value from jsonb_each(v) where key not in ('itemIds','unidades') loop
  limite:=case x.key when 'titulo' then 180 when 'texto' then 20000 when 'fonte' then 1000 else 500 end;
  if jsonb_typeof(x.value)<>'string' or length(x.value#>>'{}')>limite or regexp_replace(x.value#>>'{}',E'[\t\n\r]','','g') ~ '[[:cntrl:]]'
  then raise sqlstate 'PT400' using message='Texto inválido';end if;
 end loop;
 if p_tipo='proposta' then
  if (v?'itemIds' and jsonb_typeof(v->'itemIds')<>'array') or (v?'unidades' and jsonb_typeof(v->'unidades')<>'object')
  then raise sqlstate 'PT400' using message='Itens e unidades inválidos';end if;
  if jsonb_array_length(coalesce(v->'itemIds','[]'))>50
  or (select count(*)<>count(distinct lower(value#>>'{}')) from jsonb_array_elements(coalesce(v->'itemIds','[]')))
  then raise sqlstate 'PT400' using message='Itens duplicados ou excessivos';end if;
  for x in select value from jsonb_array_elements(coalesce(v->'itemIds','[]')) loop
   item_id:=x.value#>>'{}';
   if jsonb_typeof(x.value)<>'string' or item_id !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   then raise sqlstate 'PT400' using message='Item inválido';end if;
   if not exists(select 1 from public.operacao_itens_resultado i where i.id=item_id::uuid and i.processo_id=p_processo and i.organizacao_id=p_organizacao)
   then raise sqlstate 'PT404' using message='Item indisponível';end if;
  end loop;
  for x in select key,value from jsonb_each(coalesce(v->'unidades','{}')) loop
   if not (coalesce(v->'itemIds','[]') ? x.key) or jsonb_typeof(x.value)<>'string' or length(x.value#>>'{}')>40 or regexp_replace(x.value#>>'{}',E'[\t\n\r]','','g') ~ '[[:cntrl:]]'
   then raise sqlstate 'PT400' using message='Unidade inválida';end if;
  end loop;
 end if;

 if p_acao='salvar' and p_versao=0 then
  insert into public.operacao_kit_documentos(id,organizacao_id,empresa_id,processo_id,tipo,dados,criado_por,atualizado_por)
   values(p_documento,p_organizacao,p_empresa,p_processo,p_tipo,p_dados,p_usuario,p_usuario)
   on conflict(id) do nothing returning * into d;
  if d.id is not null then return d;end if;
 end if;
 select * into d from public.operacao_kit_documentos where id=p_documento for update;
 if d.id is null then raise sqlstate 'PT404' using message='Documento indisponível';end if;
 if d.organizacao_id<>p_organizacao or d.empresa_id<>p_empresa or d.processo_id<>p_processo or d.tipo<>p_tipo
 then raise sqlstate 'PT409' using message='Escopo ou tipo divergente';end if;
 -- A mesma intenção só é recuperável antes da primeira edição e pelo seu autor.
 if p_acao='salvar' and p_versao=0 and d.versao=1 and d.criado_por=p_usuario and d.dados=p_dados then return d;end if;
 if d.versao<>p_versao then raise sqlstate 'PT409' using message='Versão alterada';end if;
 if p_acao='salvar' then
  update public.operacao_kit_documentos set dados=p_dados,versao=versao+1,atualizado_por=p_usuario,atualizado_em=clock_timestamp(),
   revisao_hash=null,revisao_previa=null,revisao_versao=null,revisado_por=null,revisado_em=null
   where id=p_documento and versao=p_versao returning * into d;
 else
  if d.dados<>p_dados then raise sqlstate 'PT409' using message='Dados alterados';end if;
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_previa is null or jsonb_typeof(p_previa)<>'object'
   or p_previa-array['texto','fontes']<>'{}'::jsonb or jsonb_typeof(p_previa->'texto') is distinct from 'string'
   or length(p_previa->>'texto') not between 1 and 1000000 or jsonb_typeof(p_previa->'fontes') is distinct from 'array'
  then raise sqlstate 'PT400' using message='Revisão inválida';end if;
  if jsonb_array_length(p_previa->'fontes')>10 or exists(select 1 from jsonb_array_elements(p_previa->'fontes') f where jsonb_typeof(f)<>'string' or length(f#>>'{}')>2000)
  then raise sqlstate 'PT400' using message='Fontes da revisão inválidas';end if;
  update public.operacao_kit_documentos set revisao_hash=p_hash,revisao_previa=p_previa,revisao_versao=versao,revisado_por=p_usuario,revisado_em=clock_timestamp()
   where id=p_documento and versao=p_versao returning * into d;
 end if;
 if d.id is null then raise sqlstate 'PT409' using message='Versão alterada';end if;
 return d;
end $$;
-- Defaults do ambiente podem conceder acesso a outros papéis: normaliza só os três objetos do kit, preservando seus donos.
do $acl_kit$
declare objeto record;papel record;
begin
 for objeto in
  select 'table public.operacao_kit_documentos' as alvo,c.relowner as dono,
   coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner)) as acl
  from pg_catalog.pg_class c where c.oid='public.operacao_kit_documentos'::pg_catalog.regclass
  union all
  select 'function '||p.oid::pg_catalog.regprocedure::text,p.proowner,
   coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))
  from pg_catalog.pg_proc p where p.oid in (
   'public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb)'::pg_catalog.regprocedure,
   'public.kit_documento_escopo_imutavel()'::pg_catalog.regprocedure
  )
 loop
  for papel in select distinct a.grantee from pg_catalog.aclexplode(objeto.acl) a where a.grantee<>objeto.dono loop
   execute pg_catalog.format('revoke all on %s from %s',objeto.alvo,
    case when papel.grantee=0 then 'public' else pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(papel.grantee)) end);
  end loop;
 end loop;
end
$acl_kit$;
grant select on public.operacao_kit_documentos to authenticated,service_role;
grant execute on function public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb) to service_role;

-- Gate integral homologado, sem mudanças.
-- Gate de configuração do kit, executado pelo dono da base após kit_documentos.sql.
-- Somente catálogos: não lê peças, não corrige permissões e não substitui a RLS.
-- A homologação deve parar se houver erro. Reexecutar após qualquer mudança de acesso.
do $verificacao$
declare
 tabela record;
 politica record;
 rotina record;
 papel record;
 rpc oid;
 funcao_trigger oid;
begin
 if ((pg_catalog.current_schemas(true))[1] operator(pg_catalog.=) 'pg_catalog'::pg_catalog.name) is not true then
  raise exception 'Kit pré-publicação: search_path deve resolver pg_catalog antes dos demais schemas';
 end if;
 select c.* into tabela from pg_catalog.pg_class c
 join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname='operacao_kit_documentos';
 if not found or tabela.relkind<>'r' or tabela.relpersistence<>'p' then
  raise exception 'Kit pré-publicação: tabela permanente operacao_kit_documentos ausente ou incompatível';
 end if;
 if not tabela.relrowsecurity then
  raise exception 'Kit pré-publicação: RLS de operacao_kit_documentos deve estar habilitada';
 end if;
 if (select count(*) from pg_catalog.pg_roles where rolname in ('anon','authenticated','service_role'))<>3
 or exists(select 1 from pg_catalog.pg_roles where rolname in ('anon','authenticated') and (rolsuper or rolbypassrls))
 or tabela.relowner in (select oid from pg_catalog.pg_roles where rolname in ('anon','authenticated','service_role')) then
  raise exception 'Kit pré-publicação: papéis de acesso ou proprietário incompatíveis';
 end if;

 if (select count(*) from pg_catalog.pg_policy where polrelid=tabela.oid)<>1 then
  raise exception 'Kit pré-publicação: deve existir somente a policy operacao_kit_documentos_select_empresa';
 end if;
 select p.* into politica from pg_catalog.pg_policy p where p.polrelid=tabela.oid;
 -- O deparser só pode omitir schemas quando os objetos públicos esperados são visíveis.
 if pg_catalog.pg_function_is_visible(pg_catalog.to_regprocedure('public.pode_acessar_empresa_operacao(uuid,uuid)')) is not true
 or pg_catalog.pg_table_is_visible(pg_catalog.to_regclass('public.clientes')) is not true
 or pg_catalog.pg_table_is_visible(pg_catalog.to_regclass('public.operacao_empresas')) is not true
 or pg_catalog.pg_table_is_visible(tabela.oid) is not true then
  raise exception 'Kit pré-publicação: policy com resolução ambígua dos objetos públicos esperados';
 end if;
 -- Comparação integral: procurar nomes com LIKE aceitaria uma policy acrescida de OR true.
 if politica.polname<>'operacao_kit_documentos_select_empresa' or politica.polcmd<>'r'
 or not politica.polpermissive or politica.polwithcheck is not null
 or politica.polroles<>array[(select oid from pg_catalog.pg_roles where rolname='authenticated')]
 or pg_catalog.regexp_replace(pg_catalog.replace(pg_catalog.pg_get_expr(politica.polqual,tabela.oid),'public.',''),'[[:space:]]+',' ','g') is distinct from
  '(pode_acessar_empresa_operacao(organizacao_id, empresa_id) AND (EXISTS ( SELECT 1 FROM clientes c WHERE ((c.id = auth.uid()) AND (c.status = ''aprovado''::text)))) AND (EXISTS ( SELECT 1 FROM operacao_empresas e WHERE ((e.id = operacao_kit_documentos.empresa_id) AND (e.organizacao_id = operacao_kit_documentos.organizacao_id) AND e.ativo))))' then
  raise exception 'Kit pré-publicação: policy de leitura diverge do escopo, cliente aprovado ou empresa ativa esperados';
 end if;

 if exists(
  select 1 from pg_catalog.aclexplode(coalesce(tabela.relacl,pg_catalog.acldefault('r',tabela.relowner))) a
  where a.grantee<>tabela.relowner and not (
   a.grantee in (select oid from pg_catalog.pg_roles where rolname in ('authenticated','service_role'))
   and a.privilege_type='SELECT' and not a.is_grantable
  )
 ) or exists(
  select 1 from pg_catalog.pg_attribute c cross join lateral pg_catalog.aclexplode(c.attacl) a
  where c.attrelid=tabela.oid and c.attnum>0 and not c.attisdropped and a.grantee<>tabela.relowner
 ) then
  raise exception 'Kit pré-publicação: privilégio de tabela ou coluna não previsto para o kit';
 end if;
 for papel in select oid,rolname from pg_catalog.pg_roles where rolname in ('anon','authenticated','service_role') loop
  if pg_catalog.has_table_privilege(papel.oid,tabela.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  or pg_catalog.has_any_column_privilege(papel.oid,tabela.oid,'INSERT,UPDATE,REFERENCES')
  or pg_catalog.has_table_privilege(papel.oid,tabela.oid,'SELECT WITH GRANT OPTION')
  or (papel.rolname='anon' and pg_catalog.has_any_column_privilege(papel.oid,tabela.oid,'SELECT'))
  or (papel.rolname<>'anon' and not pg_catalog.has_table_privilege(papel.oid,tabela.oid,'SELECT')) then
   raise exception 'Kit pré-publicação: privilégio efetivo de acesso ao kit incompatível';
  end if;
 end loop;

 rpc:=pg_catalog.to_regprocedure('public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb)');
 if rpc is null or (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='gravar_kit_documento')<>1 then
  raise exception 'Kit pré-publicação: RPC gravar_kit_documento ausente, assinatura divergente ou sobrecarga adicional';
 end if;
 select p.* into rotina from pg_catalog.pg_proc p where p.oid=rpc;
 if rotina.prokind<>'f' or not rotina.prosecdef or rotina.proretset or rotina.prorettype<>tabela.reltype
 or rotina.proowner<>tabela.relowner or rotina.pronargdefaults<>2 or rotina.proargmodes is not null
 or rotina.proargnames is distinct from array['p_documento','p_empresa','p_processo','p_organizacao','p_usuario','p_versao','p_tipo','p_acao','p_dados','p_hash','p_previa']::text[]
 or rotina.prolang<>(select oid from pg_catalog.pg_language where lanname='plpgsql')
 or rotina.proconfig is distinct from array['search_path=pg_catalog, pg_temp']::text[] then
  raise exception 'Kit pré-publicação: RPC com identidade, proprietário, SECURITY DEFINER ou search_path incompatível';
 end if;
 if exists(
  select 1 from pg_catalog.aclexplode(coalesce(rotina.proacl,pg_catalog.acldefault('f',rotina.proowner))) a
  where a.grantee<>rotina.proowner and not (
   a.grantee=(select oid from pg_catalog.pg_roles where rolname='service_role')
   and a.privilege_type='EXECUTE' and not a.is_grantable
  )
 ) or pg_catalog.has_function_privilege('anon',rpc,'EXECUTE')
 or pg_catalog.has_function_privilege('authenticated',rpc,'EXECUTE')
 or not pg_catalog.has_function_privilege('service_role',rpc,'EXECUTE')
 or pg_catalog.has_function_privilege('service_role',rpc,'EXECUTE WITH GRANT OPTION') then
  raise exception 'Kit pré-publicação: RPC EXECUTE deve estar restrito ao proprietário e service_role, sem repasse';
 end if;

 funcao_trigger:=pg_catalog.to_regprocedure('public.kit_documento_escopo_imutavel()');
 if funcao_trigger is null or (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='kit_documento_escopo_imutavel')<>1 then
  raise exception 'Kit pré-publicação: função do trigger ausente ou assinatura incompatível';
 end if;
 select p.* into rotina from pg_catalog.pg_proc p where p.oid=funcao_trigger;
 if rotina.prokind<>'f' or rotina.prosecdef or rotina.proretset or rotina.prorettype<>'pg_catalog.trigger'::regtype
 or rotina.proowner<>tabela.relowner
 or rotina.prolang<>(select oid from pg_catalog.pg_language where lanname='plpgsql')
 or rotina.proconfig is distinct from array['search_path=pg_catalog, pg_temp']::text[] then
  raise exception 'Kit pré-publicação: função do trigger com identidade, proprietário ou search_path incompatível';
 end if;
 if exists(
  select 1 from pg_catalog.aclexplode(coalesce(rotina.proacl,pg_catalog.acldefault('f',rotina.proowner))) a
  where a.grantee<>rotina.proowner
 ) or pg_catalog.has_function_privilege('anon',funcao_trigger,'EXECUTE')
 or pg_catalog.has_function_privilege('authenticated',funcao_trigger,'EXECUTE') then
  raise exception 'Kit pré-publicação: trigger EXECUTE deve estar restrito ao proprietário';
 end if;
 if (select count(*) from pg_catalog.pg_trigger t where t.tgrelid=tabela.oid and not t.tgisinternal)<>1
 or not exists(
  select 1 from pg_catalog.pg_trigger t where t.tgrelid=tabela.oid and not t.tgisinternal
   and t.tgname='kit_documento_escopo_imutavel' and t.tgfoid=funcao_trigger
   and t.tgenabled='O' and t.tgtype=19 and t.tgnargs=0 and t.tgattr=''::int2vector
   and t.tgqual is null and t.tgoldtable is null and t.tgnewtable is null
 ) then
  raise exception 'Kit pré-publicação: trigger BEFORE UPDATE de escopo ausente, desabilitado, alterado ou adicional';
 end if;
end
$verificacao$;
select 'KIT_PREPUBLICACAO_OK' as status;

do $posestado$
declare politicas jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('esquema',schemaname,'tabela',tablename,'nome',policyname,
  'permissiva',permissive,'papeis',roles,'comando',cmd,'using',qual,'check',with_check)
  order by schemaname,tablename,policyname),'[]'::jsonb) into politicas
 from pg_policies where (schemaname='storage' and tablename='objects') or
  (schemaname='public' and tablename like 'operacao\_%' escape '\' and tablename not in ('operacao_identificacao_empresa','operacao_kit_documentos'));
 if politicas is distinct from '[{"nome":"operacao_agenda_da_empresa","check":null,"using":"pode_acessar_empresa_operacao(organizacao_id, empresa_id)","papeis":["authenticated"],"tabela":"operacao_agenda","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_agenda_da_empresa_escrita","check":"pode_escrever_empresa_operacao(organizacao_id, empresa_id)","using":"pode_escrever_empresa_operacao(organizacao_id, empresa_id)","papeis":["authenticated"],"tabela":"operacao_agenda","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_anexos_da_empresa","check":null,"using":"pode_acessar_processo_operacao(organizacao_id, processo_id)","papeis":["authenticated"],"tabela":"operacao_anexos_processo","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_anexos_da_empresa_escrita","check":"(pode_escrever_processo_operacao(organizacao_id, processo_id) AND (EXISTS ( SELECT 1\n   FROM operacao_processos p\n  WHERE ((p.id = operacao_anexos_processo.processo_id) AND (p.organizacao_id = operacao_anexos_processo.organizacao_id) AND arquivo_no_escopo_operacao(operacao_anexos_processo.arquivo_caminho, p.organizacao_id, p.empresa_id)))))","using":"pode_escrever_processo_operacao(organizacao_id, processo_id)","papeis":["authenticated"],"tabela":"operacao_anexos_processo","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_contratos_da_empresa","check":null,"using":"pode_acessar_processo_operacao(organizacao_id, processo_id)","papeis":["authenticated"],"tabela":"operacao_contratos","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_contratos_da_empresa_escrita","check":"pode_escrever_processo_operacao(organizacao_id, processo_id)","using":"pode_escrever_processo_operacao(organizacao_id, processo_id)","papeis":["authenticated"],"tabela":"operacao_contratos","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_documentos_da_empresa","check":null,"using":"pode_acessar_empresa_operacao(organizacao_id, empresa_id)","papeis":["authenticated"],"tabela":"operacao_documentos","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_documentos_da_empresa_escrita","check":"(pode_escrever_empresa_operacao(organizacao_id, empresa_id) AND arquivo_no_escopo_operacao(arquivo_caminho, organizacao_id, empresa_id))","using":"pode_escrever_empresa_operacao(organizacao_id, empresa_id)","papeis":["authenticated"],"tabela":"operacao_documentos","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_empenhos_da_empresa","check":null,"using":"pode_acessar_processo_operacao(organizacao_id, processo_id)","papeis":["authenticated"],"tabela":"operacao_empenhos","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_empenhos_da_empresa_escrita","check":"pode_escrever_processo_operacao(organizacao_id, processo_id)","using":"pode_escrever_processo_operacao(organizacao_id, processo_id)","papeis":["authenticated"],"tabela":"operacao_empenhos","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_empresas_escrita","check":"pode_escrever_org_operacao(organizacao_id)","using":"pode_escrever_org_operacao(organizacao_id)","papeis":["authenticated"],"tabela":"operacao_empresas","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_empresas_leitura","check":null,"using":"pode_acessar_empresa_operacao(organizacao_id, id)","papeis":["public"],"tabela":"operacao_empresas","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_itens_da_empresa","check":null,"using":"pode_acessar_processo_operacao(organizacao_id, processo_id)","papeis":["authenticated"],"tabela":"operacao_itens_resultado","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_itens_da_empresa_escrita","check":"pode_escrever_processo_operacao(organizacao_id, processo_id)","using":"pode_escrever_processo_operacao(organizacao_id, processo_id)","papeis":["authenticated"],"tabela":"operacao_itens_resultado","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_membros_da_org","check":null,"using":"((usuario_id = auth.uid()) OR eh_membro_operacao(organizacao_id))","papeis":["public"],"tabela":"operacao_membros","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_ocorrencias_da_empresa","check":null,"using":"pode_acessar_processo_operacao(organizacao_id, processo_id)","papeis":["authenticated"],"tabela":"operacao_ocorrencias","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_ocorrencias_da_empresa_escrita","check":"pode_escrever_processo_operacao(organizacao_id, processo_id)","using":"pode_escrever_processo_operacao(organizacao_id, processo_id)","papeis":["authenticated"],"tabela":"operacao_ocorrencias","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_organizacoes_proprias","check":null,"using":"tem_vinculo_operacao(id)","papeis":["public"],"tabela":"operacao_organizacoes","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_prazos_da_empresa","check":null,"using":"pode_acessar_processo_operacao(organizacao_id, processo_id)","papeis":["authenticated"],"tabela":"operacao_prazos_processo","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_prazos_da_empresa_escrita","check":"pode_escrever_processo_operacao(organizacao_id, processo_id)","using":"pode_escrever_processo_operacao(organizacao_id, processo_id)","papeis":["authenticated"],"tabela":"operacao_prazos_processo","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_processos_da_empresa","check":null,"using":"pode_acessar_empresa_operacao(organizacao_id, empresa_id)","papeis":["authenticated"],"tabela":"operacao_processos","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_processos_da_empresa_escrita","check":"pode_escrever_empresa_operacao(organizacao_id, empresa_id)","using":"pode_escrever_empresa_operacao(organizacao_id, empresa_id)","papeis":["authenticated"],"tabela":"operacao_processos","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_renovacoes_da_empresa","check":null,"using":"(EXISTS ( SELECT 1\n   FROM operacao_documentos d\n  WHERE ((d.id = operacao_renovacoes_documento.documento_id) AND pode_acessar_empresa_operacao(d.organizacao_id, d.empresa_id))))","papeis":["authenticated"],"tabela":"operacao_renovacoes_documento","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_renovacoes_da_empresa_escrita","check":"(EXISTS ( SELECT 1\n   FROM operacao_documentos d\n  WHERE ((d.id = operacao_renovacoes_documento.documento_id) AND pode_escrever_empresa_operacao(d.organizacao_id, d.empresa_id))))","using":"(EXISTS ( SELECT 1\n   FROM operacao_documentos d\n  WHERE ((d.id = operacao_renovacoes_documento.documento_id) AND pode_escrever_empresa_operacao(d.organizacao_id, d.empresa_id))))","papeis":["authenticated"],"tabela":"operacao_renovacoes_documento","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_tipos_escrita","check":"((organizacao_id IS NOT NULL) AND pode_escrever_org_operacao(organizacao_id))","using":"((organizacao_id IS NOT NULL) AND pode_escrever_org_operacao(organizacao_id))","papeis":["authenticated"],"tabela":"operacao_tipos_documento","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_tipos_leitura","check":null,"using":"((organizacao_id IS NULL) OR eh_membro_operacao(organizacao_id))","papeis":["public"],"tabela":"operacao_tipos_documento","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_arquivos_atualizacao","check":"((bucket_id = ''operacao-documentos''::text) AND escrita_arquivo_operacao(name))","using":"((bucket_id = ''operacao-documentos''::text) AND escrita_arquivo_operacao(name))","papeis":["authenticated"],"tabela":"objects","comando":"UPDATE","esquema":"storage","permissiva":"PERMISSIVE"},{"nome":"operacao_arquivos_envio","check":"((bucket_id = ''operacao-documentos''::text) AND escrita_arquivo_operacao(name))","using":null,"papeis":["authenticated"],"tabela":"objects","comando":"INSERT","esquema":"storage","permissiva":"PERMISSIVE"},{"nome":"operacao_arquivos_exclusao","check":null,"using":"((bucket_id = ''operacao-documentos''::text) AND escrita_arquivo_operacao(name))","papeis":["authenticated"],"tabela":"objects","comando":"DELETE","esquema":"storage","permissiva":"PERMISSIVE"},{"nome":"operacao_arquivos_leitura","check":null,"using":"((bucket_id = ''operacao-documentos''::text) AND acesso_arquivo_operacao(name))","papeis":["public"],"tabela":"objects","comando":"SELECT","esquema":"storage","permissiva":"PERMISSIVE"}]'::jsonb then
  raise exception 'Policies finais divergentes: abortado';
 end if;
 if exists(select 1 from (values
  ('public.arquivo_no_escopo_operacao(text,uuid,uuid)','c727f040598b92b257a5322118447d6f'),
  ('public.confirmar_identificacao_empresa(uuid,uuid,text,text,jsonb,jsonb)','4c6c9e37d1992153b013c9cee0ae23d4'),
  ('public.escrita_arquivo_operacao(text)','d95ab917f9d1faf6270e16d85dda42fd'),
  ('public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb)','0cc051bf73f24861468d39efe832a727'),
  ('public.identificacao_empresa_habilitada()','880430792a38242de6aee692c85b40a8'),
  ('public.invalidar_identificacao_empresa()','9d267cd8c8f193abb24ac9485d91d400'),
  ('public.kit_documento_escopo_imutavel()','1cc81ddba3b38f7ea12325bf33975081'),
  ('public.pode_escrever_empresa_operacao(uuid,uuid)','c5e91057ee05d745a22bd2fc89c80322'),
  ('public.pode_escrever_org_operacao(uuid)','c5fa4a20c0df119753f8f2efd99b4264'),
  ('public.pode_escrever_processo_operacao(uuid,uuid)','7de47c8d343558a2dc2180ad2a4daffc'),
  ('public.preservar_escopo_operacao()','0b08ce4d1e636bcc2df13b15f55f9281'),
  ('public.validar_arquivo_processo_operacao()','adb6e775c624ab8187028faef6f31d91')
 ) as esperado(assinatura,hash) left join pg_proc p on p.oid=to_regprocedure(esperado.assinatura)
 where p.oid is null or md5(replace(p.prosrc,chr(13),''))<>esperado.hash) then
  raise exception 'Corpos finais divergentes: abortado';
 end if;
 -- Funções internas de trigger não são RPCs; defaults e herança também devem falhar fechados.
 if exists(select 1 from unnest(array['public.invalidar_identificacao_empresa()','public.kit_documento_escopo_imutavel()','public.preservar_escopo_operacao()','public.validar_arquivo_processo_operacao()']::text[]) esperado(assinatura)
  left join pg_proc p on p.oid=to_regprocedure(esperado.assinatura)
  where p.oid is null or p.prorettype<>'pg_catalog.trigger'::regtype
   or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee<>p.proowner)
   or exists(select 1 from pg_roles r where r.rolname in ('anon','authenticated','service_role')
    and has_function_privilege(r.oid,p.oid,'EXECUTE'))) then
  raise exception 'ACL de função interna de trigger divergente: abortado';
 end if;
 if not exists(select 1 from pg_class c where c.oid='public.operacao_identificacao_empresa'::regclass and c.relrowsecurity)
 or (select count(*) from pg_trigger where tgname in ('identificacao_documento_alterado','identificacao_arquivo_alterado','identificacao_cadastro_alterado') and not tgisinternal and tgenabled='O')<>3 then
  raise exception 'RLS ou invalidação da identificação ausente';
 end if;
end
$posestado$;
notify pgrst,'reload schema';
rollback;

-- Pré-kit staging; executar também após a rejeição do original ou um ROLLBACK.
-- Não reaplica o gate bootstrap vazio: o bucket privado foi criado depois daquela prova.
begin read only;
set local lock_timeout='2s';
set local statement_timeout='30s';
set local search_path=pg_catalog,public;
do $preestado$
declare observado jsonb;
begin
 if current_user<>'postgres' then raise exception 'Executor diferente do proprietário esperado; não trocar papel automaticamente'; end if;
 with
relacoes as (
 select c.*,n.nspname as esquema from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('r','p','v','m','f','S') and ((n.nspname='public' and (c.relname like 'operacao\_%' escape '\' or c.relname in ('clientes','admins')))
    or (n.nspname='auth' and c.relname='users')
    or (n.nspname='storage' and c.relname in ('objects','buckets')))
), funcoes as (
 select p.*,n.nspname as esquema from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where p.prokind in ('f','p') and (
  (n.nspname='public' and (p.proname like '%operacao%' or p.proname like '%identificacao_empresa%' or p.proname in ('gravar_kit_documento','kit_documento_escopo_imutavel','configurar_limite_cnpjs_cliente','consultar_limite_cnpjs_cliente')))
  or (n.nspname='auth' and p.proname='uid')
  or p.oid in (select t.tgfoid from pg_trigger t join relacoes r on r.oid=t.tgrelid where not t.tgisinternal)
 )
), secoes as (
 select 'relacoes' as secao,coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'nome',r.relname,'tipo',r.relkind,'dono',pg_get_userbyid(r.relowner),
  'rls',r.relrowsecurity,'force_rls',r.relforcerowsecurity,'opcoes',r.reloptions,
  'acl',r.relacl::text) order by r.esquema,r.relname),'[]'::jsonb) as itens from relacoes r
 union all
 select 'colunas',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'tabela',r.relname,'ordem',a.attnum,'nome',a.attname,
  'tipo',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
  'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid),
  'acl',a.attacl::text) order by r.esquema,r.relname,a.attnum),'[]'::jsonb)
 from relacoes r join pg_attribute a on a.attrelid=r.oid and a.attnum>0 and not a.attisdropped
 left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
 where r.relkind in ('r','p','v','m','f')
 union all
 select 'constraints',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'tabela',r.relname,'nome',c.conname,'tipo',c.contype,
  'validada',c.convalidated,'deferivel',c.condeferrable,'adiada',c.condeferred,
  'definicao',pg_get_constraintdef(c.oid,true)) order by r.esquema,r.relname,c.conname),'[]'::jsonb)
 from relacoes r join pg_constraint c on c.conrelid=r.oid
 union all
 select 'indices',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'tabela',r.relname,'nome',ci.relname,'unico',i.indisunique,
  'valido',i.indisvalid,'pronto',i.indisready,'primario',i.indisprimary,
  'definicao',pg_get_indexdef(i.indexrelid)) order by r.esquema,r.relname,ci.relname),'[]'::jsonb)
 from relacoes r join pg_index i on i.indrelid=r.oid join pg_class ci on ci.oid=i.indexrelid
 union all
 select 'policies',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',schemaname,'tabela',tablename,'nome',policyname,'permissiva',permissive,
  'papeis',roles,'comando',cmd,'using',qual,'check',with_check)
  order by schemaname,tablename,policyname),'[]'::jsonb)
 from pg_policies where (schemaname='public' and (tablename like 'operacao\_%' escape '\' or tablename in ('clientes','admins')))
  or (schemaname='storage' and tablename in ('objects','buckets')) or (schemaname='auth' and tablename='users')
 union all
 select 'triggers',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'tabela',r.relname,'nome',t.tgname,'habilitado',t.tgenabled,
  'funcao',t.tgfoid::regprocedure::text,'definicao',pg_get_triggerdef(t.oid,true))
  order by r.esquema,r.relname,t.tgname),'[]'::jsonb)
 from relacoes r join pg_trigger t on t.tgrelid=r.oid where not t.tgisinternal
 union all
 select 'funcoes',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',f.esquema,'nome',f.proname,'assinatura',f.oid::regprocedure::text,
  'argumentos',pg_get_function_identity_arguments(f.oid),'retorno',pg_get_function_result(f.oid),
  'dono',pg_get_userbyid(f.proowner),'security_definer',f.prosecdef,'volatilidade',f.provolatile,
  'strict',f.proisstrict,'configuracao',f.proconfig,'acl',f.proacl::text,
  'hash_corpo_md5',md5(replace(f.prosrc,chr(13),'')),
  'definicao',case when f.esquema='public' and (f.proname like '%operacao%' or f.proname like '%identificacao_empresa%' or f.proname in ('gravar_kit_documento','kit_documento_escopo_imutavel','configurar_limite_cnpjs_cliente','consultar_limite_cnpjs_cliente')) then pg_get_functiondef(f.oid) else null end)
  order by f.esquema,f.oid::regprocedure::text),'[]'::jsonb) from funcoes f
 union all
 select 'acl_relacoes',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'objeto',r.relname,'concedente',pg_get_userbyid(a.grantor),
  'papel',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
  'privilegio',a.privilege_type,'grant_option',a.is_grantable)
  order by r.esquema,r.relname,a.grantee,a.privilege_type),'[]'::jsonb)
 from relacoes r cross join lateral aclexplode(coalesce(r.relacl,acldefault(case when r.relkind='S' then 's'::"char" else 'r'::"char" end,r.relowner))) a
 union all
 select 'acl_funcoes',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',f.esquema,'objeto',f.oid::regprocedure::text,'concedente',pg_get_userbyid(a.grantor),
  'papel',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
  'privilegio',a.privilege_type,'grant_option',a.is_grantable)
  order by f.esquema,f.oid::regprocedure::text,a.grantee,a.privilege_type),'[]'::jsonb)
 from funcoes f cross join lateral aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
 union all
 select 'schemas',coalesce(jsonb_agg(jsonb_build_object('nome',nspname,'dono',pg_get_userbyid(nspowner),'acl',nspacl::text) order by nspname),'[]'::jsonb)
 from pg_namespace where nspname in ('public','auth','storage')
 union all
 select 'defaults_acl',coalesce(jsonb_agg(jsonb_build_object('dono',pg_get_userbyid(d.defaclrole),
  'esquema',coalesce(n.nspname,'*'),'tipo',d.defaclobjtype,'acl',d.defaclacl::text)
  order by d.defaclrole,d.defaclnamespace,d.defaclobjtype),'[]'::jsonb)
 from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
 where d.defaclnamespace=0 or n.nspname in ('public','auth','storage')
 union all
 select 'papeis',coalesce(jsonb_agg(jsonb_build_object('nome',rolname,'superuser',rolsuper,
  'inherit',rolinherit,'login',rolcanlogin,'create_role',rolcreaterole,'bypass_rls',rolbypassrls) order by rolname),'[]'::jsonb) from pg_roles
 union all
 select 'membros_papeis',coalesce(jsonb_agg(jsonb_build_object('papel',pg_get_userbyid(m.roleid),
  'membro',pg_get_userbyid(m.member),'concedente',pg_get_userbyid(m.grantor),'admin_option',m.admin_option,
  'inherit_option',to_jsonb(m)->'inherit_option','set_option',to_jsonb(m)->'set_option')
  order by m.roleid,m.member),'[]'::jsonb) from pg_auth_members m
 union all
 select 'dependencias_entrada',coalesce(jsonb_agg(jsonb_build_object(
  'objeto',pg_describe_object(d.classid,d.objid,d.objsubid),
  'referencia',pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid),'tipo',d.deptype)
  order by d.classid,d.objid,d.objsubid,d.refobjid,d.refobjsubid),'[]'::jsonb)
 from pg_depend d where (d.refclassid='pg_class'::regclass and d.refobjid in (select oid from relacoes))
  or (d.refclassid='pg_proc'::regclass and d.refobjid in (select oid from funcoes))
), catalogo as (select jsonb_object_agg(secao,itens order by secao) as corpo from secoes)

 select corpo into observado from catalogo;
 if md5(observado::text)<>'8abc338413ff0c60770d3aea1c3413d1' then
  raise exception 'Catálogo divergente: abortado sem alteração. Capture novo inventário e revise o delta';
 end if;
end
$preestado$;
do $fixture_vazia$
declare tabela text; possui_linhas boolean;
begin
 if current_user<>'postgres' or current_database()<>'postgres' or current_setting('server_version_num')<>'170011' then raise exception 'Executor/banco/versão incompatível com staging';end if;
 if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p'))<>19 then raise exception 'Quantidade de tabelas públicas divergente da fixture';end if;
 for tabela in select unnest(array['admins','clientes','operacao_agenda','operacao_anexos_processo','operacao_contratos','operacao_convites_empresa','operacao_documentos','operacao_empenhos','operacao_empresas','operacao_itens_resultado','operacao_limites_cnpj','operacao_membros','operacao_ocorrencias','operacao_organizacoes','operacao_prazos_processo','operacao_processos','operacao_renovacoes_documento','operacao_tipos_documento','dados_robo']::text[]) loop
  execute format('select exists(select 1 from public.%I)',tabela) into possui_linhas;
  if possui_linhas then raise exception 'Fixture deve estar vazia antes da homologação de dados';end if;
 end loop;
 if exists(select 1 from auth.users) or exists(select 1 from storage.objects) then raise exception 'Auth/Storage devem permanecer sem usuários/arquivos nesta etapa';end if;
 if (select count(*) from storage.buckets)<>1 or not exists(select 1 from storage.buckets where id='operacao-documentos' and public=false) then raise exception 'Único bucket privado operacao-documentos obrigatório';end if;
end
$fixture_vazia$;

select jsonb_build_object('resultado','PREKIT_STAGING_CONFIRMADO','catalogo_md5','8abc338413ff0c60770d3aea1c3413d1',
 'read_only',current_setting('transaction_read_only'),'server_version',version(),'observado_em',now(),
 'tabelas_publicas_vazias',19,'usuarios_auth',0,'objetos_storage',0,'bucket',jsonb_build_object('id',b.id,'name',b.name,'public',b.public,'file_size_limit',b.file_size_limit,'allowed_mime_types',b.allowed_mime_types,'objects',(select count(*) from storage.objects o where o.bucket_id=b.id))) as evidencia_prekit
from storage.buckets b where b.id='operacao-documentos';
commit;
