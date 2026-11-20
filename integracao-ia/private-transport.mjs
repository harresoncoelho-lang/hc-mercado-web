const fail=()=>{throw new Error('transporte_indisponivel');};
const uuid='[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}';
function origin(value){try{const u=new URL(value);if(u.protocol!=='https:'||u.pathname!=='/'||u.search||u.hash||u.username||u.password)fail();return u.origin;}catch{fail();}}
function role(token){try{const parts=token.split('.');if(parts.length!==3||parts.some(p=>!p||!/^[\w-]+$/.test(p)))fail();return JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/'))).role;}catch{fail();}}
const schemas={
 clientes:{select:'id,status',required:['id'],optional:[],limit:2},
 operacao_membros:{select:'usuario_id,organizacao_id,empresa_id,papel',required:['usuario_id','organizacao_id'],optional:[],limit:2},
 operacao_empresas:{select:'id,organizacao_id,razao_social,cnpj,ativo',required:['organizacao_id','ativo','order'],optional:['id'],limit:1001},
};
function validateQuery(resource,query){
 const s=Object.hasOwn(schemas,resource)&&schemas[resource];if(!s||typeof query!=='string'||query.length>2048)fail();
 const q=new URLSearchParams(query), keys=[...q.keys()];
 if(new Set(keys).size!==keys.length||keys.some(k=>![...s.required,...s.optional,'select','limit'].includes(k))||s.required.some(k=>!q.has(k))||q.get('select')!==s.select||q.get('limit')!==String(s.limit))fail();
 for(const [k,v]of q){if(['select','limit'].includes(k))continue;if(k==='ativo'?v!=='eq.true':k==='order'?v!=='id.asc':!new RegExp(`^eq\\.${uuid}$`).test(v))fail();}
 return {query:q.toString(),limit:s.limit};
}
export function createPrivateTransport({config,fetchImpl,timeoutMs=10000,maxResponseBytes=2_000_000}){
 if(!config||typeof fetchImpl!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||!Number.isInteger(maxResponseBytes)||maxResponseBytes<1||maxResponseBytes>4_000_000)fail();
 const project=origin(config.authProjectUrl);
 if(origin(config.dataProjectUrl)!==project||!Array.isArray(config.allowedProjectUrls)||!config.allowedProjectUrls.map(origin).includes(project))fail();
 const key=config.publicKey;
 if(typeof key!=='string'||key.length>8192||(!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)&&role(key)!=='anon'))fail();
 async function request(input,path,limit){
  let timer,reader;const controller=new AbortController();
  try{
   if(input.projectUrl!==project||typeof input.authorization!=='string'||input.authorization.length>8192||!input.authorization.startsWith('Bearer ')||role(input.authorization.slice(7))!=='authenticated')fail();
   const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();if(reader)void reader.cancel().catch(()=>{});reject(Error('transporte_indisponivel'));},timeoutMs);});
   const operation=async()=>{
    const response=await fetchImpl(new Request(project+path,{method:'GET',redirect:'error',cache:'no-store',signal:controller.signal,headers:{apikey:key,Authorization:input.authorization,Accept:'application/json',...(limit?{Prefer:'count=exact','Range-Unit':'items'}:{})}}));
    if(response.redirected||![200,206].includes(response.status)||(!limit&&response.status!==200)||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||'')||!response.body)fail();
    const declared=response.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maxResponseBytes))fail();
    reader=response.body.getReader();let size=0;const chunks=[];
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxResponseBytes)fail();chunks.push(value);}
    const bytes=new Uint8Array(size);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.length;}
    const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(limit){
     if(!Array.isArray(data)||!/(?:^|,\s*)count=exact(?:,|$)/.test(response.headers.get('preference-applied')||''))fail();
     const range=response.headers.get('content-range')||'';
     if(data.length===0){if(range!=='*/0')fail();}
     else{const m=/^0-(\d+)\/(\d+)$/.exec(range);if(!m)fail();const end=Number(m[1]),total=Number(m[2]);if(!Number.isSafeInteger(total)||total<1||end!==data.length-1||data.length!==Math.min(total,limit))fail();}
    }else if(!data||typeof data!=='object'||Array.isArray(data)||typeof data.id!=='string')fail();
    return data;
   };
   return await Promise.race([operation(),timeout]);
  }catch{fail();}finally{clearTimeout(timer);controller.abort();if(reader)void reader.cancel().catch(()=>{});}
 }
 return Object.freeze({verifySession:input=>request(input,'/auth/v1/user'),readRows:input=>{
  if(input.method!=='GET')return Promise.reject(Error('transporte_indisponivel'));
  try{const q=validateQuery(input.resource,input.query);return request(input,`/rest/v1/${input.resource}?${q.query}`,q.limit);}catch{return Promise.reject(Error('transporte_indisponivel'));}
 }});
}
