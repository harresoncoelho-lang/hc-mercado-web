const fs=require('fs'),path=require('path'),crypto=require('crypto');const dir=__dirname,hash=(x,a='sha256')=>crypto.createHash(a).update(x).digest('hex');
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'ATO-ESCALA-manifesto.json'))),apply=fs.readFileSync(path.join(dir,'ATO-ESCALA-01-APLICAR.sql'),'utf8');
if(hash(apply)!==manifest.arquivos.find(x=>x.arquivo==='ATO-ESCALA-01-APLICAR.sql').sha256)throw Error('Ato original mudou');
const candidate=apply.match(/execute \$candidata\$([\s\S]*?)\$candidata\$/)[1],base=manifest.baselineMd5,bodyHash=manifest.candidatoBodyMd5;
const sig='public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb)';
const meta="jsonb_build_object('owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'security',p.prosecdef,'rettype',p.prorettype)";
const sql=`-- DIAGNÓSTICO QA SOMENTE luguscapasskcsficckf. NÃO APLICA. Conferir destino externamente.
-- Candidato exato transportado base64; alteração temporária revertida em subtransação.
begin;
set local statement_timeout='30s';set local lock_timeout='5s';
lock table public.operacao_kit_documentos in share row exclusive mode;
create temporary table qa_escala_diagnostico_resultado(payload jsonb) on commit drop;
do $diagnostico$
declare p pg_proc; antes jsonb; depois jsonb; corpo_real text; def_real text; codigo text; bytes bytea; passou boolean:=false; resultado jsonb;
begin
 if current_database()<>'postgres' or current_user<>'postgres' then raise exception 'Conexão inesperada';end if;
 perform pg_advisory_xact_lock(hashtext('qa-kit-escala-aplicacao'));
 select * into p from pg_proc where oid=to_regprocedure('${sig}');
 if p.oid is null or md5(pg_get_functiondef(p.oid))<>'${base}' or not p.prosecdef or p.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}' or p.proowner<>'postgres'::regrole or p.prorettype<>'public.operacao_kit_documentos'::regtype then raise exception 'Baseline/ACL divergente';end if;
 antes:=${meta};
 bytes:=decode('${Buffer.from(candidate).toString('base64')}','base64');
 if octet_length(bytes)<>${Buffer.byteLength(candidate)} or md5(bytes)<>'${hash(candidate,'md5')}' then raise exception 'Transporte candidato divergente';end if;
 codigo:=convert_from(bytes,'UTF8');
 begin
  execute codigo;
  select * into p from pg_proc where oid='${sig}'::regprocedure;
  depois:=${meta};corpo_real:=md5(p.prosrc);def_real:=md5(pg_get_functiondef(p.oid));
  resultado:=jsonb_build_object('corpoEsperado','${bodyHash}','corpoReal',corpo_real,'corpoCoincide',corpo_real='${bodyHash}','definicaoCandidataMd5',def_real,'metadataAntes',antes,'metadataDepois',depois,'metadataCoincide',antes=depois,'serverEncoding',current_setting('server_encoding'),'searchPath',current_setting('search_path'),'candidatoPayloadMd5',md5(bytes));
  passou:=true;
  raise exception using errcode='ZD001',message='Rollback diagnóstico intencional';
 exception when sqlstate 'ZD001' then
  if not passou then raise;end if;
 end;
 select * into p from pg_proc where oid='${sig}'::regprocedure;
 if md5(pg_get_functiondef(p.oid))<>'${base}' or ${meta} is distinct from antes then raise exception 'Baseline não restaurada';end if;
 insert into qa_escala_diagnostico_resultado values(resultado||jsonb_build_object('status','QA_ESCALA_DIAGNOSTICO_ROLLBACK_OK','baselineRestauradaMd5',md5(pg_get_functiondef(p.oid))));
end $diagnostico$;
select payload from qa_escala_diagnostico_resultado;
rollback;
`;
fs.writeFileSync(path.join(dir,'ATO-ESCALA-02-DIAGNOSTICO-ROLLBACK.sql'),sql);fs.writeFileSync(path.join(dir,'ATO-ESCALA-02-manifesto.json'),JSON.stringify({executado:false,arquivo:'ATO-ESCALA-02-DIAGNOSTICO-ROLLBACK.sql',sha256:hash(sql),candidatoMd5:hash(candidate,'md5'),candidatoBytes:Buffer.byteLength(candidate),corpoEsperado:bodyHash},null,2)+'\n');console.log(hash(sql));
