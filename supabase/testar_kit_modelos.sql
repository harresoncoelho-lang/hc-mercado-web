-- Teste de operacao_kit_modelos.sql com os dados fictícios do ensaio (testar-dezembro.cjs). Tudo em rollback.
begin;
do $$
declare
 org uuid:='00000000-0000-4000-8000-000000000001'; emp uuid:='00000000-0000-4000-8000-000000000011';
 proc uuid:='00000000-0000-4000-8000-000000000021'; gestor uuid:='00000000-0000-4000-8000-000000000101';
 doc uuid:='00000000-0000-4000-8000-000000000902'; manual uuid:='00000000-0000-4000-8000-000000000903';
 dados jsonb:='{"declaracao":{"titulo":"Declaração fictícia","texto":"Texto fictício","fonte":"Biblioteca"}}';
 d public.operacao_kit_documentos; antes timestamptz;
begin
 d:=public.gravar_kit_declaracao_modelo(doc,emp,proc,org,gestor,dados,'HAB_ART63_I');
 assert d.modelo_codigo='HAB_ART63_I' and d.formato=2 and d.versao=1, 'peça nova com modelo e formato 2';
 antes:=d.atualizado_em;
 -- Mesma intenção: a mesma peça, sem nova versão nem carimbo novo.
 d:=public.gravar_kit_declaracao_modelo(doc,emp,proc,org,gestor,dados,'HAB_ART63_I');
 assert d.versao=1 and d.atualizado_em=antes and (select count(*) from public.operacao_kit_documentos where id=doc)=1, 'lote idempotente';
 begin
  perform public.gravar_kit_declaracao_modelo(doc,emp,proc,org,gestor,dados,'TRAB_MENOR');
  raise exception 'modelo divergente deveria falhar';
 exception when sqlstate 'PT409' then null;
 end;
 begin
  perform public.gravar_kit_declaracao_modelo(manual,emp,proc,org,gestor,dados,'ruim;');
  raise exception 'modelo inválido deveria falhar';
 exception when sqlstate 'PT400' then null;
 end;
 -- Caminho antigo (salvar manual) continua igual: sem modelo = 'livre' na resposta.
 d:=public.gravar_kit_documento(manual,emp,proc,org,gestor,0,'declaracao','salvar',dados);
 assert d.modelo_codigo is null, 'salvar manual sem modelo';
 begin
  insert into public.operacao_kit_documentos(id,organizacao_id,empresa_id,processo_id,tipo,dados,criado_por,atualizado_por,modelo_codigo)
   values(gen_random_uuid(),org,emp,proc,'proposta','{"proposta":{}}',gestor,gestor,'HAB_ART63_I');
  raise exception 'proposta com modelo deveria falhar';
 exception when check_violation then null;
 end;
 assert not has_function_privilege('authenticated','public.gravar_kit_declaracao_modelo(uuid,uuid,uuid,uuid,uuid,jsonb,text)','EXECUTE')
  and not has_function_privilege('anon','public.gravar_kit_declaracao_modelo(uuid,uuid,uuid,uuid,uuid,jsonb,text)','EXECUTE')
  and has_function_privilege('service_role','public.gravar_kit_declaracao_modelo(uuid,uuid,uuid,uuid,uuid,jsonb,text)','EXECUTE'), 'EXECUTE só service_role';
end $$;

-- LGPD (A1): o kit é legível pelo papel leitura, então rascunho e revisão guardam só o marcador do CPF
-- (é o que _kit_declaracoes.js grava); o CPF fica no perfil, que o papel leitura não lê.
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000199','leitura-kit@example.invalid');
insert into public.clientes(id,nome,email,status) values('00000000-0000-4000-8000-000000000199','Leitura fictícia','leitura-kit@example.invalid','aprovado');
insert into public.operacao_membros(organizacao_id,usuario_id,papel) values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000199','leitura');
insert into public.operacao_perfil_empresa(empresa_id,organizacao_id,cpf_representante) values('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','52998224725')
 on conflict (empresa_id) do update set cpf_representante=excluded.cpf_representante;
do $$
declare
 org uuid:='00000000-0000-4000-8000-000000000001'; emp uuid:='00000000-0000-4000-8000-000000000011';
 proc uuid:='00000000-0000-4000-8000-000000000021'; gestor uuid:='00000000-0000-4000-8000-000000000101';
 doc uuid:='00000000-0000-4000-8000-000000000904';
 dados jsonb:='{"declaracao":{"titulo":"Declaração fictícia","texto":"Eu, CPF {{cpf_representante}}, declaro.","fonte":"Biblioteca"}}';
begin
 perform public.gravar_kit_declaracao_modelo(doc,emp,proc,org,gestor,dados,'TRAB_MENOR');
 perform public.gravar_kit_documento(doc,emp,proc,org,gestor,1,'declaracao','confirmarRevisao',dados,repeat('c',64),
  '{"texto":"Eu, CPF [CPF do representante], declaro.","fontes":["f"]}'::jsonb);
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000199',true);
do $$
declare t text;
begin
 select dados::text||coalesce(revisao_previa::text,'') into t from public.operacao_kit_documentos where id='00000000-0000-4000-8000-000000000904';
 assert t is not null, 'papel leitura deveria ler a peça do kit';
 assert t not like '%52998224725%' and t not like '%529.982.247-25%' and t like '%{{cpf_representante}}%', 'papel leitura leu CPF no kit';
 assert not exists(select 1 from public.operacao_perfil_empresa), 'papel leitura leu o perfil (CPF)';
end $$;
rollback;
