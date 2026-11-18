-- PREPARADO, NAO EXECUTADO POR ESTE AGENTE.
-- Metadados apenas. Nunca adicionar command, args/tgargs, prosrc,
-- pg_get_triggerdef, headers, URLs, payloads ou credenciais ao resultado.
-- A coordenacao deve executar somente em sessao de leitura ja autorizada.
-- Nao cria funcao, job, extensao, tabela ou alteracao persistente.

-- FASE A: executar primeiro. Nomes/versoes de extensoes, sem configuracao.
SELECT e.extname AS extensao, e.extversion AS versao
FROM pg_extension AS e
ORDER BY e.extname;

-- Existencia e permissao para a fase B. Nao inspeciona definicoes de jobs.
SELECT
  to_regclass('cron.job') IS NOT NULL AS cron_job_existe,
  CASE WHEN to_regclass('cron.job') IS NOT NULL
       THEN has_table_privilege(to_regclass('cron.job'), 'SELECT')
       ELSE false END AS pode_ler_cron_job;

-- Triggers nao internos: identifica a funcao chamada sem expor argumentos.
-- Inclui schemas de aplicacao/servicos; exclui apenas catalogos internos.
SELECT tn.nspname AS esquema_tabela, c.relname AS tabela,
       t.tgname AS gatilho, t.tgenabled AS estado,
       fn.nspname AS esquema_funcao, p.proname AS funcao
FROM pg_trigger AS t
JOIN pg_class AS c ON c.oid = t.tgrelid
JOIN pg_namespace AS tn ON tn.oid = c.relnamespace
JOIN pg_proc AS p ON p.oid = t.tgfoid
JOIN pg_namespace AS fn ON fn.oid = p.pronamespace
WHERE NOT t.tgisinternal
  AND tn.nspname NOT IN ('pg_catalog', 'information_schema')
  AND tn.nspname NOT LIKE 'pg_toast%'
ORDER BY tn.nspname, c.relname, t.tgname;

-- FASE B: NAO executar automaticamente junto da fase A.
-- Executar a consulta abaixo separadamente SOMENTE se ambas as colunas
-- da verificacao cron_job retornarem true. Ausencia de acesso nao e zero.
-- Contagens sao da visibilidade da role usada; RLS pode limitar o resultado.
-- SELECT count(*) AS tarefas_visiveis,
--        count(*) FILTER (WHERE active) AS tarefas_ativas_visiveis
-- FROM cron.job;

-- Sem ler corpos/argumentos, nomes nao provam ausencia de efeitos externos.
-- Esse inventario sinaliza risco; nao autoriza clone/restore ou disparo de jobs.
