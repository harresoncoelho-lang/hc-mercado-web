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

set local role authenticated;
do $$ begin
 if (select count(*) from public.analise_cnpj_participacoes('11444777000161')) <> 2 then raise exception 'Logado não leu pela RPC'; end if;
 perform 1 from public.historico_cnpj_consultas;
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
