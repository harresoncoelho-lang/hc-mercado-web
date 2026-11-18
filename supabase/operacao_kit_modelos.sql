-- Kit: código do modelo da declaração e formato da proposta (esteira, tarefa E11).
-- Idempotente, transação única; rodar no SQL Editor depois do 01-aplicar.sql (kit_documentos.sql).
-- Não altera gravar_kit_documento (assinatura e corpo conferidos pelo 02/verificar_kit_prepublicacao)
-- nem cria policy, trigger ou grant de escrita na tabela do kit: o gate do kit continua igual.
begin;
do $$ begin
 if to_regclass('public.operacao_kit_documentos') is null
  or to_regprocedure('public.gravar_kit_documento(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,jsonb)') is null then
  raise exception 'Aplique antes kit_documentos.sql (01-aplicar.sql)';
 end if;
end $$;

-- modelo_codigo: código da biblioteca (declaracoes-modelos.js), 'edital' (texto literal do edital) ou 'livre'.
-- Nulo = peça antiga/manual, exibida como 'livre'. Só declaração tem modelo.
alter table public.operacao_kit_documentos add column if not exists modelo_codigo text;
-- formato: 1 = proposta em texto corrido (todas as peças existentes); 2 = proposta em tabela.
-- O add com default 1 fixa as linhas existentes em 1; só as peças criadas depois nascem em 2.
alter table public.operacao_kit_documentos add column if not exists formato smallint not null default 1;
alter table public.operacao_kit_documentos alter column formato set default 2;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='operacao_kit_documentos_modelo_codigo_chk'
  and conrelid='public.operacao_kit_documentos'::regclass) then
  alter table public.operacao_kit_documentos add constraint operacao_kit_documentos_modelo_codigo_chk
   check (modelo_codigo is null or (tipo='declaracao' and modelo_codigo ~ '^(edital|livre|[A-Z][A-Z0-9_]{1,59})$'));
 end if;
 if not exists(select 1 from pg_constraint where conname='operacao_kit_documentos_formato_chk'
  and conrelid='public.operacao_kit_documentos'::regclass) then
  alter table public.operacao_kit_documentos add constraint operacao_kit_documentos_formato_chk check (formato in (1,2));
 end if;
end $$;

-- Rascunho novo de declaração com modelo, numa transação: a validação, o escopo, a autoria e a
-- idempotência por id continuam todos em gravar_kit_documento; aqui só se carimba modelo_codigo.
-- Não toca atualizado_em (o carimbo é a mesma intenção da criação).
create or replace function public.gravar_kit_declaracao_modelo(
 p_documento uuid,p_empresa uuid,p_processo uuid,p_organizacao uuid,p_usuario uuid,p_dados jsonb,p_modelo text
) returns public.operacao_kit_documentos language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare d public.operacao_kit_documentos;
begin
 if p_modelo is null or p_modelo !~ '^(edital|livre|[A-Z][A-Z0-9_]{1,59})$'
 then raise sqlstate 'PT400' using message='Modelo inválido';end if;
 d:=public.gravar_kit_documento(p_documento,p_empresa,p_processo,p_organizacao,p_usuario,0,'declaracao','salvar',p_dados);
 if d.modelo_codigo is null then
  update public.operacao_kit_documentos set modelo_codigo=p_modelo where id=d.id returning * into d;
 elsif d.modelo_codigo<>p_modelo then
  raise sqlstate 'PT409' using message='Modelo divergente';
 end if;
 return d;
end $$;
revoke all on function public.gravar_kit_declaracao_modelo(uuid,uuid,uuid,uuid,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.gravar_kit_declaracao_modelo(uuid,uuid,uuid,uuid,uuid,jsonb,text) to service_role;

notify pgrst, 'reload schema';
commit;
