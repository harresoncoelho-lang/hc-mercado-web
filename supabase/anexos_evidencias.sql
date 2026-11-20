-- PREPARADO, NÃO APLICADO. Evidência da versão selecionada, sem vigência jurídica presumida.
begin;
create table public.operacao_anexo_versoes (
 anexo_id uuid not null references public.operacao_anexos_processo(id) on delete cascade,
 hash text not null check(hash ~ '^[a-f0-9]{64}$'), organizacao_id uuid not null,empresa_id uuid not null,processo_id uuid not null,
 arquivo_caminho text not null,extrator_versao text not null,paginas jsonb not null,
 selecionada boolean not null default false,selecionada_por uuid,selecionada_em timestamptz,
 criado_em timestamptz not null default now(),primary key(anexo_id,hash),
 check(jsonb_typeof(paginas)='array' and jsonb_array_length(paginas) between 1 and 20 and octet_length(paginas::text)<=900000)
);
create unique index operacao_anexo_versao_selecionada on public.operacao_anexo_versoes(anexo_id) where selecionada;
alter table public.operacao_anexo_versoes enable row level security;
revoke all on public.operacao_anexo_versoes from public,anon,authenticated;
grant select on public.operacao_anexo_versoes to authenticated;
create policy evidencia_anexo_leitura on public.operacao_anexo_versoes for select to authenticated using (
 exists(select 1 from public.clientes c where c.id=auth.uid() and c.status='aprovado')
 and public.pode_acessar_processo_operacao(organizacao_id,processo_id)
 and exists(select 1 from public.operacao_processos p join public.operacao_empresas e on e.id=p.empresa_id
 where p.id=processo_id and p.organizacao_id=operacao_anexo_versoes.organizacao_id and p.empresa_id=operacao_anexo_versoes.empresa_id and e.ativo)
);
create function public.validar_escopo_evidencia_anexo(p_usuario uuid,p_anexo uuid,p_empresa uuid,p_caminho text) returns public.operacao_anexos_processo
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a public.operacao_anexos_processo;
begin
 select x.* into a from public.operacao_anexos_processo x join public.operacao_processos p on p.id=x.processo_id and p.organizacao_id=x.organizacao_id
 join public.operacao_empresas e on e.id=p.empresa_id and e.organizacao_id=p.organizacao_id
 where x.id=p_anexo and e.id=p_empresa and e.ativo and x.tipo='edital' and x.arquivo_caminho=p_caminho
 and p_caminho like e.organizacao_id::text||'/'||e.id::text||'/'||p.id::text||'/%'
 and exists(select 1 from public.clientes c where c.id=p_usuario and c.status='aprovado')
 and exists(select 1 from public.operacao_membros m where m.usuario_id=p_usuario and m.organizacao_id=e.organizacao_id and m.papel in('gestor','operador') and (m.empresa_id is null or m.empresa_id=e.id)) for update of x;
 if a.id is null then raise exception using errcode='42501',message='Escopo não autorizado';end if;return a;
end $$;
create function public.registrar_evidencia_anexo(p_usuario uuid,p_anexo uuid,p_empresa uuid,p_caminho text,p_hash text,p_extrator text,p_paginas jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a public.operacao_anexos_processo;v public.operacao_anexo_versoes;n integer;item jsonb;
begin
 a:=public.validar_escopo_evidencia_anexo(p_usuario,p_anexo,p_empresa,p_caminho);
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_extrator is distinct from 'anexo-pdf-1' or jsonb_typeof(p_paginas) is distinct from 'array' or jsonb_array_length(p_paginas) not between 1 and 20 or octet_length(p_paginas::text)>900000 then raise exception 'Evidência inválida';end if;
 n:=0;for item in select value from jsonb_array_elements(p_paginas) loop n:=n+1;
 if jsonb_typeof(item) is distinct from 'object' or item-array['pagina','texto']<>'{}'::jsonb or item->>'pagina' is distinct from n::text or jsonb_typeof(item->'texto') is distinct from 'string' then raise exception 'Página inválida';end if;end loop;
 if (select sum(length(value->>'texto')) from jsonb_array_elements(p_paginas))>150000 then raise exception 'Texto excede limite';end if;
 select * into v from public.operacao_anexo_versoes where anexo_id=p_anexo and hash=p_hash;
 if v.anexo_id is not null and (v.paginas<>p_paginas or v.extrator_versao<>p_extrator or v.arquivo_caminho<>p_caminho) then raise exception 'Versão imutável divergente';end if;
 update public.operacao_anexo_versoes set selecionada=false,selecionada_por=null,selecionada_em=null where anexo_id=p_anexo and hash<>p_hash and selecionada;
 insert into public.operacao_anexo_versoes(anexo_id,hash,organizacao_id,empresa_id,processo_id,arquivo_caminho,extrator_versao,paginas)
 values(p_anexo,p_hash,a.organizacao_id,p_empresa,a.processo_id,p_caminho,p_extrator,p_paginas) on conflict(anexo_id,hash) do nothing;
 select * into v from public.operacao_anexo_versoes where anexo_id=p_anexo and hash=p_hash;
 return jsonb_build_object('hash',v.hash,'paginas',v.paginas,'extrator_versao',v.extrator_versao,'selecionada',v.selecionada);
end $$;
create function public.selecionar_versao_anexo(p_usuario uuid,p_anexo uuid,p_empresa uuid,p_caminho text,p_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a public.operacao_anexos_processo;v public.operacao_anexo_versoes;
begin
 a:=public.validar_escopo_evidencia_anexo(p_usuario,p_anexo,p_empresa,p_caminho);
 select * into v from public.operacao_anexo_versoes where anexo_id=p_anexo and hash=p_hash and arquivo_caminho=p_caminho and empresa_id=p_empresa and processo_id=a.processo_id and organizacao_id=a.organizacao_id;
 if v.anexo_id is null then raise exception 'Versão não observada';end if;
 update public.operacao_anexo_versoes set selecionada=false,selecionada_por=null,selecionada_em=null where anexo_id=p_anexo and selecionada;
 update public.operacao_anexo_versoes set selecionada=true,selecionada_por=p_usuario,selecionada_em=clock_timestamp() where anexo_id=p_anexo and hash=p_hash;
 return jsonb_build_object('hash',v.hash,'paginas',v.paginas,'extrator_versao',v.extrator_versao,'selecionada',true);
end $$;
revoke all on function public.validar_escopo_evidencia_anexo(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.registrar_evidencia_anexo(uuid,uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.selecionar_versao_anexo(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.registrar_evidencia_anexo(uuid,uuid,uuid,text,text,text,jsonb) to service_role;
grant execute on function public.selecionar_versao_anexo(uuid,uuid,uuid,text,text) to service_role;
commit;
