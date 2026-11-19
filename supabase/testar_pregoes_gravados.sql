-- PREPARADO, NÃO EXECUTADO EM PRODUÇÃO. PGlite (testar-dezembro.cjs) ou Supabase local (ambiente-teste/subir.cjs)
-- com pregoes_gravados.sql aplicado. Dados fictícios e rollback no fim.
-- RLS simulada com "set local role" + request.jwt.claim.sub; não prova a API HTTP.
begin;
insert into auth.users(id,email) values ('f7000000-0000-4000-8000-000000000001','pregao-a@qa.invalid'),('f7000000-0000-4000-8000-000000000002','pregao-b@qa.invalid');

-- 1ª leitura (usuário A): fornecedor 1 com proposta aberta, fornecedor 2 fechado, pessoa física sem nome.
set local role service_role;
select public.gravar_pregao_gravado('{"compra":"19302805900082025","fonte":"comprasgov","url":"https://cnetmobile.estaleiro.serpro.gov.br/x",
  "cabecalho":{"uasg":"193028","orgao":"ORGAO QA","numero":"90008","ano":2025,"modalidade":"Pregão Eletrônico"},
  "itens":[{"numero":1,"descricao":"Item QA","situacao":"Homologado","quantidade":50,"valorEstimado":11.87,"propostasLidas":true,
    "propostas":[{"chave":"11222333000181","cnpj":"11222333000181","nome":"ALFA QA LTDA","uf":"AM","meEpp":true,"valorOfertado":10,"marca":"santa cruz","modelo":"liquido","chatLido":true,"propostaLida":true},
                 {"chave":"22333444000181","cnpj":"22333444000181","nome":"BETA QA LTDA","uf":"AM","valorOfertado":11},
                 {"chave":"pf:1","cnpj":null,"nome":"Pessoa física","valorOfertado":12}],
    "mensagens":[{"fornecedor":"22333444000181","dataHora":"2026-01-07T09:44:00","autor":"orgao","texto":"Recusa da proposta. Motivo: marca diversa.","tipo":"recusa","motivo":"marca diversa."},
                 {"fornecedor":"11222333000181","dataHora":"2026-01-07T10:00:00","autor":"orgao","texto":"Aceite.","tipo":"aceite"}]}],
  "mensagens":[{"dataHora":"2026-01-07T08:00:00","autor":"Pregoeiro","texto":"Bom dia.","tipo":"outro"}]}'::jsonb,
  'f7000000-0000-4000-8000-000000000001');

-- 2ª leitura (usuário B): mesma página com o fornecedor 1 fechado e as mesmas mensagens + 1 nova; abre o fornecedor 2.
select public.gravar_pregao_gravado('{"compra":"19302805900082025","fonte":"comprasgov","cabecalho":{"uasg":"193028"},
  "itens":[{"numero":1,"descricao":null,"propostas":[{"chave":"11222333000181","cnpj":"11222333000181","nome":"ALFA QA LTDA","valorOfertado":10,"marca":null,"chatLido":false,"propostaLida":false},
                 {"chave":"22333444000181","cnpj":"22333444000181","nome":"BETA QA LTDA","marca":"Beta","propostaLida":true}],
    "mensagens":[{"fornecedor":"22333444000181","dataHora":"2026-01-07T09:44:00","autor":"orgao","texto":"Recusa da proposta. Motivo: marca diversa.","tipo":"recusa","motivo":"marca diversa."},
                 {"fornecedor":"22333444000181","dataHora":"2026-01-08T09:00:00","autor":"orgao","texto":"Nova mensagem.","tipo":"outro"}]}]}'::jsonb,
  'f7000000-0000-4000-8000-000000000002');

