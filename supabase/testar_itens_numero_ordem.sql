-- Teste (só ambiente de teste, tudo em rollback): numeroItem grande do PNCP e coluna numero_ordem.
-- Requer 01-aplicar.sql, importacao_item_pncp_numero_int32.sql e operacao_itens_numero_ordem.sql.
begin;
do $$
declare
 u uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); p uuid:=gen_random_uuid();
 res jsonb; item uuid; antes timestamptz; ordem text;
 compra text:='04274064000131-1-35/2026';
 url text:='https://pncp.gov.br/api/pncp/v1/orgaos/04274064000131/compras/2026/35/itens/';
 ref jsonb:=jsonb_build_object('url_origem',null,'origem_externa_id',null,'numero','QA-NUM');
begin
 insert into auth.users(id,email) values(u,u||'@qa.invalid');
 insert into public.clientes(id,nome,email,status) values(u,'QA numero',u||'@qa.invalid','aprovado') on conflict(id) do update set status='aprovado';
 insert into public.operacao_organizacoes(id,nome,owner_id) values(o,'QA numero',u);
 insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values(e,o,'QA numero','11222333000181');
 insert into public.operacao_membros(organizacao_id,usuario_id,papel) values(o,u,'gestor');
 insert into public.operacao_processos(id,organizacao_id,empresa_id,objeto,numero) values(p,o,e,'QA fictício','QA-NUM');

 -- Licitanet: numeroItem 8184615 era recusado (limite antigo 1..1000000); 2147483647 é o maior int do PNCP.
 res:=public.gravar_importacao_pncp(u,e,p,o,compra,8184615,url||'8184615',repeat('a',64),
   jsonb_build_object('numero',8184615,'descricao','Item Licitanet fictício','quantidade','2','unidade','UN'),'{}',ref);
 if res->>'estado'<>'importado' then raise exception 'numeroItem 8184615 não importado: %',res;end if;
 res:=public.gravar_importacao_pncp(u,e,p,o,compra,2147483647,url||'2147483647',repeat('b',64),
   jsonb_build_object('numero',2147483647,'descricao','Item no teto do int','quantidade','1','unidade','UN'),'{}',ref);
 if res->>'estado'<>'importado' then raise exception 'numeroItem 2147483647 não importado: %',res;end if;
 begin
  perform public.gravar_importacao_pncp(u,e,p,o,compra,0,url||'0',repeat('c',64),
    jsonb_build_object('numero',0,'descricao','Zero','quantidade','1','unidade','UN'),'{}',ref);
  raise exception 'numeroItem 0 aceito';
 exception when sqlstate 'PT400' then null;end;

 -- numero_ordem: só dígitos viram número (zeros à esquerda somem); texto livre fica null.
 insert into public.operacao_itens_resultado(organizacao_id,processo_id,identificador)
 values(o,p,'1'),(o,p,'010'),(o,p,'Lote 2'),(o,p,'3A'),(o,p,'999999999999999999');
 select string_agg(identificador||'='||coalesce(numero_ordem::text,'null'),',' order by numero_ordem nulls last,identificador) into ordem
   from public.operacao_itens_resultado where processo_id=p;
 if ordem<>'1=1,010=10,8184615=8184615,2147483647=2147483647,999999999999999999=999999999999999999,3A=null,Lote 2=null'
 then raise exception 'numero_ordem inesperado: %',ordem;end if;

 -- Mudar o identificador recalcula numero_ordem; a coluna gerada não mexe em atualizado_em.
 select id,atualizado_em into item,antes from public.operacao_itens_resultado where processo_id=p and identificador='Lote 2';
 update public.operacao_itens_resultado set identificador='42' where id=item;
 if (select numero_ordem from public.operacao_itens_resultado where id=item) is distinct from 42 then raise exception 'numero_ordem não recalculado';end if;
 if (select atualizado_em from public.operacao_itens_resultado where id=item) is distinct from antes then raise exception 'atualizado_em mudou';end if;
 begin
  update public.operacao_itens_resultado set numero_ordem=1 where id=item;
  raise exception 'numero_ordem gravável';
 exception when generated_always then null;end;
 if to_regclass('public.operacao_itens_resultado_ordem_idx') is null then raise exception 'índice de ordem ausente';end if;
end $$;
rollback;
