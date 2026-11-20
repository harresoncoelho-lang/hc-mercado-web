-- PREPARADO, NÃO EXECUTADO EM PRODUÇÃO. Clone isolado ou PGlite com 01-aplicar.sql
-- e operacao_funil_etapas.sql aplicados. Fixtures sintéticas e rollback.
-- RLS simulada com "set local role authenticated" + request.jwt.claim.sub; não prova a API HTTP.
-- Gestor A (org inteira) f3..01, operador restrito à empresa A f3..02, gestor B f3..03.
begin;
insert into auth.users(id,email) values
 ('f3000000-0000-4000-8000-000000000001','funil-a@qa.invalid'),('f3000000-0000-4000-8000-000000000002','funil-r@qa.invalid'),
 ('f3000000-0000-4000-8000-000000000003','funil-b@qa.invalid');
insert into public.clientes(id,nome,email,status) values
 ('f3000000-0000-4000-8000-000000000001','QA funil A','funil-a@qa.invalid','aprovado'),
 ('f3000000-0000-4000-8000-000000000002','QA funil R','funil-r@qa.invalid','aprovado'),
 ('f3000000-0000-4000-8000-000000000003','QA funil B','funil-b@qa.invalid','aprovado');
insert into public.operacao_organizacoes(id,nome,owner_id) values
 ('f3000000-0000-4000-8000-00000000000a','QA funil A','f3000000-0000-4000-8000-000000000001'),
 ('f3000000-0000-4000-8000-00000000000b','QA funil B','f3000000-0000-4000-8000-000000000003');
insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values
 ('f3000000-0000-4000-8000-00000000001a','f3000000-0000-4000-8000-00000000000a','QA funil empresa A','11222333000181'),
 ('f3000000-0000-4000-8000-00000000001b','f3000000-0000-4000-8000-00000000000b','QA funil empresa B','22333444000181');
insert into public.operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values
 ('f3000000-0000-4000-8000-00000000000a','f3000000-0000-4000-8000-000000000001','gestor',null),
 ('f3000000-0000-4000-8000-00000000000a','f3000000-0000-4000-8000-000000000002','operador','f3000000-0000-4000-8000-00000000001a'),
 ('f3000000-0000-4000-8000-00000000000b','f3000000-0000-4000-8000-000000000003','gestor',null);
insert into public.operacao_processos(id,organizacao_id,empresa_id,objeto) values
 ('f3000000-0000-4000-8000-00000000002a','f3000000-0000-4000-8000-00000000000a','f3000000-0000-4000-8000-00000000001a','QA funil A');
insert into public.operacao_funil_etapas(id,organizacao_id,nome,ordem,status_sistema,cor) values
 ('f3000000-0000-4000-8000-00000000003b','f3000000-0000-4000-8000-00000000000b','Etapa de B',0,'sessao','#000000');

set local role authenticated;
select set_config('request.jwt.claim.sub','f3000000-0000-4000-8000-000000000001',true);
do $$
declare
 oa uuid:='f3000000-0000-4000-8000-00000000000a'; pa uuid:='f3000000-0000-4000-8000-00000000002a';
 interesse uuid; ganhei uuid; sessao uuid; extra uuid; ids uuid[]; n int; p public.operacao_processos;
