-- Teste de sancoes_empresas.sql. Dados fictícios e rollback (nada fica no banco).
-- Papéis simulados com "set local role"; não prova a API HTTP do PostgREST.
begin;
set local role service_role;
insert into public.sancoes_empresas(cadastro,codigo_sancao,cnpj,razao_social,tipo_sancao,data_inicio,data_fim,data_carga) values
 ('CEIS','900001','11222333000181','QA sancionada','Impedimento/proibição de contratar com prazo determinado','2026-01-01','2027-01-01','2026-11-18'),
 ('CNEP','900002','11222333000181','QA sancionada','Multa','2025-01-01',null,'2026-11-18');
-- Upsert pela chave natural (mesmo caminho do robô: on conflict).
insert into public.sancoes_empresas(cadastro,codigo_sancao,cnpj,razao_social,data_fim,data_carga) values
 ('CEIS','900001','11222333000181','QA sancionada nova','2027-06-30','2026-11-19')
 on conflict (cadastro,codigo_sancao) do update set razao_social=excluded.razao_social,data_fim=excluded.data_fim,data_carga=excluded.data_carga;
do $$ begin
 if (select count(*) from public.sancoes_empresas where codigo_sancao in ('900001','900002'))<>2 then raise exception 'upsert duplicou'; end if;
 if (select data_fim from public.sancoes_empresas where cadastro='CEIS' and codigo_sancao='900001')<>'2027-06-30' then raise exception 'upsert não atualizou'; end if;
 -- Sumiço: marca sem apagar (o que o robô faz por PATCH).
 update public.sancoes_empresas set fora_da_lista=true,fora_da_lista_em=now() where cadastro='CNEP' and data_carga<'2026-11-19' and not fora_da_lista;
 if not (select fora_da_lista from public.sancoes_empresas where codigo_sancao='900002') then raise exception 'sumiço não marcado'; end if;
 -- CPF (11 dígitos) é recusado pelo banco.
 begin insert into public.sancoes_empresas(cadastro,codigo_sancao,cnpj,data_carga) values('CEIS','900003','12345678901','2026-11-19'); raise exception 'CPF aceito';
 exception when check_violation then null; end;
 begin insert into public.sancoes_empresas(cadastro,codigo_sancao,cnpj,data_carga) values('XYZ','900004','11222333000181','2026-11-19'); raise exception 'cadastro inválido aceito';
 exception when check_violation then null; end;
 begin delete from public.sancoes_empresas where codigo_sancao='900001'; raise exception 'service_role apagou histórico';
 exception when insufficient_privilege then null; end;
end $$;
set local role authenticated;
do $$ begin
 if (select count(*) from public.sancoes_empresas where cnpj='11222333000181')<>2 then raise exception 'autenticado não lê'; end if;
 begin insert into public.sancoes_empresas(cadastro,codigo_sancao,cnpj,data_carga) values('CEIS','900005','11222333000181','2026-11-19'); raise exception 'autenticado gravou';
 exception when insufficient_privilege then null; end;
 begin update public.sancoes_empresas set razao_social='x' where codigo_sancao='900001'; raise exception 'autenticado alterou';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
 if has_table_privilege('anon','public.sancoes_empresas','SELECT') then raise exception 'anon lê sanções'; end if;
 if has_function_privilege('authenticated','public.sancoes_empresas_tocar()','EXECUTE') then raise exception 'authenticated executa o gatilho'; end if;
end $$;
rollback;
