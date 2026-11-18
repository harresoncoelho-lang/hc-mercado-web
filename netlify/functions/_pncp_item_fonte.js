// Fonte de UM item do PNCP: compartilhada pelo endpoint importar-item-pncp e pelo robô da esteira (importação em lote).
const {createHash}=require('node:crypto');
const {falhar}=require('./_empresa_identificacao');
const BASE='https://pncp.gov.br/api/pncp/v1/orgaos';
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
const urlItem=(ref,numeroItem)=>`${BASE}/${ref.cnpj}/compras/${ref.ano}/${ref.seq}/itens/${numeroItem}`;
// Busca, valida e normaliza o item; devolve exatamente o que gravar_importacao_pncp recebe.
async function buscarFonteItem(ref,numeroItem,{fetchImpl=(...a)=>fetch(...a),timeoutMs=10000}={}){
 const url=urlItem(ref,numeroItem);
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),timeoutMs);let fonte;
 try{fonte=await lerJsonLimitado(await fetchImpl(url,{method:'GET',redirect:'error',cache:'no-store',signal:ctrl.signal,headers:{Accept:'application/json'}}));}finally{clearTimeout(timer);}
 const {raw}=fonte;
 const compra=`${ref.cnpj}-1-${ref.seq}/${ref.ano}`;
 if(!raw||Array.isArray(raw)||raw.numeroItem!==numeroItem||typeof raw.descricao!=='string'||!raw.descricao.trim()||raw.descricao.length>10000||typeof raw.unidadeMedida!=='string'||!raw.unidadeMedida.trim()||raw.unidadeMedida.length>100)falhar('Identidade ou conteúdo do item PNCP divergente.',502);
 if(raw.numeroControlePNCPCompra&&raw.numeroControlePNCPCompra.replace(/-1-0+(\d)/,'-1-$1')!==compra)falhar('Compra PNCP divergente.',502);
 let quantidade=fonte.quantidade;if(!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,3})?$/.test(quantidade)||Number(quantidade)<=0)falhar('Quantidade PNCP não representável sem perda.',422);
 if(quantidade.includes('.'))quantidade=quantidade.replace(/0+$/,'').replace(/\.$/,'');
 const item={numero:numeroItem,descricao:raw.descricao,quantidade,unidade:raw.unidadeMedida};
 // Identity remains the legacy normalized content hash, not a hash of original response bytes.
 const conteudo={compra,item,raw};const hash=createHash('sha256').update(JSON.stringify(conteudo)).digest('hex');
 return {url,compra,item,hash,snapshot:{...conteudo,textoOriginal:fonte.texto}};
}
// Pagina /compras/{ano}/{seq}/itens e devolve só os números. Estourar o teto é erro: lote truncado esconderia itens.
async function listarNumerosItens(cnpj,ano,seq,{fetch:fetchImpl=(...a)=>fetch(...a),pagina=500,maxPaginas=20,timeoutMs=10000}={}){
 if(!/^\d{14}$/.test(cnpj)||!/^\d{4}$/.test(String(ano))||!/^\d{1,12}$/.test(String(seq)))falhar('Referência PNCP inválida.',409);
 const numeros=[];
 for(let p=1;p<=maxPaginas;p++){
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),timeoutMs);let lista;
  try{
   const r=await fetchImpl(`${BASE}/${cnpj}/compras/${ano}/${Number(seq)}/itens?pagina=${p}&tamanhoPagina=${pagina}`,{method:'GET',redirect:'error',cache:'no-store',signal:ctrl.signal,headers:{Accept:'application/json'}});
   if(r.status===204)return numeros;
   if(!r.ok)falhar('Fonte PNCP indisponível.',502);
   lista=await r.json();
  }catch(e){if(e.status)throw e;falhar('Fonte PNCP indisponível.',502);}finally{clearTimeout(timer);}
  if(!Array.isArray(lista))falhar('Resposta PNCP inválida.',502);
  for(const it of lista){if(!Number.isSafeInteger(it?.numeroItem)||it.numeroItem<1)falhar('Resposta PNCP inválida.',502);numeros.push(it.numeroItem);}
  if(lista.length<pagina)return numeros;
 }
 falhar('Lista de itens PNCP excede o teto de páginas.',502);
}
module.exports={quantidadeOriginal,lerJsonLimitado,urlItem,buscarFonteItem,listarNumerosItens};
