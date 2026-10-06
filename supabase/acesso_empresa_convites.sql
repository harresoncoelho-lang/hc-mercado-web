-- Acesso de colaboradores a uma única empresa da Central Operacional.
-- Execute após operacao_licitacoes.sql, operacao_acompanhamento.sql e
-- limite_cnpjs_operacao.sql. Nenhum convite existente é enviado por esta migração.
begin;

alter table public.operacao_membros add column if not exists empresa_id uuid;
create unique index if not exists operacao_empresas_id_org_idx
  on public.operacao_empresas (id, organizacao_id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'operacao_membros_empresa_org_fk') then
    alter table public.operacao_membros add constraint operacao_membros_empresa_org_fk
      foreign key (empresa_id, organizacao_id)
      references public.operacao_empresas(id, organizacao_id) on delete cascade;
  end if;
end $$;

-- A função antiga passa a representar somente acesso à organização inteira.
-- Um colaborador com empresa_id não herda permissão para outras empresas.
create or replace function public.eh_membro_operacao(p_organizacao_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.operacao_membros m
    where m.organizacao_id = p_organizacao_id and m.usuario_id = auth.uid()
      and m.empresa_id is null);
$$;
create or replace function public.tem_vinculo_operacao(p_organizacao_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.operacao_membros m
    where m.organizacao_id = p_organizacao_id and m.usuario_id = auth.uid());
$$;
create or replace function public.pode_acessar_empresa_operacao(p_org uuid, p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.operacao_empresas e
    join public.operacao_membros m on m.organizacao_id = e.organizacao_id
    where e.id = p_empresa and e.organizacao_id = p_org and m.usuario_id = auth.uid()
      and (m.empresa_id is null or m.empresa_id = e.id));
$$;
create or replace function public.pode_acessar_processo_operacao(p_org uuid, p_processo uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.operacao_processos p
    where p.id = p_processo and p.organizacao_id = p_org
      and public.pode_acessar_empresa_operacao(p.organizacao_id, p.empresa_id));
$$;
create or replace function public.acesso_arquivo_operacao(p_caminho text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  partes text[] := string_to_array(p_caminho, '/');
begin
  if array_length(partes, 1) < 3 then return false; end if;
  return public.pode_acessar_empresa_operacao(partes[1]::uuid, partes[2]::uuid);
exception when invalid_text_representation then return false;
end;
$$;
revoke all on function public.tem_vinculo_operacao(uuid) from public, anon;
revoke all on function public.pode_acessar_empresa_operacao(uuid,uuid) from public, anon;
revoke all on function public.pode_acessar_processo_operacao(uuid,uuid) from public, anon;
revoke all on function public.acesso_arquivo_operacao(text) from public, anon;
grant execute on function public.tem_vinculo_operacao(uuid),
  public.pode_acessar_empresa_operacao(uuid,uuid),
  public.pode_acessar_processo_operacao(uuid,uuid),
  public.acesso_arquivo_operacao(text) to authenticated;

-- O primeiro acesso de uma colaboradora usa a organização já compartilhada,
-- sem criar outra empresa nem consumir uma vaga de CNPJ do titular.
create or replace function public.bootstrap_operacao()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_usuario uuid := auth.uid(); v_org uuid; v_nome text; v_cnpj text;
begin
  if v_usuario is null then raise exception 'Sessão inválida'; end if;
  if not exists (select 1 from public.clientes c
    where c.id = v_usuario and c.status = 'aprovado') then
    raise exception 'Cadastro sem acesso ativo';
  end if;
  select id into v_org from public.operacao_organizacoes where owner_id = v_usuario;
  if v_org is not null then return v_org; end if;
  select organizacao_id into v_org from public.operacao_membros
    where usuario_id = v_usuario order by criado_em limit 1;
  if v_org is not null then return v_org; end if;
  if exists (select 1 from public.operacao_convites_empresa i
    join auth.users u on lower(u.email) = i.email
    where u.id = v_usuario and i.aceito_em is null and i.revogado_em is null
      and i.expira_em > now()) then
    raise exception 'Aceite o convite recebido antes de abrir a Central Operacional';
  end if;
  select coalesce(nullif(empresa, ''), nullif(nome, ''), 'Minha operação'), cnpj
    into v_nome, v_cnpj from public.clientes where id = v_usuario;
  insert into public.operacao_organizacoes (nome, owner_id)
    values (coalesce(v_nome, 'Minha operação'), v_usuario) returning id into v_org;
  insert into public.operacao_membros (organizacao_id, usuario_id, papel)
    values (v_org, v_usuario, 'gestor');
  insert into public.operacao_empresas (organizacao_id, razao_social, cnpj)
    values (v_org, coalesce(v_nome, 'Minha empresa'), nullif(v_cnpj, ''));
  return v_org;
end;
$$;

create or replace function public.meu_acesso_operacao()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('organizacao_id', m.organizacao_id,
    'empresa_id', m.empresa_id, 'papel', m.papel)
    from public.operacao_membros m where m.usuario_id = auth.uid()
    order by (m.empresa_id is null) desc, m.criado_em limit 1), '{}'::jsonb);
