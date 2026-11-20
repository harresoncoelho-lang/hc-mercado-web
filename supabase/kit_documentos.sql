-- Peças de declaração/proposta por empresa. Idempotente; aplicar no SQL Editor
-- somente após identificacao_empresa.sql e seguranca_operacao.sql. Sem dados reais.
begin;
create unique index if not exists operacao_processos_id_empresa_org_idx
 on public.operacao_processos(id,empresa_id,organizacao_id);
create table if not exists public.operacao_kit_documentos(
 id uuid primary key,organizacao_id uuid not null,empresa_id uuid not null,processo_id uuid not null,
 tipo text not null check(tipo in ('declaracao','proposta')),dados jsonb not null check(jsonb_typeof(dados)='object'),
 versao integer not null default 1 check(versao>0),
 criado_por uuid not null references auth.users(id),criado_em timestamptz not null default now(),
 atualizado_por uuid not null references auth.users(id),atualizado_em timestamptz not null default now(),
 revisao_hash text,revisao_previa jsonb,revisao_versao integer,
 revisado_por uuid references auth.users(id),revisado_em timestamptz,
 foreign key(processo_id,empresa_id,organizacao_id) references public.operacao_processos(id,empresa_id,organizacao_id),
 check((revisao_hash is null and revisao_previa is null and revisao_versao is null and revisado_por is null and revisado_em is null)
  or (revisao_hash is not null and revisao_hash ~ '^[a-f0-9]{64}$' and revisao_previa is not null and jsonb_typeof(revisao_previa)='object' and revisao_versao is not null and revisao_versao=versao and revisado_por is not null and revisado_em is not null))
);
alter table public.operacao_kit_documentos enable row level security;
create index if not exists operacao_kit_documentos_escopo_idx on public.operacao_kit_documentos(organizacao_id,empresa_id,processo_id,atualizado_em desc);
drop policy if exists operacao_kit_documentos_select_empresa on public.operacao_kit_documentos;
create policy operacao_kit_documentos_select_empresa on public.operacao_kit_documentos for select to authenticated
 using(public.pode_acessar_empresa_operacao(organizacao_id,empresa_id)
  and exists(select 1 from public.clientes c where c.id=auth.uid() and c.status='aprovado')
  and exists(select 1 from public.operacao_empresas e where e.id=operacao_kit_documentos.empresa_id and e.organizacao_id=operacao_kit_documentos.organizacao_id and e.ativo));

create or replace function public.kit_documento_escopo_imutavel() returns trigger
 language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
 if row(new.id,new.organizacao_id,new.empresa_id,new.processo_id,new.tipo,new.criado_por,new.criado_em)
  is distinct from row(old.id,old.organizacao_id,old.empresa_id,old.processo_id,old.tipo,old.criado_por,old.criado_em)
 then raise sqlstate 'PT409' using message='Escopo e autoria da peça são imutáveis';end if;
 return new;
end $$;
drop trigger if exists kit_documento_escopo_imutavel on public.operacao_kit_documentos;
create trigger kit_documento_escopo_imutavel before update on public.operacao_kit_documentos
 for each row execute function public.kit_documento_escopo_imutavel();

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

 if p_dados is null or jsonb_typeof(p_dados)<>'object' or p_dados-array[p_tipo]<>'{}'::jsonb or jsonb_typeof(p_dados->p_tipo) is distinct from 'object' or length(p_dados::text)>50000
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
  if jsonb_array_length(coalesce(v->'itemIds','[]'))>50
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
  if jsonb_array_length(p_previa->'fontes')>10 or exists(select 1 from jsonb_array_elements(p_previa->'fontes') f where jsonb_typeof(f)<>'string' or length(f#>>'{}')>2000)
  then raise sqlstate 'PT400' using message='Fontes da revisão inválidas';end if;
  update public.operacao_kit_documentos set revisao_hash=p_hash,revisao_previa=p_previa,revisao_versao=versao,revisado_por=p_usuario,revisado_em=clock_timestamp()
   where id=p_documento and versao=p_versao returning * into d;
 end if;
 if d.id is null then raise sqlstate 'PT409' using message='Versão alterada';end if;
 return d;
end $$;
-- Defaults do ambiente podem conceder acesso a outros papéis: normaliza só os três objetos do kit, preservando seus donos.
do $acl_kit$
declare objeto record;papel record;
begin
 for objeto in
  select 'table public.operacao_kit_documentos' as alvo,c.relowner as dono,
   coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner)) as acl
  from pg_catalog.pg_class c where c.oid='public.operacao_kit_documentos'::pg_catalog.regclass
  union all
  select 'function '||p.oid::pg_catalog.regprocedure::text,p.proowner,
   coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))
  from pg_catalog.pg_proc p where p.oid in (
   'public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb)'::pg_catalog.regprocedure,
   'public.kit_documento_escopo_imutavel()'::pg_catalog.regprocedure
  )
 loop
  for papel in select distinct a.grantee from pg_catalog.aclexplode(objeto.acl) a where a.grantee<>objeto.dono loop
   execute pg_catalog.format('revoke all on %s from %s',objeto.alvo,
    case when papel.grantee=0 then 'public' else pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(papel.grantee)) end);
  end loop;
 end loop;
end
$acl_kit$;
grant select on public.operacao_kit_documentos to authenticated,service_role;
grant execute on function public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb) to service_role;
commit;
notify pgrst,'reload schema';
