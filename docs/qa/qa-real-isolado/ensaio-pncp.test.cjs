const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const dir=__dirname,root=path.resolve(dir,'../../..'),hash=x=>createHash('sha256').update(x).digest('hex');
test('pacote e fontes preservadas correspondem ao manifesto; não executado',()=>{
 const m=JSON.parse(fs.readFileSync(path.join(dir,'ENSAIO-PNCP-manifesto.json'))),sql=fs.readFileSync(path.join(dir,'ENSAIO-PNCP-ROLLBACK.sql'),'utf8');
 assert.equal(m.executado,false);assert.equal(m.aprovacaoRevisaoPendente,true);assert.equal(hash(sql),m.sha256);
 for(const f of m.fontes){const raw=fs.readFileSync(path.join(root,f.arquivo));assert.equal(hash(raw),f.sha256Original);assert.equal(hash(raw.toString('utf8').replaceAll('\r\n','\n')),f.sha256);}
 assert.equal((sql.match(/^begin;$/gm)||[]).length,1);assert.equal((sql.match(/^rollback;$/gm)||[]).length,1);assert.doesNotMatch(sql,/^commit;|^notify /m);
 assert.match(sql,/gates:=true;\s*raise exception using errcode='ZP001'/);assert.match(sql,/exception when sqlstate 'ZP001' then\s*if not gates then raise;/);
 assert.doesNotMatch(sql,/count\(\*\) from auth.users\)<>0/);assert.match(sql,/Objetos PNCP já presentes/);assert.match(sql,/catalogo_depois is distinct from catalogo_antes/);assert.match(sql,/last_value::text/);assert.match(sql,/end \$qa_pncp\$;\s*select 'QA_PNCP_GATES_E_ROLLBACK_OK'/);assert.match(sql,/funcoes_pncp_ausentes;\s*rollback;/);
});
test('locks limitados às sete relações necessárias, com privilégios existentes e sem grants extras',()=>{
 const sql=fs.readFileSync(path.join(dir,'ENSAIO-PNCP-ROLLBACK.sql'),'utf8');
 const start=sql.indexOf('for r in select * from (values'),end=sql.indexOf('-- Demais relações',start),locks=sql.slice(start,end);
 assert.ok(start>0);assert.equal((locks.match(/\('(auth|public)'/g)||[]).length,7);assert.match(locks,/'auth','users'/);assert.doesNotMatch(locks,/schema_migrations|storage|from pg_tables/);assert.match(locks,/has_table_privilege/);assert.match(locks,/'SELECT'/);assert.match(locks,/'UPDATE'/);assert.doesNotMatch(locks,/\bgrant\b|alter.*owner/i);
 assert.match(sql,/for r in select schemaname,tablename from pg_tables where schemaname in\('public','auth','storage'\)/);
});
