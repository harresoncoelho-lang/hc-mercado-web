-- Esteira automática do edital: tarefas, gatilho de interesse e origem 'interesse' na fila (tarefa E2).
-- Idempotente, transação única; rodar no SQL Editor depois do 01-aplicar.sql, operacao_itens_proposta.sql,
-- operacao_perfil_empresa.sql e fila_dossies.sql. Não apaga dados; só acrescenta colunas e objetos.
-- Regra fixa: o gatilho NUNCA toca operacao_processos.atualizado_em (controle de concorrência do kit e do checklist).
begin;
do $$ begin
 if to_regprocedure('public.pode_acessar_empresa_operacao(uuid,uuid)') is null
  or to_regclass('public.operacao_processos_id_empresa_org_idx') is null
  or to_regprocedure('public.premissa_aplicavel(uuid,text,text)') is null
  or to_regclass('public.fila_dossies') is null
  or not exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'operacao_processos' and column_name = 'margem_minima_percentual') then
  raise exception 'Aplique antes 01-aplicar.sql, operacao_itens_proposta.sql, operacao_perfil_empresa.sql e fila_dossies.sql';
 end if;
end $$;

-- Uma linha por etapa do robô (scripts/esteira_processos.js). Só o service_role e o gatilho escrevem.
create table if not exists public.operacao_esteira_tarefas (
  organizacao_id uuid not null,
  empresa_id uuid not null,
  processo_id uuid not null,
  etapa text not null,
  estado text not null default 'pendente' check (estado in ('pendente', 'executando', 'feito', 'aguardando_leitura', 'falhou')),
  tentativas integer not null default 0 check (tentativas >= 0),
  proximo_em timestamptz not null default now(),
  detalhe jsonb not null default '{}'::jsonb check (jsonb_typeof(detalhe) = 'object'),
  erro text check (length(erro) <= 2000),
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  primary key (processo_id, etapa),
  foreign key (processo_id, empresa_id, organizacao_id)
    references public.operacao_processos(id, empresa_id, organizacao_id) on delete cascade
);
-- Etapas aceitas ('historico' = licitação anterior; 'resultado' e 'contrato' = etapas 7 e 8, scripts/esteira_contratos.js). Recriada por nome para a
-- reaplicação trocar a regra antiga (que vinha inline no create table) sem apagar linha nenhuma.
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid = 'public.operacao_esteira_tarefas'::regclass and contype = 'c'
            and pg_get_constraintdef(oid) like '%etapa%' loop
  execute format('alter table public.operacao_esteira_tarefas drop constraint %I', c.conname);
 end loop;
end $$;
alter table public.operacao_esteira_tarefas add constraint operacao_esteira_tarefas_etapa_check
  check (etapa in ('itens', 'exigencias', 'cruzamento', 'historico', 'resultado', 'contrato'));
create index if not exists operacao_esteira_tarefas_fila_idx
  on public.operacao_esteira_tarefas (proximo_em) where estado in ('pendente', 'aguardando_leitura');

alter table public.operacao_esteira_tarefas enable row level security;
revoke all on public.operacao_esteira_tarefas from public, anon, authenticated;
grant select on public.operacao_esteira_tarefas to authenticated;
grant all on public.operacao_esteira_tarefas to service_role;
drop policy if exists operacao_esteira_tarefas_leitura on public.operacao_esteira_tarefas;
create policy operacao_esteira_tarefas_leitura on public.operacao_esteira_tarefas for select to authenticated
  using (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));

-- Fila de dossiês: 'interesse' entra junto dos valores existentes ('clique', 'boletim').
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid = 'public.fila_dossies'::regclass and contype = 'c'
            and pg_get_constraintdef(oid) like '%origem%' loop
  execute format('alter table public.fila_dossies drop constraint %I', c.conname);
 end loop;
end $$;
alter table public.fila_dossies add constraint fila_dossies_origem_check
  check (origem in ('clique', 'boletim', 'interesse'));

-- De onde vieram as premissas do processo; nulo = ninguém informou.
alter table public.operacao_processos
  add column if not exists premissas_fonte text check (premissas_fonte in ('manual', 'padrao')),
  add column if not exists premissas_aplicadas_em timestamptz;

create or replace function public.iniciar_esteira_processo()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
 v_uf text := '*';
 v_obs constant text := 'calculado pela regra legal; confira o edital';
 p public.operacao_premissas_empresa;
 d date;
 n int := 0;
 v_venc timestamptz;
 cat record;
 v_primeira boolean;
 v_interesse boolean;
