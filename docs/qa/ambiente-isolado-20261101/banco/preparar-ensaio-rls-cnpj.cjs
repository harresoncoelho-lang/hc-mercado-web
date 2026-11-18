// Gera um único ensaio SQL transacional das fixtures existentes. Sem banco/rede/runtime.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const ler=n=>fs.readFileSync(path.join(__dirname,n),'utf8');
const catalogoTexto=ler('catalogo-posdelta-staging.json');
assert.equal(sha(catalogoTexto),'7d81af6a57cd1b7a6f57ab33f6f25c984443c472edeb0a4e8ed7c3ae869b0cf7');
const catalogo=JSON.parse(catalogoTexto);
assert.equal(catalogo.hash_catalogo_md5,'830899ecee2a58d23beec619b4963fed');
assert.equal(catalogo.server_version,'17.11');assert.equal(catalogo.read_only,'on');
const consulta=ler('../../migracoes-capacidade-20261031/01-catalogo-readonly.sql');
assert.equal(sha(consulta),'7234ddc5a239aac1152ca70fa1322086b586465fef6f5406bec3a7d17f9d2ce3');
const cte=consulta.slice(consulta.indexOf('with\n'),consulta.indexOf("select jsonb_build_object('versao_consulta'"));
const tabelas=[...catalogo.catalogo.relacoes.filter(x=>x.esquema==='public').map(x=>x.nome),'dados_robo'];
assert.equal(tabelas.length,21);assert(tabelas.every(x=>/^[a-z_]+$/.test(x)));
const authObrigatorias=catalogo.catalogo.colunas.filter(x=>x.esquema==='auth'&&x.tabela==='users'&&x.not_null&&x.default===null).map(x=>x.nome);
assert.deepEqual(authObrigatorias,['id']);
assert.deepEqual(catalogo.catalogo.triggers.filter(x=>x.esquema==='auth'&&x.tabela==='users').map(x=>x.nome),['on_auth_user_created']);
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const literal=x=>"'"+String(x).replaceAll("'","''")+"'";
const uuid=n=>literal(id(n))+'::uuid';
const array=ns=>`array[${ns.map(uuid).join(',')}]::uuid[]`;
const declaracao={declaracao:{titulo:'Declaração fictícia SQL QA',texto:'Fixture de acesso; não protocolar.',fonte:'Fixture'}};
const proposta={proposta:{itemIds:[],unidades:{},validade:'60 dias',prazoEntrega:'10 dias',pagamento:'30 dias'}};
const json=x=>literal(JSON.stringify(x))+'::jsonb';
const chamadas=(doc,empresa,processo,usuario,tipo='declaracao',dados=declaracao,versao=0)=>`public.gravar_kit_documento(${uuid(doc)},${uuid(empresa)},${uuid(processo)},${uuid(1)},${uuid(usuario)},${versao},${literal(tipo)},'salvar',${json(dados)})`;
const confirmar=`public.confirmar_identificacao_empresa(${uuid(11)},${uuid(102)},'Alfa Fictícia SQL QA','11222333000181','{"endereco":"Rua fictícia","representante":"Pessoa fictícia","cargo":"Diretoria"}'::jsonb,'[]'::jsonb)`;
const casos=[];
const bloco=(nome,corpo)=>{casos.push(nome);return `-- ${nome}\ndo $caso$\ndeclare n integer; v integer;\nbegin\n${corpo}\nend\n$caso$;\n`;};
const negar=(comando,codigo,nome)=>` begin\n  ${comando};\n  raise exception ${literal('Negativa não bloqueada: '+nome)};\n exception when sqlstate '${codigo}' then null;\n end;`;
const contexto=(usuario,papel='authenticated')=>`reset role;\nselect set_config('request.jwt.claim.sub',${literal(usuario?id(usuario):'')},true),\n set_config('request.jwt.claims',${json(usuario?{sub:id(usuario),role:papel,email:`qa-rls-${usuario}@example.invalid`}:{role:papel})}::text,true);\nset local role ${papel};\n`;
const administrador=`reset role;\nselect set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);\n`;
const leitura=(nome,usuario,documentos,pecas)=>contexto(usuario)+bloco(nome,` if current_user<>'authenticated' or auth.uid() is distinct from ${uuid(usuario)} then raise exception 'Contexto de identidade SQL incorreto';end if;
 if (select coalesce(array_agg(id order by id),'{}'::uuid[]) from public.operacao_documentos) is distinct from ${array(documentos)} then raise exception ${literal('Documentos fora da matriz: '+nome)};end if;
 if (select coalesce(array_agg(id order by id),'{}'::uuid[]) from public.operacao_kit_documentos) is distinct from ${array(pecas)} then raise exception ${literal('Peças fora da matriz: '+nome)};end if;`);
