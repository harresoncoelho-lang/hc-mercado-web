-- Preparado, ainda não executado. Somente catálogos; não chama funções da aplicação.
-- Corpos retornados apenas para as duas assinaturas expressamente solicitadas.
-- Não consulta usuários, clientes, configurações, Vault, jobs ou valores de credenciais.
-- pg_depend não identifica todas as referências internas de corpos PL/pgSQL.
begin read only;
set local statement_timeout = '20s';
set local lock_timeout = '2s';
set local search_path = pg_catalog, public;

with solicitadas(assinatura) as (
 values ('public.criar_cliente_no_cadastro()'::text),
        ('public.admin_tem_permissao(text)'::text)
), raizes as (
 select s.assinatura, to_regprocedure(s.assinatura) as oid
 from solicitadas s
), funcoes as (
 select r.assinatura as solicitada, p.*, n.nspname as esquema, l.lanname as linguagem
 from raizes r
 join pg_proc p on p.oid = r.oid and p.prokind in ('f','p')
 join pg_namespace n on n.oid = p.pronamespace
 join pg_language l on l.oid = p.prolang
), arestas as (
 select 'saida'::text as direcao, r.assinatura as raiz,
        pg_describe_object(d.classid,d.objid,d.objsubid) as objeto,
        pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid) as referencia,
        d.deptype::text as tipo
 from raizes r join pg_depend d on d.classid = 'pg_proc'::regclass and d.objid = r.oid
 union all
 select 'entrada'::text, r.assinatura,
        pg_describe_object(d.classid,d.objid,d.objsubid),
        pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid), d.deptype::text
 from raizes r join pg_depend d on d.refclassid = 'pg_proc'::regclass and d.refobjid = r.oid
), corpo as (
 select jsonb_build_object(
  'solicitadas', (
   select jsonb_agg(jsonb_build_object('assinatura',r.assinatura,'existe',f.oid is not null)
                    order by r.assinatura)
   from raizes r left join funcoes f on f.oid = r.oid
  ),
  'funcoes', (
   select coalesce(jsonb_agg(jsonb_build_object(
    'solicitada',f.solicitada,'esquema',f.esquema,'nome',f.proname,
    'argumentos',pg_get_function_identity_arguments(f.oid),
    'retorno',pg_get_function_result(f.oid),'linguagem',f.linguagem,
    'dono',pg_get_userbyid(f.proowner),'security_definer',f.prosecdef,
    'volatilidade',f.provolatile,'strict',f.proisstrict,'parallel',f.proparallel,
    'configuracao_funcao',f.proconfig,'acl',f.proacl::text,
    'hash_corpo_md5',md5(replace(f.prosrc,chr(13),'')),
    'hash_definicao_md5',md5(pg_get_functiondef(f.oid)),
    'definicao',pg_get_functiondef(f.oid)
   ) order by f.solicitada),'[]'::jsonb) from funcoes f
  ),
  'acl_funcoes', (
   select coalesce(jsonb_agg(jsonb_build_object(
    'assinatura',f.solicitada,'concedente',pg_get_userbyid(a.grantor),
    'papel',case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
    'privilegio',a.privilege_type,'grant_option',a.is_grantable
   ) order by f.solicitada,case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,a.privilege_type),'[]'::jsonb)
   from funcoes f cross join lateral aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
  ),
  'dependencias_diretas_catalogadas', (
   select coalesce(jsonb_agg(jsonb_build_object(
    'direcao',a.direcao,'raiz',a.raiz,'objeto',a.objeto,'referencia',a.referencia,'tipo',a.tipo
   ) order by a.raiz,a.direcao,a.objeto,a.referencia,a.tipo),'[]'::jsonb) from arestas a
  ),
  'limites', jsonb_build_array(
   'Sem registros de negócio ou chamadas às funções inventariadas.',
   'Corpos PL/pgSQL e SQL em string podem conter referências não registradas em pg_depend.',
   'Dependências são diretas; funções relacionadas aparecem somente por identidade, sem corpo.',
   'Definições são reconstruídas por pg_get_functiondef; não são uma exportação completa do banco.'
  )
 ) as dado
)
select jsonb_build_object(
 'versao_consulta',1,
 'observado_em_utc',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
 'server_version',current_setting('server_version'),
 'read_only',current_setting('transaction_read_only'),
 'hash_catalogo_md5',md5(dado::text),
 'catalogo',dado
) as evidencia_auth_dependencias
from corpo;

commit;
