-- PREPARADO, NÃO EXECUTADO EM PRODUÇÃO. Clone isolado ou PGlite com 01-aplicar.sql e
-- operacao_exigencias.sql aplicados. Fixtures sintéticas e rollback.
-- RLS simulada com "set local role" + request.jwt.claim.sub; não prova a API HTTP.
-- Gestor A f6..01 (org inteira), operador f6..02 restrito à empresa A2.
begin;
insert into auth.users(id,email) values
 ('f6000000-0000-4000-8000-000000000001','exig-a@qa.invalid'),('f6000000-0000-4000-8000-000000000002','exig-r@qa.invalid');
insert into public.clientes(id,nome,email,status) values
 ('f6000000-0000-4000-8000-000000000001','QA exig A','exig-a@qa.invalid','aprovado'),
 ('f6000000-0000-4000-8000-000000000002','QA exig R','exig-r@qa.invalid','aprovado');
insert into public.operacao_organizacoes(id,nome,owner_id) values
 ('f6000000-0000-4000-8000-00000000000a','QA exig A','f6000000-0000-4000-8000-000000000001');
insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values
 ('f6000000-0000-4000-8000-00000000001a','f6000000-0000-4000-8000-00000000000a','QA exig empresa A','11222333000181'),
 ('f6000000-0000-4000-8000-00000000001b','f6000000-0000-4000-8000-00000000000a','QA exig empresa A2','22333444000181');
insert into public.operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values
 ('f6000000-0000-4000-8000-00000000000a','f6000000-0000-4000-8000-000000000001','gestor',null),
 ('f6000000-0000-4000-8000-00000000000a','f6000000-0000-4000-8000-000000000002','operador','f6000000-0000-4000-8000-00000000001b');
-- 2a: sessão daqui a 10 dias; 2b: sem sessão (compara com hoje).
insert into public.operacao_processos(id,organizacao_id,empresa_id,objeto,data_sessao) values
 ('f6000000-0000-4000-8000-00000000002a','f6000000-0000-4000-8000-00000000000a','f6000000-0000-4000-8000-00000000001a','QA com sessão',now()+interval '10 days'),
 ('f6000000-0000-4000-8000-00000000002b','f6000000-0000-4000-8000-00000000000a','f6000000-0000-4000-8000-00000000001a','QA sem sessão',null);
insert into public.operacao_documentos(organizacao_id,empresa_id,tipo,titulo,emissao,vencimento) values
 ('f6000000-0000-4000-8000-00000000000a','f6000000-0000-4000-8000-00000000001a','QA CND Federal','antiga',current_date-60,current_date-30),
 ('f6000000-0000-4000-8000-00000000000a','f6000000-0000-4000-8000-00000000001a','QA CND Federal','recente',current_date-5,current_date+30),
 ('f6000000-0000-4000-8000-00000000000a','f6000000-0000-4000-8000-00000000001a','QA FGTS','fgts',current_date-20,current_date+5),
 ('f6000000-0000-4000-8000-00000000000a','f6000000-0000-4000-8000-00000000001a','QA Trabalhista','cndt',current_date-200,current_date-1),
 ('f6000000-0000-4000-8000-00000000000a','f6000000-0000-4000-8000-00000000001a','certidão federal ','caixa e bordas',current_date-1,current_date+60),
 ('f6000000-0000-4000-8000-00000000000a','f6000000-0000-4000-8000-00000000001b','QA Atestado','de outra empresa',current_date,current_date+90);

