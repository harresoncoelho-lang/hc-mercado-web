-- Teste de prospeccao.sql. Dados fictícios e rollback (nada fica no banco).
-- Papéis simulados com "set local role"; não prova a API HTTP do PostgREST.
begin;
set local role service_role;
insert into public.prospeccao_itens(id,tipo,fonte,uf,orgao_cnpj,orgao_nome,objeto,data_ref,link,busca,coletado_em) values
 ('contrato:QA-1','contrato','pncp','AM','11222333000181','QA órgão','Limpeza predial','2027-03-01','https://pncp.gov.br/app/contratos/11222333000181/2026/1','limpeza predial','2026-11-18'),
 ('ata:QA-2#1#11222333000181','ata','comprasgov_arp','AM','11222333000181','QA órgão','Papel A4','2027-05-01','https://pncp.gov.br/app/atas/11222333000181/2026/2/1','papel a4','2026-11-18');
-- Upsert pela chave (mesmo caminho do robô: on conflict).
insert into public.prospeccao_itens(id,tipo,fonte,uf,data_ref,link,coletado_em) values
 ('contrato:QA-1','contrato','pncp','AM','2027-04-01','https://pncp.gov.br/app/contratos/11222333000181/2026/1','2026-11-19')
 on conflict (id) do update set data_ref=excluded.data_ref,coletado_em=excluded.coletado_em;
do $$ begin
 if (select count(*) from public.prospeccao_itens where id like '%QA-%')<>2 then raise exception 'upsert duplicou'; end if;
 if (select data_ref from public.prospeccao_itens where id='contrato:QA-1')<>'2027-04-01' then raise exception 'upsert não atualizou'; end if;
 -- Limpeza do robô: o que não voltou na coleta do dia sai.
 delete from public.prospeccao_itens where tipo='ata' and uf='AM' and coletado_em<'2026-11-19' and id like 'ata:QA-%';
 if exists(select 1 from public.prospeccao_itens where id='ata:QA-2#1#11222333000181') then raise exception 'limpeza não apagou'; end if;
 begin insert into public.prospeccao_itens(id,tipo,fonte,data_ref,link) values('pca:QA-3','pca','pncp','2027-01-01','https://evil.example.com/x'); raise exception 'link de fora aceito';
 exception when check_violation then null; end;
 begin insert into public.prospeccao_itens(id,tipo,fonte,link,fornecedor_cnpj) values('ata:QA-4','ata','pncp','https://pncp.gov.br/app/atas/1','12345678901'); raise exception 'CPF aceito';
 exception when check_violation then null; end;
 begin insert into public.prospeccao_itens(id,tipo,fonte,link,fornecedor_nome) values('ata:QA-5','ata','pncp','https://pncp.gov.br/app/atas/1','Fulano'); raise exception 'nome sem CNPJ aceito';
 exception when check_violation then null; end;
 begin insert into public.prospeccao_itens(id,tipo,fonte,link) values('xx:QA-6','edital','pncp','https://pncp.gov.br/app/x'); raise exception 'tipo inválido aceito';
 exception when check_violation then null; end;
end $$;
set local role authenticated;
do $$ begin
 if (select count(*) from public.prospeccao_itens where id='contrato:QA-1')<>1 then raise exception 'autenticado não lê'; end if;
 begin insert into public.prospeccao_itens(id,tipo,fonte,link) values('pca:QA-7','pca','pncp','https://pncp.gov.br/app/pca/1/2026'); raise exception 'autenticado gravou';
 exception when insufficient_privilege then null; end;
 begin delete from public.prospeccao_itens where id='contrato:QA-1'; raise exception 'autenticado apagou';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
 if has_table_privilege('anon','public.prospeccao_itens','SELECT') then raise exception 'anon lê prospecção'; end if;
end $$;
rollback;
