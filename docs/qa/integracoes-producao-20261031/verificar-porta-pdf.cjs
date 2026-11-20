// Experimento offline Node, não é implementação do produto nem prova de Workers.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {RAIZ,SAIDAS}=require('./preparar-cloudflare.cjs');
const {pdfFicticio}=require('./testar-worker.cjs');
async function verificar(){
  const pdf=require(path.join(RAIZ,'node_modules/pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js'));
  const {WorkerMessageHandler}=require(path.join(RAIZ,'node_modules/pdf-parse/lib/pdf.js/v1.10.100/build/pdf.worker.js'));
  assert.equal(typeof pdf.PDFWorker.fromPort,'function');assert.equal(typeof WorkerMessageHandler.initializeFromPort,'function');
  const loopback=process.argv.includes('--loopback');const ports=loopback?null:new MessageChannel();const port1=loopback?new pdf.LoopbackPort(true):ports.port1,port2=loopback?port1:ports.port2;let worker,doc,task,timer;let resultado;
  try{
    worker=pdf.PDFWorker.fromPort(port1);WorkerMessageHandler.initializeFromPort(port2);if(!loopback){port1.start();port2.start();}
    task=pdf.getDocument({data:new Uint8Array(pdfFicticio()),worker});doc=await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Tempo de leitura excedido')),5000);})]);
    const page=await doc.getPage(1);const texto=(await page.getTextContent()).items.map(i=>i.str).join('\n');
    assert.equal(doc.numPages,1);for(const campo of ['EMPRESA FICTICIA QA LTDA','RUA DE TESTES 100','ANA TESTE','SOCIA'])assert(texto.includes(campo));
    resultado={utc:new Date().toISOString(),ambiente:'Node local, sem workerd',transporte:loopback?'LoopbackPort exportado pelo PDF.js':'MessageChannel nativo',pdfjs:pdf.version,paginas:doc.numPages,camposEsperados:4,resultado:'leitura por porta explícita passou',arquivosProdutoAlterados:false,globaisAlteradasPeloExperimento:false};
  }finally{clearTimeout(timer);if(task)await task.destroy();if(worker)worker.destroy();if(loopback)port1.terminate();else{port1.close();port2.close();}}
  fs.writeFileSync(path.join(SAIDAS,'rodada-03-revisada/runtime-02/experimento-'+(loopback?'loopback':'porta')+'-node.json'),JSON.stringify(resultado,null,2),{flag:'wx'});return resultado;
}
verificar().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.stack);process.exitCode=1;});
