-- Segurança operacional incremental e idempotente. Execute no SQL Editor após
-- acesso_empresa_convites.sql e identificacao_empresa.sql. Não apaga dados.
begin;

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
commit;
