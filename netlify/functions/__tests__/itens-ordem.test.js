const test=require('node:test');
const assert=require('node:assert/strict');
const {listarPaginaItens,ordemItem}=require('../_kit_proposta_itens');
// B4 (teste ponta a ponta 18/11): itens apareciam 2, 4, 3, 1 porque a lista ordenava pelo id (uuid aleatório).
// Com mais de 100 itens a 1ª página nem trazia o item 1: a paginação agora é por (numero_ordem nulls last, id).
const org='44444444-4444-4444-4444-444444444444',proc='22222222-2222-2222-2222-222222222222';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const resp=rows=>new Response(JSON.stringify(rows),{headers:{'Content-Range':rows.length?`0-${rows.length-1}/${rows.length}`:'*/0','Preference-Applied':'count=exact'}});
const linha=(identificador,n)=>({id:id(n),organizacao_id:org,processo_id:proc,identificador,numero_ordem:/^\d{1,18}$/.test(identificador)?String(BigInt(identificador)):null});
// PostgREST mínimo: ordena por (numero_ordem nulls last, id) e aplica o filtro do cursor.
function banco(rows){
 const chamadas=[];
 const chave=r=>[r.numero_ordem===null?Infinity:Number(r.numero_ordem),r.id];
 const cmp=(a,b)=>{const [x,i]=chave(a),[y,j]=chave(b);return x!==y?(x<y?-1:1):(i<j?-1:i>j?1:0);};
 const request=async path=>{
  chamadas.push(path);const q=new URLSearchParams(path.split('?')[1]);
  assert.equal(q.get('order'),'numero_ordem.asc.nullslast,id.asc');
  let sel=[...rows].sort(cmp);
  const or=q.get('or'),nulo=q.get('numero_ordem'),gt=q.get('id');
  if(or){const [,n,i]=/^\(numero_ordem\.gt\.(\d+),numero_ordem\.is\.null,and\(numero_ordem\.eq\.\1,id\.gt\.([0-9a-f-]+)\)\)$/.exec(or);sel=sel.filter(r=>cmp(r,{numero_ordem:n,id:i})>0);}
  else if(nulo==='is.null')sel=sel.filter(r=>r.numero_ordem===null&&r.id>gt.slice(3));
  return resp(sel.slice(0,Number(q.get('limit'))));
 };
 return {request,chamadas};
}
async function todas(rows,limit){
 const {request,chamadas}=banco(rows);const paginas=[];let afterId;
 do{const r=await listarPaginaItens({request,organizacaoId:org,processoId:proc,afterId,limit});paginas.push(r.itens.map(i=>i.identificador));afterId=r.nextCursor||undefined;}while(afterId);
 return {paginas,chamadas};
}
test('1ª página começa no item 1 mesmo com ids fora de ordem; cursor estável até o fim, texto livre por último',async()=>{
 // ids decrescentes em relação ao número: paginar por id traria 150..51 primeiro.
 const rows=Array.from({length:150},(_,k)=>linha(String(k+1),1000-k));
 rows.push(linha('Lote 2',5),linha('Lote 10',4),linha('007',3));
 const {paginas}=await todas(rows,100);
 assert.equal(paginas.length,2);
 assert.deepEqual(paginas[0].slice(0,8),['1','2','3','4','5','6','007','7']);
 assert.equal(paginas[0].length,100);
 const tudo=paginas.flat();
 assert.equal(tudo.length,153);assert.equal(new Set(tudo).size,153);
 assert.deepEqual(tudo.slice(-3),['150','Lote 2','Lote 10']);
});
test('cursor no meio do fim sem número continua só nos sem número',async()=>{
 const rows=[linha('2',9),linha('A',1),linha('B',2),linha('C',3)];
 const {paginas,chamadas}=await todas(rows,2);
 assert.deepEqual(paginas,[['2','A'],['B','C']]);
 assert.match(chamadas[1],/numero_ordem=is\.null&id=gt\./);
});
test('cursor inválido ou id puro com a coluna disponível é recusado; página fora da ordem também',async()=>{
 const {request}=banco([linha('1',1)]);
 for(const afterId of ['x:'+id(1),'1:abc','01:'+id(1),id(1)])await assert.rejects(listarPaginaItens({request,organizacaoId:org,processoId:proc,afterId}),{status:400});
 const fora=async()=>resp([linha('2',1),linha('1',2)]);
 await assert.rejects(listarPaginaItens({request:fora,organizacaoId:org,processoId:proc}),{status:503});
});
test('banco sem numero_ordem: volta à paginação por id com cursor id puro e preço disponível',async()=>{
 const caminhos=[];
 const request=async path=>{caminhos.push(path);
  if(path.includes('numero_ordem'))return new Response(JSON.stringify({code:'42703'}),{status:400});
  assert.match(path,/order=id\.asc/);
  return resp([['2',1],['10',2],['1',3],['4',4],['3',5]].map(([identificador,n])=>({id:id(n),organizacao_id:org,processo_id:proc,identificador})));};
 const r=await listarPaginaItens({request,organizacaoId:org,processoId:proc,limit:4});
 assert.deepEqual(r.itens.map(i=>i.identificador),['1','2','4','10']);
 assert.equal(r.nextCursor,id(4));assert.equal(r.precoDisponivel,true);assert.equal(caminhos.length,2);
});
test('identificador igual desempata pelo id; texto não numérico também ordena',()=>{
 const l=[{identificador:'Lote 2',id:'b'},{identificador:'1',id:'z'},{identificador:'1',id:'a'},{identificador:'Lote 10',id:'c'}];
 assert.deepEqual(l.sort(ordemItem).map(i=>i.identificador+i.id),['1a','1z','Lote 2b','Lote 10c']);
});
