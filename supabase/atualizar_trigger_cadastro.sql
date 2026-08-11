-- ============================================================================
-- LicitaPlena — atualização do trigger que cria a linha em public.clientes
-- quando alguém se cadastra (cadastro.html -> sb.auth.signUp()).
--
-- Adiciona os campos novos coletados no cadastro (atividades, abrangência de
-- interesse por estado e as 5 perguntas de perfil), copiando-os de
-- raw_user_meta_data pro mesmo jeito que já era feito com nome/empresa/cnpj/
-- etc. Ver cadastro.html (options.data do signUp) e
-- supabase/adicionar_perfil_cliente.sql (colunas correspondentes em clientes).
--
-- Já foi rodado manualmente no Supabase (SQL Editor) — este arquivo só
-- versiona o texto final da função pra ficar documentado no repo. Se precisar
-- reaplicar, é só rodar de novo (CREATE OR REPLACE é idempotente).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.criar_cliente_no_cadastro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  insert into public.clientes (
    id, nome, empresa, cnpj, telefone, email, segmento, cargo, porte_empresa,
    aceite_termos, aceite_termos_em,
    atividades, estados_interesse, como_conheceu, quantidade_funcionarios,
    licitacoes_por_mes, faturamento_anual, como_pretende_usar
  ) values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', ''),
    new.raw_user_meta_data->>'empresa',
    new.raw_user_meta_data->>'cnpj',
    new.raw_user_meta_data->>'telefone',
    new.email,
    new.raw_user_meta_data->>'segmento',
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
    new.raw_user_meta_data->>'como_pretende_usar'
  );
  return new;
end;
$function$;
