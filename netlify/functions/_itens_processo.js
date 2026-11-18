// Cadastro e edição de itens persistidos do processo (operacao_itens_resultado), com o token do próprio usuário.
// - Escopo (empresa, organização, processo) é validado por quem chama (kit-documentos: carregarEscopo). Aqui o
//   organizacao_id e o processo_id vêm SEMPRE do servidor, nunca do corpo. Sem service role.
// - A RLS de operacao_itens_resultado é a barreira final de escrita (pode_escrever_processo_operacao).
// - Valores seguem o mesmo contrato do kit (decimal() de _kit_documentos): texto canônico, positivo, sem notação,
//   sem negativos, NaN ou excesso. Quantidade com até 3 casas (numeric(15,3)), valor com até 2 (numeric(15,2)).
// - Idempotência na criação: o id da tentativa é a PK. Repetição reconcilia por GET exato (id+processo+organização)
//   e compara os campos normalizados. Id alheio ou identificador repetido nunca sobrescreve outro item.
// - Edição: PATCH restrito por id+processo+organização. Zero linhas = indisponível (inclui ID cruzado).
// Editar um item muda o conteúdo da prévia: o hash de revisão do kit deixa de conferir (contrato já existente).
const {falhar}=require('./_empresa_identificacao');
const {uuid,decimal,totalItem}=require('./_kit_documentos');
const URL='https://lsqjamqvmrcyrvowndiu.supabase.co';
const ANON='sb_publishable_yH695cc52QUKYfFEgV5RwQ_0a8GLIeb';
const CAMPOS=['id','tipo','identificador','descricao','quantidade','valorUnitario','marca','modelo'];
const MODOS=['criar','editar'];
const SELECT='id,organizacao_id,processo_id,tipo,identificador,descricao,quantidade:quantidade::text,valor_unitario_proposta:valor_unitario_proposta::text,marca,modelo,atualizado_em';
const CONTROLE=/[\u0000-\u001f\u007f]/;

function objeto(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);}
function texto(v,rotulo,max,obrigatorio){
 if(v===undefined||v===null||v===''){if(obrigatorio)falhar(`Informe ${rotulo}.`,400);return null;}
 if(typeof v!=='string'||v.length>max||CONTROLE.test(v))falhar(`Confira ${rotulo}.`,400);
 const t=v.trim();if(!t){if(obrigatorio)falhar(`Informe ${rotulo}.`,400);return null;}
 return t;
}
// Mesmo contrato numérico do kit: string canônica, positiva, dentro do limite; BigInt escalado para comparação exata.
function valorDecimal(v,escala,rotulo){
 if(typeof v!=='string')falhar(`${rotulo} deve ser informado como texto decimal.`,400);
 try{return {texto:v,n:decimal(v,escala)};}
 catch{falhar(`${rotulo} inválido. Use número positivo com até ${escala} casas decimais e dentro do limite.`,400);}
}
function validarItem(item){
 if(!objeto(item)||Object.keys(item).some(k=>!CAMPOS.includes(k)))falhar('Campos do item inválidos.',400);
 if(!uuid(item.id))falhar('Identificador de item inválido.',400);
 if(item.tipo!==undefined&&item.tipo!=='item')falhar('Somente itens individuais podem ser cadastrados aqui.',400);
 const identificador=texto(item.identificador,'o identificador do item',180,true);
 const descricao=texto(item.descricao,'a descrição do item',10000,true);
 const quantidade=valorDecimal(item.quantidade,3,'Quantidade');
 const valor=valorDecimal(item.valorUnitario,2,'Valor unitário');
 // Total derivado com a mesma função do kit (totalItem): produto fora do limite é recusado antes de qualquer escrita.
 try{totalItem(quantidade.texto,valor.texto);}catch{falhar('Total do item excede o limite. Confira quantidade e valor unitário.',400);}
 const marca=texto(item.marca,'a marca',500,false);
 const modelo=texto(item.modelo,'o modelo',500,false);
 const dados={identificador,descricao,quantidade:quantidade.texto,valor_unitario_proposta:valor.texto,marca,modelo};
 const chave=JSON.stringify([identificador,descricao,quantidade.n.toString(),valor.n.toString(),marca??'',modelo??'']);
 return {id:item.id,dados,chave};
}
// Linha legada fora do contrato (valor nulo/zero) nunca é igual a uma tentativa válida: retorna null.
function chaveDeLinha(l){
 try{return JSON.stringify([l.identificador,l.descricao,decimal(l.quantidade,3).toString(),decimal(l.valor_unitario_proposta,2).toString(),l.marca??'',l.modelo??'']);}
 catch{return null;}
}
function publico(l){return {id:l.id,tipo:l.tipo,identificador:l.identificador,descricao:l.descricao,quantidade:l.quantidade,valorUnitario:l.valor_unitario_proposta,marca:l.marca??null,modelo:l.modelo??null,atualizadoEm:l.atualizado_em};}
function conferirLinha(l,organizacaoId,processoId){
 if(!l||!uuid(l.id)||l.organizacao_id!==organizacaoId||l.processo_id!==processoId)falhar('Item indisponível.',404);
}
async function rest(token,path,op={}){
 return fetch(URL+path,{...op,headers:{apikey:ANON,Authorization:token,'Content-Type':'application/json',...(op.headers||{})}});
}
const escopoLinha=(id,organizacaoId,processoId)=>`operacao_itens_resultado?id=eq.${id}&processo_id=eq.${processoId}&organizacao_id=eq.${organizacaoId}&select=${SELECT}`;

