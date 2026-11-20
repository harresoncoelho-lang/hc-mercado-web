-- Teste de analise_cnpj.sql. Fixtures sintéticas e rollback (nada fica no banco).
-- RLS simulada com "set local role"; não prova a API HTTP.
begin;
insert into public.historico_compras(id_compra,uasg,ano,numero,plataforma,uf,orgao_nome) values
 ('99999905900012025','788820',2025,'90033/2025','Compras.gov.br','AM','COMANDO DA MARINHA');
insert into public.historico_itens(id_compra,numero_item,descricao,situacao_item) values
 ('99999905900012025',107,'Café torrado','Homologado'),('99999905900012025',108,'Café em grão','Fracassado'),
 ('99999905900012025',109,'Café solúvel','Homologado');
insert into public.historico_participacoes(id_compra,numero_item,fornecedor_chave,fornecedor_ni,fornecedor_nome,ordem_classificacao,classificacao,valor_homologado,valor_lance,situacao_proposta) values
 ('99999905900012025',107,'11444777000161','11444777000161','C R DA SILVA',1,1,17,17,'6'),
 ('99999905900012025',107,'12345678000195','12345678000195','F. M. DE MORAES LTDA',null,2,null,18.5,null),
 ('99999905900012025',108,'12345678000195','12345678000195','F. M. DE MORAES LTDA',null,1,null,20,'2'),
 ('99999905900012025',109,'12345678000195','12345678000195','F. M. DE MORAES LTDA',null,null,null,30,'2'),
 ('99999905900012025',109,'11444777000161','11444777000161','C R DA SILVA',null,1,null,31,'6');

do $$ declare r record; n int; begin
 begin
  insert into public.historico_participacoes(id_compra,numero_item,fornecedor_chave,situacao_proposta) values('99999905900012025',107,'z','seis');
  raise exception 'situacao_proposta não numérica aceita';
 exception when check_violation then null; end;
 begin insert into public.historico_cnpj_consultas(cnpj) values('12345678901'); raise exception 'CPF aceito na fila';
 exception when check_violation then null; end;
 select count(*) into n from public.analise_cnpj_participacoes('12345678000195');
 if n <> 3 then raise exception 'Esperava 3 itens do CNPJ, veio %', n; end if;
 select * into r from public.analise_cnpj_participacoes('12345678000195') where numero_item = 107;
 if r.vencedor_ni <> '11444777000161' or r.vencedor_valor <> 17 or r.uf <> 'AM' then raise exception 'Vencedor/UF errados no item 107: %', row_to_json(r); end if;
 -- Recusado (código 2) não é vencedor do item fracassado; o vencedor do 109 é o outro, mesmo com valor maior.
 select * into r from public.analise_cnpj_participacoes('12345678000195') where numero_item = 108;
 if r.vencedor_ni is not null then raise exception 'Recusado contado como vencedor'; end if;
 select * into r from public.analise_cnpj_participacoes('12345678000195') where numero_item = 109;
 if r.vencedor_ni <> '11444777000161' then raise exception 'Vencedor do 109 errado'; end if;
 if (select count(*) from public.analise_cnpj_participacoes('4888592200015x')) <> 0 then raise exception 'CNPJ inválido devolveu linhas'; end if;
end $$;

-- Teto por CNPJ: idade > 37 meses apaga; teto mínimo de 100 linhas não apaga as 3 restantes; outro CNPJ intacto.
insert into public.historico_compras(id_compra,uasg,ano,data_publicacao) values('99999905900012019','788820',2019,'2019-03-01');
insert into public.historico_itens(id_compra,numero_item) values('99999905900012019',1);
insert into public.historico_participacoes(id_compra,numero_item,fornecedor_chave,fornecedor_ni,fornecedor_nome) values('99999905900012019',1,'12345678000195','12345678000195','F. M. DE MORAES LTDA');
set local role service_role;
do $$ declare r record; begin
 select * into r from public.historico_participacoes_podar(array['12345678000195','x'], 1, 1);
 if r.cnpj <> '12345678000195' or r.apagadas <> 1 or r.linhas <> 3 then raise exception 'poda errada: %', row_to_json(r); end if;
 if (select count(*) from public.historico_participacoes_podar(array['12345678000195'])) <> 1 then raise exception 'poda sem retorno'; end if;
 if (select apagadas from public.historico_participacoes_podar(array['12345678000195'])) <> 0 then raise exception 'poda não idempotente'; end if;
 if (select count(*) from public.analise_cnpj_participacoes('11444777000161')) <> 2 then raise exception 'poda tocou outro CNPJ'; end if;
