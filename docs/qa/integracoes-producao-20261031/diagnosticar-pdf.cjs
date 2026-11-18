// Diagnóstico offline de trechos já compilados; não inicia workerd nem acessa rede.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {RAIZ,SAIDAS}=require('./preparar-cloudflare.cjs');
async function diagnosticar(){
  const file=path.join(SAIDAS,'rodada-01/worker/index.js');const bytes=fs.readFileSync(file),codigo=bytes.toString();
  const funcao=codigo.match(/module2\.exports = (function\(\) \{\s*__require\.ensure\.apply\(this, arguments\);\s*\});/);
  assert(funcao,'Wrapper browser esperado precisa estar no bundle');
  assert(codigo.includes('__require.ensure = require_browser();'),'Atribuição do loader precisa estar no bundle');
  let erro;try{vm.runInNewContext('var __require={};__require.ensure='+funcao[1]+';__require.ensure([],function(){});',{}, {timeout:1000});}catch(e){erro={nome:e.name,mensagem:e.message};}
  assert.equal(erro?.nome,'RangeError');assert.match(erro.mensagem,/call stack/i);
  let callbackNode=false;await new Promise(resolve=>require(path.join(RAIZ,'node_modules/node-ensure/index.js'))([],()=>{callbackNode=true;resolve();}));
  const resultado={utc:new Date().toISOString(),modo:'reprodução offline do wrapper/atribuição extraídos; não instrumenta o Worker',bundleSha256:createHash('sha256').update(bytes).digest('hex'),erroReproduzido:erro,controleNodeCallback:callbackNode,produtoAlterado:false};
  const destino=path.join(SAIDAS,'rodada-03-revisada/runtime-02/diagnostico-offline.json');fs.writeFileSync(destino,JSON.stringify(resultado,null,2),{flag:'wx'});return resultado;
}
if(require.main===module)diagnosticar().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
