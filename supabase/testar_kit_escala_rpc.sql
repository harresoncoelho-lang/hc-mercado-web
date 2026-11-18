-- PREPARADO / NÃO EXECUTADO. SOMENTE clone isolado com migrações kit + escala já instaladas.
-- Nunca produção. Executar como administrador do banco de TESTE para criar fixtures rollback.
-- Não é teste de autenticação HTTP/RLS do usuário: exercita guardas da RPC SECURITY DEFINER.
begin;
do $$
declare
 ua uuid:=gen_random_uuid(); ub uuid:=gen_random_uuid(); oa uuid:=gen_random_uuid(); ob uuid:=gen_random_uuid();
 ea uuid:=gen_random_uuid(); eb uuid:=gen_random_uuid(); pa uuid:=gen_random_uuid(); pb uuid:=gen_random_uuid();
 documento uuid; estranho uuid:=gen_random_uuid(); ids jsonb; dados jsonb; n integer; d public.operacao_kit_documentos;
begin
 insert into auth.users(id,aud,role,email,raw_user_meta_data,created_at,updated_at)
 values(ua,'authenticated','authenticated',ua||'@qa.invalid','{}',now(),now()),(ub,'authenticated','authenticated',ub||'@qa.invalid','{}',now(),now());
 insert into public.clientes(id,nome,email,status) values(ua,'QA escala A',ua||'@qa.invalid','aprovado'),(ub,'QA escala B',ub||'@qa.invalid','aprovado')
 on conflict(id) do update set status='aprovado';
 insert into public.operacao_organizacoes(id,nome,owner_id) values(oa,'QA A',ua),(ob,'QA B',ub);
 insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values(ea,oa,'QA empresa A','11222333000181'),(eb,ob,'QA empresa B','22333444000181');
 insert into public.operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values(oa,ua,'operador',ea),(ob,ub,'operador',eb);
 insert into public.operacao_processos(id,organizacao_id,empresa_id,objeto,numero) values(pa,oa,ea,'QA fictício','QA-A'),(pb,ob,eb,'QA fictício','QA-B');
 insert into public.operacao_itens_resultado(organizacao_id,processo_id,identificador,descricao,quantidade,valor_unitario_proposta)
 select oa,pa,i::text,'Material fictício',2,1.25 from generate_series(1,1001)i;
 insert into public.operacao_itens_resultado(id,organizacao_id,processo_id,identificador) values(estranho,ob,pb,'QA estrangeiro');
 foreach n in array array[51,1000] loop
  select jsonb_agg(id::text order by id) into ids from(select id from public.operacao_itens_resultado where processo_id=pa order by id limit n)s;
  dados:=jsonb_build_object('proposta',jsonb_build_object('itemIds',ids,'unidades',(select jsonb_object_agg(i,'un') from jsonb_array_elements_text(ids)s(i)),'validade','30 dias','prazoEntrega','10 dias','pagamento','30 dias'));
  documento:=gen_random_uuid();
  d:=public.gravar_kit_documento(documento,ea,pa,oa,ua,0,'proposta','salvar',dados);
  if d.versao<>1 or jsonb_array_length(d.dados->'proposta'->'itemIds')<>n then raise exception 'salvar perdeu itens';end if;
  d:=public.gravar_kit_documento(documento,ea,pa,oa,ua,1,'proposta','confirmarRevisao',dados,repeat('a',64),jsonb_build_object('texto','Prévia fictícia','fontes','[]'::jsonb));
  if d.revisao_versao<>1 then raise exception 'Revisão não gravada';end if;
  d:=public.gravar_kit_documento(documento,ea,pa,oa,ua,1,'proposta','salvar',dados);
  if d.versao<>2 or d.revisao_hash is not null then raise exception 'Edição não invalidou revisão';end if;
  begin
   perform public.gravar_kit_documento(documento,ea,pa,oa,ua,1,'proposta','salvar',dados);
   raise exception 'CAS aceitou versão antiga';
  exception when sqlstate 'PT409' then null;end;
  begin
   perform public.gravar_kit_documento(documento,ea,pa,oa,ub,2,'proposta','salvar',dados);
   raise exception 'Usuário de outro CNPJ autorizado';
  exception when sqlstate 'PT403' then null;end;
  begin
   perform public.gravar_kit_documento(documento,eb,pb,ob,ua,2,'proposta','salvar',dados);
   raise exception 'Empresa de outro tenant autorizada';
  exception when sqlstate 'PT403' then null;end;
 end loop;
 dados:=jsonb_set(dados,'{proposta,itemIds}',jsonb_build_array(estranho::text));dados:=jsonb_set(dados,'{proposta,unidades}',jsonb_build_object(estranho::text,'un'));
 begin
  perform public.gravar_kit_documento(gen_random_uuid(),ea,pa,oa,ua,0,'proposta','salvar',dados);
  raise exception 'Item de outro processo autorizado';
 exception when sqlstate 'PT404' then null;end;
 select jsonb_agg(id::text) into ids from public.operacao_itens_resultado where processo_id=pa;
 dados:=jsonb_set(dados,'{proposta,itemIds}',ids);
 dados:=jsonb_set(dados,'{proposta,unidades}',(select jsonb_object_agg(i,'un') from jsonb_array_elements_text(ids)s(i)));
 if jsonb_array_length(ids)<>1001 or (select count(distinct i) from jsonb_array_elements_text(ids)s(i))<>1001
 then raise exception 'Fixture 1001 não é única e completa';end if;
 begin
  perform public.gravar_kit_documento(gen_random_uuid(),ea,pa,oa,ua,0,'proposta','salvar',dados);
  raise exception 'Limite1001 aceito';
 exception when sqlstate 'PT400' then
  if sqlerrm<>'Itens duplicados ou excessivos' then raise;end if;
 end;
end $$;
rollback;