begin
 if (select count(*) from public.garantir_etapas_funil(oa))<>4 or (select count(*) from public.garantir_etapas_funil(oa))<>4 then raise exception 'garantir não criou exatamente 4';end if;
 select id into interesse from public.operacao_funil_etapas where organizacao_id=oa and chave_sistema='interesse';
 select id into ganhei from public.operacao_funil_etapas where organizacao_id=oa and chave_sistema='ganhei';
 if (select count(*) from public.operacao_funil_etapas)<>4 then raise exception 'Gestor A enxerga etapa de outra organização';end if;

 -- Protegidas: não saem, não trocam de estágio; renomear/colorir/reordenar pode.
 begin delete from public.operacao_funil_etapas where id=ganhei; raise exception 'Excluiu etapa protegida'; exception when raise_exception then if sqlerrm not like 'Etapa do sistema%' then raise; end if; end;
 begin update public.operacao_funil_etapas set status_sistema='contratado' where id=ganhei; raise exception 'Protegida mudou de estágio'; exception when raise_exception then if sqlerrm not like 'Etapa do sistema%' then raise; end if; end;
 begin update public.operacao_funil_etapas set chave_sistema=null where id=ganhei; raise exception 'Protegida virou personalizada'; exception when raise_exception then if sqlerrm not like 'Só nome%' then raise; end if; end;
 begin insert into public.operacao_funil_etapas(organizacao_id,nome,ordem,status_sistema,chave_sistema) values(oa,'Ganhei de novo',9,'homologado','ganhei'); raise exception 'Chave duplicada aceita'; exception when unique_violation then null; end;
 begin insert into public.operacao_funil_etapas(organizacao_id,nome,ordem,status_sistema,chave_sistema) values(oa,'Perdi errado',9,'sessao','perdi'); raise exception 'Protegida incoerente aceita'; exception when check_violation then null; end;
 begin insert into public.operacao_funil_etapas(organizacao_id,nome,ordem,status_sistema) values(oa,'GANHEI',9,'sessao'); raise exception 'Nome repetido (maiúsculas) aceito'; exception when unique_violation then null; end;
 begin insert into public.operacao_funil_etapas(organizacao_id,nome,ordem,status_sistema) values(oa,'Arquivo',9,'arquivado'); raise exception 'arquivado aceito'; exception when check_violation then null; end;
 update public.operacao_funil_etapas set nome='Venci',cor='#00AA00',ordem=7 where id=ganhei;

 -- Coerência do processo.
 insert into public.operacao_funil_etapas(organizacao_id,nome,ordem,status_sistema) values(oa,'Em sessão',4,'sessao') returning id into sessao;
 update public.operacao_processos set status='sessao',etapa_id=sessao where id=pa;
 begin update public.operacao_funil_etapas set status_sistema='recurso' where id=sessao; raise exception 'Mudou estágio de etapa em uso'; exception when raise_exception then if sqlerrm not like 'Etapa em uso%' then raise; end if; end;
 update public.operacao_processos set status='recurso' where id=pa;
 if (select etapa_id from public.operacao_processos where id=pa) is not null then raise exception 'Status fora do funil não zerou etapa_id';end if;
 begin update public.operacao_processos set etapa_id=interesse where id=pa; raise exception 'Etapa incompatível aceita'; exception when check_violation then null; end;
 begin update public.operacao_processos set status='sessao',etapa_id='f3000000-0000-4000-8000-00000000003b' where id=pa; raise exception 'Etapa de outra organização aceita'; exception when foreign_key_violation then null; end;
 update public.operacao_processos set status='sessao',etapa_id=sessao where id=pa;
 delete from public.operacao_funil_etapas where id=sessao;
 select * into p from public.operacao_processos where id=pa;
 if p.etapa_id is not null or p.status<>'sessao' then raise exception 'Excluir etapa personalizada não soltou o processo';end if;

 -- Limite de 20.
 for n in 1..16 loop insert into public.operacao_funil_etapas(organizacao_id,nome,ordem,status_sistema) values(oa,'Extra '||n,10+n,'proposta_enviada'); end loop;
 if (select count(*) from public.operacao_funil_etapas where organizacao_id=oa)<>20 then raise exception 'Fixture de 20 etapas';end if;
 begin insert into public.operacao_funil_etapas(organizacao_id,nome,ordem,status_sistema) values(oa,'Extra 21',40,'sessao'); raise exception '21ª etapa aceita'; exception when raise_exception then if sqlerrm not like 'Limite de 20%' then raise; end if; end;

 -- Reordenar exige a lista completa, sem repetição.
 select array_agg(id order by ordem desc, id) into ids from public.operacao_funil_etapas where organizacao_id=oa;
 begin perform public.reordenar_etapas_funil(oa,ids[1:19]); raise exception 'Lista incompleta aceita'; exception when invalid_parameter_value then null; end;
 begin perform public.reordenar_etapas_funil(oa,ids[1:19]||ids[1]); raise exception 'Lista repetida aceita'; exception when invalid_parameter_value then null; end;
 begin perform public.reordenar_etapas_funil(oa,ids[1:19]||'f3000000-0000-4000-8000-00000000003b'::uuid); raise exception 'Etapa de B aceita na lista'; exception when invalid_parameter_value then null; end;
 begin perform public.reordenar_etapas_funil(oa,ids[1:19]||null::uuid); raise exception 'Nulo aceito na lista'; exception when invalid_parameter_value then null; end;
 if (select array_agg(id order by ordem) from public.reordenar_etapas_funil(oa,ids))<>ids then raise exception 'Reordenação não aplicada';end if;
 if (select array_agg(ordem order by ordem) from public.operacao_funil_etapas where organizacao_id=oa)<>(select array_agg(g::smallint order by g) from generate_series(0,19) g) then raise exception 'Ordem não ficou 0..19';end if;
 -- Abre uma vaga: a recusa do restrito abaixo tem de vir da RLS, não do limite.
 delete from public.operacao_funil_etapas where organizacao_id=oa and nome='Extra 16';
