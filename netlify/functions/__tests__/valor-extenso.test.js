const test=require('node:test');
const assert=require('node:assert/strict');
const {valorPorExtenso}=require('../_kit_documentos');

test('valorPorExtenso: casos de referência (centavos em BigInt ou string)',()=>{
 const casos=[
  [0n,'zero reais'],
  [1n,'um centavo'],
  [2n,'dois centavos'],
  [100n,'um real'],
  [10000n,'cem reais'],
  [10100n,'cento e um reais'],
  [100000n,'mil reais'],
  [100100n,'mil e um reais'],
  [120000n,'mil e duzentos reais'],
  [123456n,'mil duzentos e trinta e quatro reais e cinquenta e seis centavos'],
  [100000000n,'um milhão de reais'],
  [100000050n,'um milhão de reais e cinquenta centavos'],
  [200000101n,'dois milhões e um reais e um centavo'],
  [2000000000000n,'vinte bilhões de reais'],
  ['1517',"quinze reais e dezessete centavos"],
  [99999999999999n,'novecentos e noventa e nove bilhões novecentos e noventa e nove milhões novecentos e noventa e nove mil novecentos e noventa e nove reais e noventa e nove centavos'],
 ];
 for(const [c,esperado] of casos)assert.equal(valorPorExtenso(c),esperado,String(c));
});

test('valorPorExtenso: limite do kit (R$ 9,99 tri) cabe; acima, negativo ou decimal com ponto falham',()=>{
 assert.match(valorPorExtenso(999999999999999n),/^nove trilhões novecentos e noventa e nove bilhões .* reais e noventa e nove centavos$/);
 assert.throws(()=>valorPorExtenso(10n**17n),RangeError);
 assert.throws(()=>valorPorExtenso(-1n),RangeError);
 assert.throws(()=>valorPorExtenso('12.50'),SyntaxError);
});
