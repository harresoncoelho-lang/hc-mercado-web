-- ============================================================================
-- LicitaPlena — campos extras de perfil na tela "Minha conta" do painel,
-- inspirados no cadastro do ConLicitação (atividades detalhadas, abrangência
-- de interesse por estado, e perguntas de qualificação do cliente).
--
-- Rode este arquivo inteiro no Supabase: painel do projeto → SQL Editor →
-- New query → colar tudo → Run. Idempotente (pode rodar de novo sem medo).
--
-- "segmento" já existe na tabela clientes (preenchido no cadastro.html) e é
-- reaproveitado pelo modal "Adicionar atividades" — não precisa ser recriado.
-- ============================================================================

alter table public.clientes
  add column if not exists atividades text,
  add column if not exists estados_interesse jsonb not null default '[]'::jsonb,
  add column if not exists como_conheceu text,
  add column if not exists quantidade_funcionarios text,
  add column if not exists licitacoes_por_mes text,
  add column if not exists faturamento_anual text,
  add column if not exists como_pretende_usar text;

-- ============================================================================
-- Nenhuma policy de RLS nova é necessária: a policy "clientes_update_proprio"
-- (ver supabase/rls_e_limite_de_uso.sql) já libera update de qualquer coluna
-- da própria linha (auth.uid() = id), o que cobre os campos novos acima.
-- ============================================================================
