-- NÃO EXECUTADO. Ensaio independente da fórmula de bytes; não valida RLS/CAS da RPC.
-- Executar somente em homologação isolada. Todas as operações são revertidas.
begin;
do $$
declare p jsonb; n integer; bytes bigint;
begin
 foreach n in array array[51,200,1000] loop
  select jsonb_build_object('itemIds',jsonb_agg(id),'unidades',jsonb_object_agg(id,'un'),'validade','30 dias','prazoEntrega','10 dias','pagamento','30 dias') into p
  from (select '33333333-3333-3333-3333-'||lpad(i::text,12,'0') id from generate_series(1,n) i) f;
  select 128+n*128+octet_length(convert_to(p->>'validade','UTF8'))+octet_length(convert_to(p->>'prazoEntrega','UTF8'))+octet_length(convert_to(p->>'pagamento','UTF8'))
   +sum(octet_length(convert_to(id,'UTF8'))+octet_length(convert_to(p->'unidades'->>id,'UTF8'))) into bytes from jsonb_array_elements_text(p->'itemIds') s(id);
  if bytes<>128+n*166+21 then raise exception 'Fórmula divergente: %',bytes; end if;
 end loop;
 if octet_length(convert_to('çá','UTF8'))<>4 then raise exception 'UTF8 inesperado'; end if;
end $$;
rollback;
-- PENDENTE: ensaio da RPC instalada com fixture tenant/usuário/empresa/processo/itens,
-- aprovação, vínculo, CNPJ cruzado, CAS, revisão antiga e budgets. Não substituir por teste estático.
