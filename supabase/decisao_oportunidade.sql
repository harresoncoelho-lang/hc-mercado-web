-- Aplicar em homologação antes de habilitar DECISAO_CLIENTE_ATIVA=1.
begin;
create table if not exists public.decisoes_oportunidade (
 id uuid primary key default gen_random_uuid(),
 usuario_id uuid not null references auth.users(id),
 empresa_id uuid not null references public.operacao_empresas(id),
 destinatario text not null, edital text not null, objeto text not null,
 empresa_nome text not null, empresa_cnpj text not null,
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 criado_em timestamptz not null default now(), expira_em timestamptz not null default now()+interval '7 days',
 envio_status text not null default 'preparado' check(envio_status in ('preparado','enviado','falhou','incerto')),
 decisao text check(decisao in ('participar','nao_participar')), respondido_em timestamptz, nome_declarado text
);
alter table public.decisoes_oportunidade enable row level security;
revoke all on public.decisoes_oportunidade from public,anon,authenticated;
grant all on public.decisoes_oportunidade to service_role;

create or replace function public.criar_decisao_oportunidade(p_usuario uuid,p_empresa uuid,p_destino text,p_edital text,p_objeto text,p_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.operacao_empresas;
begin
 select x.* into e from public.operacao_empresas x join public.operacao_membros m on m.organizacao_id=x.organizacao_id
 join public.clientes c on c.id=m.usuario_id and c.status='aprovado'
 where x.id=p_empresa and m.usuario_id=p_usuario and m.papel in ('gestor','operador') and (m.empresa_id is null or m.empresa_id=x.id);
 if e.id is null then return jsonb_build_object('ok',false); end if;
 if length(p_destino)>254 or length(p_edital)>100 or length(p_objeto)>1000 then raise exception 'Entrada inválida'; end if;
 insert into public.decisoes_oportunidade(usuario_id,empresa_id,destinatario,edital,objeto,empresa_nome,empresa_cnpj,token_hash)
 values(p_usuario,e.id,p_destino,p_edital,p_objeto,e.razao_social,coalesce(e.cnpj,''),p_hash);
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.responder_decisao_oportunidade(p_hash text,p_decisao text default null,p_nome text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.decisoes_oportunidade;
begin
 select * into r from public.decisoes_oportunidade where token_hash=p_hash for update;
 if r.id is null or r.expira_em<=now() or r.envio_status='falhou' then return null; end if;
 if p_decisao is not null then
  if p_decisao not in ('participar','nao_participar') or p_nome is null or length(trim(p_nome))<2 or length(p_nome)>100 then raise exception 'Decisão inválida'; end if;
  if r.decisao is not null and r.decisao<>p_decisao then return jsonb_build_object('conflito',true); end if;
  if r.decisao is null then
   update public.decisoes_oportunidade set decisao=p_decisao,nome_declarado=trim(p_nome),respondido_em=now() where id=r.id returning * into r;
  end if;
 end if;
 return jsonb_build_object('empresa',r.empresa_nome,'cnpj',r.empresa_cnpj,'edital',r.edital,'objeto',r.objeto,'decisao',r.decisao,'respondidoEm',r.respondido_em,'expiraEm',r.expira_em);
end $$;

create or replace function public.listar_decisoes_oportunidade(p_usuario uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
 select d.id,d.empresa_nome,d.edital,d.objeto,d.destinatario,d.decisao,d.respondido_em,d.nome_declarado,d.expira_em,d.envio_status
 from public.decisoes_oportunidade d
 where d.usuario_id=p_usuario and exists(select 1 from public.operacao_empresas e join public.operacao_membros m on m.organizacao_id=e.organizacao_id join public.clientes c on c.id=m.usuario_id and c.status='aprovado'
 where e.id=d.empresa_id and m.usuario_id=p_usuario and (m.empresa_id is null or m.empresa_id=e.id))
 order by d.criado_em desc limit 100) x;
$$;
create or replace function public.marcar_envio_decisao(p_hash text,p_usuario uuid,p_status text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_status not in ('enviado','falhou','incerto') then return false; end if;
 update public.decisoes_oportunidade set envio_status=p_status where token_hash=p_hash and usuario_id=p_usuario and envio_status='preparado';
 return found;
end $$;
revoke all on function public.marcar_envio_decisao(text,uuid,text) from public,anon,authenticated;
grant execute on function public.marcar_envio_decisao(text,uuid,text) to service_role;
revoke all on function public.criar_decisao_oportunidade(uuid,uuid,text,text,text,text), public.responder_decisao_oportunidade(text,text,text), public.listar_decisoes_oportunidade(uuid) from public,anon,authenticated;
grant execute on function public.criar_decisao_oportunidade(uuid,uuid,text,text,text,text), public.responder_decisao_oportunidade(text,text,text), public.listar_decisoes_oportunidade(uuid) to service_role;
commit;
