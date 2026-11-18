-- Portal do cliente com aceite por item (espec. dezembro, seção 2).
-- Idempotente, transação única; rodar no SQL Editor depois do 01-aplicar.sql e do
-- operacao_itens_proposta.sql. Só cria objetos novos: não altera nem apaga dados existentes.
-- Não reaproveita convites: o token só existe no link; o banco guarda o sha256 (hex).
-- Tudo passa por RPC security definer chamada só pelo servidor (service_role).
begin;

create table if not exists public.operacao_links_cliente (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null,
  empresa_id uuid not null,
  processo_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  rotulo text not null check (length(rotulo) between 2 and 120),
  mostrar_minimo boolean not null default true,
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  revogado_em timestamptz,
  revogado_por uuid references auth.users(id) on delete set null,
  ultimo_acesso_em timestamptz,
  check (expira_em > criado_em and expira_em <= criado_em + interval '60 days'),
  check (revogado_por is null or revogado_em is not null),
  unique (id, organizacao_id, processo_id),
  foreign key (processo_id, empresa_id, organizacao_id)
    references public.operacao_processos(id, empresa_id, organizacao_id) on delete cascade
);
create index if not exists operacao_links_cliente_processo_idx
  on public.operacao_links_cliente (processo_id) where revogado_em is null;

create table if not exists public.operacao_aceites_item (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null,
  organizacao_id uuid not null,
  processo_id uuid not null,
  item_id uuid not null,
  decisao text not null check (decisao in ('aprovado', 'recusado')),
  observacao text check (observacao is null or length(observacao) <= 1000),
  visto jsonb not null check (jsonb_typeof(visto) = 'object'),
  versao text not null check (versao ~ '^[0-9a-f]{32}$'),
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  criado_em timestamptz not null default now(),
  foreign key (link_id, organizacao_id, processo_id)
    references public.operacao_links_cliente(id, organizacao_id, processo_id) on delete cascade,
  foreign key (item_id, organizacao_id, processo_id)
    references public.operacao_itens_resultado(id, organizacao_id, processo_id) on delete cascade
);
create index if not exists operacao_aceites_item_link_idx
  on public.operacao_aceites_item (link_id, item_id, criado_em desc);
create index if not exists operacao_aceites_item_processo_idx
  on public.operacao_aceites_item (processo_id, criado_em desc);

-- Eventos sem link conhecido (token inexistente, limite por IP) ficam com organização nula
-- e, por isso, invisíveis para authenticated.
create table if not exists public.operacao_portal_auditoria (
  id bigint generated always as identity primary key,
  evento text not null check (evento in ('link_criado', 'link_revogado', 'acesso', 'resposta', 'negado', 'limite')),
  link_id uuid references public.operacao_links_cliente(id) on delete set null,
  organizacao_id uuid,
  processo_id uuid,
  usuario_id uuid,
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  detalhe jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);
create index if not exists operacao_portal_auditoria_processo_idx
  on public.operacao_portal_auditoria (processo_id, criado_em desc);

create table if not exists public.operacao_portal_limite (
  chave text not null,
  janela timestamptz not null,
  contagem integer not null default 1,
  primary key (chave, janela)
);
create index if not exists operacao_portal_limite_janela_idx on public.operacao_portal_limite (janela);

-- Histórico só cresce: correção é um novo aceite, nunca edição.
create or replace function public.operacao_aceite_item_imutavel()
returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  raise exception 'Aceite do cliente não pode ser alterado' using errcode = 'P0001';
end $$;
drop trigger if exists operacao_aceite_item_imutavel on public.operacao_aceites_item;
create trigger operacao_aceite_item_imutavel before update on public.operacao_aceites_item
  for each row execute function public.operacao_aceite_item_imutavel();

alter table public.operacao_links_cliente enable row level security;
alter table public.operacao_aceites_item enable row level security;
alter table public.operacao_portal_auditoria enable row level security;
alter table public.operacao_portal_limite enable row level security;
revoke all on public.operacao_links_cliente, public.operacao_aceites_item,
  public.operacao_portal_auditoria, public.operacao_portal_limite from public, anon, authenticated;
