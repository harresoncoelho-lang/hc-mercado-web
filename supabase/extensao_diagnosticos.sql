-- ============================================================================
-- LicitaPlena — diagnósticos enviados pela extensão ("Enviar diagnóstico", extensao-leitura/diagnostico.mjs).
--
-- Rode no Supabase: SQL Editor -> New query -> Run. Idempotente.
-- Quando um fluxo da extensão não reconhece a página do portal, o usuário pode mandar só a ESTRUTURA da página
-- (tags, classes, ids, data-test, rótulos de campo) para a equipe ajustar os seletores. Sem valores digitados,
-- sem texto corrido, sem CPF (netlify/functions/extensao-diagnostico.js filtra antes; o CHECK abaixo é a 2ª trava).
--   Leitura e escrita: só service_role (a equipe lê pelo SQL Editor). Nenhuma policy para authenticated/anon.
--   Retenção: 90 dias (apague com o delete do fim do arquivo quando quiser limpar).
-- ============================================================================
begin;
set local lock_timeout = '5s';

create table if not exists public.extensao_diagnosticos (
  id bigint generated always as identity primary key,
  enviado_por uuid references auth.users(id) on delete set null,
  enviado_em timestamptz not null default now(),
  fluxo text not null check (fluxo in ('gravar', 'preencher', 'acompanhar')),
  motivo text check (char_length(motivo) <= 40),
  versao_extensao text check (versao_extensao ~ '^[0-9]{1,3}(\.[0-9]{1,3}){0,3}$'),
  host text not null check (host in ('cnetmobile.estaleiro.serpro.gov.br', 'comprasnet.gov.br', 'www.comprasnet.gov.br')),
  caminho text not null check (char_length(caminho) <= 300),
  estrutura jsonb not null check (jsonb_typeof(estrutura) = 'object' and pg_column_size(estrutura) <= 1500000),
  -- Mesma forma de CPF de _cpf.js: nada parecido com CPF entra, nem dentro do JSON.
  check (estrutura::text !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y')
);
create index if not exists extensao_diagnosticos_enviado_em on public.extensao_diagnosticos (enviado_em desc);

alter table public.extensao_diagnosticos enable row level security;
revoke all on public.extensao_diagnosticos from anon, authenticated;

commit;

-- Limpeza manual (retenção de 90 dias):
-- delete from public.extensao_diagnosticos where enviado_em < now() - interval '90 days';