-- O robô (service_role) grava as exigências.
set local role service_role;
insert into public.operacao_exigencias_processo(organizacao_id,empresa_id,processo_id,codigo,categoria,texto,origem,tipo_documento,documento,pagina,trecho) values
 ('f6000000-0000-4000-8000-00000000000a','f6000000-0000-4000-8000-00000000001a','f6000000-0000-4000-8000-00000000002a','R0001','declaracao','Declaração de menor','ia_sem_trecho',null,null,null,null),
 ('f6000000-0000-4000-8000-00000000000a','f6000000-0000-4000-8000-00000000001a','f6000000-0000-4000-8000-00000000002a','R0002','tecnica','Atestado de capacidade','ambas','QA Atestado','TR.pdf',14,'apresentar atestado'),
 ('f6000000-0000-4000-8000-00000000000a','f6000000-0000-4000-8000-00000000001a','f6000000-0000-4000-8000-00000000002a','R0003','fiscal','FGTS','leitura_deterministica','QA FGTS','Edital.pdf',3,'CRF'),
 ('f6000000-0000-4000-8000-00000000000a','f6000000-0000-4000-8000-00000000001a','f6000000-0000-4000-8000-00000000002a','R0004','fiscal','CND federal','ambas','QA CND Federal','Edital.pdf',3,'CND'),
 ('f6000000-0000-4000-8000-00000000000a','f6000000-0000-4000-8000-00000000001a','f6000000-0000-4000-8000-00000000002b','R0001','fiscal','CNDT','manual','QA Trabalhista',null,null,null),
 ('f6000000-0000-4000-8000-00000000000a','f6000000-0000-4000-8000-00000000001a','f6000000-0000-4000-8000-00000000002b','R0002','fiscal','Certidão federal','ambas','Certidão Federal',null,null,null);
do $$ begin
 begin insert into public.operacao_exigencias_processo(organizacao_id,empresa_id,processo_id,codigo,categoria,texto,origem)
  values('f6000000-0000-4000-8000-00000000000a','f6000000-0000-4000-8000-00000000001a','f6000000-0000-4000-8000-00000000002a','R0001','fiscal','dup','manual');
  raise exception 'Código duplicado no processo aceito'; exception when unique_violation then null; end;
 begin insert into public.operacao_exigencias_processo(organizacao_id,empresa_id,processo_id,codigo,categoria,texto,origem)
  values('f6000000-0000-4000-8000-00000000000a','f6000000-0000-4000-8000-00000000001a','f6000000-0000-4000-8000-00000000002a','R0099','outra','x','manual');
  raise exception 'Categoria inválida aceita'; exception when check_violation then null; end;
 begin insert into public.operacao_exigencias_processo(organizacao_id,empresa_id,processo_id,codigo,categoria,texto,origem)
  values('f6000000-0000-4000-8000-00000000000a','f6000000-0000-4000-8000-00000000001a','f6000000-0000-4000-8000-00000000002a','R0098','fiscal',repeat('x',2001),'manual');
  raise exception 'Texto > 2000 aceito'; exception when check_violation then null; end;
 begin insert into public.operacao_exigencias_processo(organizacao_id,empresa_id,processo_id,codigo,categoria,texto,origem)
  values('f6000000-0000-4000-8000-00000000000a','f6000000-0000-4000-8000-00000000001b','f6000000-0000-4000-8000-00000000002a','R0097','fiscal','x','manual');
  raise exception 'Exigência com empresa diferente do processo aceita'; exception when foreign_key_violation then null; end;
 -- Modelo do edital: teto de 20000 e fonte só como objeto.
 update public.operacao_exigencias_processo set modelo_texto='ANEXO III - MODELO DE DECLARAÇÃO', modelo_fonte='{"documento":"Edital.pdf","pagina":30}'
  where processo_id='f6000000-0000-4000-8000-00000000002a' and codigo='R0001';
 begin update public.operacao_exigencias_processo set modelo_texto=repeat('x',20001) where codigo='R0001';
  raise exception 'Modelo > 20000 aceito'; exception when check_violation then null; end;
 begin update public.operacao_exigencias_processo set modelo_fonte='[1]' where codigo='R0001';
  raise exception 'Fonte do modelo fora de objeto aceita'; exception when check_violation then null; end;
end $$;

set local role authenticated;
do $$
declare ua uuid:='f6000000-0000-4000-8000-000000000001'; pa uuid:='f6000000-0000-4000-8000-00000000002a';
 pb uuid:='f6000000-0000-4000-8000-00000000002b'; s text; n int; r public.operacao_exigencias_processo;
