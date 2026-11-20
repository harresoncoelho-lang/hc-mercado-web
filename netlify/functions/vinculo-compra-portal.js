const {cabecalhosPadrao,exigirUsuarioLogado}=require('./_auth');
const {carregarContextoIdentificacao}=require('./_empresa_identificacao_contexto');
const {uuid}=require('./_kit_documentos');
function criarHandler({autenticar=exigirUsuarioLogado,contexto=carregarContextoIdentificacao}={}){
 return async event=>{
  const response=(statusCode,body)=>({statusCode,headers:{...cabecalhosPadrao(event),'Cache-Control':'no-store'},body:JSON.stringify(body)});
  if(event.httpMethod==='OPTIONS')return response(204,{});
  if(event.httpMethod!=='POST')return response(405,{erro:'Método não permitido.'});
  try{
   const auth=await autenticar(event);if(!auth.ok)return response(auth.status,{erro:auth.erro});
   if(typeof event.body!=='string'||Buffer.byteLength(event.body)>5000)return response(400,{erro:'Solicitação inválida.'});
   let b;try{b=JSON.parse(event.body);}catch{return response(400,{erro:'Solicitação inválida.'});}
   if(!b||!uuid(b.empresaId)||!uuid(b.processoId)||!['consultar','confirmar'].includes(b.acao)
    ||Object.keys(b).some(k=>!['empresaId','processoId','acao','versaoEsperada','processoSnapshot','dados'].includes(k)))return response(400,{erro:'Seletores inválidos.'});
   if(b.acao==='confirmar'){
    const d=b.dados;
    if(!Number.isSafeInteger(b.versaoEsperada)||b.versaoEsperada<0||typeof b.processoSnapshot!=='string'||!/^[a-f0-9]{32}$/.test(b.processoSnapshot)
     ||!d||Object.keys(d).sort().join(',')!=='ano,compra,numero,url'||!/^\d{4}$/.test(d.ano)||!/^\d{1,5}$/.test(d.numero)||Number(d.numero)<1||!/^\d{17}$/.test(d.compra))return response(400,{erro:'Confira os dados da compra.'});
    let u;try{u=new URL(d.url);}catch{return response(400,{erro:'URL da compra inválida.'});}
    if(u.origin!=='https://cnetmobile.estaleiro.serpro.gov.br'||u.pathname!=='/comprasnet-web/seguro/fornecedor/cadastro-propostas'||u.hash||u.username||u.password||[...u.searchParams.keys()].join(',')!=='compra'||u.searchParams.get('compra')!==d.compra)return response(400,{erro:'URL e identificador da compra devem corresponder.'});
   }
   const c=await contexto(event,auth.userId,b.empresaId);
   const again=await autenticar(event);if(!again.ok||again.userId!==auth.userId)return response(403,{erro:'Sessão alterada.'});
   const r=await c.request('/rest/v1/rpc/operacao_vinculo_compra',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_empresa:b.empresaId,p_processo:b.processoId,p_acao:b.acao,p_versao:b.versaoEsperada??null,p_snapshot:b.processoSnapshot??null,p_dados:b.dados??null})});
   const result=await r.json();return response(result.status||200,result);
  }catch(e){return response(e.status||503,{erro:e.status?e.message:'Vínculo indisponível neste ambiente.'});}
 };
}
module.exports={handler:criarHandler(),criarHandler};
