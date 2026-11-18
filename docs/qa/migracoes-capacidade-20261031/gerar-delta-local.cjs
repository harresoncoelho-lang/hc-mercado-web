// Gera somente artefato revisável. Não conecta ao banco nem executa SQL.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const dir = __dirname;
const raiz = path.resolve(dir, '../../..');
const ler = nome => fs.readFileSync(path.join(raiz, 'supabase', nome), 'utf8').replace(/\r/g, '');
const fonte = nome => fs.readFileSync(path.join(dir, nome), 'utf8');
const remoto = JSON.parse(fonte('catalogo-producao-20261031.json'));
const alvo = JSON.parse(fonte('catalogo-local-alvo.json')).catalogo;
const literal = valor => "'" + String(valor).replaceAll("'", "''") + "'";
const identificador = valor => '"' + valor.replaceAll('"', '""') + '"';
const sha256 = valor => crypto.createHash('sha256').update(valor).digest('hex');
const semTransacao = sql => sql.replace(/^begin;\n/m, '').replace(/^commit;\n?/gm, '').replace(/^notify pgrst[^\n]*\n?/gm, '');
const apenasNovos = sql => sql.replace(/create or replace function/g, 'create function').replace(/create table if not exists/g, 'create table').replace(/create unique index if not exists/g, 'create unique index').replace(/create index if not exists/g, 'create index').replace(/^drop (?:policy|trigger) if exists[^\n]*\n/gm, '');
assert.equal(remoto.read_only, 'on');
assert.equal(remoto.hash_catalogo_md5, '4550d262d2f09edec1efd68b4c699f67');
assert.equal(sha256(fonte('catalogo-producao-20261031.json')), 'cd708621a042125e408774128e7927c8cea3ebc9e16fcc30bd084f5f782d71aa');

const consulta = fonte('01-catalogo-readonly.sql');
const cte = consulta.slice(consulta.indexOf('with\n'), consulta.indexOf("select jsonb_build_object('versao_consulta'"));
assert(cte.endsWith('\n'));
const ident = ler('identificacao_empresa.sql');
const seguranca = ler('seguranca_operacao.sql');
const kit = ler('kit_documentos.sql');
const prefixoIdent = apenasNovos(semTransacao(ident.slice(0, ident.indexOf('create or replace function public.confirmar_identificacao_empresa'))));
const prefixoSeguranca = apenasNovos(semTransacao(seguranca.slice(0, seguranca.indexOf('-- SELECT conserva'))));
const finalSeguranca = apenasNovos(semTransacao(seguranca.slice(seguranca.indexOf('-- O backend informa'))));
const kitNovo = apenasNovos(semTransacao(kit));

