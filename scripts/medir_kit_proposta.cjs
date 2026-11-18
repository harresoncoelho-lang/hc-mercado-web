const {preparar,docx}=require('../netlify/functions/_kit_documentos');
const {bytesRascunho}=require('../netlify/functions/_kit_proposta_limites');
const chars=Number(process.argv[2]||120),n=1000;
const itens=Array.from({length:n},(_,i)=>({id:`33333333-3333-3333-3333-${String(i+1).padStart(12,'0')}`,tipo:'item',identificador:String(i+1),descricao:'M'.repeat(chars),quantidade:'2.000',valor_unitario_proposta:'1.25',marca:'M'.repeat(30),modelo:'X'.repeat(30)}));
const contexto={userId:'qa',empresa:{razao_social:'Empresa fictícia',cnpj:'11222333000181'},processo:{numero:'1',orgao:'QA'},perfil:{dados_confirmados:{endereco:'Rua QA',representante:'Ana',cargo:'Sócia'}},itens};
const proposta={itemIds:itens.map(i=>i.id),unidades:Object.fromEntries(itens.map(i=>[i.id,'unidade'])),validade:'30 dias',prazoEntrega:'10 dias',pagamento:'30 dias'};
const before=process.memoryUsage(),start=performance.now();let outcome;
try{const r=preparar(contexto,{tipo:'proposta',proposta}),arquivo=docx(r),b64=arquivo.toString('base64');outcome={ok:true,previaBytes:Buffer.byteLength(r.previa.texto),docxBytes:arquivo.length,base64Bytes:Buffer.byteLength(b64)};}catch(e){outcome={ok:false,status:e.status,motivo:e.pendencias||e.message};}
const after=process.memoryUsage();console.log(JSON.stringify({itens:n,descricaoCaracteres:chars,elapsedMs:performance.now()-start,rssDelta:after.rss-before.rss,heapDelta:after.heapUsed-before.heapUsed,rascunhoSemanticoBytes:bytesRascunho(proposta),envelopeBytes:Buffer.byteLength(JSON.stringify({tipo:'proposta',proposta})),...outcome}));
