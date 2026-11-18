// Somente PGlite instalado e fixtures em memória; sem rede, Docker ou credenciais.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require(process.env.PGLITE_MODULE_PATH || 'C:/Users/harre/AppData/Local/LicitaPlena/qa-postgres/node_modules/@electric-sql/pglite');
const raiz = path.resolve(__dirname, '../../..');
const ler = nome => fs.readFileSync(path.join(raiz, 'supabase', nome), 'utf8');
const consulta = fs.readFileSync(path.join(__dirname, '01-catalogo-readonly.sql'), 'utf8');
const bootstrap = `
 create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
 alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
 create table public.clientes(id uuid primary key,status text,nome text,empresa text,cnpj text);
 create table public.admins(email text,role text);
 grant usage on schema auth,storage,public to anon,authenticated,service_role;
 grant execute on function auth.uid() to anon,authenticated,service_role;`;
const fontes = ['operacao_licitacoes.sql','operacao_acompanhamento.sql','limite_cnpjs_operacao.sql','acesso_empresa_convites.sql','operacao_itens_valores_unitarios.sql','operacao_itens_marca_modelo.sql','identificacao_empresa.sql','seguranca_operacao.sql','kit_documentos.sql'];

async function testar() {
 const db = new PGlite();
 let checks = 0;
 const ok = (valor, esperado) => { assert.deepEqual(valor, esperado); checks++; };
 const capturar = async () => (await db.exec(consulta)).flatMap(r => r.rows).find(r => r.evidencia_catalogo)?.evidencia_catalogo;
 try {
  await db.exec(bootstrap);
  const vazio = await capturar();
  ok(vazio.read_only, 'on');
  ok(vazio.catalogo.relacoes.some(r => r.nome === 'operacao_kit_documentos'), false);
  let base;
  for (const nome of fontes) {
   await db.exec(ler(nome));
   if (nome === 'operacao_itens_marca_modelo.sql') base = await capturar();
  }
  const alvo = await capturar();
  ok(alvo.read_only, 'on');
  ok(alvo.catalogo.relacoes.some(r => r.nome === 'operacao_identificacao_empresa' && r.rls), true);
  ok(alvo.catalogo.relacoes.some(r => r.nome === 'operacao_kit_documentos' && r.rls), true);
  ok(alvo.catalogo.funcoes.some(r => r.nome === 'gravar_kit_documento' && r.definicao.includes('SECURITY DEFINER')), true);
  ok(alvo.catalogo.policies.filter(r => r.tabela === 'objects').length, 4);
  ok(alvo.catalogo.colunas.filter(r => r.tabela === 'operacao_itens_resultado' && ['marca','modelo','valor_unitario_proposta'].includes(r.nome)).length, 3);
  ok((await capturar()).hash_catalogo_md5, alvo.hash_catalogo_md5);
  await db.exec("create role qa_extra;grant update(dados) on public.operacao_kit_documentos to qa_extra;grant qa_extra to authenticated;create function public.gravar_kit_documento(text) returns text language sql as $$select $1$$;");
  const diferente = await capturar();
  ok(diferente.hash_catalogo_md5 === alvo.hash_catalogo_md5, false);
  ok(diferente.catalogo.colunas.some(c => c.tabela === 'operacao_kit_documentos' && c.nome === 'dados' && c.acl.includes('qa_extra')), true);
  ok(diferente.catalogo.membros_papeis.some(m => m.papel === 'qa_extra' && m.membro === 'authenticated'), true);
  ok(diferente.catalogo.funcoes.filter(f => f.nome === 'gravar_kit_documento').length, 2);
  const resultado = { ambiente: 'PGlite em memória; fixture local, não produção', checks, aprovado: true, fontes, hashCatalogoLocal: alvo.hash_catalogo_md5 };
  fs.writeFileSync(path.join(__dirname, 'catalogo-local-alvo.json'), JSON.stringify(alvo, null, 2) + '\n');
  fs.writeFileSync(path.join(__dirname, 'catalogo-local-base.json'), JSON.stringify(base, null, 2) + '\n');
  fs.writeFileSync(path.join(__dirname, 'verificacao-local.json'), JSON.stringify(resultado, null, 2) + '\n');
  console.log(JSON.stringify(resultado));
 } finally { await db.close(); }
}
testar().catch(erro => { console.error(erro.message); process.exitCode = 1; });
