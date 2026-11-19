-- ============================================================================
-- LicitaPlena — sanções de empresas (CEIS e CNEP da CGU), carga diária.
--
-- Rode no Supabase: SQL Editor -> New query -> Run. Idempotente, transação única;
-- só cria objetos novos (não altera nem apaga dados de outras tabelas).
-- Escrita: só o robô scripts/coletar_sancoes_cgu.js (service_role). Leitura: qualquer
-- usuário autenticado (dado público da CGU). anon não lê.
--
-- LGPD: só pessoa jurídica. O check de 14 dígitos barra CPF mesmo que o robô falhe.
-- Histórico: nada é apagado; o que sumiu do arquivo do dia fica fora_da_lista = true.
-- ============================================================================
begin;

create table if not exists public.sancoes_empresas (
  cadastro text not null check (cadastro in ('CEIS', 'CNEP')),
  codigo_sancao text not null check (codigo_sancao ~ '^[0-9]{1,40}$'),
  cnpj text not null check (cnpj ~ '^[0-9]{14}$'),
  razao_social text check (razao_social is null or length(razao_social) <= 300),
  tipo_sancao text check (tipo_sancao is null or length(tipo_sancao) <= 300),
  orgao_sancionador text check (orgao_sancionador is null or length(orgao_sancionador) <= 300),
  uf_orgao text check (uf_orgao is null or uf_orgao ~ '^[A-Z]{2}$'),
  esfera_orgao text check (esfera_orgao is null or length(esfera_orgao) <= 60),
  abrangencia text check (abrangencia is null or length(abrangencia) <= 300),
  data_inicio date,
  data_fim date,
  data_publicacao date,
  fundamentacao text check (fundamentacao is null or length(fundamentacao) <= 1000),
  numero_processo text check (numero_processo is null or length(numero_processo) <= 200),
  valor_multa numeric(18, 2),
  -- Data do arquivo da CGU que trouxe a linha pela última vez.
  data_carga date not null,
  fora_da_lista boolean not null default false,
  fora_da_lista_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (cadastro, codigo_sancao),
  check (fora_da_lista or fora_da_lista_em is null)
);

create index if not exists sancoes_empresas_cnpj_idx on public.sancoes_empresas (cnpj);
-- O robô procura a última carga e marca sumiço por cadastro + data.
create index if not exists sancoes_empresas_carga_idx on public.sancoes_empresas (cadastro, data_carga);

-- atualizado_em no servidor (o upsert do robô não manda a coluna).
create or replace function public.sancoes_empresas_tocar() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists sancoes_empresas_tocar on public.sancoes_empresas;
create trigger sancoes_empresas_tocar before update on public.sancoes_empresas
  for each row execute function public.sancoes_empresas_tocar();
revoke all on function public.sancoes_empresas_tocar() from public, anon, authenticated;

alter table public.sancoes_empresas enable row level security;
revoke all on public.sancoes_empresas from anon, authenticated;
grant select on public.sancoes_empresas to authenticated;
revoke delete, truncate on public.sancoes_empresas from service_role;
grant select, insert, update on public.sancoes_empresas to service_role;

drop policy if exists sancoes_empresas_select_autenticado on public.sancoes_empresas;
create policy sancoes_empresas_select_autenticado on public.sancoes_empresas
  for select to authenticated using (true);
-- Sem policy de escrita: só service_role (bypassrls) grava. Sem delete para ninguém (histórico).

commit;