-- Leitura do painel: só colunas sem token_hash/ip_hash.
grant select (id, organizacao_id, empresa_id, processo_id, rotulo, mostrar_minimo, criado_por, criado_em,
  expira_em, revogado_em, revogado_por, ultimo_acesso_em) on public.operacao_links_cliente to authenticated;
grant select (id, link_id, organizacao_id, processo_id, item_id, decisao, observacao, visto, versao, criado_em)
  on public.operacao_aceites_item to authenticated;
grant select (id, evento, link_id, organizacao_id, processo_id, usuario_id, detalhe, criado_em)
  on public.operacao_portal_auditoria to authenticated;
drop policy if exists operacao_links_cliente_leitura_processo on public.operacao_links_cliente;
drop policy if exists operacao_aceites_item_leitura_processo on public.operacao_aceites_item;
drop policy if exists operacao_portal_auditoria_leitura_processo on public.operacao_portal_auditoria;
create policy operacao_links_cliente_leitura_processo on public.operacao_links_cliente
  for select to authenticated using (public.pode_acessar_processo_operacao(organizacao_id, processo_id));
create policy operacao_aceites_item_leitura_processo on public.operacao_aceites_item
  for select to authenticated using (public.pode_acessar_processo_operacao(organizacao_id, processo_id));
create policy operacao_portal_auditoria_leitura_processo on public.operacao_portal_auditoria
  for select to authenticated using (public.pode_acessar_processo_operacao(organizacao_id, processo_id));

-- ===== Auxiliares internas (sem execute para nenhum papel da API) =====

-- O que o cliente vê de um item; a versão é o md5 deste jsonb (texto canônico do jsonb).
create or replace function public.portal_visto_item(i public.operacao_itens_resultado, p_minimo boolean)
returns jsonb language sql stable set search_path = pg_catalog, pg_temp as $$
  select jsonb_build_object('identificador', i.identificador, 'descricao', i.descricao,
    'quantidade', i.quantidade, 'unidade', i.unidade, 'valor_unitario_proposta', i.valor_unitario_proposta,
    'marca', i.marca, 'modelo', i.modelo, 'fabricante', i.fabricante)
  || case when p_minimo then jsonb_build_object('valor_unitario_minimo', i.valor_unitario_minimo) else '{}'::jsonb end;
$$;

create or replace function public.portal_contar(p_chave text, p_janela timestamptz)
returns integer language sql set search_path = pg_catalog, pg_temp as $$
  insert into public.operacao_portal_limite as l (chave, janela, contagem) values (p_chave, p_janela, 1)
  on conflict (chave, janela) do update set contagem = l.contagem + 1 returning contagem;
$$;

-- Conta a chamada e diz se algum limite estourou. Auditoria 'limite' só no primeiro estouro
-- de cada janela, para o próprio abuso não encher a tabela.
create or replace function public.portal_estourou(p_ip text, p_chave_token text, p_max_token integer)
returns boolean language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  minuto timestamptz := date_trunc('minute', now());
  n integer;
begin
  n := public.portal_contar('ip:' || p_ip, minuto);
  if n > 60 then
    if n = 61 then insert into public.operacao_portal_auditoria (evento, ip_hash, detalhe)
      values ('limite', p_ip, '{"motivo":"ip_minuto"}'); end if;
    return true;
  end if;
  if coalesce((select contagem from public.operacao_portal_limite
      where chave = 'falha:' || p_ip and janela = date_trunc('hour', now())), 0) >= 20 then
    return true;
  end if;
  n := public.portal_contar(p_chave_token, minuto);
  if n > p_max_token then
    if n = p_max_token + 1 then insert into public.operacao_portal_auditoria (evento, ip_hash, detalhe)
      values ('limite', p_ip, jsonb_build_object('motivo', split_part(p_chave_token, ':', 1) || '_minuto')); end if;
    return true;
  end if;
  return false;
end $$;

-- Link utilizável ou null. Falha conta para o limite por IP e é auditada.
create or replace function public.portal_link_valido(p_token_hash text, p_ip text)
returns public.operacao_links_cliente language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  l public.operacao_links_cliente;
  n integer;
