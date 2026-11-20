-- Catálogo de produtos da empresa (custo, marca, modelo, fabricante, fornecedor, foto).
-- Idempotente, transação única; rodar no SQL Editor depois do 01-aplicar.sql.
-- Só cria objetos novos: não altera nem apaga dados existentes.
-- Foto no bucket privado operacao-documentos em {org}/{empresa}/catalogo/<sha256>.(png|jpg|jpeg): as policies
-- atuais de storage.objects já cobrem (escrita_arquivo_operacao); NÃO criar policy nova lá.
begin;
do $$ begin
 if to_regprocedure('public.pode_escrever_empresa_operacao(uuid,uuid)') is null
  or to_regprocedure('public.pode_acessar_empresa_operacao(uuid,uuid)') is null
  or to_regprocedure('public.preservar_escopo_operacao()') is null then
  raise exception 'Aplique antes seguranca_operacao.sql (01-aplicar.sql)';
 end if;
end $$;

create table if not exists public.operacao_catalogo_produtos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null,
  empresa_id uuid not null,
  nome text not null check (length(btrim(nome)) between 1 and 300),
  descricao text check (descricao is null or length(descricao) <= 5000),
  marca text check (marca is null or length(marca) <= 200),
  modelo text check (modelo is null or length(modelo) <= 200),
  -- Mesmos limites de operacao_itens_resultado: o "Usar do catálogo" copia sem cortar.
  fabricante text check (fabricante is null or length(fabricante) <= 500),
  unidade text check (unidade is null or length(unidade) between 1 and 100),
  custo_unitario numeric(15,2) check (custo_unitario is null or custo_unitario >= 0),
  fornecedor_nome text check (fornecedor_nome is null or length(fornecedor_nome) <= 200),
  fornecedor_contato text check (fornecedor_contato is null or length(fornecedor_contato) <= 300),
  codigo_interno text check (codigo_interno is null or length(btrim(codigo_interno)) between 1 and 60),
  foto_caminho text,
  foto_hash text check (foto_hash ~ '^[0-9a-f]{64}$'),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null,
  check ((foto_caminho is null) = (foto_hash is null)),
  -- Só <org>/<empresa>/catalogo/<foto_hash>.(png|jpg|jpeg): barra '..', outra empresa e nome livre.
  check (foto_caminho is null or foto_caminho ~ ('^' || organizacao_id::text || '/' || empresa_id::text
    || '/catalogo/' || foto_hash || '\.(png|jpe?g)$')),
  foreign key (empresa_id, organizacao_id)
    references public.operacao_empresas(id, organizacao_id) on delete cascade
);
-- Preço de referência do mercado (o que órgãos pagaram, ex.: mediana da Pesquisa de Preços do Compras.gov).
-- NÃO é custo: custo_unitario continua sendo o que o fornecedor cobra do usuário. Fonte e data andam juntas com o preço.
alter table public.operacao_catalogo_produtos add column if not exists preco_referencia numeric(15,2) check (preco_referencia is null or preco_referencia > 0);
alter table public.operacao_catalogo_produtos add column if not exists referencia_fonte text check (referencia_fonte is null or length(btrim(referencia_fonte)) between 1 and 300);
alter table public.operacao_catalogo_produtos add column if not exists referencia_em date;
do $$ begin
 if not exists (select 1 from pg_constraint where conname = 'operacao_catalogo_produtos_referencia_completa') then
  alter table public.operacao_catalogo_produtos add constraint operacao_catalogo_produtos_referencia_completa
   check ((preco_referencia is null) = (referencia_fonte is null) and (preco_referencia is null) = (referencia_em is null));
 end if;
end $$;
-- Código interno é a chave da planilha quando o id não vem: um por empresa.
create unique index if not exists operacao_catalogo_produtos_codigo_idx
  on public.operacao_catalogo_produtos (empresa_id, codigo_interno) where codigo_interno is not null;
-- shortcut: btree cobre ordenação e prefixo; a busca "contém" roda no navegador (até 5.000 linhas). pg_trgm se o teto subir.
create index if not exists operacao_catalogo_produtos_busca_idx
  on public.operacao_catalogo_produtos (empresa_id, lower(nome), lower(marca));

create or replace function public.carimbar_catalogo_produto()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 new.atualizado_em := now();
 new.atualizado_por := coalesce(auth.uid(), new.atualizado_por);
 if TG_OP = 'INSERT' then
  new.criado_em := now();
  -- Serializa inserções da mesma empresa para a contagem não furar o teto.
  perform pg_advisory_xact_lock(hashtext('catalogo:' || new.empresa_id::text));
  if (select count(*) from public.operacao_catalogo_produtos where empresa_id = new.empresa_id) >= 5000 then
   raise exception 'Limite de 5.000 produtos por empresa no catálogo' using errcode = 'P0001';
  end if;
 else
  new.criado_em := old.criado_em;
 end if;
 return new;
end $$;
revoke all on function public.carimbar_catalogo_produto() from public, anon, authenticated, service_role;
drop trigger if exists carimbar_catalogo_produto on public.operacao_catalogo_produtos;
create trigger carimbar_catalogo_produto before insert or update on public.operacao_catalogo_produtos
  for each row execute function public.carimbar_catalogo_produto();
drop trigger if exists preservar_escopo_operacao on public.operacao_catalogo_produtos;
create trigger preservar_escopo_operacao before update on public.operacao_catalogo_produtos
  for each row execute function public.preservar_escopo_operacao();

alter table public.operacao_catalogo_produtos enable row level security;
revoke all on public.operacao_catalogo_produtos from public, anon, authenticated;
grant select, insert, update, delete on public.operacao_catalogo_produtos to authenticated;
grant all on public.operacao_catalogo_produtos to service_role;
drop policy if exists operacao_catalogo_produtos_leitura on public.operacao_catalogo_produtos;
drop policy if exists operacao_catalogo_produtos_escrita on public.operacao_catalogo_produtos;
create policy operacao_catalogo_produtos_leitura on public.operacao_catalogo_produtos for select to authenticated
  using (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));
create policy operacao_catalogo_produtos_escrita on public.operacao_catalogo_produtos for all to authenticated
  using (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id))
  with check (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id));

notify pgrst, 'reload schema';
commit;
