-- Exigências do edital por processo + situação calculada (esteira, tarefa E3).
-- Idempotente, transação única; rodar no SQL Editor depois do 01-aplicar.sql.
-- Só cria objetos novos: não altera nem apaga dados existentes.
-- Quem grava as exigências é o robô (service_role). O usuário só responde (coluna resposta).
begin;
do $$ begin
 if to_regprocedure('public.pode_acessar_processo_operacao(uuid,uuid)') is null
  or to_regprocedure('public.pode_escrever_processo_operacao(uuid,uuid)') is null
  or to_regclass('public.operacao_processos_id_empresa_org_idx') is null then
  raise exception 'Aplique antes o 01-aplicar.sql';
 end if;
end $$;

create table if not exists public.operacao_exigencias_processo (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null,
  empresa_id uuid not null,
  processo_id uuid not null,
  codigo text not null check (length(codigo) between 1 and 40),
  -- Mesmas 11 categorias de netlify/functions/_exigencias.js.
  categoria text not null check (categoria in ('juridica', 'fiscal', 'tecnica', 'economica', 'declaracao',
    'proposta', 'amostra', 'visita', 'garantia', 'credenciamento', 'execucao')),
  texto text not null check (length(texto) between 1 and 2000),
  documento text check (documento is null or length(documento) between 1 and 300),
  pagina integer check (pagina > 0),
  trecho text check (length(trecho) <= 1200),
  origem text not null check (origem in ('ambas', 'ia', 'ia_sem_trecho', 'leitura_deterministica', 'segunda_passada', 'manual')),
  incomum boolean not null default false,
  motivo_incomum text check (length(motivo_incomum) <= 500),
  -- Casa com operacao_documentos.tipo da mesma empresa (sem diferenciar caixa e bordas); nulo = "conferir".
  tipo_documento text check (tipo_documento is null or length(tipo_documento) between 1 and 120),
  modelo_declaracao text check (modelo_declaracao is null or length(modelo_declaracao) between 1 and 120),
  resposta text not null default 'pendente' check (resposta in ('pendente', 'atendo', 'nao_se_aplica', 'vou_providenciar')),
  respondido_por uuid references auth.users(id) on delete set null,
  respondido_em timestamptz,
  gerado_em timestamptz not null default now(),
  unique (processo_id, codigo),
  foreign key (processo_id, empresa_id, organizacao_id)
    references public.operacao_processos(id, empresa_id, organizacao_id) on delete cascade
);
-- Modelo literal do anexo do edital para a declaração (texto externo, gravado só pelo robô; o usuário não tem grant).
-- Fonte = {documento, pagina}. Colunas novas por alter: a tabela já existe nos bancos aplicados antes.
alter table public.operacao_exigencias_processo add column if not exists modelo_texto text
  check (modelo_texto is null or length(modelo_texto) between 1 and 20000);
alter table public.operacao_exigencias_processo add column if not exists modelo_fonte jsonb
  check (modelo_fonte is null or jsonb_typeof(modelo_fonte) = 'object');
create index if not exists operacao_exigencias_processo_empresa_tipo_idx
  on public.operacao_exigencias_processo (empresa_id, tipo_documento);

-- Quem respondeu sai do JWT; o usuário não tem grant nessas colunas.
create or replace function public.carimbar_resposta_exigencia()
returns trigger language plpgsql set search_path = '' as $$
begin
 if new.resposta is distinct from old.resposta then
  new.respondido_por := coalesce(auth.uid(), new.respondido_por);
  new.respondido_em := now();
 end if;
 return new;
end $$;
revoke all on function public.carimbar_resposta_exigencia() from public, anon, authenticated, service_role;
drop trigger if exists carimbar_resposta_exigencia on public.operacao_exigencias_processo;
create trigger carimbar_resposta_exigencia before update on public.operacao_exigencias_processo
  for each row execute function public.carimbar_resposta_exigencia();

alter table public.operacao_exigencias_processo enable row level security;
revoke all on public.operacao_exigencias_processo from public, anon, authenticated;
grant select on public.operacao_exigencias_processo to authenticated;
grant update (resposta) on public.operacao_exigencias_processo to authenticated;
grant all on public.operacao_exigencias_processo to service_role;
drop policy if exists operacao_exigencias_leitura on public.operacao_exigencias_processo;
drop policy if exists operacao_exigencias_resposta on public.operacao_exigencias_processo;
create policy operacao_exigencias_leitura on public.operacao_exigencias_processo for select to authenticated
  using (public.pode_acessar_processo_operacao(organizacao_id, processo_id));
create policy operacao_exigencias_resposta on public.operacao_exigencias_processo for update to authenticated
  using (public.pode_escrever_processo_operacao(organizacao_id, processo_id))
  with check (public.pode_escrever_processo_operacao(organizacao_id, processo_id));

-- Calculada na leitura: o vencimento muda com o tempo. Invoker: RLS de cada tabela vale.
-- Documento = o mais recente (emissão, depois cadastro) do mesmo tipo na mesma empresa.
-- drop antes: e.* ganhou colunas no meio da lista e "create or replace" não aceita isso. Grants refeitos abaixo.
drop view if exists public.operacao_exigencias_situacao;
create or replace view public.operacao_exigencias_situacao with (security_invoker = on) as
select e.*, d.id as documento_empresa_id, d.titulo as documento_empresa_titulo, d.vencimento as documento_vencimento,
  case
   when e.tipo_documento is null then 'conferir'
   when d.id is null then 'falta'
   when d.vencimento < coalesce((p.data_sessao at time zone 'America/Sao_Paulo')::date, current_date) then 'vence_antes_da_sessao'
   else 'vigente'
  end as situacao
from public.operacao_exigencias_processo e
join public.operacao_processos p on p.id = e.processo_id and p.organizacao_id = e.organizacao_id
left join lateral (
  select x.id, x.titulo, x.vencimento from public.operacao_documentos x
  where x.empresa_id = e.empresa_id and x.organizacao_id = e.organizacao_id and lower(btrim(x.tipo)) = lower(btrim(e.tipo_documento))
  order by x.emissao desc nulls last, x.criado_em desc
  limit 1
) d on true;
revoke all on public.operacao_exigencias_situacao from public, anon, authenticated;
grant select on public.operacao_exigencias_situacao to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
