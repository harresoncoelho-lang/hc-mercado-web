-- Preparada para revisão; não aplicada. Requer base operacional e isolamento por empresa.
begin;
create table public.operacao_vinculos_compra (
 processo_id uuid primary key references public.operacao_processos(id) on delete cascade,
 empresa_id uuid not null references public.operacao_empresas(id), organizacao_id uuid not null,
 versao integer not null check(versao>0), processo_snapshot text not null,
 cnpj_revisado text not null, uasg_revisada text not null, numero text not null, ano text not null,
 compra text not null, url_compra text not null,
 fonte_tipo text not null default 'revisao_humana_referencia_publica',
 revisado_por uuid not null references auth.users(id), revisado_em timestamptz not null default now(),
 invalidado_em timestamptz, motivo_invalidacao text
);
alter table public.operacao_vinculos_compra enable row level security;
revoke all on public.operacao_vinculos_compra from anon,authenticated;
create table public.operacao_vinculos_compra_historico (
 id bigint generated always as identity primary key,
 processo_id uuid not null,
 versao integer not null,
 registrado_em timestamptz not null default now(),
 snapshot jsonb not null,
 unique(processo_id,versao)
);
alter table public.operacao_vinculos_compra_historico enable row level security;
revoke all on public.operacao_vinculos_compra_historico from anon,authenticated;
create function public.operacao_historico_vinculo_compra() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.operacao_vinculos_compra_historico(processo_id,versao,snapshot) values(OLD.processo_id,OLD.versao,to_jsonb(OLD));
 return NEW;
end $$;
create trigger operacao_historico_vinculo_compra before update on public.operacao_vinculos_compra for each row execute function public.operacao_historico_vinculo_compra();
revoke all on function public.operacao_historico_vinculo_compra() from public,anon,authenticated;

create function public.operacao_invalidar_vinculo_compra() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if TG_TABLE_NAME='operacao_processos' then
  if row(NEW.sistema,NEW.uasg,NEW.numero,NEW.url_origem,NEW.empresa_id,NEW.organizacao_id) is distinct from row(OLD.sistema,OLD.uasg,OLD.numero,OLD.url_origem,OLD.empresa_id,OLD.organizacao_id) then
   update public.operacao_vinculos_compra set invalidado_em=now(),motivo_invalidacao='Processo alterado',versao=versao+1 where processo_id=NEW.id;
  end if;
 else
  if row(NEW.cnpj,NEW.organizacao_id,NEW.ativo) is distinct from row(OLD.cnpj,OLD.organizacao_id,OLD.ativo) then
   update public.operacao_vinculos_compra set invalidado_em=now(),motivo_invalidacao='Empresa alterada',versao=versao+1 where empresa_id=NEW.id;
  end if;
 end if;
 return NEW;
end $$;
create trigger operacao_vinculo_processo_alterado after update on public.operacao_processos for each row execute function public.operacao_invalidar_vinculo_compra();
create trigger operacao_vinculo_empresa_alterada after update on public.operacao_empresas for each row execute function public.operacao_invalidar_vinculo_compra();