const guarda=()=>`do $catalogo_e_vazio$
declare observado jsonb; tabela text; possui_linhas boolean;
begin
 perform set_config('search_path','pg_catalog,public',true);
 if current_user<>'postgres' or current_database()<>'postgres' or current_setting('server_version_num')<>'170011' then raise exception 'Executor/banco/versão fora do staging revisado';end if;
 ${cte}
 select corpo into observado from catalogo;
 if md5(observado::text)<>'830899ecee2a58d23beec619b4963fed' then raise exception 'Catálogo pós-delta divergente; não contornar a guarda';end if;
 if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p'))<>21 then raise exception 'Tabelas públicas divergentes';end if;
 for tabela in select unnest(array[${tabelas.map(literal).join(',')}]::text[]) loop
  execute format('select exists(select 1 from public.%I)',tabela) into possui_linhas;
  if possui_linhas then raise exception 'Fixture SQL exige public vazio';end if;
 end loop;
 if exists(select 1 from auth.users) or exists(select 1 from storage.objects) then raise exception 'Fixture SQL exige Auth e objetos Storage vazios';end if;
 if (select count(*) from storage.buckets)<>1 or not exists(select 1 from storage.buckets where id='operacao-documentos' and public=false) then raise exception 'Bucket privado único obrigatório';end if;
end
$catalogo_e_vazio$;
`;
let sql=`-- ENSAIO SQL RLS; revisão independente antes de executar. Nunca produção.
-- Único alvo: luguscapasskcsficckf / vhmjospwgiryrnrndkpd / PostgreSQL 17.11.
-- Quatro identidades fictícias transitórias; nenhuma senha, token, login, SMTP ou chamada HTTP.
-- SET LOCAL ROLE/claims testa autorização SQL; NÃO testa JWT nem o serviço Auth.
-- Todo DML está em UM BEGIN/ROLLBACK. As consultas finais reconferem catálogo e vazio após rollback.
-- Qualquer erro: parar e executar ROLLBACK explicitamente; não repetir nem alterar a guarda.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
set local idle_in_transaction_session_timeout='60s';
set local search_path=pg_catalog,public;
set local row_security=on;
lock table ${tabelas.map(t=>'public.'+t).join(',')},auth.users,storage.objects,storage.buckets in access exclusive mode;
${guarda()}
${administrador}
-- Inserções explícitas, sem senha/token. O trigger real cria clientes; não inserir clientes em paralelo.
insert into auth.users(id,email,aud,role,raw_user_meta_data) values
${[101,102,103,104].map(n=>` (${uuid(n)},'qa-rls-${n}@example.invalid','authenticated','authenticated','{"nome":"Pessoa fictícia SQL QA ${n}"}'::jsonb)`).join(',\n')};
${bloco('Cadastro fictício usa o trigger real',` if (select count(*) from public.clientes where id=any(${array([101,102,103,104])}) and status='pendente')<>4 then raise exception 'Trigger de cadastro não gerou quatro clientes pendentes';end if;`)}
update public.clientes set status='aprovado' where id=any(${array([101,102,103,104])});
insert into public.operacao_organizacoes(id,nome,owner_id) values
 (${uuid(1)},'Organização fictícia A/B SQL QA',${uuid(101)}),(${uuid(2)},'Outra organização fictícia SQL QA',${uuid(104)});
insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values
 (${uuid(11)},${uuid(1)},'Alfa Fictícia SQL QA','11222333000181'),(${uuid(12)},${uuid(1)},'Beta Fictícia SQL QA','11222333000262');
insert into public.operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values
 (${uuid(1)},${uuid(101)},'gestor',null),(${uuid(1)},${uuid(102)},'operador',${uuid(11)}),
 (${uuid(1)},${uuid(103)},'leitura',${uuid(11)}),(${uuid(2)},${uuid(104)},'gestor',null);
insert into public.operacao_processos(id,organizacao_id,empresa_id,objeto) values
 (${uuid(21)},${uuid(1)},${uuid(11)},'Processo fictício Alfa'),(${uuid(22)},${uuid(1)},${uuid(12)},'Processo fictício Beta');
insert into public.operacao_documentos(id,organizacao_id,empresa_id,tipo,arquivo_caminho,criado_por) values
 (${uuid(31)},${uuid(1)},${uuid(11)},'Fixture documental Alfa','${id(1)}/${id(11)}/fixture-a.pdf',${uuid(102)}),
 (${uuid(32)},${uuid(1)},${uuid(12)},'Fixture documental Beta','${id(1)}/${id(12)}/fixture-b.pdf',${uuid(101)});
-- Os caminhos são metadados fictícios; nenhum arquivo é criado em Storage.
${contexto(null,'service_role')}
${bloco('RPC cria declaração A e rascunho de proposta B com autor autorizado',` if current_user<>'service_role' then raise exception 'Papel SQL incorreto';end if;
 select (${chamadas(51,11,21,102)}).versao into v;if v<>1 then raise exception 'Declaração não criada';end if;
 select (${chamadas(52,12,22,101,'proposta',proposta)}).versao into v;if v<>1 then raise exception 'Proposta não criada';end if;`)}
${bloco('RPC respeita CNPJ, organização, papel de leitura e processo',[
 negar(`perform ${chamadas(53,12,22,102)}`,'PT403','operador restrito em B'),
 negar(`perform ${chamadas(53,11,21,104)}`,'PT403','outra organização'),
 negar(`perform ${chamadas(53,11,21,103)}`,'PT403','leitor não grava'),
 negar(`perform ${chamadas(53,12,21,101)}`,'PT404','processo A com empresa B')].join('\n'))}
${bloco('service_role não faz DML direto no kit',[
 negar(`update public.operacao_kit_documentos set versao=99 where id=${uuid(51)}`,'42501','service_role UPDATE'),
 negar(`delete from public.operacao_kit_documentos where id=${uuid(51)}`,'42501','service_role DELETE'),
 negar(`insert into public.operacao_kit_documentos(id,organizacao_id,empresa_id,processo_id,tipo,dados,criado_por,atualizado_por) values(${uuid(53)},${uuid(1)},${uuid(11)},${uuid(21)},'declaracao',${json(declaracao)},${uuid(102)},${uuid(102)})`,'42501','service_role INSERT')].join('\n'))}
${leitura('Gestor vê A e B',101,[31,32],[51,52])}
${leitura('Operador restrito vê somente A',102,[31],[51])}
${bloco('Operador altera documento A, não altera B nem insere em B',` update public.operacao_documentos set tipo='Fixture Alfa alterada' where id=${uuid(31)};get diagnostics n=row_count;if n<>1 then raise exception 'Operador não alterou A';end if;
 update public.operacao_documentos set tipo='Alteração indevida Beta' where id=${uuid(32)};get diagnostics n=row_count;if n<>0 then raise exception 'Operador alterou B';end if;
