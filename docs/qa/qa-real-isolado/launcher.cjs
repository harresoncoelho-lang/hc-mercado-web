// Runner do harness existente. Nenhum segredo em argumentos, URL, manifesto ou logs.
const fs=require('node:fs'),path=require('node:path');
const {QA,preparar}=require('./isolamento.cjs');
const {criarServidor}=require('./servidor.cjs');
const PRIVADO='C:/Users/harre/AppData/Local/LicitaPlena/qa-runtime-private';
function falhar(){throw Error('Configuração QA inválida');}
function validarJWT(token,role){
 if(typeof token!=='string'||token.length>4096||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))falhar();
 let p;try{p=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));}catch{falhar();}
 if(p.role!==role||p.ref!=='luguscapasskcsficckf'||!Number.isSafeInteger(p.exp)||p.exp<=Math.floor(Date.now()/1000)+60)falhar();
 // Claims são guardas de destino/papel, não verificação de assinatura. Procedência vem da UI QA.
}
function validarEntrada(c){
 if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['authUrl','restUrl','storageUrl','publicKey','serviceKey','emailsPermitidos','contextos','iaOrganizacoes'].includes(k))
  ||['authUrl','restUrl','storageUrl'].some(k=>c[k]!==QA))falhar();
 validarJWT(c.serviceKey,'service_role');
 if(typeof c.publicKey!=='string')falhar();
 if(!/^sb_publishable_[A-Za-z0-9_-]+$/.test(c.publicKey))validarJWT(c.publicKey,'anon');
 if(!Array.isArray(c.emailsPermitidos)||!c.emailsPermitidos.length||c.emailsPermitidos.some(x=>!['operador-a@qa.invalid','operador-b@qa.invalid'].includes(x))
  ||!Array.isArray(c.contextos)||!c.contextos.length||c.contextos.some(x=>!x||Object.keys(x).some(k=>!['empresaId','processoId'].includes(k))
   ||!['a','b'].some(p=>x.empresaId===p+'1000000-0000-4000-8000-000000000002'&&x.processoId===p+'1000000-0000-4000-8000-000000000003')))falhar();
 if(c.iaOrganizacoes!==undefined&&(!Array.isArray(c.iaOrganizacoes)||c.iaOrganizacoes.length>2||new Set(c.iaOrganizacoes).size!==c.iaOrganizacoes.length||c.iaOrganizacoes.some(id=>!['a1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001'].includes(id))))falhar();
 return c;
}
async function iniciar(entrada,{fetchImpl=global.fetch,emitir=console.log,port=0}={}){
 if(!Number.isInteger(port)||port<0||port>65535)falhar();
 const c=validarEntrada(entrada);
 const copia=preparar({authUrl:c.authUrl,restUrl:c.restUrl,storageUrl:c.storageUrl,publicKey:c.publicKey});
 const servidor=criarServidor({copia,serviceKey:c.serviceKey,fetchImpl,emailsPermitidos:c.emailsPermitidos,contextos:c.contextos,iaOrganizacoes:c.iaOrganizacoes});
 await new Promise((resolve,reject)=>{servidor.once('error',reject);servidor.listen(port,'127.0.0.1',resolve);});
 emitir(JSON.stringify({url:'http://127.0.0.1:'+servidor.address().port,hashes:copia.manifesto.map(x=>({arquivo:x.path,sha256:x.derivadoHash}))}));
 return servidor;
}
function caminhoPermitido(arquivo){
 if(typeof arquivo!=='string'||!path.isAbsolute(arquivo)||path.dirname(path.resolve(arquivo)).toLowerCase()!==path.resolve(PRIVADO).toLowerCase()||path.extname(arquivo).toLowerCase()!=='.json')falhar();
 return path.resolve(arquivo);
}
function lerTransferencia(arquivo,remover=false){
 const alvo=caminhoPermitido(arquivo),stat=fs.lstatSync(alvo);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>16384
  ||path.dirname(fs.realpathSync(alvo)).toLowerCase()!==fs.realpathSync(PRIVADO).toLowerCase())falhar();
 const fd=fs.openSync(alvo,'r');let raw;
 try{const aberto=fs.fstatSync(fd);if(aberto.ino!==stat.ino||aberto.size!==stat.size)falhar();raw=fs.readFileSync(fd,'utf8');}
 finally{fs.closeSync(fd);}
 if(Buffer.byteLength(raw,'utf8')>16384)falhar();
 if(remover){const atual=fs.lstatSync(alvo);if(atual.ino!==stat.ino||atual.size!==stat.size)falhar();fs.unlinkSync(alvo);}
 return raw;
}
function argumentos(input){
 const args=[...input];let port=0;
 const i=args.indexOf('--port');
 if(i>=0){if(!/^[1-9]\d{0,4}$/.test(args[i+1]||'')||Number(args[i+1])>65535)falhar();port=Number(args[i+1]);args.splice(i,2);if(args.includes('--port'))falhar();}
 if(args.length===1&&args[0]==='--stdin')return {stdin:true,port};
 if(args[0]==='--config'&&(args.length===2||args.length===3&&args[2]==='--remove-transfer')&&typeof args[1]==='string'&&!args[1].startsWith('--'))return {arquivo:args[1],remover:args[2]==='--remove-transfer',stdin:false,port};
 falhar();
}
async function main(args){
 const op=argumentos(args);
 let raw;
 if(op.stdin){
  const chunks=[];let size=0;for await(const b of process.stdin){size+=b.length;if(size>16384)falhar();chunks.push(b);}raw=Buffer.concat(chunks).toString('utf8');
 }else raw=lerTransferencia(op.arquivo,op.remover);
 let c;try{c=JSON.parse(raw);}catch{falhar();}raw=null;
 const servidor=await iniciar(c,{port:op.port});c=null;
 for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>servidor.close(()=>process.exit(0)));
}
if(require.main===module)main(process.argv.slice(2)).catch(()=>{console.error('Falha no launcher QA; nenhum detalhe de credencial foi registrado.');process.exitCode=1;});
module.exports={validarEntrada,iniciar,caminhoPermitido,lerTransferencia,argumentos};
