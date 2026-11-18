-- Somente o esquema da dependência do trigger de cadastro.
-- Não consulta nenhuma linha de public.dados_robo, histórico, boletim ou configuração.
begin read only;
set local statement_timeout='20s';
set local lock_timeout='2s';
set local search_path=pg_catalog,public;

with relacao as (
 select c.*,n.nspname as esquema from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.oid=to_regclass('public.dados_robo')
), corpo as (
 select jsonb_build_object(
  'relacao',(select jsonb_build_object('esquema',r.esquema,'nome',r.relname,
   'tipo',r.relkind,'dono',pg_get_userbyid(r.relowner),'rls',r.relrowsecurity,
   'force_rls',r.relforcerowsecurity,'acl',r.relacl::text) from relacao r),
  'colunas',(select coalesce(jsonb_agg(jsonb_build_object(
   'nome',a.attname,'ordem',a.attnum,'tipo',format_type(a.atttypid,a.atttypmod),
   'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),
   'identity',a.attidentity,'generated',a.attgenerated,'acl',a.attacl::text
  ) order by a.attnum),'[]'::jsonb) from relacao r join pg_attribute a on a.attrelid=r.oid
   left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
   where a.attnum>0 and not a.attisdropped),
  'constraints',(select coalesce(jsonb_agg(jsonb_build_object(
   'nome',c.conname,'tipo',c.contype,'definicao',pg_get_constraintdef(c.oid,true)
  ) order by c.conname),'[]'::jsonb) from relacao r join pg_constraint c on c.conrelid=r.oid),
  'indices',(select coalesce(jsonb_agg(jsonb_build_object(
   'nome',c.relname,'definicao',pg_get_indexdef(i.indexrelid)
  ) order by c.relname),'[]'::jsonb) from relacao r join pg_index i on i.indrelid=r.oid
   join pg_class c on c.oid=i.indexrelid),
  'policies',(select coalesce(jsonb_agg(jsonb_build_object(
   'nome',p.policyname,'permissiva',p.permissive,'papeis',p.roles,'comando',p.cmd,
   'using',p.qual,'check',p.with_check
  ) order by p.policyname),'[]'::jsonb) from pg_policies p where p.schemaname='public' and p.tablename='dados_robo'),
  'acl_relacao',(select coalesce(jsonb_agg(jsonb_build_object(
   'concedente',pg_get_userbyid(a.grantor),
   'papel',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
   'privilegio',a.privilege_type,'grant_option',a.is_grantable
  ) order by a.grantee,a.privilege_type),'[]'::jsonb)
   from relacao r cross join lateral aclexplode(coalesce(r.relacl,acldefault('r',r.relowner))) a),
  'triggers',(select coalesce(jsonb_agg(jsonb_build_object(
   'nome',t.tgname,'estado',t.tgenabled,'funcao',t.tgfoid::regprocedure::text,
   'hash_funcao_md5',md5(replace(p.prosrc,chr(13),''))
  ) order by t.tgname),'[]'::jsonb) from relacao r join pg_trigger t on t.tgrelid=r.oid
   join pg_proc p on p.oid=t.tgfoid where not t.tgisinternal)
 ) as dado
)
select jsonb_build_object(
 'versao_consulta',1,'read_only',current_setting('transaction_read_only'),
 'observado_em_utc',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
 'server_version',current_setting('server_version'),
 'hash_catalogo_md5',md5(dado::text),'catalogo',dado
) as evidencia_esquema_dados_robo
from corpo;

commit;
