-- LicitaPlena — Central Operacional (fase 1)
--
-- Execute no Supabase SQL Editor uma vez. Esta migração é idempotente e cria
-- a base privada para empresas, documentos, históricos e agenda operacional.
-- Nenhuma tabela abaixo é pública: cada usuário só lê empresas vinculadas à
-- própria organização.

create table if not exists public.operacao_organizacoes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now()
);

create table if not exists public.operacao_membros (
  organizacao_id uuid not null references public.operacao_organizacoes(id) on delete cascade,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  papel text not null default 'gestor' check (papel in ('gestor', 'operador', 'leitura')),
  criado_em timestamptz not null default now(),
  primary key (organizacao_id, usuario_id)
);

create table if not exists public.operacao_empresas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references public.operacao_organizacoes(id) on delete cascade,
  razao_social text not null,
  cnpj text,
  responsavel text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (organizacao_id, cnpj)
);

create table if not exists public.operacao_tipos_documento (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid references public.operacao_organizacoes(id) on delete cascade,
  nome text not null,
  personalizado boolean not null default false,
  unique (organizacao_id, nome)
);

create table if not exists public.operacao_documentos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references public.operacao_organizacoes(id) on delete cascade,
  empresa_id uuid not null references public.operacao_empresas(id) on delete cascade,
  tipo text not null,
  titulo text,
  emissao date,
  vencimento date,
  orgao_emissor text,
  responsavel text,
  observacoes text,
  arquivo_caminho text,
  arquivo_nome text,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists operacao_documentos_empresa_vencimento_idx
  on public.operacao_documentos (empresa_id, vencimento);

create table if not exists public.operacao_renovacoes_documento (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references public.operacao_documentos(id) on delete cascade,
  emissao_anterior date,
  vencimento_anterior date,
  emissao_nova date,
  vencimento_novo date,
  registrado_por uuid references auth.users(id),
  registrado_em timestamptz not null default now()
);

create table if not exists public.operacao_agenda (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references public.operacao_organizacoes(id) on delete cascade,
  empresa_id uuid references public.operacao_empresas(id) on delete cascade,
  categoria text not null check (categoria in ('sessao', 'esclarecimento', 'impugnacao', 'proposta', 'diligencia', 'recurso', 'entrega', 'vigencia', 'reajuste', 'repactuacao', 'renovacao', 'outro')),
  titulo text not null,
  vencimento timestamptz not null,
  responsavel text,
  observacoes text,
  concluido_em timestamptz,
  criado_em timestamptz not null default now()
);

create index if not exists operacao_agenda_organizacao_vencimento_idx
  on public.operacao_agenda (organizacao_id, vencimento);

-- Fase 2: cada processo é privado à organização e liga a oportunidade ao
-- trabalho real de proposta, sessão, habilitação, contrato e empenho.
create table if not exists public.operacao_processos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references public.operacao_organizacoes(id) on delete cascade,
  empresa_id uuid not null references public.operacao_empresas(id) on delete cascade,
  numero text,
  objeto text not null,
  orgao text,
  modalidade text,
  url_origem text,
  status text not null default 'triagem' check (status in ('triagem', 'preparacao', 'proposta_enviada', 'sessao', 'habilitacao', 'recurso', 'homologado', 'contratado', 'perdido', 'arquivado')),
  decisao text not null default 'em_analise' check (decisao in ('em_analise', 'participar', 'nao_participar')),
  responsavel text,
  valor_estimado numeric(15,2),
  custo_direto numeric(15,2),
  frete numeric(15,2),
  tributos_percentual numeric(7,3),
  garantia_percentual numeric(7,3),
  margem_percentual numeric(7,3),
  preco_minimo numeric(15,2),
  preco_proposta numeric(15,2),
  documentos_exigidos text[] not null default '{}',
  data_publicacao date,
  data_sessao timestamptz,
  data_resultado date,
  resultado text,
  motivo_perda text,
  observacoes text,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists operacao_processos_empresa_status_idx on public.operacao_processos (empresa_id, status);
create index if not exists operacao_processos_organizacao_sessao_idx on public.operacao_processos (organizacao_id, data_sessao);