begin
 perform set_config('request.jwt.claim.sub',ua::text,true);
 -- Os quatro estados da view (e a certidão mais recente do tipo, não a vencida).
 select string_agg(codigo||'='||situacao,',' order by codigo) into s from public.operacao_exigencias_situacao where processo_id=pa;
 if s<>'R0001=conferir,R0002=falta,R0003=vence_antes_da_sessao,R0004=vigente' then raise exception 'Situações do processo com sessão: %',s;end if;
 if (select documento_empresa_titulo from public.operacao_exigencias_situacao where processo_id=pa and codigo='R0004')<>'recente' then raise exception 'Não pegou a certidão mais recente';end if;
 if (select situacao from public.operacao_exigencias_situacao where processo_id=pb and codigo='R0001')<>'vence_antes_da_sessao' then raise exception 'Sem sessão não comparou com hoje';end if;
 if (select situacao||'/'||documento_empresa_titulo from public.operacao_exigencias_situacao where processo_id=pb and codigo='R0002')<>'vigente/caixa e bordas'
  then raise exception '"Certidão Federal" não casou com "certidão federal "';end if;

 -- Usuário responde; quem/quando vêm do JWT.
 update public.operacao_exigencias_processo set resposta='atendo' where processo_id=pa and codigo='R0004' returning * into r;
 if r.respondido_por<>ua or r.respondido_em is null then raise exception 'Resposta sem carimbo: %',r;end if;
 begin update public.operacao_exigencias_processo set resposta='talvez' where processo_id=pa and codigo='R0004'; raise exception 'Resposta inválida aceita';
 exception when check_violation then null; end;
 -- Mas não muda texto, não forja quem respondeu, não insere, não apaga.
 begin update public.operacao_exigencias_processo set texto='trocado' where processo_id=pa; raise exception 'Usuário mudou o texto';
 exception when insufficient_privilege then null; end;
 begin update public.operacao_exigencias_processo set respondido_por=null where processo_id=pa; raise exception 'Usuário forjou respondido_por';
 exception when insufficient_privilege then null; end;
 begin update public.operacao_exigencias_processo set modelo_texto='plantado' where processo_id=pa; raise exception 'Usuário trocou o modelo do edital';
 exception when insufficient_privilege then null; end;
 if (select modelo_fonte->>'pagina' from public.operacao_exigencias_situacao where processo_id=pa and codigo='R0001') is distinct from '30'
  then raise exception 'View sem o modelo do edital';end if;
 begin insert into public.operacao_exigencias_processo(organizacao_id,empresa_id,processo_id,codigo,categoria,texto,origem)
  values('f6000000-0000-4000-8000-00000000000a','f6000000-0000-4000-8000-00000000001a',pa,'R0050','fiscal','x','manual'); raise exception 'Usuário inseriu exigência';
 exception when insufficient_privilege then null; end;
 begin delete from public.operacao_exigencias_processo where processo_id=pa; raise exception 'Usuário apagou exigência';
 exception when insufficient_privilege then null; end;

 -- Operador restrito à A2 não lê nem responde exigências da A.
 perform set_config('request.jwt.claim.sub','f6000000-0000-4000-8000-000000000002',true);
 if exists(select 1 from public.operacao_exigencias_processo) or exists(select 1 from public.operacao_exigencias_situacao) then raise exception 'Restrito lê exigências de outra empresa';end if;
 update public.operacao_exigencias_processo set resposta='nao_se_aplica' where processo_id=pa; get diagnostics n=row_count;
 if n<>0 then raise exception 'Restrito respondeu exigência de outra empresa';end if;
 perform set_config('request.jwt.claim.sub',ua::text,true);
 if (select count(*) from public.operacao_exigencias_processo where resposta='nao_se_aplica')<>0 then raise exception 'Resposta do restrito gravou';end if;
end $$;

set local role anon;
do $$ begin
 begin perform 1 from public.operacao_exigencias_situacao; raise exception 'anon leu a view'; exception when insufficient_privilege then null; end;
 raise notice 'testar_exigencias: ok';
end $$;
rollback;
