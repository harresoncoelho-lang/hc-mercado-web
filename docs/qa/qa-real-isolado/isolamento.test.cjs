const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {preparar,QA,criarRuntime,transporteSeguro}=require('./isolamento.cjs');
const config={authUrl:'https://luguscapasskcsficckf.supabase.co',restUrl:'https://luguscapasskcsficckf.supabase.co',storageUrl:'https://luguscapasskcsficckf.supabase.co',publicKey:'sb_publishable_qa_ficticia'};
test('derivação preserva originais; destinos errados negados antes de transporte',async()=>{
 assert.throws(()=>preparar({...config,authUrl:'https://lsqjamqvmrcyrvowndiu.supabase.co'}));
 assert.throws(()=>preparar({...config,storageUrl:'https://outro.supabase.co'}));
 const p=preparar(config);
 for(const f of p.manifesto){assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(p.root,f.path))).digest('hex'),f.originalHash);}
 assert.equal(p.manifesto.filter(x=>x.alterado).length,6);// criar-processo.js adicionado ao conjunto derivado
 let calls=0;const tx=transporteSeguro(config,async()=>{calls++;return new Response('{}');});
 await assert.rejects(tx('https://lsqjamqvmrcyrvowndiu.supabase.co/auth/v1/user'));assert.equal(calls,0);
 await assert.rejects(tx(QA+'/auth/v1/signup'));assert.equal(calls,0);
 await assert.rejects(tx(QA+'/auth/v1/recover'));assert.equal(calls,0);
});
test('redirects e erro com segredo não escapam; handler copiado usa apenas QA',async()=>{
 const p=preparar(config),calls=[];
 const rt=criarRuntime(p,{serviceKey:'SEGREDO-SERVICO',fetchImpl:async(url,op)=>{calls.push({url,redirect:op.redirect});throw Error('SEGREDO-SERVICO');}});
 const r=await rt.executar('kit-documentos',{httpMethod:'POST',headers:{authorization:'Bearer SESSION-PRIVADA'},body:'{}'});
 assert.doesNotMatch(JSON.stringify(r),/SEGREDO|SESSION-PRIVADA/);
 assert.equal(calls.length,1);assert.equal(calls[0].url,QA+'/auth/v1/user');assert.equal(calls[0].redirect,'error');
 const tx=transporteSeguro(config,async()=>new Response('',{status:302,headers:{location:'https://externo.invalid'}}));
 await assert.rejects(tx(QA+'/auth/v1/user'),/Transporte QA indisponível/);
 assert.throws(()=>rt.executar('ia-edital',{}));
});
test('nega segredo como chave pública, resposta excessiva e abort antes de chamada',async()=>{
 for(const publicKey of ['sb_secret_nunca',`e30.${Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')}.abc`])assert.throws(()=>preparar({...config,publicKey}));
 let calls=0;const tx=transporteSeguro(config,async()=>{calls++;return new Response('x',{headers:{'content-length':String(8*1024*1024+1)}});});
 await assert.rejects(tx(QA+'/auth/v1/user',{signal:AbortSignal.abort()}));assert.equal(calls,0);
 await assert.rejects(tx(QA+'/auth/v1/user'));assert.equal(calls,1);
 const streaming=transporteSeguro(config,async()=>new Response(new Uint8Array(8*1024*1024+1)));
 await assert.rejects(streaming(QA+'/auth/v1/user'));
});
test('timeout padrão interrompe transporte que não responde',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const tx=transporteSeguro(config,()=>new Promise(()=>{}));
 const verificacao=assert.rejects(tx(QA+'/auth/v1/user'),/Transporte QA indisponível/);
 t.mock.timers.tick(15000);await verificacao;
});
test('handler derivado percorre Auth, RPC e REST com doubles sem trocar globals',async()=>{
 const {criarFetchFicticio,criarCenarios}=require('../servir-kit-documentos-local.cjs');
 const cenarios=criarCenarios(200),double=criarFetchFicticio(new Map(),cenarios),urls=[],originalFetch=global.fetch;
 const rt=criarRuntime(preparar(config),{serviceKey:'servico-local-ficticio',fetchImpl:(url,op)=>{
  urls.push(url);
  // Somente adaptação do contrato de um double existente; nunca é fetch de rede.
  return double(url.replace(QA,'https://lsqjamqvmrcyrvowndiu.supabase.co'),op);
 }});
 const r=await rt.executar('kit-documentos',{httpMethod:'POST',headers:{authorization:'Bearer demonstracao-local-ficticia'},body:JSON.stringify({acao:'consultar',itensPaginados:true,empresaId:cenarios[0].empresa.id,processoId:cenarios[0].processo.id})});
 assert.equal(r.statusCode,200,r.body);const body=JSON.parse(r.body);
 assert.equal(body.itens.length,100);assert.equal(body.paginacaoItens.hasMore,true);
 assert.ok(urls.some(u=>u.includes('/auth/v1/user')));assert.ok(urls.some(u=>u.includes('/rpc/identificacao_empresa_habilitada')));
 assert.ok(urls.every(u=>u.startsWith(QA+'/')));assert.equal(global.fetch,originalFetch);
});

