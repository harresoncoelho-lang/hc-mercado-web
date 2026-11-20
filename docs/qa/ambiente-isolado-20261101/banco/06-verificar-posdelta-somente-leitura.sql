-- Gate readonly pós-delta; antes de criar usuários/documentos fictícios.
begin read only;
set local lock_timeout='2s';
set local statement_timeout='30s';
set local search_path=pg_catalog,public;
-- Gate integral homologado, sem mudanças.
-- Gate de configuração do kit, executado pelo dono da base após kit_documentos.sql.
-- Somente catálogos: não lê peças, não corrige permissões e não substitui a RLS.
-- A homologação deve parar se houver erro. Reexecutar após qualquer mudança de acesso.
do $verificacao$
declare
 tabela record;
 politica record;
 rotina record;
 papel record;
 rpc oid;
 funcao_trigger oid;
begin
 if ((pg_catalog.current_schemas(true))[1] operator(pg_catalog.=) 'pg_catalog'::pg_catalog.name) is not true then
  raise exception 'Kit pré-publicação: search_path deve resolver pg_catalog antes dos demais schemas';
 end if;
 select c.* into tabela from pg_catalog.pg_class c
 join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname='operacao_kit_documentos';
 if not found or tabela.relkind<>'r' or tabela.relpersistence<>'p' then
  raise exception 'Kit pré-publicação: tabela permanente operacao_kit_documentos ausente ou incompatível';
 end if;
 if not tabela.relrowsecurity then
  raise exception 'Kit pré-publicação: RLS de operacao_kit_documentos deve estar habilitada';
 end if;
 if (select count(*) from pg_catalog.pg_roles where rolname in ('anon','authenticated','service_role'))<>3
 or exists(select 1 from pg_catalog.pg_roles where rolname in ('anon','authenticated') and (rolsuper or rolbypassrls))
 or tabela.relowner in (select oid from pg_catalog.pg_roles where rolname in ('anon','authenticated','service_role')) then
  raise exception 'Kit pré-publicação: papéis de acesso ou proprietário incompatíveis';
 end if;

 if (select count(*) from pg_catalog.pg_policy where polrelid=tabela.oid)<>1 then
  raise exception 'Kit pré-publicação: deve existir somente a policy operacao_kit_documentos_select_empresa';
 end if;
 select p.* into politica from pg_catalog.pg_policy p where p.polrelid=tabela.oid;
 -- O deparser só pode omitir schemas quando os objetos públicos esperados são visíveis.
 if pg_catalog.pg_function_is_visible(pg_catalog.to_regprocedure('public.pode_acessar_empresa_operacao(uuid,uuid)')) is not true
 or pg_catalog.pg_table_is_visible(pg_catalog.to_regclass('public.clientes')) is not true
 or pg_catalog.pg_table_is_visible(pg_catalog.to_regclass('public.operacao_empresas')) is not true
 or pg_catalog.pg_table_is_visible(tabela.oid) is not true then
  raise exception 'Kit pré-publicação: policy com resolução ambígua dos objetos públicos esperados';
 end if;
 -- Comparação integral: procurar nomes com LIKE aceitaria uma policy acrescida de OR true.
 if politica.polname<>'operacao_kit_documentos_select_empresa' or politica.polcmd<>'r'
 or not politica.polpermissive or politica.polwithcheck is not null
 or politica.polroles<>array[(select oid from pg_catalog.pg_roles where rolname='authenticated')]
 or pg_catalog.regexp_replace(pg_catalog.replace(pg_catalog.pg_get_expr(politica.polqual,tabela.oid),'public.',''),'[[:space:]]+',' ','g') is distinct from
  '(pode_acessar_empresa_operacao(organizacao_id, empresa_id) AND (EXISTS ( SELECT 1 FROM clientes c WHERE ((c.id = auth.uid()) AND (c.status = ''aprovado''::text)))) AND (EXISTS ( SELECT 1 FROM operacao_empresas e WHERE ((e.id = operacao_kit_documentos.empresa_id) AND (e.organizacao_id = operacao_kit_documentos.organizacao_id) AND e.ativo))))' then
  raise exception 'Kit pré-publicação: policy de leitura diverge do escopo, cliente aprovado ou empresa ativa esperados';
 end if;

 if exists(
  select 1 from pg_catalog.aclexplode(coalesce(tabela.relacl,pg_catalog.acldefault('r',tabela.relowner))) a
  where a.grantee<>tabela.relowner and not (
   a.grantee in (select oid from pg_catalog.pg_roles where rolname in ('authenticated','service_role'))
   and a.privilege_type='SELECT' and not a.is_grantable
  )
 ) or exists(
  select 1 from pg_catalog.pg_attribute c cross join lateral pg_catalog.aclexplode(c.attacl) a
  where c.attrelid=tabela.oid and c.attnum>0 and not c.attisdropped and a.grantee<>tabela.relowner
 ) then
  raise exception 'Kit pré-publicação: privilégio de tabela ou coluna não previsto para o kit';
 end if;
 for papel in select oid,rolname from pg_catalog.pg_roles where rolname in ('anon','authenticated','service_role') loop
  if pg_catalog.has_table_privilege(papel.oid,tabela.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  or pg_catalog.has_any_column_privilege(papel.oid,tabela.oid,'INSERT,UPDATE,REFERENCES')
  or pg_catalog.has_table_privilege(papel.oid,tabela.oid,'SELECT WITH GRANT OPTION')
  or (papel.rolname='anon' and pg_catalog.has_any_column_privilege(papel.oid,tabela.oid,'SELECT'))
  or (papel.rolname<>'anon' and not pg_catalog.has_table_privilege(papel.oid,tabela.oid,'SELECT')) then
   raise exception 'Kit pré-publicação: privilégio efetivo de acesso ao kit incompatível';
  end if;
 end loop;

 rpc:=pg_catalog.to_regprocedure('public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb)');
 if rpc is null or (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='gravar_kit_documento')<>1 then
  raise exception 'Kit pré-publicação: RPC gravar_kit_documento ausente, assinatura divergente ou sobrecarga adicional';
 end if;
 select p.* into rotina from pg_catalog.pg_proc p where p.oid=rpc;
 if rotina.prokind<>'f' or not rotina.prosecdef or rotina.proretset or rotina.prorettype<>tabela.reltype
 or rotina.proowner<>tabela.relowner or rotina.pronargdefaults<>2 or rotina.proargmodes is not null
 or rotina.proargnames is distinct from array['p_documento','p_empresa','p_processo','p_organizacao','p_usuario','p_versao','p_tipo','p_acao','p_dados','p_hash','p_previa']::text[]
 or rotina.prolang<>(select oid from pg_catalog.pg_language where lanname='plpgsql')
 or rotina.proconfig is distinct from array['search_path=pg_catalog, pg_temp']::text[] then
  raise exception 'Kit pré-publicação: RPC com identidade, proprietário, SECURITY DEFINER ou search_path incompatível';
 end if;
 if exists(
  select 1 from pg_catalog.aclexplode(coalesce(rotina.proacl,pg_catalog.acldefault('f',rotina.proowner))) a
  where a.grantee<>rotina.proowner and not (
   a.grantee=(select oid from pg_catalog.pg_roles where rolname='service_role')
   and a.privilege_type='EXECUTE' and not a.is_grantable
  )
 ) or pg_catalog.has_function_privilege('anon',rpc,'EXECUTE')
 or pg_catalog.has_function_privilege('authenticated',rpc,'EXECUTE')
 or not pg_catalog.has_function_privilege('service_role',rpc,'EXECUTE')
 or pg_catalog.has_function_privilege('service_role',rpc,'EXECUTE WITH GRANT OPTION') then
  raise exception 'Kit pré-publicação: RPC EXECUTE deve estar restrito ao proprietário e service_role, sem repasse';
 end if;

 funcao_trigger:=pg_catalog.to_regprocedure('public.kit_documento_escopo_imutavel()');
 if funcao_trigger is null or (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='kit_documento_escopo_imutavel')<>1 then
  raise exception 'Kit pré-publicação: função do trigger ausente ou assinatura incompatível';
 end if;
 select p.* into rotina from pg_catalog.pg_proc p where p.oid=funcao_trigger;
 if rotina.prokind<>'f' or rotina.prosecdef or rotina.proretset or rotina.prorettype<>'pg_catalog.trigger'::regtype
 or rotina.proowner<>tabela.relowner
 or rotina.prolang<>(select oid from pg_catalog.pg_language where lanname='plpgsql')
 or rotina.proconfig is distinct from array['search_path=pg_catalog, pg_temp']::text[] then
  raise exception 'Kit pré-publicação: função do trigger com identidade, proprietário ou search_path incompatível';
 end if;
 if exists(
  select 1 from pg_catalog.aclexplode(coalesce(rotina.proacl,pg_catalog.acldefault('f',rotina.proowner))) a
  where a.grantee<>rotina.proowner
 ) or pg_catalog.has_function_privilege('anon',funcao_trigger,'EXECUTE')
 or pg_catalog.has_function_privilege('authenticated',funcao_trigger,'EXECUTE') then
  raise exception 'Kit pré-publicação: trigger EXECUTE deve estar restrito ao proprietário';
 end if;
 if (select count(*) from pg_catalog.pg_trigger t where t.tgrelid=tabela.oid and not t.tgisinternal)<>1
 or not exists(
  select 1 from pg_catalog.pg_trigger t where t.tgrelid=tabela.oid and not t.tgisinternal
   and t.tgname='kit_documento_escopo_imutavel' and t.tgfoid=funcao_trigger
   and t.tgenabled='O' and t.tgtype=19 and t.tgnargs=0 and t.tgattr=''::int2vector
   and t.tgqual is null and t.tgoldtable is null and t.tgnewtable is null
 ) then
  raise exception 'Kit pré-publicação: trigger BEFORE UPDATE de escopo ausente, desabilitado, alterado ou adicional';
 end if;
end
$verificacao$;
select 'KIT_PREPUBLICACAO_OK' as status;

do $posestado$
declare politicas jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('esquema',schemaname,'tabela',tablename,'nome',policyname,
  'permissiva',permissive,'papeis',roles,'comando',cmd,'using',qual,'check',with_check)
  order by schemaname,tablename,policyname),'[]'::jsonb) into politicas
 from pg_policies where (schemaname='storage' and tablename='objects') or
  (schemaname='public' and tablename like 'operacao\_%' escape '\' and tablename not in ('operacao_identificacao_empresa','operacao_kit_documentos'));
 if politicas is distinct from '[{"nome":"operacao_agenda_da_empresa","check":null,"using":"pode_acessar_empresa_operacao(organizacao_id, empresa_id)","papeis":["authenticated"],"tabela":"operacao_agenda","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_agenda_da_empresa_escrita","check":"pode_escrever_empresa_operacao(organizacao_id, empresa_id)","using":"pode_escrever_empresa_operacao(organizacao_id, empresa_id)","papeis":["authenticated"],"tabela":"operacao_agenda","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_anexos_da_empresa","check":null,"using":"pode_acessar_processo_operacao(organizacao_id, processo_id)","papeis":["authenticated"],"tabela":"operacao_anexos_processo","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_anexos_da_empresa_escrita","check":"(pode_escrever_processo_operacao(organizacao_id, processo_id) AND (EXISTS ( SELECT 1\n   FROM operacao_processos p\n  WHERE ((p.id = operacao_anexos_processo.processo_id) AND (p.organizacao_id = operacao_anexos_processo.organizacao_id) AND arquivo_no_escopo_operacao(operacao_anexos_processo.arquivo_caminho, p.organizacao_id, p.empresa_id)))))","using":"pode_escrever_processo_operacao(organizacao_id, processo_id)","papeis":["authenticated"],"tabela":"operacao_anexos_processo","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_contratos_da_empresa","check":null,"using":"pode_acessar_processo_operacao(organizacao_id, processo_id)","papeis":["authenticated"],"tabela":"operacao_contratos","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_contratos_da_empresa_escrita","check":"pode_escrever_processo_operacao(organizacao_id, processo_id)","using":"pode_escrever_processo_operacao(organizacao_id, processo_id)","papeis":["authenticated"],"tabela":"operacao_contratos","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_documentos_da_empresa","check":null,"using":"pode_acessar_empresa_operacao(organizacao_id, empresa_id)","papeis":["authenticated"],"tabela":"operacao_documentos","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_documentos_da_empresa_escrita","check":"(pode_escrever_empresa_operacao(organizacao_id, empresa_id) AND arquivo_no_escopo_operacao(arquivo_caminho, organizacao_id, empresa_id))","using":"pode_escrever_empresa_operacao(organizacao_id, empresa_id)","papeis":["authenticated"],"tabela":"operacao_documentos","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_empenhos_da_empresa","check":null,"using":"pode_acessar_processo_operacao(organizacao_id, processo_id)","papeis":["authenticated"],"tabela":"operacao_empenhos","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_empenhos_da_empresa_escrita","check":"pode_escrever_processo_operacao(organizacao_id, processo_id)","using":"pode_escrever_processo_operacao(organizacao_id, processo_id)","papeis":["authenticated"],"tabela":"operacao_empenhos","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_empresas_escrita","check":"pode_escrever_org_operacao(organizacao_id)","using":"pode_escrever_org_operacao(organizacao_id)","papeis":["authenticated"],"tabela":"operacao_empresas","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_empresas_leitura","check":null,"using":"pode_acessar_empresa_operacao(organizacao_id, id)","papeis":["public"],"tabela":"operacao_empresas","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_itens_da_empresa","check":null,"using":"pode_acessar_processo_operacao(organizacao_id, processo_id)","papeis":["authenticated"],"tabela":"operacao_itens_resultado","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_itens_da_empresa_escrita","check":"pode_escrever_processo_operacao(organizacao_id, processo_id)","using":"pode_escrever_processo_operacao(organizacao_id, processo_id)","papeis":["authenticated"],"tabela":"operacao_itens_resultado","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_membros_da_org","check":null,"using":"((usuario_id = auth.uid()) OR eh_membro_operacao(organizacao_id))","papeis":["public"],"tabela":"operacao_membros","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_ocorrencias_da_empresa","check":null,"using":"pode_acessar_processo_operacao(organizacao_id, processo_id)","papeis":["authenticated"],"tabela":"operacao_ocorrencias","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_ocorrencias_da_empresa_escrita","check":"pode_escrever_processo_operacao(organizacao_id, processo_id)","using":"pode_escrever_processo_operacao(organizacao_id, processo_id)","papeis":["authenticated"],"tabela":"operacao_ocorrencias","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_organizacoes_proprias","check":null,"using":"tem_vinculo_operacao(id)","papeis":["public"],"tabela":"operacao_organizacoes","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_prazos_da_empresa","check":null,"using":"pode_acessar_processo_operacao(organizacao_id, processo_id)","papeis":["authenticated"],"tabela":"operacao_prazos_processo","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_prazos_da_empresa_escrita","check":"pode_escrever_processo_operacao(organizacao_id, processo_id)","using":"pode_escrever_processo_operacao(organizacao_id, processo_id)","papeis":["authenticated"],"tabela":"operacao_prazos_processo","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_processos_da_empresa","check":null,"using":"pode_acessar_empresa_operacao(organizacao_id, empresa_id)","papeis":["authenticated"],"tabela":"operacao_processos","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_processos_da_empresa_escrita","check":"pode_escrever_empresa_operacao(organizacao_id, empresa_id)","using":"pode_escrever_empresa_operacao(organizacao_id, empresa_id)","papeis":["authenticated"],"tabela":"operacao_processos","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_renovacoes_da_empresa","check":null,"using":"(EXISTS ( SELECT 1\n   FROM operacao_documentos d\n  WHERE ((d.id = operacao_renovacoes_documento.documento_id) AND pode_acessar_empresa_operacao(d.organizacao_id, d.empresa_id))))","papeis":["authenticated"],"tabela":"operacao_renovacoes_documento","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_renovacoes_da_empresa_escrita","check":"(EXISTS ( SELECT 1\n   FROM operacao_documentos d\n  WHERE ((d.id = operacao_renovacoes_documento.documento_id) AND pode_escrever_empresa_operacao(d.organizacao_id, d.empresa_id))))","using":"(EXISTS ( SELECT 1\n   FROM operacao_documentos d\n  WHERE ((d.id = operacao_renovacoes_documento.documento_id) AND pode_escrever_empresa_operacao(d.organizacao_id, d.empresa_id))))","papeis":["authenticated"],"tabela":"operacao_renovacoes_documento","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_tipos_escrita","check":"((organizacao_id IS NOT NULL) AND pode_escrever_org_operacao(organizacao_id))","using":"((organizacao_id IS NOT NULL) AND pode_escrever_org_operacao(organizacao_id))","papeis":["authenticated"],"tabela":"operacao_tipos_documento","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_tipos_leitura","check":null,"using":"((organizacao_id IS NULL) OR eh_membro_operacao(organizacao_id))","papeis":["public"],"tabela":"operacao_tipos_documento","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_arquivos_atualizacao","check":"((bucket_id = ''operacao-documentos''::text) AND escrita_arquivo_operacao(name))","using":"((bucket_id = ''operacao-documentos''::text) AND escrita_arquivo_operacao(name))","papeis":["authenticated"],"tabela":"objects","comando":"UPDATE","esquema":"storage","permissiva":"PERMISSIVE"},{"nome":"operacao_arquivos_envio","check":"((bucket_id = ''operacao-documentos''::text) AND escrita_arquivo_operacao(name))","using":null,"papeis":["authenticated"],"tabela":"objects","comando":"INSERT","esquema":"storage","permissiva":"PERMISSIVE"},{"nome":"operacao_arquivos_exclusao","check":null,"using":"((bucket_id = ''operacao-documentos''::text) AND escrita_arquivo_operacao(name))","papeis":["authenticated"],"tabela":"objects","comando":"DELETE","esquema":"storage","permissiva":"PERMISSIVE"},{"nome":"operacao_arquivos_leitura","check":null,"using":"((bucket_id = ''operacao-documentos''::text) AND acesso_arquivo_operacao(name))","papeis":["public"],"tabela":"objects","comando":"SELECT","esquema":"storage","permissiva":"PERMISSIVE"}]'::jsonb then
  raise exception 'Policies finais divergentes: abortado';
 end if;
 if exists(select 1 from (values
  ('public.arquivo_no_escopo_operacao(text,uuid,uuid)','c727f040598b92b257a5322118447d6f'),
  ('public.confirmar_identificacao_empresa(uuid,uuid,text,text,jsonb,jsonb)','4c6c9e37d1992153b013c9cee0ae23d4'),
  ('public.escrita_arquivo_operacao(text)','d95ab917f9d1faf6270e16d85dda42fd'),
  ('public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb)','0cc051bf73f24861468d39efe832a727'),
  ('public.identificacao_empresa_habilitada()','880430792a38242de6aee692c85b40a8'),
  ('public.invalidar_identificacao_empresa()','9d267cd8c8f193abb24ac9485d91d400'),
  ('public.kit_documento_escopo_imutavel()','1cc81ddba3b38f7ea12325bf33975081'),
  ('public.pode_escrever_empresa_operacao(uuid,uuid)','c5e91057ee05d745a22bd2fc89c80322'),
  ('public.pode_escrever_org_operacao(uuid)','c5fa4a20c0df119753f8f2efd99b4264'),
  ('public.pode_escrever_processo_operacao(uuid,uuid)','7de47c8d343558a2dc2180ad2a4daffc'),
  ('public.preservar_escopo_operacao()','0b08ce4d1e636bcc2df13b15f55f9281'),
  ('public.validar_arquivo_processo_operacao()','adb6e775c624ab8187028faef6f31d91')
 ) as esperado(assinatura,hash) left join pg_proc p on p.oid=to_regprocedure(esperado.assinatura)
 where p.oid is null or md5(replace(p.prosrc,chr(13),''))<>esperado.hash) then
  raise exception 'Corpos finais divergentes: abortado';
 end if;
 -- Funções internas de trigger não são RPCs; defaults e herança também devem falhar fechados.
 if exists(select 1 from unnest(array['public.invalidar_identificacao_empresa()','public.kit_documento_escopo_imutavel()','public.preservar_escopo_operacao()','public.validar_arquivo_processo_operacao()']::text[]) esperado(assinatura)
  left join pg_proc p on p.oid=to_regprocedure(esperado.assinatura)
  where p.oid is null or p.prorettype<>'pg_catalog.trigger'::regtype
   or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee<>p.proowner)
   or exists(select 1 from pg_roles r where r.rolname in ('anon','authenticated','service_role')
    and has_function_privilege(r.oid,p.oid,'EXECUTE'))) then
  raise exception 'ACL de função interna de trigger divergente: abortado';
 end if;
 if not exists(select 1 from pg_class c where c.oid='public.operacao_identificacao_empresa'::regclass and c.relrowsecurity)
 or (select count(*) from pg_trigger where tgname in ('identificacao_documento_alterado','identificacao_arquivo_alterado','identificacao_cadastro_alterado') and not tgisinternal and tgenabled='O')<>3 then
  raise exception 'RLS ou invalidação da identificação ausente';
 end if;
