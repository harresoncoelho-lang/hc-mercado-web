const test=require('node:test'),assert=require('node:assert/strict');
const {prepararContexto}=require('../_defesa_contexto');const {ancorasSolicitadas}=require('../_defesa_pontos');
const fonte='--- anexo.pdf ---\n[Página 1]\nModelo de Edital - Lei nº 14.133, de 2021.\n1. REGRAS\n1.1. A multa será recolhida em trinta dias.\n2. Se houver contratação, aplicam-se as condições abaixo.\n2.1. O fornecimento será realizado em cinco dias após a ordem de fornecimento.\n3.1. O pagamento será efetuado em trinta dias.\n[Página 2]\nModelo de Termo de Referência – Aquisições\n1. REGRAS\n1.1. A multa será recolhida em cinco dias.';
const dossie={textoEdital:fonte,estrutura:{identificacao:{modalidade:'Pregão eletrônico'},coberturaLeitura:{parcial:false,documentosNaoLidos:[]}}};
test('contexto ancorado gera apenas cláusulas solicitadas, preserva catálogo e todas as duplicatas',()=>{
 const body={tipo:'esclarecimento',questionamento:'Esclarecer a multa no item 1.1 do TR.'},c=prepararContexto(dossie,body);
 assert.equal(c.fontes.length,2);assert.ok(c.fontes.every(f=>f.numero==='1.1'));
 assert.equal(new Set(c.fontes.map(f=>f.escopoDocumento)).size,2);
 assert.ok(c.clausulasCanonicas.some(f=>f.numero==='3.1'));assert.ok(c.cobertura.fontesOmitidas.some(f=>f.numero==='3.1'));assert.equal(c.cobertura.contextoParcial,true);
 const a=ancorasSolicitadas(c,body)[0];assert.equal(a.fontesPermitidas.length,1);assert.equal(c.fontes.find(f=>f.id===a.fontesPermitidas[0]).escopoDocumento,'Termo de Referência');
});
test('referência inexistente não constrói fallback de página nem perde catálogo de unicidade',()=>{
 const c=prepararContexto(dossie,{tipo:'esclarecimento',questionamento:'Esclarecer o item 999.1 do Edital.'});
 assert.deepEqual(c.fontes,[]);assert.ok(c.clausulasCanonicas.length>0);assert.equal(c.cobertura.fontesOmitidas.length,c.clausulasCanonicas.length);
});
test('caput condicional permanece como origem do filho solicitado, sem fonte avulsa alheia',()=>{
 const c=prepararContexto(dossie,{tipo:'esclarecimento',questionamento:'Esclarecer o item 2.1 do Edital.'});
 assert.equal(c.fontes.length,1);assert.equal(c.fontes[0].numero,'2.1');assert.match(c.fontes[0].texto,/Se houver contratação/);
 assert.deepEqual(c.fontes[0].origens.map(f=>f.numero),['2','2.1']);assert.ok(c.fontes[0].origens.every(f=>f.escopoDocumento==='Edital'));
});
test('consulta sem âncoras mantém recuperação das demais cláusulas',()=>{
 const c=prepararContexto(dossie,{tipo:'esclarecimento',questionamento:'Quais são as condições de entrega e pagamento?'});
 assert.ok(c.fontes.some(f=>f.numero==='2.1'));assert.ok(c.fontes.some(f=>f.numero==='3.1'));
});
