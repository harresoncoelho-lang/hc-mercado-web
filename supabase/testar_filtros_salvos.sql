-- Teste de filtros_salvos.sql. Dados fictícios e rollback. Papéis com "set local role"; não prova a API HTTP.
begin;
insert into auth.users(id,email) values ('00000000-0000-4000-8000-0000000fa001','a@example.invalid'),('00000000-0000-4000-8000-0000000fa002','b@example.invalid');
do $$
declare a uuid := '00000000-0000-4000-8000-0000000fa001'; b uuid := '00000000-0000-4000-8000-0000000fa002'; n int; id1 uuid;
begin
  perform set_config('request.jwt.claim.sub', a::text, true);
  set local role authenticated;
  insert into public.filtros_salvos(nome, filtro) values ('Limpeza AM', '{"palavrasRaw":"limpeza"}') returning id into id1;
  begin insert into public.filtros_salvos(nome, filtro) values ('  limpeza am ', '{"palavrasRaw":"x"}'); raise exception 'nome repetido aceito';
  exception when unique_violation then null; end;
  begin insert into public.filtros_salvos(nome, filtro) values ('', '{}'); raise exception 'nome vazio aceito';
  exception when check_violation then null; end;
  begin insert into public.filtros_salvos(nome, filtro) values ('x', '[]'); raise exception 'filtro não objeto aceito';
  exception when check_violation then null; end;
  begin insert into public.filtros_salvos(cliente_id, nome, filtro) values (b, 'de outro', '{}'); raise exception 'gravou para outra conta';
  exception when insufficient_privilege then null; end;
  update public.filtros_salvos set nome = 'Limpeza renomeada' where id = id1;
  if (select nome from public.filtros_salvos where id = id1) <> 'Limpeza renomeada' then raise exception 'renomear falhou'; end if;
  for n in 1..19 loop insert into public.filtros_salvos(nome, filtro) values ('f' || n, '{}'); end loop;
  begin insert into public.filtros_salvos(nome, filtro) values ('f21', '{}'); raise exception 'passou do limite de 20';
  exception when check_violation then null; end;
  insert into public.editais_sem_interesse(numero_controle, objeto_resumo) values ('11222333000181-1-000001/2026', 'Objeto');
  begin insert into public.editais_sem_interesse(numero_controle) values ('11222333000181-1-000001/2026'); raise exception 'descarte duplicado aceito';
  exception when unique_violation then null; end;
  -- Outra conta não vê nada da A e não apaga nada dela.
  perform set_config('request.jwt.claim.sub', b::text, true);
  if (select count(*) from public.filtros_salvos) <> 0 or (select count(*) from public.editais_sem_interesse) <> 0 then raise exception 'vazou entre contas'; end if;
  delete from public.filtros_salvos; get diagnostics n = row_count;
  if n <> 0 then raise exception 'apagou filtro de outra conta'; end if;
  reset role;
  if (select count(*) from public.filtros_salvos where cliente_id = a) <> 20 then raise exception 'filtros da A não preservados'; end if;
  set local role anon;
  begin perform 1 from public.filtros_salvos; raise exception 'anon leu';
  exception when insufficient_privilege then null; end;
  reset role;
  if to_regclass('public.lembretes') is not null then
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', a::text, true);
    insert into public.lembretes(cliente_id, numero_controle_pncp, data_final_proposta, dias_antes, hora_aviso) values (a, 'x', now(), 1, 14);
    begin insert into public.lembretes(cliente_id, numero_controle_pncp, dias_antes, hora_aviso) values (a, 'y', 1, 24); raise exception 'hora 24 aceita';
    exception when check_violation then null; end;
    reset role;
  end if;
end $$;
rollback;
