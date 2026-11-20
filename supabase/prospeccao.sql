-- ============================================================================
-- LicitaPlena — Prospecção (o que o órgão vai comprar antes do edital).
--
-- Rode no Supabase: SQL Editor -> New query -> Run. Idempotente, transação única;
-- só cria objetos novos (não altera nem apaga dados de outras tabelas).
-- Escrita: só o robô scripts/coletar_prospeccao.js (service_role), uma vez por dia.
-- Leitura: qualquer usuário autenticado (dado público do PNCP e do Compras.gov). anon não lê.
--
-- É um cache enxuto de fonte pública: o robô apaga o que venceu (data_ref < hoje) e o que não
-- voltou na coleta completa do dia. Por isso service_role pode apagar (diferente das sanções).
-- LGPD: fornecedor só com CNPJ (check de 14 dígitos); pessoa física não é gravada.
-- ============================================================================
begin;

create table if not exists public.prospeccao_itens (
  id text primary key check (length(id) between 5 and 300),
  tipo text not null check (tipo in ('pca', 'irp', 'ata', 'contrato')),
  fonte text not null check (fonte in ('pncp', 'pgc', 'comprasgov_arp')),
  plataforma text check (plataforma is null or length(plataforma) <= 120),
  uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  orgao_cnpj text check (orgao_cnpj is null or orgao_cnpj ~ '^[0-9]{14}$'),
  orgao_nome text check (orgao_nome is null or length(orgao_nome) <= 300),
  unidade_codigo text check (unidade_codigo is null or length(unidade_codigo) <= 30),
  unidade_nome text check (unidade_nome is null or length(unidade_nome) <= 300),
  municipio text check (municipio is null or length(municipio) <= 120),
  objeto text check (objeto is null or length(objeto) <= 1000),
  descricao text check (descricao is null or length(descricao) <= 600),
  catmat text check (catmat is null or catmat ~ '^[0-9]{1,12}$'),
  quantidade numeric,
  valor_unitario numeric,
  valor_total numeric,
  data_inicio date,
  -- A data que importa para o fornecedor: PCA = data desejada; IRP = prazo de manifestação;
  -- ata = fim da vigência; contrato = fim da vigência.
  data_ref date,
  fornecedor_cnpj text check (fornecedor_cnpj is null or fornecedor_cnpj ~ '^[0-9]{14}$'),
  fornecedor_nome text check (fornecedor_nome is null or length(fornecedor_nome) <= 300),
  saldo numeric,
  maximo_adesao numeric,
  permite_adesao boolean,
  link text not null check (link ~ '^https://(pncp\.gov\.br|dadosabertos\.compras\.gov\.br|contratos\.comprasnet\.gov\.br)/' and length(link) <= 500),
  -- Texto minúsculo e sem acento (objeto + item + órgão), montado pelo robô para o ILIKE da busca.
  busca text not null default '' check (length(busca) <= 2000),
  coletado_em timestamptz not null default now(),
  check (fornecedor_nome is null or fornecedor_cnpj is not null)
);

-- A tela filtra sempre por tipo e quase sempre por UF e janela de data.
create index if not exists prospeccao_itens_tipo_uf_data_idx on public.prospeccao_itens (tipo, uf, data_ref);
create index if not exists prospeccao_itens_catmat_idx on public.prospeccao_itens (catmat) where catmat is not null;
-- shortcut: o ILIKE em busca faz varredura dentro de (tipo, uf); com dezenas de milhares de linhas por UF é rápido.
-- Se a tabela passar de algumas centenas de milhares, criar índice gin_trgm_ops em busca (extensão pg_trgm).

-- LGPD: razão social de MEI vem com o CPF do titular ("FULANA DE TAL 97048143215"). Limpeza única e idempotente
-- do que já foi gravado (só toca linha que ainda tem CPF), depois o CHECK recusa CPF daqui para frente. Mesma forma
-- da regex de netlify/functions/_cpf.js (lá \s cobre mais: o robô sempre limpa antes do CHECK).
update public.prospeccao_itens set fornecedor_nome = nullif(btrim(regexp_replace(regexp_replace(fornecedor_nome, '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y', ' ', 'g'), '\s+', ' ', 'g')), '')
 where fornecedor_nome ~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y';
alter table public.prospeccao_itens drop constraint if exists prospeccao_itens_fornecedor_sem_cpf;
alter table public.prospeccao_itens add constraint prospeccao_itens_fornecedor_sem_cpf check (fornecedor_nome !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y');

-- v2 (20/11/2026): adesões já usadas (Compras.gov 5_consultarAdesoesItem), número da ata e nome do item para a
-- busca por texto priorizar o início da descrição. add column if not exists: idempotente; o robô preenche.
alter table public.prospeccao_itens add column if not exists ata_numero text;
alter table public.prospeccao_itens add column if not exists adesoes_usadas numeric;
alter table public.prospeccao_itens add column if not exists adesoes_em timestamptz;
alter table public.prospeccao_itens add column if not exists busca_nome text not null default '';
alter table public.prospeccao_itens drop constraint if exists prospeccao_itens_v2_check;
alter table public.prospeccao_itens add constraint prospeccao_itens_v2_check check (
  (ata_numero is null or length(ata_numero) <= 40) and (adesoes_usadas is null or adesoes_usadas >= 0) and length(busca_nome) <= 200);
-- Linhas gravadas antes da v2: nome = 90 primeiros caracteres da descrição + 90 do objeto, minúsculo e sem acento, até o robô regravar.
update public.prospeccao_itens
   set busca_nome = btrim(left(translate(lower(coalesce(descricao, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), 90) || ' '
                       || left(translate(lower(coalesce(objeto, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), 90))
 where busca_nome = '' and coalesce(descricao, objeto) is not null;
-- Acento quebrado que a fonte devolve (UTF-8 lido como Windows-1252, "SAÃšDE"): o robô corrige ao gravar; as linhas
-- antigas são corrigidas na próxima coleta (upsert pela mesma chave).

alter table public.prospeccao_itens enable row level security;
revoke all on public.prospeccao_itens from anon, authenticated;
grant select on public.prospeccao_itens to authenticated;
revoke truncate on public.prospeccao_itens from service_role;
grant select, insert, update, delete on public.prospeccao_itens to service_role;

-- Leitura só para cliente aprovado (conta pendente/suspensa com JWT válido não lê). security definer porque a RLS de
-- clientes só mostra a própria linha; stable + search_path vazio. Mesmo corpo em prospeccao.sql e historico_licitacoes.sql.
create or replace function public.cliente_aprovado() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clientes c where c.id = (select auth.uid()) and c.status = 'aprovado')
$$;
revoke all on function public.cliente_aprovado() from public, anon;
grant execute on function public.cliente_aprovado() to authenticated, service_role;

drop policy if exists prospeccao_itens_select_autenticado on public.prospeccao_itens;
create policy prospeccao_itens_select_autenticado on public.prospeccao_itens
  for select to authenticated using (public.cliente_aprovado());
-- Sem policy de escrita: só service_role (bypassrls) grava.

commit;