create function public.operacao_vinculo_compra(p_empresa uuid,p_processo uuid,p_acao text,p_versao integer default null,p_snapshot text default null,p_dados jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.operacao_empresas%rowtype; p public.operacao_processos%rowtype; v public.operacao_vinculos_compra%rowtype; fingerprint text; current_cnpj text; member_found boolean;
begin
 if auth.uid() is null or p_acao is null or p_acao not in ('consultar','confirmar') then return jsonb_build_object('status',403,'erro','Acesso negado'); end if;
 select * into e from public.operacao_empresas where id=p_empresa for update;
 if not found or not e.ativo then return jsonb_build_object('status',404,'erro','Empresa indisponível'); end if;
 perform 1 from public.operacao_membros where usuario_id=auth.uid() and organizacao_id=e.organizacao_id and papel in ('gestor','operador') and (empresa_id is null or empresa_id=e.id) for share;
 member_found=FOUND;
 if not member_found then return jsonb_build_object('status',403,'erro','Acesso negado'); end if;
 perform 1 from public.clientes where id=auth.uid() and status='aprovado' for share;
 if not found then return jsonb_build_object('status',403,'erro','Acesso negado'); end if;
 select * into p from public.operacao_processos where id=p_processo and empresa_id=e.id and organizacao_id=e.organizacao_id for update;
 if not found then return jsonb_build_object('status',404,'erro','Processo indisponível'); end if;
 current_cnpj=regexp_replace(coalesce(e.cnpj,''),'[^0-9]','','g');
 fingerprint=md5(jsonb_build_array(p.sistema,p.uasg,p.numero,p.url_origem,p.empresa_id,p.organizacao_id,current_cnpj)::text);
 select * into v from public.operacao_vinculos_compra where processo_id=p.id for update;
 if v.processo_id is not null and (v.cnpj_revisado<>current_cnpj or v.organizacao_id<>e.organizacao_id or v.processo_snapshot<>fingerprint) and v.invalidado_em is null then
  update public.operacao_vinculos_compra set invalidado_em=now(),motivo_invalidacao='Contexto alterado',versao=versao+1 where processo_id=p.id returning * into v;
 end if;
 if p_acao='consultar' then return jsonb_build_object('status',200,'processoSnapshot',fingerprint,'versao',coalesce(v.versao,0),'vinculo',case when v.processo_id is null then null else to_jsonb(v) end,'cnpj',current_cnpj,'uasg',p.uasg,'sistema',p.sistema); end if;
 if p_snapshot is distinct from fingerprint or p_versao is distinct from coalesce(v.versao,0) then return jsonb_build_object('status',409,'erro','Processo, empresa ou revisão alterados. Consulte novamente.'); end if;
 if current_cnpj!~'^[0-9]{14}$' or coalesce(p.uasg,'')!~'^[0-9]{6}$' or lower(coalesce(p.sistema,'')) not in ('compras.gov.br','comprasgov','compras.gov')
  or p_dados is null or jsonb_typeof(p_dados)<>'object' or (select count(*) from jsonb_object_keys(p_dados))<>4
  or (case when coalesce(p_dados->>'numero','')~'^[0-9]{1,5}$' then (p_dados->>'numero')::integer<1 else true end)
  or coalesce(p_dados->>'ano','')!~'^[0-9]{4}$' or coalesce(p_dados->>'compra','')!~'^[0-9]{17}$'
  or (p_dados->>'url') is distinct from ('https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/cadastro-propostas?compra='||(p_dados->>'compra'))
 then return jsonb_build_object('status',422,'erro','Confira sistema, UASG e referência da compra.'); end if;
 insert into public.operacao_vinculos_compra(processo_id,empresa_id,organizacao_id,versao,processo_snapshot,cnpj_revisado,uasg_revisada,numero,ano,compra,url_compra,revisado_por)
 values(p.id,e.id,e.organizacao_id,coalesce(v.versao,0)+1,fingerprint,current_cnpj,p.uasg,p_dados->>'numero',p_dados->>'ano',p_dados->>'compra',p_dados->>'url',auth.uid())
 on conflict(processo_id) do update set empresa_id=excluded.empresa_id,organizacao_id=excluded.organizacao_id,versao=excluded.versao,processo_snapshot=excluded.processo_snapshot,cnpj_revisado=excluded.cnpj_revisado,uasg_revisada=excluded.uasg_revisada,numero=excluded.numero,ano=excluded.ano,compra=excluded.compra,url_compra=excluded.url_compra,revisado_por=excluded.revisado_por,revisado_em=now(),invalidado_em=null,motivo_invalidacao=null returning * into v;
 return jsonb_build_object('status',200,'processoSnapshot',fingerprint,'versao',v.versao,'vinculo',to_jsonb(v),'cnpj',current_cnpj,'uasg',p.uasg,'sistema',p.sistema);
end $$;
revoke all on function public.operacao_vinculo_compra(uuid,uuid,text,integer,text,jsonb) from public,anon;
grant execute on function public.operacao_vinculo_compra(uuid,uuid,text,integer,text,jsonb) to authenticated;
revoke all on function public.operacao_invalidar_vinculo_compra() from public,anon,authenticated;
commit;
