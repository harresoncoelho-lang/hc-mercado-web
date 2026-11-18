const {randomBytes,createHash,randomUUID}=require('node:crypto');
const {uuid}=require('./_kit_documentos');
const digest=value=>createHash('sha256').update(value).digest('hex');
function validarPedido(b){
 if(!b||typeof b!=='object')return false;
 if(b.acao==='cancelarLeitura')return Object.keys(b).sort().join(',')==='acao,tentativaId'&&uuid(b.tentativaId);
 const campos=['acao','empresaId','processoId','documentoId','versaoEsperada'];
 if(b.acao==='registrarLeitura')campos.push('tentativaId','nonce','snapshot');
 else if(b.acao==='consultarLeituras'){if(b.cursor!==undefined)campos.push('cursor');}
 else if(b.acao==='confirmarCorrespondencias')campos.push('recibo','versaoCorrespondencia','revisado','pares');
 else if(b.acao!=='iniciarLeitura')return false;
 if(Object.keys(b).sort().join(',')!==campos.sort().join(',')||![b.empresaId,b.processoId,b.documentoId].every(uuid)||!Number.isSafeInteger(b.versaoEsperada)||b.versaoEsperada<1)return false;
 if(b.acao==='consultarLeituras')return b.cursor===undefined||uuid(b.cursor);
 if(b.acao==='confirmarCorrespondencias')return uuid(b.recibo)&&b.revisado===true&&Number.isSafeInteger(b.versaoCorrespondencia)&&b.versaoCorrespondencia>=0&&Array.isArray(b.pares)&&b.pares.length>=1&&b.pares.length<=10&&b.pares.every(p=>p&&Object.keys(p).sort().join(',')==='itemId,portalId'&&uuid(p.itemId)&&typeof p.portalId==='string'&&/^[1-9][0-9]{0,17}$/.test(p.portalId));
 return b.acao!=='registrarLeitura'||uuid(b.tentativaId)&&typeof b.nonce==='string'&&/^[A-Za-z0-9_-]{43}$/.test(b.nonce)&&b.snapshot&&Buffer.byteLength(JSON.stringify(b.snapshot))<=30000;
}
function criarPonteLeitura({requestCancelar,autenticar=require('./_auth').exigirUsuarioLogado}={}){
 return async({event,body,c,documento,resultado})=>{
  if(!validarPedido(body))return{status:400,erro:'Contrato de leitura inválido.'};
  const inicial=await autenticar(event);if(!inicial.ok)return{status:403,erro:'Sessão indisponível.'};
  const request=body.acao==='cancelarLeitura'?requestCancelar&&((path,op)=>requestCancelar(event,path,op)):c?.request;
  if(!request)return{status:503,erro:'Canal de leitura indisponível.'};
  const rpc=async args=>(await request('/rest/v1/rpc/operacao_ponte_leitura',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)})).json();
  if(body.acao==='cancelarLeitura')return rpc({p_acao:'cancelar',p_tentativa:body.tentativaId});
  const vinculo=(await c.request('/rest/v1/rpc/operacao_vinculo_compra',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_empresa:body.empresaId,p_processo:body.processoId,p_acao:'consultar'})}));
  const loaded=await vinculo.json(),v=loaded.vinculo;
  if(loaded.status!==200||!v||v.invalidado_em)return{status:409,erro:'Vínculo revisado indisponível.'};
  if(['consultarLeituras','confirmarCorrespondencias'].includes(body.acao)){
   const atual=await autenticar(event);if(!atual.ok||atual.userId!==inicial.userId)return{status:403,erro:'Sessao alterada.'};
   const args={p_acao:body.acao==='consultarLeituras'?'consultar':'confirmar',p_documento:documento.id,p_versao:documento.versao,p_hash:resultado.revisaoHash,p_vinculo:v.versao,p_cursor:body.cursor??null,p_recibo:body.recibo??null,p_mapa_versao:body.versaoCorrespondencia??null,p_pares:body.pares??null};
   return(await request('/rest/v1/rpc/operacao_correspondencias_leitura',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)})).json();
  }
  const expected={cnpj:v.cnpj_revisado,uasg:v.uasg_revisada,number:v.numero,year:v.ano,purchaseId:v.compra};
  const args={p_acao:body.acao==='iniciarLeitura'?'iniciar':'registrar',p_tentativa:body.tentativaId||randomUUID(),p_documento:documento.id,p_versao:documento.versao,p_hash:resultado.revisaoHash,p_vinculo:v.versao};
  let nonce;
  if(body.acao==='iniciarLeitura'){nonce=randomBytes(32).toString('base64url');args.p_nonce_hash=digest(nonce);}
  else{
   const {validateContext}=await import('../../extensao-leitura/adapter.mjs');
   const checked=validateContext(body.snapshot,expected);
   if(checked.status!=='confirmado'||!checked.paginaObservada)return{status:409,erro:'Leitura parcial inválida ou verificação pendente.'};
   args.p_nonce_hash=digest(body.nonce);
   args.p_observacao={contexto:checked.observed,pagina:checked.paginaObservada,writeAuthorized:false,origem:'relato_usuario'};
  }
  const atual=await autenticar(event);if(!atual.ok||atual.userId!==inicial.userId)return{status:403,erro:'Sessão alterada.'};
  const response=await rpc(args);
  if(response.status===200&&nonce)return{...response,nonce,contexto:expected,documentoId:documento.id,versao:documento.versao,revisaoHash:resultado.revisaoHash,writeAuthorized:false};
  return response;
 };
}
module.exports={validarPedido,criarPonteLeitura};
