-- PREPARADO / NÃO EXECUTADO. Exclusivamente QA luguscapasskcsficckf; conferir conexão externamente.
-- Nenhuma credencial, chamada externa, alteração Auth ou dados de cliente.
-- Não executar em produção. Revisão independente necessária.
-- ATO00 SOMENTE LEITURA. Salvar toda a linhaJSON fora do banco ANTES do ato01.
-- rollbackSql contém a definição EXATA capturada, não reconstrução por formatação.
begin read only;
set local statement_timeout='30s';
do $captura$ declare p pg_proc;begin
 if current_database()<>'postgres' or current_user<>'postgres' then raise exception 'Conexão inesperada';end if;
 select * into p from pg_proc where oid=to_regprocedure('public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb)');
 if p.oid is null or md5(pg_get_functiondef(p.oid))<>'64c94369bded0ca5721959406a8d5434' or not p.prosecdef
 or p.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}' or p.proowner<>'postgres'::regrole
 or p.prorettype<>'public.operacao_kit_documentos'::regtype then raise exception 'CAS baseline/ACL divergente; parar sem alterar';end if;
end $captura$;
-- Transporte verificável: JSON integral em base64 UTF8; sem normalizar definição.
with captura as (select jsonb_build_object('destino','luguscapasskcsficckf','baselineMd5','64c94369bded0ca5721959406a8d5434',
 'definicaoMd5Servidor',md5(pg_get_functiondef(p.oid)),'serverEncoding',current_setting('server_encoding'),'searchPath',current_setting('search_path'),'definicao',pg_get_functiondef(p.oid),'metadata',jsonb_build_object('owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'security',p.prosecdef,'rettype',p.prorettype),'capturadoEm',clock_timestamp(),
 'rollbackSql',format($modelo$begin;
set local statement_timeout='30s';set local lock_timeout='5s';
lock table public.operacao_kit_documentos in share row exclusive mode;
do $reverter$
declare p pg_proc; meta jsonb;
begin
 if current_database()<>'postgres' or current_user<>'postgres' then raise exception 'Conexão inesperada';end if;
 perform pg_advisory_xact_lock(hashtext('qa-kit-escala-aplicacao'));
 select * into p from pg_proc where oid=to_regprocedure('public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb)');
 if p.oid is null or md5(p.prosrc)<>'a1c37914704cdb3dce5fb6dc056e9896' or jsonb_build_object('owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'security',p.prosecdef,'rettype',p.prorettype) is distinct from %L::jsonb
 then raise exception 'Candidato/metadata mudou; não reverter';end if;
 if exists(select 1 from public.operacao_kit_documentos where length(dados::text)>50000 or (tipo='proposta' and jsonb_array_length(coalesce(dados->'proposta'->'itemIds','[]'))>50))
 then raise exception 'Peças usam capacidade nova; não reduzir limite. Preservar função e dados';end if;
 meta:=jsonb_build_object('owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'security',p.prosecdef,'rettype',p.prorettype);
 execute %L;
 select * into p from pg_proc where oid=to_regprocedure('public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb)');
 if jsonb_build_object('owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'security',p.prosecdef,'rettype',p.prorettype) is distinct from meta then raise exception 'ACL/metadata de reversão divergente';end if;
 if md5(pg_get_functiondef('public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb)'::regprocedure))<>'64c94369bded0ca5721959406a8d5434' then raise exception 'Reversão não corresponde ao backup';end if;
end $reverter$;
select 'QA_ESCALA_REVERTIDA' as status;
commit;
notify pgrst,'reload schema';$modelo$,jsonb_build_object('owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'security',p.prosecdef,'rettype',p.prorettype)::text,pg_get_functiondef(p.oid))) as backup_rpc_escala
from pg_proc p where p.oid='public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb)'::regprocedure), payload as (select backup_rpc_escala::text as texto from captura)
select jsonb_build_object('encoding','base64-utf8','payloadBase64',replace(encode(convert_to(texto,'UTF8'),'base64'),chr(10),''),'payloadMd5',md5(convert_to(texto,'UTF8')),'payloadBytes',octet_length(convert_to(texto,'UTF8'))) as captura_verificavel from payload;
rollback;
