-- Perfil da empresa e premissas padrão de preço (esteira, tarefa E1).
-- Idempotente, transação única; rodar no SQL Editor depois do 01-aplicar.sql.
-- Só cria objetos novos: não altera nem apaga dados existentes.
-- Logo no bucket privado operacao-documentos em {org}/{empresa}/perfil/...: as policies atuais
-- de storage.objects já cobrem; NÃO criar policy nova lá (fecha identificacao_empresa_habilitada()).
begin;
do $$ begin
 if to_regprocedure('public.pode_escrever_empresa_operacao(uuid,uuid)') is null
  or to_regprocedure('public.arquivo_no_escopo_operacao(text,uuid,uuid)') is null
  or to_regprocedure('public.preservar_escopo_operacao()') is null then
  raise exception 'Aplique antes seguranca_operacao.sql (01-aplicar.sql)';
 end if;
end $$;

create table if not exists public.operacao_perfil_empresa (
  empresa_id uuid primary key,
  organizacao_id uuid not null,
  nome_fantasia text check (nome_fantasia is null or length(nome_fantasia) between 1 and 180),
  telefone text check (telefone is null or length(telefone) between 8 and 30),
  email text check (email is null or (length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  inscricao_estadual text check (inscricao_estadual is null or length(inscricao_estadual) between 1 and 30),
  inscricao_municipal text check (inscricao_municipal is null or length(inscricao_municipal) between 1 and 30),
  porte text check (porte in ('mei', 'me', 'epp', 'demais')),
  regime_tributario text check (regime_tributario in ('mei', 'simples', 'presumido', 'real')),
  aliquota_efetiva numeric(7,3) check (aliquota_efetiva between 0 and 100),
  tributos_fonte text not null default 'manual' check (length(tributos_fonte) between 1 and 40),
  cpf_representante text check (cpf_representante ~ '^[0-9]{11}$'),
  banco jsonb check (banco is null or jsonb_typeof(banco) = 'object'),
  proposta_padrao jsonb not null default '{}'::jsonb check (jsonb_typeof(proposta_padrao) = 'object'
    and (proposta_padrao - array['validade', 'pagamento', 'prazo_entrega']) = '{}'::jsonb),
  logo_caminho text,
  logo_hash text check (logo_hash ~ '^[0-9a-f]{64}$'),
  versao bigint not null default 1,
  atualizado_por uuid references auth.users(id) on delete set null,
  atualizado_em timestamptz not null default now(),
  check ((logo_caminho is null) = (logo_hash is null)),
  check (public.arquivo_no_escopo_operacao(logo_caminho, organizacao_id, empresa_id)
    and (logo_caminho is null or split_part(logo_caminho, '/', 3) = 'perfil')),
  foreign key (empresa_id, organizacao_id)
    references public.operacao_empresas(id, organizacao_id) on delete cascade
);
comment on table public.operacao_perfil_empresa is
  'Perfil da empresa (preenchido uma vez). LGPD: cpf_representante e banco NUNCA vão para IA nem para logs. '
  'Leitura só para gestor/operador (pode_escrever_empresa_operacao): o papel leitura não vê CPF nem dados bancários.';

create table if not exists public.operacao_premissas_empresa (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null,
  empresa_id uuid not null,
  -- '*' vale para qualquer segmento/UF; segmento guardado já normalizado (minúsculas, sem bordas).
  segmento text not null default '*' check (length(segmento) between 1 and 80 and segmento = lower(btrim(segmento))),
  uf text not null default '*' check (uf = '*' or uf ~ '^[A-Z]{2}$'),
  tributos_percentual numeric(7,3) check (tributos_percentual between 0 and 100),
  frete_percentual numeric(7,3) check (frete_percentual between 0 and 100),
  garantia_percentual numeric(7,3) check (garantia_percentual between 0 and 100),
  margem_percentual numeric(7,3) check (margem_percentual between 0 and 100),
  margem_minima_percentual numeric(7,3) check (margem_minima_percentual between 0 and 100),
  atualizado_por uuid references auth.users(id) on delete set null,
  atualizado_em timestamptz not null default now(),
  check (margem_minima_percentual <= margem_percentual),
  unique (empresa_id, segmento, uf),
  foreign key (empresa_id, organizacao_id)
    references public.operacao_empresas(id, organizacao_id) on delete cascade
);

-- versao sobe a cada UPDATE; quem grava é o JWT (o servidor com service_role informa atualizado_por).
create or replace function public.carimbar_perfil_empresa()
returns trigger language plpgsql set search_path = '' as $$
begin
 new.atualizado_em := now();
 new.atualizado_por := coalesce(auth.uid(), new.atualizado_por);
 new.versao := case when TG_OP = 'UPDATE' then old.versao + 1 else 1 end;
 return new;
end $$;
drop trigger if exists carimbar_perfil_empresa on public.operacao_perfil_empresa;
create trigger carimbar_perfil_empresa before insert or update on public.operacao_perfil_empresa
  for each row execute function public.carimbar_perfil_empresa();

create or replace function public.limitar_premissas_empresa()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 new.atualizado_em := now();
 new.atualizado_por := coalesce(auth.uid(), new.atualizado_por);
 if TG_OP = 'INSERT' then
  -- Serializa inserções da mesma empresa para a contagem não furar o teto.
  perform pg_advisory_xact_lock(hashtext('premissas:' || new.empresa_id::text));
  if (select count(*) from public.operacao_premissas_empresa where empresa_id = new.empresa_id) >= 50 then
   raise exception 'Limite de 50 premissas por empresa' using errcode = 'P0001';
  end if;
 end if;
 return new;
end $$;
drop trigger if exists limitar_premissas_empresa on public.operacao_premissas_empresa;
create trigger limitar_premissas_empresa before insert or update on public.operacao_premissas_empresa
  for each row execute function public.limitar_premissas_empresa();

-- Escopo não muda depois de criado (mesma regra de documentos e processos).
drop trigger if exists preservar_escopo_operacao on public.operacao_perfil_empresa;
create trigger preservar_escopo_operacao before update on public.operacao_perfil_empresa
  for each row execute function public.preservar_escopo_operacao();
drop trigger if exists preservar_escopo_operacao on public.operacao_premissas_empresa;
create trigger preservar_escopo_operacao before update on public.operacao_premissas_empresa
  for each row execute function public.preservar_escopo_operacao();
revoke all on function public.carimbar_perfil_empresa(), public.limitar_premissas_empresa()
  from public, anon, authenticated, service_role;

-- Mais específica primeiro: (seg+UF) > (seg+*) > (*+UF) > (*+*). Invoker: respeita a RLS.
create or replace function public.premissa_aplicavel(p_empresa uuid, p_segmento text, p_uf text)
returns public.operacao_premissas_empresa language sql stable set search_path = '' as $$
 select p.* from public.operacao_premissas_empresa p
 where p.empresa_id = p_empresa
   and p.segmento in (lower(btrim(p_segmento)), '*')
   and p.uf in (upper(btrim(p_uf)), '*')
 order by (p.segmento <> '*') desc, (p.uf <> '*') desc
 limit 1;
$$;
revoke all on function public.premissa_aplicavel(uuid, text, text) from public, anon;
grant execute on function public.premissa_aplicavel(uuid, text, text) to authenticated, service_role;

alter table public.operacao_perfil_empresa enable row level security;
alter table public.operacao_premissas_empresa enable row level security;
revoke all on public.operacao_perfil_empresa, public.operacao_premissas_empresa from public, anon, authenticated;
grant select, insert, update, delete on public.operacao_perfil_empresa, public.operacao_premissas_empresa to authenticated;
grant all on public.operacao_perfil_empresa, public.operacao_premissas_empresa to service_role;
drop policy if exists operacao_perfil_empresa_leitura on public.operacao_perfil_empresa;
drop policy if exists operacao_perfil_empresa_escrita on public.operacao_perfil_empresa;
drop policy if exists operacao_premissas_empresa_leitura on public.operacao_premissas_empresa;
drop policy if exists operacao_premissas_empresa_escrita on public.operacao_premissas_empresa;
-- LGPD: CPF e banco não ficam visíveis para o papel leitura (ver comentário da tabela).
create policy operacao_perfil_empresa_leitura on public.operacao_perfil_empresa for select to authenticated
  using (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id));
create policy operacao_perfil_empresa_escrita on public.operacao_perfil_empresa for all to authenticated
  using (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id))
  with check (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id));
create policy operacao_premissas_empresa_leitura on public.operacao_premissas_empresa for select to authenticated
  using (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));
create policy operacao_premissas_empresa_escrita on public.operacao_premissas_empresa for all to authenticated
  using (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id))
  with check (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id));

notify pgrst, 'reload schema';
commit;
