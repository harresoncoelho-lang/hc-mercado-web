const test=require('node:test'),assert=require('node:assert/strict');
const {criarHandler}=require('../netlify/functions/importar-item-pncp');
const emp='11111111-1111-1111-1111-111111111111',org='22222222-2222-2222-2222-222222222222',proc='33333333-3333-3333-3333-333333333333';
function setup(options={}){const calls=[];const c={empresa:{id:emp,organizacao_id:org},rest:async path=>path.startsWith('operacao_membros')?[{usuario_id:'qa',organizacao_id:org,empresa_id:emp,papel:'operador'}]:[{id:proc,empresa_id:emp,organizacao_id:org,url_origem:'https://pncp.gov.br/app/editais/11222333000181/2026/41',origem_externa_id:null,numero:'41'}],request:async(path,op)=>{calls.push({path,op});return new Response(JSON.stringify(path.includes('reservar')?true:{itemId:'internal',estado:options.estado||'importado',versao:1}));}};
const handler=criarHandler({enabled:()=>true,serviceKey:()=> 'FAKE_SERVICE',auth:options.auth||(async()=>({ok:true,userId:'qa'})),contexto:async()=>c,timeoutMs:options.timeoutMs||10000,fetchImpl:async(url,op)=>{calls.push({url,op});if(options.fetch) return options.fetch(url,op);return new Response(JSON.stringify({numeroItem:98,descricao:'Material oficial',quantidade:2,unidadeMedida:'UN',...options.item}),{headers:{'content-type':'application/json'}});}});
const run=async patch=>handler({httpMethod:'POST',headers:{authorization:'Bearer FAKE_USER'},body:JSON.stringify({empresaId:emp,processoId:proc,numeroItem:98,...patch})});return{run,calls,c};}
test('importação usa URLfixa somente seletores, sem preço ofertado e com proveniência',async()=>{const f=setup(),r=await f.run();assert.equal(r.statusCode,200);const source=f.calls.find(x=>x.url);assert.equal(source.url,'https://pncp.gov.br/api/pncp/v1/orgaos/11222333000181/compras/2026/41/itens/98');assert.equal(source.op.redirect,'error');const body=JSON.parse(f.calls.at(-1).op.body);assert.match(body.p_hash,/^[a-f0-9]{64}$/);assert.equal(body.p_item.quantidade,'2');assert.equal(body.p_item.valor_unitario_proposta,undefined);});
test('cliente não fornece objeto oficial ou URL, item divergente não persiste',async()=>{const f=setup();assert.equal((await f.run({item:{descricao:'forjado'}})).statusCode,400);assert.equal(f.calls.length,0);const g=setup({item:{numeroItem:99}});assert.equal((await g.run()).statusCode,502);assert.equal(g.calls.some(x=>x.path?.includes('gravar')),false);});
test('processo estrangeiro e cadência recusada não acessam PNCP',async()=>{const f=setup();f.c.rest=async path=>path.startsWith('operacao_membros')?[]:[];assert.equal((await f.run()).statusCode,403);assert.equal(f.calls.length,0);const g=setup();g.c.request=async()=>new Response(JSON.stringify(false));assert.equal((await g.run()).statusCode,429);assert.equal(g.calls.length,0);});
test('fonte malformada ou quantidade incompatível não persiste; conteúdo não altera origem',async()=>{
 for(const item of [{quantidade:1.2345},{descricao:''},{numeroControlePNCPCompra:'99999999000199-1-41/2026'}]){const f=setup({item});const r=await f.run();assert.ok([422,502].includes(r.statusCode));assert.equal(f.calls.some(x=>x.path?.includes('gravar')),false);}
});
test('ação real da tela envia só seletores, aguarda importação e atualiza cadastro existente',async()=>{
 const fs=require('fs'),vm=require('vm'),html=fs.readFileSync(require('path').join(__dirname,'../processos.html'),'utf8');
 const start=html.indexOf('$("d-conteudo").addEventListener("click",async e=>{'),end=html.indexOf('\n  acompanhamento.vincular()',start);assert.ok(start>0&&end>start);
 let action,refresh=0,opened=0;const f=setup();const process={id:proc,empresa_id:emp},button={dataset:{acompanharItem:'0'},disabled:false};
 const context={Map,Number,JSON,Error,estado:{processos:[process]},itensOficiais:new Map([[proc,{itens:[{numero:98,descricao:'CLIENTE FORJADO'}]}]]),
 $:id=>id==='d-conteudo'?{addEventListener:(_,fn)=>{action=fn;}}:{dataset:{processoId:proc}},
 sb:{auth:{getSession:async()=>({data:{session:{access_token:'FAKE_USER',user:{id:'qa'}}}})}},
 fetch:async(url,op)=>{assert.equal(url,'/api/importar-item-pncp');const payload=JSON.parse(op.body);assert.deepEqual(Object.keys(payload).sort(),['empresaId','numeroItem','processoId']);const r=await f.run(payload);return{ok:r.statusCode===200,json:async()=>JSON.parse(r.body)};},
 carregarTudo:async()=>{refresh++;},aviso:()=>{},abrirDossie:()=>{opened++;}};
 vm.runInNewContext(html.slice(start,end),context);await action({target:{closest:selector=>selector==='[data-acompanhar-item]'?button:null}});
 assert.equal(refresh,1);assert.equal(opened,1);assert.equal(button.disabled,false);
 const persist=JSON.parse(f.calls.at(-1).op.body);assert.equal(persist.p_item.descricao,'Material oficial');
});
test('origem não oficial e processo cruzado não iniciam consulta de dados',async()=>{
 for(const patch of [{url_origem:'https://evil.test/app/editais/11222333000181/2026/41'},{empresa_id:org},{organizacao_id:emp}]){
 const f=setup(),rest=f.c.rest;f.c.rest=async path=>{const values=await rest(path);return path.startsWith('operacao_processos')?values.map(v=>({...v,...patch})):values;};
 assert.ok([409,404].includes((await f.run()).statusCode));assert.equal(f.calls.length,0);
 }
});
test('HTTP timeout redirect e resposta excessiva falham sem persistência',async()=>{
 const variants=[async()=>new Response('erro',{status:503}),async()=>Response.redirect('https://evil.test'),async()=>new Response('x'.repeat(131073)),async(_,op)=>new Promise((_,reject)=>op.signal.addEventListener('abort',()=>reject(Error('tempo SECRET'))))];
 for(const fetch of variants){const f=setup({fetch,timeoutMs:5});const r=await f.run();assert.ok([502,503].includes(r.statusCode));assert.equal(f.calls.some(x=>x.path?.includes('gravar')),false);assert.equal(r.body.includes('SECRET'),false);}
});
test('fonte alterada é relatada sem mandar campos de oferta para escrita',async()=>{
 const f=setup({estado:'fonte_alterada',item:{valorUnitarioEstimado:999999,marca:'IGNORAR'}}),r=await f.run();assert.equal(r.statusCode,200);assert.match(JSON.parse(r.body).mensagem,/Oferta e conteúdo anterior preservados/);
 const p=JSON.parse(f.calls.at(-1).op.body);assert.equal('marca' in p.p_item,false);assert.equal('valor_unitario_proposta' in p.p_item,false);
});
test('conflito da RPC mantém409 com orientação fixa sem revelar SQL',async()=>{
 const r=await setup({estado:'colisao_manual'}).run();assert.equal(r.statusCode,409);assert.match(JSON.parse(r.body).erro,/revise o vínculo/);assert.equal(r.body.includes('SECRET'),false);
});

