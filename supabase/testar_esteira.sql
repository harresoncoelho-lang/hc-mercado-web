-- PREPARADO, NÃO EXECUTADO EM PRODUÇÃO. Clone isolado ou PGlite com 01-aplicar.sql e
-- operacao_esteira.sql aplicados. Fixtures sintéticas e rollback.
-- RLS simulada com "set local role" + request.jwt.claim.sub; não prova a API HTTP.
-- Gestor f7..01 (org inteira), operador f7..02 restrito à empresa A2.
begin;
insert into auth.users(id,email) values
 ('f7000000-0000-4000-8000-000000000001','esteira-a@qa.invalid'),('f7000000-0000-4000-8000-000000000002','esteira-r@qa.invalid');
insert into public.clientes(id,nome,email,status) values
 ('f7000000-0000-4000-8000-000000000001','QA esteira A','esteira-a@qa.invalid','aprovado'),
 ('f7000000-0000-4000-8000-000000000002','QA esteira R','esteira-r@qa.invalid','aprovado');
insert into public.operacao_organizacoes(id,nome,owner_id) values
 ('f7000000-0000-4000-8000-00000000000a','QA esteira','f7000000-0000-4000-8000-000000000001');
insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values
 ('f7000000-0000-4000-8000-00000000001a','f7000000-0000-4000-8000-00000000000a','QA esteira empresa A','11222333000181'),
 ('f7000000-0000-4000-8000-00000000001b','f7000000-0000-4000-8000-00000000000a','QA esteira empresa A2','22333444000181');
insert into public.operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values
 ('f7000000-0000-4000-8000-00000000000a','f7000000-0000-4000-8000-000000000001','gestor',null),
 ('f7000000-0000-4000-8000-00000000000a','f7000000-0000-4000-8000-000000000002','operador','f7000000-0000-4000-8000-00000000001b');
-- (seg,UF) não vale: a esteira procura segmento '*'. Entre (*,AM) e (*,*), vence (*,AM).
insert into public.operacao_premissas_empresa(organizacao_id,empresa_id,segmento,uf,tributos_percentual,frete_percentual,garantia_percentual,margem_percentual,margem_minima_percentual) values
 ('f7000000-0000-4000-8000-00000000000a','f7000000-0000-4000-8000-00000000001a','*','*',1,1,1,10,1),
 ('f7000000-0000-4000-8000-00000000000a','f7000000-0000-4000-8000-00000000001a','*','AM',8,5,2,12,4),
 ('f7000000-0000-4000-8000-00000000000a','f7000000-0000-4000-8000-00000000001a','limpeza','AM',9,9,9,99,9);
-- UF chega pelo edital coletado (o processo não tem UF). Mesmas colunas de schema_oportunidades.sql.
create table if not exists public.oportunidades_abertas(chave text primary key, numero_controle_pncp text, objeto text not null default '',
 uf text, publicacao date, encerramento date, dado jsonb not null, atualizado_em timestamptz not null default now());
insert into public.oportunidades_abertas(chave,numero_controle_pncp,uf,dado) values
 ('qa-esteira-1','11222333000181-1-000001/2026',' am','{}'),('qa-esteira-5','11222333000181-1-000005/2026','AM','{}');
-- Edital já pedido pelo boletim: a esteira só sobe a prioridade.
insert into public.fila_dossies(numero_controle_pncp,origem) values ('11222333000181-1-000005/2026','boletim');

