-- Campos informados pelo licitante para o item/lote acompanhado.
-- Não altera nem remove lançamentos existentes.
begin;
alter table public.operacao_itens_resultado
  add column if not exists marca text,
  add column if not exists modelo text;
commit;
