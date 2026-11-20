-- Premissas e preços por item da proposta (espec. dezembro, seção 3).
-- Idempotente; rodar no SQL Editor depois do 01-aplicar.sql (precisa de
-- importacao_item_pncp.sql aplicado). Só acrescenta colunas: não apaga dados.
-- Regra 1 da espec.: nada aqui toca atualizado_em, oferta (valor_*) nem marca/modelo.
begin;

alter table public.operacao_processos
  add column if not exists margem_minima_percentual numeric(7,3)
    check (margem_minima_percentual is null or margem_minima_percentual between 0 and 99.999);

alter table public.operacao_itens_resultado
  add column if not exists unidade text
    check (unidade is null or length(unidade) between 1 and 100),
  add column if not exists fabricante text
    check (fabricante is null or length(fabricante) <= 500),
  add column if not exists custo_unitario numeric(15,2)
    check (custo_unitario is null or custo_unitario >= 0),
  add column if not exists valor_unitario_minimo numeric(15,2)
    check (valor_unitario_minimo is null or valor_unitario_minimo > 0),
  add column if not exists codigo_catalogo text
    check (codigo_catalogo is null or codigo_catalogo ~ '^\d{1,12}$'),
  add column if not exists preco_referencia numeric(15,4)
    check (preco_referencia is null or preco_referencia > 0),
  add column if not exists preco_referencia_em timestamptz;

-- Copia unidade e CATMAT/CATSER da observação PNCP só para campo vazio do item.
-- Valor fora do formato é ignorado (não derruba a importação).
create or replace function public.preencher_item_observacao_pncp(p_item uuid, p_snapshot jsonb)
returns void language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  u text := nullif(btrim(p_snapshot->'item'->>'unidade'), '');
  c text := btrim(p_snapshot->'raw'->>'catalogoCodigoItem');
begin
  if length(u) > 100 then u := null; end if;
  if c !~ '^\d{1,12}$' then c := null; end if;
  if u is null and c is null then return; end if;
  update public.operacao_itens_resultado
     set unidade = coalesce(unidade, u), codigo_catalogo = coalesce(codigo_catalogo, c)
   where id = p_item
     and ((unidade is null and u is not null) or (codigo_catalogo is null and c is not null));
end $$;

create or replace function public.operacao_observacao_pncp_preencher_item()
returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  perform public.preencher_item_observacao_pncp(new.item_id, new.snapshot);
  return null;
end $$;

revoke all on function public.preencher_item_observacao_pncp(uuid, jsonb),
  public.operacao_observacao_pncp_preencher_item() from public, anon, authenticated;

drop trigger if exists operacao_observacao_pncp_preencher_item on public.operacao_observacoes_pncp;
create trigger operacao_observacao_pncp_preencher_item after insert on public.operacao_observacoes_pncp
  for each row execute function public.operacao_observacao_pncp_preencher_item();

-- Itens já importados: a observação mais recente com valor válido vence.
do $$ declare o record; begin
  for o in select item_id, snapshot from public.operacao_observacoes_pncp order by observado_em desc loop
    perform public.preencher_item_observacao_pncp(o.item_id, o.snapshot);
  end loop;
end $$;

commit;
notify pgrst, 'reload schema';