set local role authenticated;
select set_config('request.jwt.claim.sub','f7000000-0000-4000-8000-000000000001',true);
-- 21: PNCP, quinta 10/12; 22: margem manual; 23: arquivado; 24: sem ID do PNCP; 25: sem valor, segunda 14/12.
insert into public.operacao_processos(id,organizacao_id,empresa_id,objeto,origem_externa_id,valor_estimado,data_sessao,margem_percentual,status,atualizado_em) values
 ('f7000000-0000-4000-8000-000000000021','f7000000-0000-4000-8000-00000000000a','f7000000-0000-4000-8000-00000000001a','QA novo','11222333000181-1-000001/2026',1000,'2026-12-10 10:00-03',null,'triagem','2020-01-01'),
 ('f7000000-0000-4000-8000-000000000022','f7000000-0000-4000-8000-00000000000a','f7000000-0000-4000-8000-00000000001a','QA manual','11222333000181-1-000002/2026',1000,null,30,'triagem','2020-01-01'),
 ('f7000000-0000-4000-8000-000000000023','f7000000-0000-4000-8000-00000000000a','f7000000-0000-4000-8000-00000000001a','QA arquivado','11222333000181-1-000003/2026',1000,'2026-12-10 10:00-03',null,'arquivado','2020-01-01'),
 ('f7000000-0000-4000-8000-000000000024','f7000000-0000-4000-8000-00000000000a','f7000000-0000-4000-8000-00000000001a','QA manual sem PNCP','pedido-123',1000,'2026-12-10 10:00-03',null,'triagem','2020-01-01'),
 ('f7000000-0000-4000-8000-000000000025','f7000000-0000-4000-8000-00000000000a','f7000000-0000-4000-8000-00000000001a','QA sem valor','11222333000181-1-000005/2026',null,'2026-12-14 09:00-03',null,'preparacao','2020-01-01');

do $$
declare p1 uuid:='f7000000-0000-4000-8000-000000000021'; s text; n int; r record;
begin
 -- Processo novo: 6 tarefas pendentes (com a 'historico', licitação anterior) do criador, 1 pedido 'interesse', 2 prazos 3 dias úteis antes.
 select string_agg(etapa||'/'||estado,',' order by etapa), count(*) filter (where criado_por='f7000000-0000-4000-8000-000000000001') into s,n
  from public.operacao_esteira_tarefas where processo_id=p1;
 if s is distinct from 'contrato/pendente,cruzamento/pendente,exigencias/pendente,historico/pendente,itens/pendente,resultado/pendente' or n<>6 then raise exception 'Tarefas do processo novo: % (%)',s,n;end if;
 select string_agg(categoria||'='||titulo||'@'||to_char(vencimento at time zone 'America/Sao_Paulo','YYYY-MM-DD HH24:MI'),',' order by categoria) into s
  from public.operacao_prazos_processo where processo_id=p1 and observacoes='calculado pela regra legal; confira o edital';
 if s is distinct from 'esclarecimento=Esclarecimento@2026-12-07 23:59,impugnacao=Impugnação@2026-12-07 23:59' then raise exception 'Prazos legais: %',s;end if;
 select string_agg(to_char(vencimento at time zone 'America/Sao_Paulo','YYYY-MM-DD'),',') into s from public.operacao_prazos_processo where processo_id='f7000000-0000-4000-8000-000000000025';
 if s is distinct from '2026-12-09,2026-12-09' then raise exception 'Sessão na segunda não pulou o fim de semana: %',s;end if;

 -- Premissas da regra (*,AM); frete vira valor; atualizado_em intacto.
 select * into r from public.operacao_processos where id=p1;
 if (r.frete,r.tributos_percentual,r.garantia_percentual,r.margem_percentual,r.margem_minima_percentual,r.premissas_fonte)
    is distinct from (50.00::numeric,8::numeric,2::numeric,12::numeric,4::numeric,'padrao'::text) or r.premissas_aplicadas_em is null
  then raise exception 'Premissas copiadas: %',r;end if;
 if r.atualizado_em<>'2020-01-01' then raise exception 'Gatilho mudou atualizado_em';end if;
 select * into r from public.operacao_processos where id='f7000000-0000-4000-8000-000000000025';
 if r.frete is not null or r.margem_percentual<>12 or r.premissas_fonte<>'padrao' then raise exception 'Sem valor estimado: %',r;end if;

 -- Premissa manual não é sobrescrita (mas a esteira roda).
 select * into r from public.operacao_processos where id='f7000000-0000-4000-8000-000000000022';
 if r.margem_percentual<>30 or r.tributos_percentual is not null or r.premissas_fonte is not null then raise exception 'Premissa manual sobrescrita: %',r;end if;
 if (select count(*) from public.operacao_esteira_tarefas where processo_id=r.id)<>6 then raise exception 'Processo com premissa manual sem tarefas';end if;

 -- Arquivado e sem ID do PNCP não disparam.
 if exists(select 1 from public.operacao_esteira_tarefas where processo_id in ('f7000000-0000-4000-8000-000000000023','f7000000-0000-4000-8000-000000000024'))
  or exists(select 1 from public.operacao_prazos_processo where processo_id in ('f7000000-0000-4000-8000-000000000023','f7000000-0000-4000-8000-000000000024'))
  or (select premissas_fonte from public.operacao_processos where id='f7000000-0000-4000-8000-000000000023') is not null
  then raise exception 'Arquivado ou sem ID do PNCP disparou';end if;

 -- Usuário não escreve tarefa.
 begin insert into public.operacao_esteira_tarefas(organizacao_id,empresa_id,processo_id,etapa)
  values('f7000000-0000-4000-8000-00000000000a','f7000000-0000-4000-8000-00000000001a','f7000000-0000-4000-8000-000000000024','itens');
  raise exception 'Usuário inseriu tarefa'; exception when insufficient_privilege then null; end;
 begin update public.operacao_esteira_tarefas set estado='feito' where processo_id=p1; raise exception 'Usuário alterou tarefa';
 exception when insufficient_privilege then null; end;
 begin delete from public.operacao_esteira_tarefas where processo_id=p1; raise exception 'Usuário apagou tarefa';
 exception when insufficient_privilege then null; end;

 -- Operador de outra empresa não lê.
 perform set_config('request.jwt.claim.sub','f7000000-0000-4000-8000-000000000002',true);
 if exists(select 1 from public.operacao_esteira_tarefas) then raise exception 'Operador da A2 leu tarefas da A';end if;
 perform set_config('request.jwt.claim.sub','f7000000-0000-4000-8000-000000000001',true);
