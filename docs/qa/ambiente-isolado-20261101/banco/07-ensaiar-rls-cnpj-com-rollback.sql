-- ENSAIO SQL RLS; revisão independente antes de executar. Nunca produção.
-- Único alvo: luguscapasskcsficckf / vhmjospwgiryrnrndkpd / PostgreSQL 17.11.
-- Quatro identidades fictícias transitórias; nenhuma senha, token, login, SMTP ou chamada HTTP.
-- SET LOCAL ROLE/claims testa autorização SQL; NÃO testa JWT nem o serviço Auth.
-- Todo DML está em UM BEGIN/ROLLBACK. As consultas finais reconferem catálogo e vazio após rollback.
-- Qualquer erro: parar e executar ROLLBACK explicitamente; não repetir nem alterar a guarda.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
set local idle_in_transaction_session_timeout='60s';
set local search_path=pg_catalog,public;
set local row_security=on;
lock table public.admins,public.clientes,public.operacao_agenda,public.operacao_anexos_processo,public.operacao_contratos,public.operacao_convites_empresa,public.operacao_documentos,public.operacao_empenhos,public.operacao_empresas,public.operacao_identificacao_empresa,public.operacao_itens_resultado,public.operacao_kit_documentos,public.operacao_limites_cnpj,public.operacao_membros,public.operacao_ocorrencias,public.operacao_organizacoes,public.operacao_prazos_processo,public.operacao_processos,public.operacao_renovacoes_documento,public.operacao_tipos_documento,public.dados_robo,auth.users,storage.objects,storage.buckets in access exclusive mode;
do $catalogo_e_vazio$
declare observado jsonb; tabela text; possui_linhas boolean;
begin
 perform set_config('search_path','pg_catalog,public',true);
 if current_user<>'postgres' or current_database()<>'postgres' or current_setting('server_version_num')<>'170011' then raise exception 'Executor/banco/versão fora do staging revisado';end if;
 with
