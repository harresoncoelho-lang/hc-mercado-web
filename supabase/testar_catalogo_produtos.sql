-- Teste de operacao_catalogo_produtos.sql. Fixtures sintéticas e rollback (nada fica no banco).
-- RLS simulada com "set local role authenticated" + request.jwt.claim.sub; não prova a API HTTP.
-- Org A: gestor c7..01, leitura c7..02, operador c7..04 restrito à empresa A2. Org B: gestor c7..03.
begin;
insert into auth.users(id,email) values
 ('c7000000-0000-4000-8000-000000000001','cat-a@qa.invalid'),('c7000000-0000-4000-8000-000000000002','cat-l@qa.invalid'),
 ('c7000000-0000-4000-8000-000000000003','cat-b@qa.invalid'),('c7000000-0000-4000-8000-000000000004','cat-o@qa.invalid');
insert into public.clientes(id,nome,email,status) values
 ('c7000000-0000-4000-8000-000000000001','QA cat A','cat-a@qa.invalid','aprovado'),
 ('c7000000-0000-4000-8000-000000000002','QA cat L','cat-l@qa.invalid','aprovado'),
 ('c7000000-0000-4000-8000-000000000003','QA cat B','cat-b@qa.invalid','aprovado'),
 ('c7000000-0000-4000-8000-000000000004','QA cat O','cat-o@qa.invalid','aprovado');
insert into public.operacao_organizacoes(id,nome,owner_id) values
 ('c7000000-0000-4000-8000-00000000000a','QA cat org A','c7000000-0000-4000-8000-000000000001'),
 ('c7000000-0000-4000-8000-00000000000b','QA cat org B','c7000000-0000-4000-8000-000000000003');
insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values
 ('c7000000-0000-4000-8000-00000000001a','c7000000-0000-4000-8000-00000000000a','QA cat empresa A','11222333000181'),
 ('c7000000-0000-4000-8000-00000000002a','c7000000-0000-4000-8000-00000000000a','QA cat empresa A2','22333444000181'),
 ('c7000000-0000-4000-8000-00000000001b','c7000000-0000-4000-8000-00000000000b','QA cat empresa B','33444555000181');
insert into public.operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values
 ('c7000000-0000-4000-8000-00000000000a','c7000000-0000-4000-8000-000000000001','gestor',null),
 ('c7000000-0000-4000-8000-00000000000a','c7000000-0000-4000-8000-000000000002','leitura',null),
 ('c7000000-0000-4000-8000-00000000000b','c7000000-0000-4000-8000-000000000003','gestor',null),
 ('c7000000-0000-4000-8000-00000000000a','c7000000-0000-4000-8000-000000000004','operador','c7000000-0000-4000-8000-00000000002a');

-- Teto de 5.000 por empresa (como dono, sem RLS: o gatilho vale para todos).
do $$
declare o uuid:='c7000000-0000-4000-8000-00000000000a'; e2 uuid:='c7000000-0000-4000-8000-00000000002a';
begin
 insert into public.operacao_catalogo_produtos(organizacao_id,empresa_id,nome) select o,e2,'Produto '||g from generate_series(1,5000) g;
 begin
  insert into public.operacao_catalogo_produtos(organizacao_id,empresa_id,nome) values(o,e2,'Produto 5001');
  raise exception 'Teto de 5.000 não barrou';
 exception when sqlstate 'P0001' then
  if sqlerrm not like 'Limite de 5.000%' then raise; end if;
 end;
 delete from public.operacao_catalogo_produtos where empresa_id=e2;
end $$;

set local role authenticated;
do $$
declare
 o uuid:='c7000000-0000-4000-8000-00000000000a'; ob uuid:='c7000000-0000-4000-8000-00000000000b';
 ea uuid:='c7000000-0000-4000-8000-00000000001a'; e2 uuid:='c7000000-0000-4000-8000-00000000002a';
 eb uuid:='c7000000-0000-4000-8000-00000000001b';
 ga uuid:='c7000000-0000-4000-8000-000000000001'; la uuid:='c7000000-0000-4000-8000-000000000002';
 gb uuid:='c7000000-0000-4000-8000-000000000003'; op uuid:='c7000000-0000-4000-8000-000000000004';
 h text:=repeat('a',64); r public.operacao_catalogo_produtos; n int; pid uuid;
