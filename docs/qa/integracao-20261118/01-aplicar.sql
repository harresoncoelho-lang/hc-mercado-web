-- 01-aplicar.sql — gerado por testar-aplicar.cjs --gerar em 2026-11-18. NÃO editar à mão.
-- Projeto Supabase lsqjamqvmrcyrvowndiu. Rodar inteiro no SQL Editor, uma vez, na janela combinada.
-- Junta, nesta ordem, os arquivos de supabase/ abaixo (SHA-256 do arquivo original, bytes brutos):
--   832158202ec9e57baf38d49a9a6761bbccd10fcce3fc77d85f83b0a3defead9e  identificacao_empresa.sql
--   49ccfae6c012a9826872806f5cb5d2e4cd75d29f23abb284fc79ca2ea30abb17  seguranca_operacao.sql
--   7b2ef8ed7676e45acd9708b56d95bb5b6d39ec44ecc54455d796daa2e148131f  kit_documentos.sql
--   f5a8da7bcfaca55e9a331b7c6b051ae778394467e12aa049af899399bba43d0a  kit_documentos_escala_proposta.sql
--   e0b1b44e0c3fd293bed63a3a85cc629007908044006b817d875b5f4199e672b9  importacao_item_pncp.sql
--   7b90ba129c59b38d46d46a881e6053ade549327a593a6da25555b74073b5e270  endurecer_rpc_servidor.sql
--   c309aec4e6d5ceb15a8055b7141cfa7f4b9bd4e902821091da9dd5193c9ef5fd  rls_e_limite_de_uso.sql
-- Ajustes feitos só aqui (os originais não mudam):
--   * begin;/commit; de cada arquivo removidos: tudo roda numa transação só (abaixo).
--   * importacao_item_pncp.sql: "drop policy if exists origem_pncp_leitura" antes do create policy.
--   * rls_e_limite_de_uso.sql: só o revoke de incrementar_uso e o grant da linha seguinte (service_role).
--   * lock_timeout/statement_timeout locais para não travar produção esperando lock.
-- Nenhum arquivo usa CREATE INDEX CONCURRENTLY, VACUUM ou outro comando proibido em transação.
-- Qualquer erro: nada fica gravado. Rode "rollback;" e pare (ver ROTEIRO-BANCO.md).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ===================== identificacao_empresa.sql =====================
-- Identificação conferida por empresa. Aplicação LOCAL; pode ser reaplicada.
-- Requer acesso_empresa_convites.sql. Não cria bucket; restringe a ACL da função interna de trigger.
-- (begin do arquivo original removido)
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
-- (commit do arquivo original removido)

-- Atualiza o cache local do PostgREST após criação da tabela/RPC.
notify pgrst, 'reload schema';

-- ===================== seguranca_operacao.sql =====================
-- Segurança operacional incremental e idempotente. Execute no SQL Editor após
-- acesso_empresa_convites.sql e identificacao_empresa.sql. Não apaga dados.
-- (begin do arquivo original removido)

create or replace function public.pode_escrever_org_operacao(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.operacao_membros m where m.organizacao_id=p_org
  and m.usuario_id=auth.uid() and m.empresa_id is null and m.papel in ('gestor','operador'));
$$;
create or replace function public.pode_escrever_empresa_operacao(p_org uuid,p_empresa uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.operacao_empresas e join public.operacao_membros m on m.organizacao_id=e.organizacao_id
  where e.id=p_empresa and e.organizacao_id=p_org and m.usuario_id=auth.uid()
  and m.papel in ('gestor','operador') and (m.empresa_id is null or m.empresa_id=e.id));
$$;
create or replace function public.pode_escrever_processo_operacao(p_org uuid,p_processo uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.operacao_processos p where p.id=p_processo and p.organizacao_id=p_org
  and public.pode_escrever_empresa_operacao(p.organizacao_id,p.empresa_id));
$$;
create or replace function public.arquivo_no_escopo_operacao(p_caminho text,p_org uuid,p_empresa uuid)
returns boolean language sql immutable set search_path = '' as $$
 select p_caminho is null or (p_caminho like p_org::text||'/'||p_empresa::text||'/%'
  and length(split_part(p_caminho,'/',3))>0);
