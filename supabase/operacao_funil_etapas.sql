-- Funil com etapas editáveis por organização (espec. dezembro, seção 1).
-- Idempotente; rodar no SQL Editor depois do 01-aplicar.sql e de
-- operacao_itens_proposta.sql. Só acrescenta: operacao_processos.status segue
-- valendo; etapa_id é opcional e, sem etapas, o painel cai em KANBAN_COLUNAS.
begin;

create table if not exists public.operacao_funil_etapas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references public.operacao_organizacoes(id) on delete cascade,
  nome text not null check (nome = btrim(nome) and length(nome) between 1 and 40),
  ordem smallint not null check (ordem between 0 and 99),
  -- Check de operacao_processos.status (operacao_licitacoes.sql), sem 'arquivado'.
  status_sistema text not null check (status_sistema in ('triagem','preparacao','proposta_enviada','sessao','habilitacao','recurso','homologado','contratado','perdido')),
  chave_sistema text check (chave_sistema in ('interesse','participando','ganhei','perdi')),
  cor text not null default '#64748b' check (cor ~ '^#[0-9a-fA-F]{6}$'),
  criado_em timestamptz not null default now(),
  unique (id, organizacao_id),
  constraint operacao_funil_etapas_protegida_coerente check (case chave_sistema
    when 'interesse' then status_sistema = 'triagem'
    when 'participando' then status_sistema = 'preparacao'
    when 'ganhei' then status_sistema = 'homologado'
    when 'perdi' then status_sistema = 'perdido'
    else true end)
);
create unique index if not exists operacao_funil_etapas_chave_idx
  on public.operacao_funil_etapas (organizacao_id, chave_sistema) where chave_sistema is not null;
create unique index if not exists operacao_funil_etapas_nome_idx
  on public.operacao_funil_etapas (organizacao_id, lower(nome));

alter table public.operacao_processos add column if not exists etapa_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.operacao_processos'::regclass and conname = 'operacao_processos_etapa_fk') then
    alter table public.operacao_processos add constraint operacao_processos_etapa_fk
      foreign key (etapa_id, organizacao_id) references public.operacao_funil_etapas(id, organizacao_id)
      on delete set null (etapa_id);
  end if;
end $$;
create index if not exists operacao_processos_etapa_idx on public.operacao_processos (etapa_id) where etapa_id is not null;

-- Protegidas: não saem e só mudam nome, cor e ordem. Personalizadas não trocam de
-- organização nem viram protegidas; "conta como" só muda sem processo na etapa.
create or replace function public.operacao_funil_etapas_proteger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('operacao_funil_etapas:' || new.organizacao_id::text));
    if (select count(*) from public.operacao_funil_etapas where organizacao_id = new.organizacao_id) >= 20 then
      raise exception 'Limite de 20 etapas no funil' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    -- Exclusão em cascata da organização precisa passar.
    if old.chave_sistema is not null and exists (select 1 from public.operacao_organizacoes where id = old.organizacao_id) then
      raise exception 'Etapa do sistema não pode ser excluída' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if new.id is distinct from old.id or new.organizacao_id is distinct from old.organizacao_id
     or new.chave_sistema is distinct from old.chave_sistema or new.criado_em is distinct from old.criado_em then
    raise exception 'Só nome, cor, ordem e estágio da etapa podem mudar' using errcode = 'P0001';
  end if;
  if new.status_sistema is distinct from old.status_sistema then
    if old.chave_sistema is not null then
      raise exception 'Etapa do sistema só muda nome, cor e ordem' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.operacao_processos where etapa_id = old.id) then
      raise exception 'Etapa em uso: mova os processos antes de mudar o estágio' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists operacao_funil_etapas_proteger on public.operacao_funil_etapas;
create trigger operacao_funil_etapas_proteger before insert or update or delete on public.operacao_funil_etapas
  for each row execute function public.operacao_funil_etapas_proteger();

-- Status mudado por fora do funil (robô, dossiê) solta a etapa; etapa nova tem
-- de ser da mesma organização e do mesmo estágio do status.
create or replace function public.operacao_processos_etapa_coerente()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if new.etapa_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.etapa_id is not distinct from old.etapa_id then
    new.etapa_id := null;
    return new;
  end if;
  select status_sistema into v_status from public.operacao_funil_etapas
   where id = new.etapa_id and organizacao_id = new.organizacao_id;
  if v_status is null then
    raise exception 'Etapa indisponível para esta organização' using errcode = '23503';
  end if;
  if v_status <> new.status then
    raise exception 'Etapa incompatível com o status do processo' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists operacao_processos_etapa_coerente on public.operacao_processos;
