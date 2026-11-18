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
const {selectLista,colunaInexistente}=require('./_kit_proposta_itens');
const {randomUUID}=require('node:crypto');
const planilha=require('../../planilha-itens.js');
const URL='https://lsqjamqvmrcyrvowndiu.supabase.co';
const ANON='sb_publishable_yH695cc52QUKYfFEgV5RwQ_0a8GLIeb';
const CAMPOS=['id','tipo','identificador','descricao','quantidade','valorUnitario','marca','modelo'];
const MODOS=['criar','editar'];
const SELECT='id,organizacao_id,processo_id,tipo,identificador,descricao,quantidade:quantidade::text,valor_unitario_proposta:valor_unitario_proposta::text,marca,modelo,atualizado_em';
// eslint-disable-next-line no-control-regex -- sanitizador: rejeitar caracteres de controle é o objetivo da regex
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

// ---------- Preços por item, premissas, referência e planilha (espec. dezembro, seções 3 e 4) ----------
// Regra 1 da espec.: custo, mínimo, referência e premissas NUNCA tocam atualizado_em (nem do item, nem do processo):
// os dois entram no revisaoHash do kit, e a proposta revisada precisa continuar válida.
const INDISPONIVEL='Preços por item ainda não estão disponíveis neste ambiente. Peça para aplicar a atualização do banco.';
const PROPOSTA=['descricao','quantidade','valorUnitario','marca','modelo'];
const PREMISSAS={tributos:'tributos_percentual',garantia:'garantia_percentual',margem:'margem_percentual',margemMinima:'margem_minima_percentual',frete:'frete'};
const escalado=(t,c)=>{const [i,f='']=String(t).split('.');return BigInt(i+f.padEnd(c,'0'));};
function publicoPreco(l){return {...publico(l),unidade:l.unidade??null,fabricante:l.fabricante??null,custoUnitario:l.custo_unitario??null,valorUnitarioMinimo:l.valor_unitario_minimo??null,codigoCatalogo:l.codigo_catalogo??null,precoReferencia:l.preco_referencia??null,precoReferenciaEm:l.preco_referencia_em??null};}
async function exigirOk(r){
 if(r.ok)return r.json();
 if(await colunaInexistente(r))falhar(INDISPONIVEL,503);
 if(r.status===401||r.status===403)falhar('Acesso não autorizado.',403);
 if(r.status===409)falhar('Já existe item com este identificador neste processo.',409);
 falhar('Serviço de itens indisponível.',503);
}
function escopo(organizacaoId,processoId,itemId){
 if(!uuid(organizacaoId)||!uuid(processoId))falhar('Escopo inválido.',400);
 if(itemId!==undefined&&!uuid(itemId))falhar('Identificador de item inválido.',400);
}
function exigirChaves(body,chaves){if(chaves.some(k=>!Object.hasOwn(body,k)))falhar(`Informe ${chaves.join(', ')} (null para limpar).`,400);}
const opcional=(v,escala,rotulo)=>v===null?null:valorDecimal(v,escala,rotulo);
const caminhoItem=(itemId,organizacaoId,processoId)=>`/rest/v1/operacao_itens_resultado?id=eq.${itemId}&processo_id=eq.${processoId}&organizacao_id=eq.${organizacaoId}`;
async function patchItem(token,organizacaoId,processoId,itemId,dados,filtro=''){
 const linhas=await exigirOk(await rest(token,caminhoItem(itemId,organizacaoId,processoId)+filtro+'&select='+selectLista,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(dados)}));
 if(!Array.isArray(linhas)||linhas.length>1)falhar('Serviço de itens indisponível.',503);
 if(linhas.length)conferirLinha(linhas[0],organizacaoId,processoId);
 return linhas[0]||null;
}

