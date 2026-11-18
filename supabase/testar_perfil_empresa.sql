-- PREPARADO, NÃO EXECUTADO EM PRODUÇÃO. Clone isolado ou PGlite com 01-aplicar.sql e
-- operacao_perfil_empresa.sql aplicados. Fixtures sintéticas e rollback.
-- RLS simulada com "set local role authenticated" + request.jwt.claim.sub; não prova a API HTTP.
-- Gestor A f5..01 (org inteira), operador f5..02 restrito à empresa A2,
-- leitura f5..03 (org inteira) e operador f5..04 restrito à empresa A.
begin;
insert into auth.users(id,email) values
 ('f5000000-0000-4000-8000-000000000001','perfil-a@qa.invalid'),('f5000000-0000-4000-8000-000000000002','perfil-r@qa.invalid'),
 ('f5000000-0000-4000-8000-000000000003','perfil-l@qa.invalid'),('f5000000-0000-4000-8000-000000000004','perfil-o@qa.invalid');
insert into public.clientes(id,nome,email,status) values
 ('f5000000-0000-4000-8000-000000000001','QA perfil A','perfil-a@qa.invalid','aprovado'),
 ('f5000000-0000-4000-8000-000000000002','QA perfil R','perfil-r@qa.invalid','aprovado'),
 ('f5000000-0000-4000-8000-000000000003','QA perfil L','perfil-l@qa.invalid','aprovado'),
 ('f5000000-0000-4000-8000-000000000004','QA perfil O','perfil-o@qa.invalid','aprovado');
insert into public.operacao_organizacoes(id,nome,owner_id) values
 ('f5000000-0000-4000-8000-00000000000a','QA perfil A','f5000000-0000-4000-8000-000000000001');
insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values
 ('f5000000-0000-4000-8000-00000000001a','f5000000-0000-4000-8000-00000000000a','QA perfil empresa A','11222333000181'),
 ('f5000000-0000-4000-8000-00000000001b','f5000000-0000-4000-8000-00000000000a','QA perfil empresa A2','22333444000181');
insert into public.operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values
 ('f5000000-0000-4000-8000-00000000000a','f5000000-0000-4000-8000-000000000001','gestor',null),
 ('f5000000-0000-4000-8000-00000000000a','f5000000-0000-4000-8000-000000000002','operador','f5000000-0000-4000-8000-00000000001b'),
 ('f5000000-0000-4000-8000-00000000000a','f5000000-0000-4000-8000-000000000003','leitura',null),
 ('f5000000-0000-4000-8000-00000000000a','f5000000-0000-4000-8000-000000000004','operador','f5000000-0000-4000-8000-00000000001a');

set local role authenticated;
do $$
declare
 o uuid:='f5000000-0000-4000-8000-00000000000a'; ea uuid:='f5000000-0000-4000-8000-00000000001a';
 eb uuid:='f5000000-0000-4000-8000-00000000001b'; ua uuid:='f5000000-0000-4000-8000-000000000001';
 h text:=repeat('a',64); r public.operacao_perfil_empresa; p public.operacao_premissas_empresa; n int;
