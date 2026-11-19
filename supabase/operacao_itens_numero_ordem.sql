-- Ordem dos itens do processo pelo número (edital com mais de 100 itens).
-- A paginação era por id (uuid aleatório): a 1ª página não trazia os menores números. numero_ordem é o
-- identificador quando ele é só dígitos (até 18, cabe em bigint), senão null; a lista pagina por
-- (numero_ordem nulls last, id). Coluna gerada: não passa por gatilho e não toca atualizado_em (o revisaoHash
-- do kit usa atualizado_em; peça revisada continua válida). O select fixo do kit não lê esta coluna.
-- Idempotente. Aplicar depois de operacao_acompanhamento.sql (tabela) e antes de publicar o código que ordena por ela.
begin;
set local lock_timeout = '5s';
alter table public.operacao_itens_resultado add column if not exists numero_ordem bigint
  generated always as (case when identificador ~ '^[0-9]{1,18}$' then identificador::bigint end) stored;
create index if not exists operacao_itens_resultado_ordem_idx
  on public.operacao_itens_resultado (processo_id, organizacao_id, numero_ordem, id);
commit;
notify pgrst,'reload schema';
