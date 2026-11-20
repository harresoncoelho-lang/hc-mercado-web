-- Teste de seguranca_aprovacao_20261119.sql: os ataques A1, A2, B1, M1, M3, M4 e M5 do teste de 19/11 como asserts.
-- Dados fictícios e rollback (nada fica no banco). Papéis simulados com "set local role" + request.jwt.claim.sub;
-- não prova a API HTTP (essa prova é o roteiro de ataques contra o ambiente-teste local).
-- G e19..01 gestor (org inteira), O e19..02 operador restrito à empresa, P e19..03 pendente,
-- C e19..04 convidado (pendente, sem vínculo) que aceita convite.
begin;
insert into auth.users(id,email) values
 ('e1900000-0000-4000-8000-000000000001','seg-g@qa.invalid'),('e1900000-0000-4000-8000-000000000002','seg-o@qa.invalid'),
 ('e1900000-0000-4000-8000-000000000003','seg-p@qa.invalid'),('e1900000-0000-4000-8000-000000000004','seg-c@qa.invalid');
insert into public.clientes(id,nome,email,status) values
 ('e1900000-0000-4000-8000-000000000001','QA seg G','seg-g@qa.invalid','aprovado'),
 ('e1900000-0000-4000-8000-000000000002','QA seg O','seg-o@qa.invalid','aprovado'),
 ('e1900000-0000-4000-8000-000000000003','QA seg P','seg-p@qa.invalid','pendente'),
 ('e1900000-0000-4000-8000-000000000004','QA seg C','seg-c@qa.invalid','pendente');
insert into public.operacao_organizacoes(id,nome,owner_id) values
 ('e1900000-0000-4000-8000-00000000000a','QA seg org','e1900000-0000-4000-8000-000000000001');
insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values
 ('e1900000-0000-4000-8000-00000000001a','e1900000-0000-4000-8000-00000000000a','QA seg empresa','11222333000181');
insert into public.operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values
 ('e1900000-0000-4000-8000-00000000000a','e1900000-0000-4000-8000-000000000001','gestor',null),
 ('e1900000-0000-4000-8000-00000000000a','e1900000-0000-4000-8000-000000000002','operador','e1900000-0000-4000-8000-00000000001a');
insert into public.operacao_processos(id,organizacao_id,empresa_id,objeto) values
 ('e1900000-0000-4000-8000-0000000000b1','e1900000-0000-4000-8000-00000000000a','e1900000-0000-4000-8000-00000000001a','QA seg processo');
insert into public.operacao_perfil_empresa(empresa_id,organizacao_id,nome_fantasia,cpf_representante) values
 ('e1900000-0000-4000-8000-00000000001a','e1900000-0000-4000-8000-00000000000a','QA seg','52998224725');
insert into public.operacao_convites_empresa(id,organizacao_id,empresa_id,email,nome,token,criado_por) values
 ('e1900000-0000-4000-8000-0000000000c1','e1900000-0000-4000-8000-00000000000a','e1900000-0000-4000-8000-00000000001a',
  'seg-c@qa.invalid','QA seg C','e1900000-0000-4000-8000-0000000000c2','e1900000-0000-4000-8000-000000000001');
insert into public.dados_robo(chave,dado) values ('dashboard_mercado','{"qa":true}')
 on conflict (chave) do update set dado=excluded.dado;
update public.clientes set status='suspenso' where id='e1900000-0000-4000-8000-000000000002';

set local role authenticated;
-- A1: operador suspenso (tem empresa_id em operacao_membros) não se reaprova; pendente também não.
do $$
declare o uuid:='e1900000-0000-4000-8000-000000000002'; p uuid:='e1900000-0000-4000-8000-000000000003';
begin
 perform set_config('request.jwt.claim.sub',o::text,true);
 begin update public.clientes set status='aprovado' where id=o; raise exception 'A1: operador suspenso se reaprovou';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',p::text,true);
 begin update public.clientes set status='aprovado' where id=p; raise exception 'A1: pendente se aprovou';
 exception when insufficient_privilege then null; end;
 begin update public.clientes set aprovado_em=now(), aprovado_por='eu' where id=p; raise exception 'A1: pendente gravou aprovado_em';
 exception when insufficient_privilege then null; end;
 -- Perfil continua editável pela própria pessoa.
 update public.clientes set nome='QA seg P editado', boletim_filtro='{"uf":"AM"}' where id=p;
 if not found then raise exception 'A1: perfil do próprio cadastro deixou de ser editável'; end if;
