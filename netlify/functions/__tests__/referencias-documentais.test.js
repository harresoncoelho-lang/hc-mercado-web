const test=require('node:test'), assert=require('node:assert/strict');
const {conferirEvidenciasDoResumo}=require('../_resumo_evidencias');
const {clausulasComEscopo}=require('../_referencias_documentais');
const resolver=(fonte,texto)=>conferirEvidenciasDoResumo({textoEdital:fonte,estrutura:{possiveisQuestionamentos:[texto]}}).estrutura;
const fonte='--- anexo.pdf ---\n[Página 1]\nModelo de Edital - Lei nº 14.133, de 2021.\n1. SANÇÕES\n1.1. A multa será de vinte por cento.\n[Página 2]\nModelo de Termo de Referência – Aquisições\n1. ENTREGA\n1.1. A entrega será realizada em trinta dias.';
test('escopo literal distingue Edital e TR dentro do mesmo PDF com página preservada',()=>{
 const r=resolver(fonte,'Esclarecer a multa no item 1.1 do TR.');
 assert.equal(r.versaoReferenciasQuestionamentos,3);
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


test('wrappers Python e Fonte conservam arquivo/página e títulos de rodapé canônicos reais',()=>{
 const paginas=require('./fixtures/ux28-poppler-paginas-publicas.json');const pontos=require('./fixtures/ux28-pontos-publicos.json');
 for(const formato of ['python','fonte']){
  const fonte=paginas.map(p=>`${formato==='python'?`--- anexo.pdf, página ${p.pagina} ---`:`[Fonte: anexo.pdf, página ${p.pagina}]`}\n${p.texto}`).join('\n');
  const r=conferirEvidenciasDoResumo({textoEdital:fonte,estrutura:{possiveisQuestionamentos:pontos}});
  assert.equal(r.textoEdital,fonte);assert.equal(r.estrutura.versaoReferenciasQuestionamentos,3);
  assert.deepEqual(r.estrutura.evidenciasQuestionamentos[0].evidencias.map(e=>[e.numero,e.documento,e.pagina,e.escopoDocumento]),[['14.4','anexo.pdf','17','Edital'],['7.7','anexo.pdf','25','Termo de Referência']]);
  assert.deepEqual(r.estrutura.evidenciasQuestionamentos[1].evidencias.map(e=>[e.numero,e.pagina,e.escopoDocumento]),[['3.6','3','Edital'],['4.4','23','Termo de Referência']]);
 }
});
test('escopo atravessa somente páginas adjacentes do mesmo arquivo',()=>{
 const base='--- anexo.pdf, página 1 ---\nModelo de Edital - Lei nº 14.133, de 2021.\n1. REGRAS\n1.1. Primeira regra.';
 const segunda='\n1.2. Regra da segunda página.';
 assert.equal(clausulasComEscopo(base+'\n--- anexo.pdf, página 2 ---'+segunda).find(c=>c.numero==='1.2').escopoDocumento,'Edital');
 for(const wrapper of ['--- outro.pdf, página 2 ---','--- anexo.pdf, página 3 ---']) assert.equal(clausulasComEscopo(base+'\n'+wrapper+segunda).find(c=>c.numero==='1.2').escopoDocumento,null);
});
test('rodapé não relabela conteúdo antes de ANEXO/heading conflitante na mesma página',()=>{
 const x='--- anexo.pdf, página 1 ---\nModelo de Edital - Lei nº 14.133, de 2021.\n1. REGRAS\n1.1. Regra do Edital.\nANEXO I\nTERMO DE REFERÊNCIA\n1. REGRAS\n1.1. Regra do TR.\nCâmara Nacional de Modelos de Licitações e Contratos da Consultoria-Geral da União\nModelo de Termo de Referência – Aquisições\nAprovado pela Secretaria de Gestão e Inovação\nIdentidade visual pela Secretaria de Gestão e Inovação\nAtualização: DEZ/2025.';
 const c=clausulasComEscopo(x).filter(c=>c.numero==='1.1');assert.equal(c.length,2);assert.equal(c[0].escopoDocumento,'Edital');assert.equal(c[1].escopoDocumento,'Termo de Referência');
});
test('assinatura incompleta não permite inferir retroativamente escopo do corpo',()=>{
 const x='--- anexo.pdf, página 1 ---\nModelo de Edital - Lei nº 14.133, de 2021.\n1. REGRAS\n1.1. Edital.\n--- anexo.pdf, página 2 ---\n1.2. Corpo ainda não identificado.\nModelo de Termo de Referência – Aquisições\nAtualização: DEZ/2025.';
 assert.equal(clausulasComEscopo(x).find(c=>c.numero==='1.2').escopoDocumento,null);
});

test('heading de corpo do mesmo escopo também impede backfill do trecho anterior',()=>{
 const x='--- anexo.pdf, página 1 ---\nModelo de Edital - Lei nº 14.133, de 2021.\n1.1. Edital.\n--- anexo.pdf, página 2 ---\n1.2. Continuação anterior.\nTERMO DE REFERÊNCIA\n2.1. Cláusula do TR.\nCâmara Nacional de Modelos de Licitações e Contratos da Consultoria-Geral da União\nModelo de Termo de Referência – Aquisições\nAprovado pela Secretaria de Gestão e Inovação\nIdentidade visual pela Secretaria de Gestão e Inovação\nAtualização: DEZ/2025.';
 const c=clausulasComEscopo(x);assert.notEqual(c.find(c=>c.numero==='1.2').escopoDocumento,'Termo de Referência');assert.equal(c.find(c=>c.numero==='2.1').escopoDocumento,'Termo de Referência');
});
test('segunda assinatura canônica de rodapé sem linha de identidade visual é reconhecida',()=>{
 const x='--- anexo.pdf, página 25 ---\n7.7. A multa será recolhida em cinco dias.\nCâmara Nacional de Modelos de Licitações e Contratos da Consultoria-Geral da União\nModelo de Termo de Referência – Aquisições\nAprovado pela Secretaria de Gestão e Inovação\nAtualização: NOV/2025.';
 const c=clausulasComEscopo(x).find(c=>c.numero==='7.7');assert.equal(c.escopoDocumento,'Termo de Referência');assert.equal(c.pagina,'25');
});

test('salto ou repetição de página nativa também interrompe continuidade de escopo',()=>{
 const base='--- anexo.pdf ---\n[Página 1]\nModelo de Edital - Lei nº 14.133, de 2021.\n1.1. Primeira regra.';
 for(const pagina of [1,3]){
  const c=clausulasComEscopo(`${base}\n[Página ${pagina}]\n1.2. Regra ainda não identificada.`).find(c=>c.numero==='1.2');
  assert.equal(c.escopoDocumento,null);
 }
 assert.equal(clausulasComEscopo(`${base}\n[Página 2]\n1.2. Regra seguinte.`).find(c=>c.numero==='1.2').escopoDocumento,'Edital');
});
