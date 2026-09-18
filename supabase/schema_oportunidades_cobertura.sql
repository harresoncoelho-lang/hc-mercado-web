-- ============================================================================
-- LicitaPlena — cobertura (frescor) da coleta de oportunidades POR UF.
--
-- Por quê: até aqui o "quando cada UF foi coletada" vivia num único blob JSON
-- (dados_robo / chave "oportunidades_meta" -> coberturaPorUf). Isso impede que
-- mais de um coletor escreva ao mesmo tempo (o último sobrescreve o blob inteiro)
-- e obriga o painel a baixar o blob pra descobrir se uma UF está desatualizada.
-- Com uma linha por UF, cada job de coleta (um shard por runner/IP) grava só a
-- sua UF assim que ela termina, e o painel lê 27 linhas pra mostrar o frescor.
--
-- Escrita: só o robô, via SUPABASE_SERVICE_ROLE_KEY (ignora RLS). Leitura: usuário
-- autenticado (mesma regra de public.oportunidades_abertas).
--
-- Idempotente: pode rodar de novo sem medo.
-- ============================================================================

create table if not exists public.oportunidades_cobertura (
  uf text primary key check (uf ~ '^[A-Z]{2}$'),
  -- Instante da última coleta que terminou (todas as páginas lidas, linhas já gravadas
  -- em oportunidades_abertas). NULL = nunca coletada. É o que ordena a fila (mais velha primeiro).
  atualizado_em timestamptz,
  registros integer not null default 0,
  -- "totalRegistros" informado pelo PNCP na última coleta (NULL se a resposta não trouxe).
  total_api integer,
  -- false quando a coleta parou antes de ler tudo (teto de páginas, orçamento de tempo).
  completa boolean not null default false,
  -- Última tentativa, mesmo que tenha falhado (atualizado_em só avança em sucesso).
  tentativa_em timestamptz,
  ultimo_status text not null default 'nunca'
    check (ultimo_status in ('nunca', 'ok', 'parcial', 'rate_limit', 'fonte_indisponivel', 'erro')),
  ultimo_erro text
);

alter table public.oportunidades_cobertura enable row level security;

drop policy if exists "oportunidades_cobertura_select_autenticado" on public.oportunidades_cobertura;
create policy "oportunidades_cobertura_select_autenticado"
  on public.oportunidades_cobertura for select
  using (auth.role() = 'authenticated');

-- Sem policy de insert/update/delete de propósito: só a service_role (robô) escreve.

-- ----------------------------------------------------------------------------
-- Seed: garante uma linha por UF e aproveita a cobertura que já estava no blob
-- "oportunidades_meta" (registrosColetados = 1000 é o teto antigo de 20 páginas x 50,
-- então essas UFs entram como NÃO completas até uma coleta nova provar o contrário).
-- ----------------------------------------------------------------------------
insert into public.oportunidades_cobertura (uf)
select unnest(array['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
                    'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'])
on conflict (uf) do nothing;

update public.oportunidades_cobertura c
set atualizado_em = (v.value ->> 'atualizadoEm')::timestamptz,
    tentativa_em  = (v.value ->> 'atualizadoEm')::timestamptz,
    registros     = coalesce((v.value ->> 'registrosColetados')::integer, 0),
    completa      = coalesce((v.value ->> 'registrosColetados')::integer, 0) < 1000,
    ultimo_status = case when coalesce((v.value ->> 'registrosColetados')::integer, 0) < 1000 then 'ok' else 'parcial' end
from public.dados_robo d,
     jsonb_each(d.dado -> 'coberturaPorUf') as v(uf, value)
where d.chave = 'oportunidades_meta'
  and c.uf = v.uf
  and c.atualizado_em is null
  and v.value ->> 'atualizadoEm' is not null;
