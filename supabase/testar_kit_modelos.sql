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
rollback;