begin
 -- (a) Premissas padrão só quando as 5 do processo estão vazias; digitada à mão nunca é sobrescrita.
 if new.frete is null and new.tributos_percentual is null and new.garantia_percentual is null
    and new.margem_percentual is null and new.margem_minima_percentual is null then
  -- O processo não guarda UF; o painel não grava edital.uf. A UF vem do edital coletado, se ainda estiver lá.
  if to_regclass('public.oportunidades_abertas') is not null then
   select coalesce(max(upper(btrim(o.uf))), '*') into v_uf from public.oportunidades_abertas o
    where o.numero_controle_pncp = new.origem_externa_id;
   if v_uf !~ '^[A-Z]{2}$' then v_uf := '*'; end if;
  end if;
  p := public.premissa_aplicavel(new.empresa_id, '*', v_uf);
  if p.id is not null then
   update public.operacao_processos set
     frete = case when new.valor_estimado is not null and p.frete_percentual is not null
                  then round(new.valor_estimado * p.frete_percentual / 100, 2) end,
     tributos_percentual = p.tributos_percentual,
     garantia_percentual = p.garantia_percentual,
     margem_percentual = p.margem_percentual,
     -- O processo aceita até 99,999 (operacao_itens_proposta.sql); 100 não pode derrubar o cadastro.
     margem_minima_percentual = case when p.margem_minima_percentual < 100 then p.margem_minima_percentual end,
     premissas_fonte = 'padrao', premissas_aplicadas_em = now()
   where id = new.id and frete is null and tributos_percentual is null and garantia_percentual is null
     and margem_percentual is null and margem_minima_percentual is null;
  end if;
 end if;

 -- (b) Art. 164 da Lei 14.133: 3 dias úteis antes da abertura, sem feriados (estimativa).
 if new.data_sessao is not null then
  d := (new.data_sessao at time zone 'America/Sao_Paulo')::date;
  while n < 3 loop
   d := d - 1;
   if extract(isodow from d) < 6 then n := n + 1; end if;
  end loop;
  v_venc := (d + time '23:59') at time zone 'America/Sao_Paulo';
  for cat in select * from (values ('impugnacao', 'Impugnação'), ('esclarecimento', 'Esclarecimento')) v(categoria, titulo) loop
   insert into public.operacao_prazos_processo (organizacao_id, processo_id, categoria, titulo, vencimento, observacoes)
   select new.organizacao_id, new.id, cat.categoria, cat.titulo, v_venc, v_obs
   where not exists (select 1 from public.operacao_prazos_processo x
                      where x.processo_id = new.id and x.categoria = cat.categoria and x.observacoes = v_obs);
  end loop;
 end if;

 -- (c) Tarefas do robô e o edital na fila. Primeira entrada = o processo ainda não tinha tarefas
 -- (INSERT ou primeira vez no Funil); troca de status depois disso não sobe prioridade de novo.
 -- Serializa a mesma organização para a contagem do teto não furar com inserções paralelas.
 perform pg_advisory_xact_lock(hashtext('esteira:' || new.organizacao_id::text));
 v_primeira := not exists (select 1 from public.operacao_esteira_tarefas t where t.processo_id = new.id);
 insert into public.operacao_esteira_tarefas (organizacao_id, empresa_id, processo_id, etapa, criado_por)
 select new.organizacao_id, new.empresa_id, new.id, e, coalesce(auth.uid(), new.criado_por)
   from unnest(array['itens', 'exigencias', 'cruzamento', 'historico', 'resultado', 'contrato']) e
 on conflict do nothing;
 -- 'interesse' (lê todos os anexos, passa à frente na IA) só para edital que o robô coletou e com teto
 -- de 20 processos novos por organização em 24 h; fora disso entra como 'clique', sem rebaixar quem já está.
 v_interesse := v_primeira and (select count(distinct t.processo_id) from public.operacao_esteira_tarefas t
   where t.organizacao_id = new.organizacao_id and t.criado_em > now() - interval '1 day') <= 20;
 if v_interesse and to_regclass('public.oportunidades_abertas') is not null then
  v_interesse := exists (select 1 from public.oportunidades_abertas o where o.numero_controle_pncp = new.origem_externa_id);
 end if;
 if v_interesse then
  insert into public.fila_dossies (numero_controle_pncp, origem) values (new.origem_externa_id, 'interesse')
  on conflict (numero_controle_pncp) do update set origem = 'interesse'
   where public.fila_dossies.origem <> 'interesse';
 else
  insert into public.fila_dossies (numero_controle_pncp, origem) values (new.origem_externa_id, 'clique')
  on conflict (numero_controle_pncp) do nothing;
 end if;
 return null;
