// Réplica do catálogo operacional observado; tudo em memória e com dados fictícios.
// Auth/Storage gerenciados não são recriados integralmente: não substitui homologação real.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { PGlite } = require(process.env.PGLITE_MODULE_PATH || 'C:/Users/harre/AppData/Local/LicitaPlena/qa-postgres/node_modules/@electric-sql/pglite');
const ler = nome => fs.readFileSync(path.join(__dirname,nome),'utf8');
const remoto = JSON.parse(ler('catalogo-producao-20261031.json'));
const catalogo = remoto.catalogo;
const original = ler('02-delta-operacional.sql');
const consulta = ler('01-catalogo-readonly.sql');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const nome = x => '"' + x.replaceAll('"','""') + '"';
const alvo = x => nome(x.esquema) + '.' + nome(x.tabela || x.nome);
const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');

async function testar() {
 const db = new PGlite();
 let checks = 0;
 const casos = [];
 const ok = (a,b) => { assert.deepEqual(a,b);checks++; };
 const capturar = async () => (await db.exec(consulta)).flatMap(x => x.rows).find(x => x.evidencia_catalogo).evidencia_catalogo;
 const rejeitar = async (titulo,sql,erro) => {
  const antes = await capturar();
  await assert.rejects(() => db.exec(sql),erro);checks++;
  await db.exec('rollback');
  ok((await capturar()).hash_catalogo_md5,antes.hash_catalogo_md5);
  casos.push(titulo);
 };
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create table auth.users(id uuid primary key,email text);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create schema storage;create table storage.buckets(id text primary key,name text,public boolean);
   create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
   alter table storage.objects enable row level security;
   grant usage on schema auth,storage,public to anon,authenticated,service_role;
   grant all on all tables in schema storage to anon,authenticated,service_role;
   alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
   alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  // Colunas, constraints, índices, funções, policies e triggers operacionais vêm do inventário real.
  for (const r of catalogo.relacoes.filter(r => r.esquema === 'public')) {
   const colunas = catalogo.colunas.filter(c => c.esquema === r.esquema && c.tabela === r.nome).sort((a,b)=>a.ordem-b.ordem);
   assert(colunas.every(c => !c.identity && !c.generated));
   await db.exec(`create table ${alvo(r)}(${colunas.map(c => `${nome(c.nome)} ${c.tipo}${c.default === null ? '' : ' default ' + c.default}${c.not_null ? ' not null' : ''}`).join(',')});`);
   if (r.rls) await db.exec(`alter table ${alvo(r)} enable row level security;`);
  }
  for (const tipo of ['p','u','c']) for (const c of catalogo.constraints.filter(c => c.esquema === 'public' && c.tipo === tipo)) {
   await db.exec(`alter table ${alvo(c)} add constraint ${nome(c.nome)} ${c.definicao};`);
  }
  for (const i of catalogo.indices.filter(i => i.esquema === 'public')) {
   if (!(await db.query('select to_regclass($1) as id',['public.'+i.nome])).rows[0].id) await db.exec(i.definicao);
  }
  for (const c of catalogo.constraints.filter(c => c.esquema === 'public' && c.tipo === 'f')) {
   await db.exec(`alter table ${alvo(c)} add constraint ${nome(c.nome)} ${c.definicao};`);
  }
  const funcoes = catalogo.funcoes.filter(f => f.esquema === 'public' && f.definicao);
  // SQL functions resolvem referências durante CREATE; os helpers precisam vir primeiro.
  const ordem = ['eh_membro_operacao','tem_vinculo_operacao','pode_acessar_empresa_operacao','pode_acessar_processo_operacao','acesso_arquivo_operacao','eh_owner_admin_operacao','limite_cnpjs_operacao'];
  funcoes.sort((a,b) => (ordem.indexOf(a.nome)<0?99:ordem.indexOf(a.nome))-(ordem.indexOf(b.nome)<0?99:ordem.indexOf(b.nome)));
  for (const f of funcoes) await db.exec(f.definicao);
  for (const f of funcoes) {
   await db.exec(`revoke all on function public.${f.assinatura} from public,anon,authenticated,service_role;`);
   for (const a of catalogo.acl_funcoes.filter(a => a.esquema === 'public' && a.objeto === f.assinatura && a.papel !== 'postgres')) {
    await db.exec(`grant ${a.privilegio} on function public.${f.assinatura} to ${a.papel === 'PUBLIC' ? 'public' : nome(a.papel)}${a.grant_option ? ' with grant option' : ''};`);
   }
  }
  for (const p of catalogo.policies.filter(p => p.tabela.startsWith('operacao_') || p.esquema === 'storage')) {
   await db.exec(`create policy ${nome(p.nome)} on ${alvo(p)} as ${p.permissiva} for ${p.comando} to ${p.papeis.map(nome).join(',')}${p.using === null ? '' : ' using ('+p.using+')'}${p.check === null ? '' : ' with check ('+p.check+')'};`);
  }
  for (const r of catalogo.relacoes.filter(r => r.esquema === 'public')) {
   await db.exec(`revoke all on ${alvo(r)} from anon,authenticated,service_role;`);
   for (const a of catalogo.acl_relacoes.filter(a => a.esquema === r.esquema && a.objeto === r.nome && a.papel !== 'postgres')) {
    await db.exec(`grant ${a.privilegio} on ${alvo(r)} to ${a.papel === 'PUBLIC' ? 'public' : nome(a.papel)}${a.grant_option ? ' with grant option' : ''};`);
   }
  }
  for (const t of catalogo.triggers.filter(t => t.esquema === 'public' && t.tabela.startsWith('operacao_'))) await db.exec(t.definicao);
  await db.exec(`insert into storage.buckets values('operacao-documentos','operacao-documentos',false);`);
  for (const n of [101,102,103]) {
   await db.query('insert into auth.users values($1,$2)',[id(n),`fixture-${n}@example.invalid`]);
   await db.query("insert into clientes(id,nome,email,status) values($1,'Pessoa fictícia',$2,'aprovado')",[id(n),`fixture-${n}@example.invalid`]);
  }
  await db.query("insert into operacao_organizacoes(id,nome,owner_id) values($1,'Fixture',$2)",[id(1),id(101)]);
  await db.query("insert into operacao_empresas(id,organizacao_id,razao_social,cnpj) values($1,$2,'Empresa fictícia','11222333000181')",[id(11),id(1)]);
  for (const [n,papel] of [[101,'gestor'],[102,'operador'],[103,'leitura']]) await db.query('insert into operacao_membros(organizacao_id,usuario_id,papel) values($1,$2,$3)',[id(1),id(n),papel]);
  await db.query("insert into operacao_processos(id,organizacao_id,empresa_id,objeto,situacao_resultado,checklist_fonte) values($1,$2,$3,'Fictício','vitoria_sem_detalhamento','manual')",[id(21),id(1),id(11)]);
  await db.query("insert into operacao_documentos(id,organizacao_id,empresa_id,tipo,arquivo_caminho) values($1,$2,$3,'Fictício',$4)",[id(31),id(1),id(11),`${id(1)}/${id(11)}/fixture.pdf`]);
  const base = await capturar();
  const dados = async () => {
   const saida = {};
   for (const r of catalogo.relacoes.filter(r => r.esquema === 'public')) saida[r.nome] = hash((await db.query(`select to_jsonb(t) as dado from ${alvo(r)} t order by to_jsonb(t)::text`)).rows);
   return saida;
  };
  const dadosAntes = await dados();
  // Apenas o valor esperado do fingerprint muda na variante em memória; o arquivo candidato fica intacto.
  const local = original.replace(`<> '${remoto.hash_catalogo_md5}'`,`<> '${base.hash_catalogo_md5}'`).replace(`<>${"'"+remoto.hash_catalogo_md5+"'"}`,`<>'${base.hash_catalogo_md5}'`);
  ok(local.includes(`md5(observado::text)<>'${base.hash_catalogo_md5}'`),true);
  await rejeitar('arquivo de produção rejeita ambiente diferente',original,/Catálogo divergente/);
  for (const [titulo,alteracao,reverter] of [
   ['policy extra',"create policy qa_extra on public.operacao_documentos for select using(true)","drop policy qa_extra on public.operacao_documentos"],
   ['helper alterado',"alter function public.pode_acessar_empresa_operacao(uuid,uuid) security invoker","alter function public.pode_acessar_empresa_operacao(uuid,uuid) security definer"],
   ['ACL inesperada',"grant select on public.operacao_convites_empresa to public","revoke select on public.operacao_convites_empresa from public"],
   ['instalação parcial',"create table public.operacao_identificacao_empresa(id uuid)","drop table public.operacao_identificacao_empresa"]
  ]) {
   await db.exec(alteracao);await rejeitar(titulo,local,/Catálogo divergente/);await db.exec(reverter);
  }
  // DDL removida/recriada altera OIDs/dependências: a guarda requer novo snapshot da fixture após negativas.
  const restaurada = await capturar();
  const localAtual = local.replaceAll(base.hash_catalogo_md5,restaurada.hash_catalogo_md5);
  await db.query('update operacao_documentos set arquivo_caminho=$1 where id=$2',['caminho-invalido',id(31)]);
  await rejeitar('legado inconsistente aborta todas as DDLs',localAtual,/Escopo legado inconsistente/);
  await db.query('update operacao_documentos set arquivo_caminho=$1 where id=$2',[`${id(1)}/${id(11)}/fixture.pdf`,id(31)]);
  const falhaTardia = localAtual.replace("notify pgrst,'reload schema';\ncommit;", () => "do $$begin raise exception 'Falha tardia fictícia';end$$;\ncommit;");
  await rejeitar('erro depois dos gates reverte todo o delta',falhaTardia,/Falha tardia fictícia/);
  const pre = await capturar();
  const resultado = await db.exec(localAtual);
  ok(resultado.flatMap(r=>r.rows).some(r=>r.status==='KIT_PREPUBLICACAO_OK'),true);
  ok(await dados(),dadosAntes);
  const pos = await capturar();
  const preservados = [];
  for (const secao of ['colunas','indices','funcoes','relacoes','triggers','constraints']) {
   for (const objeto of pre.catalogo[secao]) {
    const chave = x => [x.esquema,x.tabela,x.nome,x.assinatura].join('.');
    const depois = pos.catalogo[secao].find(x=>chave(x)===chave(objeto));
    if (secao === 'funcoes' && ['bootstrap_operacao','eh_membro_operacao'].includes(objeto.nome)) {
     const {acl:aclAntes,...antesSemAcl}=objeto;
     const {acl:aclDepois,...depoisSemAcl}=depois;
     ok(depoisSemAcl,antesSemAcl);
     ok(aclAntes===aclDepois,false);
     continue;
    }
    ok(depois,objeto);preservados.push({secao,objeto:chave(objeto),sha256:hash(objeto)});
   }
  }
  ok(pre.catalogo.defaults_acl,pos.catalogo.defaults_acl);
  ok(pre.catalogo.papeis,pos.catalogo.papeis);
  ok(pre.catalogo.membros_papeis,pos.catalogo.membros_papeis);
  await rejeitar('segunda aplicação aborta sem ampliar grants',localAtual,/Catálogo divergente/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(103)]);await db.exec('set role authenticated');
  ok((await db.query('select count(*)::int as n from operacao_documentos')).rows[0].n,1);
  ok((await db.query("update operacao_documentos set tipo='Indevido' returning id")).rows.length,0);
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(102)]);await db.exec('set role authenticated');
  ok((await db.query("update operacao_documentos set tipo=tipo returning id")).rows.length,1);
  ok((await db.query('select public.identificacao_empresa_habilitada() as pronto')).rows[0].pronto,true);
  await db.exec('reset role;set role service_role');
  const params=[id(11),id(102),'Empresa fictícia','11222333000181',{endereco:'Rua fictícia',representante:'Pessoa fictícia',cargo:'Diretoria'},[]];
  ok((await db.query('select (public.confirmar_identificacao_empresa($1,$2,$3,$4,$5,$6)).versao as n',params)).rows[0].n,1);
  const rpcParams=[id(41),id(11),id(21),id(1),id(102),0,'declaracao','salvar',{declaracao:{titulo:'Fictícia',texto:'',fonte:''}}];
  ok((await db.query('select (public.gravar_kit_documento($1,$2,$3,$4,$5,$6,$7,$8,$9)).versao as n',rpcParams)).rows[0].n,1);
  await db.exec('reset role');
  const evidencia={aprovado:true,checks,casos,deltaSha256:crypto.createHash('sha256').update(original).digest('hex'),postgresLocal:base.server_version,postgresRemoto:remoto.server_version,
   replica:'Tabelas públicas, colunas, constraints, índices e funções operacionais do catálogo real; policies e ACLs operacionais. Auth e Storage são compatibilidade local, não serviços completos.',
   fingerprintTeste:'Somente o hash esperado foi substituído na string SQL em memória. O SQL candidato em disco conserva o hash remoto.',
   hashPreLocal:pre.hash_catalogo_md5,hashPosLocal:pos.hash_catalogo_md5,objetosPreservados:preservados.length,dadosPreservados:Object.keys(dadosAntes).length};
  fs.writeFileSync(path.join(__dirname,'preservacao-delta-local.json'),JSON.stringify({objetos:preservados,dadosAntes,dadosDepois:await dados()},null,2)+'\n');
  fs.writeFileSync(path.join(__dirname,'delta-testes-local.json'),JSON.stringify(evidencia,null,2)+'\n');
  console.log(JSON.stringify(evidencia));
 } finally { await db.close(); }
}
testar().catch(e=>{console.error(e.message);process.exitCode=1;});
