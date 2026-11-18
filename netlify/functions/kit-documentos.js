const {LIMITES}=require('./_kit_proposta_limites');
const {listarPaginaItens,carregarItensSelecionados,verificarOrigemSelecionada}=require('./_kit_proposta_itens');
const {salvarItemProcesso}=require('./_itens_processo');
const {cabecalhosPadrao,exigirUsuarioLogado}=require('./_auth');
const {createHash}=require('node:crypto');
const {falhar,validarConfirmacao}=require('./_empresa_identificacao');
const {carregarContextoIdentificacao}=require('./_empresa_identificacao_contexto');
const {uuid,preparar,docx,pendente}=require('./_kit_documentos');
const {validarRascunho,documentoPublico,persistencia}=require('./_kit_documentos_persistencia');
async function carregarEscopo(event,userId,body){
 const c=await carregarContextoIdentificacao(event,userId,body.empresaId);const {empresa,rest}=c;
 if(empresa.id!==body.empresaId||!uuid(empresa.organizacao_id))falhar('Empresa indisponível.',404);
 const membros=await rest(`operacao_membros?usuario_id=eq.${userId}&organizacao_id=eq.${empresa.organizacao_id}&select=usuario_id,organizacao_id,empresa_id,papel`);
 if(!membros.some(m=>m.usuario_id===userId&&m.organizacao_id===empresa.organizacao_id&&['gestor','operador'].includes(m.papel)&&(m.empresa_id===null||m.empresa_id===empresa.id)))falhar('Acesso não autorizado.',403);
 const processos=await rest(`operacao_processos?id=eq.${body.processoId}&empresa_id=eq.${empresa.id}&organizacao_id=eq.${empresa.organizacao_id}&select=id,empresa_id,organizacao_id,numero,orgao,documentos_exigidos,atualizado_em`);
 const processo=processos[0];if(!processo||processo.id!==body.processoId||processo.empresa_id!==empresa.id||processo.organizacao_id!==empresa.organizacao_id)falhar('Processo indisponível.',404);
 return {c,empresa,processo};
}
async function identificacaoKit(c){
 const {empresa}=c;
 let perfil=await c.validarPerfil();const pendencias=[];
 if(!perfil||perfil.invalidado_em)pendencias.push('Confirme a identificação empresarial no cadastro.');
 else{
 if(perfil.empresa_id!==empresa.id||perfil.organizacao_id!==empresa.organizacao_id)falhar('Identificação indisponível.',404);
 try{
 validarConfirmacao({revisado:true,razaoSocial:empresa.razao_social,cnpj:empresa.cnpj,dados:perfil.dados_confirmados,proveniencia:perfil.proveniencia},empresa);
 if(!perfil.confirmado_em||!perfil.versao)throw new Error('incompleto');
 for(const p of perfil.proveniencia){const d=c.documento(p.documentoId);if(d.empresa_id!==empresa.id||d.organizacao_id!==empresa.organizacao_id)throw new Error('referência divergente');}
 }catch{pendencias.push('Identificação incompleta ou com referências divergentes. Confira o cadastro.');perfil=null;}
 }
 return {perfil,pendencias};
}
function consulta(empresa,processo,perfil,itens,pendencias){return {empresa:{id:empresa.id,razaoSocial:empresa.razao_social,cnpj:empresa.cnpj},processo:{id:processo.id,numero:processo.numero,orgao:processo.orgao},identificacao:{status:perfil&&!perfil.invalidado_em?'confirmado':'pendente'},itens:itens.map(i=>({id:i.id,tipo:i.tipo,identificador:i.identificador,descricao:i.descricao,quantidade:i.quantidade,valorUnitario:i.valor_unitario_proposta,marca:i.marca,modelo:i.modelo})),requisitos:Array.isArray(processo.documentos_exigidos)?processo.documentos_exigidos.filter(v=>typeof v==='string'):[],pendencias};}
function prepararPeca(ctx,payload,documento){
 const resultado=preparar(ctx,payload);
 // O hash legado conserva o usuário/fontes; a peça salva acrescenta sua identidade e versão.
 if(documento)resultado.revisaoHash=createHash('sha256').update(JSON.stringify({documentoId:documento.id,versao:documento.versao,revisaoHashLegado:resultado.revisaoHash})).digest('hex');
 return resultado;
}
function erroKit(e,body){
 if(e.status===422&&body?.acao==='exportar'&&(body.documentoId||body.revisado===true&&/^[a-f0-9]{64}$/.test(body.revisaoHash||'')))return [409,{erro:'Dados alterados ou indisponíveis. Prepare e confira uma nova prévia.',...(e.pendencias?{pendencias:e.pendencias}:{})}];
 return [e.status||503,{erro:e.status?e.message:'Serviço temporariamente indisponível.',...(e.pendencias?{pendencias:e.pendencias}:{})}];
}
function criarHandler({carregarEvidenciaPortal=async()=>null,ponteLeitura=null}={}){
 return async event=>{
 const responder=(statusCode,body)=>({statusCode,headers:{...cabecalhosPadrao(event),'Cache-Control':'no-store'},body:JSON.stringify(body)});
 if(event.httpMethod==='OPTIONS')return responder(204,{});
 if(event.httpMethod!=='POST')return responder(405,{erro:'Método não permitido.'});
 if(process.env.IDENTIFICACAO_EMPRESA_LOCAL!=='1')return responder(503,{erro:'Identificação empresarial indisponível neste ambiente.'});
 let body;
 try{
 const auth=await exigirUsuarioLogado(event);if(!auth.ok)return responder(auth.status,{erro:auth.erro});
 if(typeof event.body!=='string'||Buffer.byteLength(event.body,'utf8')>LIMITES.envelopeBytes)falhar('Solicitação inválida.');
 try{body=JSON.parse(event.body);}catch{falhar('Solicitação inválida.');}
 const acaoLeitura=['iniciarLeitura','registrarLeitura','cancelarLeitura','consultarLeituras','confirmarCorrespondencias'].includes(body?.acao);
 if(acaoLeitura){
  if(!require('./_ponte_leitura').validarPedido(body))falhar('Contrato de leitura inválido.',400);
  if(typeof ponteLeitura!=='function')return responder(503,{erro:'Canal de leitura indisponível neste ambiente.'});
  if(body.acao==='cancelarLeitura'){
   const atual=await exigirUsuarioLogado(event);if(!atual.ok||atual.userId!==auth.userId)return responder(403,{erro:'Sessão alterada.'});
   const cancelada=await ponteLeitura({event,body});return responder(cancelada.status||200,cancelada);
  }
 }
 if(body?.tipo!=='proposta'&&event.body.length>50000)falhar('Solicitação inválida.');
 if(!body||!uuid(body.empresaId)||!uuid(body.processoId)||!['consultar','listarItens','listar','abrir','salvar','preparar','confirmarRevisao','exportar','prepararOperacao','iniciarLeitura','registrarLeitura','consultarLeituras','confirmarCorrespondencias','salvarItem'].includes(body.acao))falhar('Solicitação inválida.');
 if(body.acao==='prepararOperacao'&&(Object.keys(body).some(k=>!['acao','empresaId','processoId','documentoId','versaoEsperada'].includes(k))||!uuid(body.documentoId)))falhar('Seletores operacionais inválidos.',400);
 const {c,empresa,processo}=await carregarEscopo(event,auth.userId,body);
 const store=persistencia(c,empresa,processo,auth.userId);
 // Cadastro de item do processo: só token do usuário (RLS), escopo já validado acima. Não toca em documentos.
 if(body.acao==='salvarItem'){const r=await salvarItemProcesso({token:event.headers?.authorization||event.headers?.Authorization||'',organizacaoId:empresa.organizacao_id,processoId:processo.id,body});return responder(r.status,r.body);}
 if(body.acao==='listar')return responder(200,{documentos:(await store.listar()).map(d=>documentoPublico(d,false))});
 if(body.acao==='salvar'){
 const itens=await carregarItensSelecionados({rest:c.rest,organizacaoId:empresa.organizacao_id,processoId:processo.id,itemIds:body.tipo==='proposta'?body.proposta?.itemIds:[]});
 const dados=validarRascunho(body,itens);
 return responder(200,{documento:documentoPublico(await store.gravar(body,dados))});
 }
 let documento;
 if(body.documentoId!==undefined||['abrir','confirmarRevisao'].includes(body.acao)){
 documento=await store.abrir(body);
 if(body.acao!=='abrir')store.exigirVersao(documento,body);
 }
 const {perfil,pendencias}=await identificacaoKit(c);
 if(['consultar','listarItens'].includes(body.acao)){
 const pagina=await listarPaginaItens({request:c.request,organizacaoId:empresa.organizacao_id,processoId:processo.id,afterId:body.afterId,limit:body.itensPaginados===true||body.acao==='listarItens'?100:50});
 if(body.acao==='consultar'&&body.itensPaginados!==true&&pagina.hasMore)falhar('Atualize a interface para selecionar todos os itens por página.',409);
 return responder(200,{...consulta(empresa,processo,perfil,pagina.itens,pendencias),paginacaoItens:{hasMore:pagina.hasMore,nextCursor:pagina.nextCursor},limitesProposta:LIMITES});
 }
 const payload=documento?{tipo:documento.tipo,...documento.dados}:body;
 let itens=[],itensNaoVerificados=false;
 try{itens=await carregarItensSelecionados({rest:c.rest,organizacaoId:empresa.organizacao_id,processoId:processo.id,itemIds:payload.tipo==='proposta'?payload.proposta?.itemIds:[]});}catch(e){if(body.acao!=='abrir'||e.status!==404)throw e;itensNaoVerificados=true;}
 const ctx={userId:auth.userId,empresa,processo,perfil,itens};
 if(body.acao==='abrir'){
 let revisaoVigente=false;
 if(documento.revisado_por===auth.userId&&documento.revisao_versao===documento.versao&&!pendencias.length){
 try{if(payload.tipo==='proposta')await verificarOrigemSelecionada({request:c.request,organizacaoId:empresa.organizacao_id,processoId:processo.id,itemIds:payload.proposta.itemIds});revisaoVigente=documento.revisao_hash===prepararPeca(ctx,payload,documento).revisaoHash;}catch(e){itensNaoVerificados=true;if(![404,409,422,503].includes(e.status))throw e;}
 }
 return responder(200,{documento:documentoPublico(documento),revisaoVigente,itensNaoVerificados});
 }
 if(pendencias.length)pendente(pendencias.join(' '));
 if(payload.tipo==='proposta')await verificarOrigemSelecionada({request:c.request,organizacaoId:empresa.organizacao_id,processoId:processo.id,itemIds:payload.proposta.itemIds});
 const resultado=prepararPeca(ctx,payload,documento);
 if(body.acao==='prepararOperacao'||acaoLeitura){
 if(documento.tipo!=='proposta'||documento.revisado_por!==auth.userId||documento.revisao_versao!==documento.versao||documento.revisao_hash!==resultado.revisaoHash)falhar('Revisão vigente da proposta necessária.',409);
 const evidencia=acaoLeitura?null:await carregarEvidenciaPortal({userId:auth.userId,organizacaoId:empresa.organizacao_id,empresaId:empresa.id,processoId:processo.id,documentoId:documento.id,versao:documento.versao});
 if(!acaoLeitura&&(!evidencia||evidencia.tipo!=='portal'||evidencia.vigente!==true))return responder(409,{valido:false,motivo:'vinculo_portal_indisponivel',lote:null,writeAuthorized:false,portalAuthorizationRequired:true});
 const {prepararOperacao}=await import('../../operacao-assistida/preparar-operacao.mjs');
 // O leitor pode aguardar I/O; revalidar sessão, permissão e conteúdo antes de devolver dados.
 const authAtual=await exigirUsuarioLogado(event);if(!authAtual.ok)return responder(authAtual.status,{erro:authAtual.erro});
 if(authAtual.userId!==auth.userId)falhar('Sessão alterada.',403);
 const atual=await carregarEscopo(event,authAtual.userId,body),storeAtual=persistencia(atual.c,atual.empresa,atual.processo,authAtual.userId);
 const docAtual=await storeAtual.abrir(body);storeAtual.exigirVersao(docAtual,body);
 const perfilAtual=await identificacaoKit(atual.c);if(perfilAtual.pendencias.length)pendente(perfilAtual.pendencias.join(' '));
 const itensAtuais=await carregarItensSelecionados({rest:atual.c.rest,organizacaoId:atual.empresa.organizacao_id,processoId:atual.processo.id,itemIds:docAtual.dados.proposta?.itemIds||[]});
 await verificarOrigemSelecionada({request:atual.c.request,organizacaoId:atual.empresa.organizacao_id,processoId:atual.processo.id,itemIds:docAtual.dados.proposta?.itemIds||[]});
 const ctxAtual={userId:authAtual.userId,empresa:atual.empresa,processo:atual.processo,perfil:perfilAtual.perfil,itens:itensAtuais};
 if(docAtual.tipo!=='proposta'||docAtual.revisado_por!==authAtual.userId||docAtual.revisao_versao!==docAtual.versao||docAtual.revisao_hash!==resultado.revisaoHash||prepararPeca(ctxAtual,{tipo:docAtual.tipo,...docAtual.dados},docAtual).revisaoHash!==resultado.revisaoHash)falhar('Proposta alterada durante a preparação.',409);
 if(acaoLeitura){const leitura=await ponteLeitura({event,body,c:atual.c,documento:docAtual,resultado});return responder(leitura.status||200,leitura);}
 const operacao=await prepararOperacao({documento:documentoPublico(docAtual),revisaoVigente:true},ctxAtual,evidencia);
 return responder(operacao.valido?200:409,operacao);
 }
 if(body.acao==='preparar')return responder(200,{previa:resultado.previa,revisaoHash:resultado.revisaoHash});
 if(body.revisado!==true)pendente('Confirme a revisão dos dados e do conteúdo para este edital.');
 if(typeof body.revisaoHash!=='string'||body.revisaoHash!==resultado.revisaoHash)falhar('Dados alterados. Prepare e confira uma nova prévia.',409);
 if(body.acao==='confirmarRevisao')return responder(200,{documento:documentoPublico(await store.gravar({...body,tipo:documento.tipo},documento.dados,resultado))});
 if(documento&&(documento.revisado_por!==auth.userId||documento.revisao_versao!==documento.versao||documento.revisao_hash!==resultado.revisaoHash))falhar('Prepare e confirme sua revisão desta peça antes de exportar.',409);
 return responder(200,{arquivoBase64:docx(resultado).toString('base64'),nome:`${payload.tipo}-${processo.id}.docx`,mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
 }catch(e){return responder(...erroKit(e,body));}
};
}
module.exports={handler:criarHandler(),criarHandler};