$$;
create or replace function public.escrita_arquivo_operacao(p_caminho text)
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
create or replace function public.preservar_escopo_operacao()
returns trigger language plpgsql set search_path = '' as $$
begin
 if old.organizacao_id is distinct from new.organizacao_id or old.empresa_id is distinct from new.empresa_id then
 raise exception 'Escopo não pode ser transferido; crie um novo documento ou processo no CNPJ correto';
 end if;
 return new;
end $$;
drop trigger if exists preservar_escopo_operacao on public.operacao_documentos;
create trigger preservar_escopo_operacao before update on public.operacao_documentos for each row execute function public.preservar_escopo_operacao();
drop trigger if exists preservar_escopo_operacao on public.operacao_processos;
create trigger preservar_escopo_operacao before update on public.operacao_processos for each row execute function public.preservar_escopo_operacao();

create or replace function public.validar_arquivo_processo_operacao()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if not exists(select 1 from public.operacao_processos p where p.id=new.processo_id and p.organizacao_id=new.organizacao_id and public.arquivo_no_escopo_operacao(new.arquivo_caminho,p.organizacao_id,p.empresa_id)) then
 raise exception 'Arquivo fora do escopo do processo';
 end if;
 return new;
end $$;
revoke all on function public.preservar_escopo_operacao(),public.validar_arquivo_processo_operacao() from public,anon,authenticated,service_role;
drop trigger if exists validar_arquivo_processo_operacao on public.operacao_anexos_processo;
create trigger validar_arquivo_processo_operacao before insert or update on public.operacao_anexos_processo for each row execute function public.validar_arquivo_processo_operacao();

-- SELECT conserva o acesso existente. Escrita exige papel e o mesmo escopo.
drop policy if exists operacao_empresas_escrita on public.operacao_empresas;
create policy operacao_empresas_escrita on public.operacao_empresas for all to authenticated
 using(public.pode_escrever_org_operacao(organizacao_id)) with check(public.pode_escrever_org_operacao(organizacao_id));
drop policy if exists operacao_tipos_escrita on public.operacao_tipos_documento;
create policy operacao_tipos_escrita on public.operacao_tipos_documento for all to authenticated
 using(organizacao_id is not null and public.pode_escrever_org_operacao(organizacao_id))
 with check(organizacao_id is not null and public.pode_escrever_org_operacao(organizacao_id));

-- Substitui todas as policies amplas conhecidas; não afeta tabelas públicas/robô.
do $$
declare r record; leitura text; escrita text; checagem text;
begin
 for r in select * from (values
  ('operacao_documentos','operacao_documentos_da_empresa','empresa'),
  ('operacao_agenda','operacao_agenda_da_empresa','empresa'),
  ('operacao_processos','operacao_processos_da_empresa','empresa'),
  ('operacao_prazos_processo','operacao_prazos_da_empresa','processo'),
  ('operacao_empenhos','operacao_empenhos_da_empresa','processo'),
  ('operacao_itens_resultado','operacao_itens_da_empresa','processo'),
  ('operacao_ocorrencias','operacao_ocorrencias_da_empresa','processo'),
  ('operacao_contratos','operacao_contratos_da_empresa','processo'),
  ('operacao_anexos_processo','operacao_anexos_da_empresa','processo'),
  ('operacao_renovacoes_documento','operacao_renovacoes_da_empresa','documento')
 ) as t(tabela,politica,escopo) loop
  if r.escopo='documento' then
   leitura='exists(select 1 from public.operacao_documentos d where d.id=documento_id and public.pode_acessar_empresa_operacao(d.organizacao_id,d.empresa_id))';
   escrita=replace(leitura,'pode_acessar_empresa_operacao','pode_escrever_empresa_operacao');
  else
   leitura=format('public.pode_acessar_%s_operacao(organizacao_id,%I)',r.escopo,r.escopo||'_id');
   escrita=replace(leitura,'pode_acessar_','pode_escrever_');
  end if;
  checagem=escrita;
  if r.tabela='operacao_documentos' then
   checagem=checagem||' and public.arquivo_no_escopo_operacao(arquivo_caminho,organizacao_id,empresa_id)';
  elsif r.tabela='operacao_anexos_processo' then
   checagem=checagem||' and exists(select 1 from public.operacao_processos p where p.id=processo_id and p.organizacao_id=operacao_anexos_processo.organizacao_id and public.arquivo_no_escopo_operacao(arquivo_caminho,p.organizacao_id,p.empresa_id))';
  end if;
  execute format('drop policy if exists %I on public.%I',r.politica,r.tabela);
  execute format('drop policy if exists %I on public.%I',r.politica||'_escrita',r.tabela);
  execute format('create policy %I on public.%I for select to authenticated using (%s)',r.politica,r.tabela,leitura);
  execute format('create policy %I on public.%I for all to authenticated using (%s) with check (%s)',r.politica||'_escrita',r.tabela,escrita,checagem);
 end loop;
