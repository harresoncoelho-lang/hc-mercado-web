const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const { handler } = require('../../netlify/functions/kit-documentos');
const { LIMITES } = require('../../netlify/functions/_kit_proposta_limites');
const ids = n => `${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const jsonb = v => Array.isArray(v) ? v.map(jsonb) : v && typeof v==='object' ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,jsonb(v[k])])) : v;
const cenarios = [0,1].map(i => ({userId:ids(99),empresa:{id:ids(i+1),organizacao_id:ids(98),razao_social:i?'Materiais Horizonte FICTÍCIA':'Papelaria Aurora FICTÍCIA',cnpj:i?'12345678000195':'11222333000181'},processo:{id:ids(i+11),numero:`PE 0${i+1}/2026 — FICTÍCIO`,orgao:'Prefeitura de Exemplo FICTÍCIA'},perfil:{dados_confirmados:{endereco:'Rua Fictícia, 100 — Cidade Exemplo',representante:'Pessoa Fictícia',cargo:'Representante'},versao:1,proveniencia:[]},itens:[{id:ids(i+21),tipo:'item',identificador:'1',descricao:i?'Pasta de arquivo FICTÍCIA':'Papel A4 FICTÍCIO',quantidade:'2.000',valor_unitario_proposta:'12.50',marca:'Exemplo',modelo:'Fictício'}]}));
for(const c of cenarios){Object.assign(c.processo,{empresa_id:c.empresa.id,organizacao_id:c.empresa.organizacao_id,documentos_exigidos:['Confira o texto e as condições com o edital fictício.']});Object.assign(c.perfil,{empresa_id:c.empresa.id,organizacao_id:c.empresa.organizacao_id,confirmado_em:'2026-10-27'});for(const i of c.itens)Object.assign(i,{processo_id:c.processo.id,organizacao_id:c.empresa.organizacao_id});}
const processoAdicional={...cenarios[0].processo,id:ids(13),numero:'PE 03/2026 — FICTÍCIO'};
function criarCenarios(quantidade=1){
 if(![1,51,200,1000].includes(quantidade))throw Error('Cenário permitido: 1, 51, 200 ou 1000 itens por empresa');
 return cenarios.map((base,empresa)=>{
  const c=structuredClone(base);
  c.empresa.cnpj=empresa?'12345678000195':'11222333000181';
  c.itens=Array.from({length:quantidade},(_,n)=>({...c.itens[0],id:quantidade===1?c.itens[0].id:ids(10000+empresa*2000+n),identificador:String(n+1),descricao:`Item ${n+1} FICTÍCIO da empresa ${empresa?'B':'A'}`}));
  return c;
 });
}
function criarFetchFicticio(documentos,cenarios){return async function fetchFicticio(url,op={}){
 if(!['Bearer demonstracao-local-ficticia','Bearer servico-local-ficticio'].includes(op.headers?.Authorization))throw new Error('Token externo bloqueado');
 const u=new URL(url);let rows;
 if(u.origin!=='https://lsqjamqvmrcyrvowndiu.supabase.co')throw new Error('Origem externa bloqueada');
 if(u.pathname==='/auth/v1/user')return new Response(JSON.stringify({id:ids(99)}));
 if(u.pathname==='/rest/v1/rpc/identificacao_empresa_habilitada')return new Response('true');
 if(u.pathname==='/rest/v1/rpc/gravar_kit_documento'){
  if(op.headers.Authorization!=='Bearer servico-local-ficticio')throw new Error('RPC exige serviço fictício');
  const p=JSON.parse(op.body),atual=documentos.get(p.p_documento),agora=new Date().toISOString();p.p_dados=jsonb(p.p_dados);
  const falha=()=>new Response(JSON.stringify({message:'Conflito de versão fictício'}),{status:409});
  if(atual&&(atual.empresa_id!==p.p_empresa||atual.processo_id!==p.p_processo||atual.tipo!==p.p_tipo))return falha();
  if(p.p_acao==='salvar'){
   if(atual&&p.p_versao===0){if(atual.versao===1&&atual.criado_por===p.p_usuario&&JSON.stringify(atual.dados)===JSON.stringify(p.p_dados))return Response.json(atual);return falha();}
   if((atual?.versao||0)!==p.p_versao)return falha();
   const d={...atual,id:p.p_documento,empresa_id:p.p_empresa,processo_id:p.p_processo,organizacao_id:p.p_organizacao,tipo:p.p_tipo,dados:p.p_dados,versao:(atual?.versao||0)+1,criado_por:atual?.criado_por||p.p_usuario,criado_em:atual?.criado_em||agora,atualizado_por:p.p_usuario,atualizado_em:agora,revisao_hash:null,revisao_previa:null,revisao_versao:null,revisado_por:null,revisado_em:null};documentos.set(d.id,d);return Response.json(d);
  }
  if(!atual||atual.versao!==p.p_versao||JSON.stringify(atual.dados)!==JSON.stringify(p.p_dados))return falha();
  const d={...atual,revisao_hash:p.p_hash,revisao_previa:p.p_previa,revisao_versao:atual.versao,revisado_por:p.p_usuario,revisado_em:agora};documentos.set(d.id,d);return Response.json(d);
 }
 const tabela=u.pathname.replace('/rest/v1/','');
 const tabelas={clientes:[{id:ids(99),status:'aprovado'}],operacao_empresas:cenarios.map(c=>({...c.empresa,ativo:true})),operacao_membros:cenarios.map(c=>({usuario_id:ids(99),organizacao_id:c.empresa.organizacao_id,empresa_id:c.empresa.id,papel:'operador'})),operacao_identificacao_empresa:cenarios.map(c=>c.perfil),operacao_documentos:[],operacao_processos:[...cenarios.map(c=>c.processo),processoAdicional],operacao_itens_resultado:cenarios.flatMap(c=>c.itens),operacao_kit_documentos:[...documentos.values()]};
 if(!Object.hasOwn(tabelas,tabela))throw new Error('Rede não autorizada bloqueada');
 rows=tabelas[tabela].filter(row=>[...u.searchParams].every(([k,v])=>{
  if(['select','order','limit'].includes(k))return true;
  if(v.startsWith('eq.'))return String(row[k])===v.slice(3);
  if(v.startsWith('gt.'))return String(row[k])>v.slice(3);
  if(v.startsWith('in.(')&&v.endsWith(')'))return v.slice(4,-1).split(',').includes(String(row[k]));
  throw Error('Filtro fictício não implementado');
 }));
 const total=rows.length,order=u.searchParams.get('order');
 if(order){const campos=order.split(',').map(c=>{const [campo,direcao='asc']=c.split('.');if(!['asc','desc'].includes(direcao))throw Error('Ordem fictícia inválida');return [campo,direcao];});rows.sort((a,b)=>{for(const [campo,direcao] of campos){const r=(String(a[campo])<String(b[campo])?-1:String(a[campo])>String(b[campo])?1:0)*(direcao==='asc'?1:-1);if(r)return r;}return 0;});}
 const limit=u.searchParams.get('limit');if(limit!==null){if(!/^[1-9]\d*$/.test(limit))throw Error('Limite inválido');rows=rows.slice(0,Number(limit));}
 const headers={'Content-Type':'application/json'};
 if(new Headers(op.headers).get('prefer')==='count=exact'){headers['Preference-Applied']='count=exact';headers['Content-Range']=rows.length?`0-${rows.length-1}/${total}`:'*/0';}
 return new Response(JSON.stringify(rows),{headers});
};}
let fila=Promise.resolve();
function executarHandler(body,fetchFicticio){
 const trabalho=fila.then(async()=>{const anterior=global.fetch,gate=process.env.IDENTIFICACAO_EMPRESA_LOCAL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;global.fetch=fetchFicticio;process.env.IDENTIFICACAO_EMPRESA_LOCAL='1';process.env.SUPABASE_SERVICE_ROLE_KEY='servico-local-ficticio';try{return await handler({httpMethod:'POST',headers:{authorization:'Bearer demonstracao-local-ficticia'},body});}finally{global.fetch=anterior;if(gate===undefined)delete process.env.IDENTIFICACAO_EMPRESA_LOCAL;else process.env.IDENTIFICACAO_EMPRESA_LOCAL=gate;if(key===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=key;}});
 fila=trabalho.catch(()=>{});return trabalho;
}
const arquivos = new Map([['/', ['docs/qa/kit-documentos-preview.html','text/html']],['/kit-documentos-ui.js',['kit-documentos-ui.js','text/javascript']],['/kit-documentos.css',['kit-documentos.css','text/css']]]);
function criarServidor({quantidade=1}={}) {
 const cenarios=criarCenarios(quantidade),fetchFicticio=criarFetchFicticio(new Map(),cenarios);
 return http.createServer(async(req,res)=>{
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('Cache-Control','no-store');
  if (!/^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host||'')) {res.writeHead(403).end();return;}
  if(!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)){res.writeHead(403).end();return;}
  if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`){res.writeHead(403).end();return;}
  if(req.url==='/demo.js'&&req.method==='GET'){
   res.setHeader('Content-Type','text/javascript');res.end(`const contextos=${JSON.stringify(cenarios.map(c=>({empresaId:c.empresa.id,processoId:c.processo.id})))};let componente;function abrir(){componente?.fechar();componente=LicitaKitDocumentos.montar({alvo:document.getElementById('kit'),contexto:contextos[Number(document.getElementById('cenario').value)],obterSessao:async()=>({userId:'usuario-demo-ficticio',accessToken:'demonstracao-local-ficticia'})});}document.getElementById('exemplo').onclick=()=>{const f=document.querySelector('#kit form');if(!f||f.inert)return;if(f.elements.tipo.value==='declaracao'){f.elements.titulo.value='Declaração fictícia';f.elements.texto.value='A empresa {{razao_social}}, CNPJ {{cnpj}}, apresenta este exemplo para {{numero_edital}}.';f.elements.fonte.value='Modelo fictício para demonstração local';}else{const item=f.querySelector('[data-item]:not(:disabled)');if(item){item.checked=true;f.elements['unidade-'+item.value].value='pacote';}f.elements.validade.value='60 dias';f.elements.prazoEntrega.value='10 dias';f.elements.pagamento.value='30 dias';}f.dispatchEvent(new Event('input',{bubbles:true}));};document.getElementById('cenario').onchange=abrir;document.getElementById('tema').onclick=()=>document.documentElement.classList.toggle('tema-claro');document.getElementById('fechar').onclick=()=>componente.fechar();document.getElementById('abrir').onclick=abrir;abrir();`);return;
  }
  if(req.url==='/api/kit-documentos'&&req.method==='POST'){
   res.setHeader('Content-Type','application/json');
   try {
    if(req.headers.authorization!=='Bearer demonstracao-local-ficticia'){res.writeHead(401).end(JSON.stringify({erro:'Sessão fictícia necessária'}));return;}
    const partes=[];let bytes=0;for await(const parte of req){bytes+=parte.length;if(bytes>LIMITES.envelopeBytes){res.writeHead(413).end('{}');return;}partes.push(parte);}const raw=Buffer.concat(partes).toString('utf8');
    const resultado=await executarHandler(raw,fetchFicticio);res.writeHead(resultado.statusCode).end(resultado.body);
   } catch(e){res.writeHead(e.statusCode||e.status||422).end(JSON.stringify({erro:'Confira os campos do documento fictício.',pendencias:e.pendencias||[e.message]}));}return;
  }
  const arquivo=arquivos.get(req.url);
  if(req.method!=='GET'||!arquivo){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',arquivo[1]);res.end(fs.readFileSync(path.join(root,arquivo[0])));
 });
}
if(require.main===module){const arg=process.argv.slice(2);if(arg.length>1||arg.length===1&&!/^--itens=(1|51|200|1000)$/.test(arg[0]))throw Error('Uso: node docs/qa/servir-kit-documentos-local.cjs --itens=200');const servidor=criarServidor({quantidade:arg.length?Number(arg[0].split('=')[1]):1});servidor.listen(0,'127.0.0.1',()=>console.log('QA fictício em memória, sem Supabase real: http://127.0.0.1:'+servidor.address().port));}
module.exports={criarServidor,criarCenarios,criarFetchFicticio,cenarios,processoAdicional};