do $$ declare r record; begin
  select * into r from public.pregoes_gravados_propostas where fornecedor_chave='11222333000181';
  if r.marca is distinct from 'santa cruz' or not r.chat_lido or not r.proposta_lida then raise exception 'Leitura com fornecedor fechado apagou marca/flags: %', row_to_json(r); end if;
  if r.gravado_por <> 'f7000000-0000-4000-8000-000000000001' or r.atualizado_por <> 'f7000000-0000-4000-8000-000000000002' then raise exception 'Autoria errada'; end if;
  if (select marca from public.pregoes_gravados_propostas where fornecedor_chave='22333444000181') is distinct from 'Beta' then raise exception 'Marca nova não gravada'; end if;
  if (select count(*) from public.pregoes_gravados_propostas) <> 3 then raise exception 'Propostas duplicadas ou perdidas'; end if;
  if (select count(*) from public.pregoes_gravados_mensagens) <> 4 then raise exception 'Dedupe de mensagens falhou: %', (select count(*) from public.pregoes_gravados_mensagens); end if;
  if (select count(*) from public.pregoes_gravados_mensagens where numero_item=0) <> 1 then raise exception 'Mensagem da compra sem item 0'; end if;
  if (select itens->'1'->>'descricao' from public.pregoes_gravados) is distinct from 'Item QA' then raise exception 'Item perdeu descrição'; end if;
  -- CPF nunca entra, nem pelo service_role.
  begin insert into public.pregoes_gravados_propostas(id_compra,numero_item,fornecedor_chave,cnpj,nome) values('19302805900082025',1,'12345678909',null,'Fulano');
    raise exception 'Documento de 11 dígitos aceito'; exception when check_violation then null; end;
  begin insert into public.pregoes_gravados_propostas(id_compra,numero_item,fornecedor_chave,cnpj,nome) values('19302805900082025',1,'pf:9',null,'Fulano de Tal');
    raise exception 'Nome de pessoa física aceito'; exception when check_violation then null; end;
  begin insert into public.pregoes_gravados_mensagens(chave,id_compra,numero_item,texto,tipo) values(md5('x'),'19302805900082025',1,'CPF 123.456.789-09','outro');
    raise exception 'CPF em texto aceito'; exception when check_violation then null; end;
  begin insert into public.pregoes_gravados(id_compra,fonte) values('123','comprasgov');
    raise exception 'Compra inválida aceita'; exception when check_violation then null; end;
end $$;

-- Revisão 19/11 (A1): leitura envenenada. C e D são da mesma organização (QA org X); E é de outra (org Y).
-- A e B (sem organização) já gravaram: cada um é o próprio grupo.
reset role;
insert into auth.users(id,email) values ('f7000000-0000-4000-8000-000000000003','pregao-c@qa.invalid'),
  ('f7000000-0000-4000-8000-000000000004','pregao-d@qa.invalid'),('f7000000-0000-4000-8000-000000000005','pregao-e@qa.invalid');
insert into public.operacao_organizacoes(id,nome,owner_id) values
  ('f7000000-0000-4000-8000-0000000000a1','QA org X','f7000000-0000-4000-8000-000000000003'),
  ('f7000000-0000-4000-8000-0000000000a2','QA org Y','f7000000-0000-4000-8000-000000000005');
insert into public.operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values
  ('f7000000-0000-4000-8000-0000000000a1','f7000000-0000-4000-8000-000000000003','gestor',null),
  ('f7000000-0000-4000-8000-0000000000a1','f7000000-0000-4000-8000-000000000004','operador',null),
  ('f7000000-0000-4000-8000-0000000000a2','f7000000-0000-4000-8000-000000000005','gestor',null);
set local role service_role;
-- C (org X) tenta trocar valor, marca e órgão já gravados e manda uma mensagem falsa + CPF com espaço.
select public.gravar_pregao_gravado('{"compra":"19302805900082025","fonte":"comprasgov","url":"https://cnetmobile.estaleiro.serpro.gov.br/x",
  "cabecalho":{"uasg":"193028","orgao":"ORGAO FALSO"},
  "itens":[{"numero":1,"descricao":"Item falso","propostas":[{"chave":"11222333000181","cnpj":"11222333000181","nome":"ALFA QA LTDA","valorOfertado":1,"marca":"falsa","fabricante":"Fab C"}],
    "mensagens":[{"fornecedor":"11222333000181","dataHora":"2026-01-09T09:00:00","autor":"orgao","texto":"Inabilitada. Motivo: falso.","tipo":"inabilitacao","motivo":"falso."}]}]}'::jsonb,
  'f7000000-0000-4000-8000-000000000003');