end $$;
drop policy if exists operacao_arquivos_envio on storage.objects;
drop policy if exists operacao_arquivos_atualizacao on storage.objects;
drop policy if exists operacao_arquivos_exclusao on storage.objects;
create policy operacao_arquivos_envio on storage.objects for insert to authenticated
 with check(bucket_id='operacao-documentos' and public.escrita_arquivo_operacao(name));
create policy operacao_arquivos_atualizacao on storage.objects for update to authenticated
 using(bucket_id='operacao-documentos' and public.escrita_arquivo_operacao(name))
 with check(bucket_id='operacao-documentos' and public.escrita_arquivo_operacao(name));
create policy operacao_arquivos_exclusao on storage.objects for delete to authenticated
 using(bucket_id='operacao-documentos' and public.escrita_arquivo_operacao(name));

-- O backend informa o usuário: validar seu papel também ao ignorar RLS.
create or replace function public.confirmar_identificacao_empresa(p_empresa uuid,p_usuario uuid,p_razao text,p_cnpj text,p_dados jsonb,p_proveniencia jsonb) returns public.operacao_identificacao_empresa language plpgsql security definer set search_path=public as $$
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
create or replace function public.identificacao_empresa_habilitada()
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
notify pgrst, 'reload schema';
-- (commit do arquivo original removido)

-- ===================== kit_documentos.sql =====================
-- Peças de declaração/proposta por empresa. Idempotente; aplicar no SQL Editor
-- somente após identificacao_empresa.sql e seguranca_operacao.sql. Sem dados reais.
-- (begin do arquivo original removido)
create unique index if not exists operacao_processos_id_empresa_org_idx
 on public.operacao_processos(id,empresa_id,organizacao_id);