-- Uma oportunidade marcada no boletim/Kanban deve apontar sempre para o mesmo
-- dossiê. A coluna é opcional para preservar os processos incluídos manualmente.
alter table public.operacao_processos add column if not exists origem_externa_id text;
create unique index if not exists operacao_processos_origem_externa_unica_idx
  on public.operacao_processos (organizacao_id, empresa_id, origem_externa_id)
  where origem_externa_id is not null;

create table if not exists public.operacao_prazos_processo (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references public.operacao_organizacoes(id) on delete cascade,
  processo_id uuid not null references public.operacao_processos(id) on delete cascade,
  categoria text not null check (categoria in ('esclarecimento', 'impugnacao', 'proposta', 'sessao', 'diligencia', 'recurso', 'assinatura', 'entrega', 'outro')),
  titulo text not null,
  vencimento timestamptz not null,
  responsavel text,
  concluido_em timestamptz,
  observacoes text,
  criado_em timestamptz not null default now()
);
create index if not exists operacao_prazos_processo_vencimento_idx on public.operacao_prazos_processo (processo_id, vencimento);

create table if not exists public.operacao_empenhos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references public.operacao_organizacoes(id) on delete cascade,
  processo_id uuid not null references public.operacao_processos(id) on delete cascade,
  numero text not null,
  emitido_em date,
  valor numeric(15,2) not null default 0 check (valor >= 0),
  saldo numeric(15,2) check (saldo is null or saldo >= 0),
  entrega_prevista date,
  entregue_em date,
  recebido_em date,
  pago_em date,
  status text not null default 'emitido' check (status in ('emitido', 'em_execucao', 'entregue', 'recebido', 'pago', 'cancelado')),
  observacoes text,
  criado_em timestamptz not null default now(),
  unique (processo_id, numero)
);
create index if not exists operacao_empenhos_processo_status_idx on public.operacao_empenhos (processo_id, status);

-- Função pequena e centralizada para as policies. SECURITY DEFINER evita que
-- o usuário precise ler a tabela de membros para provar que pertence a ela.
create or replace function public.eh_membro_operacao(p_organizacao_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.operacao_membros m
    where m.organizacao_id = p_organizacao_id and m.usuario_id = auth.uid()
  );
$$;

-- Cria a primeira organização e empresa a partir do cadastro já existente.
-- É chamada pelo painel no primeiro acesso e não dá privilégios além da conta
-- logada; gestores podem adicionar outras empresas depois.
create or replace function public.bootstrap_operacao()
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_usuario uuid := auth.uid();
  v_org uuid;
  v_nome text;
  v_cnpj text;
begin
  if v_usuario is null then raise exception 'Sessão inválida'; end if;
  select id into v_org from public.operacao_organizacoes where owner_id = v_usuario;
  if v_org is null then
    select coalesce(nullif(empresa, ''), nullif(nome, ''), 'Minha operação'), cnpj
      into v_nome, v_cnpj from public.clientes where id = v_usuario;
    insert into public.operacao_organizacoes (nome, owner_id)
      values (coalesce(v_nome, 'Minha operação'), v_usuario) returning id into v_org;
    insert into public.operacao_membros (organizacao_id, usuario_id, papel)
      values (v_org, v_usuario, 'gestor');
    insert into public.operacao_empresas (organizacao_id, razao_social, cnpj)
      values (v_org, coalesce(v_nome, 'Minha empresa'), nullif(v_cnpj, ''));
  end if;
  return v_org;
end;
$$;

grant execute on function public.bootstrap_operacao() to authenticated;
grant execute on function public.eh_membro_operacao(uuid) to authenticated;

alter table public.operacao_organizacoes enable row level security;
alter table public.operacao_membros enable row level security;
alter table public.operacao_empresas enable row level security;
alter table public.operacao_tipos_documento enable row level security;
alter table public.operacao_documentos enable row level security;
alter table public.operacao_renovacoes_documento enable row level security;
alter table public.operacao_agenda enable row level security;
alter table public.operacao_processos enable row level security;
alter table public.operacao_prazos_processo enable row level security;
alter table public.operacao_empenhos enable row level security;