const politicasEsperadas = alvo.policies.filter(p => p.esquema === 'storage' && p.tabela === 'objects' || p.esquema === 'public' && p.tabela.startsWith('operacao_') && !['operacao_kit_documentos','operacao_identificacao_empresa'].includes(p.tabela));
const chave = p => [p.esquema,p.tabela,p.nome].join('.');
const atuais = new Map(remoto.catalogo.policies.map(p => [chave(p),p]));
const operacoes = [];
const consumidas = new Set();
const nomesAlterados = [];
const clausulas = p => `to ${p.papeis.map(x => x === 'public' ? 'public' : identificador(x)).join(',')}${p.using === null ? '' : ' using (' + p.using + ')'}${p.check === null ? '' : ' with check (' + p.check + ')'}`;
for (const p of politicasEsperadas) {
 if (consumidas.has(chave(p))) continue;
 const anterior = atuais.get(chave(p));
 const tabela = `${identificador(p.esquema)}.${identificador(p.tabela)}`;
 if (anterior && JSON.stringify(anterior) === JSON.stringify(p)) continue;
 if (anterior && ['esquema','tabela','nome','comando','permissiva','using','check','papeis'].every(k => JSON.stringify(anterior[k]) === JSON.stringify(p[k]))) continue;
 if (anterior && anterior.comando === p.comando) {
  assert.equal(anterior.permissiva,p.permissiva);
  operacoes.push(`alter policy ${identificador(p.nome)} on ${tabela} ${clausulas(p)};`);
 } else if (anterior && anterior.comando === 'ALL' && p.comando === 'SELECT') {
  const escrita = politicasEsperadas.find(e => e.esquema === p.esquema && e.tabela === p.tabela && e.nome === p.nome + '_escrita');
  assert(escrita && !atuais.has(chave(escrita)));
  operacoes.push(`alter policy ${identificador(p.nome)} on ${tabela} rename to ${identificador(escrita.nome)};`);
  operacoes.push(`alter policy ${identificador(escrita.nome)} on ${tabela} ${clausulas(escrita)};`);
  operacoes.push(`create policy ${identificador(p.nome)} on ${tabela} for select ${clausulas(p)};`);
  consumidas.add(chave(escrita));
 } else {
  throw new Error('Estado de policy não reconhecido: ' + chave(p));
 }
 nomesAlterados.push(chave(p));
}
const novasFuncoes = alvo.funcoes.filter(f => f.esquema === 'public' && !remoto.catalogo.funcoes.some(r => r.assinatura === f.assinatura && r.esquema === f.esquema));
const funcoesTrigger = novasFuncoes.filter(f => f.retorno === 'trigger').map(f => 'public.' + f.assinatura);
const linhasHashes = novasFuncoes.map(f => `(${literal('public.' + f.assinatura)},${literal(f.hash_corpo_md5)})`).join(',\n  ');
const tabelasLock = ['operacao_agenda','operacao_anexos_processo','operacao_contratos','operacao_documentos','operacao_empenhos','operacao_empresas','operacao_itens_resultado','operacao_membros','operacao_ocorrencias','operacao_prazos_processo','operacao_processos','operacao_renovacoes_documento','operacao_tipos_documento'];
const politicasJson = JSON.stringify(politicasEsperadas);
const sql = `-- CANDIDATO LOCAL. Não aplicado. Publicação/aplicação requer autorização separada.
-- Delta exato do catálogo observado em ${remoto.observado_em_utc}; não reaplica a base.
-- Repetição após COMMIT aborta no fingerprint: inventarie e revise, não remova a guarda.
-- Em erro, interromper o executor e executar ROLLBACK. Nenhum DROP/TRUNCATE/DELETE.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
set local search_path=pg_catalog,public;
-- Janela exclusiva curta: evita escrita durante a validação de vínculos e DDL.
lock table ${tabelasLock.map(t => 'public.' + t).join(',')},storage.objects in access exclusive mode;
do $preestado$
declare observado jsonb;
begin
 if current_user<>'postgres' then raise exception 'Executor diferente do proprietário esperado; não trocar papel automaticamente'; end if;
 ${cte}
 select corpo into observado from catalogo;
 if md5(observado::text)<>${literal(remoto.hash_catalogo_md5)} then
  raise exception 'Catálogo divergente: abortado sem alteração. Capture novo inventário e revise o delta';
 end if;
end
$preestado$;

${prefixoIdent}
${prefixoSeguranca}
-- Policies conhecidas são alteradas/renomeadas individualmente. Nenhuma é apagada.
${operacoes.join('\n')}

${finalSeguranca}
${kitNovo}
-- Gate integral homologado, sem mudanças.
${ler('verificar_kit_prepublicacao.sql')}
do $posestado$
declare politicas jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('esquema',schemaname,'tabela',tablename,'nome',policyname,
  'permissiva',permissive,'papeis',roles,'comando',cmd,'using',qual,'check',with_check)
  order by schemaname,tablename,policyname),'[]'::jsonb) into politicas
 from pg_policies where (schemaname='storage' and tablename='objects') or
  (schemaname='public' and tablename like 'operacao\\_%' escape '\\' and tablename not in ('operacao_identificacao_empresa','operacao_kit_documentos'));
 if politicas is distinct from ${literal(politicasJson)}::jsonb then
  raise exception 'Policies finais divergentes: abortado';
 end if;
 if exists(select 1 from (values
  ${linhasHashes}
 ) as esperado(assinatura,hash) left join pg_proc p on p.oid=to_regprocedure(esperado.assinatura)
 where p.oid is null or md5(replace(p.prosrc,chr(13),''))<>esperado.hash) then
  raise exception 'Corpos finais divergentes: abortado';
 end if;
 -- Funções internas de trigger não são RPCs; defaults e herança também devem falhar fechados.
 if exists(select 1 from unnest(array[${funcoesTrigger.map(literal).join(',')}]::text[]) esperado(assinatura)
  left join pg_proc p on p.oid=to_regprocedure(esperado.assinatura)
  where p.oid is null or p.prorettype<>'pg_catalog.trigger'::regtype
   or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee<>p.proowner)
   or exists(select 1 from pg_roles r where r.rolname in ('anon','authenticated','service_role')
    and has_function_privilege(r.oid,p.oid,'EXECUTE'))) then
  raise exception 'ACL de função interna de trigger divergente: abortado';
 end if;
 if not exists(select 1 from pg_class c where c.oid='public.operacao_identificacao_empresa'::regclass and c.relrowsecurity)
 or (select count(*) from pg_trigger where tgname in ('identificacao_documento_alterado','identificacao_arquivo_alterado','identificacao_cadastro_alterado') and not tgisinternal and tgenabled='O')<>3 then
  raise exception 'RLS ou invalidação da identificação ausente';
 end if;
end
$posestado$;
notify pgrst,'reload schema';
commit;
`;
assert(!/^\s*(?:drop|truncate|delete)\s/im.test(sql));
assert.equal((sql.match(/^begin;$/gm) || []).length,1);
assert.equal((sql.match(/^commit;$/gm) || []).length,1);
fs.writeFileSync(path.join(dir, '02-delta-operacional.sql'), sql);
const manifesto = { estado: 'candidato local, não aplicado', catalogoRemotoSha256: sha256(fonte('catalogo-producao-20261031.json')), catalogoRemotoMd5: remoto.hash_catalogo_md5,
 deltaSha256: sha256(sql), novasTabelas: ['operacao_identificacao_empresa','operacao_kit_documentos'], novasFuncoes: novasFuncoes.map(f => f.assinatura), funcoesTriggerSomenteDono: funcoesTrigger, policiesAlteradas: nomesAlterados,
 fontes: Object.fromEntries(['identificacao_empresa.sql','seguranca_operacao.sql','kit_documentos.sql','verificar_kit_prepublicacao.sql'].map(nome => [nome,sha256(ler(nome))])) };
fs.writeFileSync(path.join(dir, 'delta-manifesto.json'), JSON.stringify(manifesto,null,2)+'\n');
console.log(JSON.stringify({ arquivo:'02-delta-operacional.sql', bytes:Buffer.byteLength(sql), sha256:manifesto.deltaSha256, novasFuncoes:novasFuncoes.length, policiesAlteradas:nomesAlterados.length }));
