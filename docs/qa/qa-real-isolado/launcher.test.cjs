const test=require('node:test'),assert=require('node:assert/strict');
const {validarEntrada,iniciar}=require('./launcher.cjs');
const {QA}=require('./isolamento.cjs');
const jwt=p=>`e30.${Buffer.from(JSON.stringify(p)).toString('base64url')}.assinatura_ficticia`;
const base=()=>({authUrl:QA,restUrl:QA,storageUrl:QA,publicKey:jwt({role:'anon',ref:'luguscapasskcsficckf',exp:Math.floor(Date.now()/1000)+600}),serviceKey:jwt({role:'service_role',ref:'luguscapasskcsficckf',exp:Math.floor(Date.now()/1000)+600}),emailsPermitidos:['operador-a@qa.invalid'],contextos:[{empresaId:'a1000000-0000-4000-8000-000000000002',processoId:'a1000000-0000-4000-8000-000000000003'}]});
test('role/ref/exp inválidos negados antes de qualquer rede',async()=>{
 let calls=0;
 for(const p of [{role:'service_role',ref:'producao',exp:9999999999},{role:'authenticated',ref:'luguscapasskcsficckf',exp:9999999999},{role:'service_role',ref:'luguscapasskcsficckf',exp:1}])await assert.rejects(iniciar({...base(),serviceKey:jwt(p)},{fetchImpl:async()=>{calls++;},emitir:()=>{}}),/Configuração QA inválida/);
 assert.throws(()=>validarEntrada({...base(),publicKey:jwt({role:'anon',ref:'producao',exp:9999999999})}));assert.equal(calls,0);
});
test('loopback efêmero imprime somente URL/hashes; chave nunca sai',async t=>{
 const output=[],input=base();let calls=0;
 const s=await iniciar(input,{fetchImpl:async()=>{calls++;throw Error('Não consultar');},emitir:x=>output.push(x)});
 t.after(()=>new Promise(r=>s.close(r)));
 assert.equal(s.address().address,'127.0.0.1');assert.equal(calls,0);
 const linha=JSON.parse(output[0]);assert.match(linha.url,/^http:\/\/127\.0\.0\.1:\d+$/);assert.ok(linha.hashes.length);
 assert.doesNotMatch(output.join(''),/serviceKey|publicKey|assinatura_ficticia|operador-a/);
});
test('organizações IA opcionais apenas fixtures e sem duplicação',()=>{
 assert.ok(validarEntrada(base()));
 const org='a1000000-0000-4000-8000-000000000001';assert.ok(validarEntrada({...base(),iaOrganizacoes:[org]}));
 for(const iaOrganizacoes of ['x',[org,org],['c1000000-0000-4000-8000-000000000001'],[null]])assert.throws(()=>validarEntrada({...base(),iaOrganizacoes}));
});
test('porta fixa explícita mantém origem e conflito não usa outra porta',async t=>{
 const output=[],input=base();const first=await iniciar(input,{fetchImpl:async()=>{throw Error('rede');},emitir:x=>output.push(x)});
 const port=first.address().port;await new Promise(r=>first.close(r));
 const s=await iniciar(input,{port,fetchImpl:async()=>{throw Error('rede');},emitir:x=>output.push(x)});t.after(()=>new Promise(r=>s.close(r)));assert.equal(s.address().port,port);
 await assert.rejects(iniciar(input,{port,fetchImpl:async()=>{throw Error('rede');},emitir:()=>{}}),{code:'EADDRINUSE'});
});
test('CLI rejeita porta inválida/duplicada antes de consumir transferência',()=>{
 const {argumentos}=require('./launcher.cjs');
 assert.deepEqual(argumentos(['--config','arquivo.json','--remove-transfer','--port','53820']),{arquivo:'arquivo.json',remover:true,stdin:false,port:53820});
 assert.equal(argumentos(['--stdin','--port','53820']).port,53820);
 for(const args of [['--stdin','--port','0'],['--stdin','--port','65536'],['--stdin','--port','abc'],['--stdin','--port','53820','--port','53820'],['--stdin','--remove-transfer'],['--config','x','--stdin']])assert.throws(()=>argumentos(args));
});