end $$;

-- O robô apaga as tarefas do 21 para provar que UPDATE de outra coluna não recria.
set local role service_role;
delete from public.operacao_esteira_tarefas where processo_id='f7000000-0000-4000-8000-000000000021';
do $$ begin
 -- Fila: 1 pedido por edital; 'interesse' (inclusive o que veio do boletim) só para edital coletado em oportunidades_abertas;
 -- o 000002 não foi coletado e entra como 'clique'. Origem fora da lista é recusada.
 if (select string_agg(numero_controle_pncp||'='||origem,',' order by numero_controle_pncp) from public.fila_dossies where numero_controle_pncp like '11222333000181-1-%')
  is distinct from '11222333000181-1-000001/2026=interesse,11222333000181-1-000002/2026=clique,11222333000181-1-000005/2026=interesse'
  then raise exception 'Fila: %',(select string_agg(numero_controle_pncp||'='||origem,',') from public.fila_dossies);end if;
 begin insert into public.fila_dossies(numero_controle_pncp,origem) values('qa-x','outra'); raise exception 'Origem inválida aceita';
 exception when check_violation then null; end;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','f7000000-0000-4000-8000-000000000001',true);
update public.operacao_processos set objeto='QA novo editado', frete=null, tributos_percentual=null, garantia_percentual=null,
 margem_percentual=null, margem_minima_percentual=null where id='f7000000-0000-4000-8000-000000000021';
do $$ begin
 if exists(select 1 from public.operacao_esteira_tarefas where processo_id='f7000000-0000-4000-8000-000000000021') then raise exception 'UPDATE de outra coluna disparou';end if;
 if (select margem_percentual from public.operacao_processos where id='f7000000-0000-4000-8000-000000000021') is not null then raise exception 'UPDATE de outra coluna reaplicou premissas';end if;
