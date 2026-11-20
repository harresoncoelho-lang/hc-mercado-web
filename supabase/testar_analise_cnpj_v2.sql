-- Teste de analise_cnpj_v2.sql. Fixtures sintéticas e rollback (nada fica no banco).
-- RLS simulada com "set local role" e request.jwt.claims; não prova a API HTTP.
begin;
do $$ begin
 begin
  insert into public.empresas_cadastro(cnpj, razao_social, fonte) values ('12345678000195', 'FULANA DE TAL 97048143215', 'brasilapi');
  raise exception 'CPF na razão social aceito';
 exception when check_violation then null; end;
 begin
  insert into public.empresas_cadastro(cnpj, fonte, socios) values ('12345678000195', 'brasilapi', '[{"nome":"BENTO","cpf":"***618002**"}]');
  raise exception 'campo cpf em sócio aceito';
 exception when check_violation then null; end;
 begin
  insert into public.empresas_cadastro(cnpj, fonte) values ('12345678901', 'brasilapi');
  raise exception 'CPF como chave aceito';
 exception when check_violation then null; end;
 begin
  insert into public.historico_contratos_fornecedor(numero_controle_pncp, fornecedor_ni) values ('04378626000197-1-000001/2026', '03090004000104');
  raise exception 'controle de compra aceito como contrato';
 exception when check_violation then null; end;
end $$;

insert into public.empresas_cadastro(cnpj, razao_social, fonte, socios, consultado_em) values
 ('12345678000195', 'F. M. DE MORAES LTDA', 'brasilapi', '[{"nome":"FULANA DE TAL","qualificacao":"Sócio-Administrador","entrada":"2020-01-01"}]', now()),
 ('11444777000161', 'VELHA LTDA', 'minhareceita', '[]', now() - interval '200 days');
insert into public.historico_contratos_fornecedor(numero_controle_pncp, fornecedor_ni, uf, esfera, valor_global) values
 ('99999999000191-2-000001/2026', '12345678000195', 'AM', 'F', 10379826.50);

-- Cliente aprovado lê; pendente e anônimo não; ninguém logado escreve.
insert into auth.users(id,email) values ('c9200000-0000-4000-8000-000000000001','acn2-a@qa.invalid'),('c9200000-0000-4000-8000-000000000002','acn2-p@qa.invalid');
insert into public.clientes(id,nome,email,status) values ('c9200000-0000-4000-8000-000000000001','QA acn2 A','acn2-a@qa.invalid','aprovado'),('c9200000-0000-4000-8000-000000000002','QA acn2 P','acn2-p@qa.invalid','pendente');
set local role authenticated;
select set_config('request.jwt.claim.sub','c9200000-0000-4000-8000-000000000001',true);
do $$ begin
 if (select count(*) from public.empresas_cadastro where cnpj in ('12345678000195', '11444777000161')) <> 2 then raise exception 'aprovado não lê o cadastro'; end if;
 if (select count(*) from public.historico_contratos_fornecedor where fornecedor_ni = '12345678000195') <> 1 then raise exception 'aprovado não lê contratos'; end if;
 begin
  insert into public.historico_contratos_fornecedor(numero_controle_pncp, fornecedor_ni) values ('99999999000191-2-000002/2026', '12345678000195');
  raise exception 'logado escreveu contrato';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','c9200000-0000-4000-8000-000000000002',true);
do $$ begin
 if (select count(*) from public.empresas_cadastro) <> 0 or (select count(*) from public.historico_contratos_fornecedor) <> 0 then raise exception 'pendente leu'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
 perform 1 from public.empresas_cadastro;
 raise exception 'anon leu cadastro';
exception when insufficient_privilege then null; end $$;
reset role;

-- Prazo de guarda: o de 200 dias sai; mínimo de 31 dias.
set local role service_role;
do $$ begin
 if public.empresas_cadastro_limpar(180) < 1 then raise exception 'limpeza não apagou nada'; end if;
 if exists (select 1 from public.empresas_cadastro where cnpj = '11444777000161') then raise exception 'limpeza errada'; end if;
 if public.empresas_cadastro_limpar(1) <> 0 then raise exception 'mínimo de 31 dias não respeitado'; end if;
 if (select count(*) from public.empresas_cadastro where cnpj = '12345678000195') <> 1 then raise exception 'limpou o recente'; end if;
end $$;
reset role;
rollback;
select 'testar_analise_cnpj_v2 ok';
