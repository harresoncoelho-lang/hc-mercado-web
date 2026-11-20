-- PREPARADO / NÃO EXECUTADO. Somente QA confirmado na URL do SQL Editor.
-- Preencher baseline com baselineReversao da saída REAL de APROVAR-CLIENTES-QA.sql.
-- Array vazio bloqueia. Executar apenas após limpeza das fixtures operacionais e revisão.
begin;
set local lock_timeout='5s';
do $reverter$
declare baseline jsonb:='[]'::jsonb;registro jsonb;atual jsonb;id_alvo uuid;n integer;
begin
 if current_database()<>'postgres' or jsonb_typeof(baseline)<>'array' or jsonb_array_length(baseline)<>2 then raise exception 'Baseline real de reversão obrigatória';end if;
 if (select count(distinct x->'antes'->>'id') from jsonb_array_elements(baseline)x)<>2
 or exists(select 1 from jsonb_array_elements(baseline)x where x->'antes'->>'id' not in('258eddfe-d761-4ec9-ae63-ee5e5b8db408','c29e43cf-9d01-4171-bcd3-3fadf0e99fde')
  or x->'antes'->>'status' is distinct from 'pendente' or x->'depois'->>'status' is distinct from 'aprovado'
  or (x->'antes')-'status' is distinct from (x->'depois')-'status') then raise exception 'Baseline não pertence ao ato aprovado';end if;
 if (select count(*) from auth.users where id='258eddfe-d761-4ec9-ae63-ee5e5b8db408' and email='operador-a@qa.invalid'
  or id='c29e43cf-9d01-4171-bcd3-3fadf0e99fde' and email='operador-b@qa.invalid')<>2 then raise exception 'Usuários divergem';end if;
 if exists(select 1 from public.operacao_organizacoes where owner_id in('258eddfe-d761-4ec9-ae63-ee5e5b8db408','c29e43cf-9d01-4171-bcd3-3fadf0e99fde'))
 or exists(select 1 from public.operacao_membros where usuario_id in('258eddfe-d761-4ec9-ae63-ee5e5b8db408','c29e43cf-9d01-4171-bcd3-3fadf0e99fde')) then raise exception 'Limpeza operacional pendente';end if;
 for registro in select * from jsonb_array_elements(baseline) loop
  id_alvo:=(registro->'antes'->>'id')::uuid;
  perform id from public.clientes where id=id_alvo for update;
  select jsonb_build_object('id',id,'status',status,'aprovado_em',aprovado_em,'aprovado_por',aprovado_por) into atual from public.clientes where id=id_alvo;
  if atual is distinct from registro->'depois' then raise exception 'Estado mudou após aprovação; não sobrescrever';end if;
  update public.clientes set (status,aprovado_em,aprovado_por)=(select r.status,r.aprovado_em,r.aprovado_por from jsonb_populate_record(null::public.clientes,registro->'antes')r) where id=id_alvo;
  get diagnostics n=row_count;if n<>1 then raise exception 'Cliente ausente';end if;
  select jsonb_build_object('id',id,'status',status,'aprovado_em',aprovado_em,'aprovado_por',aprovado_por) into atual from public.clientes where id=id_alvo;
  if atual is distinct from registro->'antes' then raise exception 'Reversão divergente';end if;
 end loop;
end $reverter$;
select 'APROVACAO_QA_REVERTIDA' as status;
commit;
