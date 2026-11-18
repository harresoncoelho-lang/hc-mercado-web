-- ENSAIO PREPARADO, NÃO EXECUTADO. Requer fixtures QA existentes; não cria Auth.
begin;
set local statement_timeout='60s';
set local lock_timeout='5s';
-- O SQL não identifica o project-ref. Após conferir a conexão externamente,
-- substituir APENAS este marcador pelo ref QA; sem isso o ensaio aborta.
set local app.qa_project_ref='CONFIRMAR_QA_EXTERNAMENTE';
do $guard$
begin
 if current_setting('app.qa_project_ref',true) is distinct from 'luguscapasskcsficckf'
 or current_database()<>'postgres' or current_user<>'postgres'
 then raise exception 'Destino QA não confirmado';end if;
 if not exists(select 1 from pg_class where oid='public.operacao_anexo_versoes'::regclass and relrowsecurity)
 or exists(select 1 from pg_roles where rolname='authenticated' and (rolsuper or rolbypassrls))
 then raise exception 'RLS/role incompatível com ensaio';end if;
end $guard$;
create temporary table qa_anexo_rls(lado text primary key,usuario uuid,empresa uuid,processo uuid,org uuid,anexo uuid,caminho text) on commit drop;
-- Grant somente na tabela temporária de IDs sintéticos, revertido com o ensaio.
grant select on qa_anexo_rls to authenticated;
do $$
declare u uuid;e uuid;p uuid;a uuid;org uuid;r jsonb;negado boolean:=false;path text;
begin
 select c.id into u from public.clientes c where c.email='operador-a@qa.invalid' and c.status='aprovado';
 e:='a1000000-0000-4000-8000-000000000002';p:='a1000000-0000-4000-8000-000000000003';org:='a1000000-0000-4000-8000-000000000001';
 if u is null or not exists(select 1 from public.operacao_processos where id=p and empresa_id=e) then raise exception 'Fixtures QA ausentes; parar';end if;
 a:=gen_random_uuid();path:=org::text||'/'||e::text||'/'||p::text||'/fixture-evidencia.pdf';
 insert into qa_anexo_rls values('A',u,e,p,org,a,path);
 insert into public.operacao_anexos_processo(id,organizacao_id,processo_id,tipo,titulo,arquivo_caminho,arquivo_nome) values(a,org,p,'edital','FICTÍCIO',path,'fixture-evidencia.pdf');
 r:=public.registrar_evidencia_anexo(u,a,e,path,repeat('a',64),'anexo-pdf-1','[{"pagina":1,"texto":"Conteúdo fictício, sem consulta externa."}]');
 r:=public.selecionar_versao_anexo(u,a,e,path,repeat('a',64));if (r->>'selecionada')::boolean is not true then raise exception 'Seleção falhou';end if;
 r:=public.registrar_evidencia_anexo(u,a,e,path,repeat('b',64),'anexo-pdf-1','[{"pagina":1,"texto":"Versão fictícia alterada."}]');
 if exists(select 1 from public.operacao_anexo_versoes where anexo_id=a and selecionada) then raise exception 'Versão antiga continuou selecionada';end if;
 begin perform public.selecionar_versao_anexo(u,a,'b1000000-0000-4000-8000-000000000002',path,repeat('b',64));exception when insufficient_privilege then negado:=true;end;
 if not negado then raise exception 'Cross empresa não negado';end if;
 if has_function_privilege('authenticated','public.registrar_evidencia_anexo(uuid,uuid,uuid,text,text,text,jsonb)','EXECUTE') then raise exception 'Escrita forjável por browser';end if;
end $$;

-- Segunda fixture usa a conta/empresa B existentes; não cria Auth nem Storage.
do $fixtures$
declare u uuid;a uuid:=gen_random_uuid();caminho text;
begin
 select id into u from auth.users where id='c29e43cf-9d01-4171-bcd3-3fadf0e99fde' and email='operador-b@qa.invalid' and email_confirmed_at is not null;
 if u is null or not exists(select 1 from auth.users where id=(select usuario from qa_anexo_rls where lado='A') and id='258eddfe-d761-4ec9-ae63-ee5e5b8db408' and email='operador-a@qa.invalid' and email_confirmed_at is not null)
 then raise exception 'Handoff A/B divergiu';end if;
 caminho:='b1000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000002/b1000000-0000-4000-8000-000000000003/fixture-evidencia.pdf';
 insert into qa_anexo_rls values('B',u,'b1000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000003','b1000000-0000-4000-8000-000000000001',a,caminho);
 if exists(select 1 from qa_anexo_rls q where not exists(select 1 from public.clientes c where c.id=q.usuario and c.status='aprovado')
 or not exists(select 1 from public.operacao_membros m where m.usuario_id=q.usuario and m.organizacao_id=q.org and m.empresa_id=q.empresa and m.papel='operador')
 or not exists(select 1 from public.operacao_processos p join public.operacao_empresas e on e.id=p.empresa_id and e.organizacao_id=p.organizacao_id where p.id=q.processo and p.empresa_id=q.empresa and p.organizacao_id=q.org and e.ativo))
 then raise exception 'Fixtures A/B fora da baseline esperada';end if;
 insert into public.operacao_anexos_processo(id,organizacao_id,processo_id,tipo,titulo,arquivo_caminho,arquivo_nome)
 select anexo,org,processo,'edital','FICTÍCIO B',caminho,'fixture-evidencia.pdf' from qa_anexo_rls where lado='B';
 perform public.registrar_evidencia_anexo(u,a,'b1000000-0000-4000-8000-000000000002',caminho,repeat('c',64),'anexo-pdf-1','[{"pagina":1,"texto":"Evidência fictícia B, sem arquivo Storage."}]');
