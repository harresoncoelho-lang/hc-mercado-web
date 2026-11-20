-- Canal somente leitura, não aplicado. Requer kit_documentos.sql e vinculo_compra_portal.sql.
begin;
create table public.operacao_tentativas_leitura(
 id uuid primary key,usuario_id uuid not null references auth.users(id),documento_id uuid not null references public.operacao_kit_documentos(id),
 empresa_id uuid not null,processo_id uuid not null,organizacao_id uuid not null,
 versao integer not null,revisao_hash text not null,vinculo_versao integer not null,cnpj text not null,
 nonce_hash text not null,expira_em timestamptz not null,estado text not null check(estado in('pendente','consumida','cancelada')),
 payload_hash text,recibo uuid,criado_em timestamptz not null default now()
);
create table public.operacao_observacoes_leitura(
 id uuid primary key,tentativa_id uuid not null unique references public.operacao_tentativas_leitura(id),
 relato jsonb not null,origem text not null default 'relato_usuario',criado_em timestamptz not null default now()
);
alter table public.operacao_tentativas_leitura enable row level security;
alter table public.operacao_observacoes_leitura enable row level security;
revoke all on public.operacao_tentativas_leitura,public.operacao_observacoes_leitura from anon,authenticated;
create function public.operacao_ponte_leitura(p_acao text,p_tentativa uuid,p_documento uuid default null,p_versao integer default null,p_hash text default null,p_vinculo integer default null,p_nonce_hash text default null,p_observacao jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.operacao_kit_documentos%rowtype;t public.operacao_tentativas_leitura%rowtype;v jsonb;item jsonb;r uuid;canonical_hash text;escopo_inicial jsonb;
begin
 if auth.uid() is null or p_acao is null or p_acao not in('iniciar','registrar','cancelar') or p_tentativa is null then return jsonb_build_object('status',403,'erro','Acesso negado');end if;
 if p_acao='cancelar' then
  update public.operacao_tentativas_leitura set estado='cancelada' where id=p_tentativa and usuario_id=auth.uid() and estado='pendente';
  return jsonb_build_object('status',200,'cancelada',true,'writeAuthorized',false);
 end if;
 select * into d from public.operacao_kit_documentos where id=p_documento;
 if not found then return jsonb_build_object('status',404,'erro','Peça indisponível');end if;
 escopo_inicial=jsonb_build_array(d.empresa_id,d.processo_id,d.organizacao_id);
 v=public.operacao_vinculo_compra(d.empresa_id,d.processo_id,'consultar');
 if v->>'status'<>'200' then return v;end if;
 select * into d from public.operacao_kit_documentos where id=p_documento for update;
 if not found or jsonb_build_array(d.empresa_id,d.processo_id,d.organizacao_id) is distinct from escopo_inicial then return jsonb_build_object('status',409,'erro','Escopo alterado durante leitura');end if;
 if d.tipo<>'proposta' or d.revisado_por is distinct from auth.uid() or d.versao is distinct from p_versao or d.revisao_versao is distinct from d.versao or d.revisao_hash is distinct from p_hash
  or (v->'vinculo'->>'versao')::integer is distinct from p_vinculo or v->'vinculo'->>'invalidado_em' is not null or v->'vinculo' is null or v->'vinculo'='null'::jsonb
  or v->'vinculo'->>'cnpj_revisado' is distinct from v->>'cnpj'
 then return jsonb_build_object('status',409,'erro','Revisão ou vínculo alterado');end if;
 if coalesce(p_nonce_hash,'')!~'^[a-f0-9]{64}$' then return jsonb_build_object('status',400,'erro','Desafio inválido');end if;
 if p_acao='iniciar' then
  -- Trava do usuário impede duas tentativas pendentes concorrentes para peças diferentes.
  perform 1 from auth.users where id=auth.uid() for update;
  if exists(select 1 from public.operacao_tentativas_leitura where usuario_id=auth.uid() and estado='pendente' and expira_em>now()) then return jsonb_build_object('status',409,'erro','Cancele a leitura pendente antes de iniciar outra');end if;
  insert into public.operacao_tentativas_leitura(id,usuario_id,documento_id,empresa_id,processo_id,organizacao_id,versao,revisao_hash,vinculo_versao,cnpj,nonce_hash,expira_em,estado)
   values(p_tentativa,auth.uid(),d.id,d.empresa_id,d.processo_id,d.organizacao_id,d.versao,p_hash,p_vinculo,v->>'cnpj',p_nonce_hash,now()+interval '5 minutes','pendente');
  return jsonb_build_object('status',200,'tentativaId',p_tentativa,'expiraEm',now()+interval '5 minutes','writeAuthorized',false);
 end if;
 select * into t from public.operacao_tentativas_leitura where id=p_tentativa and usuario_id=auth.uid() for update;
 if not found or row(t.empresa_id,t.processo_id,t.organizacao_id) is distinct from row(d.empresa_id,d.processo_id,d.organizacao_id) or t.documento_id<>d.id or t.versao<>d.versao or t.revisao_hash<>p_hash or t.vinculo_versao<>p_vinculo or t.cnpj is distinct from v->>'cnpj' or t.nonce_hash<>p_nonce_hash or t.expira_em<=now() or t.estado='cancelada' then return jsonb_build_object('status',409,'erro','Tentativa inválida ou expirada');end if;
 if p_observacao is null or jsonb_typeof(p_observacao)<>'object' or octet_length(p_observacao::text)>30000
  or p_observacao-array['contexto','pagina','writeAuthorized','origem']<>'{}'::jsonb
  or p_observacao->>'origem' is distinct from 'relato_usuario' or p_observacao->'writeAuthorized' is distinct from 'false'::jsonb
  or p_observacao->'contexto' is distinct from jsonb_build_object('cnpj',v->>'cnpj','uasg',v->'vinculo'->>'uasg_revisada','number',((v->'vinculo'->>'numero')::integer)::text,'year',v->'vinculo'->>'ano','purchaseId',v->'vinculo'->>'compra')
  or (p_observacao->'pagina')-array['parcial','itens']<>'{}'::jsonb or p_observacao->'pagina'->'parcial' is distinct from 'true'::jsonb or jsonb_typeof(p_observacao->'pagina'->'itens') is distinct from 'array'
 then return jsonb_build_object('status',400,'erro','Observação inválida');end if;
 if jsonb_array_length(p_observacao->'pagina'->'itens') not between 1 and 10 then return jsonb_build_object('status',400,'erro','Página inválida');end if;
 for item in select value from jsonb_array_elements(p_observacao->'pagina'->'itens') loop
  if jsonb_typeof(item)<>'object' or item-array['id','descricao','quantidadeSolicitada','unidade','grupo','exigencias']<>'{}'::jsonb
   or coalesce(item->>'id','')!~'^[1-9][0-9]{0,17}$' or jsonb_typeof(item->'id')<>'string'
   or jsonb_typeof(item->'descricao') is distinct from 'string' or length(item->>'descricao') not between 1 and 2000
   or jsonb_typeof(item->'quantidadeSolicitada') is distinct from 'string' or length(item->>'quantidadeSolicitada')>64 or (item->>'quantidadeSolicitada')!~'^[0-9]+([.,][0-9]+)?$'
   or jsonb_typeof(item->'unidade') is distinct from 'string' or length(item->>'unidade') not between 1 and 120
   or item->'grupo' is distinct from 'null'::jsonb or item->'exigencias' is distinct from 'null'::jsonb
  then return jsonb_build_object('status',400,'erro','Item inválido');end if;
 end loop;
 if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(p_observacao->'pagina'->'itens')) then return jsonb_build_object('status',400,'erro','IDs repetidos');end if;
 -- Hash canônico calculado no banco; não confiar no hash declarado pelo cliente.
 canonical_hash=encode(sha256(convert_to(p_observacao::text,'UTF8')),'hex');
 if t.estado='consumida' then
  if t.payload_hash=canonical_hash then return jsonb_build_object('status',200,'recibo',t.recibo,'writeAuthorized',false,'origem','relato_usuario');end if;
  return jsonb_build_object('status',409,'erro','Tentativa já consumida');
 end if;
 r=gen_random_uuid();insert into public.operacao_observacoes_leitura(id,tentativa_id,relato) values(r,t.id,p_observacao);
 update public.operacao_tentativas_leitura set estado='consumida',payload_hash=canonical_hash,recibo=r where id=t.id and estado='pendente';
 return jsonb_build_object('status',200,'recibo',r,'writeAuthorized',false,'origem','relato_usuario');
end $$;
revoke all on function public.operacao_ponte_leitura(text,uuid,uuid,integer,text,integer,text,jsonb) from public,anon;
grant execute on function public.operacao_ponte_leitura(text,uuid,uuid,integer,text,integer,text,jsonb) to authenticated;
commit;
