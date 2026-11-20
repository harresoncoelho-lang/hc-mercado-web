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
