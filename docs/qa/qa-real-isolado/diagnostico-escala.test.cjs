const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),crypto=require('crypto');
test('diagnóstico preserva candidato exato e reverte antes de retornar',()=>{
const m=JSON.parse(fs.readFileSync(path.join(__dirname,'ATO-ESCALA-02-manifesto.json'))),sql=fs.readFileSync(path.join(__dirname,m.arquivo),'utf8'),h=(s,a='sha256')=>crypto.createHash(a).update(s).digest('hex');assert.equal(h(sql),m.sha256);
const bytes=Buffer.from(sql.match(/bytes:=decode\('([^']+)'/)[1],'base64'),original=fs.readFileSync(path.join(__dirname,'ATO-ESCALA-01-APLICAR.sql'),'utf8').match(/execute \$candidata\$([\s\S]*?)\$candidata\$/)[1];assert.equal(bytes.toString('utf8'),original);assert.equal(h(bytes,'md5'),m.candidatoMd5);assert.equal(bytes.length,m.candidatoBytes);
assert.match(sql,/passou:=true;\s*raise exception using errcode='ZD001'/);assert.match(sql,/if not passou then raise/);assert.match(sql,/Baseline não restaurada/);assert.match(sql,/'metadataCoincide',antes=depois/);assert.match(sql,/rollback;\s*$/);assert.doesNotMatch(sql,/^commit;|^grant |^revoke /m);
});
