const {falhar}=require('./_empresa_identificacao');
const {LIMITES}=require('./_kit_proposta_limites');
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const select='id,organizacao_id,processo_id,tipo,identificador,descricao,quantidade:quantidade::text,valor_unitario_proposta:valor_unitario_proposta::text,marca,modelo,atualizado_em';
// Regra 1 da espec.: o select acima entra no revisaoHash e não muda. Colunas novas só na listagem.
const selectLista=select+',unidade,fabricante,custo_unitario:custo_unitario::text,valor_unitario_minimo:valor_unitario_minimo::text,codigo_catalogo,preco_referencia:preco_referencia::text,preco_referencia_em';
function base(org,proc,campos=select){if(!uuid(org)||!uuid(proc))falhar('Escopo inválido.',400);return `operacao_itens_resultado?processo_id=eq.${proc}&organizacao_id=eq.${org}&select=${campos}`;}
// Banco sem operacao_itens_proposta.sql: PostgREST responde coluna inexistente (42703 / PGRST204);
// sem operacao_origens_pncp (01-aplicar.sql), o embed responde relação inexistente (PGRST200).
async function colunaInexistente(r){try{return ['42703','PGRST204','PGRST200'].includes((await r.clone().json())?.code);}catch{return false;}}
function conferir(rows,org,proc){if(!Array.isArray(rows)||rows.some(i=>!uuid(i.id)||i.organizacao_id!==org||i.processo_id!==proc)||new Set(rows.map(i=>i.id)).size!==rows.length)falhar('Item indisponível.',404);}
// request devolve a Response crua (sem lançar em !ok) para detectar o banco antigo.
// Listagem: colunas novas + origem PNCP embutida (a prévia da planilha precisa saber quais itens são protegidos).
const selectListaOrigem=selectLista+',operacao_origens_pncp(item_id)';
// Item com origem PNCP: o embed vem como lista (1:N) ou objeto/null (1:1), conforme a FK.
const origemPncp=l=>Array.isArray(l.operacao_origens_pncp)?l.operacao_origens_pncp.length>0:Boolean(l.operacao_origens_pncp);
// Tentativas da listagem, da mais completa à do banco mais antigo: com numero_ordem (operacao_itens_numero_ordem.sql),
// sem ela (ordem por id), e sem as colunas de preço. Só passa para a próxima quando a coluna não existe.
async function paginaComFallback(pagina){
 const tentativas=[[selectListaOrigem+',numero_ordem:numero_ordem::text',true,true],[selectListaOrigem,true,false],[select,false,false]];
 let r;
 for(const [campos,precoDisponivel,porNumero] of tentativas){
  r=await pagina(campos,porNumero);
  if(r.ok)return {r,precoDisponivel,porNumero};
  if(!await colunaInexistente(r))break;
 }
 falhar('Serviço de documentos indisponível.',r.status===403?403:503);
}
// Ordem de exibição: número do item em ordem natural ("2" antes de "10"), depois id.
const COLLATOR=new Intl.Collator('pt-BR',{numeric:true,sensitivity:'base'});
const ordemItem=(a,b)=>COLLATOR.compare(String(a.identificador??''),String(b.identificador??''))||(a.id<b.id?-1:a.id>b.id?1:0);
// Paginação por (numero_ordem nulls last, id): a 1ª página traz os menores números. Cursor "N:id" ou "-:id"
// (sem número); banco sem a coluna pagina por id e o cursor é o id puro, como antes.
const CURSOR=/^(-|0|[1-9]\d{0,17}):([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i;
function lerCursor(afterId){
 if(afterId===undefined)return null;
 if(uuid(afterId))return {id:afterId};
 const m=typeof afterId==='string'&&CURSOR.exec(afterId);
 if(!m)falhar('Página inválida.',400);
 return {numero:m[1]==='-'?null:m[1],id:m[2]};
}
// Chave de ordenação comparável: número (BigInt, null por último) e depois id.
function compararChave(a,b){
 const na=a.numero??null,nb=b.numero??null;
 if(na!==nb){if(na===null)return 1;if(nb===null)return -1;const x=BigInt(na),y=BigInt(nb);if(x!==y)return x<y?-1:1;}
 return a.id<b.id?-1:a.id>b.id?1:0;
}
function filtroCursor(c,porNumero){
 if(!c)return '';
 if(!porNumero)return `&id=gt.${c.id}`;
 if(c.numero===undefined)falhar('Página inválida. Recarregue a lista.',400);
 return c.numero===null?`&numero_ordem=is.null&id=gt.${c.id}`:`&or=(numero_ordem.gt.${c.numero},numero_ordem.is.null,and(numero_ordem.eq.${c.numero},id.gt.${c.id}))`;
}
async function listarPaginaItens({request,organizacaoId,processoId,afterId,limit=100}){
 if(!Number.isInteger(limit)||limit<1||limit>100)falhar('Página inválida.',400);
 const cursor=lerCursor(afterId);
 const {r,precoDisponivel,porNumero}=await paginaComFallback((campos,porNumero)=>request('/rest/v1/'+base(organizacaoId,processoId,campos)+`&order=${porNumero?'numero_ordem.asc.nullslast,id.asc':'id.asc'}&limit=${limit+1}`+filtroCursor(cursor,porNumero),{headers:{Prefer:'count=exact'}}));
 const rows=await r.json();conferir(rows,organizacaoId,processoId);
 const range=r.headers.get('content-range')||'',m=/^0-(\d+)\/(\d+)$/.exec(range);
 if(!/(?:^|,\s*)count=exact(?:,|$)/.test(r.headers.get('preference-applied')||'')||(!rows.length?range!=='*/0':!m||!Number.isSafeInteger(Number(m[2]))||Number(m[1])!==rows.length-1||rows.length!==Math.min(Number(m[2]),limit+1)))falhar('Não foi possível comprovar a página completa.',503);
 const chave=i=>porNumero?{numero:i.numero_ordem??null,id:i.id}:{id:i.id};
 if(porNumero&&rows.some(i=>i.numero_ordem!=null&&!/^\d{1,18}$/.test(i.numero_ordem)))falhar('Ordem de itens inválida.',503);
 if(rows.some((i,n)=>(cursor&&compararChave(chave(i),cursor)<=0)||(n&&compararChave(chave(i),chave(rows[n-1]))<=0)))falhar('Ordem de itens inválida.',503);
 const hasMore=rows.length>limit,itens=rows.slice(0,limit),ultimo=itens.at(-1);
 // Com numero_ordem a ordem do banco vale entre páginas; só o fim sem número (texto livre) é reordenado na página.
 const ordenados=porNumero?[...itens.filter(i=>i.numero_ordem!=null),...itens.filter(i=>i.numero_ordem==null).sort(ordemItem)]:[...itens].sort(ordemItem);
 const nextCursor=!hasMore?null:porNumero?`${ultimo.numero_ordem??'-'}:${ultimo.id}`:ultimo.id;
 return {itens:ordenados,hasMore,nextCursor,precoDisponivel};
}
async function carregarItensSelecionados({rest,organizacaoId,processoId,itemIds=[]}){
 const path=base(organizacaoId,processoId);
 if(!Array.isArray(itemIds)||itemIds.length>LIMITES.itens||itemIds.some(id=>!uuid(id))||new Set(itemIds.map(id=>id.toLowerCase())).size!==itemIds.length)falhar('Itens selecionados inválidos.',400);
 const ids=itemIds.map(id=>id.toLowerCase()),out=[];
 for(let n=0;n<ids.length;n+=50){const batch=ids.slice(n,n+50),rows=await rest(path+`&id=in.(${batch.join(',')})&order=id.asc&limit=50`);conferir(rows,organizacaoId,processoId);if(rows.length!==batch.length||rows.some(i=>!batch.includes(i.id)))falhar('Item selecionado indisponível. Confira o cadastro.',404);out.push(...rows);}
 return out;
}
async function verificarOrigemSelecionada({request,organizacaoId,processoId,itemIds}) {
 if(process.env.IMPORTACAO_PNCP_LOCAL!=='1')return;
 base(organizacaoId,processoId);
 for(let n=0;n<itemIds.length;n+=50){const ids=itemIds.slice(n,n+50);const response=await request('/rest/v1/operacao_origens_pncp?organizacao_id=eq.'+organizacaoId+'&processo_id=eq.'+processoId+'&item_id=in.('+ids.join(',')+')&select=item_id,organizacao_id,processo_id,estado&limit=50',{headers:{Prefer:'count=exact'}});
 const rows=await response.json(),range=response.headers.get('content-range')||'',match=/^0-(\d+)\/(\d+)$/.exec(range);
 if(!Array.isArray(rows)||response.headers.get('preference-applied')!=='count=exact'||(!rows.length?range!=='*/0':!match||Number(match[1])!==rows.length-1||Number(match[2])!==rows.length))falhar('Origem dos itens incompleta.',503);
 if(!Array.isArray(rows)||rows.some(r=>!ids.includes(r.item_id)||r.organizacao_id!==organizacaoId||r.processo_id!==processoId||!['importado','fonte_alterada'].includes(r.estado)))falhar('Origem dos itens indisponível.',503);
 if(rows.some(r=>r.estado==='fonte_alterada'))falhar('Fonte PNCP alterada. Confira a divergência antes de preparar ou exportar.',422);
 }
}
module.exports={ordemItem,selectLista,origemPncp,colunaInexistente,listarPaginaItens,carregarItensSelecionados,verificarOrigemSelecionada};