async function salvarPrecoItem({token,organizacaoId,processoId,body}){
 escopo(organizacaoId,processoId,body.itemId);exigirChaves(body,['custoUnitario','valorUnitarioMinimo']);
 const custo=opcional(body.custoUnitario,2,'Custo unitário'),minimo=opcional(body.valorUnitarioMinimo,2,'Preço mínimo');
 const atuais=await exigirOk(await rest(token,caminhoItem(body.itemId,organizacaoId,processoId)+'&select='+selectLista));
 if(!Array.isArray(atuais)||atuais.length!==1)falhar('Item indisponível.',404);
 conferirLinha(atuais[0],organizacaoId,processoId);
 const valor=atuais[0].valor_unitario_proposta;
 if(minimo&&valor!=null&&minimo.n>escalado(valor,2))falhar('O preço mínimo não pode ser maior que o valor unitário da proposta.',422);
 // O filtro repete a regra no PATCH: valor alterado entre a leitura e a gravação não passa.
 const guarda=minimo?`&or=(valor_unitario_proposta.is.null,valor_unitario_proposta.gte.${minimo.texto})`:'';
 const l=await patchItem(token,organizacaoId,processoId,body.itemId,{custo_unitario:custo?.texto??null,valor_unitario_minimo:minimo?.texto??null},guarda);
 if(!l)falhar('O item mudou enquanto você editava. Atualize e tente de novo.',409);
 return {status:200,body:{item:publicoPreco(l)}};
}

async function salvarReferencia({token,organizacaoId,processoId,body}){
 escopo(organizacaoId,processoId,body.itemId);exigirChaves(body,['preco','em']);
 if((body.preco===null)!==(body.em===null))falhar('Informe preço e data da referência juntos (ou os dois null para limpar).',400);
 const preco=opcional(body.preco,4,'Preço de referência');
 const em=body.em===null?null:Date.parse(body.em);
 if(em!==null&&(typeof body.em!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(body.em)||!Number.isFinite(em)||em>Date.now()+300000))falhar('Data da referência inválida.',400);
 const l=await patchItem(token,organizacaoId,processoId,body.itemId,{preco_referencia:preco?.texto??null,preco_referencia_em:body.em});
 if(!l)falhar('Item indisponível.',404);
 return {status:200,body:{item:publicoPreco(l)}};
}

