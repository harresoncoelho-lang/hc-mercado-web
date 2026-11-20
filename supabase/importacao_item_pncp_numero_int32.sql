-- Importação de itens do PNCP: aceita qualquer numeroItem do PNCP (inteiro de 32 bits, 1..2147483647).
-- Motivo: compras da Licitanet (ex. 04274064000131-1-000035/2026) usam números como 8184615, e o limite antigo
-- (1..1000000) respondia HTTP 400 e deixava a tarefa "itens" da esteira pendente para sempre.
-- numero_item (operacao_origens_pncp) e p_numero já são integer: nenhuma coluna muda.
-- Idempotente: só troca o corpo de gravar_importacao_pncp (mesma assinatura e permissões); o resto do corpo é
-- idêntico ao de importacao_item_pncp.sql. Aplicar DEPOIS de importacao_item_pncp.sql (ou do 01-aplicar.sql).
begin;
set local lock_timeout = '5s';
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
 if p_compra is null or p_compra!~'^\d{14}-1-[1-9]\d*/\d{4}$' or p_numero not between 1 and 2147483647
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
revoke all on function public.gravar_importacao_pncp(uuid,uuid,uuid,uuid,text,integer,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.gravar_importacao_pncp(uuid,uuid,uuid,uuid,text,integer,text,text,jsonb,jsonb,jsonb) to service_role;
commit;
notify pgrst,'reload schema';
