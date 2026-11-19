-- Licitação anterior (etapa 1): contratações anteriores do mesmo órgão e do mesmo produto, preservadas.
-- Idempotente, transação única; rodar no SQL Editor DEPOIS de operacao_esteira.sql. Não apaga dados.
-- Dado público (PNCP, Compras.gov dados abertos, arquivo semanal de propostas), compartilhado entre todas
-- as organizações: um pregão lido para um cliente serve aos outros. Nunca guarda CPF: fornecedor pessoa
-- física fica sem documento e com o nome "Pessoa física"; MEI aparece pela razão social pública, sem o CPF que ela traz no fim.
-- Escrita só pelo service_role (robô scripts/esteira_processos.js e a função /api/licitacao-anterior).
-- Tamanho medido no ambiente local (nov/2026, SUFRAMA 58 itens + café da Marinha): 1.690 participações = 0,73 MB com
-- índices (~430 bytes cada); as 4 tabelas somaram 1,0 MB. Um edital de 60 itens com 4 pregões anteriores fica perto de
-- 0,8 MB: 500 processos assim ~400 MB, então o teto por item (30 propostas) e por compras (12) importam no plano grátis.
begin;
do $$ begin
 if to_regclass('public.operacao_esteira_tarefas') is null then
  raise exception 'Aplique antes operacao_esteira.sql';
 end if;
end $$;

-- Uma linha por contratação. id_compra = id do Compras.gov (17 dígitos: UASG + modalidade + número + ano);
-- compra de outra plataforma usa o número de controle do PNCP.
create table if not exists public.historico_compras (
  id_compra text primary key check (length(id_compra) between 8 and 40),
  numero_controle_pncp text,
  orgao_cnpj text check (orgao_cnpj ~ '^\d{14}$'),
  orgao_nome text check (length(orgao_nome) <= 300),
  uasg text check (uasg ~ '^\d{1,8}$'),
  unidade_nome text check (length(unidade_nome) <= 300),
  ano integer check (ano between 2000 and 2100),
  numero text check (length(numero) <= 40),
  modalidade text check (length(modalidade) <= 80),
  plataforma text check (length(plataforma) <= 80),
  situacao text check (length(situacao) <= 80),
  objeto text check (length(objeto) <= 1000),
  data_publicacao date,
  link_origem text check (length(link_origem) <= 500),
  link_pncp text check (length(link_pncp) <= 500),
  atualizado_em timestamptz not null default now()
);
create index if not exists historico_compras_uasg_idx on public.historico_compras (uasg, ano desc);
create index if not exists historico_compras_orgao_idx on public.historico_compras (orgao_cnpj, ano desc);

create table if not exists public.historico_itens (
  id_compra text not null references public.historico_compras(id_compra) on delete cascade,
  numero_item integer not null check (numero_item > 0),
  catmat text check (catmat ~ '^\d{1,12}$'),
  pdm text check (pdm ~ '^\d{1,12}$'),
  descricao text check (length(descricao) <= 600),
  quantidade numeric,
  unidade text check (length(unidade) <= 60),
  valor_estimado numeric,
  situacao_item text check (length(situacao_item) <= 80),
  tem_resultado boolean,
  atualizado_em timestamptz not null default now(),
  primary key (id_compra, numero_item)
);
create index if not exists historico_itens_catmat_idx on public.historico_itens (catmat) where catmat is not null;

-- Uma linha por fornecedor no item. Cada fonte grava só as suas colunas (upsert por coluna):
-- PNCP /resultados (ordem, situação, homologado, motivo do cancelamento), arquivo de propostas
-- (classificação e valores de todos os participantes) e Pesquisa de Preços (marca do vencedor).
create table if not exists public.historico_participacoes (
  id_compra text not null,
  numero_item integer not null,
  fornecedor_chave text not null check (length(fornecedor_chave) between 1 and 40),
  fornecedor_ni text check (fornecedor_ni ~ '^\d{14}$'),
  fornecedor_nome text check (length(fornecedor_nome) <= 300),
  porte text check (length(porte) <= 40),
  uf text check (uf ~ '^[A-Z]{2}$'),
  ordem_classificacao integer,
  situacao_resultado text check (length(situacao_resultado) <= 80),
  valor_homologado numeric,
  quantidade_homologada numeric,
  data_resultado date,
  motivo_cancelamento text check (length(motivo_cancelamento) <= 1000),
  classificacao integer,
  valor_proposta numeric,
  valor_lance numeric,
  valor_negociado numeric,
  marca text check (length(marca) <= 120),
  marca_declarada text check (length(marca_declarada) <= 120),
  atualizado_em timestamptz not null default now(),
  primary key (id_compra, numero_item, fornecedor_chave),
  foreign key (id_compra, numero_item) references public.historico_itens(id_compra, numero_item) on delete cascade
);
-- Etapa 2 (análise por CNPJ do concorrente): onde ele disputou, ganhou e perdeu.
create index if not exists historico_participacoes_ni_idx on public.historico_participacoes (fornecedor_ni) where fornecedor_ni is not null;

-- Consulta avulsa (tela de pesquisa): cache por UASG + produto + período e fila do robô para completar
-- os participantes pelo arquivo de propostas (a função no Cloudflare não baixa os 90 MB do mês).
create table if not exists public.historico_consultas (
  chave text primary key check (length(chave) <= 300),
  uasg text not null check (uasg ~ '^\d{1,8}$'),
  catmat text check (catmat ~ '^\d{1,12}$'),
  palavras text check (length(palavras) <= 120),
  desde_ano integer not null,
  compras text[] not null default '{}',
  casamentos jsonb not null default '[]'::jsonb check (jsonb_typeof(casamentos) = 'array'),
  situacao text not null default 'parcial' check (situacao in ('parcial', 'completo', 'falhou')),
  erro text check (length(erro) <= 300),
  gerado_em timestamptz not null default now()
);
create index if not exists historico_consultas_fila_idx on public.historico_consultas (gerado_em) where situacao = 'parcial';

do $$ declare t text; begin
 foreach t in array array['historico_compras', 'historico_itens', 'historico_participacoes', 'historico_consultas'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on public.%I from public, anon, authenticated', t);
  execute format('grant select on public.%I to authenticated', t);
  execute format('grant all on public.%I to service_role', t);
  execute format('drop policy if exists %I on public.%I', t || '_leitura', t);
  -- Dado público de compras governamentais: qualquer usuário logado lê; ninguém além do servidor escreve.
  execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_leitura', t);
 end loop;
end $$;

-- Processos que já estavam na esteira antes desta etapa existir ganham a tarefa 'historico' (uma vez).
insert into public.operacao_esteira_tarefas (organizacao_id, empresa_id, processo_id, etapa, criado_por)
select distinct t.organizacao_id, t.empresa_id, t.processo_id, 'historico', t.criado_por
  from public.operacao_esteira_tarefas t
  join public.operacao_processos p on p.id = t.processo_id
 where p.status not in ('arquivado', 'perdido', 'contratado')
on conflict do nothing;

notify pgrst, 'reload schema';
commit;
