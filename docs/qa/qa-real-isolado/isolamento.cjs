const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createHash}=require('node:crypto');
const QA='https://luguscapasskcsficckf.supabase.co';
const root=path.resolve(__dirname,'../../..'),sandbox=path.join(__dirname,'.sandbox');
const hash=b=>createHash('sha256').update(b).digest('hex');
function validar(c){
 if(!c||['authUrl','restUrl','storageUrl'].some(k=>c[k]!==QA)||typeof c.publicKey!=='string'||c.publicKey.length>2048)throw Error('Configuração QA inválida');
 let publica=/^sb_publishable_[A-Za-z0-9_-]+$/.test(c.publicKey);
 if(!publica&&/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(c.publicKey))try{publica=JSON.parse(Buffer.from(c.publicKey.split('.')[1],'base64url')).role==='anon';}catch{}
 if(!publica)throw Error('Chave pública QA inválida');
}
const deps=new Set(['node:crypto','adm-zip','pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js','pdf-parse/lib/pdf.js/v1.10.100/build/pdf.worker.js']);
const ajustes={
 'netlify/functions/_auth.js':[['SUPABASE_URL',QA],['SUPABASE_ANON_KEY',null]],
 'netlify/functions/_empresa_identificacao_contexto.js':[['URL',QA],['ANON',null]],
 'netlify/functions/_kit_documentos_persistencia.js':[['URL',QA]],
 'netlify/functions/empresa-identificacao.js':[['URL',QA]],
 'netlify/functions/criar-processo.js':[['URL',QA],['ANON',null]],
 'netlify/functions/_itens_processo.js':[['URL',QA],['ANON',null]],
};
function preparar(config){
 validar(config);const c={...config};fs.mkdirSync(sandbox,{recursive:true});const destino=fs.mkdtempSync(path.join(sandbox,'qa-'));
 const manifesto=[],vistos=new Set();
 function copiar(arquivo){
  arquivo=path.resolve(arquivo);if(!arquivo.startsWith(root+path.sep)||path.extname(arquivo)!=='.js')throw Error('Dependência fora da árvore QA');
  if(vistos.has(arquivo))return;vistos.add(arquivo);
  const rel=path.relative(root,arquivo).replaceAll('\\','/'),original=fs.readFileSync(arquivo),texto=original.toString('utf8');let derivado=texto;
  for(const [nome,valor] of ajustes[rel]||[]){
   const re=new RegExp(`const ${nome}\\s*=\\s*(['"])([^'"]+)\\1;`,'g'),matches=[...derivado.matchAll(re)];
   if(matches.length!==1||valor===QA&&matches[0][2]!=='https://lsqjamqvmrcyrvowndiu.supabase.co')throw Error('Declaração original divergente');
   derivado=derivado.replace(re,`const ${nome}=${JSON.stringify(valor??c.publicKey)};`);
  }
  const saida=path.join(destino,rel);fs.mkdirSync(path.dirname(saida),{recursive:true});fs.writeFileSync(saida,derivado);
  manifesto.push({path:rel,originalHash:hash(original),derivadoHash:hash(derivado),alterado:derivado!==texto});
  for(const m of texto.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)){
   if(m[1].startsWith('.')){let f=path.resolve(path.dirname(arquivo),m[1]);if(!path.extname(f))f+='.js';copiar(f);}
   else if(!deps.has(m[1]))throw Error('Dependência não aprovada');
  }
 }
 copiar(path.join(root,'netlify/functions/kit-documentos.js'));copiar(path.join(root,'netlify/functions/empresa-identificacao.js'));copiar(path.join(root,'netlify/functions/criar-processo.js'));copiar(path.join(root,'netlify/functions/_itens_processo.js'));
 // Cinco derivações: as quatro anteriores mais criar-processo.js (única cópia nova com URL/chave ajustadas).
 if(manifesto.filter(x=>x.alterado).length!==6)throw Error('Derivação incompleta');
 fs.writeFileSync(path.join(destino,'manifesto.json'),JSON.stringify(manifesto,null,2));
 return {root,destino,manifesto,config:c};
}
function transporteSeguro(config,fetchImpl){
 validar(config);if(typeof fetchImpl!=='function')throw Error('Transporte explícito necessário');
 return async(url,op={})=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  const signal=op.signal?AbortSignal.any([op.signal,controller.signal]):controller.signal;
  let reader,abortListener;
  try{
   const u=new URL(url);if(u.origin!==QA||u.username||u.password||u.hash)throw Error();
   const metodo=(op.method||'GET').toUpperCase();
   const auth=u.pathname==='/auth/v1/user'&&metodo==='GET'||u.pathname==='/auth/v1/token'&&u.search==='?grant_type=password'&&metodo==='POST';
   const tabelas=['clientes','operacao_empresas','operacao_membros','operacao_processos','operacao_identificacao_empresa','operacao_documentos','operacao_itens_resultado','operacao_kit_documentos'];
   const rpcs=['identificacao_empresa_habilitada','confirmar_identificacao_empresa','gravar_kit_documento'];
   const rest=metodo==='GET'&&tabelas.some(t=>u.pathname==='/rest/v1/'+t)
    ||metodo==='POST'&&(rpcs.some(r=>u.pathname==='/rest/v1/rpc/'+r)||u.pathname==='/rest/v1/operacao_documentos'||u.pathname==='/rest/v1/operacao_processos')||metodo==='POST'&&u.pathname==='/rest/v1/operacao_itens_resultado'||metodo==='PATCH'&&u.pathname==='/rest/v1/operacao_itens_resultado';
   const storage=u.pathname.startsWith('/storage/v1/object/authenticated/operacao-documentos/')&&metodo==='GET'
    ||u.pathname.startsWith('/storage/v1/object/operacao-documentos/')&&metodo==='POST'
    ||u.pathname==='/storage/v1/object/operacao-documentos'&&metodo==='DELETE';
   if(!auth&&!rest&&!storage)throw Error();
   const aborted=new Promise((_,reject)=>{abortListener=()=>reject(Error());if(signal.aborted)abortListener();else signal.addEventListener('abort',abortListener,{once:true});});
   const trabalho=(async()=>{
    if(signal.aborted)throw Error();
    const r=await fetchImpl(u.href,{...op,signal,redirect:'error'});if(r.status>=300&&r.status<400||r.redirected)throw Error();
    const max=8*1024*1024;if(Number(r.headers.get('content-length'))>max)throw Error();
    const partes=[];let bytes=0;reader=r.body?.getReader();
    if(reader)for(;;){const p=await reader.read();if(p.done)break;bytes+=p.value.byteLength;if(bytes>max||signal.aborted)throw Error();partes.push(Buffer.from(p.value));}
    return new Response([204,205,304].includes(r.status)?null:Buffer.concat(partes),{status:r.status,headers:r.headers});
   })();
   return await Promise.race([trabalho,aborted]);
  }catch{controller.abort();if(reader)void reader.cancel().catch(()=>{});throw Error('Transporte QA indisponível');}
  finally{clearTimeout(timer);if(abortListener)signal.removeEventListener('abort',abortListener);}
 };
}
function criarRuntime(p,{serviceKey,fetchImpl}){
 validar(p.config);if(typeof serviceKey!=='string'||!serviceKey)throw Error('Configuração QA incompleta');
 const tx=transporteSeguro(p.config,fetchImpl),cache=new Map(),manifesto=new Map(p.manifesto.map(x=>[x.path,x]));
 // Isola configuração e fetch dos módulos copiados. Não é sandbox para dependências hostis.
 const contexto=vm.createContext({Buffer,URL,Headers,Response,Request,TextEncoder,TextDecoder,Uint8Array,AbortController,AbortSignal,setTimeout,clearTimeout,
  process:{env:{IDENTIFICACAO_EMPRESA_LOCAL:'1',SUPABASE_SERVICE_ROLE_KEY:serviceKey}},fetch:tx,
  console:{log(){},warn(){},error(){}}});
 function carregar(rel){
  rel=rel.replaceAll('\\','/');if(cache.has(rel))return cache.get(rel).exports;
  const meta=manifesto.get(rel);if(!meta)throw Error('Import fora da cópia QA');
  const codigo=fs.readFileSync(path.join(p.destino,rel),'utf8');if(hash(codigo)!==meta.derivadoHash)throw Error('Cópia QA alterada');
  const m={exports:{}};cache.set(rel,m);
  const req=nome=>{if(nome.startsWith('.')){let target=path.posix.normalize(path.posix.join(path.posix.dirname(rel),nome));if(!path.posix.extname(target))target+='.js';return carregar(target);}if(!deps.has(nome))throw Error('Import não aprovado');return require(nome);};
  new vm.Script(`(function(require,module,exports){${codigo}\n})`,{filename:rel}).runInContext(contexto)(req,m,m.exports);return m.exports;
 }
 return {executar(nome,event){if(!['kit-documentos','empresa-identificacao','criar-processo'].includes(nome))throw Error('Rota QA não permitida');return carregar(`netlify/functions/${nome}.js`).handler(event);},transporte:tx};
}
module.exports={QA,preparar,criarRuntime,transporteSeguro};
