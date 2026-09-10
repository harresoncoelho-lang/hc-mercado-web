-- ============================================================================
-- LicitaPlena — dossiês de editais pré-processados
-- Rode este arquivo inteiro no Supabase SQL Editor. É idempotente.
-- O robô/Netlify grava com service_role; clientes autenticados só leem.
-- ============================================================================

create table if not exists public.dossies_editais (
  numero_controle_pncp text primary key,
  versao integer not null default 1,
  status text not null default 'processando' check (status in ('processando', 'pronto', 'parcial', 'erro')),
  fonte_lida boolean not null default false,
  dossie jsonb not null default '{}'::jsonb,
  gerado_em timestamptz,
  atualizado_em timestamptz not null default now(),
  expira_em timestamptz
);

create index if not exists dossies_editais_status_atualizado_idx
  on public.dossies_editais (status, atualizado_em desc);

alter table public.dossies_editais enable row level security;

drop policy if exists "dossies_editais_select_autenticado" on public.dossies_editais;
create policy "dossies_editais_select_autenticado"
  on public.dossies_editais for select
  using (auth.role() = 'authenticated');

-- Não há policy de escrita: somente o service_role do robô/Netlify ignora RLS.
