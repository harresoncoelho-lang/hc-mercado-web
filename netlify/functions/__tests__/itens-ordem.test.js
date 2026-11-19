const test=require('node:test');
const assert=require('node:assert/strict');
const {listarPaginaItens,ordemItem}=require('../_kit_proposta_itens');
// B4 (teste ponta a ponta 18/11): itens apareciam 2, 4, 3, 1 porque a lista ordenava pelo id (uuid aleatório).
const org='44444444-4444-4444-4444-444444444444',proc='22222222-2222-2222-2222-222222222222';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function request(rows){return async()=>new Response(JSON.stringify(rows),{headers:{'Content-Range':`0-${rows.length-1}/${rows.length}`,'Preference-Applied':'count=exact'}});}
test('página sai pelo número do item em ordem natural; cursor segue o maior id',async()=>{
 const rows=[['2',1],['10',2],['1',3],['4',4],['3',5]].map(([identificador,n])=>({id:id(n),organizacao_id:org,processo_id:proc,identificador}));
 const r=await listarPaginaItens({request:request(rows),organizacaoId:org,processoId:proc,limit:4});
 assert.deepEqual(r.itens.map(i=>i.identificador),['1','2','4','10']);
 assert.equal(r.hasMore,true);
 assert.equal(r.nextCursor,id(4));
});
test('identificador igual desempata pelo id; texto não numérico também ordena',()=>{
 const l=[{identificador:'Lote 2',id:'b'},{identificador:'1',id:'z'},{identificador:'1',id:'a'},{identificador:'Lote 10',id:'c'}];
 assert.deepEqual(l.sort(ordemItem).map(i=>i.identificador+i.id),['1a','1z','Lote 2b','Lote 10c']);
});
