const test = require('node:test');
const assert = require('node:assert/strict');
const { validarConfirmacao, validarArquivo, caminhoPermitido } = require('../_empresa_identificacao');
test('confirmação exige revisão e preserva cadastro canônico', () => {
 const empresa={razao_social:'Empresa Teste',cnpj:'11222333000181'};
 assert.throws(()=>validarConfirmacao({},empresa), /revisão/i);
 assert.throws(()=>validarConfirmacao({revisado:true,razaoSocial:'Outra',cnpj:empresa.cnpj,dados:{}},empresa),/cadastro/i);
 const r=validarConfirmacao({revisado:true,razaoSocial:empresa.razao_social,cnpj:empresa.cnpj,dados:{endereco:'Rua A',representante:'Ana',cargo:'Administradora'},proveniencia:[]},empresa);
 assert.equal(r.dados.endereco,'Rua A');
 assert.throws(()=>validarConfirmacao({revisado:true,razaoSocial:empresa.razao_social,cnpj:empresa.cnpj,dados:{cpf:'123'}},empresa),/campo/i);
});
test('arquivo privado aceita apenas PDF limitado e caminho exato',()=>{
 assert.equal(validarArquivo('a.pdf',Buffer.from('%PDF-1.4\n').toString('base64')).length,9);
 assert.throws(()=>validarArquivo('a.pdf',Buffer.from('html').toString('base64')),/PDF/);
 assert.equal(caminhoPermitido('org/empresa/a.pdf','org','empresa'),true);
 assert.equal(caminhoPermitido('org/empresa2/a.pdf','org','empresa'),false);
 assert.equal(caminhoPermitido('org/empresa/../a.pdf','org','empresa'),false);
});
test('três campos em páginas distintas reutilizam até dois documentos',()=>{
 const empresa={razao_social:'Empresa Teste',cnpj:'11222333000181'};const body={revisado:true,razaoSocial:empresa.razao_social,cnpj:empresa.cnpj,dados:{endereco:'Rua QA',representante:'Pessoa QA',cargo:'Administradora'},proveniencia:['endereco','representante','cargo'].map((campo,i)=>({documentoId:'doc1',hash:'a'.repeat(64),campos:[campo],pagina:i+1,trecho:'Fonte QA'}))};
 assert.equal(validarConfirmacao(body,empresa).proveniencia.length,3);
 assert.throws(()=>validarConfirmacao({...body,proveniencia:body.proveniencia.map((p,i)=>({...p,documentoId:'doc'+i}))},empresa),/Proveniência/);
});
