const {QA}=require('./isolamento.cjs');
// Somente composição QA: autenticação permanece no Supabase; nenhuma chave privilegiada entra aqui.
function criarLeituraIA({publicKey,transporte,organizacoes}){
 let handler;
 return async({token,body})=>{
  if(!organizacoes.length)return Response.json({erro:'Teste de integração IA não configurado.'},{status:503});
  if(!body||!organizacoes.includes(body.organizacaoId))return Response.json({erro:'Contexto QA não autorizado.'},{status:403});
  if(!handler){
   handler=Promise.all([import('../../../integracao-ia/private-handler.mjs'),import('../../../integracao-ia/private-transport.mjs')]).then(([h,t])=>{
    const config={enabled:true,authProjectUrl:QA,dataProjectUrl:QA,allowedProjectUrls:[QA],publicKey};
    const transport=t.createPrivateTransport({config,fetchImpl:r=>transporte(r.url,{method:r.method,headers:r.headers,signal:r.signal,cache:'no-store',redirect:'error'})});
    return h.createPrivateReadHandler({config,...transport});
   });
  }
  return (await handler)(new Request('http://127.0.0.1/api/ia-leitura',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)}));
 };
}
module.exports={criarLeituraIA};
