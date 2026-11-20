const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extrairDocumento } = require('../_empresa_documentos');
const fixture = () => fs.readFileSync(path.join(__dirname, '../../../docs/qa/fixtures/identificacao-cartao-ficticio.pdf'));

test('leitura empresarial não invoca o loader fakeWorker que recursa no bundle', async t => {
  const pdf = require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');
  t.mock.method(pdf.PDFWorker.prototype, '_setupFakeWorker', () => { throw new Error('Loader compartilhado não pode ser usado'); });
  const r = await extrairDocumento(fixture());
  assert.equal(r.modo, 'sugestoes');
  assert.equal(r.sugestoes.endereco, 'Rua de Teste 123');
  assert.equal(r.evidencias.find(e => e.campo === 'endereco').pagina, 1);
});

test('importar o leitor não antecipa a carga de PDF.js', () => {
  const { spawnSync } = require('node:child_process');
  const helper = path.resolve(__dirname, '../_empresa_pdf_leitor.js');
  const script = 'require(process.argv[1]);if(Object.keys(require.cache).some(p=>p.includes("pdf-parse")))process.exit(9)';
  const r = spawnSync(process.execPath, ['-e', script, helper], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
});

function pdfPaginado(n) {
  const stream = 'BT /F1 12 Tf 50 760 Td (Documento ficticio de teste com texto suficiente.) Tj ET';
  const objetos = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${Array.from({length:n},(_,i)=>`${i+5} 0 R`).join(' ')}] /Count ${n} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  for(let i=0;i<n;i++)objetos.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>');
  let texto='%PDF-1.4\n';const offsets=[];
  objetos.forEach((obj,i)=>{offsets.push(Buffer.byteLength(texto));texto+=`${i+1} 0 obj\n${obj}\nendobj\n`;});
  const xref=Buffer.byteLength(texto);texto+=`xref\n0 ${objetos.length+1}\n0000000000 65535 f \n`+offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Root 1 0 R /Size ${objetos.length+1} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(texto);
}

test('leitor respeita oito páginas e não extrai documento maior', async()=>{
  const {lerPaginasPdf}=require('../_empresa_pdf_leitor');
  assert.equal((await lerPaginasPdf(pdfPaginado(8))).paginas.length,8);
  const nove=await lerPaginasPdf(pdfPaginado(9));assert.equal(nove.numpages,9);assert.deepEqual(nove.paginas,[]);
  const r=await extrairDocumento(pdfPaginado(9));assert.equal(r.modo,'manual');assert.match(r.avisos[0],/8 páginas/);
  await assert.rejects(lerPaginasPdf(Buffer.alloc(2*1024*1024+1)),/Limite/);
});

test('tempo excedido destrói tarefa, worker e porta sem depender do loader',async t=>{
  const pdf=require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');const {lerPaginasPdf}=require('../_empresa_pdf_leitor');
  let tarefaDestruida=0,workerDestruido=0,portaEncerrada=0;
  const destroy=pdf.PDFWorker.prototype.destroy,terminate=pdf.LoopbackPort.prototype.terminate;
  t.mock.method(pdf,'getDocument',()=>Object.assign(new Promise(()=>{}),{destroy:async()=>{tarefaDestruida++;}}));
  t.mock.method(pdf.PDFWorker.prototype,'destroy',function(){workerDestruido++;return destroy.call(this);});
  t.mock.method(pdf.LoopbackPort.prototype,'terminate',function(){portaEncerrada++;return terminate.call(this);});
  await assert.rejects(lerPaginasPdf(fixture(),5),/Tempo de leitura/);
  assert.equal(tarefaDestruida,1);assert.equal(workerDestruido,1);assert.equal(portaEncerrada,1);
});

test('falha ao carregar PDF mantém fallback manual e encerra a porta',async t=>{
  const pdf=require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');let terminou=0;const original=pdf.LoopbackPort.prototype.terminate;
  t.mock.method(pdf.LoopbackPort.prototype,'terminate',function(){terminou++;return original.call(this);});
  const r=await extrairDocumento(Buffer.from('%PDF-1.4\nDocumento ficticio invalido'));
  assert.equal(r.modo,'manual');assert.equal(terminou,1);
});
