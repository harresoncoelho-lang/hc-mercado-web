-- Teste de sinapi.sql. Dados fictícios e rollback (nada fica no banco).
-- Papéis simulados com "set local role"; não prova a API HTTP do PostgREST.
begin;
set local role service_role;
insert into public.sinapi_precos(uf,tipo,desonerado,codigo,descricao,unidade,preco,referencia,busca) values
 ('ZZ','insumo',false,'990001','QA areia média','M3',120.50,'2026-09-01','qa areia media'),
 ('ZZ','composicao',true,'990002','QA alvenaria','M2',88.10,'2026-09-01','qa alvenaria');
-- Upsert pela chave (mesmo caminho do robô) com a referência nova; a 990002 não voltou.
insert into public.sinapi_precos(uf,tipo,desonerado,codigo,descricao,unidade,preco,referencia,busca) values
 ('ZZ','insumo',false,'990001','QA areia média','M3',125.00,'2026-10-01','qa areia media')
 on conflict (uf,tipo,desonerado,codigo) do update set preco=excluded.preco,referencia=excluded.referencia;
delete from public.sinapi_precos where uf='ZZ' and referencia<'2026-10-01';
do $$ begin
 if (select count(*) from public.sinapi_precos where uf='ZZ')<>1 then raise exception 'upsert/limpeza errados'; end if;
 if (select preco from public.sinapi_precos where codigo='990001' and uf='ZZ')<>125.00 then raise exception 'upsert não atualizou'; end if;
 begin insert into public.sinapi_precos(uf,tipo,desonerado,codigo,descricao,preco,referencia) values('ZZ','insumo',false,'abc','x',1,'2026-10-01'); raise exception 'código não numérico aceito';
 exception when check_violation then null; end;
 begin insert into public.sinapi_precos(uf,tipo,desonerado,codigo,descricao,preco,referencia) values('ZZ','insumo',false,'1','x',0,'2026-10-01'); raise exception 'preço zero aceito';
 exception when check_violation then null; end;
 begin insert into public.sinapi_precos(uf,tipo,desonerado,codigo,descricao,preco,referencia) values('ZZ','servico',false,'1','x',1,'2026-10-01'); raise exception 'tipo inválido aceito';
 exception when check_violation then null; end;
 begin insert into public.sinapi_precos(uf,tipo,desonerado,codigo,descricao,preco,referencia) values('ZZ','insumo',false,'1','x',1,'2026-10-15'); raise exception 'referência fora do dia 1 aceita';
 exception when check_violation then null; end;
end $$;
reset role;
insert into auth.users(id,email) values ('c9100000-0000-4000-8000-000000000001','sin-a@qa.invalid'),('c9100000-0000-4000-8000-000000000002','sin-p@qa.invalid');
insert into public.clientes(id,nome,email,status) values ('c9100000-0000-4000-8000-000000000001','QA sin A','sin-a@qa.invalid','aprovado'),('c9100000-0000-4000-8000-000000000002','QA sin P','sin-p@qa.invalid','pendente');
set local role anon;
do $$ begin
 begin perform 1 from public.sinapi_precos; raise exception 'anon leu';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','c9100000-0000-4000-8000-000000000002',true);
do $$ begin if (select count(*) from public.sinapi_precos where uf='ZZ')<>0 then raise exception 'cliente pendente leu'; end if; end $$;
select set_config('request.jwt.claim.sub','c9100000-0000-4000-8000-000000000001',true);
do $$ begin
 if (select count(*) from public.sinapi_precos where uf='ZZ')<>1 then raise exception 'cliente aprovado não lê'; end if;
 begin insert into public.sinapi_precos(uf,tipo,desonerado,codigo,descricao,preco,referencia) values('ZZ','insumo',false,'2','x',1,'2026-10-01'); raise exception 'autenticado gravou';
 exception when insufficient_privilege then null; end;
 begin delete from public.sinapi_precos where uf='ZZ'; raise exception 'autenticado apagou';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
