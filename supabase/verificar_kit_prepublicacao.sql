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