drop policy if exists "operacao_organizacoes_proprias" on public.operacao_organizacoes;
drop policy if exists "operacao_membros_da_org" on public.operacao_membros;
drop policy if exists "operacao_empresas_da_org" on public.operacao_empresas;
drop policy if exists "operacao_tipos_da_org" on public.operacao_tipos_documento;
drop policy if exists "operacao_documentos_da_org" on public.operacao_documentos;
drop policy if exists "operacao_renovacoes_da_org" on public.operacao_renovacoes_documento;
drop policy if exists "operacao_agenda_da_org" on public.operacao_agenda;
drop policy if exists "operacao_processos_da_org" on public.operacao_processos;
drop policy if exists "operacao_prazos_processo_da_org" on public.operacao_prazos_processo;
drop policy if exists "operacao_empenhos_da_org" on public.operacao_empenhos;
create policy "operacao_organizacoes_proprias" on public.operacao_organizacoes for select using (public.eh_membro_operacao(id));
create policy "operacao_membros_da_org" on public.operacao_membros for select using (public.eh_membro_operacao(organizacao_id));
create policy "operacao_empresas_da_org" on public.operacao_empresas for all using (public.eh_membro_operacao(organizacao_id)) with check (public.eh_membro_operacao(organizacao_id));
create policy "operacao_tipos_da_org" on public.operacao_tipos_documento for all using (organizacao_id is null or public.eh_membro_operacao(organizacao_id)) with check (organizacao_id is null or public.eh_membro_operacao(organizacao_id));
create policy "operacao_documentos_da_org" on public.operacao_documentos for all using (public.eh_membro_operacao(organizacao_id)) with check (public.eh_membro_operacao(organizacao_id));
create policy "operacao_renovacoes_da_org" on public.operacao_renovacoes_documento for all using (exists (select 1 from public.operacao_documentos d where d.id = documento_id and public.eh_membro_operacao(d.organizacao_id))) with check (exists (select 1 from public.operacao_documentos d where d.id = documento_id and public.eh_membro_operacao(d.organizacao_id)));
create policy "operacao_agenda_da_org" on public.operacao_agenda for all using (public.eh_membro_operacao(organizacao_id)) with check (public.eh_membro_operacao(organizacao_id));
create policy "operacao_processos_da_org" on public.operacao_processos for all using (public.eh_membro_operacao(organizacao_id)) with check (public.eh_membro_operacao(organizacao_id));
create policy "operacao_prazos_processo_da_org" on public.operacao_prazos_processo for all using (public.eh_membro_operacao(organizacao_id)) with check (public.eh_membro_operacao(organizacao_id));
create policy "operacao_empenhos_da_org" on public.operacao_empenhos for all using (public.eh_membro_operacao(organizacao_id)) with check (public.eh_membro_operacao(organizacao_id));

-- Arquivos ficam privados; o primeiro diretório do caminho sempre é o UUID da
-- organização (ex.: org/empresa/uuid.pdf), o que a policy confere.
insert into storage.buckets (id, name, public) values ('operacao-documentos', 'operacao-documentos', false)
on conflict (id) do update set public = false;
drop policy if exists "operacao_arquivos_leitura" on storage.objects;
drop policy if exists "operacao_arquivos_envio" on storage.objects;
drop policy if exists "operacao_arquivos_atualizacao" on storage.objects;
drop policy if exists "operacao_arquivos_exclusao" on storage.objects;
create policy "operacao_arquivos_leitura" on storage.objects for select using (bucket_id = 'operacao-documentos' and public.eh_membro_operacao((storage.foldername(name))[1]::uuid));
create policy "operacao_arquivos_envio" on storage.objects for insert with check (bucket_id = 'operacao-documentos' and public.eh_membro_operacao((storage.foldername(name))[1]::uuid));
create policy "operacao_arquivos_atualizacao" on storage.objects for update using (bucket_id = 'operacao-documentos' and public.eh_membro_operacao((storage.foldername(name))[1]::uuid));
create policy "operacao_arquivos_exclusao" on storage.objects for delete using (bucket_id = 'operacao-documentos' and public.eh_membro_operacao((storage.foldername(name))[1]::uuid));
