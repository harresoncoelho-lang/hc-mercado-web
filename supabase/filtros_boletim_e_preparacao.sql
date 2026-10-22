-- Migração aditiva: não altera filtros do robô de e-mails, RLS existente ou dados de editais.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter table public.clientes add column if not exists boletim_filtro jsonb
  constraint clientes_boletim_filtro_valido check (
    boletim_filtro is null or (
      jsonb_typeof(boletim_filtro) = 'object'
      and jsonb_typeof(boletim_filtro->'ufs') = 'array'
      and jsonb_typeof(boletim_filtro->'palavrasRaw') = 'string'
      and jsonb_array_length(boletim_filtro->'ufs') <= 27
      and length(btrim(boletim_filtro->>'palavrasRaw')) between 1 and 1000
      and octet_length(boletim_filtro::text) <= 4000
      and boletim_filtro ?& array['ufs', 'palavrasRaw']
    )
  );

-- Só o robô já autorizado lê preferências de todas as contas; o navegador continua
-- lendo/atualizando apenas a própria linha, pelas policies existentes de clientes.
create or replace function public.oportunidades_para_dossies(
  p_versao integer, p_max_tentativas integer, p_desde date, p_hoje date, p_limite integer default 200
)
returns table (numero_controle_pncp text, publicacao date, encerramento date)
language sql stable security invoker set search_path = ''
as $$
  with filtros as materialized (
    select distinct
      array(select jsonb_array_elements_text(c.boletim_filtro->'ufs')) as ufs,
      array(select regexp_replace(normalize(lower(btrim(palavra)), NFKD), U&'[\0300-\036f]', '', 'g')
        from regexp_split_to_table(c.boletim_filtro->>'palavrasRaw', ',') palavra
        where btrim(palavra) <> '') as palavras
    from public.clientes c
    where c.status = 'aprovado' and c.boletim_filtro is not null
  )
  select o.numero_controle_pncp, o.publicacao, o.encerramento
  from filtros f cross join lateral (
    select a.numero_controle_pncp, a.publicacao, a.encerramento
    from public.oportunidades_abertas a
    where a.numero_controle_pncp is not null
      and a.publicacao >= p_desde
      and (a.encerramento is null or a.encerramento >= p_hoje)
      and (cardinality(f.ufs) = 0 or a.uf = any(f.ufs))
      and exists (
        select 1 from unnest(f.palavras) palavra where strpos(
          regexp_replace(normalize(lower(a.objeto), NFKD), U&'[\0300-\036f]', '', 'g'), palavra
        ) > 0
      )
      and not exists (
      select 1 from public.dossies_editais d
      where d.numero_controle_pncp = a.numero_controle_pncp and d.versao = p_versao and d.status = 'pronto'
    )
      and not exists (
      select 1 from public.fila_dossies fila
      where fila.numero_controle_pncp = a.numero_controle_pncp and fila.tentativas >= p_max_tentativas
    )
    order by a.publicacao desc, a.numero_controle_pncp
    limit greatest(0, least(coalesce(p_limite, 200), 200))
  ) o
  group by o.numero_controle_pncp, o.publicacao, o.encerramento
  order by o.publicacao desc, o.numero_controle_pncp
  limit greatest(0, least(coalesce(p_limite, 200), 200));
$$;
revoke all on function public.oportunidades_para_dossies(integer, integer, date, date, integer) from public, anon, authenticated;
grant execute on function public.oportunidades_para_dossies(integer, integer, date, date, integer) to service_role;
commit;
