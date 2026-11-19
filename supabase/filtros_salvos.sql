-- Filtros salvos com nome, "sem interesse" por edital e hora do aviso dos lembretes (painel: Encontrar Licitações).
-- Aditivo e idempotente: não toca clientes.boletim_filtro (o filtro do Boletim continua como está).
-- Cada conta lê e grava só as próprias linhas (RLS); anon não tem acesso. Teste: testar_filtros_salvos.sql.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table if not exists public.filtros_salvos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 1 and 60),
  filtro jsonb not null check (jsonb_typeof(filtro) = 'object' and octet_length(filtro::text) <= 4000),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists filtros_salvos_nome_unico on public.filtros_salvos (cliente_id, lower(btrim(nome)));

create table if not exists public.editais_sem_interesse (
  cliente_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  numero_controle text not null check (length(numero_controle) between 1 and 120),
  objeto_resumo text check (objeto_resumo is null or length(objeto_resumo) <= 200),
  criado_em timestamptz not null default now(),
  primary key (cliente_id, numero_controle)
);

-- Tetos por conta (a tabela não cresce sem fim): 20 filtros e 5.000 descartes.
create or replace function public.limitar_filtros_salvos() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_table_name = 'filtros_salvos' then
    if tg_op = 'INSERT' and (select count(*) from public.filtros_salvos where cliente_id = new.cliente_id) >= 20 then
      raise exception 'Limite de 20 filtros salvos por conta.' using errcode = 'check_violation';
    end if;
    if tg_op = 'UPDATE' then new.atualizado_em := now(); end if;
  elsif (select count(*) from public.editais_sem_interesse where cliente_id = new.cliente_id) >= 5000 then
    raise exception 'Limite de 5000 editais descartados por conta.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists filtros_salvos_limite on public.filtros_salvos;
create trigger filtros_salvos_limite before insert or update on public.filtros_salvos for each row execute function public.limitar_filtros_salvos();
drop trigger if exists sem_interesse_limite on public.editais_sem_interesse;
create trigger sem_interesse_limite before insert on public.editais_sem_interesse for each row execute function public.limitar_filtros_salvos();

alter table public.filtros_salvos enable row level security;
alter table public.editais_sem_interesse enable row level security;
drop policy if exists filtros_salvos_proprios on public.filtros_salvos;
create policy filtros_salvos_proprios on public.filtros_salvos for all to authenticated
  using (cliente_id = auth.uid()) with check (cliente_id = auth.uid());
drop policy if exists sem_interesse_proprios on public.editais_sem_interesse;
create policy sem_interesse_proprios on public.editais_sem_interesse for all to authenticated
  using (cliente_id = auth.uid()) with check (cliente_id = auth.uid());
revoke all on public.filtros_salvos, public.editais_sem_interesse from public, anon;
grant select, insert, update, delete on public.filtros_salvos, public.editais_sem_interesse to authenticated;
grant all on public.filtros_salvos, public.editais_sem_interesse to service_role;

-- Lembretes: hora do aviso (Brasília) e carimbo do envio. Só se a tabela existe (o ensaio PGlite não a tem).
do $$
begin
  if to_regclass('public.lembretes') is not null then
    alter table public.lembretes add column if not exists hora_aviso smallint not null default 8;
    alter table public.lembretes add column if not exists enviado_em timestamptz;
    if not exists (select 1 from pg_constraint where conname = 'lembretes_hora_aviso_valida') then
      alter table public.lembretes add constraint lembretes_hora_aviso_valida check (hora_aviso between 0 and 23);
    end if;
  end if;
end $$;
commit;
