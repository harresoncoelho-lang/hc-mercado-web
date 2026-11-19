-- PREPARADO, NÃO EXECUTADO EM PRODUÇÃO. Clone isolado ou PGlite com 01-aplicar.sql, operacao_esteira.sql e
-- operacao_contratos_publicos.sql aplicados. Fixtures sintéticas e rollback.
-- Gestor c8..01 (org A inteira), operador c8..02 restrito à empresa A2, gestor c8..03 da org B.
begin;
insert into auth.users(id,email) values
 ('c8000000-0000-4000-8000-000000000001','cp-a@qa.invalid'),('c8000000-0000-4000-8000-000000000002','cp-r@qa.invalid'),('c8000000-0000-4000-8000-000000000003','cp-b@qa.invalid');
insert into public.clientes(id,nome,email,status) values
 ('c8000000-0000-4000-8000-000000000001','QA cp A','cp-a@qa.invalid','aprovado'),
 ('c8000000-0000-4000-8000-000000000002','QA cp R','cp-r@qa.invalid','aprovado'),
 ('c8000000-0000-4000-8000-000000000003','QA cp B','cp-b@qa.invalid','aprovado');
insert into public.operacao_organizacoes(id,nome,owner_id) values
 ('c8000000-0000-4000-8000-00000000000a','QA cp A','c8000000-0000-4000-8000-000000000001'),
 ('c8000000-0000-4000-8000-00000000000b','QA cp B','c8000000-0000-4000-8000-000000000003');
insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values
 ('c8000000-0000-4000-8000-00000000001a','c8000000-0000-4000-8000-00000000000a','QA cp empresa A','03090004000104'),
 ('c8000000-0000-4000-8000-00000000001b','c8000000-0000-4000-8000-00000000000a','QA cp empresa A2','22333444000181'),
 ('c8000000-0000-4000-8000-00000000001c','c8000000-0000-4000-8000-00000000000b','QA cp empresa B','33444555000181');
insert into public.operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values
 ('c8000000-0000-4000-8000-00000000000a','c8000000-0000-4000-8000-000000000001','gestor',null),
 ('c8000000-0000-4000-8000-00000000000a','c8000000-0000-4000-8000-000000000002','operador','c8000000-0000-4000-8000-00000000001b'),
 ('c8000000-0000-4000-8000-00000000000b','c8000000-0000-4000-8000-000000000003','gestor',null);
insert into public.operacao_processos(id,organizacao_id,empresa_id,objeto,status) values
 ('c8000000-0000-4000-8000-000000000021','c8000000-0000-4000-8000-00000000000a','c8000000-0000-4000-8000-00000000001a','QA contrato A','triagem'),
 ('c8000000-0000-4000-8000-000000000022','c8000000-0000-4000-8000-00000000000b','c8000000-0000-4000-8000-00000000001c','QA contrato B','triagem');
insert into public.operacao_contratos_publicos(organizacao_id,empresa_id,processo_id,chave,tipo,numero,fornecedor_cnpj,vigencia_fim,valor_global,valor_liquidado,a_pagar) values
 ('c8000000-0000-4000-8000-00000000000a','c8000000-0000-4000-8000-00000000001a','c8000000-0000-4000-8000-000000000021','04378626000197-2-000001/2026','contrato','00001/2026','03090004000104','2027-01-30',10379826.50,-151836.55,100),
 ('c8000000-0000-4000-8000-00000000000b','c8000000-0000-4000-8000-00000000001c','c8000000-0000-4000-8000-000000000022','x-2-000001/2026','contrato','9','33444555000181','2027-01-30',1,0,null);

do $$ declare n int; begin
 -- Processo de outra empresa não casa a chave estrangeira; CNPJ e jsonb inválidos são recusados.
 begin insert into public.operacao_contratos_publicos(organizacao_id,empresa_id,processo_id,chave) values
  ('c8000000-0000-4000-8000-00000000000a','c8000000-0000-4000-8000-00000000001b','c8000000-0000-4000-8000-000000000021','chave-k1'); raise exception 'FK de empresa aceita';
 exception when foreign_key_violation then null; end;
 begin update public.operacao_contratos_publicos set fornecedor_cnpj='123' where numero='00001/2026'; raise exception 'CNPJ curto aceito';
 exception when check_violation then null; end;
 begin update public.operacao_contratos_publicos set aditivos='{}'::jsonb where numero='00001/2026'; raise exception 'aditivos objeto aceito';
 exception when check_violation then null; end;
 -- Reaplicar o upsert do robô é idempotente (mesma chave não duplica).
 insert into public.operacao_contratos_publicos(organizacao_id,empresa_id,processo_id,chave,valor_pago) values
  ('c8000000-0000-4000-8000-00000000000a','c8000000-0000-4000-8000-00000000001a','c8000000-0000-4000-8000-000000000021','04378626000197-2-000001/2026',5)
  on conflict (processo_id,chave) do update set valor_pago=excluded.valor_pago;
 select count(*) into n from public.operacao_contratos_publicos where processo_id='c8000000-0000-4000-8000-000000000021';
 if n<>1 then raise exception 'Upsert duplicou: %',n; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','c8000000-0000-4000-8000-000000000001',true);
do $$ begin
 if (select count(*) from public.operacao_contratos_publicos)<>1 then raise exception 'Gestor A deve ver só o contrato da org A'; end if;
 begin insert into public.operacao_contratos_publicos(organizacao_id,empresa_id,processo_id,chave) values
  ('c8000000-0000-4000-8000-00000000000a','c8000000-0000-4000-8000-00000000001a','c8000000-0000-4000-8000-000000000021','chave-k2'); raise exception 'Usuário gravou';
 exception when insufficient_privilege then null; end;
 begin update public.operacao_contratos_publicos set valor_pago=1; raise exception 'Usuário alterou';
 exception when insufficient_privilege then null; end;
 begin delete from public.operacao_contratos_publicos; raise exception 'Usuário apagou';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','c8000000-0000-4000-8000-000000000002',true);
do $$ begin
 if exists(select 1 from public.operacao_contratos_publicos) then raise exception 'Operador da A2 leu contrato da empresa A'; end if;
end $$;
select set_config('request.jwt.claim.sub','c8000000-0000-4000-8000-000000000003',true);
do $$ begin
 if (select count(*) from public.operacao_contratos_publicos)<>1 or exists(select 1 from public.operacao_contratos_publicos where numero='00001/2026')
  then raise exception 'Gestor B deve ver só o da org B'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform 1 from public.operacao_contratos_publicos; raise exception 'anon leu contratos';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