test('revogação ou troca de usuário após fonte impede gravação final',async()=>{for(const swapped of [false,true]){let n=0;const f=setup({auth:async()=>++n===1?{ok:true,userId:'qa'}:swapped?{ok:true,userId:'outra'}:{ok:false,status:401,erro:'revogada'}});const r=await f.run();assert.equal(r.statusCode,swapped?403:401);assert.equal(f.calls.some(x=>x.path?.includes('gravar')),false);}});
test('lexema original inexato e chaves ambíguas negados sem gravar',async()=>{for(const value of ['1.00000000000000001','123456789012.125001']){const f=setup({fetch:async()=>new Response('{"numeroItem":98,"descricao":"Fictício","unidadeMedida":"UN","quantidade":'+value+'}')});assert.equal((await f.run()).statusCode,422);assert.equal(f.calls.some(x=>x.path?.includes('gravar')),false);}});
test('erro de stream não gera rejeição não tratada no cancel',async()=>{const f=setup({timeoutMs:5,fetch:async(_,op)=>new Response(new ReadableStream({start(c){op.signal.addEventListener('abort',()=>c.error(Error('stream abortado')));}}))});assert.equal((await f.run()).statusCode,503);await new Promise(r=>setTimeout(r,15));});

test('scanner distingue raiz, strings escapadas e números exatos; preserva texto fonte',async()=>{
 const texto=String.raw`{"numeroItem":98,"descricao":"texto \"quantidade\":99","unidadeMedida":"UN","nested":[{"quantidade":1.00000000000000001}],"quantid\u0061de":123456789012.125}`;
 // Escaped property is a decoded root key, not a nested/string match.
 const f=setup({fetch:async()=>new Response(texto)});assert.equal((await f.run()).statusCode,200);
 const p=JSON.parse(f.calls.at(-1).op.body);assert.equal(p.p_item.quantidade,'123456789012.125');assert.equal(p.p_snapshot.textoOriginal,texto);
});
test('duplicatas decodificadas, profundidade excessiva e tipos quantitativos ambíguos negados',async()=>{
 const base='"numeroItem":98,"descricao":"Fictício","unidadeMedida":"UN",';
 const cases=[['{"quantidade":1,"quantid\\u0061de":2,'+base.slice(0,-1)+'}',502],['{'+base+'"quantidade":2,"extra":{"a":1,"a":2}}',502],['{'+base+'"quantidade":2,"extra":'+'['.repeat(66)+'0'+']'.repeat(66)+'}',502],...['"2"','2e0','0','-1','1.2345'].map(q=>['{'+base+'"quantidade":'+q+'}',422])];
 for(const [texto,status] of cases){const f=setup({fetch:async()=>new Response(texto)});assert.equal((await f.run()).statusCode,status,texto);assert.equal(f.calls.some(x=>x.path?.includes('gravar')),false);}
});

test('hash normalizado mantém identidade legada e distingue mudança real',async()=>{
 const {createHash}=require('node:crypto');let previous;
 for(const q of ['2','2.000','123456789012.125','0.010']){
  const texto='{"numeroItem":98,"descricao":"Fictício","unidadeMedida":"UN","quantidade":'+q+'}';
  const f=setup({fetch:async()=>new Response(texto)});assert.equal((await f.run()).statusCode,200);
  const p=JSON.parse(f.calls.at(-1).op.body),raw=JSON.parse(texto);
  const legado={compra:p.p_compra,item:{numero:98,descricao:'Fictício',quantidade:String(raw.quantidade),unidade:'UN'},raw};
  assert.equal(p.p_hash,createHash('sha256').update(JSON.stringify(legado)).digest('hex'));
  assert.equal(p.p_snapshot.textoOriginal,texto);
  if(q==='2')previous=p.p_hash;
  if(q==='2.000')assert.equal(p.p_hash,previous);
  if(q==='123456789012.125')assert.notEqual(p.p_hash,previous);
 }
});