do $$ declare r record; begin
  select * into r from public.pregoes_gravados_propostas where fornecedor_chave='11222333000181';
  if r.valor_ofertado <> 10 or r.marca <> 'santa cruz' then raise exception 'Leitura isolada sobrescreveu valor/marca: %', row_to_json(r); end if;
  if r.fabricante is distinct from 'Fab C' then raise exception 'Campo vazio não foi preenchido pela primeira leitura'; end if;
  if r.leituras_concordantes <> 2 then raise exception 'Concordantes esperado 2 (A e B), veio %', r.leituras_concordantes; end if;
  if (select orgao from public.pregoes_gravados) <> 'ORGAO QA' then raise exception 'Órgão sobrescrito por leitura isolada'; end if;
  if (select itens->'1'->>'descricao' from public.pregoes_gravados) <> 'Item QA' then raise exception 'Item sobrescrito por leitura isolada'; end if;
  if (select (itens->'1'->>'leituras_concordantes')::int from public.pregoes_gravados) <> 1 then raise exception 'Concordantes do item errado'; end if;
  if (select leituras_concordantes from public.pregoes_gravados_mensagens where texto like 'Inabilitada%') <> 1 then raise exception 'Mensagem falsa sem contagem 1'; end if;
  if (select origem from public.pregoes_gravados_mensagens where texto like 'Inabilitada%') <> 'usuario' then raise exception 'Origem ausente'; end if;
  if (select count(*) from public.pregoes_gravados_leituras where gravado_por='f7000000-0000-4000-8000-000000000003') <> 3 then raise exception 'Leituras de C não guardadas à parte'; end if;
end $$;

-- D (mesma org X de C) concorda com C: continua 1 grupo, não troca.
select public.gravar_pregao_gravado('{"compra":"19302805900082025","fonte":"comprasgov","cabecalho":{"orgao":"ORGAO FALSO"},
  "itens":[{"numero":1,"propostas":[{"chave":"11222333000181","cnpj":"11222333000181","valorOfertado":1,"marca":"falsa"}]}]}'::jsonb,
  'f7000000-0000-4000-8000-000000000004');
do $$ begin
  if (select valor_ofertado from public.pregoes_gravados_propostas where fornecedor_chave='11222333000181') <> 10 then raise exception 'Duas contas da mesma organização trocaram o valor'; end if;
end $$;

-- E (org Y) concorda com C: agora são 2 organizações (X, Y) contra A+B (2 grupos). Empate -> fica o lido primeiro.
select public.gravar_pregao_gravado('{"compra":"19302805900082025","fonte":"comprasgov",
  "itens":[{"numero":1,"propostas":[{"chave":"22333444000181","cnpj":"22333444000181","valorOfertado":11.5}]}]}'::jsonb,
  'f7000000-0000-4000-8000-000000000005');
do $$ begin
  if (select valor_ofertado from public.pregoes_gravados_propostas where fornecedor_chave='22333444000181') <> 11 then raise exception 'Empate 1x1 trocou o valor do primeiro'; end if;
end $$;
-- Proposta nova só de C e E (2 organizações) com um valor; A traz outro depois: o de 2 organizações vence.
select public.gravar_pregao_gravado('{"compra":"19302805900082025","fonte":"comprasgov","itens":[{"numero":2,"propostas":[{"chave":"33442649000111","cnpj":"33442649000111","nome":"GAMA QA","valorOfertado":5}]}]}'::jsonb,'f7000000-0000-4000-8000-000000000001');
select public.gravar_pregao_gravado('{"compra":"19302805900082025","fonte":"comprasgov","itens":[{"numero":2,"propostas":[{"chave":"33442649000111","cnpj":"33442649000111","nome":"GAMA QA","valorOfertado":7}]}]}'::jsonb,'f7000000-0000-4000-8000-000000000003');
do $$ begin
  if (select valor_ofertado from public.pregoes_gravados_propostas where fornecedor_chave='33442649000111') <> 5 then raise exception 'Segunda leitura isolada trocou o valor'; end if;
end $$;
select public.gravar_pregao_gravado('{"compra":"19302805900082025","fonte":"comprasgov","itens":[{"numero":2,"propostas":[{"chave":"33442649000111","cnpj":"33442649000111","nome":"GAMA QA","valorOfertado":7}]}]}'::jsonb,'f7000000-0000-4000-8000-000000000005');
do $$ declare r record; begin
  select * into r from public.pregoes_gravados_propostas where fornecedor_chave='33442649000111';
  if r.valor_ofertado <> 7 or r.leituras_concordantes <> 2 then raise exception '2 organizações concordando não trocaram o valor: %', row_to_json(r); end if;
