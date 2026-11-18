// Cadastro de processo para empresa já autorizada (homologação comercial).
// - Só usuário logado (exigirUsuarioLogado). Organização NUNCA vem do cliente: é lida da própria empresa.
// - Escrita com o token do próprio usuário: a RLS de operacao_processos é a barreira final. Sem service role.
// - Idempotência durável sem coluna nova: a tentativa tem um UUID estável (tentativaId) usado como id do insert.
//   Resposta perdida ou repetição: GET exato por id, comparando empresa, organização e campos normalizados.
//   Mesmo id com outros dados é conflito distinto. Nenhum estado em memória decide o resultado.
// - Não há unique por número no banco: a checagem prévia é só uma verificação; a concorrência entre tentativas
//   diferentes da mesma empresa é limitada por um bloqueio explícito de processo (não durável, ver LEIA-ME).
const {cabecalhosPadrao,exigirUsuarioLogado}=require('./_auth');
const URL='https://lsqjamqvmrcyrvowndiu.supabase.co';
const ANON='sb_publishable_yH695cc52QUKYfFEgV5RwQ_0a8GLIeb';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const CAMPOS_PERMITIDOS=['empresaId','tentativaId','objeto','numero','orgao','modalidade'];
const LIMITE_BYTES=8192;
const CONTROLE=/[\u0000-\u001f\u007f]/;
const emAndamento=new Map(); // empresaId -> {tentativaId, userId, assinatura, promessa}: bloqueio de concorrência explícito

const normal=v=>v===undefined||v===null||v===''?null:String(v).trim();
const iguais=(a,b)=>['objeto','numero','orgao','modalidade'].every(k=>normal(a[k])===normal(b[k]));
// Assinatura da tentativa em voo: usuário, empresa, id e campos normalizados. Compartilhar exige igualdade exata.
const assinatura=(userId,empresaId,d)=>JSON.stringify([userId,empresaId,d.tentativaId,normal(d.objeto),normal(d.numero),normal(d.orgao),normal(d.modalidade)]);

function validar(body){
 if(!body||typeof body!=='object'||Array.isArray(body))return 'Solicitação inválida.';
 if(Object.keys(body).some(k=>!CAMPOS_PERMITIDOS.includes(k)))return 'Solicitação inválida.';
 if(!uuid(body.empresaId))return 'Empresa inválida.';
 if(!uuid(body.tentativaId))return 'Tentativa inválida.';
 const texto=(v,max)=>{
  if(v===undefined||v===null||v==='')return null;
  if(typeof v!=='string')return 'invalido';
  const t=v.trim();if(!t)return null;
  if(t.length>max||CONTROLE.test(t))return 'invalido';
  return t;
 };
 const objeto=texto(body.objeto,500);
 if(objeto===null||objeto==='invalido'||objeto.length<3)return 'Informe o objeto do processo (mínimo de 3 caracteres).';
 const numero=texto(body.numero,60),orgao=texto(body.orgao,200),modalidade=texto(body.modalidade,60);
 if([numero,orgao,modalidade].includes('invalido'))return 'Confira os campos do processo.';
 return {empresaId:body.empresaId,tentativaId:body.tentativaId,objeto,numero,orgao,modalidade};
}

