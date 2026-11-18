const test=require('node:test'),assert=require('node:assert/strict');
const {listarPaginaItens,carregarItensSelecionados}=require('../netlify/functions/_kit_proposta_itens');
const org='11111111-1111-1111-1111-111111111111',proc='22222222-2222-2222-2222-222222222222';
const id=n=>`33333333-3333-3333-3333-${String(n).padStart(12,'0')}`;
const item=n=>({id:id(n),organizacao_id:org,processo_id:proc});
test('paginação exige total exato e detecta cap, cursor e item intruso',async()=>{
 const base={organizacaoId:org,processoId:proc,limit:2};
 const request=async(path,op)=>{assert.match(path,/order=id.asc/);assert.equal(op.headers.Prefer,'count=exact');return new Response(JSON.stringify([item(1),item(2),item(3)]),{headers:{'Content-Range':'0-2/3','Preference-Applied':'count=exact'}});};
 assert.deepEqual(await listarPaginaItens({...base,request}),{itens:[item(1),item(2)],hasMore:true,nextCursor:id(2)});
 for(const [data,range]of [[[item(1)],'0-0/3'],[[item(1)],'0-0/*'],[[{...item(1),organizacao_id:proc}],'0-0/1']])await assert.rejects(listarPaginaItens({...base,request:async()=>new Response(JSON.stringify(data),{headers:{'Content-Range':range,'Preference-Applied':'count=exact'}})}));
});
test('seleção 101 em lotes50 exige conjunto exato escopo e não aceita truncamento',async()=>{
 let calls=0;const items=Array.from({length:101},(_,i)=>item(i+1));
 const rest=async path=>{calls++;assert.match(path,/organizacao_id=eq./);assert.match(path,/processo_id=eq./);const ids=new URLSearchParams(path.split('?')[1]).get('id').slice(4,-1).split(',');assert.ok(ids.length<=50);return items.filter(i=>ids.includes(i.id));};
 const args={rest,organizacaoId:org,processoId:proc,itemIds:items.map(i=>i.id)};
 assert.equal((await carregarItensSelecionados(args)).length,101);assert.equal(calls,3);
 await assert.rejects(carregarItensSelecionados({...args,rest:async()=>[]}));
 await assert.rejects(carregarItensSelecionados({...args,itemIds:[id(1),id(1)]}));
});
test('51 200 1000 itens preservam DOCX total hash e budget sem truncar',()=>{
 const {preparar,docx}=require('../netlify/functions/_kit_documentos'),Zip=require('adm-zip');
 for(const n of [51,200,1000]){
 const itens=Array.from({length:n},(_,i)=>({...item(i+1),tipo:'item',identificador:String(i+1),descricao:`Material <${i+1}>`,quantidade:'2.000',valor_unitario_proposta:'1.25'}));
 const ctx={userId:'qa',empresa:{razao_social:'Empresa QA',cnpj:'11222333000181'},processo:{numero:'1',orgao:'QA'},perfil:{dados_confirmados:{endereco:'Rua',representante:'Ana',cargo:'Sócia'}},itens};
 const body={tipo:'proposta',proposta:{itemIds:itens.map(i=>i.id),unidades:Object.fromEntries(itens.map(i=>[i.id,'un'])),validade:'30 dias',prazoEntrega:'10 dias',pagamento:'30 dias'}};
 const result=preparar(ctx,body),xml=new Zip(docx(result)).readAsText('word/document.xml');assert.equal((xml.match(/Material &lt;/g)||[]).length,n);assert.ok(xml.includes(`Material &lt;${n}&gt;`));assert.equal(preparar(ctx,body).revisaoHash,result.revisaoHash);
 ctx.itens[n-1].descricao='Mudou';assert.notEqual(preparar(ctx,body).revisaoHash,result.revisaoHash);
 }
});
test('budget UTF8 determinístico limites e excesso de conteúdo são explícitos',()=>{
 const {bytesRascunho,validarBudget}=require('../netlify/functions/_kit_proposta_limites');
 assert.equal(bytesRascunho({itemIds:[id(1)],unidades:{[id(1)]:'ç'},validade:'á',prazoEntrega:'',pagamento:''}),296);
 assert.throws(()=>validarBudget({itemIds:[],validade:'a'.repeat(524288)}));
});
test('origem PNCP alterada bloqueia preparo sem modificar valores ou autorização',async t=>{
 const {verificarOrigemSelecionada}=require('../netlify/functions/_kit_proposta_itens');const before=process.env.IMPORTACAO_PNCP_LOCAL;process.env.IMPORTACAO_PNCP_LOCAL='1';t.after(()=>{if(before===undefined)delete process.env.IMPORTACAO_PNCP_LOCAL;else process.env.IMPORTACAO_PNCP_LOCAL=before;});
 await assert.rejects(verificarOrigemSelecionada({organizacaoId:org,processoId:proc,itemIds:[id(1)],request:async()=>new Response(JSON.stringify([{item_id:id(1),organizacao_id:org,processo_id:proc,estado:'fonte_alterada'}]),{headers:{'Content-Range':'0-0/1','Preference-Applied':'count=exact'}})}),e=>e.status===422);
});
