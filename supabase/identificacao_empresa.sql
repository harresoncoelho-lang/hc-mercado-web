-- Identificação conferida por empresa. Aplicação LOCAL; pode ser reaplicada.
-- Requer acesso_empresa_convites.sql. Não cria bucket; restringe a ACL da função interna de trigger.
begin;
do $$ begin
 if to_regprocedure('public.pode_acessar_empresa_operacao(uuid,uuid)') is null or to_regprocedure('public.acesso_arquivo_operacao(text)') is null then raise exception 'Instale primeiro o isolamento por empresa'; end if;
 if not exists(select 1 from storage.buckets where id='operacao-documentos' and public=false) then raise exception 'Bucket privado obrigatório'; end if;
end $$;
create table if not exists public.operacao_identificacao_empresa(
 empresa_id uuid primary key, organizacao_id uuid not null,
 dados_confirmados jsonb not null, proveniencia jsonb not null default '[]',
 confirmado_por uuid not null references auth.users(id), confirmado_em timestamptz not null default now(),
 versao bigint not null default 1, invalidado_em timestamptz,
 foreign key(empresa_id,organizacao_id) references public.operacao_empresas(id,organizacao_id) on delete cascade,
 check(jsonb_typeof(dados_confirmados)='object'),check(jsonb_typeof(proveniencia)='array')
);
alter table public.operacao_identificacao_empresa enable row level security;
drop policy if exists identificacao_empresa_leitura on public.operacao_identificacao_empresa;
create policy identificacao_empresa_leitura on public.operacao_identificacao_empresa for select to authenticated using(public.pode_acessar_empresa_operacao(organizacao_id,empresa_id));
revoke all on public.operacao_identificacao_empresa from anon,authenticated;
grant select on public.operacao_identificacao_empresa to authenticated;
grant all on public.operacao_identificacao_empresa to service_role;
create or replace function public.invalidar_identificacao_empresa() returns trigger language plpgsql security definer set search_path=public as $$
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
drop trigger if exists identificacao_documento_alterado on public.operacao_documentos;
create trigger identificacao_documento_alterado after update or delete on public.operacao_documentos for each row execute function public.invalidar_identificacao_empresa();
drop trigger if exists identificacao_arquivo_alterado on storage.objects;
create trigger identificacao_arquivo_alterado after update or delete on storage.objects for each row when(old.bucket_id='operacao-documentos') execute function public.invalidar_identificacao_empresa();
drop trigger if exists identificacao_cadastro_alterado on public.operacao_empresas;
create trigger identificacao_cadastro_alterado after update on public.operacao_empresas for each row execute function public.invalidar_identificacao_empresa();
create or replace function public.confirmar_identificacao_empresa(p_empresa uuid,p_usuario uuid,p_razao text,p_cnpj text,p_dados jsonb,p_proveniencia jsonb) returns public.operacao_identificacao_empresa language plpgsql security definer set search_path=public as $$
declare e public.operacao_empresas; r public.operacao_identificacao_empresa; x jsonb;
begin
 select * into e from public.operacao_empresas where id=p_empresa for update;
 if e.id is null or not exists(select 1 from public.operacao_membros m where m.organizacao_id=e.organizacao_id and m.usuario_id=p_usuario and (m.empresa_id is null or m.empresa_id=e.id)) then raise exception 'Empresa indisponível'; end if;
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
-- Gate de prontidão consultado com o JWT do usuário; ausência ou regressão fecha a rota.
create or replace function public.identificacao_empresa_habilitada() returns boolean language sql stable security definer set search_path=public as $$
 select auth.uid() is not null
 and exists(select 1 from storage.buckets where id='operacao-documentos' and public=false)
 and (select count(*)=3 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('operacao_empresas','operacao_documentos','operacao_identificacao_empresa') and c.relrowsecurity)
 and exists(select 1 from pg_policies where schemaname='public' and tablename='operacao_documentos' and policyname='operacao_documentos_da_empresa' and qual like '%pode_acessar_empresa_operacao%' and with_check like '%pode_acessar_empresa_operacao%')
 and not exists(select 1 from pg_policies where schemaname='public' and tablename='operacao_documentos' and policyname<>'operacao_documentos_da_empresa')
 and exists(select 1 from pg_policies where schemaname='public' and tablename='operacao_empresas' and policyname='operacao_empresas_leitura' and qual like '%pode_acessar_empresa_operacao%')
 and (select count(*)=4 from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'operacao_arquivos_%' and coalesce(qual,with_check) like '%acesso_arquivo_operacao%')
 and not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname not in ('operacao_arquivos_atualizacao','operacao_arquivos_envio','operacao_arquivos_exclusao','operacao_arquivos_leitura'));
$$;
revoke all on function public.identificacao_empresa_habilitada() from public,anon;
grant execute on function public.identificacao_empresa_habilitada() to authenticated;
commit;

-- Atualiza o cache local do PostgREST após criação da tabela/RPC.
notify pgrst, 'reload schema';
