const test = require('node:test');
const assert = require('node:assert/strict');
const { montar } = require('../resumo-modelo');
test('resumo exibe aviso OCR completo, idioma, páginas e falhas sem certificação',()=>{
 const r=montar({coberturaLeitura:{parcial:true,documentosLidos:['ETP'],documentosNaoLidos:['ETP: OCR não revisado'],avisosOCR:['ETP: OCR automático não revisado (eng), páginas 1, 2; conferir números e tabelas no original.'],ocrDocumentos:[{documento:'ETP',idioma:'eng',paginas:[{pagina:1},{pagina:2}],pendencias:['Página 3: OCR não concluído'],revisadoVisualmente:false}]}});
 const campos=r.secoes.find(s=>s.titulo==='Cobertura da análise').campos;
 assert.match(JSON.stringify(campos),/OCR automático não revisado \(eng\), páginas 1, 2; conferir números e tabelas/);
 assert.match(JSON.stringify(campos),/Página 3: OCR não concluído/);
 assert.match(JSON.stringify(campos),/Extração parcial/);
});
