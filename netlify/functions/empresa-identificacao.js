const {cabecalhosPadrao,exigirUsuarioLogado}=require('./_auth');
const {falhar,LIMITES,validarArquivo,validarConfirmacao}=require('./_empresa_identificacao');
const {createHash,randomUUID}=require('node:crypto');
const {carregarContextoIdentificacao}=require('./_empresa_identificacao_contexto');
const URL='https://lsqjamqvmrcyrvowndiu.supabase.co';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
exports.handler=async event=>{
 const headers=cabecalhosPadrao(event);const resposta=(status,body)=>({statusCode:status,headers,body:JSON.stringify(body)});
 if(event.httpMethod==='OPTIONS')return resposta(204,{});
 if(event.httpMethod!=='POST')return resposta(405,{erro:'Método não permitido.'});
 if(process.env.IDENTIFICACAO_EMPRESA_LOCAL!=='1')return resposta(503,{erro:'Identificação da empresa ainda não habilitada neste ambiente.'});
 try{
 const auth=await exigirUsuarioLogado(event);if(!auth.ok)return resposta(auth.status,{erro:auth.erro});
 if(typeof event.body!=='string'||event.body.length>Math.ceil(LIMITES.upload/3)*4+4096)falhar('Solicitação muito grande.',413);
 let body;try{body=JSON.parse(event.body);}catch{falhar('Solicitação inválida.');}
 if(!uuid(body.empresaId))falhar('Empresa inválida.');
 const {empresa,documentos,documento,baixar,perfilPublico,validarPerfil,request}=await carregarContextoIdentificacao(event,auth.userId,body.empresaId);
 if(body.acao==='consultar'){
 const perfil=await validarPerfil();
 return resposta(200,{empresa,documentos,perfil:perfilPublico(perfil)});
 }
 if(body.acao==='anexar'){
 if(!['contrato_social','cartao_cnpj'].includes(body.tipo))falhar('Tipo de documento inválido.');const bytes=validarArquivo(body.nome,body.conteudoBase64);
 const nome=body.nome.replace(/[^\p{L}\p{N}._-]/gu,'_');const caminho=`${empresa.organizacao_id}/${empresa.id}/${randomUUID()}-${nome}`;
 await request('/storage/v1/object/operacao-documentos/'+caminho,{method:'POST',headers:{'Content-Type':'application/pdf','x-upsert':'false'},body:bytes});
 try{const r=await request('/rest/v1/operacao_documentos',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({organizacao_id:empresa.organizacao_id,empresa_id:empresa.id,tipo:body.tipo==='contrato_social'?'Contrato social':'Cartão CNPJ',titulo:body.tipo==='contrato_social'?'Contrato social':'Cartão CNPJ',arquivo_nome:body.nome,arquivo_caminho:caminho,criado_por:auth.userId})});return resposta(200,{documento:(await r.json())[0]});}
 catch(e){try{await request('/storage/v1/object/operacao-documentos',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[caminho]})});}catch{}throw e;}
 }
 if(body.acao==='extrair'){const d=documento(body.documentoId);const bytes=await baixar(d);const {extrairDocumento}=require('./_empresa_documentos');return resposta(200,{documentoId:d.id,hash:hash(bytes),...await extrairDocumento(bytes)});}
 if(body.acao==='confirmar'){
 const validado=validarConfirmacao(body,empresa);const proveniencia=[];
 for(const p of validado.proveniencia){const d=documento(p.documentoId);const bytes=await baixar(d);if(hash(bytes)!==p.hash)falhar('Documento alterado. Confira novamente.',409);
 const {extrairDocumento}=require('./_empresa_documentos');const extracao=await extrairDocumento(bytes);
 for(const campo of p.campos){const ev=extracao.evidencias.find(e=>e.campo===campo&&e.pagina===p.pagina&&e.trecho===p.trecho&&e.valor===validado.dados[campo]);if(!ev)falhar('A fonte não comprova este campo. Confira e confirme como preenchimento manual.');}
 proveniencia.push({...p,arquivoCaminho:d.arquivo_caminho});}
 const svc=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!svc)falhar('Confirmação indisponível neste ambiente.',503);
 const r=await fetch(URL+'/rest/v1/rpc/confirmar_identificacao_empresa',{method:'POST',headers:{apikey:svc,Authorization:'Bearer '+svc,'Content-Type':'application/json'},body:JSON.stringify({p_empresa:empresa.id,p_usuario:auth.userId,p_razao:empresa.razao_social,p_cnpj:empresa.cnpj,p_dados:validado.dados,p_proveniencia:proveniencia})});if(!r.ok)falhar('Não foi possível confirmar. Confira o cadastro e os documentos.',409);
 const p=await r.json();return resposta(200,{empresa,perfil:perfilPublico(Array.isArray(p)?p[0]:p)});
 }
 falhar('Ação inválida.');
 }catch(e){return resposta(e.status||503,{erro:e.status?e.message:'Serviço temporariamente indisponível. Tente novamente.'});}
};
