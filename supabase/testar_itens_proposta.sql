-- PREPARADO, NÃO EXECUTADO EM PRODUÇÃO. Clone isolado ou PGlite com 01-aplicar.sql
-- e operacao_itens_proposta.sql aplicados. Fixtures sintéticas e rollback.
begin;
do $$
declare
 ua uuid:='f2000000-0000-4000-8000-000000000001'; oa uuid:='f2000000-0000-4000-8000-00000000000a';
 ea uuid:='f2000000-0000-4000-8000-00000000001a'; pa uuid:='f2000000-0000-4000-8000-00000000002a';
 compra text:='11222333000181-1-41/2026'; url text:='https://pncp.gov.br/api/pncp/v1/orgaos/11222333000181/compras/2026/41/itens/7';
 ref jsonb:=jsonb_build_object('url_origem',null,'origem_externa_id',null,'numero','QA-ITENS');
 item_json jsonb:=jsonb_build_object('numero',7,'descricao','Material fictício','quantidade','3','unidade','UN');
 res jsonb; item uuid; i public.operacao_itens_resultado; marco timestamptz:='2020-01-01 00:00:00+00';
begin
 insert into auth.users(id,email) values(ua,'itens-a@qa.invalid');
 insert into public.clientes(id,nome,email,status) values(ua,'QA itens','itens-a@qa.invalid','aprovado');
 insert into public.operacao_organizacoes(id,nome,owner_id) values(oa,'QA itens',ua);
 insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values(ea,oa,'QA itens empresa','11222333000181');
 insert into public.operacao_membros(organizacao_id,usuario_id,papel) values(oa,ua,'operador');
 insert into public.operacao_processos(id,organizacao_id,empresa_id,objeto,numero) values(pa,oa,ea,'QA fictício','QA-ITENS');

 -- 1. Observação sem unidade/CATMAT no snapshot: nada é preenchido.
 res:=public.gravar_importacao_pncp(ua,ea,pa,oa,compra,7,url,repeat('a',64),item_json,'{}',ref);
 item:=(res->>'itemId')::uuid;
 select * into i from public.operacao_itens_resultado where id=item;
 if i.unidade is not null or i.codigo_catalogo is not null then raise exception 'Preencheu sem dado no snapshot';end if;

 -- 2. Oferta/marca informadas; nova observação preenche só os campos vazios.
 update public.operacao_itens_resultado set marca='Marca QA',modelo='Modelo QA',valor_unitario_proposta=12.34,atualizado_em=marco where id=item;
 res:=public.gravar_importacao_pncp(ua,ea,pa,oa,compra,7,url,repeat('b',64),item_json,
  jsonb_build_object('item',jsonb_build_object('unidade','UN'),'raw',jsonb_build_object('catalogoCodigoItem','123456')),ref);
 select * into i from public.operacao_itens_resultado where id=item;
 if i.unidade is distinct from 'UN' or i.codigo_catalogo is distinct from '123456' then raise exception 'Gatilho não preencheu: % %',i.unidade,i.codigo_catalogo;end if;
 if i.atualizado_em<>marco then raise exception 'Gatilho mexeu em atualizado_em';end if;
 if i.marca<>'Marca QA' or i.modelo<>'Modelo QA' or i.valor_unitario_proposta<>12.34 or i.descricao<>'Material fictício' or i.quantidade<>3 then raise exception 'Gatilho mexeu em oferta/marca/cadastro';end if;

 -- 3. Campo já preenchido não é sobrescrito; CATMAT numérico no JSON também é aceito.
 res:=public.gravar_importacao_pncp(ua,ea,pa,oa,compra,7,url,repeat('c',64),item_json,
  jsonb_build_object('item',jsonb_build_object('unidade','KG'),'raw',jsonb_build_object('catalogoCodigoItem',999)),ref);
 select * into i from public.operacao_itens_resultado where id=item;
 if i.unidade<>'UN' or i.codigo_catalogo<>'123456' or i.atualizado_em<>marco then raise exception 'Sobrescreveu campo preenchido';end if;
 update public.operacao_itens_resultado set codigo_catalogo=null where id=item;
 res:=public.gravar_importacao_pncp(ua,ea,pa,oa,compra,7,url,repeat('d',64),item_json,
  jsonb_build_object('item',jsonb_build_object('unidade','KG'),'raw',jsonb_build_object('catalogoCodigoItem',999)),ref);
 if (select codigo_catalogo from public.operacao_itens_resultado where id=item)<>'999' then raise exception 'CATMAT numérico ignorado';end if;

 -- 4. Valor fora do formato é ignorado sem derrubar a importação.
 update public.operacao_itens_resultado set unidade=null,codigo_catalogo=null where id=item;
 res:=public.gravar_importacao_pncp(ua,ea,pa,oa,compra,7,url,repeat('e',64),item_json,
  jsonb_build_object('item',jsonb_build_object('unidade',repeat('x',101)),'raw',jsonb_build_object('catalogoCodigoItem','12a')),ref);
 select * into i from public.operacao_itens_resultado where id=item;
 if res->>'estado'<>'fonte_alterada' or i.unidade is not null or i.codigo_catalogo is not null then raise exception 'Valor inválido gravado ou importação derrubada';end if;

 -- 5. Checks das colunas novas.
 begin update public.operacao_processos set margem_minima_percentual=100 where id=pa; raise exception 'margem 100 aceita'; exception when check_violation then null; end;
 update public.operacao_processos set margem_minima_percentual=99.999 where id=pa;
 begin update public.operacao_itens_resultado set codigo_catalogo='1234567890123' where id=item; raise exception 'CATMAT 13 dígitos aceito'; exception when check_violation then null; end;
 begin update public.operacao_itens_resultado set custo_unitario=-0.01 where id=item; raise exception 'custo negativo aceito'; exception when check_violation then null; end;
 begin update public.operacao_itens_resultado set valor_unitario_minimo=0 where id=item; raise exception 'mínimo zero aceito'; exception when check_violation then null; end;
 begin update public.operacao_itens_resultado set preco_referencia=0 where id=item; raise exception 'referência zero aceita'; exception when check_violation then null; end;
 begin update public.operacao_itens_resultado set unidade='' where id=item; raise exception 'unidade vazia aceita'; exception when check_violation then null; end;
 begin update public.operacao_itens_resultado set fabricante=repeat('f',501) where id=item; raise exception 'fabricante 501 aceito'; exception when check_violation then null; end;
 update public.operacao_itens_resultado set custo_unitario=0,valor_unitario_minimo=0.01,preco_referencia=51.2345,preco_referencia_em=now(),fabricante=repeat('f',500) where id=item;

 if has_function_privilege('authenticated','public.preencher_item_observacao_pncp(uuid,jsonb)','EXECUTE')
 or has_function_privilege('anon','public.preencher_item_observacao_pncp(uuid,jsonb)','EXECUTE') then raise exception 'Função de preenchimento exposta';end if;
 raise notice 'testar_itens_proposta: ok';
end $$;
rollback;