relacoes as (
 select c.*,n.nspname as esquema from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('r','p','v','m','f','S') and ((n.nspname='public' and (c.relname like 'operacao\_%' escape '\' or c.relname in ('clientes','admins')))
    or (n.nspname='auth' and c.relname='users')
    or (n.nspname='storage' and c.relname in ('objects','buckets')))
), funcoes as (
 select p.*,n.nspname as esquema from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where p.prokind in ('f','p') and (
  (n.nspname='public' and (p.proname like '%operacao%' or p.proname like '%identificacao_empresa%' or p.proname in ('gravar_kit_documento','kit_documento_escopo_imutavel','configurar_limite_cnpjs_cliente','consultar_limite_cnpjs_cliente')))
  or (n.nspname='auth' and p.proname='uid')
  or p.oid in (select t.tgfoid from pg_trigger t join relacoes r on r.oid=t.tgrelid where not t.tgisinternal)
 )
), secoes as (
 select 'relacoes' as secao,coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'nome',r.relname,'tipo',r.relkind,'dono',pg_get_userbyid(r.relowner),
  'rls',r.relrowsecurity,'force_rls',r.relforcerowsecurity,'opcoes',r.reloptions,
  'acl',r.relacl::text) order by r.esquema,r.relname),'[]'::jsonb) as itens from relacoes r
 union all
 select 'colunas',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'tabela',r.relname,'ordem',a.attnum,'nome',a.attname,
  'tipo',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
  'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid),
  'acl',a.attacl::text) order by r.esquema,r.relname,a.attnum),'[]'::jsonb)
 from relacoes r join pg_attribute a on a.attrelid=r.oid and a.attnum>0 and not a.attisdropped
 left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
 where r.relkind in ('r','p','v','m','f')
 union all
 select 'constraints',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'tabela',r.relname,'nome',c.conname,'tipo',c.contype,
  'validada',c.convalidated,'deferivel',c.condeferrable,'adiada',c.condeferred,
  'definicao',pg_get_constraintdef(c.oid,true)) order by r.esquema,r.relname,c.conname),'[]'::jsonb)
 from relacoes r join pg_constraint c on c.conrelid=r.oid
 union all
 select 'indices',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'tabela',r.relname,'nome',ci.relname,'unico',i.indisunique,
  'valido',i.indisvalid,'pronto',i.indisready,'primario',i.indisprimary,
  'definicao',pg_get_indexdef(i.indexrelid)) order by r.esquema,r.relname,ci.relname),'[]'::jsonb)
 from relacoes r join pg_index i on i.indrelid=r.oid join pg_class ci on ci.oid=i.indexrelid
 union all
 select 'policies',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',schemaname,'tabela',tablename,'nome',policyname,'permissiva',permissive,
  'papeis',roles,'comando',cmd,'using',qual,'check',with_check)
  order by schemaname,tablename,policyname),'[]'::jsonb)
 from pg_policies where (schemaname='public' and (tablename like 'operacao\_%' escape '\' or tablename in ('clientes','admins')))
  or (schemaname='storage' and tablename in ('objects','buckets')) or (schemaname='auth' and tablename='users')
 union all
 select 'triggers',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'tabela',r.relname,'nome',t.tgname,'habilitado',t.tgenabled,
  'funcao',t.tgfoid::regprocedure::text,'definicao',pg_get_triggerdef(t.oid,true))
  order by r.esquema,r.relname,t.tgname),'[]'::jsonb)
 from relacoes r join pg_trigger t on t.tgrelid=r.oid where not t.tgisinternal
 union all
 select 'funcoes',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',f.esquema,'nome',f.proname,'assinatura',f.oid::regprocedure::text,
  'argumentos',pg_get_function_identity_arguments(f.oid),'retorno',pg_get_function_result(f.oid),
  'dono',pg_get_userbyid(f.proowner),'security_definer',f.prosecdef,'volatilidade',f.provolatile,
  'strict',f.proisstrict,'configuracao',f.proconfig,'acl',f.proacl::text,
  'hash_corpo_md5',md5(replace(f.prosrc,chr(13),'')),
  'definicao',case when f.esquema='public' and (f.proname like '%operacao%' or f.proname like '%identificacao_empresa%' or f.proname in ('gravar_kit_documento','kit_documento_escopo_imutavel','configurar_limite_cnpjs_cliente','consultar_limite_cnpjs_cliente')) then pg_get_functiondef(f.oid) else null end)
  order by f.esquema,f.oid::regprocedure::text),'[]'::jsonb) from funcoes f
 union all
 select 'acl_relacoes',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'objeto',r.relname,'concedente',pg_get_userbyid(a.grantor),
  'papel',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
  'privilegio',a.privilege_type,'grant_option',a.is_grantable)
  order by r.esquema,r.relname,a.grantee,a.privilege_type),'[]'::jsonb)
 from relacoes r cross join lateral aclexplode(coalesce(r.relacl,acldefault(case when r.relkind='S' then 's'::"char" else 'r'::"char" end,r.relowner))) a
 union all
 select 'acl_funcoes',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',f.esquema,'objeto',f.oid::regprocedure::text,'concedente',pg_get_userbyid(a.grantor),
  'papel',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
  'privilegio',a.privilege_type,'grant_option',a.is_grantable)
  order by f.esquema,f.oid::regprocedure::text,a.grantee,a.privilege_type),'[]'::jsonb)
 from funcoes f cross join lateral aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
 union all
 select 'schemas',coalesce(jsonb_agg(jsonb_build_object('nome',nspname,'dono',pg_get_userbyid(nspowner),'acl',nspacl::text) order by nspname),'[]'::jsonb)
 from pg_namespace where nspname in ('public','auth','storage')
 union all
 select 'defaults_acl',coalesce(jsonb_agg(jsonb_build_object('dono',pg_get_userbyid(d.defaclrole),
  'esquema',coalesce(n.nspname,'*'),'tipo',d.defaclobjtype,'acl',d.defaclacl::text)
  order by d.defaclrole,d.defaclnamespace,d.defaclobjtype),'[]'::jsonb)
 from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
 where d.defaclnamespace=0 or n.nspname in ('public','auth','storage')
 union all
 select 'papeis',coalesce(jsonb_agg(jsonb_build_object('nome',rolname,'superuser',rolsuper,
  'inherit',rolinherit,'login',rolcanlogin,'create_role',rolcreaterole,'bypass_rls',rolbypassrls) order by rolname),'[]'::jsonb) from pg_roles
 union all
 select 'membros_papeis',coalesce(jsonb_agg(jsonb_build_object('papel',pg_get_userbyid(m.roleid),
  'membro',pg_get_userbyid(m.member),'concedente',pg_get_userbyid(m.grantor),'admin_option',m.admin_option,
  'inherit_option',to_jsonb(m)->'inherit_option','set_option',to_jsonb(m)->'set_option')
  order by m.roleid,m.member),'[]'::jsonb) from pg_auth_members m
 union all
 select 'dependencias_entrada',coalesce(jsonb_agg(jsonb_build_object(
  'objeto',pg_describe_object(d.classid,d.objid,d.objsubid),
  'referencia',pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid),'tipo',d.deptype)
  order by d.classid,d.objid,d.objsubid,d.refobjid,d.refobjsubid),'[]'::jsonb)
 from pg_depend d where (d.refclassid='pg_class'::regclass and d.refobjid in (select oid from relacoes))
  or (d.refclassid='pg_proc'::regclass and d.refobjid in (select oid from funcoes))
), catalogo as (select jsonb_object_agg(secao,itens order by secao) as corpo from secoes)

 select corpo into observado from catalogo;
 if md5(observado::text)<>'830899ecee2a58d23beec619b4963fed' then raise exception 'Catálogo pós-delta divergente; não contornar a guarda';end if;
 if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p'))<>21 then raise exception 'Tabelas públicas divergentes';end if;
 for tabela in select unnest(array['admins','clientes','operacao_agenda','operacao_anexos_processo','operacao_contratos','operacao_convites_empresa','operacao_documentos','operacao_empenhos','operacao_empresas','operacao_identificacao_empresa','operacao_itens_resultado','operacao_kit_documentos','operacao_limites_cnpj','operacao_membros','operacao_ocorrencias','operacao_organizacoes','operacao_prazos_processo','operacao_processos','operacao_renovacoes_documento','operacao_tipos_documento','dados_robo']::text[]) loop
  execute format('select exists(select 1 from public.%I)',tabela) into possui_linhas;
  if possui_linhas then raise exception 'Fixture SQL exige public vazio';end if;
 end loop;
 if exists(select 1 from auth.users) or exists(select 1 from storage.objects) then raise exception 'Fixture SQL exige Auth e objetos Storage vazios';end if;
 if (select count(*) from storage.buckets)<>1 or not exists(select 1 from storage.buckets where id='operacao-documentos' and public=false) then raise exception 'Bucket privado único obrigatório';end if;
