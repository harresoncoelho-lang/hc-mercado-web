-- PREPARADO, NÃO EXECUTADO. Exclusivo luguscapasskcsficckf; conferir URL antes de executar.
-- Ato QA separado do seed: altera SOMENTE status dos dois clientes comprovados.
-- aprovado_em/aprovado_por ficam intactos e são fotografados para auditoria/reversão.
begin;
set local lock_timeout='5s';
create temp table qa_aprovacao_resultado(dados jsonb) on commit drop;
do $aprovar$
declare r record;antes jsonb;depois jsonb;registro jsonb:='[]';n integer;
begin
 if current_database()<>'postgres' then raise exception 'Banco inesperado';end if;
 if (select count(*) from auth.users where (id='258eddfe-d761-4ec9-ae63-ee5e5b8db408' and email='operador-a@qa.invalid'
  or id='c29e43cf-9d01-4171-bcd3-3fadf0e99fde' and email='operador-b@qa.invalid') and email_confirmed_at is not null)<>2
 then raise exception 'Handoff Auth divergiu';end if;
 if exists(select 1 from public.operacao_organizacoes where owner_id in('258eddfe-d761-4ec9-ae63-ee5e5b8db408','c29e43cf-9d01-4171-bcd3-3fadf0e99fde'))
 or exists(select 1 from public.operacao_membros where usuario_id in('258eddfe-d761-4ec9-ae63-ee5e5b8db408','c29e43cf-9d01-4171-bcd3-3fadf0e99fde'))
 then raise exception 'Contas já possuem organização/vínculo; interromper';end if;
 perform id from public.clientes where id in('258eddfe-d761-4ec9-ae63-ee5e5b8db408','c29e43cf-9d01-4171-bcd3-3fadf0e99fde') for update;
 if (select count(*) from public.clientes where id in('258eddfe-d761-4ec9-ae63-ee5e5b8db408','c29e43cf-9d01-4171-bcd3-3fadf0e99fde') and status='pendente')<>2
 then raise exception 'Baseline pendente exata indisponível';end if;
 for r in select * from public.clientes where id in('258eddfe-d761-4ec9-ae63-ee5e5b8db408','c29e43cf-9d01-4171-bcd3-3fadf0e99fde') order by id loop
  antes:=jsonb_build_object('id',r.id,'status',r.status,'aprovado_em',r.aprovado_em,'aprovado_por',r.aprovado_por);
  update public.clientes set status='aprovado' where id=r.id and status='pendente';get diagnostics n=row_count;
  if n<>1 then raise exception 'Conflito na aprovação QA';end if;
  select jsonb_build_object('id',id,'status',status,'aprovado_em',aprovado_em,'aprovado_por',aprovado_por) into depois from public.clientes where id=r.id;
  if depois-'status' is distinct from antes-'status' or depois->>'status'<>'aprovado' then raise exception 'Trigger alterou campos de aprovação; revisar antes de prosseguir';end if;
  registro:=registro||jsonb_build_array(jsonb_build_object('antes',antes,'depois',depois));
 end loop;
 insert into qa_aprovacao_resultado values(jsonb_build_object('status','APROVACAO_QA_DOIS_CLIENTES_OK','projeto','luguscapasskcsficckf','quando',clock_timestamp(),'baselineReversao',registro));
end $aprovar$;
select dados from qa_aprovacao_resultado;
commit;
-- Salvar baselineReversao antes de avançar. Não registrar senha, token ou Auth completo.