end $$;
-- B1: aprovado não altera plano/observacoes_admin do próprio cadastro.
do $$
declare g uuid:='e1900000-0000-4000-8000-000000000001';
begin
 perform set_config('request.jwt.claim.sub',g::text,true);
 begin update public.clientes set plano='premium' where id=g; raise exception 'B1: plano alterado pelo próprio cliente';
 exception when insufficient_privilege then null; end;
 begin update public.clientes set observacoes_admin='x' where id=g; raise exception 'B1: observacoes_admin alterada';
 exception when insufficient_privilege then null; end;
end $$;
-- Convite: o aceite (security definer) continua aprovando quem foi convidado.
do $$
declare c uuid:='e1900000-0000-4000-8000-000000000004';
begin
 perform set_config('request.jwt.claim.sub',c::text,true);
 perform public.aceitar_convite_empresa_operacao('e1900000-0000-4000-8000-0000000000c2');
 if (select status from public.clientes where id=c) is distinct from 'aprovado' then raise exception 'Convite aceito não aprovou o cadastro'; end if;
 if not public.pode_acessar_empresa_operacao('e1900000-0000-4000-8000-00000000000a','e1900000-0000-4000-8000-00000000001a')
 then raise exception 'Convidado aprovado sem acesso à empresa'; end if;
end $$;

-- A2: operador suspenso não lê nem grava o CRM nem o Storage; gestor aprovado sim, e perde ao ser suspenso.
do $$
declare o uuid:='e1900000-0000-4000-8000-000000000002'; g uuid:='e1900000-0000-4000-8000-000000000001';
 org uuid:='e1900000-0000-4000-8000-00000000000a'; emp uuid:='e1900000-0000-4000-8000-00000000001a'; n int;
begin
 perform set_config('request.jwt.claim.sub',o::text,true);
 if exists(select 1 from public.operacao_processos where organizacao_id=org) then raise exception 'A2: suspenso leu processos'; end if;
 if public.pode_acessar_empresa_operacao(org,emp) or public.pode_escrever_empresa_operacao(org,emp)
  or public.tem_vinculo_operacao(org) or public.acesso_arquivo_operacao(org||'/'||emp||'/x.pdf')
  or public.escrita_arquivo_operacao(org||'/'||emp||'/x.pdf') then raise exception 'A2: suspenso ainda tem acesso pelas funções'; end if;
 update public.operacao_processos set observacoes='atk' where organizacao_id=org; get diagnostics n=row_count;
 if n<>0 then raise exception 'A2: suspenso gravou processo'; end if;
 perform set_config('request.jwt.claim.sub',g::text,true);
 if public.identificacao_empresa_habilitada() is not true then raise exception 'A2: gate da identificação fechou com as funções novas'; end if;
 if not exists(select 1 from public.operacao_processos where organizacao_id=org) or not public.eh_membro_operacao(org)
  or not public.pode_escrever_org_operacao(org) then raise exception 'A2: gestor aprovado perdeu acesso'; end if;
end $$;
reset role;
update public.clientes set status='suspenso' where id='e1900000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
 perform set_config('request.jwt.claim.sub','e1900000-0000-4000-8000-000000000001',true);
 if exists(select 1 from public.operacao_processos where organizacao_id='e1900000-0000-4000-8000-00000000000a')
  or public.eh_membro_operacao('e1900000-0000-4000-8000-00000000000a') then raise exception 'A2: gestor suspenso ainda lê'; end if;
 if exists(select 1 from public.operacao_organizacoes where id='e1900000-0000-4000-8000-00000000000a' and public.eh_membro_operacao(id))
  then raise exception 'A2: gestor suspenso vê a organização como membro'; end if;
end $$;
reset role;
update public.clientes set status='aprovado' where id='e1900000-0000-4000-8000-000000000001';

-- M1: toda policy de SELECT das bases pagas exige cliente_aprovado() e vale só para authenticated.
do $$
declare r record;
begin
 for r in select tablename, policyname, qual, roles from pg_policies where schemaname='public' and cmd='SELECT'
  and tablename in ('pregoes_gravados','pregoes_gravados_propostas','pregoes_gravados_mensagens','oportunidades_abertas',
   'dossies_editais','sancoes_empresas','contratos','mercado_atas','comprasgov_resultados','dados_robo',
   'empresas_cadastro','historico_contratos_fornecedor','extensao_diagnosticos') loop
  if r.qual not like '%cliente_aprovado()%' or r.roles <> '{authenticated}'::name[] then
   raise exception 'M1: policy %.% sem cliente_aprovado/authenticated: % %', r.tablename, r.policyname, r.roles, r.qual; end if;
 end loop;
 -- extensao_diagnosticos: só service_role (nem policy nem grant para o navegador).
 if to_regclass('public.extensao_diagnosticos') is not null and (has_table_privilege('authenticated','public.extensao_diagnosticos','select')
  or has_table_privilege('anon','public.extensao_diagnosticos','select')) then raise exception 'M1: extensao_diagnosticos legível pelo navegador'; end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and (p.proname='resumo_inteligencia_mercado' or p.proname like 'dashboard\_%') and has_function_privilege('anon',p.oid,'execute'))
 then raise exception 'M1: anon executa RPC do painel'; end if;