end $$;
-- Mesmo status de novo (o painel sempre manda status): segunda execução recria só o que falta.
update public.operacao_processos set status='triagem' where id='f7000000-0000-4000-8000-000000000021';
update public.operacao_processos set status='preparacao' where id='f7000000-0000-4000-8000-000000000021';
-- Arquivado que volta ao Funil passa a disparar; ativo que vai para status final não apaga nada.
update public.operacao_processos set status='triagem' where id='f7000000-0000-4000-8000-000000000023';
update public.operacao_processos set status='perdido' where id='f7000000-0000-4000-8000-000000000025';
do $$ declare r record; begin
 if (select count(*) from public.operacao_esteira_tarefas where processo_id='f7000000-0000-4000-8000-000000000021')<>6
  or (select count(*) from public.operacao_prazos_processo where processo_id='f7000000-0000-4000-8000-000000000021')<>2
  then raise exception 'Duas execuções duplicaram ou não recriaram';end if;
 select * into r from public.operacao_processos where id='f7000000-0000-4000-8000-000000000021';
 if r.margem_percentual<>12 or r.atualizado_em<>'2020-01-01' then raise exception 'Reexecução: %',r;end if;
 if (select count(*) from public.operacao_esteira_tarefas where processo_id='f7000000-0000-4000-8000-000000000023')<>6 then raise exception 'Arquivado reaberto não disparou';end if;
 if (select count(*) from public.operacao_esteira_tarefas where processo_id='f7000000-0000-4000-8000-000000000025')<>6
  or (select count(*) from public.operacao_prazos_processo where processo_id='f7000000-0000-4000-8000-000000000025')<>2
  or (select premissas_fonte from public.operacao_processos where id='f7000000-0000-4000-8000-000000000025')<>'padrao'
  then raise exception 'Status final apagou algo';end if;
end $$;

-- fila_dossies não tem policy: só o service_role confere.
set local role service_role;
do $$ begin
 if (select count(*) from public.fila_dossies where numero_controle_pncp like '11222333000181-1-%')<>4
  or (select string_agg(numero_controle_pncp,',' order by numero_controle_pncp) from public.fila_dossies where origem='interesse' and numero_controle_pncp like '11222333000181-1-%')
     is distinct from '11222333000181-1-000001/2026,11222333000181-1-000005/2026'
  then raise exception 'Fila duplicou ou perdeu prioridade';end if;
end $$;

-- M1: troca de status depois da primeira entrada não sobe prioridade (a fila volta a 'clique' e fica).
update public.fila_dossies set origem='clique' where numero_controle_pncp='11222333000181-1-000001/2026';
set local role authenticated;
select set_config('request.jwt.claim.sub','f7000000-0000-4000-8000-000000000001',true);
update public.operacao_processos set status='preparacao' where id='f7000000-0000-4000-8000-000000000021';
update public.operacao_processos set status='triagem' where id='f7000000-0000-4000-8000-000000000021';
-- ID do PNCP inventado (não coletado): entra como 'clique'.
insert into public.operacao_processos(organizacao_id,empresa_id,objeto,origem_externa_id,status) values
 ('f7000000-0000-4000-8000-00000000000a','f7000000-0000-4000-8000-00000000001a','QA inventado','99999999000199-1-1/2026','triagem');
-- B2: operador forja criado_por=gestor; o processo e as tarefas ficam com quem tem o JWT.
select set_config('request.jwt.claim.sub','f7000000-0000-4000-8000-000000000002',true);
insert into public.operacao_processos(id,organizacao_id,empresa_id,objeto,origem_externa_id,status,criado_por) values
 ('f7000000-0000-4000-8000-000000000026','f7000000-0000-4000-8000-00000000000a','f7000000-0000-4000-8000-00000000001b','QA forjado','22333444000181-1-000001/2026','triagem','f7000000-0000-4000-8000-000000000001');
-- M1: 50 processos novos numa organização, todos com edital coletado: no máximo 20 'interesse' no dia.
reset role;
insert into public.operacao_organizacoes(id,nome,owner_id) values ('f7000000-0000-4000-8000-00000000000c','QA esteira teto','f7000000-0000-4000-8000-000000000002');
insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values ('f7000000-0000-4000-8000-00000000001c','f7000000-0000-4000-8000-00000000000c','QA teto','33444555000181');
insert into public.oportunidades_abertas(chave,numero_controle_pncp,uf,dado)
 select 'qa-teto-'||g,'33444555000181-1-'||lpad(g::text,6,'0')||'/2026','AM','{}' from generate_series(1,50) g;