begin
 perform set_config('request.jwt.claim.sub',ua::text,true);
 -- Gestor grava; versao nasce 1 e sobe a cada UPDATE (mesmo tentando forçar).
 insert into public.operacao_perfil_empresa(empresa_id,organizacao_id,nome_fantasia,porte,regime_tributario,aliquota_efetiva,
  cpf_representante,banco,proposta_padrao,logo_caminho,logo_hash,versao)
  values(ea,o,'QA Fantasia','me','simples',6.000,'12345678901','{"agencia":"0001"}',
  '{"validade":"60 dias","pagamento":"30 dias","prazo_entrega":"10 dias"}',o||'/'||ea||'/perfil/logo-'||h||'.png',h,99) returning * into r;
 if r.versao<>1 or r.atualizado_por<>ua or r.tributos_fonte<>'manual' then raise exception 'Insert do perfil: %',r;end if;
 update public.operacao_perfil_empresa set telefone='92 99999-0000', versao=1 where empresa_id=ea returning * into r;
 if r.versao<>2 then raise exception 'versao não incrementou: %',r.versao;end if;
 update public.operacao_perfil_empresa set telefone='92 98888-0000' where empresa_id=ea returning * into r;
 if r.versao<>3 then raise exception 'versao não incrementou de novo: %',r.versao;end if;

 -- Logo fora do escopo (outra empresa, fora de perfil/) e campos inválidos falham.
 begin update public.operacao_perfil_empresa set logo_caminho=o||'/'||eb||'/perfil/x.png' where empresa_id=ea; raise exception 'Logo de outra empresa aceita';
 exception when check_violation then null; end;
 begin update public.operacao_perfil_empresa set logo_caminho=o||'/'||ea||'/certidoes/x.png' where empresa_id=ea; raise exception 'Logo fora de perfil/ aceita';
 exception when check_violation then null; end;
 begin update public.operacao_perfil_empresa set logo_hash=null where empresa_id=ea; raise exception 'Logo sem hash aceita';
 exception when check_violation then null; end;
 begin update public.operacao_perfil_empresa set cpf_representante='123.456.789-01' where empresa_id=ea; raise exception 'CPF com máscara aceito';
 exception when check_violation then null; end;
 begin update public.operacao_perfil_empresa set banco='[]' where empresa_id=ea; raise exception 'Banco não-objeto aceito';
 exception when check_violation then null; end;
 begin update public.operacao_perfil_empresa set proposta_padrao='{"outro":1}' where empresa_id=ea; raise exception 'Chave extra na proposta aceita';
 exception when check_violation then null; end;
 begin update public.operacao_perfil_empresa set porte='grande' where empresa_id=ea; raise exception 'Porte inválido aceito';
 exception when check_violation then null; end;
 begin update public.operacao_perfil_empresa set empresa_id=eb where empresa_id=ea; raise exception 'Perfil transferido de empresa';
 exception when raise_exception then null; end;

 -- Premissas: os quatro níveis e a escolha do mais específico.
 insert into public.operacao_premissas_empresa(organizacao_id,empresa_id,segmento,uf,margem_percentual,margem_minima_percentual) values
  (o,ea,'*','*',10,5),(o,ea,'*','AM',11,5),(o,ea,'limpeza','*',12,5),(o,ea,'limpeza','AM',13,5);
 if (public.premissa_aplicavel(ea,' Limpeza ','am')).margem_percentual<>13 then raise exception 'seg+UF não venceu';end if;
 if (public.premissa_aplicavel(ea,'limpeza','PA')).margem_percentual<>12 then raise exception 'seg+* não venceu';end if;
 if (public.premissa_aplicavel(ea,'informatica','AM')).margem_percentual<>11 then raise exception '*+UF não venceu';end if;
 if (public.premissa_aplicavel(ea,null,null)).margem_percentual<>10 then raise exception '*+* não veio';end if;
 if (public.premissa_aplicavel(eb,'limpeza','AM')).id is not null then raise exception 'Premissa de outra empresa vazou';end if;
 begin insert into public.operacao_premissas_empresa(organizacao_id,empresa_id,segmento,uf,margem_percentual,margem_minima_percentual)
  values(o,ea,'saude','*',10,10.001); raise exception 'Margem mínima > margem aceita';
 exception when check_violation then null; end;
 begin insert into public.operacao_premissas_empresa(organizacao_id,empresa_id,segmento,uf) values(o,ea,'Limpeza','*'); raise exception 'Segmento sem normalizar aceito';
 exception when check_violation then null; end;
 begin insert into public.operacao_premissas_empresa(organizacao_id,empresa_id,uf) values(o,ea,'am'); raise exception 'UF minúscula aceita';
 exception when check_violation then null; end;

 -- Operador restrito à A2 não lê nem escreve a empresa A.
 perform set_config('request.jwt.claim.sub','f5000000-0000-4000-8000-000000000002',true);
 if exists(select 1 from public.operacao_perfil_empresa) or exists(select 1 from public.operacao_premissas_empresa)
  or (public.premissa_aplicavel(ea,'limpeza','AM')).id is not null then raise exception 'Restrito lê perfil/premissa de outra empresa';end if;
 update public.operacao_perfil_empresa set nome_fantasia='invadido' where empresa_id=ea; get diagnostics n=row_count;
 if n<>0 then raise exception 'Restrito alterou perfil de outra empresa';end if;
 delete from public.operacao_premissas_empresa where empresa_id=ea; get diagnostics n=row_count;
 if n<>0 then raise exception 'Restrito apagou premissa de outra empresa';end if;
 begin insert into public.operacao_premissas_empresa(organizacao_id,empresa_id,segmento) values(o,ea,'invasor'); raise exception 'Restrito inseriu premissa de outra empresa';
 exception when insufficient_privilege then null; end;
 -- Mas escreve na própria empresa.
 insert into public.operacao_premissas_empresa(organizacao_id,empresa_id,margem_percentual) values(o,eb,20);
 if (public.premissa_aplicavel(eb,'x','AM')).margem_percentual<>20 then raise exception 'Restrito não lê a própria premissa';end if;
 perform set_config('request.jwt.claim.sub',ua::text,true);
 if (select nome_fantasia from public.operacao_perfil_empresa where empresa_id=ea)<>'QA Fantasia' then raise exception 'Perfil mudou';end if;
 -- Teto de 50 por empresa: 46 a mais fecham 50; a 51ª falha.
 insert into public.operacao_premissas_empresa(organizacao_id,empresa_id,segmento) select o,ea,'seg'||g from generate_series(1,46) g;
 begin insert into public.operacao_premissas_empresa(organizacao_id,empresa_id,segmento) values(o,ea,'seg-51'); raise exception '51ª premissa aceita';
 exception when raise_exception then if sqlerrm not like 'Limite de 50%' then raise; end if; end;
 select count(*) into n from public.operacao_premissas_empresa where empresa_id=ea;
 if n<>50 then raise exception 'Esperava 50 premissas, achei %',n;end if;

