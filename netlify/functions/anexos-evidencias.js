const {createHash}=require('node:crypto');
const {lerAnexo,LIMITES}=require('./_anexo_pdf');
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
function criarHandler({enabled,auth,request}){
 return async event=>{const reply=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(data)});
 if(!enabled)return reply(503,{erro:'Evidências de anexos não habilitadas.'});if(event.httpMethod!=='POST')return reply(405,{erro:'Método não permitido.'});
 try{
  const user=await auth(event);if(!user.ok||!uuid(user.userId))return reply(401,{erro:'Sessão inválida.'});
  if(typeof event.body!=='string'||Buffer.byteLength(event.body)>4096)fail(400,'Solicitação inválida');let b;try{b=JSON.parse(event.body);}catch{fail(400,'Solicitação inválida');}
  if(!b||Object.keys(b).some(k=>!['acao','empresaId','processoId','anexoId','hash'].includes(k))||!['ler','consultar','selecionar'].includes(b.acao)||![b.empresaId,b.processoId,b.anexoId].every(uuid))fail(400,'Seletores inválidos');
  if(b.acao==='selecionar'&&!/^[a-f0-9]{64}$/.test(b.hash||''))fail(400,'Versão inválida');
  const req=(p,o={})=>request(p,o,event);
  const json=async(p,o)=>{const r=await req(p,o);if(!r.ok)fail(r.status===403?403:503,'Fonte indisponível');const s=await r.text();if(Buffer.byteLength(s)>1000000)fail(413,'Resposta excede limite');return JSON.parse(s);};
  const one=async(p)=>{const rows=await json('/rest/v1/'+p);if(!Array.isArray(rows)||rows.length!==1)fail(403,'Escopo não autorizado');return rows[0];};
  const access=async()=>{
   const c=await one(`clientes?id=eq.${user.userId}&select=id,status&limit=2`);if(c.id!==user.userId||c.status!=='aprovado')fail(403,'Acesso não autorizado');
   const e=await one(`operacao_empresas?id=eq.${b.empresaId}&ativo=eq.true&select=id,organizacao_id,ativo,cnpj&limit=2`);if(e.id!==b.empresaId||!uuid(e.organizacao_id)||e.ativo!==true)fail(403,'Empresa não autorizada');
   if(typeof e.cnpj!=='string'||!/^(?:\d{14}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})$/.test(e.cnpj))fail(409,'CNPJ cadastrado inválido');
   e.cnpj=e.cnpj.replace(/\D/g,'');
   const p=await one(`operacao_processos?id=eq.${b.processoId}&empresa_id=eq.${e.id}&organizacao_id=eq.${e.organizacao_id}&select=id,empresa_id,organizacao_id&limit=2`);if(p.id!==b.processoId||p.empresa_id!==e.id||p.organizacao_id!==e.organizacao_id)fail(403,'Processo não autorizado');
   const a=await one(`operacao_anexos_processo?id=eq.${b.anexoId}&processo_id=eq.${p.id}&organizacao_id=eq.${e.organizacao_id}&select=id,organizacao_id,processo_id,arquivo_caminho,arquivo_nome,tipo&limit=2`);
   const prefix=`${e.organizacao_id}/${e.id}/${p.id}/`;if(a.id!==b.anexoId||a.processo_id!==p.id||a.organizacao_id!==e.organizacao_id||a.tipo!=='edital'||typeof a.arquivo_caminho!=='string'||!a.arquivo_caminho.startsWith(prefix)||a.arquivo_caminho.split('/').some(s=>!s||s==='.'||s==='..'||s.includes('\\')))fail(403,'Anexo não autorizado');return {e,p,a};
  };
  const scope=await access(),a=scope.a;
  const download=async()=>{const r=await req('/storage/v1/object/authenticated/operacao-documentos/'+a.arquivo_caminho.split('/').map(encodeURIComponent).join('/'));if(!r.ok||!r.body)fail(503,'Arquivo indisponível');const reader=r.body.getReader(),parts=[];let n=0;try{for(;;){const x=await reader.read();if(x.done)break;n+=x.value.length;if(n>LIMITES.bytes)fail(413,'PDF excede limite de leitura de 2 MiB');parts.push(Buffer.from(x.value));}}finally{await reader.cancel();}return Buffer.concat(parts);};
  const bytes=await download(),hash=createHash('sha256').update(bytes).digest('hex');
  let result;
  if(b.acao==='ler'){
   const read=await lerAnexo(bytes);if(JSON.stringify(await access())!==JSON.stringify(scope))fail(403,'Acesso alterado');
   result=await json('/rest/v1/rpc/registrar_evidencia_anexo',{method:'POST',privileged:true,body:JSON.stringify({p_usuario:user.userId,p_anexo:a.id,p_empresa:scope.e.id,p_caminho:a.arquivo_caminho,p_hash:hash,p_extrator:read.extratorVersao,p_paginas:read.paginas})});
  }else{
   const rows=await json(`/rest/v1/operacao_anexo_versoes?anexo_id=eq.${a.id}&organizacao_id=eq.${scope.e.organizacao_id}&empresa_id=eq.${scope.e.id}&processo_id=eq.${scope.p.id}&hash=eq.${hash}&select=hash,paginas,extrator_versao,selecionada&limit=2`);
   if(!Array.isArray(rows)||rows.length!==1||rows[0].hash!==hash)fail(409,'Versão do arquivo mudou ou não foi lida. Leia e revise novamente');result=rows[0];
   if(b.acao==='selecionar'){if(hash!==b.hash)fail(409,'Arquivo mudou desde a revisão');if(createHash('sha256').update(await download()).digest('hex')!==hash)fail(409,'Arquivo alterado durante a revisão');result=await json('/rest/v1/rpc/selecionar_versao_anexo',{method:'POST',privileged:true,body:JSON.stringify({p_usuario:user.userId,p_anexo:a.id,p_empresa:scope.e.id,p_caminho:a.arquivo_caminho,p_hash:hash})});}
  }
  if(b.acao==='consultar'&&createHash('sha256').update(await download()).digest('hex')!==hash)fail(409,'Arquivo alterado durante a consulta');
  if(b.acao==='consultar'){
   const latest=await json(`/rest/v1/operacao_anexo_versoes?anexo_id=eq.${a.id}&organizacao_id=eq.${scope.e.organizacao_id}&empresa_id=eq.${scope.e.id}&processo_id=eq.${scope.p.id}&hash=eq.${hash}&select=hash,paginas,extrator_versao,selecionada&limit=2`);
   if(!Array.isArray(latest)||latest.length!==1||JSON.stringify(latest[0])!==JSON.stringify(result))fail(409,'Seleção documental alterada durante a consulta');
  }
  const currentUser=await auth(event);if(!currentUser.ok||currentUser.userId!==user.userId)fail(401,'Sessão alterada ou revogada');
  if(JSON.stringify(await access())!==JSON.stringify(scope))fail(403,'Acesso alterado');
  return reply(200,{...result,contexto:{organizacaoId:scope.e.organizacao_id,empresaId:scope.e.id,cnpj:scope.e.cnpj,processoId:scope.p.id,anexoId:a.id,hash},anexoId:a.id,fonte:{nome:a.arquivo_nome,anexoId:a.id},vigenciaJuridicaComprovada:false,escopoRevisao:'Versão selecionada pelo operador; não comprova ausência de retificações.'});
 }catch(e){return reply(e.status||503,{erro:e.status?e.message:'Leitura indisponível; arquivo preservado.'});}
 };
}
exports.criarHandler=criarHandler;
// O host deve fornecer transporte autenticado do mesmo projeto; não há fallback para produção.
