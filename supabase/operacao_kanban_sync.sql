-- Permite registrar uma vitória marcada pelo usuário no Kanban sem presumir
-- vitória em todos os itens. A apuração por item/lote prevalece quando existir.
begin;

alter table public.operacao_processos
  drop constraint if exists operacao_processos_resultado_valido;

alter table public.operacao_processos
  add constraint operacao_processos_resultado_valido
  check (situacao_resultado in (
    'nao_apurado', 'nao_participou', 'em_disputa', 'sem_vitoria',
    'vitoria_sem_detalhamento', 'vitoria_parcial', 'vitoria_total', 'revogado_anulado'
  ));

commit;