${negar(`insert into public.operacao_documentos(id,organizacao_id,empresa_id,tipo,arquivo_caminho) values(${uuid(33)},${uuid(1)},${uuid(12)},'Indevido','${id(1)}/${id(12)}/indevido.pdf')`,'42501','INSERT documental em B')}`)}
${bloco('authenticated não faz DML direto nem chama as RPCs privadas',[
 negar(`update public.operacao_kit_documentos set versao=99 where id=${uuid(51)}`,'42501','authenticated UPDATE'),
 negar(`delete from public.operacao_kit_documentos where id=${uuid(51)}`,'42501','authenticated DELETE'),
 negar(`insert into public.operacao_kit_documentos(id,organizacao_id,empresa_id,processo_id,tipo,dados,criado_por,atualizado_por) values(${uuid(53)},${uuid(1)},${uuid(11)},${uuid(21)},'declaracao',${json(declaracao)},${uuid(102)},${uuid(102)})`,'42501','authenticated INSERT'),
 negar(`perform ${chamadas(53,11,21,102)}`,'42501','RPC gravar_kit_documento'),negar(`perform ${confirmar}`,'42501','RPC confirmar_identificacao_empresa')].join('\n'))}
${leitura('Leitor restrito vê somente A',103,[31],[51])}
${bloco('Leitor não altera documento A',` update public.operacao_documentos set tipo='Leitor indevido' where id=${uuid(31)};get diagnostics n=row_count;if n<>0 then raise exception 'Leitor escreveu documento';end if;`)}
${leitura('Outra organização não vê A ou B',104,[],[])}
${administrador}
update public.clientes set status='pendente' where id=${uuid(102)};
${contexto(102)}
${bloco('Cliente pendente não lê peças do kit',` if auth.uid() is distinct from ${uuid(102)} then raise exception 'Claims da fixture incorretas';end if;
 if exists(select 1 from public.operacao_kit_documentos) then raise exception 'Pendente leu kit';end if;`)}
${contexto(null,'service_role')}
${bloco('RPC recusa gravação em nome do cliente pendente',negar(`perform ${chamadas(53,11,21,102)}`,'PT403','cliente pendente'))}
${administrador}
update public.clientes set status='aprovado' where id=${uuid(102)};
${contexto(null,'anon')}
${bloco('Anônimo não lê kit nem executa as RPCs privadas',[
 ` if current_user<>'anon' or auth.uid() is not null then raise exception 'Contexto anônimo incorreto';end if;`,
 negar('perform count(*) from public.operacao_kit_documentos','42501','anon SELECT'),
 negar(`perform ${chamadas(53,11,21,102)}`,'42501','anon RPC kit'),negar(`perform ${confirmar}`,'42501','anon RPC identificação')].join('\n'))}
${administrador}
${bloco('Negativas não criaram ou alteraram peças/documentos alheios',` if (select count(*) from public.operacao_kit_documentos)<>2 or exists(select 1 from public.operacao_kit_documentos where versao<>1) then raise exception 'Negativas alteraram peças';end if;
 if (select count(*) from public.operacao_documentos)<>2 or not exists(select 1 from public.operacao_documentos where id=${uuid(32)} and tipo='Fixture documental Beta') then raise exception 'Negativas alteraram documentos';end if;
 if exists(select 1 from storage.objects) or (select count(*) from auth.users)<>4 then raise exception 'Fixture transacional fora do escopo';end if;`)}
-- ROLLBACK remove todas as identidades e linhas da fixture, sem DELETE de limpeza.
rollback;
-- Somente consultas depois do rollback; DO usa set_config local à transação implícita.
${guarda()}
select jsonb_build_object('resultado','RLS_CNPJ_SQL_ROLLBACK_OK','catalogo_md5','830899ecee2a58d23beec619b4963fed',
 'papel_final',current_user,'usuarios_auth',(select count(*) from auth.users),'objetos_storage',(select count(*) from storage.objects),
 'tabelas_publicas_vazias',21,'casos',${casos.length},'observado_em',clock_timestamp(),
 'limite','Claims SQL fictícias; sem JWT, login, API, exportação ou arquivo Storage') as evidencia_rls;
`;
assert.equal((sql.match(/^begin;$/gm)||[]).length,1);assert.equal((sql.match(/^rollback;$/gm)||[]).length,1);
assert(!/^commit;$/m.test(sql));assert(!/^\s*(?:create|alter|drop|truncate|grant|revoke)\s/im.test(sql));
assert(!/disable trigger|session_replication_role|encrypted_password|request\.jwt\.claim\.role|https?:\/\//i.test(sql));
assert.equal((sql.match(/insert into auth\.users\(/g)||[]).length,1);
assert.equal((sql.match(/md5\(observado::text\)<>'830899ecee2a58d23beec619b4963fed'/g)||[]).length,2);
const arquivo='07-ensaiar-rls-cnpj-com-rollback.sql';
const manifesto={estado:'preparado, não executado',projeto:'luguscapasskcsficckf',catalogoSha256:sha(catalogoTexto),sqlSha256:sha(sql),arquivo,casos,identidades:[101,102,103,104].map(n=>({id:id(n),email:`qa-rls-${n}@example.invalid`})),
 escopo:'Uma transação de DML fictício com ROLLBACK; conferência de catálogo/vazio antes e depois. Sem DDL, senha, token, login, SMTP, HTTP ou serviço local.',limites:['Claims SQL não comprovam JWT/Auth ou autorização HTTP.','Proposta é rascunho sem itens; não testa cálculo, revisão ou exportação.','Documentos têm apenas metadados fictícios; nenhum arquivo Storage é enviado.','Status pendente é testado no kit; não se presume bloqueio da tabela documental por esse status.']};
assert.deepEqual(process.argv.slice(2),['--emitir']);
const arquivos={[arquivo]:sql,'ensaio-rls-cnpj-manifesto.json':JSON.stringify(manifesto,null,2)+'\n'};
for(const nome of Object.keys(arquivos))assert(!fs.existsSync(path.join(__dirname,nome)),'Não sobrescrever '+nome);
for(const [nome,texto] of Object.entries(arquivos))fs.writeFileSync(path.join(__dirname,nome),texto,{flag:'wx'});
console.log(JSON.stringify({preparado:true,sqlExecutado:false,casos:casos.length,sqlSha256:sha(sql)}));