insert into public.operacao_processos(organizacao_id,empresa_id,objeto,origem_externa_id,status)
 select 'f7000000-0000-4000-8000-00000000000c','f7000000-0000-4000-8000-00000000001c','QA teto '||g,'33444555000181-1-'||lpad(g::text,6,'0')||'/2026','triagem' from generate_series(1,50) g;
do $$ declare s text; begin
 if (select origem from public.fila_dossies where numero_controle_pncp='11222333000181-1-000001/2026')<>'clique'
  then raise exception 'Troca de status subiu a prioridade de novo';end if;
 if (select origem from public.fila_dossies where numero_controle_pncp='99999999000199-1-1/2026') is distinct from 'clique'
  then raise exception 'ID inventado virou interesse';end if;
 select string_agg(distinct coalesce(criado_por::text,'nulo'),',') into s from public.operacao_esteira_tarefas where processo_id='f7000000-0000-4000-8000-000000000026';
 if s is distinct from 'f7000000-0000-4000-8000-000000000002'
  or (select criado_por from public.operacao_processos where id='f7000000-0000-4000-8000-000000000026')<>'f7000000-0000-4000-8000-000000000002'
  then raise exception 'criado_por forjado: processo/tarefas = %',s;end if;
 if (select count(*) from public.fila_dossies where numero_controle_pncp like '33444555000181-1-%' and origem='interesse')<>20
  or (select count(*) from public.fila_dossies where numero_controle_pncp like '33444555000181-1-%' and origem='clique')<>30
  then raise exception 'Teto diário de interesse: % interesse',(select count(*) from public.fila_dossies where numero_controle_pncp like '33444555000181-1-%' and origem='interesse');end if;
end $$;

-- Tentar de novo: só gestor/operador da empresa, só etapa 'falhou', no máximo 3 por processo/etapa por dia.
reset role;
insert into auth.users(id,email) values
 ('f7000000-0000-4000-8000-000000000003','esteira-l@qa.invalid'),('f7000000-0000-4000-8000-000000000004','esteira-o@qa.invalid');
insert into public.clientes(id,nome,email,status) values
 ('f7000000-0000-4000-8000-000000000003','QA esteira L','esteira-l@qa.invalid','aprovado'),
 ('f7000000-0000-4000-8000-000000000004','QA esteira O','esteira-o@qa.invalid','aprovado');
insert into public.operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values
 ('f7000000-0000-4000-8000-00000000000a','f7000000-0000-4000-8000-000000000003','leitura',null),
 ('f7000000-0000-4000-8000-00000000000c','f7000000-0000-4000-8000-000000000004','gestor',null);
update public.operacao_esteira_tarefas set estado='falhou', tentativas=5, erro='HTTP 500', proximo_em=now()+interval '1 day', detalhe='{"total":3}'
 where processo_id='f7000000-0000-4000-8000-000000000021' and etapa='itens';
update public.operacao_esteira_tarefas set estado='pendente'
 where processo_id='f7000000-0000-4000-8000-000000000021' and etapa='exigencias';
