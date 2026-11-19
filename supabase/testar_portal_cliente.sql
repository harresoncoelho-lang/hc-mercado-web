-- PREPARADO, NÃO EXECUTADO EM PRODUÇÃO. Clone isolado ou PGlite com 01-aplicar.sql,
-- operacao_itens_proposta.sql e operacao_portal_cliente.sql aplicados. Fixtures sintéticas e rollback.
-- Tudo numa transação: now() fica fixo, então as janelas de limite não viram no meio do teste.
-- RLS simulada com "set local role authenticated" + request.jwt.claim.sub; não prova a API HTTP.
-- Gestor A f4..01 (org inteira), operador f4..02 restrito à empresa A2, gestor C f4..03 (outra org).
begin;
insert into auth.users(id,email) values
 ('f4000000-0000-4000-8000-000000000001','portal-a@qa.invalid'),('f4000000-0000-4000-8000-000000000002','portal-r@qa.invalid'),
 ('f4000000-0000-4000-8000-000000000003','portal-c@qa.invalid');
insert into public.clientes(id,nome,email,status) values
 ('f4000000-0000-4000-8000-000000000001','QA portal A','portal-a@qa.invalid','aprovado'),
 ('f4000000-0000-4000-8000-000000000002','QA portal R','portal-r@qa.invalid','aprovado'),
 ('f4000000-0000-4000-8000-000000000003','QA portal C','portal-c@qa.invalid','aprovado');
insert into public.operacao_organizacoes(id,nome,owner_id) values
 ('f4000000-0000-4000-8000-00000000000a','QA portal A','f4000000-0000-4000-8000-000000000001'),
 ('f4000000-0000-4000-8000-00000000000c','QA portal C','f4000000-0000-4000-8000-000000000003');
insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values
 ('f4000000-0000-4000-8000-00000000001a','f4000000-0000-4000-8000-00000000000a','QA portal empresa A','11222333000181'),
 ('f4000000-0000-4000-8000-00000000001b','f4000000-0000-4000-8000-00000000000a','QA portal empresa A2','22333444000181'),
 ('f4000000-0000-4000-8000-00000000001c','f4000000-0000-4000-8000-00000000000c','QA portal empresa C','33444555000181');
insert into public.operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values
 ('f4000000-0000-4000-8000-00000000000a','f4000000-0000-4000-8000-000000000001','gestor',null),
 ('f4000000-0000-4000-8000-00000000000a','f4000000-0000-4000-8000-000000000002','operador','f4000000-0000-4000-8000-00000000001b'),
 ('f4000000-0000-4000-8000-00000000000c','f4000000-0000-4000-8000-000000000003','gestor',null);
insert into public.operacao_processos(id,organizacao_id,empresa_id,objeto,numero,orgao,custo_direto,margem_percentual) values
 ('f4000000-0000-4000-8000-00000000002a','f4000000-0000-4000-8000-00000000000a','f4000000-0000-4000-8000-00000000001a','QA objeto A','QA-1','Órgão QA',777.77,33.333),
 ('f4000000-0000-4000-8000-00000000002b','f4000000-0000-4000-8000-00000000000a','f4000000-0000-4000-8000-00000000001a','QA outro processo','QA-2',null,null,null),
 ('f4000000-0000-4000-8000-00000000002c','f4000000-0000-4000-8000-00000000000c','f4000000-0000-4000-8000-00000000001c','QA org C','QA-3',null,null,null);
insert into public.operacao_itens_resultado(id,organizacao_id,processo_id,identificador,descricao,quantidade,unidade,
  valor_unitario_proposta,valor_unitario_minimo,custo_unitario,marca,modelo,fabricante) values
 ('f4000000-0000-4000-8000-000000000041','f4000000-0000-4000-8000-00000000000a','f4000000-0000-4000-8000-00000000002a','1','Item QA 1',10,'UN',12.50,11.00,8.88,'Marca','Modelo','Fab'),
 ('f4000000-0000-4000-8000-000000000042','f4000000-0000-4000-8000-00000000000a','f4000000-0000-4000-8000-00000000002a','2','Item QA 2',3,'CX',99.90,null,null,null,null,null),
 ('f4000000-0000-4000-8000-000000000043','f4000000-0000-4000-8000-00000000000a','f4000000-0000-4000-8000-00000000002b','1','Item de outro processo',1,'UN',1,null,null,null,null,null),
 ('f4000000-0000-4000-8000-000000000044','f4000000-0000-4000-8000-00000000000c','f4000000-0000-4000-8000-00000000002c','1','Item de outra org',1,'UN',1,null,null,null,null,null);

