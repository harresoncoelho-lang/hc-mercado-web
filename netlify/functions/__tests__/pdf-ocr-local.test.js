const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { buscarTextoEdital } = require('../lib/ia-edital').__test;
const pasta = path.resolve(__dirname, '../../../docs/qa/editais-reais-novos/88124961000159-125');
async function lerLocal(arquivo, opcoes={}) {
 const original=global.fetch;
 const buffer=await readFile(path.join(pasta, arquivo));
 global.fetch=async(url)=>url.endsWith('/arquivos')?{ok:true,json:async()=>[{titulo:'Documento oficial',sequencialDocumento:1}]}:{ok:true,arrayBuffer:async()=>buffer};
 try{return await buscarTextoEdital('88124961000159-1-000125/2026',opcoes);}finally{global.fetch=original;}
}
test('PDF escaneado aciona OCR confiável nas sete páginas e declara proveniência sem certificar',async()=>{
 let solicitadas;
 const r=await lerLocal('documento-2.bin',{ocrPDF:async(buffer,{paginas})=>{solicitadas=paginas;return {idioma:'eng',paginas:paginas.map(pagina=>({pagina,texto:`Seção oficial da página ${pagina}. Informações recuperadas do documento escaneado para conferência. `.repeat(3)}))};}});
 assert.deepEqual(solicitadas,[1,2,3,4,5,6,7]);
 assert.match(r.texto,/\[Página 7\]/);
 assert.equal(r.coberturaLeitura.ocrDocumentos[0].revisadoVisualmente,false);
 assert.equal(r.coberturaLeitura.parcial,true);
 assert.equal(r.coberturaLeitura.ocrDocumentos[0].paginas.length,7);
});
test('OCR ausente, erro ou página omitida mantém cobertura parcial e não inventa recuperação',async()=>{
 for(const ocrPDF of [null,async()=>{throw Error('tempo');},async()=>({idioma:'eng',paginas:[{pagina:1,texto:'Texto reconhecido. '.repeat(20)}]})]){
  const r=await lerLocal('documento-2.bin',{ocrPDF});
  assert.equal(r.coberturaLeitura.parcial,true);
  assert.ok(r.coberturaLeitura.documentosNaoLidos.length);
 }
});
test('PDF nativo conserva texto e não aciona OCR sem páginas pendentes',async()=>{
 let chamadas=0;
 const r=await lerLocal('documento-1.bin',{ocrPDF:async()=>{chamadas++;throw Error('não esperado');}});
 assert.match(r.texto,/PREGÃO|Pregão/);
 assert.equal(chamadas,0);
});

test('página mista com texto longo e imagem central aciona OCR sem apagar texto nativo',async()=>{
 const arquivo=require.resolve('pdf-parse');const anterior=require.cache[arquivo];
 const { OPS }=require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');
 const texto='Cláusula nativa preservada com condição expressa. '.repeat(30);
 require.cache[arquivo]={exports:async(_,opcoes)=>({numpages:1,text:await opcoes.pagerender({pageIndex:0,view:[0,0,600,800],getTextContent:async()=>({items:[{str:texto,transform:[1,0,0,1,0,700]}]}),getOperatorList:async()=>({fnArray:[OPS.transform,OPS.paintImageXObject],argsArray:[[400,0,0,200,50,300],['imagem',400,200]]})})})};
 try{
  let paginas;
  const r=await lerLocal('documento-1.bin',{ocrPDF:async(_,ctx)=>{paginas=ctx.paginas;return {idioma:'eng',paginas:[{pagina:1,texto:'Tabela reconhecida: quantidade 123 unidades. '.repeat(4)}]};}});
  assert.deepEqual(paginas,[1]);assert.match(r.texto,/Cláusula nativa preservada/);assert.match(r.texto,/Tabela reconhecida: quantidade 123/);assert.equal(r.coberturaLeitura.parcial,true);
 }finally{require.cache[arquivo]=anterior;}
});

test('adaptador recusa configuração, páginas e tamanho inseguros; executável ausente não inventa OCR',async()=>{
 const { criarOCRLocal }=require('../_pdf_ocr_local');const os=require('node:os');const fs=require('node:fs/promises');
 assert.throws(()=>criarOCRLocal({pdftoppm:'comando & algo',tesseract:'tesseract'}));
 const ausente=path.join(os.tmpdir(),'licitaplena-executavel-inexistente');
 const ocr=criarOCRLocal({pdftoppm:ausente,tesseract:ausente});
 const pdf=Buffer.from('%PDF-fixture');
 await assert.rejects(ocr(pdf,{paginas:[0],totalPaginas:7}));
 await assert.rejects(ocr(pdf,{paginas:[1,1],totalPaginas:7}));
 await assert.rejects(ocr(Buffer.alloc(32*1024*1024+1),{paginas:[1],totalPaginas:1}));
 const antes=new Set((await fs.readdir(os.tmpdir())).filter(n=>n.startsWith('licitaplena-ocr-')));
 const primeira=ocr(pdf,{paginas:[1,2],totalPaginas:2});
 await assert.rejects(ocr(pdf,{paginas:[1],totalPaginas:1}),/ocupado/);
 const r=await primeira;assert.equal(r.paginas.length,0);assert.equal(r.pendencias.length,2);
 const depois=(await fs.readdir(os.tmpdir())).filter(n=>n.startsWith('licitaplena-ocr-')&&!antes.has(n));assert.deepEqual(depois,[]);
});

test('timeout real mantém página pendente e limpa tarefa local', {skip:!process.env.OCR_LOCAL_PDFTOPPM||!process.env.OCR_LOCAL_TESSERACT},async()=>{
 const { criarOCRLocal }=require('../_pdf_ocr_local');
 const ocr=criarOCRLocal({pdftoppm:process.env.OCR_LOCAL_PDFTOPPM,tesseract:process.env.OCR_LOCAL_TESSERACT,timeoutMs:1,timeoutPaginaMs:1});
 const r=await ocr(await readFile(path.join(pasta,'documento-2.bin')),{paginas:[1,2],totalPaginas:7});
 assert.equal(r.paginas.length,0);assert.equal(r.pendencias.length,2);
});

test('dispensa nativa de Belém mantém conteúdo sem invocar OCR desnecessário',async()=>{
 let chamadas=0;
 const r=await lerLocal('../08928517000157-116/documento-1.bin',{ocrPDF:async()=>{chamadas++;throw Error('OCR desnecessário');}});
 assert.match(r.texto,/DISPENSA|Dispensa/);
 assert.equal(chamadas,0);
 assert.equal(r.coberturaLeitura.ocrDocumentos.length,0);
});