end $$;

-- Expurgo de C: some só o que C trouxe (mensagem falsa, fabricante, a leitura de C); o resto fica e é recalculado.
do $$ declare r jsonb; begin
  r := public.expurgar_pregoes_gravados_por('f7000000-0000-4000-8000-000000000003');
  if (r->>'leituras')::int <> 5 then raise exception 'Expurgo removeu % leituras', r; end if;
  if exists (select 1 from public.pregoes_gravados_mensagens where texto like 'Inabilitada%') then raise exception 'Mensagem só de C sobreviveu ao expurgo'; end if;
  if (select count(*) from public.pregoes_gravados_mensagens) <> 4 then raise exception 'Expurgo apagou mensagem de outros'; end if;
  if (select fabricante from public.pregoes_gravados_propostas where fornecedor_chave='11222333000181') is not null then raise exception 'Fabricante de C sobreviveu'; end if;
  if (select marca from public.pregoes_gravados_propostas where fornecedor_chave='11222333000181') <> 'santa cruz' then raise exception 'Expurgo perdeu marca de A'; end if;
  if (select valor_ofertado from public.pregoes_gravados_propostas where fornecedor_chave='33442649000111') <> 5 then raise exception 'Sem C fica 1x1 (A=5, E=7): vale o lido primeiro; veio %', (select valor_ofertado from public.pregoes_gravados_propostas where fornecedor_chave='33442649000111'); end if;
  if exists (select 1 from public.pregoes_gravados_leituras where gravado_por='f7000000-0000-4000-8000-000000000003') then raise exception 'Leitura de C sobreviveu'; end if;
  if (select count(*) from public.pregoes_gravados_propostas) <> 4 then raise exception 'Propostas perdidas no expurgo'; end if;
end $$;
-- Releitura da mesma página: mensagem não duplica e a anterior nunca é apagada.
select public.gravar_pregao_gravado('{"compra":"19302805900082025","fonte":"comprasgov","itens":[{"numero":1,"mensagens":[{"fornecedor":"22333444000181","dataHora":"2026-01-07T09:44:00","autor":"orgao","texto":"Recusa da proposta. Motivo: marca diversa.","tipo":"recusa","motivo":"marca diversa."}]}]}'::jsonb,'f7000000-0000-4000-8000-000000000005');
do $$ begin
  if (select count(*) from public.pregoes_gravados_mensagens) <> 4 then raise exception 'Releitura duplicou ou apagou mensagem'; end if;
  if (select leituras_concordantes from public.pregoes_gravados_mensagens where texto like 'Recusa%') <> 3 then raise exception 'Mensagem lida por A, B e E deveria ter 3'; end if;
end $$;
-- B6: leitura de ata http fica marcada.
select public.gravar_pregao_gravado('{"compra":"15814205000232022","fonte":"comprasnet","url":"http://comprasnet.gov.br/livre/pregao/AtaEletronico.asp","semHttps":true,
  "itens":[{"numero":1,"propostas":[{"chave":"11222333000181","cnpj":"11222333000181","nome":"ALFA QA LTDA","valorOfertado":3}]}]}'::jsonb,'f7000000-0000-4000-8000-000000000001');
do $$ begin
  if not (select fonte_sem_https from public.pregoes_gravados where id_compra='15814205000232022') then raise exception 'Fonte http sem marca'; end if;
  if (select fonte_sem_https from public.pregoes_gravados where id_compra='19302805900082025') then raise exception 'Fonte https marcada como http'; end if;
