// Preparação local somente; nenhuma conexão ou execução SQL.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const raiz=path.resolve(__dirname,'../../..');
const nomes=['kit_documentos_escala_proposta.sql','testar_kit_escala_bytes.sql','testar_kit_escala_rpc.sql'];
const fontes=nomes.map(nome=>({nome,texto:fs.readFileSync(path.join(raiz,'supabase',nome),'utf8').replaceAll('\r\n','\n')}));
function corpo(f,i){
 let s=f.texto;if(!/^begin;$/m.test(s))throw Error('Wrapper inicial divergente');s=s.replace(/^begin;\n/m,'');
 if(i===0){if(!/commit;\nnotify pgrst,'reload schema';\s*$/.test(s))throw Error('Wrapper migração divergente');s=s.replace(/commit;\nnotify pgrst,'reload schema';\s*$/,'');}
 else {if(!/^rollback;$/m.test(s))throw Error('Wrapper teste divergente');s=s.replace(/^rollback;\n?/m,'');}
 if(/^(?:begin|commit|rollback);$/m.test(s)||/^notify /m.test(s))throw Error('Controle transacional residual');
 if(s.includes('$fonte'+i+'$'))throw Error('Delimitador colide');
 return `\n-- Fonte reaproveitada: supabase/${f.nome}\nexecute $fonte${i}$\n${s}\n$fonte${i}$;\n`;
}
const pre=`-- NÃO EXECUTADO. QA luguscapasskcsficckf somente; conferir URL do SQL Editor.
-- PostgreSQL não prova project-ref: a identificação da conexão vem da conferência externa.
-- Execute tudo numa sessão sem concorrência; nenhuma credencial necessária no texto.
-- Exceção real aborta o ensaio. Se necessário executar ROLLBACK e preservar o erro.
-- Baseline readonly fornecida pela coordenação em 01/11/2026.
begin;
set local statement_timeout='60s';
set local lock_timeout='5s';
do $qa_escala$
declare
 p pg_proc; definicao text; metadados text; baseline jsonb:='[]'; r record; v text;
 tabelas integer:=0; sequencias integer:=0; gates boolean:=false;
begin
 if current_database()<>'postgres' then raise exception 'Banco QA inesperado';end if;
 select * into p from pg_proc where oid=to_regprocedure('public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb)');
 if p.oid is null or md5(pg_get_functiondef(p.oid))<>'64c94369bded0ca5721959406a8d5434'
 or not p.prosecdef or p.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}'
 or p.proowner<>'postgres'::regrole or p.prorettype<>'public.operacao_kit_documentos'::regtype
 then raise exception 'Baseline de assinatura/definição/owner/ACL divergente';end if;
 if (select count(*) from auth.users)<>0 or (select count(*) from public.operacao_kit_documentos)<>0 or (select count(*) from storage.objects)<>0
 then raise exception 'QA difere da baseline vazia observada';end if;
 definicao:=pg_get_functiondef(p.oid);
 metadados:=jsonb_build_object('owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'security',p.prosecdef,'rettype',p.prorettype)::text;
 for r in select schemaname,tablename from pg_tables where schemaname in ('public','auth','storage') order by 1,2 loop
  execute format('select count(*)::text||'':''||md5(coalesce(string_agg(x,''|'' order by x),'''')) from(select to_jsonb(t)::text x from %I.%I t)s',r.schemaname,r.tablename) into v;
  baseline:=baseline||jsonb_build_array(jsonb_build_object('tipo','tabela','esquema',r.schemaname,'nome',r.tablename,'valor',v));tabelas:=tabelas+1;
 end loop;
 for r in select schemaname,sequencename from pg_sequences where schemaname in ('public','auth','storage') order by 1,2 loop
  execute format('select last_value::text||'':''||is_called::text from %I.%I',r.schemaname,r.sequencename) into v;
  baseline:=baseline||jsonb_build_array(jsonb_build_object('tipo','sequencia','esquema',r.schemaname,'nome',r.sequencename,'valor',v));sequencias:=sequencias+1;
 end loop;
 -- A subtransação reverte função e fixtures; variáveis do bloco externo sobrevivem.
 begin
`;
const pos=`
 gates:=true;
 raise exception using errcode='ZQ001',message='Rollback controlado após todos os gates';
 exception when sqlstate 'ZQ001' then
  if not gates then raise;end if;
 end;
 if not gates then raise exception 'Gates incompletos';end if;
 select * into p from pg_proc where oid='public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb)'::regprocedure;
 if pg_get_functiondef(p.oid) is distinct from definicao
 or jsonb_build_object('owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'security',p.prosecdef,'rettype',p.prorettype)::text is distinct from metadados
 then raise exception 'Definição/permissões não restauradas';end if;
 for r in select * from jsonb_to_recordset(baseline) as x(tipo text,esquema text,nome text,valor text) loop
  if r.tipo='tabela' then execute format('select count(*)::text||'':''||md5(coalesce(string_agg(x,''|'' order by x),'''')) from(select to_jsonb(t)::text x from %I.%I t)s',r.esquema,r.nome) into v;
  else execute format('select last_value::text||'':''||is_called::text from %I.%I',r.esquema,r.nome) into v;end if;
  if v is distinct from r.valor then raise exception 'Preservação divergente em %.%',r.esquema,r.nome;end if;
 end loop;
 if (select count(*) from pg_tables where schemaname in ('public','auth','storage'))<>tabelas
 or (select count(*) from pg_sequences where schemaname in ('public','auth','storage'))<>sequencias then raise exception 'Inventário divergente';end if;
 raise notice 'QA_ESCALA_GATES_E_ROLLBACK_OK; função md5 %; tabelas %; sequências %',md5(pg_get_functiondef(p.oid)),tabelas,sequencias;
end $qa_escala$;
select 'QA_ESCALA_GATES_E_ROLLBACK_OK' as status,
 md5(pg_get_functiondef('public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb)'::regprocedure)) as md5_funcao_restaurada;
rollback;
-- Nenhuma função candidata ou fixture fica instalada. Erro não equivale a sucesso.
`;
const sql=pre+fontes.map(corpo).join('\n')+pos;
fs.writeFileSync(path.join(__dirname,'ENSAIO-ESCALA-ROLLBACK.sql'),sql);
const manifesto={destino:'luguscapasskcsficckf',executado:false,sha256:createHash('sha256').update(sql).digest('hex'),fontes:fontes.map(f=>({arquivo:'supabase/'+f.nome,sha256:createHash('sha256').update(f.texto).digest('hex'),normalizacao:'LF'}))};
fs.writeFileSync(path.join(__dirname,'ENSAIO-ESCALA-manifesto.json'),JSON.stringify(manifesto,null,2)+'\n');
console.log(JSON.stringify({sha256:manifesto.sha256,executado:false}));
