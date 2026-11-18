const {falhar}=require('./_empresa_identificacao');
const {LIMITES}=require('./_kit_proposta_limites');
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const select='id,organizacao_id,processo_id,tipo,identificador,descricao,quantidade:quantidade::text,valor_unitario_proposta:valor_unitario_proposta::text,marca,modelo,atualizado_em';
function base(org,proc){if(!uuid(org)||!uuid(proc))falhar('Escopo inválido.',400);return `operacao_itens_resultado?processo_id=eq.${proc}&organizacao_id=eq.${org}&select=${select}`;}
function conferir(rows,org,proc){if(!Array.isArray(rows)||rows.some(i=>!uuid(i.id)||i.organizacao_id!==org||i.processo_id!==proc)||new Set(rows.map(i=>i.id)).size!==rows.length)falhar('Item indisponível.',404);}
async function listarPaginaItens({request,organizacaoId,processoId,afterId,limit=100}){
 if(!Number.isInteger(limit)||limit<1||limit>100||(afterId!==undefined&&!uuid(afterId)))falhar('Página inválida.',400);
 const path=base(organizacaoId,processoId)+`&order=id.asc&limit=${limit+1}`+(afterId?`&id=gt.${afterId}`:'');
 const r=await request('/rest/v1/'+path,{headers:{Prefer:'count=exact'}}),rows=await r.json();conferir(rows,organizacaoId,processoId);
 const range=r.headers.get('content-range')||'',m=/^0-(\d+)\/(\d+)$/.exec(range);
 if(!/(?:^|,\s*)count=exact(?:,|$)/.test(r.headers.get('preference-applied')||'')||(!rows.length?range!=='*/0':!m||!Number.isSafeInteger(Number(m[2]))||Number(m[1])!==rows.length-1||rows.length!==Math.min(Number(m[2]),limit+1)))falhar('Não foi possível comprovar a página completa.',503);
 if(rows.some((i,n)=>(afterId&&i.id<=afterId)||(n&&i.id<=rows[n-1].id)))falhar('Ordem de itens inválida.',503);
 const hasMore=rows.length>limit,itens=rows.slice(0,limit);return {itens,hasMore,nextCursor:hasMore?itens.at(-1).id:null};
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
module.exports={listarPaginaItens,carregarItensSelecionados,verificarOrigemSelecionada};
