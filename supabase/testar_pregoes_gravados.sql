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

-- Cliente logado: lê tudo (dado público compartilhado), não escreve nem chama a RPC.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','f7000000-0000-4000-8000-000000000002',true);
do $$ begin
  if (select count(*) from public.pregoes_gravados_propostas) <> 3 then raise exception 'Autenticado não lê propostas'; end if;
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
  begin perform public.gravar_pregao_gravado('{}'::jsonb,'f7000000-0000-4000-8000-000000000002'); raise exception 'Anon executou a RPC'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
