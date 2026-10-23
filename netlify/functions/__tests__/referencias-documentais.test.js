const test=require('node:test'), assert=require('node:assert/strict');
const {conferirEvidenciasDoResumo}=require('../_resumo_evidencias');
const {clausulasComEscopo}=require('../_referencias_documentais');
const resolver=(fonte,texto)=>conferirEvidenciasDoResumo({textoEdital:fonte,estrutura:{possiveisQuestionamentos:[texto]}}).estrutura;
const fonte='--- anexo.pdf ---\n[Página 1]\nModelo de Edital - Lei nº 14.133, de 2021.\n1. SANÇÕES\n1.1. A multa será de vinte por cento.\n[Página 2]\nModelo de Termo de Referência – Aquisições\n1. ENTREGA\n1.1. A entrega será realizada em trinta dias.';
test('escopo literal distingue Edital e TR dentro do mesmo PDF com página preservada',()=>{
 const r=resolver(fonte,'Esclarecer a multa no item 1.1 do TR.');
 assert.equal(r.versaoReferenciasQuestionamentos,2);
 const e=r.evidenciasQuestionamentos[0].evidencias;
 assert.equal(e.length,1);assert.equal(e[0].documento,'anexo.pdf');assert.equal(e[0].pagina,'2');assert.equal(e[0].escopoDocumento,'Termo de Referência');assert.match(e[0].texto,/entrega/);assert.doesNotMatch(e[0].texto,/multa/);
});
test('documento explícito ausente não é substituído por cláusula única de outro documento',()=>{
 const r=resolver('--- Edital.pdf ---\n[Página 1]\n1. MULTAS\n1.1. A multa será de vinte por cento.','Esclarecer o item 1.1 do TR.').evidenciasQuestionamentos[0];
 assert.deepEqual(r.evidencias,[]);assert.match(r.motivo,/inequívoca/);
});
test('duplicata no mesmo escopo e página diferente permanece ambígua',()=>{
 const r=resolver(fonte+'\n[Página 3]\nModelo de Termo de Referência – Aquisições\n1. ENTREGA\n1.1. Outra regra de entrega.','Esclarecer o item 1.1 do TR.').evidenciasQuestionamentos[0];
 assert.deepEqual(r.evidencias,[]);assert.match(r.motivo,/inequívoca/);
});
test('referência não aceita prefixo numérico nem faixa de itens como cláusula',()=>{
 const r=resolver('--- Edital.pdf ---\n[Página 1]\n1. REGRAS\n1.10. Regra contratual.','Conferir o item 1.1 do Edital e os itens 01 a 200.').evidenciasQuestionamentos[0];
 assert.deepEqual(r.evidencias,[]);assert.match(r.motivo,/1\.1/);assert.doesNotMatch(r.motivo,/01/);
});
test('número deslocado só é recuperado com sequência adjacente comprovada e texto literal',()=>{
 const x='--- anexo.pdf ---\n[Página 3]\nModelo de Edital - Lei nº 14.133, de 2021.\n3.5. Condição anterior.\nParticipação exclusiva para pequenas empresas,3.6.\nconforme a legislação aplicável.\n3.7. Condição seguinte.';
 const c=clausulasComEscopo(x).find(c=>c.numero==='3.6');assert.equal(c.pagina,'3');assert.equal(c.escopoDocumento,'Edital');assert.equal(c.marcadorDeslocado,true);assert.equal(c.texto,'Participação exclusiva para pequenas empresas,3.6. conforme a legislação aplicável.');
 assert.equal(clausulasComEscopo(x.replace('3.5. Condição','3.4. Condição')).some(c=>c.numero==='3.6'),false);
});
test('menção incidental ao TR não muda escopo e ausência de número continua sem prova',()=>{
 const x='--- Edital.pdf ---\n[Página 1]\n1. REGRAS\n1.1. O Termo de Referência integra este Edital.\n1.2. Uma regra específica.';
 assert.equal(clausulasComEscopo(x).find(c=>c.numero==='1.2').escopoDocumento,'Edital');
 const r=resolver(x,'Esclarecer a exigência no Termo de Referência.').evidenciasQuestionamentos[0];assert.deepEqual(r.evidencias,[]);assert.match(r.motivo,/nenhuma prova/);
});
