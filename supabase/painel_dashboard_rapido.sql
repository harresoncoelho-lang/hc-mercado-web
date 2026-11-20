-- Painel: "Visão geral do mercado" rápida e RPCs do dashboard fechadas para anon.
-- Idempotente: seguro rodar mais de uma vez no SQL Editor do Supabase.
--
-- Por quê (produção, 19/11/2026): dashboard_estados_distintos e dashboard_segmentos_top rodam como invoker
-- sobre public.contratos (100k+ linhas, RLS) e estouravam o statement timeout (57014), inclusive chamadas
-- com a chave pública anon, que nem enxerga linha nenhuma e não deveria poder executá-las.
-- Correção: o robô scripts/atualizar_dados.js (service_role) grava o resumo pronto em
-- public.dados_robo, chave 'dashboard_mercado'; o painel lê essa linha primeiro e só cai nas RPCs se ela
-- não existir. Nenhuma função nova: o resumo é calculado no robô com a base que ele já tem em memória.
--
-- O que este arquivo faz (só acrescenta / restringe; não altera nem remove policies existentes, que em
-- produção podem ter outros nomes):
--   1) policy ADICIONAL de select para authenticated só na chave 'dashboard_mercado' de dados_robo;
--   2) revoke execute das 3 funções dashboard_* de anon e public, mantendo authenticated e service_role.
-- Ordem no roteiro: aplicar ANTES de publicar o painel novo (o painel antigo continua funcionando para
-- authenticated); depois rodar o robô uma vez para criar a linha 'dashboard_mercado'.
-- Depende de: public.dados_robo e das funções dashboard_* (painel_objetos_sem_sql.sql / produção).

drop policy if exists dados_robo_select_dashboard_mercado on public.dados_robo;
create policy dados_robo_select_dashboard_mercado on public.dados_robo for select to authenticated
  using (chave = 'dashboard_mercado');

grant select on public.dados_robo to authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.dashboard_estados_distintos()',
    'public.dashboard_estados_top(integer)',
    'public.dashboard_segmentos_top(integer)'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from anon, public', f);
      execute format('grant execute on function %s to authenticated, service_role', f);
    end if;
  end loop;
end $$;

-- Conferência (deve dar false, true, true para cada função):
-- select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon,
--        has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
--        has_function_privilege('service_role', p.oid, 'execute') as service_role
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname like 'dashboard\_%';