create table if not exists public.operacao_kit_documentos(
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
create index if not exists operacao_kit_documentos_escopo_idx on public.operacao_kit_documentos(organizacao_id,empresa_id,processo_id,atualizado_em desc);
drop policy if exists operacao_kit_documentos_select_empresa on public.operacao_kit_documentos;
create policy operacao_kit_documentos_select_empresa on public.operacao_kit_documentos for select to authenticated
 using(public.pode_acessar_empresa_operacao(organizacao_id,empresa_id)
  and exists(select 1 from public.clientes c where c.id=auth.uid() and c.status='aprovado')
  and exists(select 1 from public.operacao_empresas e where e.id=operacao_kit_documentos.empresa_id and e.organizacao_id=operacao_kit_documentos.organizacao_id and e.ativo));

create or replace function public.kit_documento_escopo_imutavel() returns trigger
 language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
 if row(new.id,new.organizacao_id,new.empresa_id,new.processo_id,new.tipo,new.criado_por,new.criado_em)
  is distinct from row(old.id,old.organizacao_id,old.empresa_id,old.processo_id,old.tipo,old.criado_por,old.criado_em)
 then raise sqlstate 'PT409' using message='Escopo e autoria da peça são imutáveis';end if;
 return new;
end $$;
drop trigger if exists kit_documento_escopo_imutavel on public.operacao_kit_documentos;
create trigger kit_documento_escopo_imutavel before update on public.operacao_kit_documentos
 for each row execute function public.kit_documento_escopo_imutavel();

create or replace function public.gravar_kit_documento(
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
-- (commit do arquivo original removido)
notify pgrst,'reload schema';

-- ===================== kit_documentos_escala_proposta.sql =====================
-- PREPARADO LOCALMENTE. NÃO APLICADO. Requer kit_documentos.sql existente.
-- Substitui apenas RPC, mantém grants existentes e todo isolamento/CAS.
-- Candidato técnico de 1000 itens: não certificação comercial.
-- (begin do arquivo original removido)
create or replace function public.gravar_kit_documento(
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

 if p_dados is null or jsonb_typeof(p_dados)<>'object' or p_dados-array[p_tipo]<>'{}'::jsonb or jsonb_typeof(p_dados->p_tipo) is distinct from 'object' or (p_tipo='declaracao' and length(p_dados::text)>50000)
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
  if jsonb_array_length(coalesce(v->'itemIds','[]'))>1000
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

 -- Mesmo orçamento semântico de _kit_proposta_limites.js, valores UTF-8.
 if p_tipo='proposta' and (
  128 + jsonb_array_length(coalesce(v->'itemIds','[]')) * 128
  + octet_length(convert_to(coalesce(v->>'validade',''),'UTF8'))
  + octet_length(convert_to(coalesce(v->>'prazoEntrega',''),'UTF8'))
  + octet_length(convert_to(coalesce(v->>'pagamento',''),'UTF8'))
  + coalesce((select sum(octet_length(convert_to(i,'UTF8')) + octet_length(convert_to(coalesce(v->'unidades'->>i,''),'UTF8'))) from jsonb_array_elements_text(coalesce(v->'itemIds','[]')) as selecionado(i)),0)
 ) > 524288 then raise sqlstate 'PT400' using message='Rascunho excede o tamanho suportado'; end if;
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
  if p_tipo='proposta' and octet_length(convert_to(p_previa->>'texto','UTF8'))>2000000 then raise sqlstate 'PT400' using message='Prévia excede o tamanho suportado'; end if;
  if jsonb_array_length(p_previa->'fontes')>10 or exists(select 1 from jsonb_array_elements(p_previa->'fontes') f where jsonb_typeof(f)<>'string' or length(f#>>'{}')>2000)
  then raise sqlstate 'PT400' using message='Fontes da revisão inválidas';end if;
  update public.operacao_kit_documentos set revisao_hash=p_hash,revisao_previa=p_previa,revisao_versao=versao,revisado_por=p_usuario,revisado_em=clock_timestamp()
   where id=p_documento and versao=p_versao returning * into d;
 end if;
 if d.id is null then raise sqlstate 'PT409' using message='Versão alterada';end if;
 return d;
end $$;
-- (commit do arquivo original removido)
notify pgrst,'reload schema';

-- ===================== importacao_item_pncp.sql =====================
-- PREPARADO LOCALMENTE / NÃO APLICADO. Após schema operação e kit.
-- (begin do arquivo original removido)
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
-- (ajuste: idempotência)
drop policy if exists origem_pncp_leitura on public.operacao_origens_pncp;
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
-- (commit do arquivo original removido)
notify pgrst,'reload schema';

-- ===================== endurecer_rpc_servidor.sql =====================
-- ============================================================================
-- Endurecimento de RPC usada só pelos robôs SICAF — 17/11/2026
-- Idempotente: seguro rodar mais de uma vez. Rodar no SQL Editor do Supabase.
--
-- Por quê: o Security Advisor do Supabase (projeto LICITAPLENA) mostrou que
-- `anon` e `authenticated` executam selecionar_sicaf_para_enriquecimento
-- (SECURITY DEFINER) via /rest/v1/rpc. Sem login, qualquer pessoa listava até
-- 200 CNPJs por chamada da base de prospecção. A função não tem outro .sql no
-- repositório (veio do projeto Radar SICAF); quem chama é robô com service_role.
-- A correção equivalente de incrementar_uso está em rls_e_limite_de_uso.sql.
-- ============================================================================

revoke execute on function public.selecionar_sicaf_para_enriquecimento(integer, text) from public, anon, authenticated;
grant execute on function public.selecionar_sicaf_para_enriquecimento(integer, text) to service_role;

-- Conferência: as duas linhas devem mostrar anon=false e authenticated=false.
select p.proname,
       has_function_privilege('anon', p.oid, 'execute')          as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       has_function_privilege('service_role', p.oid, 'execute')  as service_role
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('incrementar_uso', 'selecionar_sicaf_para_enriquecimento');

-- ===================== rls_e_limite_de_uso.sql (só incrementar_uso) =====================
-- Front não chama esta RPC; só netlify/functions/_auth.js, com SUPABASE_SERVICE_ROLE_KEY.
revoke all on function public.incrementar_uso(uuid, text) from public, anon, authenticated;
grant execute on function public.incrementar_uso(uuid, text) to service_role;

commit;