end
$posestado$;

do $fixture_vazia$
declare tabela text; possui_linhas boolean;
begin
 if current_user<>'postgres' or current_database()<>'postgres' or current_setting('server_version_num')<>'170011' then raise exception 'Executor/banco/versão incompatível com staging';end if;
 if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p'))<>21 then raise exception 'Quantidade de tabelas públicas divergente da fixture';end if;
 for tabela in select unnest(array['admins','clientes','operacao_agenda','operacao_anexos_processo','operacao_contratos','operacao_convites_empresa','operacao_documentos','operacao_empenhos','operacao_empresas','operacao_itens_resultado','operacao_limites_cnpj','operacao_membros','operacao_ocorrencias','operacao_organizacoes','operacao_prazos_processo','operacao_processos','operacao_renovacoes_documento','operacao_tipos_documento','dados_robo','operacao_identificacao_empresa','operacao_kit_documentos']::text[]) loop
  execute format('select exists(select 1 from public.%I)',tabela) into possui_linhas;
  if possui_linhas then raise exception 'Fixture deve estar vazia antes da homologação de dados';end if;
 end loop;
 if exists(select 1 from auth.users) or exists(select 1 from storage.objects) then raise exception 'Auth/Storage devem permanecer sem usuários/arquivos nesta etapa';end if;
 if (select count(*) from storage.buckets)<>1 or not exists(select 1 from storage.buckets where id='operacao-documentos' and public=false) then raise exception 'Único bucket privado operacao-documentos obrigatório';end if;