create trigger operacao_processos_etapa_coerente before insert or update of status, etapa_id, organizacao_id on public.operacao_processos
  for each row execute function public.operacao_processos_etapa_coerente();

revoke all on function public.operacao_funil_etapas_proteger(), public.operacao_processos_etapa_coerente()
  from public, anon, authenticated, service_role;

-- Leitura cria as 4 protegidas na primeira vez; vale também para papel leitura.
create or replace function public.garantir_etapas_funil(p_org uuid)
returns setof public.operacao_funil_etapas language plpgsql security definer set search_path = '' as $$
begin
  if p_org is null or not public.tem_vinculo_operacao(p_org) then
    raise exception 'Acesso não autorizado' using errcode = '42501';
  end if;
  insert into public.operacao_funil_etapas (organizacao_id, nome, ordem, status_sistema, chave_sistema, cor)
  select p_org, v.nome, v.ordem, v.status, v.chave, v.cor
    from (values ('Tenho interesse', 0, 'triagem', 'interesse', '#64748b'),
                 ('Participando', 1, 'preparacao', 'participando', '#2563eb'),
                 ('Ganhei', 2, 'homologado', 'ganhei', '#16a34a'),
                 ('Perdi', 3, 'perdido', 'perdi', '#dc2626')) as v(nome, ordem, status, chave, cor)
   where not exists (select 1 from public.operacao_funil_etapas e where e.organizacao_id = p_org and e.chave_sistema = v.chave)
  on conflict do nothing;
  -- on conflict cobre corrida e nome já usado por etapa personalizada: o segundo caso precisa de ação do usuário.
  if (select count(*) from public.operacao_funil_etapas where organizacao_id = p_org and chave_sistema is not null) <> 4 then
    raise exception 'Renomeie a etapa personalizada com nome de etapa do sistema' using errcode = '23505';
  end if;
  return query select * from public.operacao_funil_etapas where organizacao_id = p_org order by ordem, criado_em, id;
end $$;

-- Invoker: a RLS de escrita vale; a lista tem de trazer todas as etapas, uma vez cada.
create or replace function public.reordenar_etapas_funil(p_org uuid, p_ids uuid[])
returns setof public.operacao_funil_etapas language plpgsql security invoker set search_path = '' as $$
begin
  if p_org is null or not public.pode_escrever_org_operacao(p_org) then
    raise exception 'Acesso não autorizado' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('operacao_funil_etapas:' || p_org::text));
  if p_ids is null
     or pg_catalog.cardinality(p_ids) <> (select count(distinct x) from pg_catalog.unnest(p_ids) as x)
     or pg_catalog.cardinality(p_ids) <> (select count(*) from public.operacao_funil_etapas where organizacao_id = p_org)
     or exists (select 1 from pg_catalog.unnest(p_ids) as x
                 where not exists (select 1 from public.operacao_funil_etapas e where e.id = x and e.organizacao_id = p_org)) then
    raise exception 'Envie todas as etapas do funil, sem repetir' using errcode = '22023';
  end if;
  update public.operacao_funil_etapas e set ordem = o.n - 1
    from pg_catalog.unnest(p_ids) with ordinality as o(id, n)
   where e.id = o.id and e.organizacao_id = p_org and e.ordem <> o.n - 1;
  return query select * from public.operacao_funil_etapas where organizacao_id = p_org order by ordem, criado_em, id;
end $$;

revoke all on function public.garantir_etapas_funil(uuid), public.reordenar_etapas_funil(uuid, uuid[]) from public, anon;
grant execute on function public.garantir_etapas_funil(uuid), public.reordenar_etapas_funil(uuid, uuid[]) to authenticated, service_role;

alter table public.operacao_funil_etapas enable row level security;
revoke all on public.operacao_funil_etapas from public, anon, authenticated;
grant select, insert, update, delete on public.operacao_funil_etapas to authenticated;
grant all on public.operacao_funil_etapas to service_role;
drop policy if exists operacao_funil_etapas_leitura on public.operacao_funil_etapas;
drop policy if exists operacao_funil_etapas_escrita on public.operacao_funil_etapas;
create policy operacao_funil_etapas_leitura on public.operacao_funil_etapas for select to authenticated
  using (public.tem_vinculo_operacao(organizacao_id));
create policy operacao_funil_etapas_escrita on public.operacao_funil_etapas for all to authenticated
  using (public.pode_escrever_org_operacao(organizacao_id)) with check (public.pode_escrever_org_operacao(organizacao_id));

commit;
notify pgrst, 'reload schema';
