-- Análise por CNPJ (tela "Analisar concorrente" do painel): onde a empresa disputou, ganhou e perdeu.
-- Idempotente, transação única; rodar no SQL Editor DEPOIS de historico_licitacoes.sql (e, se existir,
-- de pregoes_gravados.sql, que ganha aqui um índice por fornecedor). Não apaga dados.
-- Reaproveita as tabelas historico_* (dado público, compartilhado entre organizações) e acrescenta:
--   historico_compras.uf                  UF da unidade compradora (para "participações por estado");
--   historico_participacoes.situacao_proposta  código cru do arquivo semanal de propostas do Compras.gov.
--      O governo não publica o dicionário. Medido em set-out/2026 (29.208 linhas): "6" só aparece no 1º
--      colocado que venceu; "2" aparece sem posição (proposta recusada no julgamento) ou no 1º colocado de
--      item que terminou Fracassado. A tela trata "2" como "recusada (desclassificação ou inabilitação, o
--      arquivo não distingue)" e nunca inventa o motivo.
--   historico_cnpj_consultas              cache + fila por CNPJ: a função /api/analise-cnpj (Cloudflare,
--      50 subrequisições) coleta o começo e o robô da esteira completa o resto (compras do PNCP e o arquivo
--      de propostas mês a mês, que tem as disputas PERDIDAS).
--   analise_cnpj_participacoes(cnpj)      RPC de leitura (security invoker: vale a RLS de quem chama).
--   historico_participacoes_podar(...)    teto de linhas por CNPJ e prazo de guarda (robô, service_role).
--   historico_limpar_cache(dias)          prazo de guarda do cache de consultas: 30 dias (robô, service_role).
-- A fila (historico_cnpj_consultas) guarda quem pediu (solicitante = organização ou usuário), para o teto por
-- organização; por isso nenhuma tela lê a tabela direto: o estado chega pela função /api/analise-cnpj.
-- Escrita só pelo service_role (função e robô). CPF nunca entra: fornecedor_ni só aceita 14 dígitos.
begin;
do $$ begin
 if to_regclass('public.historico_participacoes') is null then
  raise exception 'Aplique antes historico_licitacoes.sql';
 end if;
end $$;

alter table public.historico_compras add column if not exists uf text check (uf ~ '^[A-Z]{2}$');
alter table public.historico_participacoes add column if not exists situacao_proposta text check (situacao_proposta ~ '^\d{1,3}$');

