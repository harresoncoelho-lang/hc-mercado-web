-- PREPARADO, NÃO EXECUTADO. Somente QA luguscapasskcsficckf, URL conferida pelo coordenador.
-- Não cria/edita Auth, clientes, identificação, Storage, funções ou permissões.
-- Pré-condição: duas contas existentes e confirmadas; clientes.status já aprovado por ação separada.
-- Não reutilizar em outro projeto. Executar integralmente; conflito bloqueia, nunca UPSERT.
begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
create temp table qa_seed_relatorio(dados jsonb) on commit drop;
do $seed$
declare
 ua uuid;ub uuid;r record;v text;baseline jsonb:='[]';
 oa uuid:='a1000000-0000-4000-8000-000000000001';ob uuid:='b1000000-0000-4000-8000-000000000001';
 ea uuid:='a1000000-0000-4000-8000-000000000002';eb uuid:='b1000000-0000-4000-8000-000000000002';
 pa uuid:='a1000000-0000-4000-8000-000000000003';pb uuid:='b1000000-0000-4000-8000-000000000003';
begin
 if current_database()<>'postgres' then raise exception 'Banco inesperado';end if;
 if (select count(*) from auth.users where email='operador-a@qa.invalid' and email_confirmed_at is not null)<>1
 or (select count(*) from auth.users where email='operador-b@qa.invalid' and email_confirmed_at is not null)<>1
 or (select count(*) from auth.users where email in('operador-a@qa.invalid','operador-b@qa.invalid'))<>2 then raise exception 'Handoff Auth pendente: duas contas QA confirmadas necessárias';end if;
 select id into ua from auth.users where email='operador-a@qa.invalid';
 select id into ub from auth.users where email='operador-b@qa.invalid';
 if ua=ub or (select count(*) from public.clientes where id in (ua,ub) and status='aprovado')<>2
 then raise exception 'Aprovação dos dois clientes QA pendente; não alterar registros preexistentes neste script';end if;
 if not exists(select 1 from storage.buckets where id='operacao-documentos' and public=false)
 or to_regprocedure('public.confirmar_identificacao_empresa(uuid,uuid,text,text,jsonb,jsonb)') is null
 then raise exception 'Bucket privado ou RPC de identificação indisponível';end if;
 if exists(select 1 from public.operacao_organizacoes where owner_id in (ua,ub) or id in (oa,ob))
 or exists(select 1 from public.operacao_empresas where id in(ea,eb))
 or exists(select 1 from public.operacao_processos where id in(pa,pb))
 or exists(select 1 from public.operacao_itens_resultado where id in
  (select ('a2000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid from generate_series(1,51)i
   union all select ('b2000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid from generate_series(1,200)i))
 then raise exception 'Fixtures ou organização preexistentes: interromper sem sobrescrever';end if;
 for r in select schemaname,tablename from pg_tables where schemaname in('public','auth','storage') order by 1,2 loop
  execute format('select count(*)::text||'':''||md5(coalesce(string_agg(x,''|'' order by x),'''')) from(select to_jsonb(t)::text x from %I.%I t)s',r.schemaname,r.tablename) into v;
  baseline:=baseline||jsonb_build_array(jsonb_build_object('tabela',format('%I.%I',r.schemaname,r.tablename),'count_md5',v));
 end loop;
 insert into public.operacao_organizacoes(id,nome,owner_id) values(oa,'QA UI A — FICTÍCIA',ua),(ob,'QA UI B — FICTÍCIA',ub);
 insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values(ea,oa,'QA UI A FICTÍCIA','11222333000181'),(eb,ob,'QA UI B FICTÍCIA','12345678000195');
 insert into public.operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values(oa,ua,'operador',ea),(ob,ub,'operador',eb);
 insert into public.operacao_processos(id,organizacao_id,empresa_id,objeto,numero,orgao,documentos_exigidos) values(pa,oa,ea,'Materiais fictícios QA','QA-A-51','Órgão fictício QA A','{}'),(pb,ob,eb,'Materiais fictícios QA','QA-B-200','Órgão fictício QA B','{}');
 insert into public.operacao_itens_resultado(id,organizacao_id,processo_id,tipo,identificador,descricao,quantidade,valor_unitario_proposta,marca,modelo)
 select ('a2000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,oa,pa,'item',i::text,'Material fictício A '||i,2,1.25,'Marca QA','Modelo QA' from generate_series(1,51)i
 union all select ('b2000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,ob,pb,'item',i::text,'Material fictício B '||i,2,1.25,'Marca QA','Modelo QA' from generate_series(1,200)i;
 if exists(select 1 from public.operacao_identificacao_empresa where empresa_id in(ea,eb)) then raise exception 'Identificação inesperadamente confirmada';end if;
 insert into qa_seed_relatorio values(jsonb_build_object('status','FIXTURES_QA_CRIADAS_IDENTIFICACAO_PENDENTE','usuarios',jsonb_build_array(ua,ub),'organizacoes',jsonb_build_array(oa,ob),'empresas',jsonb_build_array(ea,eb),'processos',jsonb_build_array(pa,pb),'itensA',51,'itensB',200,'baseline',baseline,'criadoEm',clock_timestamp()));
end $seed$;
select dados from qa_seed_relatorio;
commit;
-- Guardar o resultado antes de iniciar UI. Sem esse inventário/baseline, limpeza não liberada.
