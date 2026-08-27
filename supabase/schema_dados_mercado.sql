-- ============================================================================
-- LicitaPlena — migração estrutural: tirar os dois maiores arquivos de dados
-- do robô (contratos_recentes.json ~22MB e mercado_segmentos.json ~10MB) do
-- controle de versão do site e movê-los pro banco (Supabase/Postgres).
--
-- Por quê: hoje o robô comita esses dois arquivos inteiros no git TODO DIA,
-- e cada commit dispara um novo "Production deploy" no Netlify — é isso que
-- está consumindo os créditos do plano sem nenhum usuário pagante ainda
-- (Achado #1 do Diagnóstico Crítico). Com os dados no Supabase, o robô só
-- grava/atualiza linhas no banco (sem novo deploy) e o painel consulta só o
-- pedaço filtrado que precisa (sem baixar os 20-30 MB inteiros a cada visita
-- — Achado #2).
--
-- Rode este arquivo inteiro no Supabase: painel do projeto → SQL Editor →
-- New query → colar tudo → Run. Idempotente (pode rodar de novo sem medo).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Contratos assinados (PNCP, nacional, todos os setores)
--    Fonte: scripts/atualizar_dados.js -> coletarContratos()
-- ----------------------------------------------------------------------------
create table if not exists public.contratos (
  numero_controle_pncp text primary key,
  objeto text not null default '',
  uf text,
  cnpj_fornecedor text,
  data_assinatura date,
  -- registro completo como o robô produz (orgao, cnpjOrgao, municipio, nomeFornecedor,
  -- valor, segmentos etc.) — guardado inteiro pra não precisar mexer no schema toda vez
  -- que um campo novo for adicionado em scripts/atualizar_dados.js.
  dado jsonb not null,
  atualizado_em timestamptz not null default now()
);

create index if not exists contratos_uf_idx on public.contratos (uf);
create index if not exists contratos_cnpj_fornecedor_idx on public.contratos (cnpj_fornecedor);
create index if not exists contratos_data_assinatura_idx on public.contratos (data_assinatura);
-- Índice trigram pra acelerar o "contém a palavra-chave" (ILIKE '%palavra%') que o
-- Diagnóstico de Mercado usa pra casar segmento — sem isso, ILIKE em texto livre em
-- 40k+ linhas fica lento à medida que a tabela cresce.
create extension if not exists pg_trgm;
create index if not exists contratos_objeto_trgm_idx on public.contratos using gin (objeto gin_trgm_ops);

alter table public.contratos enable row level security;

drop policy if exists "contratos_select_autenticado" on public.contratos;
create policy "contratos_select_autenticado"
  on public.contratos for select
  using (auth.role() = 'authenticated');

-- Escrita só pelo robô, via SUPABASE_SERVICE_ROLE_KEY (que ignora RLS) — nenhuma
-- policy de insert/update/delete é criada aqui de propósito, então o navegador do
-- cliente (chave anon) nunca consegue alterar essa tabela, só ler.

-- ----------------------------------------------------------------------------
-- 2) Atas de registro de preço (TODOS os segmentos, não só uma lista fixa — a
--    coluna "segmentos" abaixo é só um rótulo informativo herdado da lista
--    SEGMENTOS de scripts/atualizar_dados.js; ela não filtra mais a coleta,
--    ver comentário em segmentosQueBatem() nesse arquivo) + itens/vencedores.
--    Fonte: scripts/atualizar_dados.js -> coletarMercadoSegmentos()
--    "dado" guarda o objeto inteiro da ata (itens, vencedores etc.) como veio do
--    robô — mais simples e fiel ao formato que o painel já sabe processar
--    (calcularEmpresasMercado em painel.html) do que normalizar em várias tabelas.
-- ----------------------------------------------------------------------------
create table if not exists public.mercado_atas (
  numero_controle_pncp_ata text primary key,
  numero_controle_pncp_compra text,
  objeto text not null default '',
  uf_orgao text,
  municipio_orgao text,
  segmentos text[] not null default '{}',
  data_assinatura date,
  vigencia_fim date,
  cancelado boolean not null default false,
  enriquecida boolean not null default false,
  dado jsonb not null,
  atualizado_em timestamptz not null default now()
);

create index if not exists mercado_atas_uf_orgao_idx on public.mercado_atas (uf_orgao);
create index if not exists mercado_atas_segmentos_idx on public.mercado_atas using gin (segmentos);
create index if not exists mercado_atas_objeto_trgm_idx on public.mercado_atas using gin (objeto gin_trgm_ops);

alter table public.mercado_atas enable row level security;

drop policy if exists "mercado_atas_select_autenticado" on public.mercado_atas;
create policy "mercado_atas_select_autenticado"
  on public.mercado_atas for select
  using (auth.role() = 'authenticated');

-- ----------------------------------------------------------------------------
-- 3) Resumo imediato da Inteligência de Mercado
--
-- O painel não precisa transportar até mil contratos completos para exibir os
-- primeiros indicadores. Esta função devolve somente os agregados do filtro atual;
-- os contratos detalhados continuam sendo carregados apenas para os aprofundamentos.
-- SECURITY INVOKER preserva a RLS da tabela: só usuários autenticados podem consultar.
-- ----------------------------------------------------------------------------
create or replace function public.resumo_inteligencia_mercado(
  p_termos text[],
  p_dias integer,
  p_uf text default null
)
returns table (
  valor_nacional numeric,
  valor_recorte numeric,
  contratos_recorte bigint,
  concorrentes_recorte bigint,
  orgaos_recorte bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select
      c.uf,
      c.cnpj_fornecedor,
      coalesce(c.dado ->> 'orgao', 'Órgão não informado') as orgao,
      coalesce(nullif(c.dado ->> 'valor', '')::numeric, 0) as valor
    from public.contratos c
    where (p_dias is null or p_dias <= 0 or c.data_assinatura >= current_date - p_dias or c.data_assinatura is null)
      and (
        coalesce(cardinality(p_termos), 0) = 0
        or exists (
          select 1 from unnest(p_termos) as termo
          where c.objeto ilike '%' || termo || '%'
        )
      )
  ), recorte as (
    select * from base where p_uf is null or uf = p_uf
  )
  select
    coalesce((select sum(valor) from base), 0),
    coalesce((select sum(valor) from recorte), 0),
    (select count(*) from recorte),
    (select count(distinct nullif(cnpj_fornecedor, '')) from recorte),
    (select count(distinct orgao) from recorte);
$$;

grant execute on function public.resumo_inteligencia_mercado(text[], integer, text) to authenticated;

-- ============================================================================
-- Depois de rodar: Table Editor deve mostrar "contratos" e "mercado_atas" com
-- RLS "Enabled". O backfill inicial (scripts/migrar_dados_supabase.js) e as
-- próximas execuções do robô (scripts/atualizar_dados.js) populam essas tabelas
-- automaticamente — não precisa inserir nada manualmente aqui.
-- ============================================================================