end $$;

-- LGPD: papel leitura não lê o perfil (CPF/banco); gestor e operador da empresa leem. Premissas seguem legíveis.
do $$
declare ea uuid:='f5000000-0000-4000-8000-00000000001a';
begin
 perform set_config('request.jwt.claim.sub','f5000000-0000-4000-8000-000000000003',true);
 if exists(select 1 from public.operacao_perfil_empresa) then raise exception 'Papel leitura leu o perfil (CPF/banco)';end if;
 if (select count(*) from public.operacao_premissas_empresa where empresa_id=ea)<>50
  or (public.premissa_aplicavel(ea,'limpeza','AM')).margem_percentual<>13 then raise exception 'Papel leitura não lê as premissas';end if;
 perform set_config('request.jwt.claim.sub','f5000000-0000-4000-8000-000000000004',true);
 if (select cpf_representante from public.operacao_perfil_empresa where empresa_id=ea) is distinct from '12345678901' then raise exception 'Operador da empresa não lê o perfil';end if;
 perform set_config('request.jwt.claim.sub','f5000000-0000-4000-8000-000000000001',true);
 if (select banco->>'agencia' from public.operacao_perfil_empresa where empresa_id=ea) is distinct from '0001' then raise exception 'Gestor não lê o perfil';end if;
end $$;

-- anon não lê nada.
set local role anon;
do $$ begin
 begin perform 1 from public.operacao_perfil_empresa; raise exception 'anon leu perfil'; exception when insufficient_privilege then null; end;
 raise notice 'testar_perfil_empresa: ok';
end $$;
rollback;
