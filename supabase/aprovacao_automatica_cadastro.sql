-- ============================================================================
-- LicitaPlena — aprovação automática de cadastros (opcional, controlada pelo
-- painel de admin). Rode este arquivo inteiro no Supabase: painel do projeto
-- → SQL Editor → New query → colar tudo → Run. Idempotente, pode rodar mais
-- de uma vez sem problema.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Registro de configuração em public.dados_robo (mesma tabela chave→jsonb
--    já usada pelo histórico do boletim - ver scripts/boletim_editais.py e
--    scripts/supabase_dados.js). A RLS dessa tabela já libera select pra
--    qualquer usuário autenticado e insert/update/delete pra qualquer admin
--    (policies "dados_robo_select_authenticated" e "dados_robo_write_admin"),
--    entao nao precisa de policy nova so pra guardar essa chave.
--
--    Se o registro nao existir (ou "aprovacao_automatica" nao estiver
--    presente), o padrao e false - ou seja, comportamento atual (aprovacao
--    manual) continua sendo o default ate o admin ligar explicitamente.
-- ----------------------------------------------------------------------------
insert into public.dados_robo (chave, dado)
values ('config_admin', jsonb_build_object('aprovacao_automatica', false))
on conflict (chave) do nothing;

-- ----------------------------------------------------------------------------
-- 2) Trigger de cadastro (public.criar_cliente_no_cadastro) passa a checar
--    essa chave: se "aprovacao_automatica" estiver true, o cliente ja entra
--    com status "aprovado" (sem precisar do admin clicar em Aprovar); senao,
--    continua caindo no default da coluna ("pendente"), igual sempre foi.
--    SECURITY DEFINER (já era) - roda com privilegio de dono da funcao, entao
--    a leitura de dados_robo aqui nao esbarra em RLS.
-- ----------------------------------------------------------------------------
create or replace function public.criar_cliente_no_cadastro()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  aprovacao_automatica boolean;
begin
  select coalesce((dado->>'aprovacao_automatica')::boolean, false)
    into aprovacao_automatica
    from public.dados_robo
    where chave = 'config_admin';

  insert into public.clientes (
    id, nome, empresa, cnpj, telefone, email, segmento, cargo, porte_empresa,
    aceite_termos, aceite_termos_em,
    atividades, estados_interesse, como_conheceu, quantidade_funcionarios,
    licitacoes_por_mes, faturamento_anual, como_pretende_usar,
    status, aprovado_em, aprovado_por
  ) values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', ''),
    new.raw_user_meta_data->>'empresa',
    new.raw_user_meta_data->>'cnpj',
    new.raw_user_meta_data->>'telefone',
    new.email,
    coalesce(new.raw_user_meta_data->'segmento', '[]'::jsonb),
    new.raw_user_meta_data->>'cargo',
    new.raw_user_meta_data->>'porte_empresa',
    coalesce((new.raw_user_meta_data->>'aceite_termos')::boolean, false),
    case when (new.raw_user_meta_data->>'aceite_termos') = 'true' then now() else null end,
    new.raw_user_meta_data->>'atividades',
    coalesce(new.raw_user_meta_data->'estados_interesse', '[]'::jsonb),
    new.raw_user_meta_data->>'como_conheceu',
    new.raw_user_meta_data->>'quantidade_funcionarios',
    new.raw_user_meta_data->>'licitacoes_por_mes',
    new.raw_user_meta_data->>'faturamento_anual',
    new.raw_user_meta_data->>'como_pretende_usar',
    case when aprovacao_automatica then 'aprovado' else 'pendente' end,
    case when aprovacao_automatica then now() else null end,
    case when aprovacao_automatica then 'automatico' else null end
  );
  return new;
end;
$$;

-- ============================================================================
-- Fim. Confirme em Table Editor → dados_robo que a linha "config_admin"
-- existe, e teste um cadastro novo com a chave ligada/desligada.
-- ============================================================================