begin
  if p_token_hash ~ '^[0-9a-f]{64}$' then
    select k.* into l from public.operacao_links_cliente k
      join public.operacao_empresas e on e.id = k.empresa_id and e.organizacao_id = k.organizacao_id
      where k.token_hash = p_token_hash and e.ativo;
  end if;
  if l.id is not null and l.revogado_em is null and l.expira_em > now() then return l; end if;
  n := public.portal_contar('falha:' || p_ip, date_trunc('hour', now()));
  if n = 20 then insert into public.operacao_portal_auditoria (evento, ip_hash, detalhe)
    values ('limite', p_ip, '{"motivo":"falhas_hora"}'); end if;
  insert into public.operacao_portal_auditoria (evento, link_id, organizacao_id, processo_id, ip_hash, detalhe)
    values ('negado', l.id, l.organizacao_id, l.processo_id, p_ip, jsonb_build_object('motivo',
      case when l.id is null then 'inexistente' when l.revogado_em is not null then 'revogado' else 'expirado' end));
  return null;
end $$;

-- Mesmo critério de reservar_importacao_pncp; devolve a organização do processo.
create or replace function public.portal_autorizar_gestao(p_usuario uuid, p_empresa uuid, p_processo uuid)
returns uuid language sql stable set search_path = pg_catalog, pg_temp as $$
  select p.organizacao_id from public.clientes c
    join public.operacao_membros m on m.usuario_id = c.id
    join public.operacao_empresas e on e.organizacao_id = m.organizacao_id
    join public.operacao_processos p on p.empresa_id = e.id and p.organizacao_id = e.organizacao_id
   where c.id = p_usuario and c.status = 'aprovado' and m.papel in ('gestor', 'operador')
     and (m.empresa_id is null or m.empresa_id = e.id) and e.id = p_empresa and e.ativo and p.id = p_processo
   limit 1;
$$;

