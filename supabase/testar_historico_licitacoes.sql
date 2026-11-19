-- Teste de historico_licitacoes.sql (licitação anterior). Fixtures sintéticas e rollback (nada fica no banco).
-- RLS simulada com "set local role"; não prova a API HTTP.
begin;
insert into public.historico_compras(id_compra,uasg,ano,numero,plataforma) values('78882005900332025','788820',2025,'90033','Compras.gov.br');
insert into public.historico_itens(id_compra,numero_item,catmat,situacao_item) values('78882005900332025',107,'463574','Homologado'),('78882005900332025',108,'463574','Fracassado');
insert into public.historico_participacoes(id_compra,numero_item,fornecedor_chave,fornecedor_ni,fornecedor_nome,ordem_classificacao,marca)
 values('78882005900332025',107,'38350458000143','38350458000143','C R DA SILVA',1,'Pilão'),('78882005900332025',107,'pf:p1',null,'Pessoa física',null,null);

do $$ begin
 -- CPF (11 dígitos) não entra como documento do fornecedor.
 begin
  insert into public.historico_participacoes(id_compra,numero_item,fornecedor_chave,fornecedor_ni) values('78882005900332025',107,'x','12345678901');
  raise exception 'CPF aceito em fornecedor_ni';
 exception when check_violation then null; end;
 -- Participação sem o item não entra (o cartão lê pelo item).
 begin
  insert into public.historico_participacoes(id_compra,numero_item,fornecedor_chave) values('78882005900332025',999,'y');
  raise exception 'Participação sem item aceita';
 exception when foreign_key_violation then null; end;
 -- Etapa nova aceita, etapa inventada recusada.
 if not exists (select 1 from pg_constraint where conname='operacao_esteira_tarefas_etapa_check'
                 and pg_get_constraintdef(oid) like '%historico%') then raise exception 'Etapa historico fora da regra'; end if;
 if (select count(*) from pg_constraint where conrelid='public.operacao_esteira_tarefas'::regclass and contype='c'
      and pg_get_constraintdef(oid) like '%etapa%')<>1 then raise exception 'Regra de etapa duplicada'; end if;
 if to_regclass('public.historico_participacoes_ni_idx') is null then raise exception 'Índice por CNPJ do fornecedor ausente'; end if;
end $$;

-- Dado antigo com CPF (gravado antes do CHECK): a limpeza do .sql tira só o CPF e é idempotente.
alter table public.historico_participacoes drop constraint historico_participacoes_nome_sem_cpf;
insert into public.historico_participacoes(id_compra,numero_item,fornecedor_chave,fornecedor_ni,fornecedor_nome) values('78882005900332025',108,'12345678000195','12345678000195','FULANA DE TAL 970 481 432 15');
do $$ declare n int; begin
 update public.historico_participacoes set fornecedor_nome = nullif(btrim(regexp_replace(regexp_replace(fornecedor_nome, '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y', ' ', 'g'), '\s+', ' ', 'g')), '') where fornecedor_nome ~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y';
 get diagnostics n = row_count;
 if n <> 1 then raise exception 'limpeza de CPF tocou % linhas', n; end if;
 if (select fornecedor_nome from public.historico_participacoes where numero_item=108 and fornecedor_chave='12345678000195') <> 'FULANA DE TAL' then raise exception 'limpeza de CPF errada'; end if;
 update public.historico_participacoes set fornecedor_nome = nullif(btrim(regexp_replace(regexp_replace(fornecedor_nome, '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y', ' ', 'g'), '\s+', ' ', 'g')), '') where fornecedor_nome ~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y';
 get diagnostics n = row_count;
 if n <> 0 then raise exception 'limpeza de CPF não é idempotente'; end if;
end $$;
alter table public.historico_participacoes add constraint historico_participacoes_nome_sem_cpf check (fornecedor_nome !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y');
do $$ declare v text; begin
 foreach v in array array['FULANA 97048143215','FULANA 970.481.432-15','FULANA 970 481 432 15','FULANA 970.481.432/15'] loop
  begin update public.historico_participacoes set fornecedor_nome = v where numero_item=108 and fornecedor_chave='12345678000195'; raise exception 'CPF aceito em historico_participacoes.fornecedor_nome: %', v;
  exception when check_violation then null; end;
 end loop;
 update public.historico_participacoes set fornecedor_nome = 'EMPRESA 11.222.333/0001-81 LTDA' where numero_item=108 and fornecedor_chave='12345678000195'; -- CNPJ formatado não é CPF
end $$;
delete from public.historico_participacoes where numero_item=108 and fornecedor_chave='12345678000195';
-- Usuário logado lê; não escreve. Anônimo não lê.
set local role authenticated;
do $$ begin
 if (select count(*) from public.historico_participacoes where id_compra='78882005900332025')<>2 then raise exception 'Logado não leu as participações'; end if;
 if (select count(*) from public.historico_itens where situacao_item='Fracassado')<1 then raise exception 'Logado não leu o fracassado'; end if;
 begin insert into public.historico_compras(id_compra) values('99999999999999999'); raise exception 'Logado inseriu compra';
 exception when insufficient_privilege then null; end;
 begin update public.historico_participacoes set marca='Outra'; raise exception 'Logado alterou marca';
 exception when insufficient_privilege then null; end;
 begin delete from public.historico_consultas; raise exception 'Logado apagou consulta';
 exception when insufficient_privilege then null; end;
 -- Cache de consultas não é lido por tela nenhuma: logado não lê (só a função, com service_role).
 begin perform 1 from public.historico_consultas; raise exception 'Logado leu historico_consultas';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform 1 from public.historico_compras; raise exception 'Anônimo leu compras';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
