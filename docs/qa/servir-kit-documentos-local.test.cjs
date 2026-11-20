const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {criarServidor,criarCenarios,criarFetchFicticio}=require('./servir-kit-documentos-local.cjs');
const {LIMITES}=require('../../netlify/functions/_kit_proposta_limites');
function requisicao(port,body,headers={},rota='/api/kit-documentos'){
 return new Promise((resolve,reject)=>{const r=http.request({hostname:'127.0.0.1',port,path:rota,method:body===null?'GET':'POST',headers:{authorization:'Bearer demonstracao-local-ficticia','content-type':'application/json',...headers}},s=>{const partes=[];s.on('data',x=>partes.push(x));s.on('end',()=>{const raw=Buffer.concat(partes).toString();resolve({status:s.statusCode,headers:s.headers,raw,data:raw.startsWith('{')?JSON.parse(raw):null});});});r.on('error',reject);r.end(body===null?undefined:typeof body==='string'?body:JSON.stringify(body));});
}
async function ambiente(t,n){const s=criarServidor({quantidade:n});await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>s.close(r)));return {port:s.address().port,cenarios:criarCenarios(n)};}
for(const n of [51,200,1000])test(`QA loopback ${n}: pagina, salva, reabre, revisa e exporta handler real`,async t=>{
 const {port,cenarios}=await ambiente(t,n),a=cenarios[0],b=cenarios[1],scope={empresaId:a.empresa.id,processoId:a.processo.id};
 const post=async body=>{const r=await requisicao(port,{...scope,...body});assert.equal(r.status,200,r.raw);return r.data;};
 let page=await post({acao:'consultar',itensPaginados:true}),itens=[...page.itens],paginas=1;
 while(page.paginacaoItens.hasMore){page=await post({acao:'listarItens',afterId:page.paginacaoItens.nextCursor});itens.push(...page.itens);paginas++;}
 assert.equal(itens.length,n);assert.equal(new Set(itens.map(i=>i.id)).size,n);assert.equal(paginas,Math.ceil(n/100));
 assert.equal(page.paginacaoItens.nextCursor,null);assert.equal(page.identificacao.status,'confirmado');
 const documentoId='99999999-1111-4111-8111-111111111111';
 const salvo=await post({acao:'salvar',documentoId,versaoEsperada:0,tipo:'proposta',proposta:{itemIds:itens.map(i=>i.id),unidades:Object.fromEntries(itens.map(i=>[i.id,'un'])),validade:'30 dias',prazoEntrega:'10 dias',pagamento:'30 dias'}});
 assert.equal(salvo.documento.versao,1);
 const base={documentoId,versaoEsperada:1};
 assert.equal((await post({acao:'abrir',...base})).documento.dados.proposta.itemIds.length,n);
 assert.equal((await post({acao:'listar'})).documentos.length,1);
 const previa=await post({acao:'preparar',...base});assert.match(previa.previa.texto,new RegExp(`Item ${n} FICTÍCIO`));
 await post({acao:'confirmarRevisao',...base,revisado:true,revisaoHash:previa.revisaoHash});
 assert.equal((await post({acao:'abrir',...base})).revisaoVigente,true);
 const arquivo=await post({acao:'exportar',...base,revisado:true,revisaoHash:previa.revisaoHash});
 assert.equal(Buffer.from(arquivo.arquivoBase64,'base64').subarray(0,2).toString(),'PK');
 const cruzado=await requisicao(port,{acao:'abrir',documentoId,empresaId:b.empresa.id,processoId:b.processo.id});assert.equal(cruzado.status,404);
 const canonical=await requisicao(port,null,{},'/kit-documentos-ui.js');assert.equal(canonical.status,200);assert.match(canonical.raw,/listarItens/);
});
test('nega origem/host/token, limita bytes UTF8 e não aceita rede externa',async t=>{
 const {port,cenarios}=await ambiente(t,51);
 assert.equal((await requisicao(port,{}, {authorization:'Bearer real'})).status,401);
 assert.equal((await requisicao(port,{}, {origin:'https://externo.invalid'})).status,403);
 assert.equal((await requisicao(port,null,{host:'evil.invalid'},'/')).status,403);
 const grande='é'.repeat(Math.floor(LIMITES.envelopeBytes/2)+1);
 assert.equal((await requisicao(port,grande)).status,413);
 const fake=criarFetchFicticio(new Map(),cenarios);
 await assert.rejects(fake('https://externo.invalid',{headers:{Authorization:'Bearer demonstracao-local-ficticia'}}),/Origem externa/);
 await assert.rejects(fake('https://lsqjamqvmrcyrvowndiu.supabase.co/rest/v1/secrets',{headers:{Authorization:'Bearer demonstracao-local-ficticia'}}),/bloqueada/);
 assert.throws(()=>criarServidor({quantidade:1001}));
});
