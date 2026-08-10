-- ============================================================================
-- LicitaPlena — migração de segurança/estrutura (Diagnóstico Crítico, P0)
-- Rode este arquivo inteiro no Supabase: painel do projeto → SQL Editor → New query
-- → colar tudo → Run. Pode rodar mais de uma vez sem problema (idempotente).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Tabela de contagem de uso diário por cliente e por ferramenta.
--    Usada pelas Netlify Functions pagas (ia-edital, despesas-fornecedor,
--    sancoes) pra aplicar um limite diário por usuário e evitar que uma conta
--    comprometida ou um uso abusivo estoure a cota da Groq / do Portal da
--    Transparência sozinha. Ver netlify/functions/_auth.js.
-- ----------------------------------------------------------------------------
create table if not exists public.uso_diario (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  funcao text not null,
  dia date not null default current_date,
  contagem integer not null default 0,
  primary key (usuario_id, funcao, dia)
);

alter table public.uso_diario enable row level security;

-- Cada cliente só pode VER a própria contagem de uso (não escreve direto —
-- quem grava é a função incrementar_uso, rodando com privilégio de servidor).
drop policy if exists "uso_diario_select_proprio" on public.uso_diario;
create policy "uso_diario_select_proprio"
  on public.uso_diario for select
  using (auth.uid() = usuario_id);

-- ----------------------------------------------------------------------------
-- 2) Função que incrementa (ou cria) o contador do dia e devolve a nova
--    contagem. SECURITY DEFINER pra poder gravar mesmo com RLS ativado —
--    só é chamável com a service_role key (usada só no lado do servidor,
--    nunca no navegador). Ver SUPABASE_SERVICE_ROLE_KEY em _auth.js.
-- ----------------------------------------------------------------------------
create or replace function public.incrementar_uso(p_usuario_id uuid, p_funcao text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  nova_contagem integer;
begin
  insert into public.uso_diario (usuario_id, funcao, dia, contagem)
  values (p_usuario_id, p_funcao, current_date, 1)
  on conflict (usuario_id, funcao, dia)
  do update set contagem = public.uso_diario.contagem + 1
  returning contagem into nova_contagem;

  return nova_contagem;
end;
$$;

-- Revoga execução direta do público em geral e libera só pro service_role
-- (que é quem a Netlify Function usa) — assim ninguém no navegador consegue
-- chamar isso direto via REST com a chave anon.
revoke all on function public.incrementar_uso(uuid, text) from public;
grant execute on function public.incrementar_uso(uuid, text) to service_role;

-- ============================================================================
-- 3) RLS de "clientes" e "admins" — a parte mais importante deste arquivo.
--    Isto GARANTE que, mesmo com a chave anon (pública, exposta no
--    supabase-config.js do site), um cliente só enxerga a própria linha —
--    nunca a lista completa de assinantes, e-mails, telefones etc. de todo
--    mundo. Ver Achado #4 do Diagnóstico Técnico Crítico.
--
--    Ajuste os nomes de coluna abaixo (id, status) se o schema real do seu
--    projeto usar nomes diferentes — confira em Table Editor → clientes.
-- ============================================================================

alter table public.clientes enable row level security;

drop policy if exists "clientes_select_proprio" on public.clientes;
create policy "clientes_select_proprio"
  on public.clientes for select
  using (auth.uid() = id);

drop policy if exists "clientes_update_proprio" on public.clientes;
create policy "clientes_update_proprio"
  on public.clientes for update
  using (auth.uid() = id);

-- Ninguém deve poder criar/aprovar a própria linha de cliente direto pelo
-- navegador (isso teria que passar por cadastro.html + fluxo de aprovação do
-- admin). Se o fluxo de cadastro atual faz um INSERT direto do navegador com
-- a chave anon, mantenha uma policy de insert liberada só pro próprio uid;
-- caso contrário, não crie policy de insert (fica bloqueado por padrão).
drop policy if exists "clientes_insert_proprio" on public.clientes;
create policy "clientes_insert_proprio"
  on public.clientes for insert
  with check (auth.uid() = id);

-- "admins": só o próprio admin vê a própria linha. Nenhum cliente comum deve
-- conseguir listar quem são os admins do sistema.
alter table public.admins enable row level security;

drop policy if exists "admins_select_proprio" on public.admins;
create policy "admins_select_proprio"
  on public.admins for select
  using (auth.uid() = id);

-- ============================================================================
-- Fim. Depois de rodar, confirme em Authentication → Policies que "clientes"
-- e "admins" aparecem com RLS "Enabled" e as policies acima listadas.
-- ============================================================================