create table if not exists public.historico_cnpj_consultas (
  cnpj text primary key check (cnpj ~ '^\d{14}$'),
  nome text check (length(nome) <= 300),
  situacao text not null default 'parcial' check (situacao in ('parcial', 'completo', 'falhou')),
  total_pncp integer,
  compras_pendentes text[] not null default '{}',
  meses_pendentes text[] not null default '{}',
  meses_lidos text[] not null default '{}',
  erro text check (length(erro) <= 300),
  gerado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.historico_cnpj_consultas add column if not exists solicitante uuid;
alter table public.historico_cnpj_consultas add column if not exists tentativas integer not null default 0 check (tentativas >= 0);
alter table public.historico_cnpj_consultas add column if not exists mes_falhas text check (mes_falhas ~ '^\d{4}-\d{2}$');
-- Última vez que um usuário pediu este CNPJ (análise nova ou releitura do cache): o robô atende primeiro quem está
-- esperando (scripts/analise_cnpj.js) e depois a fila por ordem de chegada, para a fila antiga nunca ficar parada.
alter table public.historico_cnpj_consultas add column if not exists pedido_em timestamptz;
create index if not exists historico_cnpj_consultas_pedido_idx on public.historico_cnpj_consultas (pedido_em desc) where situacao = 'parcial';
create index if not exists historico_cnpj_consultas_solicitante_idx on public.historico_cnpj_consultas (solicitante, gerado_em);
-- LGPD: nome do PNCP pode ser razão social de MEI com o CPF do titular. Limpeza única e idempotente, depois CHECK.
update public.historico_cnpj_consultas set nome = nullif(btrim(regexp_replace(regexp_replace(nome, '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y', ' ', 'g'), '\s+', ' ', 'g')), '')
 where nome ~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y';
alter table public.historico_cnpj_consultas drop constraint if exists historico_cnpj_consultas_nome_sem_cpf;
alter table public.historico_cnpj_consultas add constraint historico_cnpj_consultas_nome_sem_cpf check (nome !~ '\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y');
create index if not exists historico_cnpj_consultas_fila_idx on public.historico_cnpj_consultas (gerado_em) where situacao = 'parcial';

alter table public.historico_cnpj_consultas enable row level security;
revoke all on public.historico_cnpj_consultas from public, anon, authenticated;
grant all on public.historico_cnpj_consultas to service_role;
-- Sem leitura para logado: a fila guarda quem pediu. A tela recebe o estado pela função (service_role).
drop policy if exists historico_cnpj_consultas_leitura on public.historico_cnpj_consultas;

-- Motivos gravados pela extensão, por fornecedor (a tela lê pregoes_gravados_mensagens por CNPJ).
do $$ begin
 if to_regclass('public.pregoes_gravados_mensagens') is not null then
  create index if not exists pregoes_gravados_mensagens_fornecedor_idx on public.pregoes_gravados_mensagens (fornecedor_chave) where fornecedor_chave is not null;
 end if;
end $$;

-- Uma linha por item em que o CNPJ aparece, com o item, a compra e o vencedor do item (para comparar preço).
-- Vencedor: 1º do PNCP válido, senão 1º do arquivo de propostas, senão a linha sem posição com valor
-- homologado ou marca (dados abertos fora de SRP / Pesquisa de Preços, que só trazem o vencedor).
create or replace function public.analise_cnpj_participacoes(p_cnpj text)
returns table (
  id_compra text, numero_item integer, classificacao integer, ordem_classificacao integer, situacao_resultado text,
  situacao_proposta text, valor_homologado numeric, quantidade_homologada numeric, valor_proposta numeric, valor_lance numeric,
  valor_negociado numeric, data_resultado date, motivo_cancelamento text, marca text,
  descricao text, quantidade numeric, unidade text, catmat text, situacao_item text, valor_estimado numeric,
  orgao_nome text, unidade_nome text, uasg text, uf text, modalidade text, numero text, ano integer, plataforma text,
  data_publicacao date, link_origem text, link_pncp text,
  vencedor_ni text, vencedor_nome text, vencedor_valor numeric)
language sql stable security invoker set search_path = public as $$
  select p.id_compra, p.numero_item, p.classificacao, p.ordem_classificacao, p.situacao_resultado,
         p.situacao_proposta, p.valor_homologado, p.quantidade_homologada, p.valor_proposta, p.valor_lance,
         p.valor_negociado, p.data_resultado, p.motivo_cancelamento, p.marca,
         i.descricao, i.quantidade, i.unidade, i.catmat, i.situacao_item, i.valor_estimado,
         c.orgao_nome, c.unidade_nome, c.uasg, c.uf, c.modalidade, c.numero, c.ano, c.plataforma,
         c.data_publicacao, c.link_origem, c.link_pncp,
         v.fornecedor_ni, v.fornecedor_nome, coalesce(v.valor_homologado, v.valor_negociado, v.valor_lance, v.valor_proposta)
    from public.historico_participacoes p
    join public.historico_itens i on i.id_compra = p.id_compra and i.numero_item = p.numero_item
    join public.historico_compras c on c.id_compra = p.id_compra
    left join lateral (
      select w.fornecedor_ni, w.fornecedor_nome, w.valor_homologado, w.valor_negociado, w.valor_lance, w.valor_proposta
        from public.historico_participacoes w
       where w.id_compra = p.id_compra and w.numero_item = p.numero_item
         and coalesce(w.situacao_resultado, '') !~* 'cancel' and coalesce(w.situacao_proposta, '') <> '2'
         and (w.ordem_classificacao = 1 or w.classificacao = 1
              or (w.ordem_classificacao is null and w.classificacao is null and (w.valor_homologado is not null or w.marca_declarada is not null)))
       order by case when w.ordem_classificacao = 1 then 0 when w.classificacao = 1 then 1 else 2 end
       limit 1) v on true
   where p_cnpj ~ '^\d{14}$' and p.fornecedor_ni = p_cnpj
   order by coalesce(p.data_resultado, c.data_publicacao) desc nulls last, p.id_compra, p.numero_item
$$;
revoke all on function public.analise_cnpj_participacoes(text) from public, anon;
grant execute on function public.analise_cnpj_participacoes(text) to authenticated, service_role;

-- Teto por CNPJ em historico_participacoes (o arquivo de propostas de 24 meses de um fornecedor grande passa de
-- dezenas de milhares de linhas): guarda as p_max_linhas mais recentes e nada mais velho que p_meses (mínimo 37,
-- os 3 anos da "Licitação anterior", que lê as mesmas linhas). Devolve o tamanho por CNPJ para o log do robô.
create or replace function public.historico_participacoes_podar(p_cnpjs text[], p_max_linhas integer default 5000, p_meses integer default 37)
returns table (cnpj text, linhas bigint, apagadas bigint)
language plpgsql security definer set search_path = '' as $$
declare c text; n bigint;
begin
  foreach c in array coalesce(p_cnpjs, '{}') loop
    continue when c !~ '^\d{14}$';
    with ordenadas as (
      select p.ctid as linha, row_number() over (order by coalesce(p.data_resultado, h.data_publicacao) desc nulls last, p.atualizado_em desc) as pos,
             coalesce(p.data_resultado, h.data_publicacao) as quando
        from public.historico_participacoes p
        left join public.historico_compras h on h.id_compra = p.id_compra
       where p.fornecedor_ni = c)
    delete from public.historico_participacoes p using ordenadas o
     where p.ctid = o.linha and (o.pos > greatest(p_max_linhas, 100) or o.quando < (current_date - make_interval(months => greatest(p_meses, 37))));
    get diagnostics n = row_count;
    cnpj := c; apagadas := n;
    select count(*) into linhas from public.historico_participacoes x where x.fornecedor_ni = c;
    return next;
  end loop;
end $$;
revoke all on function public.historico_participacoes_podar(text[], integer, integer) from public, anon, authenticated;
grant execute on function public.historico_participacoes_podar(text[], integer, integer) to service_role;

-- Prazo de guarda do cache de consultas (politica-privacidade.html): apaga o que foi gerado há mais de p_dias
-- (mínimo 8, acima da validade de 7 dias do cache). Os dados públicos das compras ficam; só o cache sai.
create or replace function public.historico_limpar_cache(p_dias integer default 30)
returns integer language plpgsql security definer set search_path = '' as $$
declare a integer; b integer; corte timestamptz := now() - make_interval(days => greatest(coalesce(p_dias, 30), 8));
begin
  delete from public.historico_consultas where gerado_em < corte;
  get diagnostics a = row_count;
  delete from public.historico_cnpj_consultas where gerado_em < corte;
  get diagnostics b = row_count;
  return a + b;
end $$;
revoke all on function public.historico_limpar_cache(integer) from public, anon, authenticated;
grant execute on function public.historico_limpar_cache(integer) to service_role;

notify pgrst, 'reload schema';
commit;
