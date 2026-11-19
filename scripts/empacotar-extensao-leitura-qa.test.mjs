import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync} from 'node:crypto';
import {mkdtemp,readFile,rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {empacotarQA} from './empacotar-extensao-leitura-qa.mjs';
test('pacote QA exige configuração íntegra antes de escrever e preserva manifesto fonte',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'lp-pacote-fixture-'));try{
 const key=generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({type:'spki',format:'der'});
 const extensionId=createHash('sha256').update(key).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
 const config={origem:'https://fixture.invalid',caminho:'/processos.html',extensionId,publicKey:key.toString('base64')};
 const dest=path.join(root,'pacote');const source=new URL('../extensao-leitura/manifest.json',import.meta.url),before=await readFile(source,'utf8');
 for(const patch of [{publicKey:''},{extensionId:'a'.repeat(32)},{origem:'https://u:p@fixture.invalid'},{origem:'https://*.fixture.invalid'},{origem:'https://fixture.invalid/?x=1'},{caminho:'/processos.html#x'}]){await assert.rejects(empacotarQA({...config,...patch},dest));await assert.rejects(stat(dest));}
 await empacotarQA(config,dest);const manifest=JSON.parse(await readFile(path.join(dest,'manifest.json'),'utf8'));
 assert.deepEqual(manifest.permissions,['activeTab','scripting','notifications','storage']);assert.equal(manifest.background.service_worker,'worker-qa.mjs');assert.deepEqual(manifest.externally_connectable.matches,['https://fixture.invalid/processos.html']);assert.equal(manifest.key,config.publicKey); assert.ok(manifest.optional_host_permissions.includes('http://127.0.0.1/*'));
 assert.equal(await readFile(source,'utf8'),before);await assert.rejects(empacotarQA(config,dest));
 }finally{await rm(root,{recursive:true,force:true});}
});
