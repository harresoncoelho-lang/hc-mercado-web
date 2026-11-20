-- Segurança do status do cadastro (teste de ataque local de 19/11/2026: A1, A2, M1, M3, M4, M5 e B1).
-- Idempotente: seguro rodar mais de uma vez no SQL Editor do Supabase. Não apaga dados.
-- Rodar DEPOIS de todos os outros .sql (acesso_empresa_convites, seguranca_operacao, pregoes_gravados,
-- operacao_perfil_empresa, painel_*...): este arquivo redefine funções e policies que eles criam. Se um deles
-- for rodado de novo, rode este outra vez em seguida.
-- Teste: supabase/testar_seguranca_aprovacao.sql.
begin;

-- Mesmo corpo de historico_licitacoes.sql / prospeccao.sql / sinapi.sql (redefinido para este arquivo não depender da ordem).
create or replace function public.cliente_aprovado() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clientes c where c.id = (select auth.uid()) and c.status = 'aprovado')
$$;
revoke all on function public.cliente_aprovado() from public, anon;
grant execute on function public.cliente_aprovado() to authenticated, service_role;

-- Quem aprova cadastros: owner administrativo ou, em produção, admin_tem_permissao('aprovar_cadastros') com MFA
-- (a mesma regra da policy admin_atualiza_qualquer_registro de clientes, que não tem .sql no repositório).
create or replace function public.pode_aprovar_cadastros() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v boolean := false;
begin
  if auth.uid() is null then return false; end if;
  if public.eh_owner_admin_operacao(auth.uid()) then return true; end if;
  if to_regprocedure('public.admin_tem_permissao(text)') is not null then
    execute $q$select public.admin_tem_permissao('aprovar_cadastros') and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'$q$ into v;
  end if;
  return coalesce(v, false);
end $$;
revoke all on function public.pode_aprovar_cadastros() from public, anon;
grant execute on function public.pode_aprovar_cadastros() to authenticated, service_role;

-- A1/B1: pelo PostgREST (papel authenticated) a pessoa só muda o PERFIL do próprio cadastro. status, plano,
-- aprovado_em, aprovado_por e observacoes_admin só mudam por quem aprova cadastros ou por função security definer
-- (aceitar_convite_empresa_operacao, criar_cliente_no_cadastro), que roda como dono e por isso tem current_user
-- diferente de authenticated. Antes havia exceção para quem tinha operacao_membros.empresa_id: o operador
-- suspenso se reaprovava. GRANT por coluna não serve aqui: o admin.html aprova pelo mesmo papel authenticated.
create or replace function public.proteger_status_cliente_operacao()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if auth.uid() is distinct from new.id or public.pode_aprovar_cadastros() then return new; end if;
  if tg_op = 'INSERT' then
    if coalesce(new.status, 'pendente') <> 'pendente' or new.plano is not null or new.aprovado_em is not null
      or new.aprovado_por is not null or new.observacoes_admin is not null then
      raise exception 'A aprovação do cadastro depende do administrador' using errcode = '42501';
    end if;
  elsif (new.status, new.plano, new.aprovado_em, new.aprovado_por, new.observacoes_admin)
    is distinct from (old.status, old.plano, old.aprovado_em, old.aprovado_por, old.observacoes_admin) then
    raise exception 'A aprovação do cadastro depende do administrador' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists proteger_status_cliente_operacao on public.clientes;
create trigger proteger_status_cliente_operacao before insert or update on public.clientes
  for each row execute function public.proteger_status_cliente_operacao();

