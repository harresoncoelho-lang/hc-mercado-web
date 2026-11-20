const test=require('node:test'),assert=require('node:assert/strict');
test('contratos de leitura estritos e gate explícito',()=>{
 const {validarPedido}=require('../netlify/functions/_ponte_leitura');
 const ids={empresaId:'11111111-1111-4111-8111-111111111111',processoId:'11111111-1111-4111-8111-111111111111',documentoId:'11111111-1111-4111-8111-111111111111'};
 assert.equal(validarPedido({...ids,acao:'iniciarLeitura',versaoEsperada:1}),true);
 assert.equal(validarPedido({...ids,acao:'iniciarLeitura',versaoEsperada:1,jwt:'não'}),false);
 assert.equal(validarPedido({acao:'cancelarLeitura',tentativaId:ids.documentoId}),true);
 assert.equal(validarPedido({acao:'cancelarLeitura',tentativaId:ids.documentoId,documentoId:ids.documentoId}),false);
});
