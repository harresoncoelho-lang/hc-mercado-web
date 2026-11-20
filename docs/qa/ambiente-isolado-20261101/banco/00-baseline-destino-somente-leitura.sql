-- Executar somente na aba confirmada do projeto de homologação:
-- organização vhmjospwgiryrnrndkpd / projeto luguscapasskcsficckf.
-- Referências esperadas abaixo são rótulos do roteiro, não prova de identidade do servidor.
-- Não executar em lsqjamqvmrcyrvowndiu (produção).
begin read only;
set local statement_timeout = '20s';
set local lock_timeout = '2s';
set local search_path = pg_catalog, public;

select jsonb_build_object(
 'versao_consulta',1,
 'projeto_esperado','luguscapasskcsficckf',
 'organizacao_esperada','vhmjospwgiryrnrndkpd',
 'identidade_servidor_confirmada_por_esta_consulta',false,
 'observado_em_utc',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
 'server_version',current_setting('server_version'),
 'server_version_num',current_setting('server_version_num'),
 'read_only',current_setting('transaction_read_only'),
 'banco',current_database(),
 'executor',current_user,
 'usuario_sessao',session_user,
 'public_relacoes',(
  select coalesce(jsonb_agg(jsonb_build_object(
   'nome',c.relname,'tipo',c.relkind,'dono',pg_get_userbyid(c.relowner),
   'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity
  ) order by c.relname),'[]'::jsonb)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p','v','m','f','S')
 ),
 'public_funcoes',(
  select coalesce(jsonb_agg(jsonb_build_object(
   'assinatura',p.oid::regprocedure::text,'dono',pg_get_userbyid(p.proowner),
   'security_definer',p.prosecdef
  ) order by p.oid::regprocedure::text),'[]'::jsonb)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind in ('f','p')
 ),
 'servicos_gerenciados',jsonb_build_object(
  'auth_users_existe',to_regclass('auth.users') is not null,
  'storage_buckets_existe',to_regclass('storage.buckets') is not null,
  'storage_objects_existe',to_regclass('storage.objects') is not null,
  'auth_uid_existe',to_regprocedure('auth.uid()') is not null,
  'auth_jwt_existe',to_regprocedure('auth.jwt()') is not null,
  'auth_role_existe',to_regprocedure('auth.role()') is not null
 ),
 'extensoes',(
  select coalesce(jsonb_agg(jsonb_build_object('nome',e.extname,'versao',e.extversion)
   order by e.extname),'[]'::jsonb) from pg_extension e
 ),
 'papeis_necessarios',(
  select coalesce(jsonb_agg(jsonb_build_object(
   'nome',r.rolname,'superuser',r.rolsuper,'login',r.rolcanlogin,
   'inherit',r.rolinherit,'bypass_rls',r.rolbypassrls
  ) order by r.rolname),'[]'::jsonb)
  from pg_roles r where r.rolname in ('postgres','anon','authenticated','service_role','supabase_auth_admin','supabase_storage_admin')
 ),
 'defaults_public',(
  select coalesce(jsonb_agg(jsonb_build_object(
   'dono',pg_get_userbyid(d.defaclrole),'tipo',d.defaclobjtype,'acl',d.defaclacl::text
  ) order by pg_get_userbyid(d.defaclrole),d.defaclobjtype),'[]'::jsonb)
  from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace
  where n.nspname='public'
 ),
 'limites',jsonb_build_array(
  'Sem linhas de negócio, configuração de credenciais ou execução de funções da aplicação.',
  'Nome do banco, executor e rótulo esperado não identificam o projeto hospedado.',
  'A referência real deve ser conferida na URL/identidade da conexão antes de executar.',
  'Presença de schemas não comprova saúde HTTP ou autenticação real dos serviços.'
 )
) as evidencia_baseline_destino;

commit;
