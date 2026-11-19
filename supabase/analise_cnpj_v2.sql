-- Análise por CNPJ, parte 2 (tela "Analisar concorrente"): dados cadastrais da Receita e contratos por fornecedor.
-- Idempotente, transação única; rodar DEPOIS de analise_cnpj.sql (e de historico_licitacoes.sql, que cria
-- cliente_aprovado()). Não apaga dados.
--   empresas_cadastro               cache da base aberta de CNPJ da Receita (BrasilAPI; minhareceita.org de reserva):
--      situação, porte, natureza, abertura, capital social, CNAE principal/secundários e sócios. Sócio guarda SÓ
--      nome como publicado, qualificação e data de entrada: CPF nunca entra (a Receita já mascara; o CHECK barra).
--   historico_contratos_fornecedor  contratos publicados no PNCP por fornecedor (busca PNCP com o filtro de
--      fornecedor), com a UF da UNIDADE contratante (a sub-rogada, se houver), não a da sede do órgão: um contrato
--      da UFAM em Manaus conta AM mesmo com o órgão federal. Contrato federal ganha empenhado, liquidado, pago e
--      faturado (notas fiscais/faturas) pelo Contratos.gov.br, preenchidos pelo robô (scripts/analise_cnpj.js).
--   historico_cnpj_consultas.contratos_*  estado da leitura de contratos na fila do robô.
-- Dado público: qualquer cliente aprovado lê (cliente_aprovado()); só service_role (função e robô) escreve.
begin;
do $$ begin
 if to_regclass('public.historico_cnpj_consultas') is null or to_regprocedure('public.cliente_aprovado()') is null then
  raise exception 'Aplique antes historico_licitacoes.sql e analise_cnpj.sql';
 end if;
end $$;

create table if not exists public.empresas_cadastro (
  cnpj text primary key check (cnpj ~ '^\d{14}$'),
  razao_social text check (length(razao_social) <= 300),
  nome_fantasia text check (length(nome_fantasia) <= 300),
  situacao text check (length(situacao) <= 60),
  data_situacao date,
  motivo_situacao text check (length(motivo_situacao) <= 200),
  situacao_especial text check (length(situacao_especial) <= 200),
  porte text check (length(porte) <= 60),
  natureza_juridica text check (length(natureza_juridica) <= 200),
  data_abertura date,
  capital_social numeric(18,2),
  opcao_simples boolean,
  opcao_mei boolean,
  cnae_principal jsonb check (cnae_principal is null or jsonb_typeof(cnae_principal) = 'object'),
  cnaes_secundarios jsonb not null default '[]'::jsonb check (jsonb_typeof(cnaes_secundarios) = 'array' and octet_length(cnaes_secundarios::text) <= 60000),
  socios jsonb not null default '[]'::jsonb check (jsonb_typeof(socios) = 'array' and octet_length(socios::text) <= 60000),
  municipio text check (length(municipio) <= 120),
  uf text check (uf ~ '^[A-Z]{2}$'),
  fonte text not null check (fonte in ('brasilapi', 'minhareceita')),
  consultado_em timestamptz not null default now()
);
-- LGPD: nenhum CPF (nem em nome de MEI, nem em sócio). Mesma regex de _cpf.js, mais o pedaço mascarado que a Receita
-- põe no nome do MEI ("FULANA ***75059***", ver CPF_MASCARADO em _analise_cnpj.js). Limpeza única antes do CHECK.
update public.empresas_cadastro set razao_social = nullif(btrim(regexp_replace(regexp_replace(razao_social, '\*+[0-9.-]*[0-9][0-9.-]*\*+', ' ', 'g'), '\s+', ' ', 'g')), '')
 where razao_social ~ '\*+[0-9.-]*[0-9][0-9.-]*\*+';
update public.empresas_cadastro set nome_fantasia = nullif(btrim(regexp_replace(regexp_replace(nome_fantasia, '\*+[0-9.-]*[0-9][0-9.-]*\*+', ' ', 'g'), '\s+', ' ', 'g')), '')
 where nome_fantasia ~ '\*+[0-9.-]*[0-9][0-9.-]*\*+';
