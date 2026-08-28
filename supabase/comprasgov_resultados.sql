-- ============================================================================
-- LicitaPlena — resultados homologados públicos do Compras.gov.
--
-- Rode este arquivo no Supabase: SQL Editor -> New query -> Run.
-- É idempotente: pode ser executado novamente sem apagar resultados existentes.
-- A tabela guarda o resultado normalizado e o objeto completo em JSONB; somente
-- o robô (service_role) escreve e clientes autenticados somente leem.
-- ============================================================================

create table if not exists public.comprasgov_resultados (
  chave text primary key,
  id_compra_item text not null,
  id_compra text,
  numero_controle_pncp text,
  uf text,
  cnpj_fornecedor text,
  data_resultado date,
  dado jsonb not null,
  atualizado_em timestamptz not null default now()
);

create index if not exists comprasgov_resultados_data_idx
  on public.comprasgov_resultados (data_resultado desc);
create index if not exists comprasgov_resultados_fornecedor_idx
  on public.comprasgov_resultados (cnpj_fornecedor);
create index if not exists comprasgov_resultados_uf_idx
  on public.comprasgov_resultados (uf);
create index if not exists comprasgov_resultados_compra_idx
  on public.comprasgov_resultados (id_compra);

alter table public.comprasgov_resultados enable row level security;

drop policy if exists "comprasgov_resultados_select_autenticado" on public.comprasgov_resultados;
create policy "comprasgov_resultados_select_autenticado"
  on public.comprasgov_resultados for select
  using (auth.role() = 'authenticated');

-- Não há policies de escrita: somente SUPABASE_SERVICE_ROLE_KEY do robô ignora
-- RLS. O navegador do cliente não consegue criar, alterar ou apagar resultados.
