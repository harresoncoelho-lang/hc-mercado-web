import fs from 'node:fs';
import path from 'node:path';
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const copy=x=>structuredClone(x);
// Estado local não é prova de aplicação. Toda intenção anterior consulta a fonte independente.
export function abrirPortaDuravel({arquivo,contexto},fonte){
 if(!path.isAbsolute(arquivo)||!contexto||fonte?.tipo!=='ficticia'||['lerPagina','aplicar','conciliar'].some(k=>typeof fonte[k]!=='function'))throw Error('Contrato inválido');
 const ctx=copy(contexto),lock=arquivo+'.lock',intencoes=new Map(),liberados=new Set();
 const lockfd=fs.openSync(lock,'wx',0o600);let fd=null,closed=false,busy=false,failed=false;
 function gravar(obj){const b=Buffer.from(JSON.stringify(obj)+'\n');let n=0;try{while(n<b.length){const wrote=fs.writeSync(fd,b,n,b.length-n);if(!wrote)throw Error();n+=wrote;}fs.fsyncSync(fd);}catch{failed=true;throw Error('Falha ao preservar intenção');}}
 try{
  if(fs.existsSync(arquivo)){
   const s=fs.lstatSync(arquivo);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>16*1024*1024)throw Error('Diário inválido');
   const raw=fs.readFileSync(arquivo,'utf8');if(!raw.endsWith('\n'))throw Error('Diário incompleto');
   const rows=raw.trimEnd().split('\n').map(x=>JSON.parse(x));
   if(!same(rows.shift(),{schema:1,contexto:ctx}))throw Error('Contexto divergente');
   for(const c of rows){if(!c||typeof c.id!=='string'||!same(c.contexto,ctx)||intencoes.has(c.id))throw Error('Intenção inválida');intencoes.set(c.id,c);}
   fd=fs.openSync(arquivo,'a');
  }else{fd=fs.openSync(arquivo,'ax',0o600);gravar({schema:1,contexto:ctx});}
 }catch(e){if(fd!==null)fs.closeSync(fd);fs.closeSync(lockfd);fs.unlinkSync(lock);throw e;}
 async function exclusivo(fn){if(closed||busy||failed)throw Error('Porta indisponível');busy=true;try{return await fn();}finally{busy=false;}}
 function validar(c){if(!c||typeof c.id!=='string'||!c.id||!same(c.contexto,ctx)||!c.item||!Number.isSafeInteger(c.versao))throw Error('Comando inválido');const old=intencoes.get(c.id);if(old&&!same(old,c))throw Error('Identidade divergente');}
 async function consultar(c){const r=await fonte.conciliar(copy(c));if(!same(r?.comando,c)||!['aplicado','nao_aplicado'].includes(r.status))throw Error('Fonte inconclusiva');return r;}
 return {
  tipo:'ficticia',
  lerPagina:q=>exclusivo(()=>fonte.lerPagina(q)),
  aplicar:c=>exclusivo(async()=>{
   validar(c);c=copy(c);
   if(intencoes.has(c.id)){
    const r=await consultar(c);
    if(r.status==='aplicado'){liberados.delete(c.id);return r;}
    if(!liberados.delete(c.id)){liberados.add(c.id);return {status:'rejeitado',comando:c};}
   }else{gravar(c);intencoes.set(c.id,c);}
   return fonte.aplicar(copy(c));
  }),
  conciliar:c=>exclusivo(async()=>{validar(c);if(!intencoes.has(c.id))throw Error('Intenção ausente');const r=await consultar(c);if(r.status==='nao_aplicado')liberados.add(c.id);return r;}),
  fechar(){if(busy)throw Error('Operação em curso');if(closed)return;closed=true;fs.closeSync(fd);fs.closeSync(lockfd);fs.unlinkSync(lock);},
 };
}
