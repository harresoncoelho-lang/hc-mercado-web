const test = require('node:test');
const assert = require('node:assert/strict');
const { paginaCurtaPendente } = require('../_pdf_cobertura');
const { OPS } = require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');
const pagina = (fnArray=[],argsArray=[]) => ({view:[0,0,600,800],getOperatorList:async()=>({fnArray,argsArray})});
test('página curta só com texto ou vazia não indica conteúdo ausente',async()=>{
 assert.equal(await paginaCurtaPendente(pagina()),false);
});
test('cabeçalho e rodapé gráficos não confundem página curta legível',async()=>{
 const p=pagina([OPS.save,OPS.transform,OPS.paintImageXObject,OPS.restore,OPS.transform,OPS.paintJpegXObject],
 [[],[100,0,0,40,30,750],['logo',100,40],[],[500,0,0,30,30,10],['rodape',500,30]]);
 assert.equal(await paginaCurtaPendente(p),false);
});
test('imagem de cláusula ou tabela no corpo mantém o alerta',async()=>{
 assert.equal(await paginaCurtaPendente(pagina([OPS.transform,OPS.paintImageXObject],[[400,0,0,120,50,300],['tabela',400,120]])),true);
});
test('página escaneada inteira mantém o alerta',async()=>{
 assert.equal(await paginaCurtaPendente(pagina([OPS.transform,OPS.paintImageXObject],[[600,0,0,800,0,0],['scan',600,800]])),true);
});
test('transformações aninhadas e eixo invertido não escondem imagem do corpo',async()=>{
 const p=pagina([OPS.transform,OPS.save,OPS.transform,OPS.paintImageXObject,OPS.restore],
 [[0.75,0,0,-0.75,0,800],[],[600,0,0,-200,0,500],['tabela',600,200],[]]);
 assert.equal(await paginaCurtaPendente(p),true);
});
test('falha de inspeção ou operação de imagem desconhecida mantém o alerta',async()=>{
 assert.equal(await paginaCurtaPendente({view:[0,0,600,800],getOperatorList:async()=>{throw Error('falha');}}),true);
 assert.equal(await paginaCurtaPendente({}),true);
 assert.equal(await paginaCurtaPendente(pagina([OPS.paintImageXObjectRepeat],[[]])),true);
});
test('imagem inteiramente branca não sinaliza conteúdo ausente; texto claro continua protegido',async()=>{
 const p=pagina([OPS.transform,OPS.paintImageXObject],[[400,0,0,120,50,300],['branco',2,2]]);
 const imagem={kind:2,width:2,height:2,data:new Uint8Array(12).fill(255)};
 p.objs={isResolved:()=>true,get:()=>imagem};
 assert.equal(await paginaCurtaPendente(p),false);
 imagem.data[0]=254;
 assert.equal(await paginaCurtaPendente(p),true);
});

test('cláusula em contornos vetoriais mantém alerta; linha e fundo retangular não',async()=>{
 assert.equal(await paginaCurtaPendente(pagina([OPS.constructPath,OPS.fill],[[[OPS.moveTo,OPS.curveTo,OPS.closePath],[50,300,60,310,70,320,80,330]],[]])),true);
 assert.equal(await paginaCurtaPendente(pagina([OPS.constructPath,OPS.stroke],[[[OPS.moveTo,OPS.lineTo],[50,300,200,300]],[]])),false);
 assert.equal(await paginaCurtaPendente(pagina([OPS.constructPath,OPS.fill],[[[OPS.rectangle],[50,300,200,20]],[]])),false);
});