-- A2: toda a RLS e o Storage do CRM passam por estas funções; agora exigem cadastro aprovado.
-- Corpos iguais aos de acesso_empresa_convites.sql e seguranca_operacao.sql + "and public.cliente_aprovado()".
-- pode_acessar_processo_operacao, acesso_arquivo_operacao, pode_escrever_processo_operacao e
-- escrita_arquivo_operacao chamam estas e herdam a checagem.
create or replace function public.eh_membro_operacao(p_organizacao_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.cliente_aprovado() and exists (select 1 from public.operacao_membros m
    where m.organizacao_id = p_organizacao_id and m.usuario_id = auth.uid()
      and m.empresa_id is null);
$$;
create or replace function public.tem_vinculo_operacao(p_organizacao_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.cliente_aprovado() and exists (select 1 from public.operacao_membros m
    where m.organizacao_id = p_organizacao_id and m.usuario_id = auth.uid());
$$;
create or replace function public.pode_acessar_empresa_operacao(p_org uuid, p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.cliente_aprovado() and exists (select 1 from public.operacao_empresas e
    join public.operacao_membros m on m.organizacao_id = e.organizacao_id
    where e.id = p_empresa and e.organizacao_id = p_org and m.usuario_id = auth.uid()
      and (m.empresa_id is null or m.empresa_id = e.id));
$$;
create or replace function public.pode_escrever_org_operacao(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select public.cliente_aprovado() and exists(select 1 from public.operacao_membros m where m.organizacao_id=p_org
  and m.usuario_id=auth.uid() and m.empresa_id is null and m.papel in ('gestor','operador'));
$$;
create or replace function public.pode_escrever_empresa_operacao(p_org uuid,p_empresa uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select public.cliente_aprovado() and exists(select 1 from public.operacao_empresas e join public.operacao_membros m on m.organizacao_id=e.organizacao_id
  where e.id=p_empresa and e.organizacao_id=p_org and m.usuario_id=auth.uid()
  and m.papel in ('gestor','operador') and (m.empresa_id is null or m.empresa_id=e.id));
$$;
revoke all on function public.eh_membro_operacao(uuid), public.tem_vinculo_operacao(uuid),
  public.pode_acessar_empresa_operacao(uuid,uuid), public.pode_escrever_org_operacao(uuid),
  public.pode_escrever_empresa_operacao(uuid,uuid) from public, anon;
grant execute on function public.eh_membro_operacao(uuid), public.tem_vinculo_operacao(uuid),
  public.pode_acessar_empresa_operacao(uuid,uuid), public.pode_escrever_org_operacao(uuid),
  public.pode_escrever_empresa_operacao(uuid,uuid) to authenticated;

-- O gate do servidor (identificacao_empresa_habilitada, seguranca_operacao.sql) fixa o md5 do corpo destas funções:
-- mesmo texto de lá, só com os hashes dos dois corpos novos acima. Sem isso a identificação da empresa fecharia (503).
create or replace function public.identificacao_empresa_habilitada()
returns boolean language sql stable security definer set search_path = public as $$
 with esperado(tabela,nome,comando,qual,checagem) as (values
 ('operacao_empresas','operacao_empresas_leitura','SELECT','pode_acessar_empresa_operacao(organizacao_id, id)',null),
 ('operacao_empresas','operacao_empresas_escrita','ALL','pode_escrever_org_operacao(organizacao_id)','pode_escrever_org_operacao(organizacao_id)'),
 ('operacao_documentos','operacao_documentos_da_empresa','SELECT','pode_acessar_empresa_operacao(organizacao_id, empresa_id)',null),
 ('operacao_documentos','operacao_documentos_da_empresa_escrita','ALL','pode_escrever_empresa_operacao(organizacao_id, empresa_id)','(pode_escrever_empresa_operacao(organizacao_id, empresa_id) AND arquivo_no_escopo_operacao(arquivo_caminho, organizacao_id, empresa_id))'),
 ('objects','operacao_arquivos_leitura','SELECT','((bucket_id = ''operacao-documentos''::text) AND acesso_arquivo_operacao(name))',null),
 ('objects','operacao_arquivos_envio','INSERT',null,'((bucket_id = ''operacao-documentos''::text) AND escrita_arquivo_operacao(name))'),
 ('objects','operacao_arquivos_atualizacao','UPDATE','((bucket_id = ''operacao-documentos''::text) AND escrita_arquivo_operacao(name))','((bucket_id = ''operacao-documentos''::text) AND escrita_arquivo_operacao(name))'),
 ('objects','operacao_arquivos_exclusao','DELETE','((bucket_id = ''operacao-documentos''::text) AND escrita_arquivo_operacao(name))',null)
 ), atual as (select * from pg_policies where (schemaname='public' and tablename in ('operacao_documentos','operacao_empresas')) or (schemaname='storage' and tablename='objects'))
 select auth.uid() is not null
 and exists(select 1 from storage.buckets where id='operacao-documentos' and public=false)
 and exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='storage' and c.relname='objects' and c.relrowsecurity)
 and (select count(*)=3 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('operacao_empresas','operacao_documentos','operacao_identificacao_empresa') and c.relrowsecurity)
 and not exists(select 1 from esperado e full join atual a on a.tablename=e.tabela and a.policyname=e.nome
  where e.nome is null or a.policyname is null or a.cmd<>e.comando or a.permissive<>'PERMISSIVE'
   or a.qual is distinct from e.qual or a.with_check is distinct from e.checagem
   or a.roles is distinct from case when e.nome in ('operacao_empresas_leitura','operacao_arquivos_leitura') then array['public']::name[] else array['authenticated']::name[] end)
 and not exists(select 1 from (values
 ('pode_escrever_org_operacao','2fd046964d53ddcf911e544620be10f5'),
 ('pode_escrever_empresa_operacao','af9e82d298241750c0fd69fa06799ad3'),
 ('pode_escrever_processo_operacao','7de47c8d343558a2dc2180ad2a4daffc'),
 ('arquivo_no_escopo_operacao','c727f040598b92b257a5322118447d6f'),
 ('escrita_arquivo_operacao','d95ab917f9d1faf6270e16d85dda42fd')
 ) as f(nome,hash) where not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=f.nome and md5(replace(p.prosrc,chr(13),''))=f.hash));
$$;
revoke all on function public.identificacao_empresa_habilitada() from public,anon;
grant execute on function public.identificacao_empresa_habilitada() to authenticated;

-- M1: bases pagas só para cadastro aprovado. A busca pública da landing (busca-publica, convenios-publico) lê com
-- a chave de serviço e não depende destas policies. Cada policy de SELECT existente (os nomes de produção podem
-- diferir dos do repositório) passa a ser "to authenticated" e ganha "cliente_aprovado() and (<condição antiga>)".
-- dados_robo: o admin.html lê config_admin; quem aprova cadastros continua lendo mesmo sem linha em clientes.
do $$
declare t text; p record; cond text;
begin
  foreach t in array array['pregoes_gravados', 'pregoes_gravados_propostas', 'pregoes_gravados_mensagens',
    'oportunidades_abertas', 'dossies_editais', 'sancoes_empresas', 'contratos', 'mercado_atas',
    'comprasgov_resultados', 'dados_robo', 'empresas_cadastro', 'historico_contratos_fornecedor', 'extensao_diagnosticos'] loop
    continue when to_regclass('public.' || t) is null;
    cond := case when t = 'dados_robo' then '(public.cliente_aprovado() or public.pode_aprovar_cadastros())'
      else 'public.cliente_aprovado()' end;
    for p in select policyname, qual from pg_policies
      where schemaname = 'public' and tablename = t and cmd = 'SELECT' and permissive = 'PERMISSIVE' loop
      continue when p.qual like '%cliente_aprovado()%';
      execute format('alter policy %I on public.%I to authenticated using (%s and (%s))', p.policyname, t, cond, p.qual);
    end loop;
  end loop;
end $$;
-- RPCs do painel: as dashboard_* são invoker (a RLS de contratos acima já zera para o pendente);
-- resumo_inteligencia_mercado também é invoker, mas estava executável por anon.
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname = 'resumo_inteligencia_mercado' or p.proname like 'dashboard\_%') loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- M3: CPF do representante fora do alcance do navegador. authenticated lê todas as colunas do perfil menos
-- cpf_representante; grava a coluna normalmente (INSERT/UPDATE intactos). O servidor (empresa-identificacao.js,
-- kit-documentos.js) confere o papel com o token do usuário e lê o CPF com a chave de serviço: mascarado para o
-- operador, completo para o gestor que pede e para a exportação das declarações.
do $$
declare cols text;
begin
  if to_regclass('public.operacao_perfil_empresa') is null then return; end if;
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
    where table_schema = 'public' and table_name = 'operacao_perfil_empresa' and column_name <> 'cpf_representante';
  revoke select on public.operacao_perfil_empresa from authenticated;
  revoke select (cpf_representante) on public.operacao_perfil_empresa from authenticated;
  execute format('grant select (%s) on public.operacao_perfil_empresa to authenticated', cols);
end $$;

-- M4: tipo e tamanho no bucket privado (vale também para o upload direto do navegador). Tipos que as telas enviam:
-- documentos e anexos (PDF, Word, Excel, imagem), logo e foto do catálogo (PNG/JPEG). 15 MiB por arquivo.
do $$
begin
  if exists (select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    update storage.buckets set file_size_limit = 15728640, allowed_mime_types = array[
      'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet']
    where id = 'operacao-documentos';
  end if;
end $$;

-- M5: teto diário por IP dos proxies públicos (pncp-*, comprasgov-*), que o painel chama sem token.
-- chave = HMAC-SHA256 do IP feito no servidor (nunca o IP puro). Guarda só ontem e hoje (minimização, LGPD).
create table if not exists public.uso_ip_diario (
  chave text not null check (chave ~ '^[0-9a-f]{64}$'),
  funcao text not null check (length(funcao) between 1 and 60),
  dia date not null default current_date,
  contagem integer not null default 0,
  primary key (chave, funcao, dia)
);
alter table public.uso_ip_diario enable row level security;
revoke all on public.uso_ip_diario from public, anon, authenticated;
create or replace function public.incrementar_uso_ip(p_chave text, p_funcao text)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.uso_ip_diario (chave, funcao, dia, contagem) values (p_chave, p_funcao, current_date, 1)
  on conflict (chave, funcao, dia) do update set contagem = public.uso_ip_diario.contagem + 1
  returning contagem into n;
  if random() < 0.01 then delete from public.uso_ip_diario where dia < current_date - 1; end if;
  return n;
end $$;
revoke all on function public.incrementar_uso_ip(text, text) from public, anon, authenticated;
grant execute on function public.incrementar_uso_ip(text, text) to service_role;

notify pgrst, 'reload schema';
commit;
