begin;
set local statement_timeout='30s';set local lock_timeout='5s';
lock table public.operacao_kit_documentos in share row exclusive mode;
do $reverter$
declare p pg_proc; meta jsonb;
begin
 if current_database()<>'postgres' or current_user<>'postgres' then raise exception 'Conexão inesperada';end if;
 perform pg_advisory_xact_lock(hashtext('qa-kit-escala-aplicacao'));
 select * into p from pg_proc where oid=to_regprocedure('public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb)');
 if p.oid is null or md5(p.prosrc)<>'a1c37914704cdb3dce5fb6dc056e9896' or jsonb_build_object('owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'security',p.prosecdef,'rettype',p.prorettype) is distinct from '{"acl": ["postgres=X/postgres", "service_role=X/postgres"], "owner": "16384", "config": ["search_path=pg_catalog, pg_temp"], "rettype": "18494", "security": true}'::jsonb
 then raise exception 'Candidato/metadata mudou; não reverter';end if;
 if exists(select 1 from public.operacao_kit_documentos where length(dados::text)>50000 or (tipo='proposta' and jsonb_array_length(coalesce(dados->'proposta'->'itemIds','[]'))>50))
 then raise exception 'Peças usam capacidade nova; não reduzir limite. Preservar função e dados';end if;
 meta:=jsonb_build_object('owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'security',p.prosecdef,'rettype',p.prorettype);
 execute E'CREATE OR REPLACE FUNCTION public.gravar_kit_documento(p_documento uuid, p_empresa uuid, p_processo uuid, p_organizacao uuid, p_usuario uuid, p_versao integer, p_tipo text, p_acao text, p_dados jsonb, p_hash text DEFAULT NULL::text, p_previa jsonb DEFAULT NULL::jsonb)
 RETURNS operacao_kit_documentos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''pg_catalog'', ''pg_temp''
AS $function$
declare d public.operacao_kit_documentos;v jsonb;x record;item_id text;limite integer;
begin
 if p_documento is null or p_usuario is null or p_versao is null or p_versao<0 or p_versao>2147483646
  or p_tipo is null or p_tipo not in (''declaracao'',''proposta'') or p_acao is null or p_acao not in (''salvar'',''confirmarRevisao'')
 then raise sqlstate ''PT400'' using message=''Solicitação inválida'';end if;
 if not exists(select 1 from public.clientes c join public.operacao_membros m on m.usuario_id=c.id
  join public.operacao_empresas e on e.organizacao_id=m.organizacao_id
  where c.id=p_usuario and c.status=''aprovado'' and m.papel in (''gestor'',''operador'')
   and e.ativo and e.id=p_empresa and e.organizacao_id=p_organizacao and (m.empresa_id is null or m.empresa_id=e.id))
 then raise sqlstate ''PT403'' using message=''Acesso não autorizado'';end if;
 if not exists(select 1 from public.operacao_processos p where p.id=p_processo and p.empresa_id=p_empresa and p.organizacao_id=p_organizacao)
 then raise sqlstate ''PT404'' using message=''Processo indisponível'';end if;

 if p_dados is null or jsonb_typeof(p_dados)<>''object'' or p_dados-array[p_tipo]<>''{}''::jsonb or jsonb_typeof(p_dados->p_tipo) is distinct from ''object'' or length(p_dados::text)>50000
 then raise sqlstate ''PT400'' using message=''Dados inválidos'';end if;
 v:=p_dados->p_tipo;
 if (p_tipo=''declaracao'' and v-array[''titulo'',''texto'',''fonte'']<>''{}''::jsonb)
  or (p_tipo=''proposta'' and v-array[''itemIds'',''unidades'',''validade'',''prazoEntrega'',''pagamento'']<>''{}''::jsonb)
 then raise sqlstate ''PT400'' using message=''Campo não permitido'';end if;
 for x in select key,value from jsonb_each(v) where key not in (''itemIds'',''unidades'') loop
  limite:=case x.key when ''titulo'' then 180 when ''texto'' then 20000 when ''fonte'' then 1000 else 500 end;
  if jsonb_typeof(x.value)<>''string'' or length(x.value#>>''{}'')>limite or regexp_replace(x.value#>>''{}'',E''[\\t\\n\\r]'','''',''g'') ~ ''[[:cntrl:]]''
  then raise sqlstate ''PT400'' using message=''Texto inválido'';end if;
 end loop;
 if p_tipo=''proposta'' then
  if (v?''itemIds'' and jsonb_typeof(v->''itemIds'')<>''array'') or (v?''unidades'' and jsonb_typeof(v->''unidades'')<>''object'')
  then raise sqlstate ''PT400'' using message=''Itens e unidades inválidos'';end if;
  if jsonb_array_length(coalesce(v->''itemIds'',''[]''))>50
  or (select count(*)<>count(distinct lower(value#>>''{}'')) from jsonb_array_elements(coalesce(v->''itemIds'',''[]'')))
  then raise sqlstate ''PT400'' using message=''Itens duplicados ou excessivos'';end if;
  for x in select value from jsonb_array_elements(coalesce(v->''itemIds'',''[]'')) loop
   item_id:=x.value#>>''{}'';
   if jsonb_typeof(x.value)<>''string'' or item_id !~* ''^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$''
   then raise sqlstate ''PT400'' using message=''Item inválido'';end if;
   if not exists(select 1 from public.operacao_itens_resultado i where i.id=item_id::uuid and i.processo_id=p_processo and i.organizacao_id=p_organizacao)
   then raise sqlstate ''PT404'' using message=''Item indisponível'';end if;
  end loop;
  for x in select key,value from jsonb_each(coalesce(v->''unidades'',''{}'')) loop
   if not (coalesce(v->''itemIds'',''[]'') ? x.key) or jsonb_typeof(x.value)<>''string'' or length(x.value#>>''{}'')>40 or regexp_replace(x.value#>>''{}'',E''[\\t\\n\\r]'','''',''g'') ~ ''[[:cntrl:]]''
   then raise sqlstate ''PT400'' using message=''Unidade inválida'';end if;
  end loop;
 end if;

 if p_acao=''salvar'' and p_versao=0 then
  insert into public.operacao_kit_documentos(id,organizacao_id,empresa_id,processo_id,tipo,dados,criado_por,atualizado_por)
   values(p_documento,p_organizacao,p_empresa,p_processo,p_tipo,p_dados,p_usuario,p_usuario)
   on conflict(id) do nothing returning * into d;
  if d.id is not null then return d;end if;
 end if;
 select * into d from public.operacao_kit_documentos where id=p_documento for update;
 if d.id is null then raise sqlstate ''PT404'' using message=''Documento indisponível'';end if;
 if d.organizacao_id<>p_organizacao or d.empresa_id<>p_empresa or d.processo_id<>p_processo or d.tipo<>p_tipo
 then raise sqlstate ''PT409'' using message=''Escopo ou tipo divergente'';end if;
 -- A mesma intenção só é recuperável antes da primeira edição e pelo seu autor.
 if p_acao=''salvar'' and p_versao=0 and d.versao=1 and d.criado_por=p_usuario and d.dados=p_dados then return d;end if;
 if d.versao<>p_versao then raise sqlstate ''PT409'' using message=''Versão alterada'';end if;
 if p_acao=''salvar'' then
  update public.operacao_kit_documentos set dados=p_dados,versao=versao+1,atualizado_por=p_usuario,atualizado_em=clock_timestamp(),
   revisao_hash=null,revisao_previa=null,revisao_versao=null,revisado_por=null,revisado_em=null
   where id=p_documento and versao=p_versao returning * into d;
 else
  if d.dados<>p_dados then raise sqlstate ''PT409'' using message=''Dados alterados'';end if;
  if p_hash is null or p_hash !~ ''^[a-f0-9]{64}$'' or p_previa is null or jsonb_typeof(p_previa)<>''object''
   or p_previa-array[''texto'',''fontes'']<>''{}''::jsonb or jsonb_typeof(p_previa->''texto'') is distinct from ''string''
   or length(p_previa->>''texto'') not between 1 and 1000000 or jsonb_typeof(p_previa->''fontes'') is distinct from ''array''
  then raise sqlstate ''PT400'' using message=''Revisão inválida'';end if;
  if jsonb_array_length(p_previa->''fontes'')>10 or exists(select 1 from jsonb_array_elements(p_previa->''fontes'') f where jsonb_typeof(f)<>''string'' or length(f#>>''{}'')>2000)
  then raise sqlstate ''PT400'' using message=''Fontes da revisão inválidas'';end if;
  update public.operacao_kit_documentos set revisao_hash=p_hash,revisao_previa=p_previa,revisao_versao=versao,revisado_por=p_usuario,revisado_em=clock_timestamp()
   where id=p_documento and versao=p_versao returning * into d;
 end if;
 if d.id is null then raise sqlstate ''PT409'' using message=''Versão alterada'';end if;
 return d;
end $function$
';
 select * into p from pg_proc where oid=to_regprocedure('public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb)');
 if jsonb_build_object('owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'security',p.prosecdef,'rettype',p.prorettype) is distinct from meta then raise exception 'ACL/metadata de reversão divergente';end if;
 if md5(pg_get_functiondef('public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb)'::regprocedure))<>'64c94369bded0ca5721959406a8d5434' then raise exception 'Reversão não corresponde ao backup';end if;
end $reverter$;
select 'QA_ESCALA_REVERTIDA' as status;
commit;
notify pgrst,'reload schema';