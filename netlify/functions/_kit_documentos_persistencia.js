const {LIMITES,validarBudget}=require('./_kit_proposta_limites');
const {falhar}=require('./_empresa_identificacao');
const {uuid}=require('./_kit_documentos');
const URL='https://lsqjamqvmrcyrvowndiu.supabase.co';
const objeto=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function campos(v,permitidos){if(!objeto(v)||Object.keys(v).some(k=>!permitidos.includes(k)))falhar('Campos de rascunho inválidos.',400);}
function texto(v,max){if(v===undefined)return '';if(typeof v!=='string'||v.length>max||Array.from(v).some(c=>{const n=c.codePointAt(0);return n<32&&![9,10,13].includes(n)||n===65534||n===65535;})||!v.isWellFormed())falhar('Texto de rascunho inválido.',400);return v;}
function referencia(body,versao=true){
 if(!uuid(body.documentoId)||versao&&(!Number.isSafeInteger(body.versaoEsperada)||body.versaoEsperada<0||body.versaoEsperada>2147483646))falhar('Documento ou versão inválidos.',400);
}
function validarRascunho(body,itens){
 campos(body,['acao','empresaId','processoId','documentoId','versaoEsperada','tipo','declaracao','proposta']);
 referencia(body);
 if(body.tipo==='declaracao'){
 if(body.proposta!==undefined)falhar('Tipo de rascunho divergente.',400);
 const d=body.declaracao===undefined?{}:body.declaracao;campos(d,['titulo','texto','fonte']);
 return {declaracao:{titulo:texto(d.titulo,180),texto:texto(d.texto,20000),fonte:texto(d.fonte,1000)}};
 }
 if(body.tipo!=='proposta'||body.declaracao!==undefined)falhar('Tipo de rascunho inválido.',400);
 const p=body.proposta===undefined?{}:body.proposta;campos(p,['itemIds','unidades','validade','prazoEntrega','pagamento']);
 const ids=p.itemIds===undefined?[]:p.itemIds;
 if(!Array.isArray(ids)||ids.length>LIMITES.itens||ids.some(id=>!uuid(id))||new Set(ids.map(id=>id.toLowerCase())).size!==ids.length)falhar('Itens do rascunho inválidos.',400);
 const itemIds=ids.map(id=>id.toLowerCase());
 if(itemIds.some(id=>!itens.some(i=>i.id===id)))falhar('Item indisponível.',404);
 const unidades={};const input=p.unidades===undefined?{}:p.unidades;
 if(!objeto(input))falhar('Unidades inválidas.',400);
 for(const [id,v] of Object.entries(input)){if(!uuid(id)||!itemIds.includes(id.toLowerCase())||Object.hasOwn(unidades,id.toLowerCase()))falhar('Unidade fora dos itens selecionados.',400);unidades[id.toLowerCase()]=texto(v,40);}
 const proposta={itemIds,unidades,validade:texto(p.validade,500),prazoEntrega:texto(p.prazoEntrega,500),pagamento:texto(p.pagamento,500)}; validarBudget(proposta); return {proposta};
}
function documentoPublico(d,incluirDados=true){
 const meta={id:d.id,tipo:d.tipo,titulo:d.tipo==='declaracao'?(d.dados.declaracao.titulo||'Declaração'):'Proposta de materiais',versao:d.versao,empresaId:d.empresa_id,processoId:d.processo_id,organizacaoId:d.organizacao_id,criadoPor:d.criado_por,criadoEm:d.criado_em,atualizadoPor:d.atualizado_por,atualizadoEm:d.atualizado_em,revisadoPor:d.revisado_por||null,revisadoEm:d.revisado_em||null,
 // Banco sem operacao_kit_modelos.sql: sem as colunas, toda peça é 'livre' e formato 1 (o de hoje).
 modeloCodigo:d.tipo==='declaracao'?(d.modelo_codigo||'livre'):null,formato:d.formato===2?2:1};
 if(!incluirDados)return meta;
 return {...meta,dados:d.dados,revisao:d.revisao_hash?{hash:d.revisao_hash,previa:d.revisao_previa,versao:d.revisao_versao,revisadoPor:d.revisado_por,revisadoEm:d.revisado_em}:null};
}
function persistencia(c,empresa,processo,userId){
 const escopo=`empresa_id=eq.${empresa.id}&organizacao_id=eq.${empresa.organizacao_id}&processo_id=eq.${processo.id}`;
 const listar=()=>c.rest(`operacao_kit_documentos?${escopo}&select=*&order=atualizado_em.desc,id`);
 const abrir=async body=>{
 referencia(body,false);const rows=await c.rest(`operacao_kit_documentos?${escopo}&id=eq.${body.documentoId}&select=*`);const d=rows[0];
 if(!d||d.id!==body.documentoId||d.empresa_id!==empresa.id||d.processo_id!==processo.id||d.organizacao_id!==empresa.organizacao_id)falhar('Documento indisponível.',404);
 return d;
 };
 const exigirVersao=(d,body)=>{referencia(body);if(d.versao!==body.versaoEsperada)falhar('Documento alterado em outra aba. Reabra antes de continuar.',409);};
 const rpc=async(nome,p)=>{
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!key)falhar('Persistência de documentos indisponível neste ambiente.',503);
 // O helper REST compartilhado converte conflitos em 503; a RPC preserva o CAS aqui.
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);
 try{
 const r=await fetch(URL+'/rest/v1/rpc/'+nome,{method:'POST',signal:controller.signal,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(p)});
 if(!r.ok){const status=[400,403,404,409].includes(r.status)?r.status:503;falhar(status===409?'Documento alterado em outra aba. Reabra antes de continuar.':status===403?'Acesso não autorizado.':status===404?'Documento ou processo indisponível.':'Não foi possível salvar o documento.',status);}
 const data=await r.json();return Array.isArray(data)?data[0]:data;
 }finally{clearTimeout(timer);}
 };
 const gravar=(body,dados,resultado)=>rpc('gravar_kit_documento',{p_documento:body.documentoId,p_empresa:empresa.id,p_processo:processo.id,p_organizacao:empresa.organizacao_id,p_usuario:userId,p_versao:body.versaoEsperada,p_tipo:body.tipo,p_acao:body.acao,p_dados:dados,p_hash:resultado?.revisaoHash||null,p_previa:resultado?.previa||null});
 // Rascunho novo de declaração com o código do modelo (operacao_kit_modelos.sql): chama gravar_kit_documento e grava modelo_codigo na mesma transação.
 const gravarModelo=(documentoId,dados,modeloCodigo)=>rpc('gravar_kit_declaracao_modelo',{p_documento:documentoId,p_empresa:empresa.id,p_processo:processo.id,p_organizacao:empresa.organizacao_id,p_usuario:userId,p_dados:dados,p_modelo:modeloCodigo});
 return {listar,abrir,exigirVersao,gravar,gravarModelo};
}
module.exports={validarRascunho,documentoPublico,persistencia};

