-- ============================================================================
-- LicitaPlena — SINAPI (preços de insumos e custos de composições da CAIXA, por UF).
--
-- Rode no Supabase: SQL Editor -> New query -> Run. Idempotente, transação única;
-- só cria objetos novos (não altera nem apaga dados de outras tabelas).
-- Escrita: só o robô scripts/coletar_sinapi.js (service_role), uma vez por mês.
-- Leitura: cliente aprovado (cliente_aprovado()), pela tela sinapi.html. anon não lê.
--
-- Cache da referência mais recente: uma linha por (UF, tipo, desonerado, código). O robô faz upsert e depois
-- apaga, da UF que carregou, o que ficou com referência anterior (código que saiu do SINAPI). Dado público.
-- ============================================================================
begin;

create table if not exists public.sinapi_precos (
  uf text not null check (uf ~ '^[A-Z]{2}$'),
  tipo text not null check (tipo in ('insumo', 'composicao')),
  desonerado boolean not null,
  codigo text not null check (codigo ~ '^[0-9]{1,10}$'),
  descricao text not null check (length(descricao) between 1 and 2000),
  unidade text check (unidade is null or length(unidade) <= 30),
  -- Insumo: classificação (MATERIAL, SERVIÇOS...); composição: grupo (Acessibilidade, Alvenaria...).
  grupo text check (grupo is null or length(grupo) <= 200),
  -- Insumo: origem do preço (C = coletado, CR = coeficiente de representatividade, AS = atribuído de SP).
  origem text check (origem is null or length(origem) <= 10),
  preco numeric(14, 2) not null check (preco > 0),
  -- Mês de referência da CAIXA (sempre dia 1).
  referencia date not null check (extract(day from referencia) = 1),
  -- Descrição minúscula e sem acento, montada pelo robô para o ILIKE da busca.
  busca text not null default '' check (length(busca) <= 2000),
  coletado_em timestamptz not null default now(),
  primary key (uf, tipo, desonerado, codigo)
);
-- shortcut: a busca por texto faz ILIKE dentro de (uf, tipo, desonerado) da chave primária: ~5 mil insumos ou
-- ~11 mil composições por UF, rápido sem índice. Com muitas UFs e lentidão, criar índice gin_trgm_ops em busca.

alter table public.sinapi_precos enable row level security;
revoke all on public.sinapi_precos from anon, authenticated;
grant select on public.sinapi_precos to authenticated;
revoke truncate on public.sinapi_precos from service_role;
grant select, insert, update, delete on public.sinapi_precos to service_role;

-- Mesmo corpo de prospeccao.sql e historico_licitacoes.sql: este arquivo roda sozinho.
create or replace function public.cliente_aprovado() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clientes c where c.id = (select auth.uid()) and c.status = 'aprovado')
$$;
revoke all on function public.cliente_aprovado() from public, anon;
grant execute on function public.cliente_aprovado() to authenticated, service_role;

drop policy if exists sinapi_precos_select_aprovado on public.sinapi_precos;
create policy sinapi_precos_select_aprovado on public.sinapi_precos
  for select to authenticated using (public.cliente_aprovado());
-- Sem policy de escrita: só service_role (bypassrls) grava.

commit;