set local role authenticated;
do $$ declare p uuid:='f7000000-0000-4000-8000-000000000021'; u text; r record; begin
 -- Leitura da mesma org, gestor de outra org e operador de outra empresa: mesmo erro, nada muda.
 foreach u in array array['f7000000-0000-4000-8000-000000000003','f7000000-0000-4000-8000-000000000004','f7000000-0000-4000-8000-000000000002'] loop
  perform set_config('request.jwt.claim.sub',u,true);
  begin perform public.esteira_tentar_de_novo(p,'itens'); raise exception 'Recolocou sem permissão: %',u;
  exception when insufficient_privilege then null; end;
 end loop;
 perform set_config('request.jwt.claim.sub','f7000000-0000-4000-8000-000000000001',true);
 begin perform public.esteira_tentar_de_novo('f7000000-0000-4000-8000-0000000000ff','itens'); raise exception 'Processo inexistente aceito';
 exception when insufficient_privilege then null; end;
 -- Etapa que não falhou é recusada.
 begin perform public.esteira_tentar_de_novo(p,'exigencias'); raise exception 'Etapa pendente recolocada';
 exception when raise_exception then if sqlerrm not like 'Só uma etapa que falhou%' then raise; end if; end;
 select * into r from public.operacao_esteira_tarefas where processo_id=p and etapa='itens';
 if r.estado<>'falhou' or r.tentativas<>5 then raise exception 'Recusa mexeu na tarefa: %',r;end if;
 -- Gestor recoloca: pendente, tentativas 0, agora, sem erro; detalhe do robô fica e a contagem sobe.
 perform public.esteira_tentar_de_novo(p,'itens');
 select * into r from public.operacao_esteira_tarefas where processo_id=p and etapa='itens';
 if r.estado<>'pendente' or r.tentativas<>0 or r.erro is not null or r.proximo_em>now()
    or (r.detalhe->>'total')::int<>3 or (r.detalhe->'recolocacoes'->>'total')::int<>1
  then raise exception 'Recolocação: %',r;end if;
end $$;
-- Robô regrava detalhe (sem recolocacoes) e falha de novo duas vezes: a contagem continua; a 4ª no dia é recusada.
set local role service_role;
update public.operacao_esteira_tarefas set estado='falhou', detalhe='{"total":3}' where processo_id='f7000000-0000-4000-8000-000000000021' and etapa='itens';
set local role authenticated;
select set_config('request.jwt.claim.sub','f7000000-0000-4000-8000-000000000001',true);
select public.esteira_tentar_de_novo('f7000000-0000-4000-8000-000000000021','itens');
set local role service_role;
update public.operacao_esteira_tarefas set estado='falhou' where processo_id='f7000000-0000-4000-8000-000000000021' and etapa='itens';
set local role authenticated;
select set_config('request.jwt.claim.sub','f7000000-0000-4000-8000-000000000001',true);
select public.esteira_tentar_de_novo('f7000000-0000-4000-8000-000000000021','itens');
set local role service_role;
update public.operacao_esteira_tarefas set estado='falhou' where processo_id='f7000000-0000-4000-8000-000000000021' and etapa='itens';
set local role authenticated;
select set_config('request.jwt.claim.sub','f7000000-0000-4000-8000-000000000001',true);
do $$ declare r record; begin
 begin perform public.esteira_tentar_de_novo('f7000000-0000-4000-8000-000000000021','itens'); raise exception 'Quarta recolocação no dia aceita';
 exception when raise_exception then if sqlerrm not like '%3 vezes hoje%' then raise; end if; end;
 select * into r from public.operacao_esteira_tarefas where processo_id='f7000000-0000-4000-8000-000000000021' and etapa='itens';
 if r.estado<>'falhou' or (r.detalhe->'recolocacoes'->>'total')::int<>3 then raise exception 'Teto diário: %',r;end if;
end $$;
-- Contagem de outro dia não vale: volta a liberar.
set local role service_role;
update public.operacao_esteira_tarefas set detalhe='{"recolocacoes":{"dia":"2000-01-01","total":3}}' where processo_id='f7000000-0000-4000-8000-000000000021' and etapa='itens';
set local role authenticated;
select set_config('request.jwt.claim.sub','f7000000-0000-4000-8000-000000000001',true);
select public.esteira_tentar_de_novo('f7000000-0000-4000-8000-000000000021','itens');
do $$ begin
 if (select detalhe->'recolocacoes'->>'total' from public.operacao_esteira_tarefas where processo_id='f7000000-0000-4000-8000-000000000021' and etapa='itens')<>'1'
  then raise exception 'Contagem de outro dia não zerou';end if;
end $$;

set local role anon;
do $$ begin
 begin perform 1 from public.operacao_esteira_tarefas; raise exception 'anon leu tarefas'; exception when insufficient_privilege then null; end;
 begin perform public.esteira_tentar_de_novo('f7000000-0000-4000-8000-000000000021','itens'); raise exception 'anon recolocou';
 exception when insufficient_privilege then null; end;
 raise notice 'testar_esteira: ok';
end $$;
rollback;
