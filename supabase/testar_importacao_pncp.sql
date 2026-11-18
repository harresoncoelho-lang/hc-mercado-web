-- PREPARADO, NÃO EXECUTADO. Somente clone isolado com migração importacao_item_pncp aplicada.
-- Fixtures sintéticas e rollback; executar como administrador apenas no teste. Não prova RLS via HTTP.
begin;
do $$
declare
 ua uuid:=gen_random_uuid(); ub uuid:=gen_random_uuid(); oa uuid:=gen_random_uuid(); ob uuid:=gen_random_uuid();
 ea uuid:=gen_random_uuid(); eb uuid:=gen_random_uuid(); pa uuid:=gen_random_uuid(); pb uuid:=gen_random_uuid();
 res jsonb; primeiro uuid; item_json jsonb; referencia jsonb; documento uuid; estranho uuid:=gen_random_uuid(); ids jsonb; dados jsonb; n integer; d public.operacao_kit_documentos;
begin
 insert into auth.users(id,aud,role,email,raw_user_meta_data,created_at,updated_at)
 values(ua,'authenticated','authenticated',ua||'@qa.invalid','{}',now(),now()),(ub,'authenticated','authenticated',ub||'@qa.invalid','{}',now(),now());
 insert into public.clientes(id,nome,email,status) values(ua,'QA escala A',ua||'@qa.invalid','aprovado'),(ub,'QA escala B',ub||'@qa.invalid','aprovado')
 on conflict(id) do update set status='aprovado';
 insert into public.operacao_organizacoes(id,nome,owner_id) values(oa,'QA A',ua),(ob,'QA B',ub);
 insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values(ea,oa,'QA empresa A','11222333000181'),(eb,ob,'QA empresa B','22333444000181');
 insert into public.operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values(oa,ua,'operador',ea),(ob,ub,'operador',eb);
 insert into public.operacao_processos(id,organizacao_id,empresa_id,objeto,numero) values(pa,oa,ea,'QA fictício','QA-A'),(pb,ob,eb,'QA fictício','QA-B');

 referencia:=jsonb_build_object('url_origem',null,'origem_externa_id',null,'numero','QA-A');
 insert into public.operacao_itens_resultado(organizacao_id,processo_id,tipo,identificador) values(oa,pa,'lote','98');
 item_json:=jsonb_build_object('numero',98,'descricao','Material integral fictício','quantidade','2.000','unidade','UN');
 res:=public.gravar_importacao_pncp(ua,ea,pa,oa,'11222333000181-1-41/2026',98,'https://pncp.gov.br/api/pncp/v1/orgaos/11222333000181/compras/2026/41/itens/98',repeat('a',64),item_json,'{}',referencia);
 primeiro:=(res->>'itemId')::uuid;
 if res->>'estado'<>'importado' then raise exception 'Importação não registrada';end if;
 update public.operacao_itens_resultado set marca='Marca operador',modelo='Modelo operador',valor_unitario_proposta=1.23 where id=primeiro;
 res:=public.gravar_importacao_pncp(ua,ea,pa,oa,'11222333000181-1-41/2026',98,'https://pncp.gov.br/api/pncp/v1/orgaos/11222333000181/compras/2026/41/itens/98',repeat('a',64),item_json,'{}',referencia);
 if (res->>'itemId')::uuid<>primeiro or res->>'estado'<>'inalterado' then raise exception 'Idempotência falhou';end if;
 item_json:=jsonb_set(item_json,'{descricao}','"Descrição retificada"');
 res:=public.gravar_importacao_pncp(ua,ea,pa,oa,'11222333000181-1-41/2026',98,'https://pncp.gov.br/api/pncp/v1/orgaos/11222333000181/compras/2026/41/itens/98',repeat('b',64),item_json,'{}',referencia);
 if res->>'estado'<>'fonte_alterada' then raise exception 'Retificação não sinalizada';end if;
 if not exists(select 1 from public.operacao_itens_resultado where id=primeiro and descricao='Material integral fictício' and marca='Marca operador' and modelo='Modelo operador' and valor_unitario_proposta=1.23 and quantidade=2) then raise exception 'Oferta/cadastro sobrescritos';end if;
 if (select count(*) from public.operacao_observacoes_pncp where item_id=primeiro)<>2 then raise exception 'Histórico não versionado';end if;
 insert into public.operacao_itens_resultado(organizacao_id,processo_id,identificador) values(oa,pa,'99');
 res:= public.gravar_importacao_pncp(ua,ea,pa,oa,'11222333000181-1-41/2026',99,'https://pncp.gov.br/api/pncp/v1/orgaos/11222333000181/compras/2026/41/itens/99',repeat('c',64),jsonb_set(item_json,'{numero}','99'),'{}',referencia);
 if res->>'estado'<>'colisao_manual' then raise exception 'Colisão manual aceita';end if;
 begin
  perform public.gravar_importacao_pncp(ub,ea,pa,oa,'11222333000181-1-41/2026',98,'https://pncp.gov.br/api/pncp/v1/orgaos/11222333000181/compras/2026/41/itens/98',repeat('c',64),item_json,'{}',referencia);
  raise exception 'Outro usuário aceito';
 exception when sqlstate 'PT403' then null;end;
 if has_function_privilege('anon','public.gravar_importacao_pncp(uuid,uuid,uuid,uuid,text,integer,text,text,jsonb,jsonb,jsonb)','EXECUTE')
 or has_function_privilege('authenticated','public.gravar_importacao_pncp(uuid,uuid,uuid,uuid,text,integer,text,text,jsonb,jsonb,jsonb)','EXECUTE')
 or not has_function_privilege('service_role','public.gravar_importacao_pncp(uuid,uuid,uuid,uuid,text,integer,text,text,jsonb,jsonb,jsonb)','EXECUTE')
 or has_table_privilege('authenticated','public.operacao_origens_pncp','INSERT') then raise exception 'ACL de origem inválida';end if;
 -- Cadência global do fluxo: ajuste de fixture somente dentro desta transação revertida.
 update public.operacao_cadencia_pncp set proxima=clock_timestamp()-interval '1 second' where origem='pncp';
 if not public.reservar_importacao_pncp(ua,ea,pa,oa) or public.reservar_importacao_pncp(ua,ea,pa,oa) then raise exception 'Cadência não respeitada';end if;
end $$;
rollback;