$$;
revoke all on function public.meu_acesso_operacao() from public, anon;
grant execute on function public.meu_acesso_operacao() to authenticated;

-- Regras específicas por empresa substituem as permissões amplas da fase 1.
drop policy if exists operacao_organizacoes_proprias on public.operacao_organizacoes;
drop policy if exists operacao_membros_da_org on public.operacao_membros;
drop policy if exists operacao_empresas_da_org on public.operacao_empresas;
drop policy if exists operacao_tipos_da_org on public.operacao_tipos_documento;
drop policy if exists operacao_documentos_da_org on public.operacao_documentos;
drop policy if exists operacao_renovacoes_da_org on public.operacao_renovacoes_documento;
drop policy if exists operacao_agenda_da_org on public.operacao_agenda;
drop policy if exists operacao_processos_da_org on public.operacao_processos;
drop policy if exists operacao_prazos_processo_da_org on public.operacao_prazos_processo;
drop policy if exists operacao_empenhos_da_org on public.operacao_empenhos;
drop policy if exists operacao_empresas_leitura on public.operacao_empresas;
drop policy if exists operacao_empresas_escrita on public.operacao_empresas;
drop policy if exists operacao_tipos_leitura on public.operacao_tipos_documento;
drop policy if exists operacao_tipos_escrita on public.operacao_tipos_documento;
drop policy if exists operacao_documentos_da_empresa on public.operacao_documentos;
drop policy if exists operacao_renovacoes_da_empresa on public.operacao_renovacoes_documento;
drop policy if exists operacao_agenda_da_empresa on public.operacao_agenda;
drop policy if exists operacao_processos_da_empresa on public.operacao_processos;
drop policy if exists operacao_prazos_da_empresa on public.operacao_prazos_processo;
drop policy if exists operacao_empenhos_da_empresa on public.operacao_empenhos;
create policy operacao_organizacoes_proprias on public.operacao_organizacoes
  for select using (public.tem_vinculo_operacao(id));
create policy operacao_membros_da_org on public.operacao_membros
  for select using (usuario_id = auth.uid() or public.eh_membro_operacao(organizacao_id));
create policy operacao_empresas_leitura on public.operacao_empresas
  for select using (public.pode_acessar_empresa_operacao(organizacao_id, id));
create policy operacao_empresas_escrita on public.operacao_empresas
  for all using (public.eh_membro_operacao(organizacao_id))
  with check (public.eh_membro_operacao(organizacao_id));
create policy operacao_tipos_leitura on public.operacao_tipos_documento
  for select using (organizacao_id is null or public.eh_membro_operacao(organizacao_id));
create policy operacao_tipos_escrita on public.operacao_tipos_documento
  for all using (organizacao_id is not null and public.eh_membro_operacao(organizacao_id))
  with check (organizacao_id is not null and public.eh_membro_operacao(organizacao_id));