exports.handler=async event=>{
 const headers=cabecalhosPadrao(event);const resposta=(status,body)=>({statusCode:status,headers,body:JSON.stringify(body)});
 if(event.httpMethod==='OPTIONS')return resposta(204,{});
 if(event.httpMethod!=='POST')return resposta(405,{erro:'Método não permitido.'});
 try{
 const auth=await exigirUsuarioLogado(event);if(!auth.ok)return resposta(auth.status,{erro:auth.erro});
 if(typeof event.body!=='string'||Buffer.byteLength(event.body,'utf8')>LIMITE_BYTES)return resposta(413,{erro:'Solicitação muito grande.'});
 let body;try{body=JSON.parse(event.body);}catch{return resposta(400,{erro:'Solicitação inválida.'});}
 const dados=validar(body);if(typeof dados==='string')return resposta(400,{erro:dados});
 const token=event.headers?.authorization||event.headers?.Authorization||'';
 const rest=(path,op={})=>fetch(URL+path,{...op,headers:{apikey:ANON,Authorization:token,...(op.headers||{})}});
 const ler=async path=>{const r=await rest(path);if(!r.ok)throw Object.assign(Error('leitura'),{status:r.status});return r.json();};
 const userId=auth.userId;

 const clientes=await ler(`/rest/v1/clientes?id=eq.${userId}&select=status`);
 if(clientes[0]?.status!=='aprovado')return resposta(403,{erro:'Acesso não autorizado.'});
 const empresas=await ler(`/rest/v1/operacao_empresas?id=eq.${dados.empresaId}&ativo=eq.true&select=id,organizacao_id`);
 const empresa=empresas[0];if(!empresa)return resposta(404,{erro:'Empresa indisponível.'});
 const membros=await ler(`/rest/v1/operacao_membros?usuario_id=eq.${userId}&organizacao_id=eq.${empresa.organizacao_id}&papel=in.(gestor,operador)&select=papel,empresa_id`);
 if(!membros.some(m=>m.empresa_id===null||m.empresa_id===empresa.id))return resposta(403,{erro:'Acesso não autorizado.'});

 // Concorrência: a mesma tentativa em voo é compartilhada; outra tentativa da mesma empresa é recusada.
 const chave=assinatura(userId,empresa.id,dados);
 const ativa=emAndamento.get(empresa.id);
 if(ativa){
  // Mesmo id só é compartilhado com o mesmo usuário e os mesmos dados normalizados; qualquer divergência é 409 antes de esperar.
  if(ativa.tentativaId===dados.tentativaId){
   if(ativa.userId!==userId)return resposta(409,{erro:'Esta tentativa está em andamento para outro usuário.'});
   if(ativa.assinatura!==chave)return resposta(409,{erro:'Esta tentativa já está em andamento com outros dados.'});
   return {...(await ativa.promessa),headers};
  }
  return resposta(409,{erro:'Outro cadastro desta empresa está em andamento. Tente de novo em instantes.'});
 }
 const promessa=cadastrar({userId,empresa,dados,rest,ler,resposta}).catch(()=>resposta(503,{erro:'Serviço de cadastro indisponível.'}));
 emAndamento.set(empresa.id,{tentativaId:dados.tentativaId,userId,assinatura:chave,promessa});
 try{return {...(await promessa),headers};}finally{emAndamento.delete(empresa.id);}
 }catch{
  return resposta(503,{erro:'Serviço de cadastro indisponível.'});
 }
};

// Mesma empresa e mesma organização; campos normalizados iguais → reaproveita. Qualquer divergência é conflito.
function comparar({linha,empresa,userId,dados,resposta}){
 if(linha.empresa_id!==empresa.id||linha.organizacao_id!==empresa.organizacao_id)return resposta(409,{erro:'Esta tentativa já está associada a outra empresa.'});
 // Vínculo de criação exato: linha sem criador ou de outro usuário nunca é reaproveitada.
 if(linha.criado_por!==userId)return resposta(409,{erro:'Esta tentativa já está associada a outro usuário.'});
 if(!iguais(linha,dados))return resposta(409,{erro:'Esta tentativa já foi usada com outros dados.'});
 return resposta(200,{processo:{id:linha.id,empresa_id:linha.empresa_id,numero:linha.numero??null,objeto:linha.objeto},reaproveitado:true});
}

async function cadastrar({userId,empresa,dados,rest,ler,resposta}){
 const porId=async()=>{const l=await ler(`/rest/v1/operacao_processos?id=eq.${dados.tentativaId}&select=id,empresa_id,organizacao_id,objeto,numero,orgao,modalidade,criado_por`);return l[0]||null;};
 const ja=await porId();
 if(ja)return comparar({linha:ja,empresa,userId,dados,resposta});
 if(dados.numero){
  const iguaisNumero=await ler(`/rest/v1/operacao_processos?empresa_id=eq.${empresa.id}&numero=eq.${encodeURIComponent(dados.numero)}&select=id`);
  if(iguaisNumero.length)return resposta(409,{erro:'Já existe processo com este número nesta empresa.'});
 }
 const gravar={id:dados.tentativaId,organizacao_id:empresa.organizacao_id,empresa_id:empresa.id,objeto:dados.objeto,numero:dados.numero,orgao:dados.orgao,modalidade:dados.modalidade,criado_por:userId};
 let r=null;
 try{r=await rest('/rest/v1/operacao_processos',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(gravar)});}
 catch{r=null;}
 if(r&&r.ok){
  const linhas=await r.json();const p=Array.isArray(linhas)?linhas[0]:null;
  if(p&&p.id===dados.tentativaId)return resposta(201,{processo:{id:p.id,empresa_id:p.empresa_id,numero:p.numero??null,objeto:p.objeto},reaproveitado:false});
  return resposta(503,{erro:'Serviço de cadastro indisponível.'});
 }
 if(r&&(r.status===401||r.status===403))return resposta(403,{erro:'Acesso não autorizado.'});
 // Resposta perdida, conflito de PK ou erro transitório: reconcilia pelo mesmo id antes de decidir.
 const reconhecida=await porId();
 if(reconhecida)return comparar({linha:reconhecida,empresa,userId,dados,resposta});
 if(r&&r.status===409)return resposta(409,{erro:'Esta tentativa já está em uso.'});
 return resposta(503,{erro:'Serviço de cadastro indisponível.'});
}
