import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {abrirPortaDuravel} from './porta-duravel.mjs';
const contexto={cnpj:'12345678000195',purchaseId:'78882005000412026'};
const comando={id:'cadastro-v1:lote:1',contexto,versao:1,item:{id:'1',unitario:'1.2300'}};
const setup=t=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'cadastro-duravel-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return path.join(d,'journal.jsonl');};
const fonte=()=>({tipo:'ficticia',lerPagina:async()=>({}),aplicar:async c=>({status:'aplicado',comando:c}),conciliar:async()=>null});
test('restart em processos separados usa fonte independente e não reaplica',t=>{
 const arquivo=setup(t), ledger=arquivo+'.fonte';
 const module=new URL('./porta-duravel.mjs',import.meta.url).href;
 const script=`import fs from 'node:fs';import {abrirPortaDuravel} from '${module}'; const c=${JSON.stringify(comando)};const file=process.argv[1],ledger=process.argv[2],fase=process.argv[3];const p=abrirPortaDuravel({arquivo:file,contexto:c.contexto}, {tipo:'ficticia',lerPagina:async()=>({}),aplicar:async x=>{if(fs.existsSync(ledger))throw Error('duplicou');fs.writeFileSync(ledger,JSON.stringify(x));throw Error('resposta perdida');},conciliar:async()=>({status:'aplicado',comando:JSON.parse(fs.readFileSync(ledger))})});try {const r=await p.aplicar(c);if(fase==='2'&&r.status!=='aplicado')process.exitCode=2;}catch(e){if(fase==='2')throw e;}finally{p.fechar();}`;
 for(const fase of ['1','2']){const r=spawnSync(process.execPath,['--input-type=module','-e',script,arquivo,ledger,fase],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
 assert.deepEqual(JSON.parse(fs.readFileSync(ledger)),comando);
 assert.doesNotMatch(fs.readFileSync(arquivo,'utf8'),/authorization|expiraEm/);
});
test('lock real, divergência, fonte ausente e corrupção bloqueiam',async t=>{
 const arquivo=setup(t),p=abrirPortaDuravel({arquivo,contexto},fonte());
 assert.throws(()=>abrirPortaDuravel({arquivo,contexto},fonte()));
 await p.aplicar(comando);
 await assert.rejects(p.aplicar({...comando,item:{id:'1',unitario:'2.0000'}}));
 await assert.rejects(p.aplicar(comando));
 await assert.rejects(p.aplicar({...comando,contexto:{...contexto,cnpj:'11222333000181'}}));
 p.fechar();fs.appendFileSync(arquivo,'{');assert.throws(()=>abrirPortaDuravel({arquivo,contexto},fonte()));
});
test('não aplicado exige passagem por rejeição antes de repetir',async t=>{
 const arquivo=setup(t);let calls=0;const f=fonte();f.aplicar=async c=>{calls++;return {status:'rejeitado',comando:c};};f.conciliar=async c=>({status:'nao_aplicado',comando:c});
 let p=abrirPortaDuravel({arquivo,contexto},f);await p.aplicar(comando);p.fechar();p=abrirPortaDuravel({arquivo,contexto},f);
 assert.equal((await p.aplicar(comando)).status,'rejeitado');assert.equal(calls,1);
 await p.aplicar(comando);assert.equal(calls,2);p.fechar();
});
test('falha de fsync impede aplicação e mantém porta bloqueada',async t=>{
 const arquivo=setup(t);let calls=0;const f=fonte();f.aplicar=async()=>{calls++;};const p=abrirPortaDuravel({arquivo,contexto},f);
 const m=t.mock.method(fs,'fsyncSync',()=>{throw Error('disco');});
 await assert.rejects(p.aplicar(comando));m.mock.restore();await assert.rejects(p.aplicar(comando));assert.equal(calls,0);p.fechar();
});
test('segundo processo não adquire lock ativo',t=>{
 const arquivo=setup(t),p=abrirPortaDuravel({arquivo,contexto},fonte());
 const script=`import {abrirPortaDuravel} from '${new URL('./porta-duravel.mjs',import.meta.url).href}';try{abrirPortaDuravel({arquivo:process.argv[1],contexto:${JSON.stringify(contexto)}},{tipo:'ficticia',lerPagina(){},aplicar(){},conciliar(){}});process.exitCode=2;}catch{}`;
 const r=spawnSync(process.execPath,['--input-type=module','-e',script,arquivo],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);p.fechar();
});
test('motor novo permanece pausado e retoma por fonte independente',async t=>{
 const {criarMotor}=await import('./motor.mjs');const arquivo=setup(t);let calls=0,saved;
 const ctx={...contexto,uasg:'788820',number:'41',year:'2026'};
 const f={tipo:'ficticia',lerPagina:async()=>({contexto:ctx,ids:['1'],proximo:null}),aplicar:async c=>{calls++;saved=c;throw Error('perdida');},conciliar:async()=>({status:'aplicado',comando:saved})};
 const input={contexto:ctx,versao:1,catalogo:[{id:'1',quantidade:'1',grupo:null,exigidos:[]}],linhas:[{id:'1',quantidade:'1',unitario:'1.2300'}]};
 let p=abrirPortaDuravel({arquivo,contexto:ctx},f),m=criarMotor(input,p,()=>100);m.autorizar({id:'a',vinculo:m.vinculo,expiraEm:200});await m.executar();assert.equal(m.status().estado,'incerto');p.fechar();
 p=abrirPortaDuravel({arquivo,contexto:ctx},f);m=criarMotor(input,p,()=>100);assert.equal(m.status().estado,'pausado');await m.executar();assert.equal(calls,1);
 m.autorizar({id:'nova',vinculo:m.vinculo,expiraEm:200});await m.executar();assert.equal(m.status().estado,'concluido');assert.equal(calls,1);p.fechar();
});
