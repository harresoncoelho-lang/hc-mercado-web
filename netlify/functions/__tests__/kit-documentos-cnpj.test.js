const test=require('node:test');
const assert=require('node:assert/strict');
const {preparar,textoFinal}=require('../_kit_documentos');
// B1 (teste ponta a ponta 18/11): declaração de texto livre saía com "CNPJ: 12345678000195".
const ctx={userId:'u',empresa:{id:'e',razao_social:'Empresa QA',cnpj:'12345678000195'},processo:{numero:'1/2026',orgao:'Órgão'},perfil:{dados_confirmados:{endereco:'Rua A',representante:'Ana',cargo:'Sócia'}},itens:[]};
const body=texto=>({tipo:'declaracao',declaracao:{titulo:'Declaração',texto}});
test('DOCX da declaração livre sai com CNPJ mascarado no cabeçalho e na variável',()=>{
 const r=preparar(ctx,body('A {{razao_social}}, CNPJ {{cnpj}}, declara.'));
 const final=textoFinal(r,null);
 assert.match(final,/CNPJ: 12\.345\.678\/0001-95\n/);
 assert.match(final,/CNPJ 12\.345\.678\/0001-95, declara/);
 assert.doesNotMatch(final,/12345678000195/);
});
test('prévia e revisaoHash não mudam: peça já revisada continua válida',()=>{
 const r=preparar(ctx,body('CNPJ {{cnpj}}.'));
 assert.match(r.previa.texto,/CNPJ: 12345678000195/);
 assert.equal(r.revisaoHash,preparar(ctx,body('CNPJ {{cnpj}}.')).revisaoHash);
});
test('com CPF: máscara também no texto exportado; número maior que contém o CNPJ não é tocado',()=>{
 const r=preparar(ctx,body('CPF {{cpf_representante}}; protocolo 9123456780001950.'));
 const final=textoFinal(r,'529.982.247-25');
 assert.match(final,/CNPJ: 12\.345\.678\/0001-95/);
 assert.match(final,/protocolo 9123456780001950/);
 assert.equal(textoFinal(r,null),null);
});
