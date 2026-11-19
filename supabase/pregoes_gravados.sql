-- ============================================================================
-- LicitaPlena — pregões gravados pela extensão (modo "Gravar pregão no LicitaPlena").
--
-- Rode no Supabase: SQL Editor -> New query -> Run. Idempotente (pode rodar de novo sem apagar nada).
-- Dado PÚBLICO lido pela aba do próprio usuário na página pública do Compras.gov ("Acompanhar
-- Contratação") ou na ata do ComprasNet antigo: participantes, propostas, marca/modelo, lances e chat do
-- pregoeiro. Por ser público e caro de obter (captcha a cada abertura), fica compartilhado: uma vez
-- gravado, qualquer cliente logado lê sem abrir o portal de novo.
--   Leitura: qualquer usuário autenticado, só as colunas públicas (anon não lê; quem gravou não aparece).
--   Escrita: só a RPC gravar_pregao_gravado, executável apenas pelo service_role
--            (netlify/functions/pregao-gravado.js, que valida o pedido, o login e o cadastro aprovado antes).
-- Nunca CPF: participante sem CNPJ fica como "pf:<n>" com nome "Pessoa física"; CHECKs recusam CPF em
-- texto (com ou sem pontuação). Quem gravou fica em gravado_por/atualizado_por e nas leituras (só service_role).
-- Valores consolidados de várias leituras, com selo "não verificado": ver a seção de 19/11/2026 abaixo.
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


-- ----------------------------------------------------------------------------
-- Revisão de segurança 19/11/2026 (A1, A2, M3, B6). Qualquer cliente aprovado grava; sem estas regras, a
-- leitura de um sobrescrevia a do outro (coalesce(novo, antigo)) e um cliente mal-intencionado podia trocar
-- vencedor, valor ou marca de um pregão real para todos. Agora:
--   - cada usuário grava a SUA leitura em pregoes_gravados_leituras (a dele só substitui a dele);
--   - o valor mostrado em pregoes_gravados / _propostas / itens é CONSOLIDADO das leituras, campo a campo:
--     vence o valor com mais organizações (grupo) concordando; empate -> o lido primeiro. Logo, uma leitura
--     posterior isolada nunca troca um valor já gravado; trocar exige 2+ organizações; campo vazio é preenchido
--     pela primeira leitura que o trouxer;
--   - leituras_concordantes = nº de organizações cuja leitura não contradiz o consolidado; a tela mostra
--     "lido por usuário, não verificado" enquanto for < 2. origem = 'usuario' em tudo que vem da extensão;
--   - mensagens: dedupe por md5 como antes, nunca apagadas por outra leitura; quem leu fica em
--     pregoes_gravados_mensagens_leitores;
--   - expurgar_pregoes_gravados_por(usuario) tira tudo que aquele usuário trouxe e recalcula o resto.
-- grupo = organização do usuário (operacao_membros, a de menor id se tiver várias) ou o próprio usuário.
-- ----------------------------------------------------------------------------

alter table public.pregoes_gravados add column if not exists origem text not null default 'usuario' check (origem = 'usuario');
alter table public.pregoes_gravados add column if not exists fonte_sem_https boolean not null default false;
alter table public.pregoes_gravados add column if not exists leituras_concordantes int not null default 1;
alter table public.pregoes_gravados_propostas add column if not exists origem text not null default 'usuario' check (origem = 'usuario');
alter table public.pregoes_gravados_propostas add column if not exists leituras_concordantes int not null default 1;
alter table public.pregoes_gravados_mensagens add column if not exists origem text not null default 'usuario' check (origem = 'usuario');
alter table public.pregoes_gravados_mensagens add column if not exists leituras_concordantes int not null default 1;

-- A2: CPF (com ou sem pontuação, espaço ou "/") nunca no texto. Limpeza única e idempotente ANTES do CHECK,
-- mesma regex de netlify/functions/_cpf.js. A chave md5 das mensagens limpas não muda (dedupe futuro usa o
-- texto já mascarado pelo servidor, então uma releitura daquela mensagem pode gerar uma linha nova mascarada).
update public.pregoes_gravados_propostas set nome = regexp_replace(nome, '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y', '***.***.***-**', 'g')
  where nome ~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y';
update public.pregoes_gravados_mensagens set texto = regexp_replace(texto, '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y', '***.***.***-**', 'g')
  where texto ~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y';
update public.pregoes_gravados_mensagens set motivo = regexp_replace(motivo, '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y', '***.***.***-**', 'g')
  where motivo ~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y';
alter table public.pregoes_gravados_propostas drop constraint if exists pregoes_gravados_propostas_nome_check;
alter table public.pregoes_gravados_propostas add constraint pregoes_gravados_propostas_nome_check
  check (char_length(nome) <= 300 and nome !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y');
alter table public.pregoes_gravados_mensagens drop constraint if exists pregoes_gravados_mensagens_texto_check;
alter table public.pregoes_gravados_mensagens add constraint pregoes_gravados_mensagens_texto_check
  check (char_length(texto) between 1 and 4000 and texto !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y');
alter table public.pregoes_gravados_mensagens drop constraint if exists pregoes_gravados_mensagens_motivo_check;
alter table public.pregoes_gravados_mensagens add constraint pregoes_gravados_mensagens_motivo_check
  check (char_length(motivo) <= 2000 and motivo !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y');

-- Uma linha por (alvo, usuário). alvo 'compra' = cabeçalho (numero_item 0, fornecedor ''), 'item' = dados do
-- item (fornecedor ''), 'proposta' = um participante. dados usa os nomes das colunas consolidadas.
create table if not exists public.pregoes_gravados_leituras (
  id_compra text not null references public.pregoes_gravados(id_compra) on delete cascade,
  alvo text not null check (alvo in ('compra', 'item', 'proposta')),
  numero_item int not null default 0 check (numero_item between 0 and 99999),
  fornecedor_chave text not null default '' check (fornecedor_chave ~ '^([0-9]{14}|pf:[0-9]{1,4})?$'),
  gravado_por uuid not null,
  grupo uuid not null,
  dados jsonb not null check (jsonb_typeof(dados) = 'object' and coalesce(dados->>'nome', '') !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y'),
  sem_https boolean not null default false, -- B6: lida de página http (ata do ComprasNet antigo)
  lido_em timestamptz not null default clock_timestamp(), -- primeira leitura: decide empate e não muda na releitura
  atualizado_em timestamptz not null default clock_timestamp(),
  primary key (id_compra, alvo, numero_item, fornecedor_chave, gravado_por)
);
create index if not exists pregoes_gravados_leituras_usuario_idx on public.pregoes_gravados_leituras (gravado_por);

create table if not exists public.pregoes_gravados_mensagens_leitores (
  chave text not null references public.pregoes_gravados_mensagens(chave) on delete cascade,
  gravado_por uuid not null,
  grupo uuid not null,
  lido_em timestamptz not null default clock_timestamp(),
  primary key (chave, gravado_por)
);
create index if not exists pregoes_gravados_mensagens_leitores_usuario_idx on public.pregoes_gravados_mensagens_leitores (gravado_por);

alter table public.pregoes_gravados enable row level security;
alter table public.pregoes_gravados_propostas enable row level security;
alter table public.pregoes_gravados_mensagens enable row level security;
alter table public.pregoes_gravados_leituras enable row level security;
alter table public.pregoes_gravados_mensagens_leitores enable row level security;
revoke all on public.pregoes_gravados, public.pregoes_gravados_propostas, public.pregoes_gravados_mensagens,
  public.pregoes_gravados_leituras, public.pregoes_gravados_mensagens_leitores from anon;
revoke all on public.pregoes_gravados, public.pregoes_gravados_propostas, public.pregoes_gravados_mensagens,
  public.pregoes_gravados_leituras, public.pregoes_gravados_mensagens_leitores from authenticated;
-- M3: leitura por coluna, sem quem gravou (gravado_por/atualizado_por). Leituras e leitores: só service_role.
grant select (id_compra, fonte, url, uasg, orgao, numero, ano, modalidade, itens, origem, fonte_sem_https, leituras_concordantes, gravado_em, atualizado_em)
  on public.pregoes_gravados to authenticated;
grant select (id_compra, numero_item, fornecedor_chave, cnpj, nome, uf, me_epp, situacao, valor_ofertado, valor_negociado, valor_proposta, valor_total,
  quantidade, marca, fabricante, modelo, lances, chat_lido, proposta_lida, origem, leituras_concordantes, gravado_em, atualizado_em)
  on public.pregoes_gravados_propostas to authenticated;
grant select (chave, id_compra, numero_item, fornecedor_chave, data_hora, autor, texto, tipo, motivo, origem, leituras_concordantes, gravado_em)
  on public.pregoes_gravados_mensagens to authenticated;
drop policy if exists pregoes_gravados_select_autenticado on public.pregoes_gravados;
create policy pregoes_gravados_select_autenticado on public.pregoes_gravados for select to authenticated using (true);
drop policy if exists pregoes_gravados_propostas_select_autenticado on public.pregoes_gravados_propostas;
create policy pregoes_gravados_propostas_select_autenticado on public.pregoes_gravados_propostas for select to authenticated using (true);
drop policy if exists pregoes_gravados_mensagens_select_autenticado on public.pregoes_gravados_mensagens;
create policy pregoes_gravados_mensagens_select_autenticado on public.pregoes_gravados_mensagens for select to authenticated using (true);

create or replace function public.pregoes_gravados_grupo(p_usuario uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select organizacao_id from operacao_membros where usuario_id = p_usuario order by organizacao_id limit 1), p_usuario)
$$;

-- Consolidado de um alvo, campo a campo, + '_concordantes'. Bandeiras "já lido" (chat_lido, proposta_lida,
-- propostas_lidas) não votam: só passam a verdadeiro (bool_or no recálculo).
create or replace function public.pregoes_gravados_consolidar(p_compra text, p_alvo text, p_item int, p_forn text)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  with l as (
    select grupo, dados, lido_em from pregoes_gravados_leituras
    where id_compra = p_compra and alvo = p_alvo and numero_item = p_item and fornecedor_chave = p_forn
  ), votos as (
    select distinct on (e.key) e.key, e.value
    from l, jsonb_each(l.dados) e
    where e.value <> 'null'::jsonb and e.key <> all (array['chat_lido', 'proposta_lida', 'propostas_lidas'])
    group by e.key, e.value
    order by e.key, count(distinct l.grupo) desc, min(l.lido_em), e.value::text
  ), c as (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) v from votos)
  select c.v || jsonb_build_object('_concordantes', (
    -- Leitura vazia (só o número do item) não conta como confirmação.
    select count(distinct l.grupo) from l where exists (
      select 1 from jsonb_each(l.dados) e where e.value <> 'null'::jsonb and e.key <> all (array['chat_lido', 'proposta_lida', 'propostas_lidas'])
    ) and not exists (
      select 1 from jsonb_each(l.dados) e
      where e.value <> 'null'::jsonb and e.key <> all (array['chat_lido', 'proposta_lida', 'propostas_lidas']) and c.v->e.key is distinct from e.value)))
  from c
$$;

-- Refaz o consolidado da compra inteira a partir das leituras (determinístico: mesma entrada, mesmo resultado).
-- shortcut: recalcula a compra toda a cada gravação; se um pregão passar de alguns milhares de propostas, recalcular só o item gravado.
create or replace function public.pregoes_gravados_recalcular(p_compra text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  if not exists (select 1 from pregoes_gravados_leituras where id_compra = p_compra) then
    delete from pregoes_gravados where id_compra = p_compra; -- cascata leva propostas, mensagens e leitores
    return;
  end if;
  v := pregoes_gravados_consolidar(p_compra, 'compra', 0, '');
  update pregoes_gravados t set fonte = coalesce(v->>'fonte', t.fonte), url = v->>'url', uasg = v->>'uasg', orgao = v->>'orgao',
    numero = v->>'numero', ano = (v->>'ano')::int, modalidade = v->>'modalidade', leituras_concordantes = (v->>'_concordantes')::int,
    fonte_sem_https = exists (select 1 from pregoes_gravados_leituras l where l.id_compra = p_compra and l.sem_https),
    itens = coalesce((
      select jsonb_object_agg(k.numero_item::text, (x.c - '_concordantes') || jsonb_build_object('leituras_concordantes', (x.c->>'_concordantes')::int)
        || case when k.lidas is null then '{}'::jsonb else jsonb_build_object('propostas_lidas_em', k.lidas) end)
      from (select numero_item, min(lido_em) filter (where (dados->>'propostas_lidas')::boolean) lidas
            from pregoes_gravados_leituras where id_compra = p_compra and alvo = 'item' group by numero_item) k
      cross join lateral pregoes_gravados_consolidar(p_compra, 'item', k.numero_item, '') as x(c)), '{}'::jsonb)
  where t.id_compra = p_compra;

  delete from pregoes_gravados_propostas p where p.id_compra = p_compra and not exists (
    select 1 from pregoes_gravados_leituras l where l.id_compra = p.id_compra and l.alvo = 'proposta'
      and l.numero_item = p.numero_item and l.fornecedor_chave = p.fornecedor_chave);
  insert into pregoes_gravados_propostas as t (id_compra, numero_item, fornecedor_chave, cnpj, nome, uf, me_epp, situacao,
    valor_ofertado, valor_negociado, valor_proposta, valor_total, quantidade, marca, fabricante, modelo, lances,
    chat_lido, proposta_lida, gravado_por, gravado_em, atualizado_por, leituras_concordantes)
  select p_compra, k.numero_item, k.fornecedor_chave, case when k.fornecedor_chave like 'pf:%' then null else k.fornecedor_chave end,
    case when k.fornecedor_chave like 'pf:%' then 'Pessoa física' else r.nome end, r.uf, r.me_epp, r.situacao,
    r.valor_ofertado, r.valor_negociado, r.valor_proposta, r.valor_total, r.quantidade, r.marca, r.fabricante, r.modelo, coalesce(r.lances, '[]'::jsonb),
    k.chat, k.proposta, k.primeiro, k.primeiro_em, k.ultimo, (x.c->>'_concordantes')::int
  from (select numero_item, fornecedor_chave, bool_or(coalesce((dados->>'chat_lido')::boolean, false)) chat,
          bool_or(coalesce((dados->>'proposta_lida')::boolean, false)) proposta,
          (array_agg(gravado_por order by lido_em))[1] primeiro, min(lido_em) primeiro_em, (array_agg(gravado_por order by atualizado_em desc))[1] ultimo
        from pregoes_gravados_leituras where id_compra = p_compra and alvo = 'proposta' group by numero_item, fornecedor_chave) k
  cross join lateral pregoes_gravados_consolidar(p_compra, 'proposta', k.numero_item, k.fornecedor_chave) as x(c)
  cross join lateral jsonb_populate_record(null::pregoes_gravados_propostas, x.c) r
  on conflict (id_compra, numero_item, fornecedor_chave) do update set
    nome = excluded.nome, uf = excluded.uf, me_epp = excluded.me_epp, situacao = excluded.situacao,
    valor_ofertado = excluded.valor_ofertado, valor_negociado = excluded.valor_negociado, valor_proposta = excluded.valor_proposta,
    valor_total = excluded.valor_total, quantidade = excluded.quantidade, marca = excluded.marca, fabricante = excluded.fabricante,
    modelo = excluded.modelo, lances = excluded.lances, chat_lido = excluded.chat_lido, proposta_lida = excluded.proposta_lida,
    gravado_por = excluded.gravado_por, gravado_em = excluded.gravado_em, atualizado_por = excluded.atualizado_por,
    leituras_concordantes = excluded.leituras_concordantes, atualizado_em = now();

  -- Mensagem só sai quando ninguém mais a leu (expurgo); gravação normal nunca apaga mensagem.
  delete from pregoes_gravados_mensagens m where m.id_compra = p_compra
    and not exists (select 1 from pregoes_gravados_mensagens_leitores l where l.chave = m.chave);
  update pregoes_gravados_mensagens m set leituras_concordantes = (select count(distinct l.grupo) from pregoes_gravados_mensagens_leitores l where l.chave = m.chave)
  where m.id_compra = p_compra;
end $$;

-- Uma página lida por vez (normalmente 1 item). A leitura do usuário mescla com a leitura anterior DELE
-- (campo ausente agora não apaga o que ele já trouxe); o consolidado é refeito a partir de todas as leituras.
create or replace function public.gravar_pregao_gravado(p_dados jsonb, p_usuario uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_compra text := p_dados->>'compra';
  v_grupo uuid;
  v_sem boolean := coalesce((p_dados->>'semHttps')::boolean, false) or coalesce(p_dados->>'url' like 'http:%', false);
  n_prop int;
  n_msg int;
begin
  if p_usuario is null then raise exception 'Usuário obrigatório.'; end if;
  v_grupo := pregoes_gravados_grupo(p_usuario);
  insert into pregoes_gravados as t (id_compra, fonte, gravado_por, atualizado_por) values (v_compra, p_dados->>'fonte', p_usuario, p_usuario)
  on conflict (id_compra) do update set atualizado_por = excluded.atualizado_por, atualizado_em = now();

  insert into pregoes_gravados_leituras as t (id_compra, alvo, numero_item, fornecedor_chave, gravado_por, grupo, dados, sem_https)
  values (v_compra, 'compra', 0, '', p_usuario, v_grupo, jsonb_strip_nulls(jsonb_build_object('fonte', p_dados->'fonte', 'url', p_dados->'url',
    'uasg', p_dados#>'{cabecalho,uasg}', 'orgao', p_dados#>'{cabecalho,orgao}', 'numero', p_dados#>'{cabecalho,numero}',
    'ano', p_dados#>'{cabecalho,ano}', 'modalidade', p_dados#>'{cabecalho,modalidade}')), v_sem)
  on conflict (id_compra, alvo, numero_item, fornecedor_chave, gravado_por) do update set dados = t.dados || excluded.dados,
    grupo = excluded.grupo, sem_https = t.sem_https or excluded.sem_https, atualizado_em = clock_timestamp();

  insert into pregoes_gravados_leituras as t (id_compra, alvo, numero_item, fornecedor_chave, gravado_por, grupo, dados, sem_https)
  select v_compra, 'item', (i->>'numero')::int, '', p_usuario, v_grupo, jsonb_strip_nulls(jsonb_build_object('descricao', i->'descricao',
    'situacao', i->'situacao', 'quantidade', i->'quantidade', 'valor_estimado', i->'valorEstimado', 'unidade', i->'unidade',
    'propostas_lidas', case when (i->>'propostasLidas')::boolean then true end)), v_sem
  from jsonb_array_elements(coalesce(p_dados->'itens', '[]'::jsonb)) i
  on conflict (id_compra, alvo, numero_item, fornecedor_chave, gravado_por) do update set dados = t.dados || excluded.dados,
    grupo = excluded.grupo, sem_https = t.sem_https or excluded.sem_https, atualizado_em = clock_timestamp();

  insert into pregoes_gravados_leituras as t (id_compra, alvo, numero_item, fornecedor_chave, gravado_por, grupo, dados, sem_https)
  select v_compra, 'proposta', (i->>'numero')::int, p->>'chave', p_usuario, v_grupo, jsonb_strip_nulls(jsonb_build_object(
    'nome', case when p->>'chave' like 'pf:%' then null else p->'nome' end, 'uf', p->'uf', 'me_epp', p->'meEpp', 'situacao', p->'situacao',
    'valor_ofertado', p->'valorOfertado', 'valor_negociado', p->'valorNegociado', 'valor_proposta', p->'valorProposta',
    'valor_total', p->'valorTotal', 'quantidade', p->'quantidade', 'marca', p->'marca', 'fabricante', p->'fabricante', 'modelo', p->'modelo',
    'lances', case when jsonb_array_length(coalesce(p->'lances', '[]'::jsonb)) > 0 then p->'lances' end,
    'chat_lido', case when (p->>'chatLido')::boolean then true end, 'proposta_lida', case when (p->>'propostaLida')::boolean then true end)), v_sem
  from jsonb_array_elements(coalesce(p_dados->'itens', '[]'::jsonb)) i, jsonb_array_elements(coalesce(i->'propostas', '[]'::jsonb)) p
  on conflict (id_compra, alvo, numero_item, fornecedor_chave, gravado_por) do update set dados = t.dados || excluded.dados,
    grupo = excluded.grupo, sem_https = t.sem_https or excluded.sem_https, atualizado_em = clock_timestamp();
  get diagnostics n_prop = row_count;

  insert into pregoes_gravados_mensagens (chave, id_compra, numero_item, fornecedor_chave, data_hora, autor, texto, tipo, motivo, gravado_por)
  select md5(concat_ws('|', v_compra, m.n, m.j->>'fornecedor', m.j->>'dataHora', m.j->>'texto')), v_compra, m.n, m.j->>'fornecedor',
    (m.j->>'dataHora')::timestamp, m.j->>'autor', m.j->>'texto', m.j->>'tipo', m.j->>'motivo', p_usuario
  from (select (i->>'numero')::int n, x j from jsonb_array_elements(coalesce(p_dados->'itens', '[]'::jsonb)) i, jsonb_array_elements(coalesce(i->'mensagens', '[]'::jsonb)) x
        union all select 0, x from jsonb_array_elements(coalesce(p_dados->'mensagens', '[]'::jsonb)) x) m
  on conflict (chave) do nothing;
  get diagnostics n_msg = row_count;
  insert into pregoes_gravados_mensagens_leitores (chave, gravado_por, grupo)
  select distinct md5(concat_ws('|', v_compra, m.n, m.j->>'fornecedor', m.j->>'dataHora', m.j->>'texto')), p_usuario, v_grupo
  from (select (i->>'numero')::int n, x j from jsonb_array_elements(coalesce(p_dados->'itens', '[]'::jsonb)) i, jsonb_array_elements(coalesce(i->'mensagens', '[]'::jsonb)) x
        union all select 0, x from jsonb_array_elements(coalesce(p_dados->'mensagens', '[]'::jsonb)) x) m
  on conflict (chave, gravado_por) do nothing;

  perform pregoes_gravados_recalcular(v_compra);
  return jsonb_build_object('propostas', n_prop, 'mensagens_novas', n_msg);
end $$;

-- Expurgo (conta abusiva): tira as leituras e as mensagens que só aquele usuário trouxe e recalcula o resto.
-- Rodar pelo SQL Editor ou service_role: select public.expurgar_pregoes_gravados_por('<uuid>');
create or replace function public.expurgar_pregoes_gravados_por(p_usuario uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_compras text[]; n_l int; n_m int; c text;
begin
  if p_usuario is null then raise exception 'Usuário obrigatório.'; end if;
  select array_agg(distinct id_compra) into v_compras from (
    select id_compra from pregoes_gravados_leituras where gravado_por = p_usuario
    union select m.id_compra from pregoes_gravados_mensagens_leitores l join pregoes_gravados_mensagens m using (chave) where l.gravado_por = p_usuario) x;
  delete from pregoes_gravados_leituras where gravado_por = p_usuario;
  get diagnostics n_l = row_count;
  delete from pregoes_gravados_mensagens_leitores where gravado_por = p_usuario;
  get diagnostics n_m = row_count;
  foreach c in array coalesce(v_compras, '{}'::text[]) loop perform pregoes_gravados_recalcular(c); end loop;
  update pregoes_gravados set gravado_por = null where gravado_por = p_usuario;
  update pregoes_gravados set atualizado_por = null where atualizado_por = p_usuario;
  update pregoes_gravados_mensagens set gravado_por = null where gravado_por = p_usuario;
  return jsonb_build_object('leituras', n_l, 'mensagens_lidas', n_m, 'compras', coalesce(array_length(v_compras, 1), 0));
end $$;

revoke all on function public.gravar_pregao_gravado(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.gravar_pregao_gravado(jsonb, uuid) to service_role;
revoke all on function public.expurgar_pregoes_gravados_por(uuid) from public, anon, authenticated;
grant execute on function public.expurgar_pregoes_gravados_por(uuid) to service_role;
revoke all on function public.pregoes_gravados_grupo(uuid) from public, anon, authenticated;
revoke all on function public.pregoes_gravados_consolidar(text, text, int, text) from public, anon, authenticated;
revoke all on function public.pregoes_gravados_recalcular(text) from public, anon, authenticated;

-- Dados gravados antes desta versão viram UMA leitura de quem gravou (ou de um leitor "legado" nulo), para
-- não perder nada. Idempotente: só compra/item/proposta/mensagem ainda sem leitura.
insert into public.pregoes_gravados_leituras (id_compra, alvo, numero_item, fornecedor_chave, gravado_por, grupo, dados, sem_https, lido_em)
select g.id_compra, 'compra', 0, '', u.id, public.pregoes_gravados_grupo(u.id),
  jsonb_strip_nulls(jsonb_build_object('fonte', g.fonte, 'url', g.url, 'uasg', g.uasg, 'orgao', g.orgao, 'numero', g.numero, 'ano', g.ano, 'modalidade', g.modalidade)),
  coalesce(g.url like 'http:%', false), g.gravado_em
from public.pregoes_gravados g, lateral (select coalesce(g.gravado_por, g.atualizado_por, '00000000-0000-0000-0000-000000000000'::uuid) id) u
where not exists (select 1 from public.pregoes_gravados_leituras l where l.id_compra = g.id_compra and l.alvo = 'compra');
insert into public.pregoes_gravados_leituras (id_compra, alvo, numero_item, fornecedor_chave, gravado_por, grupo, dados, lido_em)
select g.id_compra, 'item', e.key::int, '', u.id, public.pregoes_gravados_grupo(u.id),
  (e.value - 'propostas_lidas_em' - 'leituras_concordantes') || case when e.value ? 'propostas_lidas_em' then '{"propostas_lidas": true}'::jsonb else '{}'::jsonb end,
  coalesce((e.value->>'propostas_lidas_em')::timestamptz, g.gravado_em)
from public.pregoes_gravados g, jsonb_each(g.itens) e,
  lateral (select coalesce(g.gravado_por, g.atualizado_por, '00000000-0000-0000-0000-000000000000'::uuid) id) u
where e.key ~ '^[0-9]{1,5}$' and not exists (select 1 from public.pregoes_gravados_leituras l where l.id_compra = g.id_compra and l.alvo = 'item' and l.numero_item = e.key::int);
insert into public.pregoes_gravados_leituras (id_compra, alvo, numero_item, fornecedor_chave, gravado_por, grupo, dados, lido_em)
select p.id_compra, 'proposta', p.numero_item, p.fornecedor_chave, u.id, public.pregoes_gravados_grupo(u.id),
  jsonb_strip_nulls(jsonb_build_object('nome', case when p.cnpj is null then null else p.nome end, 'uf', p.uf, 'me_epp', p.me_epp, 'situacao', p.situacao,
    'valor_ofertado', p.valor_ofertado, 'valor_negociado', p.valor_negociado, 'valor_proposta', p.valor_proposta, 'valor_total', p.valor_total,
    'quantidade', p.quantidade, 'marca', p.marca, 'fabricante', p.fabricante, 'modelo', p.modelo,
    'lances', case when jsonb_array_length(p.lances) > 0 then p.lances end, 'chat_lido', p.chat_lido, 'proposta_lida', p.proposta_lida)), p.gravado_em
from public.pregoes_gravados_propostas p, lateral (select coalesce(p.gravado_por, p.atualizado_por, '00000000-0000-0000-0000-000000000000'::uuid) id) u
where not exists (select 1 from public.pregoes_gravados_leituras l where l.id_compra = p.id_compra and l.alvo = 'proposta'
  and l.numero_item = p.numero_item and l.fornecedor_chave = p.fornecedor_chave);
insert into public.pregoes_gravados_mensagens_leitores (chave, gravado_por, grupo, lido_em)
select m.chave, u.id, public.pregoes_gravados_grupo(u.id), m.gravado_em
from public.pregoes_gravados_mensagens m, lateral (select coalesce(m.gravado_por, '00000000-0000-0000-0000-000000000000'::uuid) id) u
where not exists (select 1 from public.pregoes_gravados_mensagens_leitores l where l.chave = m.chave);
-- shortcut: recalcula todas as compras a cada execução do arquivo (base pequena: só o que usuários gravaram à mão).
select public.pregoes_gravados_recalcular(id_compra) from public.pregoes_gravados;

commit;
