const fs=require('fs'),path=require('path'),{createHash}=require('crypto');const dir=__dirname,root=path.resolve(dir,'../../..'),hash=(v,alg='sha256')=>createHash(alg).update(v).digest('hex');
const source=fs.readFileSync(path.join(root,'supabase/kit_documentos_escala_proposta.sql'),'utf8').replaceAll('\r\n','\n');
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'ENSAIO-ESCALA-manifesto.json')));
if(hash(source)!==manifest.fontes.find(f=>f.arquivo==='supabase/kit_documentos_escala_proposta.sql').sha256)throw Error('Fonte difere da ensaiada');
const definition=source.slice(source.indexOf('create or replace function'),source.indexOf('end $$;')+7),body=/as \$\$([\s\S]*?)\$\$;/i.exec(definition)[1],bodyHash=hash(body,'md5');
const signature='public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb)',base='64c94369bded0ca5721959406a8d5434';
const metadata="jsonb_build_object('owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'security',p.prosecdef,'rettype',p.prorettype)";
const guard=`select * into p from pg_proc where oid=to_regprocedure('${signature}');
 if p.oid is null or md5(pg_get_functiondef(p.oid))<>'${base}' or not p.prosecdef
 or p.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}' or p.proowner<>'postgres'::regrole
 or p.prorettype<>'public.operacao_kit_documentos'::regtype then raise exception 'CAS baseline/ACL divergente; parar sem alterar';end if;`;
const header=`-- PREPARADO / NÃO EXECUTADO. Exclusivamente QA luguscapasskcsficckf; conferir conexão externamente.
-- Nenhuma credencial, chamada externa, alteração Auth ou dados de cliente.
-- Não executar em produção. Revisão independente necessária.
`;
const rollbackTemplate=`begin;
set local statement_timeout='30s';set local lock_timeout='5s';
lock table public.operacao_kit_documentos in share row exclusive mode;
do $reverter$
declare p pg_proc; meta jsonb;
begin
 if current_database()<>'postgres' or current_user<>'postgres' then raise exception 'Conexão inesperada';end if;
 perform pg_advisory_xact_lock(hashtext('qa-kit-escala-aplicacao'));
 select * into p from pg_proc where oid=to_regprocedure('${signature}');
 if p.oid is null or md5(p.prosrc)<>'${bodyHash}' or ${metadata} is distinct from %L::jsonb
 then raise exception 'Candidato/metadata mudou; não reverter';end if;
 if exists(select 1 from public.operacao_kit_documentos where length(dados::text)>50000 or (tipo='proposta' and jsonb_array_length(coalesce(dados->'proposta'->'itemIds','[]'))>50))
 then raise exception 'Peças usam capacidade nova; não reduzir limite. Preservar função e dados';end if;
 meta:=${metadata};
 execute %L;
 select * into p from pg_proc where oid=to_regprocedure('${signature}');
 if ${metadata} is distinct from meta then raise exception 'ACL/metadata de reversão divergente';end if;
 if md5(pg_get_functiondef('${signature}'::regprocedure))<>'${base}' then raise exception 'Reversão não corresponde ao backup';end if;
end $reverter$;
select 'QA_ESCALA_REVERTIDA' as status;
commit;
notify pgrst,'reload schema';`;
const capture=header+`-- ATO00 SOMENTE LEITURA. Salvar toda a linhaJSON fora do banco ANTES do ato01.
-- rollbackSql contém a definição EXATA capturada, não reconstrução por formatação.
begin read only;
set local statement_timeout='30s';
do $captura$ declare p pg_proc;begin
 if current_database()<>'postgres' or current_user<>'postgres' then raise exception 'Conexão inesperada';end if;
 ${guard}
end $captura$;
select jsonb_build_object('destino','luguscapasskcsficckf','baselineMd5','${base}',
 'definicao',pg_get_functiondef(p.oid),'metadata',${metadata},'capturadoEm',clock_timestamp(),
 'rollbackSql',format($modelo$${rollbackTemplate}$modelo$,${metadata}::text,pg_get_functiondef(p.oid))) as backup_rpc_escala
from pg_proc p where p.oid='${signature}'::regprocedure;
rollback;
`;
const apply=header+`-- ATO01: só executar DEPOIS de salvar e verificar capturaATO00 e obter revisão.
-- Janela sem execução concorrente da aplicação QA. Não remove nem copia dados.
begin;
set local statement_timeout='30s';set local lock_timeout='5s';
lock table public.operacao_kit_documentos in share row exclusive mode;
do $aplicar$
declare p pg_proc; meta jsonb;
begin
 if current_database()<>'postgres' or current_user<>'postgres' then raise exception 'Conexão inesperada';end if;
 perform pg_advisory_xact_lock(hashtext('qa-kit-escala-aplicacao'));
 ${guard}
 meta:=${metadata};
 execute $candidata$${definition}$candidata$;
 select * into p from pg_proc where oid='${signature}'::regprocedure;
 if md5(p.prosrc)<>'${bodyHash}' or ${metadata} is distinct from meta then raise exception 'Pós-aplicação divergente; rollback automático';end if;
end $aplicar$;
select 'QA_ESCALA_APLICADA' as status,md5(pg_get_functiondef(p.oid)) as md5_definicao,md5(p.prosrc) as md5_corpo,p.proacl::text as acl
from pg_proc p where p.oid='${signature}'::regprocedure;
commit;
notify pgrst,'reload schema';
`;
const files={'ATO-ESCALA-00-CAPTURAR.sql':capture,'ATO-ESCALA-01-APLICAR.sql':apply};for(const [name,text]of Object.entries(files))fs.writeFileSync(path.join(dir,name),text);
const result={destino:'luguscapasskcsficckf',executado:false,baselineMd5:base,candidatoBodyMd5:bodyHash,fonte:{arquivo:'supabase/kit_documentos_escala_proposta.sql',sha256:hash(source)},arquivos:Object.entries(files).map(([arquivo,text])=>({arquivo,sha256:hash(text)})),reversao:'Gerada em ATO00 a partir de pg_get_functiondef exato; salvar JSON e extrair rollbackSql antes ATO01.'};fs.writeFileSync(path.join(dir,'ATO-ESCALA-manifesto.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
