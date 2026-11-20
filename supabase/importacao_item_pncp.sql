-- PREPARADO LOCALMENTE / NÃO APLICADO. Após schema operação e kit.
begin;
create unique index if not exists operacao_itens_id_org_proc_idx on public.operacao_itens_resultado(id,organizacao_id,processo_id);
create table if not exists public.operacao_origens_pncp(
 item_id uuid primary key,organizacao_id uuid not null,processo_id uuid not null,empresa_id uuid not null,
 compra text not null,numero_item integer not null check(numero_item>0),url text not null,
 hash_aplicado text not null,hash_atual text not null,estado text not null check(estado in('importado','fonte_alterada')),
 observado_em timestamptz not null default now(),
 unique(processo_id,compra,numero_item),
 foreign key(item_id,organizacao_id,processo_id) references public.operacao_itens_resultado(id,organizacao_id,processo_id),
 foreign key(processo_id,empresa_id,organizacao_id) references public.operacao_processos(id,empresa_id,organizacao_id)
);
create table if not exists public.operacao_observacoes_pncp(
 item_id uuid not null references public.operacao_origens_pncp(item_id),hash text not null check(hash~'^[a-f0-9]{64}$'),
 snapshot jsonb not null check(octet_length(snapshot::text)<=400000),observado_em timestamptz not null default now(),
 primary key(item_id,hash)
);
create table if not exists public.operacao_cadencia_pncp(origem text primary key,proxima timestamptz not null);
alter table public.operacao_origens_pncp enable row level security;
alter table public.operacao_observacoes_pncp enable row level security;
alter table public.operacao_cadencia_pncp enable row level security;
revoke all on public.operacao_origens_pncp,public.operacao_observacoes_pncp,public.operacao_cadencia_pncp from public,anon,authenticated;
grant select on public.operacao_origens_pncp to authenticated;
create policy origem_pncp_leitura on public.operacao_origens_pncp for select to authenticated using(
 exists(select 1 from public.operacao_membros m join public.operacao_empresas e on e.organizacao_id=m.organizacao_id
 join public.clientes c on c.id=m.usuario_id where c.id=auth.uid() and c.status='aprovado' and e.ativo
 and e.id=operacao_origens_pncp.empresa_id and e.organizacao_id=operacao_origens_pncp.organizacao_id and (m.empresa_id is null or m.empresa_id=e.id))
);
create or replace function public.reservar_importacao_pncp(p_usuario uuid,p_empresa uuid,p_processo uuid,p_organizacao uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if not exists(select 1 from public.clientes c join public.operacao_membros m on m.usuario_id=c.id
 join public.operacao_empresas e on e.organizacao_id=m.organizacao_id
 join public.operacao_processos p on p.empresa_id=e.id and p.organizacao_id=e.organizacao_id
 where c.id=p_usuario and c.status='aprovado' and m.papel in('gestor','operador') and (m.empresa_id is null or m.empresa_id=e.id)
 and e.id=p_empresa and e.ativo and e.organizacao_id=p_organizacao and p.id=p_processo) then raise sqlstate 'PT403' using message='Acesso não autorizado';end if;
 perform pg_advisory_xact_lock(hashtext('importacao-item-pncp-origem'));
 if exists(select 1 from public.operacao_cadencia_pncp where origem='pncp' and proxima>clock_timestamp()) then return false;end if;
 insert into public.operacao_cadencia_pncp values('pncp',clock_timestamp()+interval '7 seconds') on conflict(origem) do update set proxima=excluded.proxima;
 return true;
end $$;
create or replace function public.gravar_importacao_pncp(p_usuario uuid,p_empresa uuid,p_processo uuid,p_organizacao uuid,
 p_compra text,p_numero integer,p_url text,p_hash text,p_item jsonb,p_snapshot jsonb,p_referencia jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare origem public.operacao_origens_pncp; item uuid; estado_saida text; processo public.operacao_processos;
begin
 select * into processo from public.operacao_processos where id=p_processo and empresa_id=p_empresa and organizacao_id=p_organizacao for update;
 if processo.id is null then raise sqlstate 'PT404' using message='Processo indisponível';end if;
 if not exists(select 1 from public.clientes c join public.operacao_membros m on m.usuario_id=c.id join public.operacao_empresas e on e.organizacao_id=m.organizacao_id
 where c.id=p_usuario and c.status='aprovado' and m.papel in('gestor','operador') and (m.empresa_id is null or m.empresa_id=e.id)
 and e.id=p_empresa and e.ativo and e.organizacao_id=p_organizacao) then raise sqlstate 'PT403' using message='Acesso não autorizado';end if;
 if p_referencia is distinct from jsonb_build_object('url_origem',nullif(processo.url_origem,''),'origem_externa_id',nullif(processo.origem_externa_id,''),'numero',nullif(processo.numero,'')) then raise sqlstate 'PT409' using message='Referência do processo alterada';end if;
 if p_compra is null or p_compra!~'^\d{14}-1-[1-9]\d*/\d{4}$' or p_numero not between 1 and 1000000
 or p_url is distinct from 'https://pncp.gov.br/api/pncp/v1/orgaos/'||split_part(p_compra,'-',1)||'/compras/'||split_part(p_compra,'/',2)||'/'||split_part(split_part(p_compra,'-',3),'/',1)||'/itens/'||p_numero::text
 or p_hash is null or p_hash!~'^[a-f0-9]{64}$' or jsonb_typeof(p_item) is distinct from 'object' or p_item-array['numero','descricao','quantidade','unidade']<>'{}'::jsonb
 or p_item->>'numero' is distinct from p_numero::text or jsonb_typeof(p_item->'descricao') is distinct from 'string' or jsonb_typeof(p_item->'unidade') is distinct from 'string' or jsonb_typeof(p_item->'quantidade') is distinct from 'string' or length(p_item->>'descricao') not between 1 and 10000
 or length(p_item->>'unidade') not between 1 and 100 or (p_item->>'quantidade')!~'^(0|[1-9]\d{0,11})(\.\d{1,3})?$'
 or jsonb_typeof(p_snapshot) is distinct from 'object' or octet_length(p_snapshot::text)>400000
 then raise sqlstate 'PT400' using message='Observação inválida';end if;
 if (p_item->>'quantidade')::numeric<=0 then raise sqlstate 'PT400' using message='Quantidade inválida';end if;
 select * into origem from public.operacao_origens_pncp where processo_id=p_processo and compra=p_compra and numero_item=p_numero for update;
 if origem.item_id is null then
  -- Não ligar automaticamente lançamento manual por identificador textual.
  if exists(select 1 from public.operacao_itens_resultado where processo_id=p_processo and organizacao_id=p_organizacao and tipo='item' and identificador=p_numero::text)
  then return jsonb_build_object('estado','colisao_manual');end if;
  insert into public.operacao_itens_resultado(organizacao_id,processo_id,tipo,identificador,descricao,quantidade,fonte_oficial)
  values(p_organizacao,p_processo,'item',p_numero::text,p_item->>'descricao',(p_item->>'quantidade')::numeric,p_url) returning id into item;
  insert into public.operacao_origens_pncp(item_id,organizacao_id,processo_id,empresa_id,compra,numero_item,url,hash_aplicado,hash_atual,estado)
  values(item,p_organizacao,p_processo,p_empresa,p_compra,p_numero,p_url,p_hash,p_hash,'importado');estado_saida:='importado';
 else
  item:=origem.item_id;estado_saida:=case when origem.hash_aplicado=p_hash then 'inalterado' else 'fonte_alterada' end;
  update public.operacao_origens_pncp set hash_atual=p_hash,estado=case when origem.hash_aplicado=p_hash then 'importado' else 'fonte_alterada' end,observado_em=clock_timestamp() where item_id=item;
  -- Oferta, marca/modelo, quantidade e texto do cadastro permanecem intocados.
 end if;
 insert into public.operacao_observacoes_pncp(item_id,hash,snapshot) values(item,p_hash,p_snapshot) on conflict(item_id,hash) do nothing;
 return jsonb_build_object('itemId',item,'estado',estado_saida,'hash',p_hash,'observadoEm',clock_timestamp());
end $$;
revoke all on function public.reservar_importacao_pncp(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.gravar_importacao_pncp(uuid,uuid,uuid,uuid,text,integer,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.reservar_importacao_pncp(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.gravar_importacao_pncp(uuid,uuid,uuid,uuid,text,integer,text,text,jsonb,jsonb,jsonb) to service_role;
commit;
notify pgrst,'reload schema';
