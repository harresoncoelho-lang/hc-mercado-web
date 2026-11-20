-- Dados fictícios; transação sempre revertida. Somente banco local de homologação.
begin;
insert into auth.users(id) values('ee000000-0000-4000-8000-000000000001'),('ee000000-0000-4000-8000-000000000002');
insert into public.operacao_organizacoes(id,nome,owner_id) values('ee000000-0000-4000-8000-000000000010','QA descartável','ee000000-0000-4000-8000-000000000001');
insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values('ee000000-0000-4000-8000-000000000011','ee000000-0000-4000-8000-000000000010','QA Empresa A','11222333000181'),('ee000000-0000-4000-8000-000000000012','ee000000-0000-4000-8000-000000000010','QA Empresa B','11222333000262');
insert into public.operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values('ee000000-0000-4000-8000-000000000010','ee000000-0000-4000-8000-000000000002','operador','ee000000-0000-4000-8000-000000000011');
select public.confirmar_identificacao_empresa('ee000000-0000-4000-8000-000000000011','ee000000-0000-4000-8000-000000000002','QA Empresa A','11222333000181','{"endereco":"Rua QA","representante":"Pessoa QA","cargo":"Administradora"}','[]') is distinct from null as confirmou;
insert into public.operacao_documentos(id,organizacao_id,empresa_id,tipo,titulo,arquivo_caminho) values('ee000000-0000-4000-8000-000000000020','ee000000-0000-4000-8000-000000000010','ee000000-0000-4000-8000-000000000011','Contrato social','QA','ee000000-0000-4000-8000-000000000010/ee000000-0000-4000-8000-000000000011/qa.pdf');
update public.operacao_identificacao_empresa set proveniencia='[{"documentoId":"ee000000-0000-4000-8000-000000000020","arquivoCaminho":"ee000000-0000-4000-8000-000000000010/ee000000-0000-4000-8000-000000000011/qa.pdf","hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]';
update public.operacao_documentos set arquivo_nome='alterado.pdf' where id='ee000000-0000-4000-8000-000000000020';
do $$ begin if not exists(select 1 from public.operacao_identificacao_empresa where invalidado_em is not null) then raise exception 'Mudança do documento não invalidou perfil'; end if; end $$;
update public.operacao_identificacao_empresa set invalidado_em=null;
insert into storage.objects(bucket_id,name) values('operacao-documentos','ee000000-0000-4000-8000-000000000010/ee000000-0000-4000-8000-000000000011/qa.pdf');
update storage.objects set metadata='{"qa":true}' where bucket_id='operacao-documentos' and name='ee000000-0000-4000-8000-000000000010/ee000000-0000-4000-8000-000000000011/qa.pdf';
do $$ begin if not exists(select 1 from public.operacao_identificacao_empresa where invalidado_em is not null) then raise exception 'Mudança do objeto não invalidou perfil'; end if; end $$;
update public.operacao_identificacao_empresa set invalidado_em=null;
set local role authenticated;
set local request.jwt.claim.sub='ee000000-0000-4000-8000-000000000002';
do $$ begin
 if public.identificacao_empresa_habilitada() is not true then raise exception 'Gate local fechado'; end if;
 if (select count(*) from public.operacao_identificacao_empresa)<>1 then raise exception 'Perfil acessível inválido'; end if;
 if (select count(*) from public.operacao_empresas where id in ('ee000000-0000-4000-8000-000000000011','ee000000-0000-4000-8000-000000000012'))<>1 then raise exception 'Vazamento entre empresas'; end if;
 begin
 perform public.confirmar_identificacao_empresa('ee000000-0000-4000-8000-000000000011','ee000000-0000-4000-8000-000000000002','QA Empresa A','11222333000181','{}','[]');
 raise exception 'RPC indevidamente permitida';
 exception when insufficient_privilege then null;
 end;
 begin
 update public.operacao_identificacao_empresa set dados_confirmados='{}';
 raise exception 'Escrita direta permitida';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
update public.operacao_empresas set razao_social='QA Empresa A alterada' where id='ee000000-0000-4000-8000-000000000011';
do $$ begin
 if not exists(select 1 from public.operacao_identificacao_empresa where empresa_id='ee000000-0000-4000-8000-000000000011' and invalidado_em is not null) then raise exception 'Perfil não invalidado'; end if;
end $$;
rollback;
