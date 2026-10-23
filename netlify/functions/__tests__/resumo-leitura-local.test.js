const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {createHash}=require('node:crypto');
const raiz=path.resolve(__dirname,'../../..');
async function ambiente(nome,acao){
 const pasta=path.join(raiz,'docs/qa/editais-reais-novos',nome);const ficha=JSON.parse(fs.readFileSync(path.join(pasta,'ficha-resumo.json')));const compra=JSON.parse(fs.readFileSync(path.join(pasta,'compra.json')));const docs=JSON.parse(fs.readFileSync(path.join(pasta,'documentos-pncp.json')));
 const env={...process.env};const fetchOriginal=global.fetch;const estado={persistido:null,fila:0,ia:0,cota:0,pdf:0};
 process.env.SUPABASE_SERVICE_ROLE_KEY='chave-unitaria-sem-servico';process.env.LEITURA_DOCUMENTAL_LOCAL='1';delete process.env.LEITURA_OCR_LOCAL;
 global.fetch=async(url,op={})=>{
  const u=new URL(url);
  if(u.pathname==='/auth/v1/user')return{ok:true,json:async()=>({id:'usuario-teste'})};
  if(u.hostname==='pncp.gov.br'){
   if(u.pathname.endsWith('/arquivos'))return{ok:true,json:async()=>docs};
   if(/\/arquivos\/\d+$/.test(u.pathname)){estado.pdf++;return{ok:true,arrayBuffer:async()=>fs.readFileSync(path.join(pasta,`documento-${u.pathname.split('/').at(-1)}.bin`))};}
   return{ok:true,json:async()=>compra};
  }
  if(u.pathname.includes('dossies_editais')){if(op.method==='POST'){if(estado.falharPersistencia)return{ok:false,status:503,text:async()=>'indisponível'};estado.persistido=JSON.parse(op.body)[0].dossie;return{ok:true};}return{ok:true,json:async()=>estado.persistido?[{dossie:estado.persistido,versao:17}]:[]};}
  if(u.pathname.includes('fila_dossies')){estado.fila++;return{ok:true};}
  if(u.pathname.includes('incrementar_uso')){estado.cota++;throw Error('Cota não deve ser consumida');}
  estado.ia++;throw Error('Rede não prevista no teste');
 };
 try{const {handler}=require('../lib/ia-edital');await acao({estado,ficha,handler,chamar:(headers={authorization:'Bearer token-unitario'})=>handler({httpMethod:'POST',headers,body:JSON.stringify({modo:'resumo',edital:{numeroControlePNCP:ficha.numeroControlePNCP,orgao:'ÓRGÃO FORJADO PELO CLIENTE',modalidade:'Modalidade forjada'},textoEdital:'FONTE CLIENTE NÃO CONFIÁVEL'})})});}
 finally{global.fetch=fetchOriginal;for(const k of Object.keys(process.env))if(!Object.hasOwn(env,k))delete process.env[k];Object.assign(process.env,env);}
}
test('clique local preserva fila e persiste leitura nativa canônica com hash, sem IA/cota',async()=>{
 await ambiente('08928517000157-116',async({estado,chamar,ficha})=>{
  const r=await chamar();const b=JSON.parse(r.body);assert.equal(r.statusCode,200);assert.equal(estado.fila,1);assert.ok(estado.pdf>0);assert.ok(estado.persistido);assert.equal(b.fonteLida,true);assert.equal(b.modoDegradado,true);assert.equal(b.metodoResumo,'extracao_documental_verificada');assert.equal(b.estrutura.coberturaLeitura.parcial,false);assert.equal(b.hashFonte,createHash('sha256').update(b.textoEdital).digest('hex'));assert.equal(b.hashFonte,estado.persistido.hashFonte);assert.equal(estado.persistido.metadadosCanonicos.orgao,ficha.orgao);assert.equal(estado.persistido.metadadosCanonicos.numeroControlePNCP,ficha.numeroControlePNCP);assert.doesNotMatch(b.textoEdital,/FONTE CLIENTE/);assert.equal(estado.ia,0);assert.equal(estado.cota,0);
  const reaberto=JSON.parse((await chamar()).body);assert.equal(reaberto.hashFonte,b.hashFonte);assert.equal(estado.fila,1);
 });
});
test('sem flag local mantém fila; sem autenticação não lê nem persiste fonte',async()=>{
 await ambiente('08928517000157-116',async({estado,chamar})=>{delete process.env.LEITURA_DOCUMENTAL_LOCAL;const b=JSON.parse((await chamar()).body);assert.equal(b.dossieEmPreparacao,true);assert.equal(estado.pdf,0);assert.equal(estado.persistido,null);const sem=await chamar({});assert.equal(sem.statusCode,401);assert.equal(estado.fila,1);});
});
test('fonte OCR parcial persistida aparece para conferência sem satisfazer guarda da Central',async()=>{
 await ambiente('88124961000159-125',async({estado,chamar})=>{
  const x=JSON.parse(fs.readFileSync(path.join(raiz,'docs/qa/editais-reais-novos/88124961000159-125/ocr-automatico-local/dossie-documental-automatico.json')));
  estado.persistido={...x,versao:17,versaoValidacao:17,modoDegradado:true,metodoResumo:'extracao_documental_verificada'};
  const b=JSON.parse((await chamar()).body);assert.equal(b.fonteLida,true);assert.equal(b.estrutura.coberturaLeitura.parcial,true);assert.match(b.aviso,/parcial|OCR/i);assert.equal(b.doCache,true);assert.equal(require('../_defesa_contexto').fonteDocumentalVerificada(estado.persistido),false);assert.equal(estado.ia,0);assert.equal(estado.cota,0);
 });
});

test('falha ao persistir fica explícita sem anunciar cache ou consumir IA',async()=>{
 await ambiente('08928517000157-116',async({estado,chamar})=>{estado.falharPersistencia=true;const b=JSON.parse((await chamar()).body);assert.equal(b.persistido,false);assert.equal(b.doCache,false);assert.match(b.aviso,/Não foi possível salvar/);assert.equal(estado.persistido,null);assert.equal(estado.fila,1);assert.equal(estado.ia,0);assert.equal(estado.cota,0);});
});
test('PNCP inválido não aciona fonte, fila ou persistência local',async()=>{
 await ambiente('08928517000157-116',async({estado,handler})=>{const r=await handler({httpMethod:'POST',headers:{authorization:'Bearer token-unitario'},body:JSON.stringify({modo:'resumo',edital:{numeroControlePNCP:'PNCP-inválido',objeto:'cliente',orgao:'cliente'}})});assert.equal(r.statusCode,400);assert.equal(estado.pdf,0);assert.equal(estado.fila,0);assert.equal(estado.persistido,null);});
});