end
$catalogo_e_vazio$;

reset role;
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);

-- Inserções explícitas, sem senha/token. O trigger real cria clientes; não inserir clientes em paralelo.
insert into auth.users(id,email,aud,role,raw_user_meta_data) values
 ('00000000-0000-4000-8000-000000000101'::uuid,'qa-rls-101@example.invalid','authenticated','authenticated','{"nome":"Pessoa fictícia SQL QA 101"}'::jsonb),
 ('00000000-0000-4000-8000-000000000102'::uuid,'qa-rls-102@example.invalid','authenticated','authenticated','{"nome":"Pessoa fictícia SQL QA 102"}'::jsonb),
 ('00000000-0000-4000-8000-000000000103'::uuid,'qa-rls-103@example.invalid','authenticated','authenticated','{"nome":"Pessoa fictícia SQL QA 103"}'::jsonb),
 ('00000000-0000-4000-8000-000000000104'::uuid,'qa-rls-104@example.invalid','authenticated','authenticated','{"nome":"Pessoa fictícia SQL QA 104"}'::jsonb);
-- Cadastro fictício usa o trigger real
do $caso$
declare n integer; v integer;
begin
 if (select count(*) from public.clientes where id=any(array['00000000-0000-4000-8000-000000000101'::uuid,'00000000-0000-4000-8000-000000000102'::uuid,'00000000-0000-4000-8000-000000000103'::uuid,'00000000-0000-4000-8000-000000000104'::uuid]::uuid[]) and status='pendente')<>4 then raise exception 'Trigger de cadastro não gerou quatro clientes pendentes';end if;
end
$caso$;

update public.clientes set status='aprovado' where id=any(array['00000000-0000-4000-8000-000000000101'::uuid,'00000000-0000-4000-8000-000000000102'::uuid,'00000000-0000-4000-8000-000000000103'::uuid,'00000000-0000-4000-8000-000000000104'::uuid]::uuid[]);
insert into public.operacao_organizacoes(id,nome,owner_id) values
 ('00000000-0000-4000-8000-000000000001'::uuid,'Organização fictícia A/B SQL QA','00000000-0000-4000-8000-000000000101'::uuid),('00000000-0000-4000-8000-000000000002'::uuid,'Outra organização fictícia SQL QA','00000000-0000-4000-8000-000000000104'::uuid);
insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values
 ('00000000-0000-4000-8000-000000000011'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'Alfa Fictícia SQL QA','11222333000181'),('00000000-0000-4000-8000-000000000012'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'Beta Fictícia SQL QA','11222333000262');
insert into public.operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values
 ('00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000101'::uuid,'gestor',null),('00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000102'::uuid,'operador','00000000-0000-4000-8000-000000000011'::uuid),
 ('00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000103'::uuid,'leitura','00000000-0000-4000-8000-000000000011'::uuid),('00000000-0000-4000-8000-000000000002'::uuid,'00000000-0000-4000-8000-000000000104'::uuid,'gestor',null);
insert into public.operacao_processos(id,organizacao_id,empresa_id,objeto) values
 ('00000000-0000-4000-8000-000000000021'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000011'::uuid,'Processo fictício Alfa'),('00000000-0000-4000-8000-000000000022'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000012'::uuid,'Processo fictício Beta');
