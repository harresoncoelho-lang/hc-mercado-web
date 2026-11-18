const {createHash}=require('node:crypto');
const {exigirUsuarioLogado,cabecalhosPadrao}=require('./_auth');
const {carregarContextoIdentificacao}=require('./_empresa_identificacao_contexto');
const {falhar}=require('./_empresa_identificacao');
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
function referencia(p){
 let m;try{const u=new URL(p.url_origem);if(u.protocol==='https:'&&u.hostname==='pncp.gov.br'&&!u.username&&!u.password&&!u.search&&!u.hash)m=/^\/app\/editais\/(\d{14})\/(\d{4})\/(\d+)\/?$/.exec(u.pathname);}catch{}
 if(m)return {cnpj:m[1],ano:m[2],seq:String(Number(m[3]))};
 const id=[p.origem_externa_id,p.numero].find(v=>typeof v==='string'&&/^\d{14}-1-\d+\/\d{4}$/.test(v));
 if(!id)falhar('Processo sem referência PNCP utilizável. Confira o link oficial.',409);
 const a=/^(\d{14})-1-(\d+)\/(\d{4})$/.exec(id);return {cnpj:a[1],ano:a[3],seq:String(Number(a[2]))};
}
// JSON.parse validates syntax; this bounded walk retains the root quantity token and rejects duplicate decoded keys.
function quantidadeOriginal(text){
 let i=0,quantidade;
 const ws=()=>{while(/[ \t\r\n]/.test(text[i]||'!'))i++;};
 function string(){const start=i++;while(i<text.length){if(text[i]==='\\'){i+=2;continue;}if(text[i++]==='"')return JSON.parse(text.slice(start,i));}throw Error('string');}
 function value(depth,root=false){
  if(depth>64)throw Error('depth');ws();const start=i;
  if(text[i]==='{'){
   i++;ws();const keys=new Set();if(text[i]==='}'){i++;return;}
   for(;;){ws();const key=string();if(keys.has(key))throw Error('duplicate');keys.add(key);ws();i++;ws();const vstart=i;value(depth+1);
    if(root&&key==='quantidade')quantidade=text.slice(vstart,i);
    ws();if(text[i++]==='}')break;
   }
  }else if(text[i]==='['){i++;ws();if(text[i]===']'){i++;return;}for(;;){value(depth+1);ws();if(text[i++]===']')break;}}
  else if(text[i]==='"')string();
  else{while(i<text.length&&!/[\s,}\]]/.test(text[i]))i++;if(i===start)throw Error('token');}
 }
 value(0,true);return quantidade;
}
async function lerJsonLimitado(response){
 if(!response.ok||response.redirected||!response.body)falhar('Fonte PNCP indisponível.',502);
 const reader=response.body.getReader(),chunks=[];let total=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>131072)falhar('Resposta PNCP excede o limite.',502);chunks.push(value);}}finally{try{await reader.cancel();}catch{ /* Preserve the original read failure. */ }}
 try{const texto=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));const raw=JSON.parse(texto);return {raw,quantidade:quantidadeOriginal(texto),texto};}catch{falhar('Resposta PNCP inválida.',502);}
}
function criarHandler({enabled=()=>process.env.IMPORTACAO_PNCP_LOCAL==='1',serviceKey=()=>process.env.SUPABASE_SERVICE_ROLE_KEY,auth=exigirUsuarioLogado,contexto=carregarContextoIdentificacao,fetchImpl=(...a)=>fetch(...a),timeoutMs=10000}={}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw Error('Timeout inválido');
 return async event=>{const reply=(statusCode,data)=>({statusCode,headers:{...cabecalhosPadrao(event),'Cache-Control':'no-store'},body:JSON.stringify(data)});
 if(event.httpMethod!=='POST')return reply(405,{erro:'Método não permitido.'});if(!enabled())return reply(503,{erro:'Importação rastreável ainda não habilitada.'});
 try{
 const a=await auth(event);if(!a.ok)return reply(a.status,{erro:a.erro});
 if(typeof event.body!=='string'||Buffer.byteLength(event.body)>2048)falhar('Solicitação inválida.',400);
 let b;try{b=JSON.parse(event.body);}catch{falhar('Solicitação inválida.',400);}
 if(!b||Array.isArray(b)||Object.keys(b).some(k=>!['empresaId','processoId','numeroItem'].includes(k))||!uuid(b.empresaId)||!uuid(b.processoId)||!Number.isSafeInteger(b.numeroItem)||b.numeroItem<1||b.numeroItem>1000000)falhar('Seletores inválidos.',400);
 const c=await contexto(event,a.userId,b.empresaId),e=c.empresa;if(!e||e.id!==b.empresaId||!uuid(e.organizacao_id))falhar('Empresa indisponível.',403);
 const members=await c.rest(`operacao_membros?usuario_id=eq.${a.userId}&organizacao_id=eq.${e.organizacao_id}&select=usuario_id,organizacao_id,empresa_id,papel`);
 if(!members.some(m=>m.usuario_id===a.userId&&m.organizacao_id===e.organizacao_id&&['operador','gestor'].includes(m.papel)&&(m.empresa_id===null||m.empresa_id===e.id)))falhar('Acesso não autorizado.',403);
 const ps=await c.rest(`operacao_processos?id=eq.${b.processoId}&empresa_id=eq.${e.id}&organizacao_id=eq.${e.organizacao_id}&select=id,empresa_id,organizacao_id,url_origem,origem_externa_id,numero`),p=ps[0];
 if(ps.length!==1||p.id!==b.processoId||p.empresa_id!==e.id||p.organizacao_id!==e.organizacao_id)falhar('Processo indisponível.',404);
 const ref=referencia(p);if(!/^\d{1,12}$/.test(ref.seq)||Number(ref.seq)<1)falhar('Referência PNCP inválida.',409);
 const key=serviceKey();if(!key)falhar('Persistência de origem indisponível.',503);
 const rpc=async(name,args)=>{const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),10000);try{return await(await c.request('/rest/v1/rpc/'+name,{method:'POST',signal:ctrl.signal,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(args)})).json();}finally{clearTimeout(timer);}};
 const scope={p_usuario:a.userId,p_empresa:e.id,p_processo:p.id,p_organizacao:e.organizacao_id};
 if(await rpc('reservar_importacao_pncp',scope)!==true)falhar('Aguarde sete segundos antes de consultar outro item.',429);
 const url=`https://pncp.gov.br/api/pncp/v1/orgaos/${ref.cnpj}/compras/${ref.ano}/${ref.seq}/itens/${b.numeroItem}`;
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),timeoutMs);let fonte;
 try{fonte=await lerJsonLimitado(await fetchImpl(url,{method:'GET',redirect:'error',cache:'no-store',signal:ctrl.signal,headers:{Accept:'application/json'}}));}finally{clearTimeout(timer);}
 const {raw}=fonte;
 const compra=`${ref.cnpj}-1-${ref.seq}/${ref.ano}`;
 if(!raw||Array.isArray(raw)||raw.numeroItem!==b.numeroItem||typeof raw.descricao!=='string'||!raw.descricao.trim()||raw.descricao.length>10000||typeof raw.unidadeMedida!=='string'||!raw.unidadeMedida.trim()||raw.unidadeMedida.length>100)falhar('Identidade ou conteúdo do item PNCP divergente.',502);
 if(raw.numeroControlePNCPCompra&&raw.numeroControlePNCPCompra.replace(/-1-0+(\d)/,'-1-$1')!==compra)falhar('Compra PNCP divergente.',502);
 let quantidade=fonte.quantidade;if(!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,3})?$/.test(quantidade)||Number(quantidade)<=0)falhar('Quantidade PNCP não representável sem perda.',422);
 if(quantidade.includes('.'))quantidade=quantidade.replace(/0+$/,'').replace(/\.$/,'');
 const item={numero:b.numeroItem,descricao:raw.descricao,quantidade,unidade:raw.unidadeMedida};
 // Identity remains the legacy normalized content hash, not a hash of original response bytes.
 const conteudo={compra,item,raw};const hash=createHash('sha256').update(JSON.stringify(conteudo)).digest('hex');
 const snapshot={...conteudo,textoOriginal:fonte.texto};
 const atual=await auth(event);if(!atual.ok)return reply(atual.status,{erro:atual.erro});if(atual.userId!==a.userId)falhar('Acesso não autorizado.',403);
 const result=await rpc('gravar_importacao_pncp',{...scope,p_compra:compra,p_numero:b.numeroItem,p_url:url,p_hash:hash,p_item:item,p_snapshot:snapshot,p_referencia:{url_origem:p.url_origem||null,origem_externa_id:p.origem_externa_id||null,numero:p.numero||null}});
 if(result?.estado==='colisao_manual')falhar('Já existe item manual com esse número. Confira o cadastro e revise o vínculo antes de importar.',409);
 if(!result||typeof result.itemId!=='string'||!['importado','inalterado','fonte_alterada'].includes(result.estado))falhar('Persistência não confirmada.',503);
 return reply(200,{...result,fonte:'PNCP',mensagem:result.estado==='fonte_alterada'?'Fonte alterada. Oferta e conteúdo anterior preservados; confira antes de revisar.':'Item com origem PNCP armazenado. Informe sua oferta no cadastro; isso não confirma vínculo Compras.gov.'});
 }catch(error){return reply([400,403,404,409,422,429,502].includes(error.status)?error.status:503,{erro:error.status?error.message:'Importação indisponível. Nenhum resultado foi confirmado.'});}
 };
}
module.exports={handler:criarHandler(),criarHandler};
