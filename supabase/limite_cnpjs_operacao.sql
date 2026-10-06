-- LicitaPlena: limite de empresas ativas por cliente.
-- Execute no SQL Editor depois de operacao_licitacoes.sql.
-- Clientes têm três empresas por padrão; apenas admins com role=owner
-- têm cota ilimitada. Exceções de clientes ficam entre 1 e 3.

create table if not exists public.operacao_limites_cnpj (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  limite integer not null check (limite between 1 and 3),
  atualizado_em timestamptz not null default now()
);
alter table public.operacao_limites_cnpj enable row level security;
revoke all on public.operacao_limites_cnpj from anon, authenticated;

-- O schema real de admins identifica o usuário por e-mail (não há admins.id).
-- A comparação com auth.users fica somente no servidor, nunca no navegador.
create or replace function public.eh_owner_admin_operacao(p_usuario_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from auth.users u
      join public.admins a on lower(a.email) = lower(u.email)
    where u.id = p_usuario_id and a.role = 'owner'
  );
$$;
revoke all on function public.eh_owner_admin_operacao(uuid) from public, anon, authenticated;

create or replace function public.limite_cnpjs_operacao()
returns integer
language plpgsql stable security definer set search_path = public as $$
declare
  v_usuario uuid := auth.uid();
  v_limite integer;
begin
  if v_usuario is null then raise exception 'Sessão inválida'; end if;
  if public.eh_owner_admin_operacao(v_usuario) then
    return null; -- NULL representa cota ilimitada somente para o owner administrativo.
  end if;
  select limite into v_limite from public.operacao_limites_cnpj where usuario_id = v_usuario;
  return coalesce(v_limite, 3);
end;
$$;
revoke all on function public.limite_cnpjs_operacao() from public, anon;
grant execute on function public.limite_cnpjs_operacao() to authenticated;

create or replace function public.consultar_limite_cnpjs_cliente(p_usuario_id uuid)
returns integer
language plpgsql stable security definer set search_path = public as $$
declare
  v_limite integer;
begin
  if not public.eh_owner_admin_operacao(auth.uid()) then
    raise exception 'Apenas o proprietário administrativo pode configurar cotas';
  end if;
  if public.eh_owner_admin_operacao(p_usuario_id) then
    return null;
  end if;
  select limite into v_limite from public.operacao_limites_cnpj where usuario_id = p_usuario_id;
  return coalesce(v_limite, 3);
end;
$$;
revoke all on function public.consultar_limite_cnpjs_cliente(uuid) from public, anon;
grant execute on function public.consultar_limite_cnpjs_cliente(uuid) to authenticated;

create or replace function public.configurar_limite_cnpjs_cliente(p_usuario_id uuid, p_limite integer)
returns integer
language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_owner_admin_operacao(auth.uid()) then
    raise exception 'Apenas o proprietário administrativo pode configurar cotas';
  end if;
  if p_limite is null or p_limite not between 1 and 3 then
    raise exception 'O limite de clientes deve ser de 1 a 3 CNPJs';
  end if;
  if not exists (select 1 from public.clientes where id = p_usuario_id) then
    raise exception 'Cliente não encontrado';
  end if;
  if public.eh_owner_admin_operacao(p_usuario_id) then
    raise exception 'O proprietário administrativo tem cota ilimitada';
  end if;
  insert into public.operacao_limites_cnpj (usuario_id, limite, atualizado_em)
    values (p_usuario_id, p_limite, now())
    on conflict (usuario_id) do update set limite = excluded.limite, atualizado_em = now();
  return p_limite;
end;
$$;
revoke all on function public.configurar_limite_cnpjs_cliente(uuid, integer) from public, anon;
grant execute on function public.configurar_limite_cnpjs_cliente(uuid, integer) to authenticated;

create or replace function public.verificar_limite_cnpjs_operacao()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_limite integer;
  v_total integer;
begin
  if not new.ativo then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.ativo and old.organizacao_id = new.organizacao_id then
      return new;
    end if;
  end if;
  -- O bloqueio na organização serializa dois cadastros simultâneos.
  select owner_id into v_owner from public.operacao_organizacoes
    where id = new.organizacao_id for update;
  if v_owner is null then raise exception 'Organização não encontrada'; end if;
  if public.eh_owner_admin_operacao(v_owner) then
    return new;
  end if;
  select coalesce((select limite from public.operacao_limites_cnpj where usuario_id = v_owner), 3)
    into v_limite;
  select count(*) into v_total from public.operacao_empresas
    where organizacao_id = new.organizacao_id and ativo = true;
  if v_total >= v_limite then
    raise exception 'Limite de % CNPJs ativos atingido para esta conta', v_limite
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists operacao_empresas_limite_cnpjs on public.operacao_empresas;
create trigger operacao_empresas_limite_cnpjs
  before insert or update of ativo, organizacao_id on public.operacao_empresas
  for each row execute function public.verificar_limite_cnpjs_operacao();
