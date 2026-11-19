-- ============================================================================
-- LicitaPlena — pregões gravados pela extensão (modo "Gravar pregão no LicitaPlena").
--
-- Rode no Supabase: SQL Editor -> New query -> Run. Idempotente (pode rodar de novo sem apagar nada).
-- Dado PÚBLICO lido pela aba do próprio usuário na página pública do Compras.gov ("Acompanhar
-- Contratação") ou na ata do ComprasNet antigo: participantes, propostas, marca/modelo, lances e chat do
-- pregoeiro. Por ser público e caro de obter (captcha a cada abertura), fica compartilhado: uma vez
-- gravado, qualquer cliente logado lê sem abrir o portal de novo.
--   Leitura: qualquer usuário autenticado (anon não lê).
--   Escrita: só a RPC gravar_pregao_gravado, executável apenas pelo service_role
--            (netlify/functions/pregao-gravado.js, que valida o pedido e o login antes).
-- Nunca CPF: participante sem CNPJ fica como "pf:<n>" com nome "Pessoa física"; CHECKs recusam CPF
-- formatado em texto. Quem gravou e quando ficam em gravado_por/gravado_em e atualizado_por/atualizado_em.
-- ============================================================================
begin;
set local lock_timeout = '5s';

create table if not exists public.pregoes_gravados (
  id_compra text primary key check (id_compra ~ '^[0-9]{17}$'),
  fonte text not null check (fonte in ('comprasgov', 'comprasnet')),
  url text check (char_length(url) <= 500),
  uasg text check (uasg ~ '^[0-9]{6}$'),
  orgao text check (char_length(orgao) <= 300),
  numero text check (numero ~ '^[0-9]{1,5}$'),
  ano int check (ano between 1990 and 2100),
  modalidade text check (char_length(modalidade) <= 80),
  -- {"<número do item>": {descricao, situacao, quantidade, valor_estimado, unidade, propostas_lidas_em}}
  itens jsonb not null default '{}'::jsonb check (jsonb_typeof(itens) = 'object'),
  gravado_por uuid references auth.users(id) on delete set null,
  gravado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.pregoes_gravados_propostas (
  id_compra text not null references public.pregoes_gravados(id_compra) on delete cascade,
  numero_item int not null check (numero_item between 1 and 99999),
  fornecedor_chave text not null check (fornecedor_chave ~ '^([0-9]{14}|pf:[0-9]{1,4})$'),
  cnpj text check (cnpj ~ '^[0-9]{14}$' and cnpj = fornecedor_chave),
  nome text check (char_length(nome) <= 300),
  uf text check (uf ~ '^[A-Z]{2}$'),
  me_epp boolean,
  situacao text check (char_length(situacao) <= 120),
  valor_ofertado numeric(20, 4),
  valor_negociado numeric(20, 4),
  valor_proposta numeric(20, 4),
  valor_total numeric(22, 4),
  quantidade numeric(20, 4),
  marca text check (char_length(marca) <= 200),
  fabricante text check (char_length(fabricante) <= 200),
  modelo text check (char_length(modelo) <= 200),
  lances jsonb not null default '[]'::jsonb check (jsonb_typeof(lances) = 'array'),
  chat_lido boolean not null default false,
  proposta_lida boolean not null default false,
  gravado_por uuid references auth.users(id) on delete set null,
  gravado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null,
  atualizado_em timestamptz not null default now(),
  primary key (id_compra, numero_item, fornecedor_chave),
  constraint pregoes_gravados_propostas_pf check ((cnpj is null) = (fornecedor_chave like 'pf:%') and (cnpj is not null or nome = 'Pessoa física'))
);
create index if not exists pregoes_gravados_propostas_cnpj_idx on public.pregoes_gravados_propostas (cnpj) where cnpj is not null;

create table if not exists public.pregoes_gravados_mensagens (
  -- md5(compra|item|fornecedor|data_hora|texto): gravar a mesma página duas vezes não duplica.
  chave text primary key check (chave ~ '^[0-9a-f]{32}$'),
  id_compra text not null references public.pregoes_gravados(id_compra) on delete cascade,
  numero_item int not null check (numero_item between 0 and 99999), -- 0 = mensagem da compra, sem item
  fornecedor_chave text check (fornecedor_chave ~ '^([0-9]{14}|pf:[0-9]{1,4})$'),
  data_hora timestamp, -- horário de Brasília como o portal mostra
  autor text check (char_length(autor) <= 40),
  texto text not null check (char_length(texto) between 1 and 4000 and texto !~ '[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}'),
  tipo text not null check (tipo in ('recusa', 'desclassificacao', 'inabilitacao', 'convocacao', 'habilitacao', 'adjudicacao', 'aceite', 'outro')),
  motivo text check (char_length(motivo) <= 2000 and motivo !~ '[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}'),
  gravado_por uuid references auth.users(id) on delete set null,
  gravado_em timestamptz not null default now()
);
create index if not exists pregoes_gravados_mensagens_compra_idx on public.pregoes_gravados_mensagens (id_compra, numero_item, data_hora);

alter table public.pregoes_gravados enable row level security;
alter table public.pregoes_gravados_propostas enable row level security;
alter table public.pregoes_gravados_mensagens enable row level security;
revoke all on public.pregoes_gravados, public.pregoes_gravados_propostas, public.pregoes_gravados_mensagens from anon;
revoke insert, update, delete, truncate on public.pregoes_gravados, public.pregoes_gravados_propostas, public.pregoes_gravados_mensagens from authenticated;
grant select on public.pregoes_gravados, public.pregoes_gravados_propostas, public.pregoes_gravados_mensagens to authenticated;
drop policy if exists pregoes_gravados_select_autenticado on public.pregoes_gravados;
create policy pregoes_gravados_select_autenticado on public.pregoes_gravados for select to authenticated using (true);
drop policy if exists pregoes_gravados_propostas_select_autenticado on public.pregoes_gravados_propostas;
create policy pregoes_gravados_propostas_select_autenticado on public.pregoes_gravados_propostas for select to authenticated using (true);
drop policy if exists pregoes_gravados_mensagens_select_autenticado on public.pregoes_gravados_mensagens;
create policy pregoes_gravados_mensagens_select_autenticado on public.pregoes_gravados_mensagens for select to authenticated using (true);

-- Uma página lida por vez (normalmente 1 item). Mescla sem apagar: valor ausente na leitura nova não
-- sobrescreve o que outra leitura já trouxe (ex.: marca lida antes, fornecedor fechado agora).
create or replace function public.gravar_pregao_gravado(p_dados jsonb, p_usuario uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_compra text := p_dados->>'compra';
  v_item jsonb;
  n_prop int;
  n_msg int;
begin
  if p_usuario is null then raise exception 'Usuário obrigatório.'; end if;
  insert into pregoes_gravados as t (id_compra, fonte, url, uasg, orgao, numero, ano, modalidade, gravado_por, atualizado_por)
  values (v_compra, p_dados->>'fonte', p_dados->>'url', p_dados#>>'{cabecalho,uasg}', p_dados#>>'{cabecalho,orgao}',
    p_dados#>>'{cabecalho,numero}', (p_dados#>>'{cabecalho,ano}')::int, p_dados#>>'{cabecalho,modalidade}', p_usuario, p_usuario)
  on conflict (id_compra) do update set url = coalesce(excluded.url, t.url), uasg = coalesce(excluded.uasg, t.uasg),
    orgao = coalesce(excluded.orgao, t.orgao), numero = coalesce(excluded.numero, t.numero), ano = coalesce(excluded.ano, t.ano),
    modalidade = coalesce(excluded.modalidade, t.modalidade), atualizado_por = excluded.atualizado_por, atualizado_em = now();

  for v_item in select * from jsonb_array_elements(coalesce(p_dados->'itens', '[]'::jsonb)) loop
    update pregoes_gravados set itens = itens || jsonb_build_object(v_item->>'numero',
        coalesce(itens->(v_item->>'numero'), '{}'::jsonb)
        || jsonb_strip_nulls(jsonb_build_object('descricao', v_item->'descricao', 'situacao', v_item->'situacao',
             'quantidade', v_item->'quantidade', 'valor_estimado', v_item->'valorEstimado', 'unidade', v_item->'unidade'))
        || case when (v_item->>'propostasLidas')::boolean then jsonb_build_object('propostas_lidas_em', now()) else '{}'::jsonb end)
    where id_compra = v_compra;
  end loop;

  insert into pregoes_gravados_propostas as t (id_compra, numero_item, fornecedor_chave, cnpj, nome, uf, me_epp, situacao,
    valor_ofertado, valor_negociado, valor_proposta, valor_total, quantidade, marca, fabricante, modelo, lances,
    chat_lido, proposta_lida, gravado_por, atualizado_por)
  select v_compra, (i->>'numero')::int, p->>'chave', p->>'cnpj', p->>'nome', p->>'uf', (p->>'meEpp')::boolean, p->>'situacao',
    (p->>'valorOfertado')::numeric, (p->>'valorNegociado')::numeric, (p->>'valorProposta')::numeric, (p->>'valorTotal')::numeric,
    (p->>'quantidade')::numeric, p->>'marca', p->>'fabricante', p->>'modelo', coalesce(p->'lances', '[]'::jsonb),
    coalesce((p->>'chatLido')::boolean, false), coalesce((p->>'propostaLida')::boolean, false), p_usuario, p_usuario
  from jsonb_array_elements(coalesce(p_dados->'itens', '[]'::jsonb)) i, jsonb_array_elements(coalesce(i->'propostas', '[]'::jsonb)) p
  on conflict (id_compra, numero_item, fornecedor_chave) do update set
    nome = coalesce(excluded.nome, t.nome), uf = coalesce(excluded.uf, t.uf), me_epp = coalesce(excluded.me_epp, t.me_epp),
    situacao = coalesce(excluded.situacao, t.situacao), valor_ofertado = coalesce(excluded.valor_ofertado, t.valor_ofertado),
    valor_negociado = coalesce(excluded.valor_negociado, t.valor_negociado), valor_proposta = coalesce(excluded.valor_proposta, t.valor_proposta),
    valor_total = coalesce(excluded.valor_total, t.valor_total), quantidade = coalesce(excluded.quantidade, t.quantidade),
    marca = coalesce(excluded.marca, t.marca), fabricante = coalesce(excluded.fabricante, t.fabricante), modelo = coalesce(excluded.modelo, t.modelo),
    lances = case when jsonb_array_length(excluded.lances) > 0 then excluded.lances else t.lances end,
    chat_lido = t.chat_lido or excluded.chat_lido, proposta_lida = t.proposta_lida or excluded.proposta_lida,
    atualizado_por = excluded.atualizado_por, atualizado_em = now();
  get diagnostics n_prop = row_count;

  insert into pregoes_gravados_mensagens (chave, id_compra, numero_item, fornecedor_chave, data_hora, autor, texto, tipo, motivo, gravado_por)
  select md5(concat_ws('|', v_compra, m.n, m.j->>'fornecedor', m.j->>'dataHora', m.j->>'texto')), v_compra, m.n, m.j->>'fornecedor',
    (m.j->>'dataHora')::timestamp, m.j->>'autor', m.j->>'texto', m.j->>'tipo', m.j->>'motivo', p_usuario
  from (select (i->>'numero')::int n, x j from jsonb_array_elements(coalesce(p_dados->'itens', '[]'::jsonb)) i, jsonb_array_elements(coalesce(i->'mensagens', '[]'::jsonb)) x
        union all select 0, x from jsonb_array_elements(coalesce(p_dados->'mensagens', '[]'::jsonb)) x) m
  on conflict (chave) do nothing;
  get diagnostics n_msg = row_count;

  return jsonb_build_object('propostas', n_prop, 'mensagens_novas', n_msg);
end $$;
revoke all on function public.gravar_pregao_gravado(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.gravar_pregao_gravado(jsonb, uuid) to service_role;

commit;
