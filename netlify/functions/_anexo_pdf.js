const {createHash}=require('node:crypto');
const LIMITES=Object.freeze({bytes:2*1024*1024,paginas:20,caracteres:150000,tempoMs:10000});
async function lerAnexo(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length>LIMITES.bytes)throw Error('Anexo excede limite de leitura de 2 MiB');
 if(bytes.subarray(0,5).toString()!=='%PDF-')throw Error('Leitura disponível somente para PDF textual');
 const pdf=require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js'),{WorkerMessageHandler}=require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.worker.js');
 const port=new pdf.LoopbackPort(true);let worker,task,timer;
 try{
  worker=pdf.PDFWorker.fromPort(port);WorkerMessageHandler.initializeFromPort(port);task=pdf.getDocument({data:new Uint8Array(bytes),worker});
  const run=async()=>{const doc=await task;if(doc.numPages>LIMITES.paginas)throw Error('Anexo excede limite de 20 páginas; nenhuma leitura parcial aceita');let size=0;const paginas=[];
   for(let pagina=1;pagina<=doc.numPages;pagina++){const page=await doc.getPage(pagina),content=await page.getTextContent();let y=null,texto='';for(const item of content.items){if(y!==item.transform?.[5])texto+='\n';y=item.transform?.[5];texto+=item.str+' ';}size+=texto.length;if(size>LIMITES.caracteres)throw Error('Texto excede limite');paginas.push({pagina,texto});}
   if(!paginas.some(p=>p.texto.trim().length>30))throw Error('PDF sem texto suficiente; OCR não disponível');
   return {hash:createHash('sha256').update(bytes).digest('hex'),extratorVersao:'anexo-pdf-1',paginas};
  };return await Promise.race([run(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Tempo de leitura excedido')),LIMITES.tempoMs);})]);
 }finally{clearTimeout(timer);try{if(task)await task.destroy();}finally{try{if(worker)worker.destroy();}finally{port.terminate();}}}
}
module.exports={lerAnexo,LIMITES};
