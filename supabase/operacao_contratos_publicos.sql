-- Contrato, empenho e pagamento vindos de fontes públicas (etapa 8 da esteira; scripts/esteira_contratos.js).
-- PNCP (contrato, termos/aditivos, empenhos) e Contratos.gov.br (empenhado, liquidado, pago, faturas). Sem login.
-- Idempotente, transação única; rodar depois do 01-aplicar.sql e do operacao_esteira.sql. Não apaga dados.
-- Só o robô (service_role) escreve; o usuário só lê, pela mesma regra de empresa das tarefas da esteira.
-- É a cópia pública: o cadastro manual do usuário continua em operacao_contratos / operacao_empenhos.
begin;
do $$ begin
 if to_regprocedure('public.pode_acessar_empresa_operacao(uuid,uuid)') is null
  or to_regclass('public.operacao_processos_id_empresa_org_idx') is null
  or to_regclass('public.operacao_esteira_tarefas') is null then
  raise exception 'Aplique antes 01-aplicar.sql e operacao_esteira.sql';
 end if;
end $$;

create table if not exists public.operacao_contratos_publicos (
  organizacao_id uuid not null,
  empresa_id uuid not null,
  processo_id uuid not null,
  chave text not null check (length(chave) between 3 and 80), -- numeroControlePNCP do instrumento, ou 'cg:<id>' só no Contratos.gov
  tipo text not null default 'contrato' check (tipo in ('contrato', 'empenho', 'outro')),
  numero text check (length(numero) <= 60),
  objeto text check (length(objeto) <= 1000),
  fornecedor_cnpj text check (fornecedor_cnpj ~ '^\d{14}$'),
  fornecedor_nome text check (length(fornecedor_nome) <= 300),
  assinatura date,
  vigencia_inicio date,
  vigencia_fim date,
  valor_global numeric(15,2),
  valor_empenhado numeric(15,2),
  valor_liquidado numeric(15,2),  -- sem check: o Siafi publica estorno (valor negativo)
  valor_pago numeric(15,2),
  a_pagar numeric(15,2),          -- liquidado e ainda não pago
  liquidado_sem_pagamento_desde date, -- liquidação mais antiga ainda sem pagamento (null = data não publicada ou em dia)
  aditivos jsonb not null default '[]'::jsonb check (jsonb_typeof(aditivos) = 'array' and octet_length(aditivos::text) <= 200000),
  empenhos jsonb not null default '[]'::jsonb check (jsonb_typeof(empenhos) = 'array' and octet_length(empenhos::text) <= 200000),
  faturas jsonb not null default '[]'::jsonb check (jsonb_typeof(faturas) = 'array' and octet_length(faturas::text) <= 400000),
  fontes jsonb not null default '{}'::jsonb check (jsonb_typeof(fontes) = 'object'),
  contratos_gov_id bigint,
  consultado_em timestamptz not null default now(),
  primary key (processo_id, chave),
  foreign key (processo_id, empresa_id, organizacao_id)
    references public.operacao_processos(id, empresa_id, organizacao_id) on delete cascade
);
create index if not exists operacao_contratos_publicos_empresa_idx on public.operacao_contratos_publicos (empresa_id, vigencia_fim);

alter table public.operacao_contratos_publicos enable row level security;
revoke all on public.operacao_contratos_publicos from public, anon, authenticated;
grant select on public.operacao_contratos_publicos to authenticated;
grant all on public.operacao_contratos_publicos to service_role;
drop policy if exists operacao_contratos_publicos_leitura on public.operacao_contratos_publicos;
create policy operacao_contratos_publicos_leitura on public.operacao_contratos_publicos for select to authenticated
  using (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));

notify pgrst, 'reload schema';
commit;
