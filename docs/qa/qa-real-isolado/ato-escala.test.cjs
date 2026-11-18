const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const hash=(x,alg='sha256')=>crypto.createHash(alg).update(x).digest('hex');
test('atos correspondem à fonte ensaiada e exigem baseline e backup exato',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'ATO-ESCALA-manifesto.json'))),texts={};
 for(const f of manifest.arquivos){texts[f.arquivo]=fs.readFileSync(path.join(__dirname,f.arquivo),'utf8');assert.equal(hash(texts[f.arquivo]),f.sha256);}
 const a=texts['ATO-ESCALA-01-APLICAR.sql'],c=texts['ATO-ESCALA-00-CAPTURAR.sql'];assert.equal(manifest.executado,false);
 assert.match(c,/begin read only/);assert.match(c,/pg_get_functiondef\(p.oid\)/);assert.match(c,/'rollbackSql',format/);assert.match(c,/Peças usam capacidade nova/);
 assert.match(a,/64c94369bded0ca5721959406a8d5434/);assert.match(a,/CAS baseline\/ACL divergente/);assert.match(a,/Pós-aplicação divergente/);
 assert.doesNotMatch(a,/^grant |^revoke |alter.*owner|insert into auth\.users/m);
 const candidate=a.match(/execute \$candidata\$([\s\S]*?)\$candidata\$/)[1],body=candidate.match(/as \$\$([\s\S]*?)\$\$;/i)[1];assert.equal(hash(body,'md5'),manifest.candidatoBodyMd5);
 assert.match(a,/QA_ESCALA_APLICADA/);assert.match(c,/ACL\/metadata de reversão divergente/);
});
