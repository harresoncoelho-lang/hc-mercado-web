-- NÃO EXECUTADO. QA luguscapasskcsficckf somente; conferir URL do SQL Editor.
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

-- Fonte reaproveitada: supabase/kit_documentos_escala_proposta.sql
execute $fonte0$
-- PREPARADO LOCALMENTE. NÃO APLICADO. Requer kit_documentos.sql existente.
-- Substitui apenas RPC, mantém grants existentes e todo isolamento/CAS.
-- Candidato técnico de 1000 itens: não certificação comercial.
create or replace function public.gravar_kit_documento(
 p_documento uuid,p_empresa uuid,p_processo uuid,p_organizacao uuid,p_usuario uuid,
 p_versao integer,p_tipo text,p_acao text,p_dados jsonb,p_hash text default null,p_previa jsonb default null
) returns public.operacao_kit_documentos language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare d public.operacao_kit_documentos;v jsonb;x record;item_id text;limite integer;
begin
 if p_documento is null or p_usuario is null or p_versao is null or p_versao<0 or p_versao>2147483646
  or p_tipo is null or p_tipo not in ('declaracao','proposta') or p_acao is null or p_acao not in ('salvar','confirmarRevisao')
 then raise sqlstate 'PT400' using message='Solicitação inválida';end if;
 if not exists(select 1 from public.clientes c join public.operacao_membros m on m.usuario_id=c.id
  join public.operacao_empresas e on e.organizacao_id=m.organizacao_id
  where c.id=p_usuario and c.status='aprovado' and m.papel in ('gestor','operador')
   and e.ativo and e.id=p_empresa and e.organizacao_id=p_organizacao and (m.empresa_id is null or m.empresa_id=e.id))
 then raise sqlstate 'PT403' using message='Acesso não autorizado';end if;
 if not exists(select 1 from public.operacao_processos p where p.id=p_processo and p.empresa_id=p_empresa and p.organizacao_id=p_organizacao)
 then raise sqlstate 'PT404' using message='Processo indisponível';end if;

 if p_dados is null or jsonb_typeof(p_dados)<>'object' or p_dados-array[p_tipo]<>'{}'::jsonb or jsonb_typeof(p_dados->p_tipo) is distinct from 'object' or (p_tipo='declaracao' and length(p_dados::text)>50000)
 then raise sqlstate 'PT400' using message='Dados inválidos';end if;
 v:=p_dados->p_tipo;
 if (p_tipo='declaracao' and v-array['titulo','texto','fonte']<>'{}'::jsonb)
  or (p_tipo='proposta' and v-array['itemIds','unidades','validade','prazoEntrega','pagamento']<>'{}'::jsonb)
 then raise sqlstate 'PT400' using message='Campo não permitido';end if;
 for x in select key,value from jsonb_each(v) where key not in ('itemIds','unidades') loop
  limite:=case x.key when 'titulo' then 180 when 'texto' then 20000 when 'fonte' then 1000 else 500 end;
  if jsonb_typeof(x.value)<>'string' or length(x.value#>>'{}')>limite or regexp_replace(x.value#>>'{}',E'[\t\n\r]','','g') ~ '[[:cntrl:]]'
  then raise sqlstate 'PT400' using message='Texto inválido';end if;
 end loop;
 if p_tipo='proposta' then
  if (v?'itemIds' and jsonb_typeof(v->'itemIds')<>'array') or (v?'unidades' and jsonb_typeof(v->'unidades')<>'object')
  then raise sqlstate 'PT400' using message='Itens e unidades inválidos';end if;
  if jsonb_array_length(coalesce(v->'itemIds','[]'))>1000
  or (select count(*)<>count(distinct lower(value#>>'{}')) from jsonb_array_elements(coalesce(v->'itemIds','[]')))
  then raise sqlstate 'PT400' using message='Itens duplicados ou excessivos';end if;
  for x in select value from jsonb_array_elements(coalesce(v->'itemIds','[]')) loop
   item_id:=x.value#>>'{}';
   if jsonb_typeof(x.value)<>'string' or item_id !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   then raise sqlstate 'PT400' using message='Item inválido';end if;
   if not exists(select 1 from public.operacao_itens_resultado i where i.id=item_id::uuid and i.processo_id=p_processo and i.organizacao_id=p_organizacao)
   then raise sqlstate 'PT404' using message='Item indisponível';end if;
  end loop;
  for x in select key,value from jsonb_each(coalesce(v->'unidades','{}')) loop
   if not (coalesce(v->'itemIds','[]') ? x.key) or jsonb_typeof(x.value)<>'string' or length(x.value#>>'{}')>40 or regexp_replace(x.value#>>'{}',E'[\t\n\r]','','g') ~ '[[:cntrl:]]'
   then raise sqlstate 'PT400' using message='Unidade inválida';end if;
  end loop;
 end if;

 -- Mesmo orçamento semântico de _kit_proposta_limites.js, valores UTF-8.
 if p_tipo='proposta' and (
  128 + jsonb_array_length(coalesce(v->'itemIds','[]')) * 128
  + octet_length(convert_to(coalesce(v->>'validade',''),'UTF8'))
  + octet_length(convert_to(coalesce(v->>'prazoEntrega',''),'UTF8'))
  + octet_length(convert_to(coalesce(v->>'pagamento',''),'UTF8'))
  + coalesce((select sum(octet_length(convert_to(i,'UTF8')) + octet_length(convert_to(coalesce(v->'unidades'->>i,''),'UTF8'))) from jsonb_array_elements_text(coalesce(v->'itemIds','[]')) as selecionado(i)),0)
 ) > 524288 then raise sqlstate 'PT400' using message='Rascunho excede o tamanho suportado'; end if;
 if p_acao='salvar' and p_versao=0 then
  insert into public.operacao_kit_documentos(id,organizacao_id,empresa_id,processo_id,tipo,dados,criado_por,atualizado_por)
   values(p_documento,p_organizacao,p_empresa,p_processo,p_tipo,p_dados,p_usuario,p_usuario)
   on conflict(id) do nothing returning * into d;
  if d.id is not null then return d;end if;
 end if;
 select * into d from public.operacao_kit_documentos where id=p_documento for update;
 if d.id is null then raise sqlstate 'PT404' using message='Documento indisponível';end if;
 if d.organizacao_id<>p_organizacao or d.empresa_id<>p_empresa or d.processo_id<>p_processo or d.tipo<>p_tipo
 then raise sqlstate 'PT409' using message='Escopo ou tipo divergente';end if;
 -- A mesma intenção só é recuperável antes da primeira edição e pelo seu autor.
 if p_acao='salvar' and p_versao=0 and d.versao=1 and d.criado_por=p_usuario and d.dados=p_dados then return d;end if;
 if d.versao<>p_versao then raise sqlstate 'PT409' using message='Versão alterada';end if;
 if p_acao='salvar' then
  update public.operacao_kit_documentos set dados=p_dados,versao=versao+1,atualizado_por=p_usuario,atualizado_em=clock_timestamp(),
   revisao_hash=null,revisao_previa=null,revisao_versao=null,revisado_por=null,revisado_em=null
   where id=p_documento and versao=p_versao returning * into d;
 else
  if d.dados<>p_dados then raise sqlstate 'PT409' using message='Dados alterados';end if;
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_previa is null or jsonb_typeof(p_previa)<>'object'
   or p_previa-array['texto','fontes']<>'{}'::jsonb or jsonb_typeof(p_previa->'texto') is distinct from 'string'
   or length(p_previa->>'texto') not between 1 and 1000000 or jsonb_typeof(p_previa->'fontes') is distinct from 'array'
  then raise sqlstate 'PT400' using message='Revisão inválida';end if;
  if p_tipo='proposta' and octet_length(convert_to(p_previa->>'texto','UTF8'))>2000000 then raise sqlstate 'PT400' using message='Prévia excede o tamanho suportado'; end if;
  if jsonb_array_length(p_previa->'fontes')>10 or exists(select 1 from jsonb_array_elements(p_previa->'fontes') f where jsonb_typeof(f)<>'string' or length(f#>>'{}')>2000)
  then raise sqlstate 'PT400' using message='Fontes da revisão inválidas';end if;
  update public.operacao_kit_documentos set revisao_hash=p_hash,revisao_previa=p_previa,revisao_versao=versao,revisado_por=p_usuario,revisado_em=clock_timestamp()
   where id=p_documento and versao=p_versao returning * into d;
 end if;
 if d.id is null then raise sqlstate 'PT409' using message='Versão alterada';end if;
 return d;
end $$;

$fonte0$;


-- Fonte reaproveitada: supabase/testar_kit_escala_bytes.sql
execute $fonte1$
-- NÃO EXECUTADO. Ensaio independente da fórmula de bytes; não valida RLS/CAS da RPC.
-- Executar somente em homologação isolada. Todas as operações são revertidas.
do $$
declare p jsonb; n integer; bytes bigint;
begin
 foreach n in array array[51,200,1000] loop
  select jsonb_build_object('itemIds',jsonb_agg(id),'unidades',jsonb_object_agg(id,'un'),'validade','30 dias','prazoEntrega','10 dias','pagamento','30 dias') into p
  from (select '33333333-3333-3333-3333-'||lpad(i::text,12,'0') id from generate_series(1,n) i) f;
  select 128+n*128+octet_length(convert_to(p->>'validade','UTF8'))+octet_length(convert_to(p->>'prazoEntrega','UTF8'))+octet_length(convert_to(p->>'pagamento','UTF8'))
   +sum(octet_length(convert_to(id,'UTF8'))+octet_length(convert_to(p->'unidades'->>id,'UTF8'))) into bytes from jsonb_array_elements_text(p->'itemIds') s(id);
  if bytes<>128+n*166+21 then raise exception 'Fórmula divergente: %',bytes; end if;
 end loop;
 if octet_length(convert_to('çá','UTF8'))<>4 then raise exception 'UTF8 inesperado'; end if;
end $$;
-- PENDENTE: ensaio da RPC instalada com fixture tenant/usuário/empresa/processo/itens,
-- aprovação, vínculo, CNPJ cruzado, CAS, revisão antiga e budgets. Não substituir por teste estático.

$fonte1$;


-- Fonte reaproveitada: supabase/testar_kit_escala_rpc.sql
execute $fonte2$
-- PREPARADO / NÃO EXECUTADO. SOMENTE clone isolado com migrações kit + escala já instaladas.
-- Nunca produção. Executar como administrador do banco de TESTE para criar fixtures rollback.
-- Não é teste de autenticação HTTP/RLS do usuário: exercita guardas da RPC SECURITY DEFINER.
do $$
declare
 ua uuid:=gen_random_uuid(); ub uuid:=gen_random_uuid(); oa uuid:=gen_random_uuid(); ob uuid:=gen_random_uuid();
 ea uuid:=gen_random_uuid(); eb uuid:=gen_random_uuid(); pa uuid:=gen_random_uuid(); pb uuid:=gen_random_uuid();
 documento uuid; estranho uuid:=gen_random_uuid(); ids jsonb; dados jsonb; n integer; d public.operacao_kit_documentos;
begin
 insert into auth.users(id,aud,role,email,raw_user_meta_data,created_at,updated_at)
 values(ua,'authenticated','authenticated',ua||'@qa.invalid','{}',now(),now()),(ub,'authenticated','authenticated',ub||'@qa.invalid','{}',now(),now());
 insert into public.clientes(id,nome,email,status) values(ua,'QA escala A',ua||'@qa.invalid','aprovado'),(ub,'QA escala B',ub||'@qa.invalid','aprovado')
 on conflict(id) do update set status='aprovado';
 insert into public.operacao_organizacoes(id,nome,owner_id) values(oa,'QA A',ua),(ob,'QA B',ub);
 insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values(ea,oa,'QA empresa A','11222333000181'),(eb,ob,'QA empresa B','22333444000181');
 insert into public.operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values(oa,ua,'operador',ea),(ob,ub,'operador',eb);
 insert into public.operacao_processos(id,organizacao_id,empresa_id,objeto,numero) values(pa,oa,ea,'QA fictício','QA-A'),(pb,ob,eb,'QA fictício','QA-B');
 insert into public.operacao_itens_resultado(organizacao_id,processo_id,identificador,descricao,quantidade,valor_unitario_proposta)
 select oa,pa,i::text,'Material fictício',2,1.25 from generate_series(1,1001)i;
 insert into public.operacao_itens_resultado(id,organizacao_id,processo_id,identificador) values(estranho,ob,pb,'QA estrangeiro');
 foreach n in array array[51,1000] loop
  select jsonb_agg(id::text order by id) into ids from(select id from public.operacao_itens_resultado where processo_id=pa order by id limit n)s;
  dados:=jsonb_build_object('proposta',jsonb_build_object('itemIds',ids,'unidades',(select jsonb_object_agg(i,'un') from jsonb_array_elements_text(ids)s(i)),'validade','30 dias','prazoEntrega','10 dias','pagamento','30 dias'));
  documento:=gen_random_uuid();
  d:=public.gravar_kit_documento(documento,ea,pa,oa,ua,0,'proposta','salvar',dados);
  if d.versao<>1 or jsonb_array_length(d.dados->'proposta'->'itemIds')<>n then raise exception 'salvar perdeu itens';end if;
  d:=public.gravar_kit_documento(documento,ea,pa,oa,ua,1,'proposta','confirmarRevisao',dados,repeat('a',64),jsonb_build_object('texto','Prévia fictícia','fontes','[]'::jsonb));
  if d.revisao_versao<>1 then raise exception 'Revisão não gravada';end if;
  d:=public.gravar_kit_documento(documento,ea,pa,oa,ua,1,'proposta','salvar',dados);
  if d.versao<>2 or d.revisao_hash is not null then raise exception 'Edição não invalidou revisão';end if;
  begin
   perform public.gravar_kit_documento(documento,ea,pa,oa,ua,1,'proposta','salvar',dados);
   raise exception 'CAS aceitou versão antiga';
  exception when sqlstate 'PT409' then null;end;
  begin
   perform public.gravar_kit_documento(documento,ea,pa,oa,ub,2,'proposta','salvar',dados);
   raise exception 'Usuário de outro CNPJ autorizado';
  exception when sqlstate 'PT403' then null;end;
  begin
   perform public.gravar_kit_documento(documento,eb,pb,ob,ua,2,'proposta','salvar',dados);
   raise exception 'Empresa de outro tenant autorizada';
  exception when sqlstate 'PT403' then null;end;
 end loop;
 dados:=jsonb_set(dados,'{proposta,itemIds}',jsonb_build_array(estranho::text));dados:=jsonb_set(dados,'{proposta,unidades}',jsonb_build_object(estranho::text,'un'));
 begin
  perform public.gravar_kit_documento(gen_random_uuid(),ea,pa,oa,ua,0,'proposta','salvar',dados);
  raise exception 'Item de outro processo autorizado';
 exception when sqlstate 'PT404' then null;end;
 select jsonb_agg(id::text) into ids from public.operacao_itens_resultado where processo_id=pa;
 dados:=jsonb_set(dados,'{proposta,itemIds}',ids);
 dados:=jsonb_set(dados,'{proposta,unidades}',(select jsonb_object_agg(i,'un') from jsonb_array_elements_text(ids)s(i)));
 if jsonb_array_length(ids)<>1001 or (select count(distinct i) from jsonb_array_elements_text(ids)s(i))<>1001
 then raise exception 'Fixture 1001 não é única e completa';end if;
 begin
  perform public.gravar_kit_documento(gen_random_uuid(),ea,pa,oa,ua,0,'proposta','salvar',dados);
  raise exception 'Limite1001 aceito';
 exception when sqlstate 'PT400' then
  if sqlerrm<>'Itens duplicados ou excessivos' then raise;end if;
 end;
end $$;


$fonte2$;

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