end $fixtures$;

-- Claims definidos pelo executor QA; não é validação de JWT/HTTP.
select set_config('request.jwt.claim.sub',(select usuario::text from qa_anexo_rls where lado='A'),true),
 set_config('request.jwt.claims',jsonb_build_object('sub',(select usuario from qa_anexo_rls where lado='A'),'role','authenticated')::text,true);
set local role authenticated;
do $a$
begin
 if current_user<>'authenticated' or auth.uid() is distinct from (select usuario from qa_anexo_rls where lado='A') then raise exception 'Role/claims A não ativos';end if;
 if (select count(*) from public.operacao_anexo_versoes where anexo_id=(select anexo from qa_anexo_rls where lado='A'))<>2
 or exists(select 1 from public.operacao_anexo_versoes where anexo_id=(select anexo from qa_anexo_rls where lado='B')) then raise exception 'RLS A própria/cruzada falhou';end if;
end $a$;
reset role;
select set_config('request.jwt.claim.sub',(select usuario::text from qa_anexo_rls where lado='B'),true),
 set_config('request.jwt.claims',jsonb_build_object('sub',(select usuario from qa_anexo_rls where lado='B'),'role','authenticated')::text,true);
set local role authenticated;
do $b$
begin
 if current_user<>'authenticated' or auth.uid() is distinct from (select usuario from qa_anexo_rls where lado='B') then raise exception 'Role/claims B não ativos';end if;
 if (select count(*) from public.operacao_anexo_versoes where anexo_id=(select anexo from qa_anexo_rls where lado='B'))<>1
 or exists(select 1 from public.operacao_anexo_versoes where anexo_id=(select anexo from qa_anexo_rls where lado='A')) then raise exception 'RLS B própria/cruzada falhou';end if;
end $b$;
reset role;

-- Papel leitura ainda lê sua evidência, mas não executa nenhuma RPC de escrita.
update public.operacao_membros set papel='leitura' where (usuario_id,organizacao_id) in(select usuario,org from qa_anexo_rls where lado='A');
select set_config('request.jwt.claim.sub',(select usuario::text from qa_anexo_rls where lado='A'),true),
 set_config('request.jwt.claims',jsonb_build_object('sub',(select usuario from qa_anexo_rls where lado='A'),'role','authenticated')::text,true);
set local role authenticated;
do $leitura$
declare q record;negado boolean;
begin
 select * into q from qa_anexo_rls where lado='A';
 if (select count(*) from public.operacao_anexo_versoes where anexo_id=q.anexo)<>2 then raise exception 'Papel leitura não lê evidência própria';end if;
 negado:=false;
 begin perform public.registrar_evidencia_anexo(q.usuario,q.anexo,q.empresa,q.caminho,repeat('d',64),'anexo-pdf-1','[{"pagina":1,"texto":"Não deve gravar"}]');exception when insufficient_privilege then negado:=true;end;
 if not negado then raise exception 'Authenticated executou registro';end if;
 negado:=false;
 begin perform public.selecionar_versao_anexo(q.usuario,q.anexo,q.empresa,q.caminho,repeat('b',64));exception when insufficient_privilege then negado:=true;end;
 if not negado then raise exception 'Authenticated executou seleção';end if;
end $leitura$;
reset role;

-- Revogação do vínculo, seguida de restauração transitória para testar empresa inativa.
savepoint qa_vinculo;
delete from public.operacao_membros where (usuario_id,organizacao_id) in(select usuario,org from qa_anexo_rls where lado='A');
set local role authenticated;
do $revogado$ begin
 if exists(select 1 from public.operacao_anexo_versoes where anexo_id in(select anexo from qa_anexo_rls)) then raise exception 'Vínculo revogado ainda lê evidência';end if;
end $revogado$;
reset role;
rollback to savepoint qa_vinculo;
release savepoint qa_vinculo;
update public.operacao_empresas set ativo=false where id=(select empresa from qa_anexo_rls where lado='A');
set local role authenticated;
do $inativa$ begin
 if exists(select 1 from public.operacao_anexo_versoes where anexo_id in(select anexo from qa_anexo_rls)) then raise exception 'Empresa inativa ainda lê evidência';end if;
end $inativa$;
reset role;
-- Limpa claims antes de concluir; ROLLBACK restaura membros, empresas e fixtures.
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);
select 'ANEXOS_RLS_QA_GATES_OK_ROLLBACK_OBRIGATORIO' as status;
rollback;