async function criar({token,organizacaoId,processoId,item}){
 const {id,dados,chave}=item;
 // Falha de rede/resposta perdida (fetch lança) também cai na reconciliação: a linha pode ter sido gravada.
 let r=null;
 try{r=await rest(token,'/rest/v1/operacao_itens_resultado?select='+SELECT,{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({id,organizacao_id:organizacaoId,processo_id:processoId,tipo:'item',...dados})});}
 catch{r=null;}
 if(r&&r.ok){
  const linhas=await r.json();const l=Array.isArray(linhas)?linhas[0]:null;
  if(!l||l.id!==id)falhar('Serviço de itens indisponível.',503);
  conferirLinha(l,organizacaoId,processoId);
  return {status:201,body:{item:publico(l),reaproveitado:false}};
 }
 if(r&&(r.status===401||r.status===403))falhar('Acesso não autorizado.',403);
 // Resposta perdida, conflito de PK ou de identificador, ou erro transitório: reconcilia pelo id antes de decidir.
 let g=null;
 try{g=await rest(token,'/rest/v1/'+escopoLinha(id,organizacaoId,processoId));}catch{g=null;}
 const linhas=g&&g.ok?await g.json():null;
 if(Array.isArray(linhas)&&linhas.length===1){
  const l=linhas[0];conferirLinha(l,organizacaoId,processoId);
  if(chaveDeLinha(l)===chave)return {status:200,body:{item:publico(l),reaproveitado:true}};
  falhar('Esta tentativa já foi usada com outros dados.',409);
 }
 if(r&&r.status===409)falhar('Já existe item com este identificador neste processo, ou o identificador informado já está em uso.',409);
 falhar('Serviço de itens indisponível.',503);
}

async function editar({token,organizacaoId,processoId,item}){
 const {id,dados}=item;
 const r=await rest(token,'/rest/v1/'+escopoLinha(id,organizacaoId,processoId),{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({...dados,atualizado_em:new Date().toISOString()})});
 if(r.status===409)falhar('Já existe item com este identificador neste processo.',409);
 if(r.status===401||r.status===403)falhar('Acesso não autorizado.',403);
 if(!r.ok)falhar('Serviço de itens indisponível.',503);
 const linhas=await r.json();
 if(!Array.isArray(linhas)||linhas.length!==1)falhar('Item indisponível.',404);
 conferirLinha(linhas[0],organizacaoId,processoId);
 return {status:200,body:{item:publico(linhas[0]),reaproveitado:false,editado:true}};
}

async function salvarItemProcesso({token,organizacaoId,processoId,body}){
 if(!MODOS.includes(body.modo))falhar('Modo de gravação inválido.',400);
 if(!uuid(organizacaoId)||!uuid(processoId))falhar('Escopo inválido.',400);
 const item=validarItem(body.item);
 return body.modo==='criar'
  ? criar({token,organizacaoId,processoId,item})
  : editar({token,organizacaoId,processoId,item});
}
module.exports={salvarItemProcesso,validarItem,chaveDeLinha,publico};