create policy operacao_documentos_da_empresa on public.operacao_documentos
  for all using (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id))
  with check (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));
create policy operacao_renovacoes_da_empresa on public.operacao_renovacoes_documento
  for all using (exists (select 1 from public.operacao_documentos d where d.id = documento_id
    and public.pode_acessar_empresa_operacao(d.organizacao_id, d.empresa_id)))
  with check (exists (select 1 from public.operacao_documentos d where d.id = documento_id
    and public.pode_acessar_empresa_operacao(d.organizacao_id, d.empresa_id)));
create policy operacao_agenda_da_empresa on public.operacao_agenda
  for all using (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id))
  with check (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));
create policy operacao_processos_da_empresa on public.operacao_processos
  for all using (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id))
  with check (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));
create policy operacao_prazos_da_empresa on public.operacao_prazos_processo
  for all using (public.pode_acessar_processo_operacao(organizacao_id, processo_id))
  with check (public.pode_acessar_processo_operacao(organizacao_id, processo_id));
create policy operacao_empenhos_da_empresa on public.operacao_empenhos
  for all using (public.pode_acessar_processo_operacao(organizacao_id, processo_id))
  with check (public.pode_acessar_processo_operacao(organizacao_id, processo_id));

drop policy if exists operacao_itens_da_org on public.operacao_itens_resultado;
drop policy if exists operacao_ocorrencias_da_org on public.operacao_ocorrencias;
drop policy if exists operacao_contratos_da_org on public.operacao_contratos;
drop policy if exists operacao_anexos_da_org on public.operacao_anexos_processo;
drop policy if exists operacao_itens_da_empresa on public.operacao_itens_resultado;
drop policy if exists operacao_ocorrencias_da_empresa on public.operacao_ocorrencias;
drop policy if exists operacao_contratos_da_empresa on public.operacao_contratos;
drop policy if exists operacao_anexos_da_empresa on public.operacao_anexos_processo;
create policy operacao_itens_da_empresa on public.operacao_itens_resultado for all
  using (public.pode_acessar_processo_operacao(organizacao_id, processo_id))
  with check (public.pode_acessar_processo_operacao(organizacao_id, processo_id));
create policy operacao_ocorrencias_da_empresa on public.operacao_ocorrencias for all
  using (public.pode_acessar_processo_operacao(organizacao_id, processo_id))
  with check (public.pode_acessar_processo_operacao(organizacao_id, processo_id));
create policy operacao_contratos_da_empresa on public.operacao_contratos for all
  using (public.pode_acessar_processo_operacao(organizacao_id, processo_id))
  with check (public.pode_acessar_processo_operacao(organizacao_id, processo_id));
create policy operacao_anexos_da_empresa on public.operacao_anexos_processo for all
  using (public.pode_acessar_processo_operacao(organizacao_id, processo_id))
  with check (public.pode_acessar_processo_operacao(organizacao_id, processo_id)
    and public.acesso_arquivo_operacao(arquivo_caminho));

drop policy if exists operacao_arquivos_leitura on storage.objects;
drop policy if exists operacao_arquivos_envio on storage.objects;
drop policy if exists operacao_arquivos_atualizacao on storage.objects;
drop policy if exists operacao_arquivos_exclusao on storage.objects;
create policy operacao_arquivos_leitura on storage.objects for select
  using (bucket_id = 'operacao-documentos' and public.acesso_arquivo_operacao(name));
create policy operacao_arquivos_envio on storage.objects for insert
  with check (bucket_id = 'operacao-documentos' and public.acesso_arquivo_operacao(name));
create policy operacao_arquivos_atualizacao on storage.objects for update
  using (bucket_id = 'operacao-documentos' and public.acesso_arquivo_operacao(name))
  with check (bucket_id = 'operacao-documentos' and public.acesso_arquivo_operacao(name));