// Percentual de 0 a 99,999 (numeric(7,3)); frete >= 0 (numeric(15,2)). null limpa.
function premissa(v,chave){
 if(v===null)return null;
 const ok=chave==='frete'?/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/:/^(?:0|[1-9]\d?)(?:\.\d{1,3})?$/;
 if(typeof v!=='string'||!ok.test(v))falhar(chave==='frete'?'Frete inválido. Use número de 0 em diante, com até 2 casas.':`Percentual inválido (${chave}). Use de 0 a 99.999, com até 3 casas.`,400);
 return v;
}
async function salvarPremissas({token,organizacaoId,processoId,empresaId,body}){
 escopo(organizacaoId,processoId);if(!uuid(empresaId))falhar('Escopo inválido.',400);exigirChaves(body,Object.keys(PREMISSAS));
 const v=Object.fromEntries(Object.keys(PREMISSAS).map(k=>[k,premissa(body[k],k)]));
 if(v.margemMinima!==null&&(v.margem===null||escalado(v.margemMinima,3)>escalado(v.margem,3)))falhar('A margem mínima não pode ser maior que a margem desejada.',422);
 const select=Object.values(PREMISSAS).map(c=>`${c}:${c}::text`).join(',');
 const dados=Object.fromEntries(Object.entries(PREMISSAS).map(([k,c])=>[c,v[k]]));
 const linhas=await exigirOk(await rest(token,`/rest/v1/operacao_processos?id=eq.${processoId}&empresa_id=eq.${empresaId}&organizacao_id=eq.${organizacaoId}&select=${select}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(dados)}));
 if(!Array.isArray(linhas)||linhas.length!==1)falhar('Processo indisponível.',404);
 return {status:200,body:{premissas:Object.fromEntries(Object.entries(PREMISSAS).map(([k,c])=>[k,linhas[0][c]??null]))}};
}

// Planilha: 1 GET (itens + origem PNCP embutida) + 1 POST em lote. Tudo ou nada.
// shortcut: edição concorrente entre o GET e o POST é sobrescrita pela planilha; trocar por RPC com versão se virar problema.
async function lerItensAtuais(token,organizacaoId,processoId){
 const r=await rest(token,`/rest/v1/operacao_itens_resultado?processo_id=eq.${processoId}&organizacao_id=eq.${organizacaoId}&tipo=eq.item&select=${selectLista},operacao_origens_pncp(item_id)&order=id.asc`,{headers:{Prefer:'count=exact'}});
 const rows=await exigirOk(r);
 const total=/\/(\d+)$/.exec(r.headers.get('content-range')||'');
 if(!Array.isArray(rows)||!total||Number(total[1])!==rows.length)falhar('Não foi possível conferir todos os itens do processo.',503);
 for(const l of rows)conferirLinha(l,organizacaoId,processoId);
 return rows;
}
function linhaGravacao(l,atual,organizacaoId,processoId,agora){
 const d=l.dados,id=atual?.id||randomUUID();
 // Revalida no contrato do servidor, mas grava os valores da planilha/banco sem normalizar: campo intocado fica igual.
 validarItem({id,identificador:d.identificador,descricao:d.descricao,quantidade:d.quantidade,valorUnitario:d.valorUnitario,marca:d.marca||null,modelo:d.modelo||null});
 const minimo=d.valorUnitarioMinimo?valorDecimal(d.valorUnitarioMinimo,2,'Preço mínimo'):null;
 if(minimo&&minimo.n>escalado(d.valorUnitario,2))falhar('O preço mínimo não pode ser maior que o valor unitário da proposta.',422);
 const renovar=!atual||PROPOSTA.some(k=>Object.hasOwn(l.mudancas,k));
 return {id,organizacao_id:organizacaoId,processo_id:processoId,tipo:'item',identificador:d.identificador,descricao:d.descricao,quantidade:d.quantidade,valor_unitario_proposta:d.valorUnitario,marca:d.marca||null,modelo:d.modelo||null,unidade:d.unidade||null,fabricante:d.fabricante||null,valor_unitario_minimo:d.valorUnitarioMinimo||null,atualizado_em:renovar?agora:atual.atualizado_em};
}
async function importarPlanilha({token,organizacaoId,processoId,body}){
 escopo(organizacaoId,processoId);
 if(typeof body.texto!=='string')falhar('Envie o conteúdo da planilha.',400);
 const lida=planilha.lerCsv(body.texto);
 if(!lida.ok)return {status:422,body:{erro:'Confira a planilha. Nada foi gravado.',erros:lida.erros}};
 const rows=await lerItensAtuais(token,organizacaoId,processoId);
 const porIdentificador=new Map(rows.map(l=>[l.identificador,l]));
 const origem=l=>Array.isArray(l.operacao_origens_pncp)?l.operacao_origens_pncp.length>0:Boolean(l.operacao_origens_pncp);
 const v=planilha.validarLinhas(lida.linhas,rows.map(l=>({...publicoPreco(l),origemPncp:origem(l)})));
 const erros=[...v.erros],gravar=[],agora=new Date().toISOString();
 for(const l of v.linhas){
  if(l.estado!=='novo'&&l.estado!=='alterado')continue;
  try{gravar.push(linhaGravacao(l,porIdentificador.get(l.item),organizacaoId,processoId,agora));}
  catch(e){erros.push(`Linha ${l.linha} (item ${l.item}): ${e.message}`);}
 }
 const linhas=v.linhas.map(({linha,item,estado,mensagens})=>({linha,item,estado,mensagens}));
 if(!v.linhas.length)erros.push('A planilha não tem linhas de itens.');
 if(erros.length)return {status:422,body:{erro:'A planilha tem erros. Nada foi gravado.',erros,resumo:v.resumo,linhas}};
 if(!gravar.length)return {status:200,body:{gravados:0,resumo:v.resumo,linhas,itens:[]}};
 const salvos=await exigirOk(await rest(token,'/rest/v1/operacao_itens_resultado?on_conflict=processo_id,tipo,identificador&select='+selectLista,{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify(gravar)}));
 if(!Array.isArray(salvos)||salvos.length!==gravar.length)falhar('Serviço de itens indisponível.',503);
 for(const l of salvos)conferirLinha(l,organizacaoId,processoId);
 return {status:200,body:{gravados:salvos.length,resumo:v.resumo,linhas,itens:salvos.map(publicoPreco)}};
}
module.exports={rest,salvarItemProcesso,validarItem,chaveDeLinha,publico,publicoPreco,salvarPrecoItem,salvarReferencia,salvarPremissas,importarPlanilha};
