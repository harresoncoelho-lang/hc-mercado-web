-- Ampliação do dossiê operacional. Executar após operacao_licitacoes.sql.
-- A migração é aditiva: preserva processos, prazos e empenhos existentes.
begin;

alter table public.operacao_processos add column if not exists sistema text;
alter table public.operacao_processos add column if not exists uasg text;
alter table public.operacao_processos add column if not exists situacao_resultado text not null default 'nao_apurado';
alter table public.operacao_processos add column if not exists valor_homologado numeric(15,2);
alter table public.operacao_processos add column if not exists fonte_resultado text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'operacao_processos_resultado_valido') then
    alter table public.operacao_processos add constraint operacao_processos_resultado_valido
      check (situacao_resultado in ('nao_apurado','nao_participou','em_disputa','sem_vitoria','vitoria_parcial','vitoria_total','revogado_anulado'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'operacao_processos_valor_homologado_valido') then
    alter table public.operacao_processos add constraint operacao_processos_valor_homologado_valido
      check (valor_homologado is null or valor_homologado >= 0);
  end if;
end $$;

create unique index if not exists operacao_processos_id_org_idx on public.operacao_processos (id, organizacao_id);

create table if not exists public.operacao_itens_resultado (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null,
  processo_id uuid not null,
  identificador text not null,
  tipo text not null default 'item' check (tipo in ('item','lote')),
  descricao text,
  situacao text not null default 'pendente' check (situacao in ('pendente','ganho','perdido','desclassificado','inabilitado','nao_disputado','cancelado')),
  quantidade numeric(15,3) check (quantidade is null or quantidade >= 0),
  valor_proposta numeric(15,2) check (valor_proposta is null or valor_proposta >= 0),
  valor_homologado numeric(15,2) check (valor_homologado is null or (valor_homologado >= 0 and situacao = 'ganho')),
  motivo text,
  fonte_oficial text,
  atualizado_em timestamptz not null default now(),
  unique (processo_id, tipo, identificador),
  foreign key (processo_id, organizacao_id) references public.operacao_processos(id, organizacao_id) on delete cascade
);
create index if not exists operacao_itens_resultado_processo_idx on public.operacao_itens_resultado (processo_id, identificador);

create table if not exists public.operacao_ocorrencias (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null,
  processo_id uuid not null,
  ocorrido_em timestamptz not null,
  categoria text not null default 'registro' check (categoria in ('registro','sessao','chat','diligencia','recurso','resultado','contrato','execucao')),
  descricao text not null,
  fonte_oficial text,
  criado_em timestamptz not null default now(),
  foreign key (processo_id, organizacao_id) references public.operacao_processos(id, organizacao_id) on delete cascade
);
create index if not exists operacao_ocorrencias_processo_data_idx on public.operacao_ocorrencias (processo_id, ocorrido_em desc);

create table if not exists public.operacao_contratos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null,
  processo_id uuid not null,
  numero text not null,
  assinado_em date,
  vigencia_inicio date,
  vigencia_fim date,
  valor numeric(15,2) check (valor is null or valor >= 0),
  situacao text not null default 'a_assinar' check (situacao in ('a_assinar','vigente','encerrado','rescindido')),
  observacoes text,
  criado_em timestamptz not null default now(),
  unique (processo_id, numero),
  foreign key (processo_id, organizacao_id) references public.operacao_processos(id, organizacao_id) on delete cascade
);
create index if not exists operacao_contratos_processo_idx on public.operacao_contratos (processo_id);

-- O bucket privado operacao-documentos já existe. A policy existente valida
-- o UUID da organização no primeiro segmento do caminho, também para anexos.
create table if not exists public.operacao_anexos_processo (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null,
  processo_id uuid not null,
  tipo text not null check (tipo in ('edital','proposta','habilitacao','homologacao','contrato','empenho','ata','outro')),
  titulo text not null,
  referencia_numero text,
  arquivo_caminho text not null,
  arquivo_nome text not null,
  criado_em timestamptz not null default now(),
  foreign key (processo_id, organizacao_id) references public.operacao_processos(id, organizacao_id) on delete cascade
);
create index if not exists operacao_anexos_processo_idx on public.operacao_anexos_processo (processo_id, criado_em desc);

alter table public.operacao_itens_resultado enable row level security;
alter table public.operacao_ocorrencias enable row level security;
alter table public.operacao_contratos enable row level security;
alter table public.operacao_anexos_processo enable row level security;

grant select, insert, update, delete on public.operacao_itens_resultado to authenticated;
grant select, insert, update, delete on public.operacao_ocorrencias to authenticated;
grant select, insert, update, delete on public.operacao_contratos to authenticated;
grant select, insert, update, delete on public.operacao_anexos_processo to authenticated;

drop policy if exists operacao_itens_da_org on public.operacao_itens_resultado;
drop policy if exists operacao_ocorrencias_da_org on public.operacao_ocorrencias;
drop policy if exists operacao_contratos_da_org on public.operacao_contratos;
drop policy if exists operacao_anexos_da_org on public.operacao_anexos_processo;
create policy operacao_itens_da_org on public.operacao_itens_resultado for all
  using (public.eh_membro_operacao(organizacao_id)) with check (public.eh_membro_operacao(organizacao_id));
create policy operacao_ocorrencias_da_org on public.operacao_ocorrencias for all
  using (public.eh_membro_operacao(organizacao_id)) with check (public.eh_membro_operacao(organizacao_id));
create policy operacao_contratos_da_org on public.operacao_contratos for all
  using (public.eh_membro_operacao(organizacao_id)) with check (public.eh_membro_operacao(organizacao_id));
create policy operacao_anexos_da_org on public.operacao_anexos_processo for all
  using (public.eh_membro_operacao(organizacao_id))
  with check (public.eh_membro_operacao(organizacao_id) and split_part(arquivo_caminho, '/', 1) = organizacao_id::text);
commit;