end $$;
revoke all on function public.iniciar_esteira_processo() from public, anon, authenticated, service_role;

-- Só processo com ID do PNCP e status ativo; status final não dispara e não apaga nada.
drop trigger if exists iniciar_esteira_processo on public.operacao_processos;
create trigger iniciar_esteira_processo after insert or update of status on public.operacao_processos
  for each row when (new.origem_externa_id ~ '^\d{14}-1-\d+/\d{4}$' and new.status not in ('arquivado', 'perdido', 'contratado'))
  execute function public.iniciar_esteira_processo();

-- Autor do processo vem do JWT: o cliente não forja criado_por (o robô com service_role mantém o informado).
create or replace function public.carimbar_criador_processo()
returns trigger language plpgsql set search_path = '' as $$
begin
 new.criado_por := coalesce(auth.uid(), new.criado_por);
 return new;
end $$;
revoke all on function public.carimbar_criador_processo() from public, anon, authenticated, service_role;
drop trigger if exists carimbar_criador_processo on public.operacao_processos;
create trigger carimbar_criador_processo before insert on public.operacao_processos
  for each row execute function public.carimbar_criador_processo();

-- "Tentar de novo" do checklist: gestor/operador devolve à fila uma etapa que falhou.
-- Teto de 3 recolocações por processo/etapa por dia (horário de Brasília), contadas em detalhe.recolocacoes.
-- Processo inexistente, de outra organização ou papel leitura recebem o mesmo erro (não revela se existe).
create or replace function public.esteira_tentar_de_novo(p_processo uuid, p_etapa text)
returns void language plpgsql security definer set search_path = '' as $$
declare
 t public.operacao_esteira_tarefas;
 v_hoje text := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD');
 v_n int;
begin
 select * into t from public.operacao_esteira_tarefas where processo_id = p_processo and etapa = p_etapa for update;
 if t.processo_id is null or not public.pode_escrever_empresa_operacao(t.organizacao_id, t.empresa_id) then
  raise exception 'Seu acesso não permite tentar de novo esta etapa' using errcode = '42501';
 end if;
 if t.estado <> 'falhou' then
  raise exception 'Só uma etapa que falhou pode ser tentada de novo' using errcode = 'P0001';
 end if;
 v_n := case when t.detalhe->'recolocacoes'->>'dia' = v_hoje
             then coalesce((t.detalhe->'recolocacoes'->>'total')::int, 0) else 0 end;
 if v_n >= 3 then
  raise exception 'Esta etapa já foi tentada de novo 3 vezes hoje. Tente amanhã ou fale com o suporte' using errcode = 'P0001';
 end if;
 update public.operacao_esteira_tarefas
    set estado = 'pendente', tentativas = 0, proximo_em = now(), erro = null,
        detalhe = t.detalhe || jsonb_build_object('recolocacoes', jsonb_build_object('dia', v_hoje, 'total', v_n + 1))
  where processo_id = p_processo and etapa = p_etapa;
end $$;
revoke all on function public.esteira_tentar_de_novo(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.esteira_tentar_de_novo(uuid, text) to authenticated;

-- O robô regrava detalhe inteiro; a contagem de recolocações sobrevive para o teto diário não zerar.
create or replace function public.preservar_recolocacoes_esteira()
returns trigger language plpgsql set search_path = '' as $$
begin
 if old.detalhe ? 'recolocacoes' and not new.detalhe ? 'recolocacoes' then
  new.detalhe := new.detalhe || jsonb_build_object('recolocacoes', old.detalhe->'recolocacoes');
 end if;
 return new;
end $$;
revoke all on function public.preservar_recolocacoes_esteira() from public, anon, authenticated, service_role;
drop trigger if exists preservar_recolocacoes_esteira on public.operacao_esteira_tarefas;
create trigger preservar_recolocacoes_esteira before update of detalhe on public.operacao_esteira_tarefas
  for each row execute function public.preservar_recolocacoes_esteira();

-- Processos que já tinham tarefas antes das etapas 7 e 8 ganham as duas (idempotente; não mexe em operacao_processos).
insert into public.operacao_esteira_tarefas (organizacao_id, empresa_id, processo_id, etapa, criado_por)
select t.organizacao_id, t.empresa_id, t.processo_id, e, t.criado_por
  from public.operacao_esteira_tarefas t cross join unnest(array['resultado', 'contrato']) e
 where t.etapa = 'itens'
on conflict do nothing;

notify pgrst, 'reload schema';
commit;
