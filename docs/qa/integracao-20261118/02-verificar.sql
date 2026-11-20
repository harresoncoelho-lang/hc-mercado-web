-- 02-verificar.sql — 18/11/2026. SÓ LEITURA: não grava nada (transação read only).
-- Rodar inteiro no SQL Editor depois do 01-aplicar.sql.
-- Resultado esperado: uma tabela com uma linha por item e a coluna "resultado" = ok em todas.
-- Se aparecer ERRO com o texto "Kit pré-publicação: ...", o gate do kit falhou: anote a mensagem e pare.
-- Parte 1 é verificar_kit_prepublicacao.sql intacto (sha256 2c4023cb0cac4e9b5fa29afee68398a0b4e402663dee9cd9fa580e7ea19178cf).
begin read only;
set local statement_timeout = '20s';
set local lock_timeout = '2s';
set local search_path = pg_catalog, public;

-- ===================== verificar_kit_prepublicacao.sql (intacto) =====================
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

-- ===================== conferência item a item =====================
-- Gate do servidor (identificacao_empresa_habilitada) com um usuário fictício só nesta transação.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000000', true),
       set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000000"}', true);
do $$ begin
 perform set_config('qa.habilitada', coalesce(public.identificacao_empresa_habilitada(), false)::text, true);
exception when undefined_function then perform set_config('qa.habilitada', 'false', true);
end $$;

with
fn(sig) as (values
 ('public.identificacao_empresa_habilitada()'),
 ('public.confirmar_identificacao_empresa(uuid,uuid,text,text,jsonb,jsonb)'),
 ('public.invalidar_identificacao_empresa()'),
 ('public.pode_escrever_org_operacao(uuid)'),
 ('public.pode_escrever_empresa_operacao(uuid,uuid)'),
 ('public.pode_escrever_processo_operacao(uuid,uuid)'),
 ('public.arquivo_no_escopo_operacao(text,uuid,uuid)'),
 ('public.escrita_arquivo_operacao(text)'),
 ('public.preservar_escopo_operacao()'),
 ('public.validar_arquivo_processo_operacao()'),
 ('public.kit_documento_escopo_imutavel()'),
 ('public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb)'),
 ('public.reservar_importacao_pncp(uuid,uuid,uuid,uuid)'),
 ('public.gravar_importacao_pncp(uuid,uuid,uuid,uuid,text,integer,text,text,jsonb,jsonb,jsonb)')),
tab(nome) as (values ('operacao_identificacao_empresa'),('operacao_kit_documentos'),('operacao_origens_pncp'),('operacao_observacoes_pncp'),('operacao_cadencia_pncp')),
pol(esquema,tabela,nome) as (values
 ('public','operacao_identificacao_empresa','identificacao_empresa_leitura'),
 ('public','operacao_kit_documentos','operacao_kit_documentos_select_empresa'),
 ('public','operacao_origens_pncp','origem_pncp_leitura'),
 ('public','operacao_empresas','operacao_empresas_leitura'),
 ('public','operacao_empresas','operacao_empresas_escrita'),
 ('public','operacao_tipos_documento','operacao_tipos_escrita'),
 ('public','operacao_documentos','operacao_documentos_da_empresa'),('public','operacao_documentos','operacao_documentos_da_empresa_escrita'),
 ('public','operacao_agenda','operacao_agenda_da_empresa'),('public','operacao_agenda','operacao_agenda_da_empresa_escrita'),
 ('public','operacao_processos','operacao_processos_da_empresa'),('public','operacao_processos','operacao_processos_da_empresa_escrita'),
 ('public','operacao_prazos_processo','operacao_prazos_da_empresa'),('public','operacao_prazos_processo','operacao_prazos_da_empresa_escrita'),
 ('public','operacao_empenhos','operacao_empenhos_da_empresa'),('public','operacao_empenhos','operacao_empenhos_da_empresa_escrita'),
 ('public','operacao_itens_resultado','operacao_itens_da_empresa'),('public','operacao_itens_resultado','operacao_itens_da_empresa_escrita'),
 ('public','operacao_ocorrencias','operacao_ocorrencias_da_empresa'),('public','operacao_ocorrencias','operacao_ocorrencias_da_empresa_escrita'),
 ('public','operacao_contratos','operacao_contratos_da_empresa'),('public','operacao_contratos','operacao_contratos_da_empresa_escrita'),
 ('public','operacao_anexos_processo','operacao_anexos_da_empresa'),('public','operacao_anexos_processo','operacao_anexos_da_empresa_escrita'),
 ('public','operacao_renovacoes_documento','operacao_renovacoes_da_empresa'),('public','operacao_renovacoes_documento','operacao_renovacoes_da_empresa_escrita'),
 ('storage','objects','operacao_arquivos_leitura'),('storage','objects','operacao_arquivos_envio'),
 ('storage','objects','operacao_arquivos_atualizacao'),('storage','objects','operacao_arquivos_exclusao')),
