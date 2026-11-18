const {falhar,LIMITES,caminhoPermitido}=require('./_empresa_identificacao');
const {createHash}=require('node:crypto');
const URL='https://lsqjamqvmrcyrvowndiu.supabase.co';
const ANON='sb_publishable_yH695cc52QUKYfFEgV5RwQ_0a8GLIeb';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function carregarContextoIdentificacao(event,userId,empresaId){
 const token=event.headers?.authorization||event.headers?.Authorization;
 const request=async(path,op={})=>{const r=await fetch(URL+path,{...op,headers:{apikey:ANON,Authorization:token,...op.headers}});if(!r.ok)falhar('Serviço de documentos indisponível.',r.status===403?403:503);return r;};
 const rest=async path=>(await request('/rest/v1/'+path)).json();
 const clientes=await rest(`clientes?id=eq.${userId}&select=status`);if(clientes[0]?.status!=='aprovado')falhar('Acesso não autorizado.',403);
 const gate=await request('/rest/v1/rpc/identificacao_empresa_habilitada',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(await gate.json()!==true)falhar('Isolamento de documentos ainda não validado neste ambiente.',503);
 const empresas=await rest(`operacao_empresas?id=eq.${empresaId}&ativo=eq.true&select=id,organizacao_id,razao_social,cnpj`);const empresa=empresas[0];if(!empresa)falhar('Empresa indisponível.',404);
 // Uma leitura RLS real da tabela nova é obrigatória: sem migração, falha fechada.
 const perfis=await rest(`operacao_identificacao_empresa?empresa_id=eq.${empresa.id}&select=*`);
 const documentos=await rest(`operacao_documentos?empresa_id=eq.${empresa.id}&select=id,empresa_id,organizacao_id,tipo,titulo,arquivo_nome,arquivo_caminho,criado_em`);
 const documento=id=>{const d=documentos.find(d=>d.id===id);if(!d||!caminhoPermitido(d.arquivo_caminho,empresa.organizacao_id,empresa.id))falhar('Documento indisponível.',404);return d;};
 const baixar=async d=>{const r=await request('/storage/v1/object/authenticated/operacao-documentos/'+d.arquivo_caminho.split('/').map(encodeURIComponent).join('/'));if(Number(r.headers.get('content-length'))>LIMITES.upload)falhar('Documento excede 4 MiB.',413);const reader=r.body.getReader();let total=0;const chunks=[];try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>LIMITES.upload)falhar('Documento excede 4 MiB.',413);chunks.push(Buffer.from(value));}}finally{await reader.cancel();}return Buffer.concat(chunks);};
 const perfilPublico=p=>p?{dados:p.invalidado_em?null:p.dados_confirmados,proveniencia:p.proveniencia,confirmadoEm:p.confirmado_em,confirmadoPor:p.confirmado_por,versao:p.versao,status:p.invalidado_em?'invalidado':'confirmado',invalidadoEm:p.invalidado_em}:null;

 const validarPerfil=async()=>{
 let perfil=perfis[0];if(perfil&&!Array.isArray(perfil.proveniencia))perfil={...perfil,invalidado_em:new Date().toISOString()};if(perfil&&!perfil.invalidado_em){for(const p of perfil.proveniencia){try{const d=documento(p.documentoId);if(d.arquivo_caminho!==p.arquivoCaminho||hash(await baixar(d))!==p.hash){perfil={...perfil,invalidado_em:new Date().toISOString()};break;}}catch{perfil={...perfil,invalidado_em:new Date().toISOString()};break;}}}
 return perfil;
 };
 return {empresa,documentos,perfis,documento,baixar,perfilPublico,validarPerfil,request,rest};
}
module.exports={carregarContextoIdentificacao};