create policy operacao_arquivos_exclusao on storage.objects for delete
  using (bucket_id = 'operacao-documentos' and public.acesso_arquivo_operacao(name));

create table if not exists public.operacao_convites_empresa (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references public.operacao_organizacoes(id) on delete cascade,
  empresa_id uuid not null,
  email text not null,
  nome text not null,
  token uuid not null unique default gen_random_uuid(),
  expira_em timestamptz not null default now() + interval '7 days',
  aceito_em timestamptz,
  revogado_em timestamptz,
  criado_por uuid not null references auth.users(id),
  criado_em timestamptz not null default now(),
  foreign key (empresa_id, organizacao_id)
    references public.operacao_empresas(id, organizacao_id) on delete cascade
);
alter table public.operacao_convites_empresa enable row level security;
revoke all on public.operacao_convites_empresa from anon, authenticated;

-- A policy legada permite atualizar a própria linha de clientes. Impede que
-- isso seja usado para aprovar uma conta depois de um acesso revogado.
create or replace function public.proteger_status_cliente_operacao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.status is not distinct from old.status then return new; end if;
  end if;
  if auth.uid() is not null and auth.uid() = new.id
    and new.status = 'aprovado'
    and not public.eh_owner_admin_operacao(auth.uid())
    and not exists (select 1 from public.operacao_membros m
      where m.usuario_id = auth.uid() and m.empresa_id is not null) then
    raise exception 'A aprovação do cadastro depende do administrador';
  end if;
  return new;
end;
$$;
drop trigger if exists proteger_status_cliente_operacao on public.clientes;
create trigger proteger_status_cliente_operacao before insert or update on public.clientes
  for each row execute function public.proteger_status_cliente_operacao();