end $$;
-- A2: CPF com espaço, "/" e sem pontuação recusado pelo banco.
do $$ begin
  begin insert into public.pregoes_gravados_mensagens(chave,id_compra,numero_item,texto,tipo) values(md5('c1'),'19302805900082025',1,'CPF 970 481 432 15','outro');
    raise exception 'CPF com espaço aceito'; exception when check_violation then null; end;
  begin insert into public.pregoes_gravados_mensagens(chave,id_compra,numero_item,texto,tipo) values(md5('c2'),'19302805900082025',1,'CPF 970.481.432/15','outro');
    raise exception 'CPF com barra aceito'; exception when check_violation then null; end;
  begin insert into public.pregoes_gravados_mensagens(chave,id_compra,numero_item,texto,tipo,motivo) values(md5('c3'),'19302805900082025',1,'x','outro','Sr 97048143215');
    raise exception 'CPF no motivo aceito'; exception when check_violation then null; end;
  begin update public.pregoes_gravados_propostas set nome='FULANA DE TAL 97048143215' where fornecedor_chave='11222333000181';
    raise exception 'CPF no nome (MEI) aceito'; exception when check_violation then null; end;
  -- CNPJ formatado não é CPF.
  insert into public.pregoes_gravados_mensagens(chave,id_compra,numero_item,texto,tipo) values(md5('c4'),'19302805900082025',1,'CNPJ 11.222.333/0001-81','outro');
  delete from public.pregoes_gravados_mensagens where chave=md5('c4');
end $$;

-- Cliente logado: lê as colunas públicas (dado compartilhado), não vê quem gravou, não escreve nem chama a RPC.
reset role;
-- seguranca_aprovacao_20261119.sql (M1): a leitura direta exige cadastro aprovado.
insert into public.clientes(id,nome,email,status) values ('f7000000-0000-4000-8000-000000000002','QA pregao B','pregao-b@qa.invalid','aprovado');
set local role authenticated;
select set_config('request.jwt.claim.sub','f7000000-0000-4000-8000-000000000002',true);
do $$ begin
  if (select count(*) from public.pregoes_gravados_propostas) <> 5 then raise exception 'Autenticado não lê propostas'; end if;
  if (select count(*) from public.pregoes_gravados_propostas where leituras_concordantes >= 1 and origem = 'usuario') <> 5 then raise exception 'Autenticado não lê selo'; end if;
  perform id_compra, url, itens, fonte_sem_https from public.pregoes_gravados;
  -- M3: quem gravou não é visível; leituras e leitores, nada.
  begin perform gravado_por from public.pregoes_gravados_propostas; raise exception 'Autenticado leu gravado_por da proposta'; exception when insufficient_privilege then null; end;
  begin perform atualizado_por from public.pregoes_gravados; raise exception 'Autenticado leu atualizado_por'; exception when insufficient_privilege then null; end;
  begin perform gravado_por from public.pregoes_gravados_mensagens; raise exception 'Autenticado leu gravado_por da mensagem'; exception when insufficient_privilege then null; end;
  begin perform * from public.pregoes_gravados_leituras; raise exception 'Autenticado leu leituras'; exception when insufficient_privilege then null; end;
  begin perform * from public.pregoes_gravados_mensagens_leitores; raise exception 'Autenticado leu leitores'; exception when insufficient_privilege then null; end;
  begin perform public.expurgar_pregoes_gravados_por('f7000000-0000-4000-8000-000000000001'); raise exception 'Autenticado executou expurgo'; exception when insufficient_privilege then null; end;
  if (select count(*) from public.pregoes_gravados_mensagens) <> 4 then raise exception 'Autenticado não lê mensagens'; end if;
  begin update public.pregoes_gravados_propostas set marca='x'; raise exception 'Autenticado alterou proposta'; exception when insufficient_privilege then null; end;
  begin insert into public.pregoes_gravados_mensagens(chave,id_compra,numero_item,texto,tipo) values(md5('y'),'19302805900082025',1,'x','outro');
    raise exception 'Autenticado inseriu mensagem'; exception when insufficient_privilege then null; end;
  begin delete from public.pregoes_gravados; raise exception 'Autenticado apagou pregão'; exception when insufficient_privilege then null; end;
  begin perform public.gravar_pregao_gravado('{}'::jsonb,'f7000000-0000-4000-8000-000000000002');
    raise exception 'Autenticado executou a RPC de gravação'; exception when insufficient_privilege then null; end;
end $$;

-- Visitante sem login não lê.
reset role;
set local role anon;
do $$ begin
  begin perform count(*) from public.pregoes_gravados_propostas; raise exception 'Anon leu propostas'; exception when insufficient_privilege then null; end;
  begin perform * from public.pregoes_gravados_leituras; raise exception 'Anon leu leituras'; exception when insufficient_privilege then null; end;
  begin perform public.gravar_pregao_gravado('{}'::jsonb,'f7000000-0000-4000-8000-000000000002'); raise exception 'Anon executou a RPC'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