trg(esquema,tabela,nome) as (values
 ('public','operacao_documentos','identificacao_documento_alterado'),
 ('storage','objects','identificacao_arquivo_alterado'),
 ('public','operacao_empresas','identificacao_cadastro_alterado'),
 ('public','operacao_documentos','preservar_escopo_operacao'),
 ('public','operacao_processos','preservar_escopo_operacao'),
 ('public','operacao_anexos_processo','validar_arquivo_processo_operacao'),
 ('public','operacao_kit_documentos','kit_documento_escopo_imutavel')),
con(tabela,nome) as (values
 ('operacao_documentos','operacao_documentos_escopo_fk'),('operacao_processos','operacao_processos_escopo_fk'),
 ('operacao_agenda','operacao_agenda_escopo_fk'),('operacao_prazos_processo','operacao_prazos_processo_escopo_fk'),
 ('operacao_empenhos','operacao_empenhos_escopo_fk'),('operacao_documentos','operacao_documentos_arquivo_escopo')),
col(nome) as (values ('marca'),('modelo'),('valor_unitario_proposta'),('valor_unitario_homologado')),
-- Só o backend (service_role) chama estas funções; o navegador (anon/authenticated) não.
srv(sig) as (values
 ('public.incrementar_uso(uuid,text)'),
 ('public.selecionar_sicaf_para_enriquecimento(integer,text)'),
 ('public.confirmar_identificacao_empresa(uuid,uuid,text,text,jsonb,jsonb)'),
 ('public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb)'),
 ('public.reservar_importacao_pncp(uuid,uuid,uuid,uuid)'),
 ('public.gravar_importacao_pncp(uuid,uuid,uuid,uuid,text,integer,text,text,jsonb,jsonb,jsonb)')),
-- Funções internas de trigger: nenhum papel do app executa direto.
interna(sig) as (values ('public.invalidar_identificacao_empresa()'),('public.preservar_escopo_operacao()'),('public.validar_arquivo_processo_operacao()'),('public.kit_documento_escopo_imutavel()')),
itens(ordem,item,ok) as (
 select 1, 'gate verificar_kit_prepublicacao (passou acima)', true
 union all select 2, 'gate identificacao_empresa_habilitada() = true', current_setting('qa.habilitada', true) = 'true'
 union all select 3, 'função '||sig, to_regprocedure(sig) is not null from fn
 union all select 4, 'tabela public.'||nome||' com RLS', coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.'||nome)), false) from tab
 union all select 5, 'policy '||esquema||'.'||tabela||'.'||nome, exists(select 1 from pg_policies p where p.schemaname=pol.esquema and p.tablename=pol.tabela and p.policyname=pol.nome) from pol
 union all select 6, 'storage.objects tem só as 4 policies operacao_arquivos_*', (select count(*) from pg_policies where schemaname='storage' and tablename='objects') = 4
 union all select 7, 'trigger '||esquema||'.'||tabela||'.'||nome, exists(select 1 from pg_trigger t where t.tgrelid = to_regclass(esquema||'.'||tabela) and t.tgname = trg.nome and not t.tgisinternal and t.tgenabled = 'O') from trg
 union all select 8, 'constraint public.'||tabela||'.'||nome, exists(select 1 from pg_constraint c where c.conrelid = to_regclass('public.'||tabela) and c.conname = con.nome) from con
 union all select 9, 'coluna operacao_itens_resultado.'||nome, exists(select 1 from information_schema.columns where table_schema='public' and table_name='operacao_itens_resultado' and column_name=col.nome) from col
 union all select 10, 'só servidor executa '||sig,
  coalesce(not has_function_privilege('anon', to_regprocedure(sig), 'EXECUTE')
       and not has_function_privilege('authenticated', to_regprocedure(sig), 'EXECUTE')
       and has_function_privilege('service_role', to_regprocedure(sig), 'EXECUTE'), false) from srv
 union all select 11, 'interna, sem EXECUTE do app: '||sig,
  coalesce(not has_function_privilege('anon', to_regprocedure(sig), 'EXECUTE')
       and not has_function_privilege('authenticated', to_regprocedure(sig), 'EXECUTE'), false) from interna
 union all select 12, 'anon sem EXECUTE: '||sig, coalesce(not has_function_privilege('anon', to_regprocedure(sig), 'EXECUTE'), false)
  from (values ('public.bootstrap_operacao()'),('public.eh_membro_operacao(uuid)')) v(sig)
)
select row_number() over (order by ordem, item) as n, item, case when ok then 'ok' else 'falha' end as resultado
from itens order by ordem, item;
commit;