begin
 perform set_config('request.jwt.claim.sub',ga::text,true);
 insert into public.operacao_catalogo_produtos(organizacao_id,empresa_id,nome,marca,modelo,custo_unitario,codigo_interno,foto_caminho,foto_hash,atualizado_por)
  values(o,ea,'Caneta esferográfica azul','Marca QA','M1',1.25,'CAN-01',o||'/'||ea||'/catalogo/'||h||'.png',h,gb) returning * into r;
 if r.atualizado_por<>ga then raise exception 'atualizado_por deveria vir do JWT: %',r.atualizado_por; end if;
 pid:=r.id;
 -- Foto fora da pasta, com nome livre, de outra empresa ou com hash divergente: recusada.
 begin update public.operacao_catalogo_produtos set foto_caminho=o||'/'||ea||'/perfil/'||h||'.png' where id=pid; raise exception 'Foto fora de catalogo/ aceita';
 exception when check_violation then null; end;
 begin update public.operacao_catalogo_produtos set foto_caminho=o||'/'||e2||'/catalogo/'||h||'.png' where id=pid; raise exception 'Foto de outra empresa aceita';
 exception when check_violation then null; end;
 begin update public.operacao_catalogo_produtos set foto_caminho=o||'/'||ea||'/catalogo/'||repeat('b',64)||'.png' where id=pid; raise exception 'Foto com hash divergente aceita';
 exception when check_violation then null; end;
 begin update public.operacao_catalogo_produtos set foto_hash=null where id=pid; raise exception 'Foto sem hash aceita';
 exception when check_violation then null; end;
 begin update public.operacao_catalogo_produtos set custo_unitario=-1 where id=pid; raise exception 'Custo negativo aceito';
 exception when check_violation then null; end;
 begin insert into public.operacao_catalogo_produtos(organizacao_id,empresa_id,nome,codigo_interno) values(o,ea,'Outra','CAN-01'); raise exception 'Código interno repetido aceito';
 exception when unique_violation then null; end;
 -- Escopo não muda depois de criado.
 begin update public.operacao_catalogo_produtos set empresa_id=e2 where id=pid; raise exception 'Escopo transferido';
 exception when raise_exception then if sqlerrm not like 'Escopo não pode%' then raise; end if; end;

 -- Papel leitura: lê, não grava.
 perform set_config('request.jwt.claim.sub',la::text,true);
 select count(*) into n from public.operacao_catalogo_produtos where empresa_id=ea;
 if n<>1 then raise exception 'Leitura deveria ver 1 produto, viu %',n; end if;
 begin insert into public.operacao_catalogo_produtos(organizacao_id,empresa_id,nome) values(o,ea,'Da leitura'); raise exception 'Leitura inseriu';
 exception when insufficient_privilege then null; end;
 update public.operacao_catalogo_produtos set custo_unitario=99 where id=pid;
 get diagnostics n = row_count;
 if n<>0 then raise exception 'Leitura alterou % linha(s)',n; end if;
 delete from public.operacao_catalogo_produtos where id=pid;
 get diagnostics n = row_count;
 if n<>0 then raise exception 'Leitura apagou % linha(s)',n; end if;

 -- Operador restrito à A2 não vê nem grava na A.
 perform set_config('request.jwt.claim.sub',op::text,true);
 if exists(select 1 from public.operacao_catalogo_produtos where empresa_id=ea) then raise exception 'Operador da A2 viu a A'; end if;
 begin insert into public.operacao_catalogo_produtos(organizacao_id,empresa_id,nome) values(o,ea,'Do operador'); raise exception 'Operador da A2 gravou na A';
 exception when insufficient_privilege then null; end;
 insert into public.operacao_catalogo_produtos(organizacao_id,empresa_id,nome) values(o,e2,'Do operador na A2');

 -- Outra organização: não vê, não grava, não altera.
 perform set_config('request.jwt.claim.sub',gb::text,true);
 if exists(select 1 from public.operacao_catalogo_produtos where organizacao_id=o) then raise exception 'Org B viu o catálogo da org A'; end if;
 begin insert into public.operacao_catalogo_produtos(organizacao_id,empresa_id,nome) values(o,ea,'Da org B'); raise exception 'Org B gravou na org A';
 exception when insufficient_privilege then null; end;
 -- Org trocada com empresa de outra org: a FK composta barra antes da RLS deixar passar.
 begin insert into public.operacao_catalogo_produtos(organizacao_id,empresa_id,nome) values(ob,ea,'Cruzado'); raise exception 'Empresa de outra org aceita';
 exception when insufficient_privilege or foreign_key_violation then null; end;
 update public.operacao_catalogo_produtos set nome='invadido' where id=pid;
 get diagnostics n = row_count;
 if n<>0 then raise exception 'Org B alterou % linha(s)',n; end if;
 insert into public.operacao_catalogo_produtos(organizacao_id,empresa_id,nome) values(ob,eb,'Produto da org B');

 -- Gestor A continua vendo só o da A (o da B não vaza para cá).
 perform set_config('request.jwt.claim.sub',ga::text,true);
 if exists(select 1 from public.operacao_catalogo_produtos where organizacao_id=ob) then raise exception 'Org A viu o catálogo da org B'; end if;
 if (select nome from public.operacao_catalogo_produtos where id=pid)<>'Caneta esferográfica azul' then raise exception 'Produto alterado por quem não podia'; end if;
end $$;
reset role;
do $$ begin
 if has_table_privilege('anon','public.operacao_catalogo_produtos','SELECT') then raise exception 'anon lê o catálogo'; end if;
 if has_function_privilege('authenticated','public.carimbar_catalogo_produto()','EXECUTE') then raise exception 'authenticated executa o gatilho'; end if;
end $$;
rollback;
