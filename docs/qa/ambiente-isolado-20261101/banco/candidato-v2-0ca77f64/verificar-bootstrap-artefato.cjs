// Verificação estática do pacote; não abre conexão nem executa SQL.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ler = nome => fs.readFileSync(path.join(__dirname, nome), 'utf8');
const sha = texto => crypto.createHash('sha256').update(texto).digest('hex');
assert(fs.existsSync(path.join(__dirname, '01-bootstrap-prekit-staging-v2.sql')), 'Bootstrap específico v2 ainda não preparado');
const sql = ler('01-bootstrap-prekit-staging-v2.sql');
const pos = ler('02-verificar-bootstrap-somente-leitura-v2.sql');
// O corpo copiado de um trigger contém INSERT, mas CREATE FUNCTION não o executa.
const comandosExternos = sql.replace(/\$([a-zA-Z_]\w*|)\$[\s\S]*?\$\1\$/g,'BLOCO_SQL');
const manifesto = JSON.parse(ler('bootstrap-manifesto-v2.json'));
assert.equal(sha(sql), manifesto.bootstrapSha256);
assert.equal(sha(pos), manifesto.verificacaoSha256);
assert.equal(manifesto.projeto, 'luguscapasskcsficckf');
assert.equal(manifesto.catalogoDestinoMd5, '785cf53d0d88df117eff15085f879018');
assert.equal((sql.match(/^begin;$/gm) || []).length, 1);
assert.equal((sql.match(/^commit;$/gm) || []).length, 1);
assert(sql.indexOf('785cf53d0d88df117eff15085f879018') < sql.indexOf('CREATE TABLE'));
assert.match(sql, /current_user<>'postgres'/);
assert.match(sql, /current_setting\('server_version_num'\)<>'170011'/);
assert(!/^\s*(?:drop|truncate|delete|alter default privileges|create role|alter role|create extension)\s/im.test(sql));
assert(!/^\s*(?:create|alter) table (?:auth|storage)\./im.test(sql));
assert(!/^\s*insert\s/im.test(comandosExternos), 'Bootstrap deve permanecer sem dados de negócio ou fixtures');
assert.equal((sql.match(/^CREATE TABLE public\./gm) || []).length, 19);
assert(!/^CREATE TABLE public\.(?:operacao_identificacao_empresa|operacao_kit_documentos)\b/m.test(sql));
assert.match(sql, /CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth\.users/);
assert.match(sql, /CREATE FUNCTION public\.criar_cliente_no_cadastro\(\)/);
assert.match(sql, /CREATE FUNCTION public\.admin_tem_permissao\(permissao text\)/);
assert.match(pos, /^begin read only;/m);
assert(!/^\s*(?:insert|update|delete|create|alter|drop|truncate|grant|revoke|call)\s/im.test(pos));
assert(pos.includes('BOOTSTRAP_PREKIT_STAGING_OK'));
assert(sql.includes('BOOTSTRAP_PREKIT_STAGING_OK'));
assert(/from pg_policies where[^\n]*tablename in \('clientes','admins','dados_robo'\)/.test(pos), 'Gate precisa observar as duas policies de dados_robo');
// A compactação mantém os mesmos arrays esperados e as duas direções da comparação.
const literalSql = "'((?:[^']|'')*)'::jsonb";
const expectativa = pos.match(new RegExp('esperado jsonb := '+literalSql));
assert(expectativa, 'Catálogo esperado deve aparecer uma vez no gate');
const esperado = JSON.parse(expectativa[1].replaceAll("''", "'"));
assert.equal((pos.match(/esperado jsonb := /g)||[]).length,1);
const anterior = ler('candidato-v1-3756dd11/02-verificar-bootstrap-somente-leitura.sql');
for (const [secao,valor] of Object.entries(esperado)) {
 const prefixo = ['relacoes','funcoes'].includes(secao) ? secao : `\\(observado->'${secao}'\\)`;
 const captura = anterior.match(new RegExp('not '+prefixo+' @> '+literalSql));
 assert(captura, 'Expectativa anterior ausente: '+secao);
 assert.deepEqual(valor, JSON.parse(captura[1].replaceAll("''","'")), 'Expectativa mudou: '+secao);
 assert(pos.includes(`not (esperado->'${secao}') @>`), 'Comparação inversa ausente: '+secao);
}
assert.equal(esperado.policies.filter(x=>x.tabela==='dados_robo').length,2);
assert.equal(esperado.policies.length,33);
console.log(JSON.stringify({aprovado:true,tabelasNovas:19,sqlExecutado:false,bootstrapSha256:manifesto.bootstrapSha256}));