end $$;
-- Prazo de guarda do cache: 30 dias; mínimo 8 (a validade do cache é 7).
insert into public.historico_cnpj_consultas(cnpj,gerado_em) values('48885922000150',now()-interval '31 days'),('38350458000143',now()-interval '5 days');
insert into public.historico_consultas(chave,uasg,desde_ano,gerado_em) values('qa-velha','788820',2023,now()-interval '40 days'),('qa-nova','788820',2023,now());
do $$ begin
 if public.historico_limpar_cache(30) <> 2 then raise exception 'limpeza do cache de 30 dias errada'; end if;
 if public.historico_limpar_cache(1) <> 0 then raise exception 'limpeza ignorou o mínimo de 8 dias (apagou o de 5 dias)'; end if;
 if not exists (select 1 from public.historico_cnpj_consultas where cnpj='38350458000143') or not exists (select 1 from public.historico_consultas where chave='qa-nova') then raise exception 'limpeza apagou cache novo'; end if;
end $$;
reset role;
-- Dado antigo com CPF (gravado antes do CHECK): a limpeza do .sql tira só o CPF e é idempotente.
alter table public.historico_cnpj_consultas drop constraint historico_cnpj_consultas_nome_sem_cpf;
insert into public.historico_cnpj_consultas(cnpj,nome) values('11444777000161','FULANA DE TAL 970.481.432/15');
do $$ declare n int; begin
 update public.historico_cnpj_consultas set nome = nullif(btrim(regexp_replace(regexp_replace(nome, '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y', ' ', 'g'), '\s+', ' ', 'g')), '') where nome ~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y';
 get diagnostics n = row_count;
 if n <> 1 then raise exception 'limpeza de CPF tocou % linhas', n; end if;
 if (select nome from public.historico_cnpj_consultas where cnpj='11444777000161') <> 'FULANA DE TAL' then raise exception 'limpeza de CPF errada'; end if;
 update public.historico_cnpj_consultas set nome = nullif(btrim(regexp_replace(regexp_replace(nome, '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y', ' ', 'g'), '\s+', ' ', 'g')), '') where nome ~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y';
 get diagnostics n = row_count;
 if n <> 0 then raise exception 'limpeza de CPF não é idempotente'; end if;
end $$;
alter table public.historico_cnpj_consultas add constraint historico_cnpj_consultas_nome_sem_cpf check (nome !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y');
do $$ declare v text; begin
 foreach v in array array['FULANA 97048143215','FULANA 970.481.432-15','FULANA 970 481 432 15','FULANA 970.481.432/15'] loop
  begin update public.historico_cnpj_consultas set nome = v where cnpj='11444777000161'; raise exception 'CPF aceito em historico_cnpj_consultas.nome: %', v;
  exception when check_violation then null; end;
 end loop;
 update public.historico_cnpj_consultas set nome = 'EMPRESA 11.222.333/0001-81 LTDA' where cnpj='11444777000161'; -- CNPJ formatado não é CPF
end $$;
do $$ declare f text; begin
 foreach f in array array['historico_participacoes_podar(text[],integer,integer)','historico_limpar_cache(integer)'] loop
  if has_function_privilege('authenticated','public.'||f,'EXECUTE') or has_function_privilege('anon','public.'||f,'EXECUTE') then raise exception 'logado/anon executa %', f; end if;
 end loop;
 if has_table_privilege('authenticated','public.historico_cnpj_consultas','SELECT') then raise exception 'logado lê a fila (tem solicitante)'; end if;
end $$;
reset role;
insert into auth.users(id,email) values ('c9200000-0000-4000-8000-000000000001','cnpj-a@qa.invalid');
insert into public.clientes(id,nome,email,status) values ('c9200000-0000-4000-8000-000000000001','QA cnpj A','cnpj-a@qa.invalid','aprovado');
set local role authenticated;
select set_config('request.jwt.claim.sub','c9200000-0000-4000-8000-000000000001',true);
do $$ begin
 if (select count(*) from public.analise_cnpj_participacoes('11444777000161')) <> 2 then raise exception 'Logado não leu pela RPC'; end if;
 begin perform 1 from public.historico_cnpj_consultas; raise exception 'Logado leu a fila';
 exception when insufficient_privilege then null; end;
 begin insert into public.historico_cnpj_consultas(cnpj) values('12345678000195'); raise exception 'Logado escreveu na fila';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform 1 from public.analise_cnpj_participacoes('11444777000161'); raise exception 'Anônimo chamou a RPC';
 exception when insufficient_privilege then null; end;
 begin perform 1 from public.historico_cnpj_consultas; raise exception 'Anônimo leu a fila';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
