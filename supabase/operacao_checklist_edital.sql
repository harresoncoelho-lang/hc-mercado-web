-- Pré-preenchimento auditável do checklist a partir do resumo validado.
-- Execute antes de publicar a interface que usa estas colunas.
begin;
alter table public.operacao_processos
  add column if not exists checklist_fonte text not null default 'manual',
  add column if not exists checklist_editado_manualmente boolean not null default false,
  add column if not exists checklist_gerado_em timestamptz;
commit;
