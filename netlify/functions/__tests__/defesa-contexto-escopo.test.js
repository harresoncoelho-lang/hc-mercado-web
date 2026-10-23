const test=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {prepararContexto,mensagensDefesa}=require('../_defesa_contexto');
const fonte='--- anexo.pdf ---\n[Página 1]\nModelo de Edital - Lei nº 14.133, de 2021.\n1. SANÇÕES\n1.1. A multa será recolhida em trinta dias.\n[Página 2]\nModelo de Termo de Referência – Aquisições\n1. SANÇÕES\n1.1. A multa será recolhida em cinco dias.';
const body={tipo:'esclarecimento',questionamento:'Esclarecer o recolhimento da multa no item 1.1 do TR.'};
const dossie=textoEdital=>({textoEdital,estrutura:{identificacao:{modalidade:'Pregão eletrônico'},coberturaLeitura:{parcial:false,documentosNaoLidos:[]}}});
test('contexto não anexa cabeçalho do TR à última cláusula do Edital e preserva escopo',()=>{
 const ctx=prepararContexto(dossie(fonte),body);
 const edital=ctx.fontes.find(f=>f.numero==='1.1'&&f.escopoDocumento==='Edital');
 const tr=ctx.fontes.find(f=>f.numero==='1.1'&&f.escopoDocumento==='Termo de Referência');
 assert.ok(edital&&tr);assert.doesNotMatch(edital.texto,/Modelo de Termo/);assert.match(tr.texto,/cinco dias/);assert.equal(tr.pagina,'2');
 assert.equal(ctx.hashFonte,createHash('sha256').update(fonte).digest('hex'));
 assert.ok(ctx.fontes.reduce((s,f)=>s+f.texto.length,0)<=18000);
 const json=JSON.parse(mensagensDefesa(ctx,body)[1].content);
 assert.equal(json.clausulasCanonicas,undefined);assert.ok(json.fontes.some(f=>f.escopoDocumento==='Termo de Referência'));
 assert.equal(ctx.clausulasCanonicas.filter(c=>c.numero==='1.1').length,2);
});
test('mesmo texto e número em escopos diferentes não são deduplicados nem herdam caput alheio',()=>{
 const x=fonte.replace('cinco dias','trinta dias').replace('[Página 2]','[Página 1]').replace('1. SANÇÕES\n1.1. A multa será recolhida em trinta dias.','1. Se houver contratação, aplicar a condição abaixo.\n1.1. A multa será recolhida em trinta dias.');
 const ctx=prepararContexto(dossie(x),body), tr=ctx.fontes.find(f=>f.numero==='1.1'&&f.escopoDocumento==='Termo de Referência');
 assert.ok(tr);assert.doesNotMatch(tr.texto,/Se houver contratação/);assert.equal(ctx.fontes.filter(f=>f.numero==='1.1').length,2);
});
test('contexto real 28 conserva cláusula 3.6 recuperada e sua origem documental',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const x=fs.readFileSync(path.join(__dirname,'fixtures/ux28-fonte-publica.txt'),'utf8');
 const trecho=x.slice(x.indexOf("3.5. A não observância"),x.indexOf("3.8. Será concedido"));
 const ctx=prepararContexto(dossie(`--- anexo.pdf ---\n[Página 3]\nModelo de Edital - Lei nº 14.133, de 2021.\n${trecho}`),{...body,questionamento:'Esclarecer o item 3.6 do Edital e o subitem 4.4 do Termo de Referência.'});
 const c=ctx.clausulasCanonicas.find(c=>c.numero==='3.6'&&c.escopoDocumento==='Edital');
 assert.ok(c);assert.match(c.texto,/participação é exclusiva/i);assert.ok(ctx.fontes.some(f=>f.numero==='3.6'&&f.escopoDocumento==='Edital'));
});