revoke all on function public.operacao_aceite_item_imutavel(),
  public.portal_visto_item(public.operacao_itens_resultado, boolean),
  public.portal_contar(text, timestamptz),
  public.portal_estourou(text, text, integer),
  public.portal_link_valido(text, text),
  public.portal_autorizar_gestao(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- ===== RPCs (só service_role) =====

create or replace function public.criar_link_cliente(p_usuario uuid, p_empresa uuid, p_processo uuid,
  p_token_hash text, p_rotulo text, p_dias integer, p_mostrar_minimo boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  org uuid := public.portal_autorizar_gestao(p_usuario, p_empresa, p_processo);
  l public.operacao_links_cliente;
begin
  if org is null then raise sqlstate 'PT403' using message = 'Acesso não autorizado'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_dias is null or p_dias not between 1 and 60
     or length(btrim(p_rotulo)) is null or length(btrim(p_rotulo)) not between 2 and 120 or p_mostrar_minimo is null then
    raise sqlstate 'PT400' using message = 'Dados do link inválidos';
  end if;
  -- Serializa a contagem de links ativos do processo.
  perform 1 from public.operacao_processos where id = p_processo for update;
  if (select count(*) from public.operacao_links_cliente
       where processo_id = p_processo and revogado_em is null and expira_em > now()) >= 5 then
    raise sqlstate 'PT409' using message = 'Limite de 5 links ativos por processo';
  end if;
  insert into public.operacao_links_cliente (organizacao_id, empresa_id, processo_id, token_hash, rotulo,
    mostrar_minimo, criado_por, expira_em)
  values (org, p_empresa, p_processo, p_token_hash, btrim(p_rotulo), p_mostrar_minimo, p_usuario,
    now() + make_interval(days => p_dias))
  returning * into l;
  insert into public.operacao_portal_auditoria (evento, link_id, organizacao_id, processo_id, usuario_id, detalhe)
    values ('link_criado', l.id, org, p_processo, p_usuario,
      jsonb_build_object('dias', p_dias, 'mostrar_minimo', p_mostrar_minimo));
  return jsonb_build_object('id', l.id, 'expira_em', l.expira_em);
end $$;

create or replace function public.revogar_link_cliente(p_usuario uuid, p_link uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare l public.operacao_links_cliente;
begin
  select * into l from public.operacao_links_cliente where id = p_link for update;
  if l.id is null or public.portal_autorizar_gestao(p_usuario, l.empresa_id, l.processo_id) is null then
    raise sqlstate 'PT403' using message = 'Acesso não autorizado';
  end if;
  if l.revogado_em is null then
    update public.operacao_links_cliente set revogado_em = now(), revogado_por = p_usuario
      where id = l.id returning * into l;
    insert into public.operacao_portal_auditoria (evento, link_id, organizacao_id, processo_id, usuario_id)
      values ('link_revogado', l.id, l.organizacao_id, l.processo_id, p_usuario);
  end if;
  return jsonb_build_object('id', l.id, 'revogado_em', l.revogado_em);
end $$;

-- Público via servidor. Link inválido de qualquer tipo devolve null (mesma resposta).
create or replace function public.portal_ler(p_token_hash text, p_ip_hash text, p_pagina integer default 1)
returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  l public.operacao_links_cliente;
  pagina integer := greatest(coalesce(p_pagina, 1), 1);
  saida jsonb;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then raise sqlstate 'PT400' using message = 'Origem inválida'; end if;
  delete from public.operacao_portal_limite where ctid in (
    select ctid from public.operacao_portal_limite where janela < now() - interval '1 day' limit 200);
  if public.portal_estourou(p_ip_hash, 'ler:' || coalesce(p_token_hash, ''), 30) then
    return '{"limite":true}'::jsonb;
  end if;
  l := public.portal_link_valido(p_token_hash, p_ip_hash);
  if l.id is null then return null; end if;
  update public.operacao_links_cliente set ultimo_acesso_em = now() where id = l.id;
  insert into public.operacao_portal_auditoria (evento, link_id, organizacao_id, processo_id, ip_hash, detalhe)
    values ('acesso', l.id, l.organizacao_id, l.processo_id, p_ip_hash, jsonb_build_object('pagina', pagina));

  select jsonb_build_object(
    'empresa', jsonb_build_object('razao_social', e.razao_social),
    'processo', jsonb_build_object('numero', p.numero, 'objeto', p.objeto, 'orgao', p.orgao,
      'modalidade', p.modalidade, 'data_sessao', p.data_sessao, 'url_origem', p.url_origem),
    'expira_em', l.expira_em,
    'mostrar_minimo', l.mostrar_minimo,
    'pagina', pagina,
    'por_pagina', 200,
    'total_itens', (select count(*) from public.operacao_itens_resultado
      where processo_id = l.processo_id and organizacao_id = l.organizacao_id),
    'itens', coalesce((
      select jsonb_agg(v.visto || jsonb_build_object('id', v.id, 'versao', md5(v.visto::text), 'resposta', (
          select jsonb_build_object('decisao', a.decisao, 'observacao', a.observacao,
            'versao', a.versao, 'criado_em', a.criado_em)
            from public.operacao_aceites_item a where a.link_id = l.id and a.item_id = v.id
           order by a.criado_em desc, a.id desc limit 1)) order by v.ordem)
        from (select i.id, public.portal_visto_item(i, l.mostrar_minimo) visto,
                     row_number() over (order by i.tipo, length(i.identificador), i.identificador, i.id) ordem
                from public.operacao_itens_resultado i
               where i.processo_id = l.processo_id and i.organizacao_id = l.organizacao_id
               order by i.tipo, length(i.identificador), i.identificador, i.id
               offset (pagina - 1) * 200 limit 200) v), '[]'::jsonb),
    'aceites', coalesce((
      select jsonb_agg(jsonb_build_object('item_id', h.item_id, 'identificador', h.visto->>'identificador',
          'decisao', h.decisao, 'observacao', h.observacao, 'criado_em', h.criado_em) order by h.criado_em desc, h.id desc)
        from (select * from public.operacao_aceites_item where link_id = l.id
               order by criado_em desc, id desc limit 50) h), '[]'::jsonb))
  into saida
  from public.operacao_processos p
  join public.operacao_empresas e on e.id = p.empresa_id and e.organizacao_id = p.organizacao_id
  where p.id = l.processo_id and p.organizacao_id = l.organizacao_id;
  return saida;
end $$;

-- p_respostas: [{"item_id":uuid,"decisao":"aprovado|recusado","versao":md5,"observacao":texto?}]
-- Tudo ou nada: versão divergente em qualquer item não grava nenhum.
create or replace function public.portal_responder(p_token_hash text, p_respostas jsonb, p_ip_hash text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  l public.operacao_links_cliente;
  r jsonb;
  i public.operacao_itens_resultado;
  item uuid;
  visto jsonb;
  vistos jsonb := '{}'::jsonb;
  divergentes jsonb := '[]'::jsonb;
  vistos_ids uuid[] := '{}';
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then raise sqlstate 'PT400' using message = 'Origem inválida'; end if;
  if public.portal_estourou(p_ip_hash, 'resp:' || coalesce(p_token_hash, ''), 10) then
    return '{"limite":true}'::jsonb;
  end if;
  l := public.portal_link_valido(p_token_hash, p_ip_hash);
  if l.id is null then return null; end if;
  if jsonb_typeof(p_respostas) is distinct from 'array' or jsonb_array_length(p_respostas) not between 1 and 200 then
    raise sqlstate 'PT400' using message = 'Envie de 1 a 200 respostas';
  end if;
  for r in select * from jsonb_array_elements(p_respostas) loop
    if jsonb_typeof(r) is distinct from 'object' or r - array['item_id', 'decisao', 'versao', 'observacao'] <> '{}'::jsonb
       or jsonb_typeof(r->'item_id') is distinct from 'string' or (r->>'item_id') !~ '^[0-9a-fA-F-]{36}$'
       or (r->>'decisao') is null or (r->>'decisao') not in ('aprovado', 'recusado')
       or jsonb_typeof(r->'versao') is distinct from 'string' or (r->>'versao') !~ '^[0-9a-f]{32}$'
       or (r ? 'observacao' and jsonb_typeof(r->'observacao') not in ('string', 'null'))
       or length(r->>'observacao') > 1000 then
      raise sqlstate 'PT400' using message = 'Resposta inválida';
    end if;
    item := (r->>'item_id')::uuid;
    if item = any(vistos_ids) then raise sqlstate 'PT400' using message = 'Item repetido'; end if;
    vistos_ids := vistos_ids || item;
    select * into i from public.operacao_itens_resultado where id = item for share;
    if i.id is null or i.processo_id is distinct from l.processo_id or i.organizacao_id is distinct from l.organizacao_id then
      raise sqlstate 'PT403' using message = 'Item fora do processo do link';
    end if;
    visto := public.portal_visto_item(i, l.mostrar_minimo);
    if md5(visto::text) <> r->>'versao' then divergentes := divergentes || to_jsonb(item); end if;
    vistos := vistos || jsonb_build_object(item::text, visto);
  end loop;
  if jsonb_array_length(divergentes) > 0 then
    return jsonb_build_object('ok', false, 'divergentes', divergentes);
  end if;
  insert into public.operacao_aceites_item (link_id, organizacao_id, processo_id, item_id, decisao, observacao, visto, versao, ip_hash)
  select l.id, l.organizacao_id, l.processo_id, (e->>'item_id')::uuid, e->>'decisao', nullif(btrim(e->>'observacao'), ''),
         vistos->(lower(e->>'item_id')), e->>'versao', p_ip_hash
    from jsonb_array_elements(p_respostas) e;
  update public.operacao_links_cliente set ultimo_acesso_em = now() where id = l.id;
  insert into public.operacao_portal_auditoria (evento, link_id, organizacao_id, processo_id, ip_hash, detalhe)
    values ('resposta', l.id, l.organizacao_id, l.processo_id, p_ip_hash,
      jsonb_build_object('quantidade', jsonb_array_length(p_respostas)));
  return jsonb_build_object('ok', true, 'gravados', jsonb_array_length(p_respostas));
end $$;

revoke all on function public.criar_link_cliente(uuid, uuid, uuid, text, text, integer, boolean),
  public.revogar_link_cliente(uuid, uuid),
  public.portal_ler(text, text, integer),
  public.portal_responder(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.criar_link_cliente(uuid, uuid, uuid, text, text, integer, boolean),
  public.revogar_link_cliente(uuid, uuid),
  public.portal_ler(text, text, integer),
  public.portal_responder(text, jsonb, text) to service_role;

commit;
notify pgrst, 'reload schema';