do $$
declare
 ua uuid:='f4000000-0000-4000-8000-000000000001'; ur uuid:='f4000000-0000-4000-8000-000000000002';
 ea uuid:='f4000000-0000-4000-8000-00000000001a'; pa uuid:='f4000000-0000-4000-8000-00000000002a';
 i1 uuid:='f4000000-0000-4000-8000-000000000041'; i2 uuid:='f4000000-0000-4000-8000-000000000042';
 h1 text:=encode(sha256('qa-token-1'::bytea),'hex'); h2 text:=encode(sha256('qa-token-2'::bytea),'hex');
 hr text:=encode(sha256('qa-token-revogado'::bytea),'hex'); hx text:=encode(sha256('qa-token-expirado'::bytea),'hex');
 hl text:=encode(sha256('qa-token-limite'::bytea),'hex');
 ip text:=repeat('1',64);
 res jsonb; lido jsonb; v1 text; v2 text; link_r uuid; n int; k int;
begin
 -- Criação: permissões e validações.
 begin perform public.criar_link_cliente(ur,ea,pa,h1,'Cliente QA',30,true); raise exception 'Restrito a outra empresa criou link';
 exception when sqlstate 'PT403' then null; end;
 begin perform public.criar_link_cliente(ua,ea,pa,h1,'x',30,true); raise exception 'Rótulo curto aceito'; exception when sqlstate 'PT400' then null; end;
 begin perform public.criar_link_cliente(ua,ea,pa,h1,'Cliente QA',61,true); raise exception '61 dias aceito'; exception when sqlstate 'PT400' then null; end;
 begin perform public.criar_link_cliente(ua,ea,pa,'ABC','Cliente QA',30,true); raise exception 'Hash inválido aceito'; exception when sqlstate 'PT400' then null; end;
 res:=public.criar_link_cliente(ua,ea,pa,h1,'Cliente QA',30,true);
 perform public.criar_link_cliente(ua,ea,pa,h2,'Cliente sem mínimo',1,false);
 link_r:=(public.criar_link_cliente(ua,ea,pa,hr,'Será revogado',10,true)->>'id')::uuid;
 if not exists(select 1 from public.operacao_portal_auditoria where evento='link_criado' and link_id=(res->>'id')::uuid and usuario_id=ua) then raise exception 'Criação sem auditoria';end if;

 -- Leitura válida: campos certos, mínimo só com mostrar_minimo, nada de CNPJ/custo/organização.
 lido:=public.portal_ler(h1,ip,1);
 if lido->'empresa'->>'razao_social'<>'QA portal empresa A' or lido->'processo'->>'numero'<>'QA-1' or (lido->>'total_itens')::int<>2
    or jsonb_array_length(lido->'itens')<>2 then raise exception 'Leitura incompleta: %',lido;end if;
 if lido->'itens'->0->>'valor_unitario_minimo'<>'11.00' or lido->'itens'->0->>'id'<>i1::text then raise exception 'Mínimo ausente com mostrar_minimo=true';end if;
 -- expira_em sai da varredura e os valores ficam entre \y: o timestamp com microssegundos (ex. ...:08.881234) casava
 -- com 8\.88 e falhava ~0,4% das rodadas (B9, revisão 19/11). Não era vazamento: era o relógio.
 if (lido->>'expira_em')::timestamptz not between now() + interval '29 days' and now() + interval '31 days' then raise exception 'expira_em fora de 30 dias: %',lido->>'expira_em';end if;
 if (lido - 'expira_em')::text ~* '(cnpj|11222333000181|organizacao_id|custo|margem|\y777\.77\y|\y8\.88\y|token|ip_hash|QA outro processo|Item de outr)' then raise exception 'Leitura vazou dado: %',lido;end if;
 if (select ultimo_acesso_em from public.operacao_links_cliente where token_hash=h1) is null then raise exception 'ultimo_acesso_em não atualizado';end if;
 res:=public.portal_ler(h2,ip,1);
 if (res - 'expira_em')::text like '%valor_unitario_minimo%' or (res - 'expira_em')::text ~ '\y11\.00\y' then raise exception 'mostrar_minimo=false devolveu o mínimo';end if;
 if res::text ~* 'cnpj' then raise exception 'Resposta contém cnpj';end if;
 if jsonb_array_length(public.portal_ler(h1,ip,2)->'itens')<>0 then raise exception 'Página 2 deveria vir vazia';end if;
 v1:=lido->'itens'->0->>'versao'; v2:=lido->'itens'->1->>'versao';

 -- Resposta válida grava e aparece como última resposta e no histórico.
 res:=public.portal_responder(h1,jsonb_build_array(jsonb_build_object('item_id',i1,'decisao','aprovado','versao',v1,'observacao','ok')),ip);
 if res<>'{"ok":true,"gravados":1,"repetidos":0}' then raise exception 'Resposta não gravou: %',res;end if;
 lido:=public.portal_ler(h1,ip,1);
 if lido->'itens'->0->'resposta'->>'decisao'<>'aprovado' or lido->'itens'->1->'resposta'<>'null' or jsonb_array_length(lido->'aceites')<>1 then raise exception 'Última resposta/histórico: %',lido;end if;
 if (select visto->>'valor_unitario_proposta' from public.operacao_aceites_item where item_id=i1)<>'12.50' then raise exception 'visto não guardou o valor mostrado';end if;

 -- Item de outro processo ou de outra organização, lista vazia, 201 respostas, decisão inválida e UUID só de
 -- hífens: voltam {erro, codigo} (sem raise) e cada recusa fica auditada como 'negado'.
 if public.portal_responder(h1,jsonb_build_array(jsonb_build_object('item_id','f4000000-0000-4000-8000-000000000043','decisao','aprovado','versao',v1)),ip)->>'codigo'
    is distinct from 'proibido' then raise exception 'Item de outro processo aceito';end if;
 if public.portal_responder(h1,jsonb_build_array(jsonb_build_object('item_id','f4000000-0000-4000-8000-000000000044','decisao','aprovado','versao',v1)),ip)->>'codigo'
    is distinct from 'proibido' then raise exception 'Item de outra organização aceito';end if;
 if public.portal_responder(h1,'[]',ip)->>'codigo' is distinct from 'invalido' then raise exception 'Lista vazia aceita';end if;
 if public.portal_responder(h1,(select jsonb_agg(jsonb_build_object('item_id',i1,'decisao','aprovado','versao',v1)) from generate_series(1,201)),ip)->>'codigo'
    is distinct from 'invalido' then raise exception '201 respostas aceitas';end if;
 if public.portal_responder(h1,jsonb_build_array(jsonb_build_object('item_id',i1,'decisao','talvez','versao',v1)),ip)->>'codigo'
    is distinct from 'invalido' then raise exception 'Decisão inválida aceita';end if;
 if public.portal_responder(h1,jsonb_build_array(jsonb_build_object('item_id',repeat('-',36),'decisao','aprovado','versao',v1)),ip)
    <>'{"erro":"Resposta inválida","codigo":"invalido"}' then raise exception 'UUID de hífens não voltou como erro';end if;
 if (select count(*) from public.operacao_portal_auditoria where evento='negado' and ip_hash=ip and detalhe->>'motivo' like 'resposta_%')<>6
 then raise exception 'Recusas de resposta não auditadas';end if;

 -- Versão velha: nada é gravado, nem o item com versão atual do mesmo lote.
 update public.operacao_itens_resultado set valor_unitario_proposta=13.00 where id=i1;
 select count(*) into n from public.operacao_aceites_item;
 res:=public.portal_responder(h1,jsonb_build_array(jsonb_build_object('item_id',i1,'decisao','recusado','versao',v1),
   jsonb_build_object('item_id',i2,'decisao','aprovado','versao',v2)),ip);
 if res<>jsonb_build_object('ok',false,'divergentes',jsonb_build_array(i1)) then raise exception 'Divergência não detectada: %',res;end if;
 if (select count(*) from public.operacao_aceites_item)<>n then raise exception 'Versão velha gravou';end if;

 -- Histórico só cresce: nem UPDATE, nem DELETE, nem TRUNCATE (o dono das tabelas roda este bloco).
 begin update public.operacao_aceites_item set decisao='recusado'; raise exception 'UPDATE em aceite passou';
 exception when raise_exception then if sqlerrm not like 'Aceite do cliente não pode%' then raise; end if; end;
 begin delete from public.operacao_aceites_item; raise exception 'DELETE em aceite passou';
 exception when raise_exception then if sqlerrm not like 'Aceite do cliente não pode%' then raise; end if; end;
 begin truncate public.operacao_aceites_item; raise exception 'TRUNCATE em aceite passou';
 exception when raise_exception then if sqlerrm not like 'Aceite do cliente não pode%' then raise; end if; end;
 -- Item, link e processo com aceite não se apagam (antes sumiam em cascata).
 begin delete from public.operacao_itens_resultado where id=i1; raise exception 'Item com aceite apagado';
 exception when foreign_key_violation then if sqlerrm<>'Este item tem respostas do cliente; arquive em vez de excluir.' then raise; end if; end;
 begin delete from public.operacao_links_cliente where token_hash=h1; raise exception 'Link com aceite apagado';
 exception when foreign_key_violation then if sqlerrm<>'Este item tem respostas do cliente; arquive em vez de excluir.' then raise; end if; end;
 begin delete from public.operacao_processos where id=pa; raise exception 'Processo com aceite apagado';
 exception when foreign_key_violation then if sqlerrm<>'Este item tem respostas do cliente; arquive em vez de excluir.' then raise; end if; end;
 if (select count(*) from public.operacao_aceites_item)<>n then raise exception 'Aceite sumiu';end if;
 -- Item sem aceite continua apagável.
 delete from public.operacao_itens_resultado where id='f4000000-0000-4000-8000-000000000043';
 if has_table_privilege('service_role','public.operacao_aceites_item','DELETE') or has_table_privilege('service_role','public.operacao_aceites_item','TRUNCATE')
    or has_table_privilege('service_role','public.operacao_portal_auditoria','DELETE') or has_table_privilege('service_role','public.operacao_portal_auditoria','TRUNCATE')
 then raise exception 'service_role pode apagar aceite ou auditoria';end if;

 -- Revogado, expirado e inexistente: mesma resposta (null) e auditoria 'negado'.
 res:=public.revogar_link_cliente(ua,link_r);
 if (res->>'revogado_em') is null then raise exception 'Revogação falhou';end if;
 begin perform public.revogar_link_cliente(ur,link_r); raise exception 'Restrito revogou link'; exception when sqlstate 'PT403' then null; end;
 insert into public.operacao_links_cliente(organizacao_id,empresa_id,processo_id,token_hash,rotulo,criado_por,criado_em,expira_em)
  values('f4000000-0000-4000-8000-00000000000a',ea,pa,hx,'Expirado',ua,now()-interval '10 days',now()-interval '1 second');
 if public.portal_ler(hr,repeat('2',64),1) is not null or public.portal_ler(hx,repeat('2',64),1) is not null
    or public.portal_ler(repeat('0',64),repeat('2',64),1) is not null or public.portal_ler('lixo',repeat('2',64),1) is not null
    or public.portal_responder(hr,jsonb_build_array(jsonb_build_object('item_id',i1,'decisao','aprovado','versao',v1)),repeat('2',64)) is not null
 then raise exception 'Link inválido não devolveu null';end if;
 if (select array_agg(detalhe->>'motivo' order by id) from public.operacao_portal_auditoria where evento='negado' and ip_hash=repeat('2',64))
    <>array['revogado','expirado','inexistente','inexistente','revogado'] then raise exception 'Auditoria de negado incorreta';end if;
 begin insert into public.operacao_links_cliente(organizacao_id,empresa_id,processo_id,token_hash,rotulo,criado_por,expira_em)
  values('f4000000-0000-4000-8000-00000000000a',ea,pa,repeat('9',64),'Longo',ua,now()+interval '61 days'); raise exception 'Validade de 61 dias aceita';
 exception when check_violation then null; end;

 -- 6º link ativo recusado (revogado e expirado não contam).
 perform public.criar_link_cliente(ua,ea,pa,hl,'Limite',5,true);
 perform public.criar_link_cliente(ua,ea,pa,repeat('a',64),'Quarto',5,true);
 perform public.criar_link_cliente(ua,ea,pa,repeat('b',64),'Quinto',5,true);
 begin perform public.criar_link_cliente(ua,ea,pa,repeat('c',64),'Sexto',5,true); raise exception '6º link ativo aceito';
 exception when sqlstate 'PT409' then null; end;

 -- Limites: 30/min por token, 60/min por IP, 20 falhas/h por IP, 10/min por token nas respostas.
 for k in 1..30 loop if public.portal_ler(hl,lpad(to_hex(k),64,'e'),1) ? 'limite' then raise exception 'Limite de token cedo demais (%)',k;end if; end loop;
 if public.portal_ler(hl,lpad(to_hex(31),64,'e'),1)<>'{"limite":true}' then raise exception 'Limite por token não estourou';end if;
 for k in 1..60 loop
  if public.portal_ler(case k%3 when 0 then h1 when 1 then repeat('a',64) else repeat('b',64) end,repeat('3',64),1) ? 'limite' then raise exception 'Limite de IP cedo demais (%)',k;end if;
 end loop;
 if public.portal_ler(repeat('a',64),repeat('3',64),1)<>'{"limite":true}' then raise exception 'Limite por IP não estourou';end if;
 for k in 1..20 loop if public.portal_ler(lpad(to_hex(k),64,'0'),repeat('4',64),1) is not null then raise exception 'Token inexistente não deu null';end if; end loop;
 if public.portal_ler(repeat('b',64),repeat('4',64),1)<>'{"limite":true}' then raise exception 'Limite de falhas não estourou';end if;
 for k in 1..10 loop
  res:=public.portal_responder(repeat('b',64),jsonb_build_array(jsonb_build_object('item_id',i2,'decisao','aprovado','versao',v2)),lpad(to_hex(k),64,'5'));
  if res ? 'limite' then raise exception 'Limite de resposta cedo demais (%)',k;end if;
  if res->>'gravados'<>(case k when 1 then '1' else '0' end) then raise exception 'Reenvio igual gravou de novo (%): %',k,res;end if;
 end loop;
 if (select count(*) from public.operacao_aceites_item a join public.operacao_links_cliente k on k.id=a.link_id where k.token_hash=repeat('b',64))<>1
 then raise exception 'Envio repetido duplicou o aceite';end if;
 if public.portal_responder(repeat('b',64),jsonb_build_array(jsonb_build_object('item_id',i2,'decisao','aprovado','versao',v2)),repeat('6',64))<>'{"limite":true}'
 then raise exception 'Limite de respostas não estourou';end if;
 if (select count(*) from public.operacao_portal_auditoria where evento='limite')<>4 then raise exception 'Auditoria de limite deveria ter 1 linha por estouro';end if;

 -- M1: 15 respostas inválidas com token válido e o mesmo IP: o contador sobe (antes o raise o desfazia),
 -- as 10 primeiras viram erro auditado e as 5 últimas, limite.
 for k in 1..15 loop
  res:=public.portal_responder(h2,jsonb_build_array(jsonb_build_object('item_id',repeat('-',36),'decisao','aprovado','versao',v1)),repeat('d',64));
  if (k<=10 and res->>'codigo' is distinct from 'invalido') or (k>10 and res<>'{"limite":true}') then raise exception 'Chamada inválida % deu %',k,res;end if;
 end loop;
 if (select contagem from public.operacao_portal_limite where chave='resp:'||h2)<>15 then raise exception 'Contador não subiu com chamadas inválidas';end if;
 if (select count(*) from public.operacao_portal_auditoria where evento='negado' and ip_hash=repeat('d',64))<>10 then raise exception 'negado não gravado com erro';end if;

 -- B6: link de quem não tem (mais) acesso de gestão ao processo não vale.
 insert into public.operacao_links_cliente(organizacao_id,empresa_id,processo_id,token_hash,rotulo,criado_por,expira_em)
  values('f4000000-0000-4000-8000-00000000000a',ea,pa,repeat('f',64),'Criador sem acesso',ur,now()+interval '5 days');
 if public.portal_ler(repeat('f',64),repeat('c',64),1) is not null then raise exception 'Link de criador sem acesso ainda vale';end if;
 if not exists(select 1 from public.operacao_portal_auditoria where evento='negado' and ip_hash=repeat('c',64) and detalhe->>'motivo'='criador_sem_acesso')
 then raise exception 'Motivo criador_sem_acesso não auditado';end if;

 -- Limpeza: linha de limite com mais de 1 dia some na próxima leitura e na próxima resposta; acesso/negado/limite
 -- com mais de 180 dias somem; resposta e link_criado antigos ficam.
 insert into public.operacao_portal_limite values('ip:velho',now()-interval '2 days',1);
 perform public.portal_ler(h1,repeat('7',64),1);
 if exists(select 1 from public.operacao_portal_limite where chave='ip:velho') then raise exception 'Limite antigo não foi limpo';end if;
 insert into public.operacao_portal_limite values('ip:velho2',now()-interval '2 days',1);
 insert into public.operacao_portal_auditoria(evento,processo_id,detalhe,criado_em) values
  ('acesso',pa,'{"qa":"velho"}',now()-interval '181 days'),('negado',pa,'{"qa":"velho"}',now()-interval '181 days'),
  ('limite',null,'{"qa":"velho"}',now()-interval '181 days'),('resposta',pa,'{"qa":"velho"}',now()-interval '181 days'),
  ('link_criado',pa,'{"qa":"velho"}',now()-interval '181 days'),('acesso',pa,'{"qa":"recente"}',now()-interval '179 days');
 perform public.portal_responder(repeat('0',64),'[]',repeat('7',64));
 if exists(select 1 from public.operacao_portal_limite where chave='ip:velho2') then raise exception 'portal_responder não limpou o limite';end if;
 if (select array_agg(evento||':'||(detalhe->>'qa') order by evento) from public.operacao_portal_auditoria where detalhe ? 'qa')
    <>array['acesso:recente','link_criado:velho','resposta:velho'] then raise exception 'Retenção de 180 dias incorreta';end if;

 -- Teto global de 'negado' por hora: estourou, só conta (um único evento 'limite').
 insert into public.operacao_portal_limite values('global:negado',date_trunc('hour',now()),1000)
  on conflict (chave,janela) do update set contagem=1000;
 for k in 1..3 loop perform public.portal_ler(lpad(to_hex(k),64,'9'),repeat('8',64),1); end loop;
 if exists(select 1 from public.operacao_portal_auditoria where evento='negado' and ip_hash=repeat('8',64)) then raise exception 'negado gravado acima do teto';end if;
 if (select contagem from public.operacao_portal_limite where chave='global:negado' and janela=date_trunc('hour',now()))<>1003
    or (select count(*) from public.operacao_portal_auditoria where evento='limite' and detalhe->>'motivo'='negado_global_hora')<>1
 then raise exception 'Teto global de negado incorreto';end if;

 -- RPCs só para service_role; auxiliares para ninguém.
 if has_function_privilege('anon','public.portal_ler(text,text,integer)','EXECUTE') or has_function_privilege('authenticated','public.portal_responder(text,jsonb,text)','EXECUTE')
    or has_function_privilege('authenticated','public.criar_link_cliente(uuid,uuid,uuid,text,text,integer,boolean)','EXECUTE')
    or not has_function_privilege('service_role','public.revogar_link_cliente(uuid,uuid)','EXECUTE')
    or has_function_privilege('service_role','public.portal_contar(text,timestamptz)','EXECUTE')
    or has_function_privilege('authenticated','public.portal_link_valido(text,text)','EXECUTE') then raise exception 'Privilégio de função incorreto';end if;
 if has_table_privilege('anon','public.operacao_aceites_item','SELECT') or has_any_column_privilege('anon','public.operacao_links_cliente','SELECT')
    or has_any_column_privilege('authenticated','public.operacao_portal_limite','SELECT')
    or has_any_column_privilege('authenticated','public.operacao_aceites_item','INSERT,UPDATE') then raise exception 'Privilégio de tabela incorreto';end if;
