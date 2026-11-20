const test=require('node:test'),assert=require('node:assert/strict');
const {validarPedido}=require('../netlify/functions/_ponte_leitura');
const id='11111111-1111-4111-8111-111111111111';
const base={empresaId:id,processoId:id,documentoId:id,versaoEsperada:1};
test('consulta e correspondencias exigem seletores estritos e revisao explicita',()=>{
 assert.equal(validarPedido({...base,acao:'consultarLeituras'}),true);
 assert.equal(validarPedido({...base,acao:'consultarLeituras',cursor:id}),true);
 const b={...base,acao:'confirmarCorrespondencias',recibo:id,versaoCorrespondencia:0,revisado:true,pares:[{itemId:id,portalId:'1'}]};
 assert.equal(validarPedido(b),true);
 for(const patch of [{revisado:false},{pares:[]},{versaoCorrespondencia:-1},{pares:[{itemId:id,portalId:'1',descricao:'inferida'}]},{nonce:'indevido'}])assert.equal(validarPedido({...b,...patch}),false);
});
