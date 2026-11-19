-- ATENÇÃO: CONFERIR COM A PRODUÇÃO ANTES DE APLICAR. NÃO APLICADO EM PRODUÇÃO.
--
-- Objetos que o painel usa e que produção já tem, mas que não tinham .sql no repositório (teste ponta a ponta
-- 18/11/2026, bug B8): dados_robo, lembretes, dashboard_estados_distintos, dashboard_estados_top,
-- dashboard_segmentos_top.
--
-- Fonte da reconstrução: o esquema extraído do dump de homologação (docs/qa/ambiente-isolado-20261101/
-- inventario-run-41339162377/schema.sql, origem de teste, não backup de produção) e o que as telas esperam
-- (painel.html: carregarBlobSupabase, lembretes, rpc dashboard_*; admin.html: config_admin;
-- scripts/supabase_dados.js e scripts/lembretes_licitacoes.py).
--
-- Só cria o que falta: nada aqui altera, troca ou apaga objeto existente (tabela, função, policy ou grant).
-- Em produção, onde tudo já existe, rodar este arquivo não deve mudar nada; mesmo assim confira antes, porque
-- as policies do dump de homologação têm nome "_qa_" e podem não ser as de produção.
-- Usado pelo ambiente de teste local (ambiente-teste/subir.cjs). Depende de public.contratos
-- (schema_dados_mercado.sql) para as funções do dashboard.

-- Tier 3 do fluxo de dados (CLAUDE.md): blobs chave -> jsonb gravados pelos robôs com service_role.
create table if not exists public.dados_robo (
  chave text primary key,
  dado jsonb not null,
  atualizado_em timestamptz not null default now()
);
alter table public.dados_robo enable row level security;

-- Lembretes do painel (sino no card); o robô lembretes_licitacoes.py lê e marca enviado com service_role.
create table if not exists public.lembretes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references auth.users(id) on delete cascade,
  numero_controle_pncp text,
  objeto_resumo text,
  data_final_proposta timestamptz,
  dias_antes integer,
  nota text,
  enviado boolean not null default false
);
alter table public.lembretes enable row level security;

do $$
begin
  -- Leitura só das chaves que as telas pedem (painel: oportunidades_meta, convenios, sistema_s_am; admin: config_admin).
  -- Outras chaves (filas e progresso dos robôs) ficam só para service_role. A escrita do config_admin pelo admin.html
  -- depende de policy que não está no dump: conferir em produção.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'dados_robo') then
    create policy dados_robo_select_telas on public.dados_robo for select to authenticated
      using (chave = any (array['oportunidades_meta', 'convenios', 'sistema_s_am', 'config_admin']));
  end if;
  -- Cada cliente vê, cria e apaga só os próprios lembretes.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'lembretes') then
    create policy lembretes_all_proprios on public.lembretes for all to authenticated
      using (cliente_id = auth.uid()) with check (cliente_id = auth.uid());
  end if;

  if to_regprocedure('public.dashboard_estados_distintos()') is null then
    create function public.dashboard_estados_distintos() returns integer
      language sql stable set search_path to 'public'
      as $f$ select count(distinct nullif(uf, ''))::integer from public.contratos; $f$;
    revoke all on function public.dashboard_estados_distintos() from public;
    grant execute on function public.dashboard_estados_distintos() to authenticated, service_role;
  end if;

  if to_regprocedure('public.dashboard_estados_top(integer)') is null then
    create function public.dashboard_estados_top(limite integer default 10) returns table(uf text, total bigint)
      language sql stable set search_path to 'public'
      as $f$
        select c.uf, count(*) as total
        from public.contratos c
        where nullif(c.uf, '') is not null
        group by c.uf
        order by total desc, c.uf
        limit greatest(1, least(coalesce(limite, 10), 100));
      $f$;
    revoke all on function public.dashboard_estados_top(integer) from public;
    grant execute on function public.dashboard_estados_top(integer) to authenticated, service_role;
  end if;

  if to_regprocedure('public.dashboard_segmentos_top(integer)') is null then
    create function public.dashboard_segmentos_top(limite integer default 10) returns table(segmento text, total bigint)
      language sql stable set search_path to 'public'
      as $f$
        select s.segmento, count(*) as total
        from public.contratos c
        cross join lateral jsonb_array_elements_text(
          case when jsonb_typeof(c.dado -> 'segmentos') = 'array' then c.dado -> 'segmentos' else '[]'::jsonb end
        ) as s(segmento)
        where nullif(s.segmento, '') is not null
        group by s.segmento
        order by total desc, s.segmento
        limit greatest(1, least(coalesce(limite, 10), 100));
      $f$;
    revoke all on function public.dashboard_segmentos_top(integer) from public;
    grant execute on function public.dashboard_segmentos_top(integer) to authenticated, service_role;
  end if;
end $$;

grant select on public.dados_robo to authenticated;
grant select, insert, update, delete on public.lembretes to authenticated;
