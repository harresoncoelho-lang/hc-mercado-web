-- Migração aditiva local, não aplicada remotamente. Requer ponte_leitura.sql.
begin;
create table public.operacao_correspondencias_leitura(
 recibo_id uuid primary key references public.operacao_observacoes_leitura(id),
 versao integer not null check(versao>0),pares jsonb not null,revisado_por uuid not null references auth.users(id),revisado_em timestamptz not null default now()
);
create table public.operacao_correspondencias_leitura_historico(
 id bigint generated always as identity primary key,recibo_id uuid not null,snapshot jsonb not null,substituido_em timestamptz not null default now()
);
alter table public.operacao_correspondencias_leitura enable row level security;
alter table public.operacao_correspondencias_leitura_historico enable row level security;
revoke all on public.operacao_correspondencias_leitura,public.operacao_correspondencias_leitura_historico from anon,authenticated;
create function public.operacao_correspondencias_leitura(p_acao text,p_documento uuid,p_versao integer,p_hash text,p_vinculo integer,p_cursor uuid default null,p_recibo uuid default null,p_mapa_versao integer default null,p_pares jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.operacao_kit_documentos%rowtype;t public.operacao_tentativas_leitura%rowtype;o public.operacao_observacoes_leitura%rowtype;m public.operacao_correspondencias_leitura%rowtype;
 v jsonb;initial_scope jsonb;pair jsonb;rows_json jsonb;cursor_date timestamptz;next_cursor uuid;item_id uuid;
begin
 if auth.uid() is null or p_acao is null or p_acao not in('consultar','confirmar') then return jsonb_build_object('status',403,'erro','Acesso negado');end if;
 select * into d from public.operacao_kit_documentos where id=p_documento;
 if not found then return jsonb_build_object('status',404,'erro','Peca indisponivel');end if;
 initial_scope=jsonb_build_array(d.empresa_id,d.processo_id,d.organizacao_id);
 v=public.operacao_vinculo_compra(d.empresa_id,d.processo_id,'consultar');
 if v->>'status'<>'200' then return v;end if;
 select * into d from public.operacao_kit_documentos where id=p_documento for update;
 if not found or jsonb_build_array(d.empresa_id,d.processo_id,d.organizacao_id) is distinct from initial_scope
  or d.tipo<>'proposta' or d.revisado_por is distinct from auth.uid() or d.versao is distinct from p_versao or d.revisao_versao is distinct from d.versao or d.revisao_hash is distinct from p_hash
  or v->'vinculo' is null or v->'vinculo'='null'::jsonb or v->'vinculo'->>'invalidado_em' is not null
  or (v->'vinculo'->>'versao')::integer is distinct from p_vinculo or v->'vinculo'->>'cnpj_revisado' is distinct from v->>'cnpj'
 then return jsonb_build_object('status',409,'erro','Revisao ou vinculo alterado');end if;
 if p_acao='consultar' then
  if p_cursor is not null then
   select obs.criado_em into cursor_date from public.operacao_observacoes_leitura obs join public.operacao_tentativas_leitura a on a.id=obs.tentativa_id
    where obs.id=p_cursor and a.documento_id=d.id and a.usuario_id=auth.uid()
     and row(a.empresa_id,a.processo_id,a.organizacao_id)=row(d.empresa_id,d.processo_id,d.organizacao_id)
     and a.versao=d.versao and a.revisao_hash=p_hash and a.vinculo_versao=p_vinculo and a.cnpj=v->>'cnpj' and a.estado='consumida';
   if not found then return jsonb_build_object('status',400,'erro','Cursor indisponivel');end if;
  end if;
  select coalesce(jsonb_agg(r.data order by r.criado_em desc,r.id desc),'[]'::jsonb) into rows_json from (
   select obs.id,obs.criado_em,jsonb_build_object('id',obs.id,'criadoEm',obs.criado_em,'itens',obs.relato->'pagina'->'itens','correspondencia',case when map.recibo_id is null then null else jsonb_build_object('versao',map.versao,'pares',map.pares,'revisadoEm',map.revisado_em) end) as data
   from public.operacao_observacoes_leitura obs join public.operacao_tentativas_leitura a on a.id=obs.tentativa_id left join public.operacao_correspondencias_leitura map on map.recibo_id=obs.id
   where a.documento_id=d.id and a.usuario_id=auth.uid() and row(a.empresa_id,a.processo_id,a.organizacao_id)=row(d.empresa_id,d.processo_id,d.organizacao_id)
    and a.versao=d.versao and a.revisao_hash=p_hash and a.vinculo_versao=p_vinculo and a.cnpj=v->>'cnpj' and a.estado='consumida'
    and (p_cursor is null or row(obs.criado_em,obs.id)<row(cursor_date,p_cursor))
   order by obs.criado_em desc,obs.id desc limit 21
  )r;
  if jsonb_array_length(rows_json)>20 then next_cursor=(rows_json->19->>'id')::uuid;rows_json=rows_json-20;end if;
  return jsonb_build_object('status',200,'recibos',rows_json,'nextCursor',next_cursor,'lote',null,'writeAuthorized',false,'origem','relato_usuario');
 end if;
 if p_recibo is null or p_mapa_versao is null or p_mapa_versao<0 or p_pares is null or jsonb_typeof(p_pares)<>'array' then return jsonb_build_object('status',400,'erro','Correspondencia invalida');end if;
 if jsonb_array_length(p_pares) not between 1 and 10 or octet_length(p_pares::text)>5000 then return jsonb_build_object('status',400,'erro','Correspondencia invalida');end if;
 select a.* into t from public.operacao_tentativas_leitura a join public.operacao_observacoes_leitura obs on obs.tentativa_id=a.id where obs.id=p_recibo for update of a;
 if not found or t.usuario_id<>auth.uid() or t.documento_id<>d.id or row(t.empresa_id,t.processo_id,t.organizacao_id) is distinct from row(d.empresa_id,d.processo_id,d.organizacao_id) then return jsonb_build_object('status',403,'erro','Recibo indisponivel');end if;
 if t.estado<>'consumida' or t.versao<>d.versao or t.revisao_hash<>p_hash or t.vinculo_versao<>p_vinculo or t.cnpj is distinct from v->>'cnpj' then return jsonb_build_object('status',409,'erro','Recibo desatualizado');end if;
 select * into o from public.operacao_observacoes_leitura where id=p_recibo for update;
 select * into m from public.operacao_correspondencias_leitura where recibo_id=p_recibo for update;
 if coalesce(m.versao,0)<>p_mapa_versao then return jsonb_build_object('status',409,'erro','Correspondencia alterada; consulte novamente');end if;
 for pair in select value from jsonb_array_elements(p_pares) loop
  if jsonb_typeof(pair)<>'object' or pair-array['itemId','portalId']<>'{}'::jsonb or jsonb_typeof(pair->'itemId') is distinct from 'string' or coalesce(pair->>'itemId','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   or jsonb_typeof(pair->'portalId') is distinct from 'string' or coalesce(pair->>'portalId','')!~'^[1-9][0-9]{0,17}$'
   or not coalesce(d.dados->'proposta'->'itemIds' ? (pair->>'itemId'),false)
   or not exists(select 1 from jsonb_array_elements(o.relato->'pagina'->'itens') x where x->>'id'=pair->>'portalId')
  then return jsonb_build_object('status',400,'erro','Par nao selecionado ou nao observado');end if;
 end loop;
 if (select count(*)<>count(distinct value->>'itemId') or count(*)<>count(distinct value->>'portalId') from jsonb_array_elements(p_pares)) then return jsonb_build_object('status',400,'erro','Correspondencias duplicadas');end if;
 for item_id in select (value->>'itemId')::uuid from jsonb_array_elements(p_pares) order by (value->>'itemId')::uuid loop
  perform 1 from public.operacao_itens_resultado i where i.id=item_id and i.processo_id=d.processo_id and i.organizacao_id=d.organizacao_id and i.tipo='item' for update;
  if not found then return jsonb_build_object('status',409,'erro','Item selecionado indisponivel');end if;
 end loop;
 if m.recibo_id is not null then insert into public.operacao_correspondencias_leitura_historico(recibo_id,snapshot) values(m.recibo_id,to_jsonb(m));end if;
 insert into public.operacao_correspondencias_leitura(recibo_id,versao,pares,revisado_por) values(p_recibo,p_mapa_versao+1,p_pares,auth.uid())
 on conflict(recibo_id)do update set versao=excluded.versao,pares=excluded.pares,revisado_por=excluded.revisado_por,revisado_em=now();
 return jsonb_build_object('status',200,'recibo',p_recibo,'versaoCorrespondencia',p_mapa_versao+1,'lote',null,'writeAuthorized',false,'origem','relato_usuario');
end $$;
revoke all on function public.operacao_correspondencias_leitura(text,uuid,integer,text,integer,uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.operacao_correspondencias_leitura(text,uuid,integer,text,integer,uuid,uuid,integer,jsonb) to authenticated;
commit;