alter table public.empresas_cadastro drop constraint if exists empresas_cadastro_sem_cpf;
alter table public.empresas_cadastro add constraint empresas_cadastro_sem_cpf check (
  coalesce(razao_social, '') !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y'
  and coalesce(nome_fantasia, '') !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y'
  and socios::text !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y'
  and socios::text !~* 'cpf'
  and coalesce(razao_social, '') || coalesce(nome_fantasia, '') || socios::text !~ '\*[0-9.-]*[0-9][0-9.-]*\*');
create index if not exists empresas_cadastro_consultado_idx on public.empresas_cadastro (consultado_em);

create table if not exists public.historico_contratos_fornecedor (
  numero_controle_pncp text primary key check (numero_controle_pncp ~ '^\d{14}-2-\d+/\d{4}$'),
  fornecedor_ni text not null check (fornecedor_ni ~ '^\d{14}$'),
  fornecedor_nome text check (length(fornecedor_nome) <= 300),
  orgao_cnpj text check (orgao_cnpj ~ '^\d{14}$'),
  orgao_nome text check (length(orgao_nome) <= 300),
  unidade_codigo text check (length(unidade_codigo) <= 20),
  unidade_nome text check (length(unidade_nome) <= 300),
  municipio text check (length(municipio) <= 120),
  uf text check (uf ~ '^[A-Z]{2}$'),
  esfera text check (esfera in ('F', 'E', 'M', 'D', 'N')),
  tipo text check (length(tipo) <= 80),
  numero text check (length(numero) <= 60),
  ano integer,
  objeto text check (length(objeto) <= 1000),
  data_assinatura date,
  vigencia_inicio date,
  vigencia_fim date,
  valor_global numeric(18,2),
  valor_empenhado numeric(18,2),
  valor_liquidado numeric(18,2),
  valor_pago numeric(18,2),
  valor_faturado numeric(18,2),
  contratos_gov_id bigint,
  gov_consultado_em timestamptz,
  link_pncp text check (link_pncp ~ '^https://pncp\.gov\.br/'),
  atualizado_em timestamptz not null default now()
);
create index if not exists historico_contratos_fornecedor_ni_idx on public.historico_contratos_fornecedor (fornecedor_ni, data_assinatura desc);
create index if not exists historico_contratos_fornecedor_gov_idx on public.historico_contratos_fornecedor (fornecedor_ni, gov_consultado_em nulls first) where esfera = 'F';

do $$ declare t text; begin
 foreach t in array array['empresas_cadastro', 'historico_contratos_fornecedor'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on public.%I from public, anon, authenticated', t);
  execute format('grant select on public.%I to authenticated', t);
  execute format('grant all on public.%I to service_role', t);
  execute format('drop policy if exists %I on public.%I', t || '_leitura', t);
  execute format('create policy %I on public.%I for select to authenticated using (public.cliente_aprovado())', t || '_leitura', t);
 end loop;
end $$;

-- Fila: contratos lidos (todas as páginas do PNCP) e quantos o PNCP lista. Sem contratos_lidos_em o robô lê.
alter table public.historico_cnpj_consultas add column if not exists contratos_total integer;
alter table public.historico_cnpj_consultas add column if not exists contratos_lidos_em timestamptz;

-- Prazo de guarda do cache cadastral: o que não é consultado há mais de p_dias (mínimo 31, acima da validade de 30
-- dias) sai. Os contratos são dado público de compras e ficam (como as tabelas historico_*).
create or replace function public.empresas_cadastro_limpar(p_dias integer default 180)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from public.empresas_cadastro where consultado_em < now() - make_interval(days => greatest(coalesce(p_dias, 180), 31));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.empresas_cadastro_limpar(integer) from public, anon, authenticated;
grant execute on function public.empresas_cadastro_limpar(integer) to service_role;

notify pgrst, 'reload schema';
commit;
