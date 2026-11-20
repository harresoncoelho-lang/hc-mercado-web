-- Inventário administrativo; somente catálogos, sem registros de negócio.
-- Executar inteiro no projeto confirmado. Guardar o resultado JSON integral.
-- Não chama RPCs do produto. Não valida backup, arquivos ou integridade dos dados.
begin read only;
set local statement_timeout = '20s';
set local lock_timeout = '2s';
set local search_path = pg_catalog, public;

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
select jsonb_build_object('versao_consulta',1,'observado_em_utc',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
 'server_version',current_setting('server_version'),'read_only',current_setting('transaction_read_only'),
 'hash_catalogo_md5',md5(corpo::text),'catalogo',corpo) as evidencia_catalogo
from catalogo;
commit;
