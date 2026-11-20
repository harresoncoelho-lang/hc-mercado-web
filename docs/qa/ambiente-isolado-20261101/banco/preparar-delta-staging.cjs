// Variante única para o catálogo staging capturado. Gera texto; não conecta nem executa SQL.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const dir=__dirname;
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const ler=n=>fs.readFileSync(path.join(dir,n),'utf8');
const original=ler('../../migracoes-capacidade-20261031/02-delta-operacional.sql');
const inventario=ler('catalogo-prekit-staging.json');
assert.equal(sha(original),'1619e78b9155ba9443b6080fa7d082f3c335d8e8b07015d5d894462149df4c94');
assert.equal(sha(inventario),'5c607e56e58e7aa7b67d16baee150f26ff05e2b599809645777a12f6af51b9ad');
const pre=JSON.parse(inventario);
assert.equal(pre.read_only,'on');
assert.equal(pre.server_version,'17.11');
assert.equal(pre.hash_catalogo_md5,'8abc338413ff0c60770d3aea1c3413d1');
assert.equal(pre.catalogo.relacoes.length,21); assert.equal(pre.catalogo.funcoes.length,27);
const guardaOriginal="md5(observado::text)<>'4550d262d2f09edec1efd68b4c699f67'";
const guardaDestino="md5(observado::text)<>'8abc338413ff0c60770d3aea1c3413d1'";
assert.equal(original.split(guardaOriginal).length,2);
const cabecalhoVariante=`-- VARIANTE EXPLÍCITA PARA STAGING, nunca produção. Revisão independente antes da execução.
-- Alvo: luguscapasskcsficckf / vhmjospwgiryrnrndkpd (Free); confirmar conexão fora do SQL.
-- Original SHA-256: ${sha(original)}.
-- Única diferença executável: fingerprint 4550d262d2f09edec1efd68b4c699f67 -> 8abc338413ff0c60770d3aea1c3413d1.
-- Fonte do novo fingerprint: catálogo real pós-bootstrap, SHA-256 ${sha(inventario)}.
-- Payload, validações, ACLs e gates do original permanecem idênticos. Não reaplicar após COMMIT.
`;
const variante=cabecalhoVariante+original.replace(guardaOriginal,guardaDestino);
const originalPre=original.slice(original.indexOf('do $preestado$'),original.indexOf('$preestado$;')+'$preestado$;'.length);
assert(originalPre.startsWith('do $preestado$')&&originalPre.endsWith('$preestado$;'));
const tabelas=[...pre.catalogo.relacoes.filter(x=>x.esquema==='public').map(x=>x.nome),'dados_robo'];
assert.equal(tabelas.length,19);
assert(tabelas.every(x=>/^[a-z_]+$/.test(x)));
const prefixoReadonly=`begin read only;
set local lock_timeout='2s';
set local statement_timeout='30s';
set local search_path=pg_catalog,public;
`;
const vazio=(lista)=>`do $fixture_vazia$
declare tabela text; possui_linhas boolean;
begin
 if current_user<>'postgres' or current_database()<>'postgres' or current_setting('server_version_num')<>'170011' then raise exception 'Executor/banco/versão incompatível com staging';end if;
 if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p'))<>${lista.length} then raise exception 'Quantidade de tabelas públicas divergente da fixture';end if;
 for tabela in select unnest(array[${lista.map(x=>"'"+x+"'").join(',')}]::text[]) loop
  execute format('select exists(select 1 from public.%I)',tabela) into possui_linhas;
  if possui_linhas then raise exception 'Fixture deve estar vazia antes da homologação de dados';end if;
 end loop;
 if exists(select 1 from auth.users) or exists(select 1 from storage.objects) then raise exception 'Auth/Storage devem permanecer sem usuários/arquivos nesta etapa';end if;
 if (select count(*) from storage.buckets)<>1 or not exists(select 1 from storage.buckets where id='operacao-documentos' and public=false) then raise exception 'Único bucket privado operacao-documentos obrigatório';end if;
end
$fixture_vazia$;
`;
const bucketJson=`jsonb_build_object('id',b.id,'name',b.name,'public',b.public,'file_size_limit',b.file_size_limit,'allowed_mime_types',b.allowed_mime_types,'objects',(select count(*) from storage.objects o where o.bucket_id=b.id))`;
const preflight=`-- Pré-kit staging; executar também após a rejeição do original ou um ROLLBACK.
-- Não reaplica o gate bootstrap vazio: o bucket privado foi criado depois daquela prova.
${prefixoReadonly}${originalPre.replace(guardaOriginal,guardaDestino)}
${vazio(tabelas)}
select jsonb_build_object('resultado','PREKIT_STAGING_CONFIRMADO','catalogo_md5','${pre.hash_catalogo_md5}',
 'read_only',current_setting('transaction_read_only'),'server_version',version(),'observado_em',now(),
 'tabelas_publicas_vazias',19,'usuarios_auth',0,'objetos_storage',0,'bucket',${bucketJson}) as evidencia_prekit
from storage.buckets b where b.id='operacao-documentos';
commit;
`;
const cabecalhoRollback=`-- ENSAIO TRANSACIONAL STAGING: executa o delta e seus gates, mas encerra com ROLLBACK.
-- Depois comprova o fingerprint pré-kit e os dados vazios em uma transação readonly nova.
-- Qualquer erro: interromper; ROLLBACK explícito e diagnóstico, sem repetir automaticamente.
`;
assert(/\ncommit;\s*$/.test(variante));
const rollback=cabecalhoRollback+variante.replace(/\ncommit;\s*$/,'\nrollback;\n')+'\n'+preflight;
const gates=original.slice(original.indexOf('-- Gate integral homologado, sem mudanças.'),original.lastIndexOf("notify pgrst,'reload schema';"));
assert(gates.includes('do $verificacao$')&&gates.includes('do $posestado$'));
const funcoes=[
 'public.invalidar_identificacao_empresa()','public.kit_documento_escopo_imutavel()',
 'public.preservar_escopo_operacao()','public.validar_arquivo_processo_operacao()',
 'public.confirmar_identificacao_empresa(uuid,uuid,text,text,jsonb,jsonb)',
 'public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb)'
];
const pos=`-- Gate readonly pós-delta; antes de criar usuários/documentos fictícios.
${prefixoReadonly}${gates}
${vazio([...tabelas,'operacao_identificacao_empresa','operacao_kit_documentos'])}
select jsonb_build_object('resultado','DELTA_STAGING_GATES_OK','read_only',current_setting('transaction_read_only'),
 'server_version',version(),'observado_em',now(),'tabelas_publicas_vazias',21,'usuarios_auth',0,'objetos_storage',0,
 'bucket',(select ${bucketJson} from storage.buckets b where b.id='operacao-documentos'),
 'privilegios_tabelas',(select jsonb_agg(jsonb_build_object('papel',r.rolname,'tabela',t.nome,'privilegio',p.nome,'permitido',has_table_privilege(r.oid,t.nome,p.nome)) order by r.rolname,t.nome,p.nome)
  from pg_roles r cross join (values('public.operacao_identificacao_empresa'),('public.operacao_kit_documentos')) t(nome)
  cross join (values('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN'),('SELECT WITH GRANT OPTION')) p(nome)
  where r.rolname in ('anon','authenticated','service_role')),
 'execucao_funcoes',(select jsonb_agg(jsonb_build_object('papel',r.rolname,'funcao',f.nome,'execute',has_function_privilege(r.oid,f.nome,'EXECUTE')) order by r.rolname,f.nome)
  from pg_roles r cross join unnest(array[${funcoes.map(x=>"'"+x+"'").join(',')}]::text[]) f(nome)
  where r.rolname in ('anon','authenticated','service_role'))) as evidencia_posdelta;
commit;
`;
const arquivos={'03-delta-operacional-staging.sql':variante,'04-ensaiar-delta-com-rollback-staging.sql':rollback,'05-verificar-prekit-somente-leitura.sql':preflight,'06-verificar-posdelta-somente-leitura.sql':pos};
const manifesto={estado:'preparado, não executado por esta frente',projeto:'luguscapasskcsficckf',organizacao:'vhmjospwgiryrnrndkpd',postgres:'17.11',originalSha256:sha(original),catalogoPrekitSha256:sha(inventario),fingerprintOriginal:'4550d262d2f09edec1efd68b4c699f67',fingerprintStaging:pre.hash_catalogo_md5,cabecalhoVariante,cabecalhoRollback,arquivos:Object.fromEntries(Object.entries(arquivos).map(([n,x])=>[n,sha(x)])),limites:['Variante de ambiente explícita, não execução byte a byte do original.','Rollback do delta não equivale a restauração de backup.','Gates e privilégios SQL não comprovam login/JWT ou isolamento entre CNPJs com dados.','Bucket novo privado vazio deve ser criado via Storage UI antes do ensaio; limites são observados, não fixados pela migração.']};
arquivos['delta-staging-manifesto.json']=JSON.stringify(manifesto,null,2)+'\n';
assert.deepEqual(process.argv.slice(2),['--emitir']);
for(const nome of Object.keys(arquivos)) assert(!fs.existsSync(path.join(dir,nome)),'Não sobrescrever '+nome);
for(const [nome,texto] of Object.entries(arquivos)) fs.writeFileSync(path.join(dir,nome),texto,{flag:'wx'});
console.log(JSON.stringify({preparado:true,sqlExecutado:false,arquivos:manifesto.arquivos}));
