const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {randomBytes}=require('node:crypto');
const {criarLeituraIA}=require('./ia-leitura.cjs');
const {criarRuntime,QA}=require('./isolamento.cjs');
const {descobrirContextos,descobrirEmpresas}=require('./descoberta-contextos.cjs');
const {criarRegistro}=require('./registro-criados.cjs');
const {LIMITES}=require('../../../netlify/functions/_kit_proposta_limites');
const {LIMITES:LIMITES_ARQUIVO}=require('../../../netlify/functions/_empresa_identificacao');
const root=path.resolve(__dirname,'../../..');
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
function criarServidor({copia,serviceKey,fetchImpl,emailsPermitidos,contextos,iaOrganizacoes=[],empresasQA=[],registroCriados=path.join(__dirname,'.sandbox','criados-qa.json')}){
 if(!Array.isArray(emailsPermitidos)||!emailsPermitidos.length||emailsPermitidos.some(x=>typeof x!=='string'||!/@(?:example|qa)\.invalid$/.test(x))
  ||!Array.isArray(contextos)||!contextos.length||contextos.some(x=>!uuid(x.empresaId)||!uuid(x.processoId)))throw Error('Fixtures QA explícitas necessárias');
 if(!Array.isArray(iaOrganizacoes)||iaOrganizacoes.length>100||iaOrganizacoes.some(x=>!uuid(x)))throw Error('Organizações QA inválidas');
 const orgsIA=[...new Set(iaOrganizacoes)];
 if(!Array.isArray(empresasQA)||empresasQA.length>100||empresasQA.some(x=>!uuid(x)))throw Error('Empresas QA inválidas');
 const empresasFixas=[...new Set(empresasQA)];
 const registro=criarRegistro(registroCriados);
 // Pares de uma sessão: fixtures da allowlist + IDs que este fluxo registrou para este usuário (durável).
 const paresDe=userId=>contexts.concat(registro.listar(userId));
 const contexts=contextos.map(({empresaId,processoId})=>({empresaId,processoId})),emails=new Set(emailsPermitidos);
 const runtime=criarRuntime(copia,{serviceKey,fetchImpl}),sessoes=new Map();let tentativas=0;
 const leituraIA=criarLeituraIA({publicKey:copia.config.publicKey,transporte:runtime.transporte,organizacoes:orgsIA});
 const servidor=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  const responder=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(data));};
  const origem=`http://127.0.0.1:${servidor.address()?.port}`;
  if(req.headers.host!==origem.slice(7)||!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
   ||req.method==='POST'&&req.headers.origin!==origem){responder(403,{erro:'Origem QA inválida'});return;}
  const cookies=(req.headers.cookie||'').split(';').map(x=>x.trim()).filter(x=>x.split('=')[0].trim()==='qa_session');
  const sid=cookies.length===1?/^qa_session=([a-f0-9]{64})$/.exec(cookies[0])?.[1]:undefined;
  let sessao=sessoes.get(sid);if(sessao?.expira<=Date.now()){sessoes.delete(sid);sessao=null;}
  try{
   if(req.method==='POST'){
    const rotas=['/api/ia-leitura','/qa/login','/qa/logout','/api/kit-documentos','/api/empresa-identificacao','/api/criar-processo'];
    if(!rotas.includes(req.url)){responder(404,{});return;}
    if(req.headers['content-type']!=='application/json'){responder(415,{});return;}
    const max=['/qa/login','/api/ia-leitura'].includes(req.url)?4096:req.url==='/api/criar-processo'?8192:req.url==='/api/empresa-identificacao'?Math.ceil(LIMITES_ARQUIVO.upload/3)*4+4096:LIMITES.envelopeBytes,partes=[];let bytes=0;
    for await(const b of req){bytes+=b.length;if(bytes>max){responder(413,{});return;}partes.push(b);}
    const raw=Buffer.concat(partes).toString('utf8');let body;try{body=JSON.parse(raw);}catch{responder(400,{});return;}
    if(req.url==='/qa/login'){
     if(++tentativas>10){responder(429,{erro:'Limite local de login atingido'});return;}
     if(!body||!emails.has(body.email)||typeof body.password!=='string'||!body.password||Object.keys(body).some(k=>!['email','password'].includes(k))){responder(401,{erro:'Login QA recusado'});return;}
     const r=await runtime.transporte(QA+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:copia.config.publicKey,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
     if(!r.ok){responder(401,{erro:'Login QA recusado'});return;}
     const auth=await r.json();if(typeof auth.access_token!=='string'||!auth.access_token||!auth.user?.id||!Number.isFinite(auth.expires_in)||auth.expires_in<=0){responder(401,{erro:'Login QA recusado'});return;}
     if(sid)sessoes.delete(sid);const novo=randomBytes(32).toString('hex');
     sessoes.set(novo,{token:auth.access_token,userId:auth.user.id,expira:Date.now()+Math.min(auth.expires_in,3600)*1000});
     res.setHeader('Set-Cookie',`qa_session=${novo}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.min(Math.floor(auth.expires_in),3600)}`);responder(200,{ok:true});return;
    }
    if(!sessao){responder(401,{});return;}
    if(req.url==='/api/ia-leitura'){
     if(req.headers.authorization){responder(400,{erro:'Use somente a sessão QA.'});return;}
     const result=await leituraIA({token:sessao.token,body});
     if(sessoes.get(sid)!==sessao||sessao.expira<=Date.now()){responder(401,{});return;}
     res.writeHead(result.status,{'Content-Type':'application/json'}).end(await result.text());return;
    }
    if(req.url==='/qa/logout'){sessoes.delete(sid);res.setHeader('Set-Cookie','qa_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');responder(200,{ok:true});return;}
    if(req.url==='/api/criar-processo'){
     // Só empresa já autorizada (fixture QA ou empresa de pares registrados deste usuário). Organização e vínculo: o handler lê com o token.
     const empresasOk=new Set([...empresasFixas,...paresDe(sessao.userId).map(x=>x.empresaId)]);
     if(!body||typeof body!=='object'||!empresasOk.has(body.empresaId)||!uuid(body.tentativaId)){responder(403,{});return;}
     // Registro só DEPOIS de sucesso validado: o handler confirmou empresa, vínculo e criado_por do próprio usuário.
     // Nenhuma intenção é gravada antes da autorização, então um id alheio nunca vira par de outro usuário.
     if(!registro.podeRegistrar(sessao.userId)){responder(409,{erro:'Limite QA de processos atingido.'});return;}
     const result=await runtime.executar('criar-processo',{httpMethod:'POST',headers:{authorization:`Bearer ${sessao.token}`},body:raw});
     if(sessoes.get(sid)!==sessao||sessao.expira<=Date.now()){responder(401,{});return;}
     if(result.statusCode>=500){responder(result.statusCode,{erro:'Serviço QA indisponível'});return;}
     if(result.statusCode===200||result.statusCode===201){
      let p=null;try{p=JSON.parse(result.body).processo;}catch{p=null;}
      if(!p||p.id!==body.tentativaId||p.empresa_id!==body.empresaId){responder(503,{erro:'Serviço QA indisponível'});return;}
      // Falha ao registrar após gravar: 503 para o cliente repetir com o mesmo id (reconcilia e registra).
      try{registro.registrar(sessao.userId,body.empresaId,body.tentativaId);}catch{responder(503,{erro:'Serviço QA indisponível'});return;}
     }
     res.writeHead(result.statusCode,{'Content-Type':'application/json'}).end(result.body);return;
    }
    const pares=paresDe(sessao.userId);
    const empresasOk=new Set([...empresasFixas,...pares.map(x=>x.empresaId)]);
    if(!body||(req.url==='/api/empresa-identificacao'?!empresasOk.has(body.empresaId):!pares.some(x=>x.empresaId===body.empresaId&&x.processoId===body.processoId))){responder(403,{});return;}
    const result=await runtime.executar(req.url.slice(5),{httpMethod:'POST',headers:{authorization:`Bearer ${sessao.token}`},body:raw});
    if(result.statusCode>=500){responder(result.statusCode,{erro:'Serviço QA indisponível'});return;}
    res.writeHead(result.statusCode,{'Content-Type':'application/json'}).end(result.body);return;
   }
   if(req.method!=='GET'){responder(405,{});return;}
   if(req.url==='/qa/session'){
    if(!sessao){responder(401,{});return;}
    // Descoberta filtrada: o token do usuário lê apenas vínculos; só entram pares na allowlist QA explícita.
    let lista,empresas;
    const pares=paresDe(sessao.userId);
    try{
     lista=await descobrirContextos({transporte:runtime.transporte,restUrl:copia.config.restUrl,publicKey:copia.config.publicKey,token:sessao.token,userId:sessao.userId,allowlist:pares});
     empresas=await descobrirEmpresas({transporte:runtime.transporte,restUrl:copia.config.restUrl,publicKey:copia.config.publicKey,token:sessao.token,userId:sessao.userId,allowlist:[...new Set([...empresasFixas,...pares.map(x=>x.empresaId)])]});
    }catch{responder(503,{erro:'Descoberta QA indisponível'});return;}
    if(sessoes.get(sid)!==sessao||sessao.expira<=Date.now()){responder(401,{});return;}
    responder(200,{userId:sessao.userId,accessToken:'qa-cookie-session',contextos:lista,empresas});return;
   }
   if(req.url==='/'){
    let html=fs.readFileSync(path.join(root,'docs/qa/kit-documentos-preview.html'),'utf8');
    html=html.replace('<div id="kit"></div>','<section id="identificacao" aria-label="Identificação QA"></section><div id="kit"></div>')
     .replace('<script src="/demo.js"></script>','<link rel="stylesheet" href="/operacao-identificacao.css"><script src="/empresa-identificacao-ui.js"></script><script src="/operacao-identificacao.js"></script><script src="/demo.js"></script>');
    html=html.replace('<body>','<body><form id="qa-login"><label>E-mail de fixture QA <input name="email" type="email" required autocomplete="username"></label><label>Credencial QA <input name="password" type="password" required autocomplete="current-password"></label><button>Entrar no QA</button><output id="qa-status"></output></form>');
    html=html.replace('Dados inventados para teste local. Sem credenciais, envio ou acesso à produção. Os documentos gerados são exemplos fictícios.','Harness QA isolado. Login real somente no projeto de homologação; use exclusivamente fixtures. Sem produção ou SMTP.');
    html=html.replace('</body>', '<section aria-label="Teste de integração de leitura IA"><h2>Teste de integração: carteira autorizada</h2><p>Consulta de leitura QA. Não conecta ChatGPT, Claude ou outro modelo.</p><form id="qa-ia"><label>Organização QA <select name="organizacao">'+orgsIA.map(id=>'<option value="'+id+'">'+id+'</option>').join('')+'</select></label><button'+(orgsIA.length?'':' disabled')+'>Consultar carteira</button></form><pre id="qa-ia-resultado" aria-live="polite"></pre><button id="qa-ia-proxima" disabled>Próxima página</button></section><script src="/qa-ia.js"></script></body>');
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(html);return;
   }
   if(req.url==='/app'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(fs.readFileSync(path.join(root,'docs/qa/app-comercial.html'),'utf8'));return;}
   if(req.url==='/demo.js'){
    res.writeHead(200,{'Content-Type':'text/javascript'}).end(`let componente,identificacao;async function sessao(){const r=await fetch('/qa/session');if(!r.ok)return null;return r.json();}async function abrir(){componente?.fechar();identificacao?.limpar('Validando sessão QA…');const s=await sessao();if(!s){document.getElementById('qa-status').textContent='Sessão QA não confirmada; entre novamente';return false;}document.getElementById('qa-status').textContent='Sessão QA ativa';const escolha=document.getElementById('cenario');escolha.replaceChildren(...s.contextos.map((c,i)=>{const o=document.createElement('option');o.value=i;o.textContent='Fixture QA '+(i+1);return o;}));montar(s);}function montar(s){componente?.fechar();identificacao?.limpar('Contexto QA alterado');identificacao=OperacaoIdentificacao.montar({alvo:document.getElementById('identificacao'),obterSessao:sessao});identificacao.abrir(s.contextos[Number(document.getElementById('cenario').value)].empresaId,s.userId);componente=LicitaKitDocumentos.montar({alvo:document.getElementById('kit'),contexto:s.contextos[Number(document.getElementById('cenario').value)],obterSessao:sessao});}document.getElementById('qa-login').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget;try{const r=await fetch('/qa/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:f.elements.email.value,password:f.elements.password.value})});f.elements.password.value='';document.getElementById('qa-status').textContent=r.ok?'Confirmando sessão QA…':'Login QA recusado';if(r.ok)await abrir();}catch{f.elements.password.value='';document.getElementById('qa-status').textContent='QA indisponível';}};document.getElementById('cenario').onchange=async()=>{const s=await sessao();if(s)montar(s);};document.getElementById('exemplo').hidden=true;document.getElementById('fechar').onclick=()=>{componente?.fechar();identificacao?.limpar('Seção fechada');};document.getElementById('abrir').onclick=abrir;document.getElementById('tema').onclick=()=>document.documentElement.classList.toggle('tema-claro');abrir();`);return;
   }
   if(req.url==='/qa-ia.js'){res.writeHead(200,{'Content-Type':'text/javascript'}).end(fs.readFileSync(path.join(__dirname,'ia-leitura-ui.js')));return;}
   const arquivos={'/empresa-identificacao-ui.js':['empresa-identificacao-ui.js','text/javascript'],'/operacao-identificacao.js':['operacao-identificacao.js','text/javascript'],'/operacao-identificacao.css':['operacao-identificacao.css','text/css'],'/kit-documentos-ui.js':['kit-documentos-ui.js','text/javascript'],'/kit-documentos.css':['kit-documentos.css','text/css'],'/qa-apresentacao.css':['qa-apresentacao.css','text/css'],'/app-comercial.js':['app-comercial.js','text/javascript'],'/itens-processo-ui.js':['itens-processo-ui.js','text/javascript'],'/app-comercial-core.js':['app-comercial-core.js','text/javascript'],'/app-comercial-controlador.js':['app-comercial-controlador.js','text/javascript'],'/app-comercial.css':['app-comercial.css','text/css'],'/ds-tokens.css':['ds-tokens.css','text/css']};
   const f=arquivos[req.url];if(!f){responder(404,{});return;}res.writeHead(200,{'Content-Type':f[1]}).end(fs.readFileSync(path.join(root,f[0])));
  }catch{if(!res.headersSent)responder(503,{erro:'Serviço QA indisponível'});else res.end();}
 });
 servidor.on('close',()=>sessoes.clear());return servidor;
}
module.exports={criarServidor};