create or replace function public.criar_convite_empresa_operacao(
  p_empresa_id uuid, p_email text, p_nome text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_convite public.operacao_convites_empresa; v_org uuid;
begin
  if not public.eh_owner_admin_operacao(auth.uid()) then raise exception 'Acesso restrito ao proprietário administrativo'; end if;
  if p_email is null or p_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'E-mail inválido'; end if;
  if length(trim(coalesce(p_nome,''))) < 2 then raise exception 'Informe o nome da pessoa'; end if;
  select e.organizacao_id into v_org from public.operacao_empresas e
    where e.id = p_empresa_id and e.ativo = true;
  if v_org is null then raise exception 'Empresa não encontrada'; end if;
  -- Não reaproveita convite para outra empresa e não altera acesso sem aviso.
  insert into public.operacao_convites_empresa (organizacao_id, empresa_id, email, nome, criado_por)
    values (v_org, p_empresa_id, lower(trim(p_email)), trim(p_nome), auth.uid())
    returning * into v_convite;
  return jsonb_build_object('id', v_convite.id, 'token', v_convite.token,
    'expira_em', v_convite.expira_em);
end;
$$;
create or replace function public.aceitar_convite_empresa_operacao(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_convite public.operacao_convites_empresa; v_usuario uuid := auth.uid();
  v_email text; v_empresa public.operacao_empresas;
begin
  if v_usuario is null then raise exception 'Faça login para aceitar o convite'; end if;
  select * into v_convite from public.operacao_convites_empresa
    where token = p_token for update;
  if not found or v_convite.revogado_em is not null or v_convite.expira_em <= now()
    or v_convite.aceito_em is not null then raise exception 'Convite inválido ou expirado'; end if;
  select lower(email) into v_email from auth.users where id = v_usuario;
  if v_email is distinct from v_convite.email then raise exception 'Entre com o e-mail indicado no convite'; end if;
  if exists (select 1 from public.operacao_organizacoes where owner_id = v_usuario)
    or exists (select 1 from public.operacao_membros where usuario_id = v_usuario) then
    raise exception 'Esta conta já gerencia uma operação. Use um e-mail próprio para este acesso restrito';
  end if;
  select * into v_empresa from public.operacao_empresas where id = v_convite.empresa_id and ativo = true;
  if not found then raise exception 'Empresa indisponível'; end if;
  insert into public.operacao_membros (organizacao_id, usuario_id, papel, empresa_id)
    values (v_convite.organizacao_id, v_usuario, 'operador', v_convite.empresa_id);
  update public.clientes set status = 'aprovado', nome = v_convite.nome,
    empresa = v_empresa.razao_social, cnpj = v_empresa.cnpj
    where id = v_usuario;
  if not found then raise exception 'Cadastro do usuário ainda não está disponível'; end if;
  update public.operacao_convites_empresa set aceito_em = now() where id = v_convite.id;
  return jsonb_build_object('empresa', v_empresa.razao_social, 'empresa_id', v_empresa.id);
end;
$$;
create or replace function public.listar_empresas_convite_operacao()
returns table(id uuid, razao_social text, cnpj text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_owner_admin_operacao(auth.uid()) then raise exception 'Acesso restrito ao proprietário administrativo'; end if;
  return query select e.id, e.razao_social, e.cnpj from public.operacao_empresas e
    where e.ativo = true order by e.razao_social;
end;
$$;
create or replace function public.listar_convites_empresa_operacao()
returns table(id uuid, email text, nome text, empresa text, expira_em timestamptz,
  aceito_em timestamptz, revogado_em timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_owner_admin_operacao(auth.uid()) then raise exception 'Acesso restrito ao proprietário administrativo'; end if;
  return query select c.id, c.email, c.nome, e.razao_social, c.expira_em, c.aceito_em, c.revogado_em
    from public.operacao_convites_empresa c join public.operacao_empresas e on e.id = c.empresa_id
    order by c.criado_em desc limit 100;
end;
$$;
create or replace function public.revogar_convite_empresa_operacao(p_convite_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_owner_admin_operacao(auth.uid()) then raise exception 'Acesso restrito ao proprietário administrativo'; end if;
  update public.operacao_convites_empresa set revogado_em = now()
    where id = p_convite_id and aceito_em is null and revogado_em is null;
  return found;
end;
$$;
create or replace function public.listar_acessos_empresa_operacao()
returns table(usuario_id uuid, email text, nome text, empresa text, empresa_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_owner_admin_operacao(auth.uid()) then raise exception 'Acesso restrito ao proprietário administrativo'; end if;
  return query select m.usuario_id, u.email::text, c.nome, e.razao_social, e.id
    from public.operacao_membros m join public.operacao_empresas e on e.id = m.empresa_id
    join auth.users u on u.id = m.usuario_id
    left join public.clientes c on c.id = m.usuario_id
    where m.empresa_id is not null order by e.razao_social, u.email;
end;
$$;
create or replace function public.revogar_acesso_empresa_operacao(p_usuario_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_owner_admin_operacao(auth.uid()) then raise exception 'Acesso restrito ao proprietário administrativo'; end if;
  delete from public.operacao_membros where usuario_id = p_usuario_id and empresa_id is not null;
  if not found then return false; end if;
  -- Além da RLS, a guarda de login do site rejeita a conta imediatamente.
  update public.clientes set status = 'rejeitado' where id = p_usuario_id;
  return true;
end;
$$;
revoke all on function public.criar_convite_empresa_operacao(uuid,text,text),
  public.aceitar_convite_empresa_operacao(uuid),
  public.listar_empresas_convite_operacao(),
  public.listar_convites_empresa_operacao(),
  public.revogar_convite_empresa_operacao(uuid),
  public.listar_acessos_empresa_operacao(),
  public.revogar_acesso_empresa_operacao(uuid) from public, anon;
grant execute on function public.criar_convite_empresa_operacao(uuid,text,text),
  public.aceitar_convite_empresa_operacao(uuid),
  public.listar_empresas_convite_operacao(),
  public.listar_convites_empresa_operacao(),
  public.revogar_convite_empresa_operacao(uuid),
  public.listar_acessos_empresa_operacao(),
  public.revogar_acesso_empresa_operacao(uuid) to authenticated;
commit;
