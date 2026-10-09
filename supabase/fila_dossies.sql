-- ============================================================================
-- LicitaPlena — fila de dossiês a gerar
-- Rode este arquivo inteiro no Supabase SQL Editor. É idempotente.
--
-- O painel registra aqui o edital que o cliente abriu sem dossiê pronto; o robô
-- scripts/gerar_dossies_gemini.js lê a fila, junta os editais enviados nos boletins,
-- gera o dossiê e anota o resultado. As tentativas ficam registradas para que um
-- edital que sempre falha não seja reprocessado indefinidamente.
-- ============================================================================

create table if not exists public.fila_dossies (
  numero_controle_pncp text primary key,
  origem text not null default 'clique' check (origem in ('clique', 'boletim')),
  pedido_em timestamptz not null default now(),
  tentativas integer not null default 0,
  ultima_tentativa_em timestamptz,
  ultimo_erro text,
  concluido_em timestamptz
);

create index if not exists fila_dossies_pendentes_idx
  on public.fila_dossies (pedido_em)
  where concluido_em is null;

alter table public.fila_dossies enable row level security;

-- Sem policies: somente o service_role (Netlify Function e robô) lê e escreve.
