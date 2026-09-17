-- ============================================================================
-- LicitaPlena — tirar data/oportunidades_abertas.json (~14,6 MB) e
-- data/boletim/{UF}.json (27 arquivos, ~6,7 MB) do controle de versão do
-- site e mover pro banco (Supabase/Postgres), mesmo padrão de
-- supabase/schema_dados_mercado.sql.
--
-- Por quê: o robô comita esses arquivos TODO DIA (e a cada recuperação de
-- 3h), e cada commit dispara um "Production deploy" completo no Netlify —
-- consumindo crédito de build sem relação nenhuma com mudança de código.
-- Com os dados no Supabase, o robô só grava/atualiza linhas (sem novo
-- deploy) e o painel consulta só o pedaço filtrado que precisa (por UF,
-- quando aplicável) em vez de baixar o arquivo nacional inteiro sempre.
--
-- Rode este arquivo inteiro no Supabase: painel do projeto → SQL Editor →
-- New query → colar tudo → Run. Idempotente (pode rodar de novo sem medo).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Oportunidades abertas (propostas em andamento no PNCP, nacional, todas UFs)
--    Fonte: scripts/atualizar_dados.js -> coletarOportunidadesAbertas()
--    "chave" replica a mesma lógica de deduplicação que já existia em memória
--    no arquivo JSON (numeroControlePNCP, ou "objeto|orgao|uf" quando o PNCP
--    não devolve numeroControlePNCP pra uma oportunidade) — ver chaveOportunidade()
--    em scripts/atualizar_dados.js. "dado" guarda o registro inteiro, igual
--    ao padrão de "contratos"/"mercado_atas".
-- ----------------------------------------------------------------------------
create table if not exists public.oportunidades_abertas (
  chave text primary key,
  numero_controle_pncp text,
  objeto text not null default '',
  uf text,
  publicacao date,
  encerramento date,
  dado jsonb not null,
  atualizado_em timestamptz not null default now()
);

create index if not exists oportunidades_abertas_uf_idx on public.oportunidades_abertas (uf);
create index if not exists oportunidades_abertas_publicacao_idx on public.oportunidades_abertas (publicacao);
create index if not exists oportunidades_abertas_encerramento_idx on public.oportunidades_abertas (encerramento);

alter table public.oportunidades_abertas enable row level security;

drop policy if exists "oportunidades_abertas_select_autenticado" on public.oportunidades_abertas;
create policy "oportunidades_abertas_select_autenticado"
  on public.oportunidades_abertas for select
  using (auth.role() = 'authenticated');

-- Escrita só pelo robô, via SUPABASE_SERVICE_ROLE_KEY (que ignora RLS) — nenhuma
-- policy de insert/update/delete é criada aqui de propósito, então o navegador do
-- cliente (chave anon) nunca consegue alterar essa tabela, só ler.

-- ============================================================================
-- Depois de rodar: Table Editor deve mostrar "oportunidades_abertas" com RLS
-- "Enabled". O backfill inicial (scripts/migrar_dados_supabase.js) e as
-- próximas execuções do robô (scripts/atualizar_dados.js) populam essa tabela
-- automaticamente — não precisa inserir nada manualmente aqui.
-- ============================================================================