end
$fixture_vazia$;

select jsonb_build_object('resultado','DELTA_STAGING_GATES_OK','read_only',current_setting('transaction_read_only'),
 'server_version',version(),'observado_em',now(),'tabelas_publicas_vazias',21,'usuarios_auth',0,'objetos_storage',0,
 'bucket',(select jsonb_build_object('id',b.id,'name',b.name,'public',b.public,'file_size_limit',b.file_size_limit,'allowed_mime_types',b.allowed_mime_types,'objects',(select count(*) from storage.objects o where o.bucket_id=b.id)) from storage.buckets b where b.id='operacao-documentos'),
 'privilegios_tabelas',(select jsonb_agg(jsonb_build_object('papel',r.rolname,'tabela',t.nome,'privilegio',p.nome,'permitido',has_table_privilege(r.oid,t.nome,p.nome)) order by r.rolname,t.nome,p.nome)
  from pg_roles r cross join (values('public.operacao_identificacao_empresa'),('public.operacao_kit_documentos')) t(nome)
  cross join (values('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN'),('SELECT WITH GRANT OPTION')) p(nome)
  where r.rolname in ('anon','authenticated','service_role')),
 'execucao_funcoes',(select jsonb_agg(jsonb_build_object('papel',r.rolname,'funcao',f.nome,'execute',has_function_privilege(r.oid,f.nome,'EXECUTE')) order by r.rolname,f.nome)
  from pg_roles r cross join unnest(array['public.invalidar_identificacao_empresa()','public.kit_documento_escopo_imutavel()','public.preservar_escopo_operacao()','public.validar_arquivo_processo_operacao()','public.confirmar_identificacao_empresa(uuid,uuid,text,text,jsonb,jsonb)','public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb)']::text[]) f(nome)
  where r.rolname in ('anon','authenticated','service_role'))) as evidencia_posdelta;
commit;
