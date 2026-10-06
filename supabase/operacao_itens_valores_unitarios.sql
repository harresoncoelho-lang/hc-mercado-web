-- Aplicar somente após aprovação da prévia e antes de publicar o formulário.
-- Mantém os totais existentes sem presumir que sejam preços unitários.
begin;
alter table public.operacao_itens_resultado
  add column if not exists valor_unitario_proposta numeric(15,2)
    check (valor_unitario_proposta is null or valor_unitario_proposta >= 0),
  add column if not exists valor_unitario_homologado numeric(15,2)
    check (valor_unitario_homologado is null or (valor_unitario_homologado >= 0 and situacao = 'ganho'));
commit;