end $$;

-- Operador restrito a uma empresa: lê, mas não escreve etapa.
select set_config('request.jwt.claim.sub','f3000000-0000-4000-8000-000000000002',true);
do $$
declare oa uuid:='f3000000-0000-4000-8000-00000000000a'; ids uuid[]; n int;
begin
 if (select count(*) from public.operacao_funil_etapas)<>19 or (select count(*) from public.garantir_etapas_funil(oa))<>19 then raise exception 'Restrito não lê as etapas';end if;
 begin insert into public.operacao_funil_etapas(organizacao_id,nome,ordem,status_sistema) values(oa,'Do restrito',0,'sessao'); raise exception 'Restrito criou etapa'; exception when insufficient_privilege then null; end;
 update public.operacao_funil_etapas set nome='Invadido' where organizacao_id=oa; get diagnostics n=row_count;
 if n<>0 then raise exception 'Restrito alterou etapa';end if;
 delete from public.operacao_funil_etapas where organizacao_id=oa and chave_sistema is null; get diagnostics n=row_count;
 if n<>0 then raise exception 'Restrito excluiu etapa';end if;
 select array_agg(id order by ordem) into ids from public.operacao_funil_etapas;
 begin perform public.reordenar_etapas_funil(oa,ids); raise exception 'Restrito reordenou'; exception when insufficient_privilege then null; end;
end $$;

-- Gestor de outra organização não lê nem garante o funil de A.
select set_config('request.jwt.claim.sub','f3000000-0000-4000-8000-000000000003',true);
do $$
begin
 if exists(select 1 from public.operacao_funil_etapas where organizacao_id='f3000000-0000-4000-8000-00000000000a') then raise exception 'B lê etapas de A';end if;
 begin perform public.garantir_etapas_funil('f3000000-0000-4000-8000-00000000000a'); raise exception 'B garantiu funil de A'; exception when insufficient_privilege then null; end;
 begin update public.operacao_funil_etapas set organizacao_id='f3000000-0000-4000-8000-00000000000a' where id='f3000000-0000-4000-8000-00000000003b'; raise exception 'Etapa trocou de organização'; exception when raise_exception or insufficient_privilege then null; end;
end $$;

reset role;
do $$
begin
 if has_function_privilege('anon','public.garantir_etapas_funil(uuid)','EXECUTE') or has_function_privilege('anon','public.reordenar_etapas_funil(uuid,uuid[])','EXECUTE')
 or has_table_privilege('anon','public.operacao_funil_etapas','SELECT') or not has_function_privilege('authenticated','public.garantir_etapas_funil(uuid)','EXECUTE') then raise exception 'ACL do funil inválida';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname in ('garantir_etapas_funil','reordenar_etapas_funil','operacao_funil_etapas_proteger','operacao_processos_etapa_coerente')
  and not exists(select 1 from unnest(p.proconfig) c where c like 'search_path=%')) then raise exception 'Função sem search_path';end if;
 -- Excluir a organização leva as etapas protegidas junto.
 delete from public.operacao_organizacoes where id='f3000000-0000-4000-8000-00000000000a';
 if exists(select 1 from public.operacao_funil_etapas where organizacao_id='f3000000-0000-4000-8000-00000000000a') then raise exception 'Cascata da organização falhou';end if;
 raise notice 'testar_funil_etapas: ok';
end $$;
rollback;