end $$;
set local role authenticated;
do $$ begin
 perform set_config('request.jwt.claim.sub','e1900000-0000-4000-8000-000000000003',true);
 if exists(select 1 from public.dados_robo) or exists(select 1 from public.pregoes_gravados) or exists(select 1 from public.sancoes_empresas)
 then raise exception 'M1: pendente leu base paga'; end if;
 perform set_config('request.jwt.claim.sub','e1900000-0000-4000-8000-000000000001',true);
 if not exists(select 1 from public.dados_robo where chave='dashboard_mercado') then raise exception 'M1: aprovado deixou de ler dados_robo'; end if;
end $$;

-- M3: o navegador não lê cpf_representante (nem gestor); lê o resto e continua gravando o CPF.
do $$
declare emp uuid:='e1900000-0000-4000-8000-00000000001a';
begin
 perform set_config('request.jwt.claim.sub','e1900000-0000-4000-8000-000000000001',true);
 begin perform cpf_representante from public.operacao_perfil_empresa where empresa_id=emp; raise exception 'M3: CPF legível pelo PostgREST';
 exception when insufficient_privilege then null; end;
 begin perform 1 from (select * from public.operacao_perfil_empresa) x; raise exception 'M3: select * devolveu o CPF';
 exception when insufficient_privilege then null; end;
 if (select nome_fantasia from public.operacao_perfil_empresa where empresa_id=emp) is distinct from 'QA seg' then raise exception 'M3: gestor não lê o perfil'; end if;
 update public.operacao_perfil_empresa set cpf_representante='11144477735' where empresa_id=emp;
 if not found then raise exception 'M3: gestor deixou de gravar o CPF'; end if;
end $$;
reset role;
do $$ begin
 if (select cpf_representante from public.operacao_perfil_empresa where empresa_id='e1900000-0000-4000-8000-00000000001a') <> '11144477735'
 then raise exception 'M3: CPF gravado não confere'; end if;
 if has_column_privilege('authenticated','public.operacao_perfil_empresa','cpf_representante','select')
  or not has_column_privilege('authenticated','public.operacao_perfil_empresa','cpf_representante','update')
 then raise exception 'M3: privilégios de coluna errados'; end if;
end $$;

-- M4: limite de tipo e tamanho no bucket (onde o Storage tem as colunas; o stub do ensaio PGlite não tem).
do $$
declare ok boolean;
begin
 if exists(select 1 from information_schema.columns where table_schema='storage' and table_name='buckets' and column_name='allowed_mime_types') then
  execute $q$select file_size_limit=15728640 and 'application/pdf'=any(allowed_mime_types) and not 'text/html'=any(allowed_mime_types)
   and not 'image/svg+xml'=any(allowed_mime_types) from storage.buckets where id='operacao-documentos'$q$ into ok;
  if ok is not true then raise exception 'M4: bucket operacao-documentos sem limite de tipo/tamanho'; end if;
 end if;
end $$;

-- M5: contador por IP só pela chave de serviço.
do $$ begin
 if has_function_privilege('anon','public.incrementar_uso_ip(text,text)','execute')
  or has_function_privilege('authenticated','public.incrementar_uso_ip(text,text)','execute')
  or has_table_privilege('anon','public.uso_ip_diario','select') or has_table_privilege('authenticated','public.uso_ip_diario','select')
 then raise exception 'M5: contador por IP aberto ao navegador'; end if;
end $$;
set local role service_role;
do $$ begin
 if public.incrementar_uso_ip(repeat('a',64),'qa')<>1 or public.incrementar_uso_ip(repeat('a',64),'qa')<>2 then raise exception 'M5: contagem por IP errada'; end if;
 begin perform public.incrementar_uso_ip('1.2.3.4','qa'); raise exception 'M5: IP puro aceito como chave';
 exception when check_violation then null; end;
end $$;
reset role;
rollback;