end $$;

-- Painel (authenticated): gestor lê links e aceites, mas não token_hash nem ip_hash.
set local role authenticated;
select set_config('request.jwt.claim.sub','f4000000-0000-4000-8000-000000000001',true);
do $$
begin
 if (select count(*) from public.operacao_links_cliente)<>8 or (select count(*) from public.operacao_aceites_item)<>2
    or not exists(select 1 from public.operacao_portal_auditoria where evento='resposta') then raise exception 'Gestor não lê o portal do processo';end if;
 begin perform token_hash from public.operacao_links_cliente; raise exception 'authenticated leu token_hash'; exception when insufficient_privilege then null; end;
 begin perform ip_hash from public.operacao_aceites_item; raise exception 'authenticated leu ip_hash do aceite'; exception when insufficient_privilege then null; end;
 begin perform ip_hash from public.operacao_portal_auditoria; raise exception 'authenticated leu ip_hash da auditoria'; exception when insufficient_privilege then null; end;
 begin insert into public.operacao_aceites_item(link_id,organizacao_id,processo_id,item_id,decisao,visto,versao)
  select link_id,organizacao_id,processo_id,item_id,'aprovado','{}',versao from public.operacao_aceites_item limit 1; raise exception 'authenticated gravou aceite';
 exception when insufficient_privilege then null; end;
 begin perform public.portal_ler(repeat('0',64),repeat('8',64),1); raise exception 'authenticated chamou portal_ler'; exception when insufficient_privilege then null; end;
 -- Prova da revisão (A1): o gestor tenta apagar o item aprovado pelo cliente e falha; o aceite continua lá.
 begin delete from public.operacao_itens_resultado where id='f4000000-0000-4000-8000-000000000041'; raise exception 'Gestor apagou item com aceite';
 exception when foreign_key_violation then if sqlerrm<>'Este item tem respostas do cliente; arquive em vez de excluir.' then raise; end if; end;
 if not exists(select 1 from public.operacao_aceites_item where item_id='f4000000-0000-4000-8000-000000000041') then raise exception 'Aceite sumiu após delete do gestor';end if;
end $$;

-- Operador restrito a outra empresa e gestor de outra organização não leem nada do processo A.
select set_config('request.jwt.claim.sub','f4000000-0000-4000-8000-000000000002',true);
do $$ begin
 if exists(select 1 from public.operacao_aceites_item) or exists(select 1 from public.operacao_links_cliente)
    or exists(select 1 from public.operacao_portal_auditoria) then raise exception 'Restrito a outra empresa lê o portal';end if;
end $$;
select set_config('request.jwt.claim.sub','f4000000-0000-4000-8000-000000000003',true);
do $$ begin
 if exists(select 1 from public.operacao_aceites_item) or exists(select 1 from public.operacao_links_cliente) then raise exception 'Outra organização lê o portal';end if;
 raise notice 'testar_portal_cliente: ok';
end $$;
rollback;