insert into public.operacao_documentos(id,organizacao_id,empresa_id,tipo,arquivo_caminho,criado_por) values
 ('00000000-0000-4000-8000-000000000031'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000011'::uuid,'Fixture documental Alfa','00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000011/fixture-a.pdf','00000000-0000-4000-8000-000000000102'::uuid),
 ('00000000-0000-4000-8000-000000000032'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000012'::uuid,'Fixture documental Beta','00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000012/fixture-b.pdf','00000000-0000-4000-8000-000000000101'::uuid);
-- Os caminhos são metadados fictícios; nenhum arquivo é criado em Storage.
reset role;
select set_config('request.jwt.claim.sub','',true),
 set_config('request.jwt.claims','{"role":"service_role"}'::jsonb::text,true);
set local role service_role;

-- RPC cria declaração A e rascunho de proposta B com autor autorizado
do $caso$
declare n integer; v integer;
begin
 if current_user<>'service_role' then raise exception 'Papel SQL incorreto';end if;
 select (public.gravar_kit_documento('00000000-0000-4000-8000-000000000051'::uuid,'00000000-0000-4000-8000-000000000011'::uuid,'00000000-0000-4000-8000-000000000021'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000102'::uuid,0,'declaracao','salvar','{"declaracao":{"titulo":"Declaração fictícia SQL QA","texto":"Fixture de acesso; não protocolar.","fonte":"Fixture"}}'::jsonb)).versao into v;if v<>1 then raise exception 'Declaração não criada';end if;
 select (public.gravar_kit_documento('00000000-0000-4000-8000-000000000052'::uuid,'00000000-0000-4000-8000-000000000012'::uuid,'00000000-0000-4000-8000-000000000022'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000101'::uuid,0,'proposta','salvar','{"proposta":{"itemIds":[],"unidades":{},"validade":"60 dias","prazoEntrega":"10 dias","pagamento":"30 dias"}}'::jsonb)).versao into v;if v<>1 then raise exception 'Proposta não criada';end if;
end
$caso$;

-- RPC respeita CNPJ, organização, papel de leitura e processo
do $caso$
declare n integer; v integer;
begin
 begin
  perform public.gravar_kit_documento('00000000-0000-4000-8000-000000000053'::uuid,'00000000-0000-4000-8000-000000000012'::uuid,'00000000-0000-4000-8000-000000000022'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000102'::uuid,0,'declaracao','salvar','{"declaracao":{"titulo":"Declaração fictícia SQL QA","texto":"Fixture de acesso; não protocolar.","fonte":"Fixture"}}'::jsonb);
  raise exception 'Negativa não bloqueada: operador restrito em B';
 exception when sqlstate 'PT403' then null;
 end;
 begin
  perform public.gravar_kit_documento('00000000-0000-4000-8000-000000000053'::uuid,'00000000-0000-4000-8000-000000000011'::uuid,'00000000-0000-4000-8000-000000000021'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000104'::uuid,0,'declaracao','salvar','{"declaracao":{"titulo":"Declaração fictícia SQL QA","texto":"Fixture de acesso; não protocolar.","fonte":"Fixture"}}'::jsonb);
  raise exception 'Negativa não bloqueada: outra organização';
 exception when sqlstate 'PT403' then null;
 end;
 begin
  perform public.gravar_kit_documento('00000000-0000-4000-8000-000000000053'::uuid,'00000000-0000-4000-8000-000000000011'::uuid,'00000000-0000-4000-8000-000000000021'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000103'::uuid,0,'declaracao','salvar','{"declaracao":{"titulo":"Declaração fictícia SQL QA","texto":"Fixture de acesso; não protocolar.","fonte":"Fixture"}}'::jsonb);
  raise exception 'Negativa não bloqueada: leitor não grava';
 exception when sqlstate 'PT403' then null;
 end;
 begin
  perform public.gravar_kit_documento('00000000-0000-4000-8000-000000000053'::uuid,'00000000-0000-4000-8000-000000000012'::uuid,'00000000-0000-4000-8000-000000000021'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000101'::uuid,0,'declaracao','salvar','{"declaracao":{"titulo":"Declaração fictícia SQL QA","texto":"Fixture de acesso; não protocolar.","fonte":"Fixture"}}'::jsonb);
  raise exception 'Negativa não bloqueada: processo A com empresa B';
 exception when sqlstate 'PT404' then null;
 end;
end
$caso$;

-- service_role não faz DML direto no kit
do $caso$
declare n integer; v integer;
begin
 begin
  update public.operacao_kit_documentos set versao=99 where id='00000000-0000-4000-8000-000000000051'::uuid;
  raise exception 'Negativa não bloqueada: service_role UPDATE';
 exception when sqlstate '42501' then null;
 end;
 begin
  delete from public.operacao_kit_documentos where id='00000000-0000-4000-8000-000000000051'::uuid;
  raise exception 'Negativa não bloqueada: service_role DELETE';
 exception when sqlstate '42501' then null;
 end;
 begin
  insert into public.operacao_kit_documentos(id,organizacao_id,empresa_id,processo_id,tipo,dados,criado_por,atualizado_por) values('00000000-0000-4000-8000-000000000053'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000011'::uuid,'00000000-0000-4000-8000-000000000021'::uuid,'declaracao','{"declaracao":{"titulo":"Declaração fictícia SQL QA","texto":"Fixture de acesso; não protocolar.","fonte":"Fixture"}}'::jsonb,'00000000-0000-4000-8000-000000000102'::uuid,'00000000-0000-4000-8000-000000000102'::uuid);
  raise exception 'Negativa não bloqueada: service_role INSERT';
 exception when sqlstate '42501' then null;
 end;
end
$caso$;

reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000101',true),
 set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000101","role":"authenticated","email":"qa-rls-101@example.invalid"}'::jsonb::text,true);
set local role authenticated;
-- Gestor vê A e B
do $caso$
declare n integer; v integer;
begin
 if current_user<>'authenticated' or auth.uid() is distinct from '00000000-0000-4000-8000-000000000101'::uuid then raise exception 'Contexto de identidade SQL incorreto';end if;
 if (select coalesce(array_agg(id order by id),'{}'::uuid[]) from public.operacao_documentos) is distinct from array['00000000-0000-4000-8000-000000000031'::uuid,'00000000-0000-4000-8000-000000000032'::uuid]::uuid[] then raise exception 'Documentos fora da matriz: Gestor vê A e B';end if;
 if (select coalesce(array_agg(id order by id),'{}'::uuid[]) from public.operacao_kit_documentos) is distinct from array['00000000-0000-4000-8000-000000000051'::uuid,'00000000-0000-4000-8000-000000000052'::uuid]::uuid[] then raise exception 'Peças fora da matriz: Gestor vê A e B';end if;
end
$caso$;

reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000102',true),
 set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000102","role":"authenticated","email":"qa-rls-102@example.invalid"}'::jsonb::text,true);
set local role authenticated;
-- Operador restrito vê somente A
do $caso$
declare n integer; v integer;
begin
 if current_user<>'authenticated' or auth.uid() is distinct from '00000000-0000-4000-8000-000000000102'::uuid then raise exception 'Contexto de identidade SQL incorreto';end if;
 if (select coalesce(array_agg(id order by id),'{}'::uuid[]) from public.operacao_documentos) is distinct from array['00000000-0000-4000-8000-000000000031'::uuid]::uuid[] then raise exception 'Documentos fora da matriz: Operador restrito vê somente A';end if;
 if (select coalesce(array_agg(id order by id),'{}'::uuid[]) from public.operacao_kit_documentos) is distinct from array['00000000-0000-4000-8000-000000000051'::uuid]::uuid[] then raise exception 'Peças fora da matriz: Operador restrito vê somente A';end if;
end
$caso$;

-- Operador altera documento A, não altera B nem insere em B
do $caso$
declare n integer; v integer;
begin
 update public.operacao_documentos set tipo='Fixture Alfa alterada' where id='00000000-0000-4000-8000-000000000031'::uuid;get diagnostics n=row_count;if n<>1 then raise exception 'Operador não alterou A';end if;
 update public.operacao_documentos set tipo='Alteração indevida Beta' where id='00000000-0000-4000-8000-000000000032'::uuid;get diagnostics n=row_count;if n<>0 then raise exception 'Operador alterou B';end if;
 begin
  insert into public.operacao_documentos(id,organizacao_id,empresa_id,tipo,arquivo_caminho) values('00000000-0000-4000-8000-000000000033'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000012'::uuid,'Indevido','00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000012/indevido.pdf');
  raise exception 'Negativa não bloqueada: INSERT documental em B';
 exception when sqlstate '42501' then null;
 end;
end
$caso$;

-- authenticated não faz DML direto nem chama as RPCs privadas
do $caso$
declare n integer; v integer;
begin
 begin
  update public.operacao_kit_documentos set versao=99 where id='00000000-0000-4000-8000-000000000051'::uuid;
  raise exception 'Negativa não bloqueada: authenticated UPDATE';
 exception when sqlstate '42501' then null;
 end;
 begin
  delete from public.operacao_kit_documentos where id='00000000-0000-4000-8000-000000000051'::uuid;
  raise exception 'Negativa não bloqueada: authenticated DELETE';
 exception when sqlstate '42501' then null;
 end;
 begin
  insert into public.operacao_kit_documentos(id,organizacao_id,empresa_id,processo_id,tipo,dados,criado_por,atualizado_por) values('00000000-0000-4000-8000-000000000053'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000011'::uuid,'00000000-0000-4000-8000-000000000021'::uuid,'declaracao','{"declaracao":{"titulo":"Declaração fictícia SQL QA","texto":"Fixture de acesso; não protocolar.","fonte":"Fixture"}}'::jsonb,'00000000-0000-4000-8000-000000000102'::uuid,'00000000-0000-4000-8000-000000000102'::uuid);
  raise exception 'Negativa não bloqueada: authenticated INSERT';
 exception when sqlstate '42501' then null;
 end;
 begin
  perform public.gravar_kit_documento('00000000-0000-4000-8000-000000000053'::uuid,'00000000-0000-4000-8000-000000000011'::uuid,'00000000-0000-4000-8000-000000000021'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000102'::uuid,0,'declaracao','salvar','{"declaracao":{"titulo":"Declaração fictícia SQL QA","texto":"Fixture de acesso; não protocolar.","fonte":"Fixture"}}'::jsonb);
  raise exception 'Negativa não bloqueada: RPC gravar_kit_documento';
 exception when sqlstate '42501' then null;
 end;
 begin
  perform public.confirmar_identificacao_empresa('00000000-0000-4000-8000-000000000011'::uuid,'00000000-0000-4000-8000-000000000102'::uuid,'Alfa Fictícia SQL QA','11222333000181','{"endereco":"Rua fictícia","representante":"Pessoa fictícia","cargo":"Diretoria"}'::jsonb,'[]'::jsonb);
  raise exception 'Negativa não bloqueada: RPC confirmar_identificacao_empresa';
 exception when sqlstate '42501' then null;
 end;
end
$caso$;

reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000103',true),
 set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000103","role":"authenticated","email":"qa-rls-103@example.invalid"}'::jsonb::text,true);
set local role authenticated;
-- Leitor restrito vê somente A
do $caso$
declare n integer; v integer;
begin
 if current_user<>'authenticated' or auth.uid() is distinct from '00000000-0000-4000-8000-000000000103'::uuid then raise exception 'Contexto de identidade SQL incorreto';end if;
 if (select coalesce(array_agg(id order by id),'{}'::uuid[]) from public.operacao_documentos) is distinct from array['00000000-0000-4000-8000-000000000031'::uuid]::uuid[] then raise exception 'Documentos fora da matriz: Leitor restrito vê somente A';end if;
 if (select coalesce(array_agg(id order by id),'{}'::uuid[]) from public.operacao_kit_documentos) is distinct from array['00000000-0000-4000-8000-000000000051'::uuid]::uuid[] then raise exception 'Peças fora da matriz: Leitor restrito vê somente A';end if;
end
$caso$;

-- Leitor não altera documento A
do $caso$
declare n integer; v integer;
begin
 update public.operacao_documentos set tipo='Leitor indevido' where id='00000000-0000-4000-8000-000000000031'::uuid;get diagnostics n=row_count;if n<>0 then raise exception 'Leitor escreveu documento';end if;
end
$caso$;

reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000104',true),
 set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000104","role":"authenticated","email":"qa-rls-104@example.invalid"}'::jsonb::text,true);
set local role authenticated;
-- Outra organização não vê A ou B
do $caso$
declare n integer; v integer;
begin
 if current_user<>'authenticated' or auth.uid() is distinct from '00000000-0000-4000-8000-000000000104'::uuid then raise exception 'Contexto de identidade SQL incorreto';end if;
 if (select coalesce(array_agg(id order by id),'{}'::uuid[]) from public.operacao_documentos) is distinct from array[]::uuid[] then raise exception 'Documentos fora da matriz: Outra organização não vê A ou B';end if;
 if (select coalesce(array_agg(id order by id),'{}'::uuid[]) from public.operacao_kit_documentos) is distinct from array[]::uuid[] then raise exception 'Peças fora da matriz: Outra organização não vê A ou B';end if;
end
$caso$;

reset role;
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);

update public.clientes set status='pendente' where id='00000000-0000-4000-8000-000000000102'::uuid;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000102',true),
 set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000102","role":"authenticated","email":"qa-rls-102@example.invalid"}'::jsonb::text,true);
set local role authenticated;

-- Cliente pendente não lê peças do kit
do $caso$
declare n integer; v integer;
begin
 if auth.uid() is distinct from '00000000-0000-4000-8000-000000000102'::uuid then raise exception 'Claims da fixture incorretas';end if;
 if exists(select 1 from public.operacao_kit_documentos) then raise exception 'Pendente leu kit';end if;
end
$caso$;

reset role;
select set_config('request.jwt.claim.sub','',true),
 set_config('request.jwt.claims','{"role":"service_role"}'::jsonb::text,true);
set local role service_role;

-- RPC recusa gravação em nome do cliente pendente
do $caso$
declare n integer; v integer;
begin
 begin
  perform public.gravar_kit_documento('00000000-0000-4000-8000-000000000053'::uuid,'00000000-0000-4000-8000-000000000011'::uuid,'00000000-0000-4000-8000-000000000021'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000102'::uuid,0,'declaracao','salvar','{"declaracao":{"titulo":"Declaração fictícia SQL QA","texto":"Fixture de acesso; não protocolar.","fonte":"Fixture"}}'::jsonb);
  raise exception 'Negativa não bloqueada: cliente pendente';
 exception when sqlstate 'PT403' then null;
 end;
end
$caso$;

reset role;
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);

update public.clientes set status='aprovado' where id='00000000-0000-4000-8000-000000000102'::uuid;
reset role;
select set_config('request.jwt.claim.sub','',true),
 set_config('request.jwt.claims','{"role":"anon"}'::jsonb::text,true);
set local role anon;

-- Anônimo não lê kit nem executa as RPCs privadas
do $caso$
declare n integer; v integer;
begin
 if current_user<>'anon' or auth.uid() is not null then raise exception 'Contexto anônimo incorreto';end if;
 begin
  perform count(*) from public.operacao_kit_documentos;
  raise exception 'Negativa não bloqueada: anon SELECT';
 exception when sqlstate '42501' then null;
 end;
 begin
  perform public.gravar_kit_documento('00000000-0000-4000-8000-000000000053'::uuid,'00000000-0000-4000-8000-000000000011'::uuid,'00000000-0000-4000-8000-000000000021'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000102'::uuid,0,'declaracao','salvar','{"declaracao":{"titulo":"Declaração fictícia SQL QA","texto":"Fixture de acesso; não protocolar.","fonte":"Fixture"}}'::jsonb);
  raise exception 'Negativa não bloqueada: anon RPC kit';
 exception when sqlstate '42501' then null;
 end;
 begin
  perform public.confirmar_identificacao_empresa('00000000-0000-4000-8000-000000000011'::uuid,'00000000-0000-4000-8000-000000000102'::uuid,'Alfa Fictícia SQL QA','11222333000181','{"endereco":"Rua fictícia","representante":"Pessoa fictícia","cargo":"Diretoria"}'::jsonb,'[]'::jsonb);
  raise exception 'Negativa não bloqueada: anon RPC identificação';
 exception when sqlstate '42501' then null;
 end;
end
$caso$;

reset role;
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);

-- Negativas não criaram ou alteraram peças/documentos alheios
do $caso$
declare n integer; v integer;
begin
 if (select count(*) from public.operacao_kit_documentos)<>2 or exists(select 1 from public.operacao_kit_documentos where versao<>1) then raise exception 'Negativas alteraram peças';end if;
 if (select count(*) from public.operacao_documentos)<>2 or not exists(select 1 from public.operacao_documentos where id='00000000-0000-4000-8000-000000000032'::uuid and tipo='Fixture documental Beta') then raise exception 'Negativas alteraram documentos';end if;
 if exists(select 1 from storage.objects) or (select count(*) from auth.users)<>4 then raise exception 'Fixture transacional fora do escopo';end if;
end
$caso$;

-- ROLLBACK remove todas as identidades e linhas da fixture, sem DELETE de limpeza.
rollback;
-- Somente consultas depois do rollback; DO usa set_config local à transação implícita.
do $catalogo_e_vazio$
declare observado jsonb; tabela text; possui_linhas boolean;
begin
 perform set_config('search_path','pg_catalog,public',true);
 if current_user<>'postgres' or current_database()<>'postgres' or current_setting('server_version_num')<>'170011' then raise exception 'Executor/banco/versão fora do staging revisado';end if;
 with
relacoes as (
 select c.*,n.nspname as esquema from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('r','p','v','m','f','S') and ((n.nspname='public' and (c.relname like 'operacao\_%' escape '\' or c.relname in ('clientes','admins')))
    or (n.nspname='auth' and c.relname='users')
    or (n.nspname='storage' and c.relname in ('objects','buckets')))
), funcoes as (
 select p.*,n.nspname as esquema from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where p.prokind in ('f','p') and (
  (n.nspname='public' and (p.proname like '%operacao%' or p.proname like '%identificacao_empresa%' or p.proname in ('gravar_kit_documento','kit_documento_escopo_imutavel','configurar_limite_cnpjs_cliente','consultar_limite_cnpjs_cliente')))
  or (n.nspname='auth' and p.proname='uid')
  or p.oid in (select t.tgfoid from pg_trigger t join relacoes r on r.oid=t.tgrelid where not t.tgisinternal)
 )
), secoes as (
 select 'relacoes' as secao,coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'nome',r.relname,'tipo',r.relkind,'dono',pg_get_userbyid(r.relowner),
  'rls',r.relrowsecurity,'force_rls',r.relforcerowsecurity,'opcoes',r.reloptions,
  'acl',r.relacl::text) order by r.esquema,r.relname),'[]'::jsonb) as itens from relacoes r
 union all
 select 'colunas',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'tabela',r.relname,'ordem',a.attnum,'nome',a.attname,
  'tipo',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
  'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid),
  'acl',a.attacl::text) order by r.esquema,r.relname,a.attnum),'[]'::jsonb)
 from relacoes r join pg_attribute a on a.attrelid=r.oid and a.attnum>0 and not a.attisdropped
 left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
 where r.relkind in ('r','p','v','m','f')
 union all
 select 'constraints',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'tabela',r.relname,'nome',c.conname,'tipo',c.contype,
  'validada',c.convalidated,'deferivel',c.condeferrable,'adiada',c.condeferred,
  'definicao',pg_get_constraintdef(c.oid,true)) order by r.esquema,r.relname,c.conname),'[]'::jsonb)
 from relacoes r join pg_constraint c on c.conrelid=r.oid
 union all
 select 'indices',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'tabela',r.relname,'nome',ci.relname,'unico',i.indisunique,
  'valido',i.indisvalid,'pronto',i.indisready,'primario',i.indisprimary,
  'definicao',pg_get_indexdef(i.indexrelid)) order by r.esquema,r.relname,ci.relname),'[]'::jsonb)
 from relacoes r join pg_index i on i.indrelid=r.oid join pg_class ci on ci.oid=i.indexrelid
 union all
 select 'policies',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',schemaname,'tabela',tablename,'nome',policyname,'permissiva',permissive,
  'papeis',roles,'comando',cmd,'using',qual,'check',with_check)
  order by schemaname,tablename,policyname),'[]'::jsonb)
 from pg_policies where (schemaname='public' and (tablename like 'operacao\_%' escape '\' or tablename in ('clientes','admins')))
  or (schemaname='storage' and tablename in ('objects','buckets')) or (schemaname='auth' and tablename='users')
 union all
 select 'triggers',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'tabela',r.relname,'nome',t.tgname,'habilitado',t.tgenabled,
  'funcao',t.tgfoid::regprocedure::text,'definicao',pg_get_triggerdef(t.oid,true))
  order by r.esquema,r.relname,t.tgname),'[]'::jsonb)
 from relacoes r join pg_trigger t on t.tgrelid=r.oid where not t.tgisinternal
 union all
 select 'funcoes',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',f.esquema,'nome',f.proname,'assinatura',f.oid::regprocedure::text,
  'argumentos',pg_get_function_identity_arguments(f.oid),'retorno',pg_get_function_result(f.oid),
  'dono',pg_get_userbyid(f.proowner),'security_definer',f.prosecdef,'volatilidade',f.provolatile,
  'strict',f.proisstrict,'configuracao',f.proconfig,'acl',f.proacl::text,
  'hash_corpo_md5',md5(replace(f.prosrc,chr(13),'')),
  'definicao',case when f.esquema='public' and (f.proname like '%operacao%' or f.proname like '%identificacao_empresa%' or f.proname in ('gravar_kit_documento','kit_documento_escopo_imutavel','configurar_limite_cnpjs_cliente','consultar_limite_cnpjs_cliente')) then pg_get_functiondef(f.oid) else null end)
  order by f.esquema,f.oid::regprocedure::text),'[]'::jsonb) from funcoes f
 union all
 select 'acl_relacoes',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'objeto',r.relname,'concedente',pg_get_userbyid(a.grantor),
  'papel',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
  'privilegio',a.privilege_type,'grant_option',a.is_grantable)
  order by r.esquema,r.relname,a.grantee,a.privilege_type),'[]'::jsonb)
 from relacoes r cross join lateral aclexplode(coalesce(r.relacl,acldefault(case when r.relkind='S' then 's'::"char" else 'r'::"char" end,r.relowner))) a
 union all
 select 'acl_funcoes',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',f.esquema,'objeto',f.oid::regprocedure::text,'concedente',pg_get_userbyid(a.grantor),
  'papel',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
  'privilegio',a.privilege_type,'grant_option',a.is_grantable)
  order by f.esquema,f.oid::regprocedure::text,a.grantee,a.privilege_type),'[]'::jsonb)
 from funcoes f cross join lateral aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
 union all
 select 'schemas',coalesce(jsonb_agg(jsonb_build_object('nome',nspname,'dono',pg_get_userbyid(nspowner),'acl',nspacl::text) order by nspname),'[]'::jsonb)
 from pg_namespace where nspname in ('public','auth','storage')
 union all
 select 'defaults_acl',coalesce(jsonb_agg(jsonb_build_object('dono',pg_get_userbyid(d.defaclrole),
  'esquema',coalesce(n.nspname,'*'),'tipo',d.defaclobjtype,'acl',d.defaclacl::text)
  order by d.defaclrole,d.defaclnamespace,d.defaclobjtype),'[]'::jsonb)
 from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
 where d.defaclnamespace=0 or n.nspname in ('public','auth','storage')
 union all
 select 'papeis',coalesce(jsonb_agg(jsonb_build_object('nome',rolname,'superuser',rolsuper,
  'inherit',rolinherit,'login',rolcanlogin,'create_role',rolcreaterole,'bypass_rls',rolbypassrls) order by rolname),'[]'::jsonb) from pg_roles
 union all
 select 'membros_papeis',coalesce(jsonb_agg(jsonb_build_object('papel',pg_get_userbyid(m.roleid),
  'membro',pg_get_userbyid(m.member),'concedente',pg_get_userbyid(m.grantor),'admin_option',m.admin_option,
  'inherit_option',to_jsonb(m)->'inherit_option','set_option',to_jsonb(m)->'set_option')
  order by m.roleid,m.member),'[]'::jsonb) from pg_auth_members m
 union all
 select 'dependencias_entrada',coalesce(jsonb_agg(jsonb_build_object(
  'objeto',pg_describe_object(d.classid,d.objid,d.objsubid),
  'referencia',pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid),'tipo',d.deptype)
  order by d.classid,d.objid,d.objsubid,d.refobjid,d.refobjsubid),'[]'::jsonb)
 from pg_depend d where (d.refclassid='pg_class'::regclass and d.refobjid in (select oid from relacoes))
  or (d.refclassid='pg_proc'::regclass and d.refobjid in (select oid from funcoes))
), catalogo as (select jsonb_object_agg(secao,itens order by secao) as corpo from secoes)

 select corpo into observado from catalogo;
 if md5(observado::text)<>'830899ecee2a58d23beec619b4963fed' then raise exception 'Catálogo pós-delta divergente; não contornar a guarda';end if;
 if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p'))<>21 then raise exception 'Tabelas públicas divergentes';end if;
 for tabela in select unnest(array['admins','clientes','operacao_agenda','operacao_anexos_processo','operacao_contratos','operacao_convites_empresa','operacao_documentos','operacao_empenhos','operacao_empresas','operacao_identificacao_empresa','operacao_itens_resultado','operacao_kit_documentos','operacao_limites_cnpj','operacao_membros','operacao_ocorrencias','operacao_organizacoes','operacao_prazos_processo','operacao_processos','operacao_renovacoes_documento','operacao_tipos_documento','dados_robo']::text[]) loop
  execute format('select exists(select 1 from public.%I)',tabela) into possui_linhas;
  if possui_linhas then raise exception 'Fixture SQL exige public vazio';end if;
 end loop;
 if exists(select 1 from auth.users) or exists(select 1 from storage.objects) then raise exception 'Fixture SQL exige Auth e objetos Storage vazios';end if;
 if (select count(*) from storage.buckets)<>1 or not exists(select 1 from storage.buckets where id='operacao-documentos' and public=false) then raise exception 'Bucket privado único obrigatório';end if;
end
$catalogo_e_vazio$;

select jsonb_build_object('resultado','RLS_CNPJ_SQL_ROLLBACK_OK','catalogo_md5','830899ecee2a58d23beec619b4963fed',
 'papel_final',current_user,'usuarios_auth',(select count(*) from auth.users),'objetos_storage',(select count(*) from storage.objects),
 'tabelas_publicas_vazias',21,'casos',15,'observado_em',clock_timestamp(),
 'limite','Claims SQL fictícias; sem JWT, login, API, exportação ou arquivo Storage') as evidencia_rls;
