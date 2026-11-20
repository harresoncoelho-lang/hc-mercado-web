const { chromium } = require('C:/Users/harre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {criarServidor,cenarios}=require('./servir-kit-documentos-local.cjs');
const root=path.resolve(__dirname,'../..'), c=cenarios[0];
const stub=`window.qa={sessao:{user:{id:'${c.userId}'},access_token:'demonstracao-local-ficticia'},callbacks:[],recarga:false,emitir(evento,sessao){this.sessao=sessao;for(const cb of this.callbacks)cb(evento,sessao);}};
window.supabase={createClient(){return {auth:{getSession:async()=>({data:{session:window.qa.sessao}}),onAuthStateChange(cb){window.qa.callbacks.push(cb);return {data:{subscription:{unsubscribe(){}}}}},signOut:async()=>{}},rpc:async()=>({data:'${c.empresa.organizacao_id}',error:null}),from(tabela){const rows={clientes:[{status:'aprovado'}],operacao_empresas:[${JSON.stringify(c.empresa)}],operacao_processos:[${JSON.stringify({...c.processo,objeto:'Processo fictício QA real',status:'preparacao'})}]};let single=false;const q=new Proxy({}, {get(_,key){if(key==='then')return (resolve,reject)=>{if(tabela==='operacao_processos'&&window.qa.recarga){window.qa.liberarRecarga=()=>resolve({data:null,error:{message:'Falha fictícia de recarga'}});return;}return Promise.resolve({data:single?(rows[tabela]||[])[0]:(rows[tabela]||[]),error:null}).then(resolve,reject);};if(key==='maybeSingle'||key==='single')return ()=>{single=true;return q};return ()=>q;}});return q;}}}};`;
async function verificar(){
 const servidor=criarServidor();await new Promise(r=>servidor.listen(0,'127.0.0.1',r));const origem=`http://127.0.0.1:${servidor.address().port}`;
 const browser=await chromium.launch({channel:'msedge',headless:true});const falhas=[];
 const arquivos=new Set(['processos.html','kit-documentos-ui.js','kit-documentos.css','supabase-config.js','operacao-acompanhamento.js','operacao-acompanhamento-ui.js','operacao-edital.js','operacao-relatorio.js']);
 try{
  for(const caso of ['logout','troca-usuario','troca-silenciosa','recarga-pendente-falha','mesmo-usuario','token-refresh']){
   const page=await browser.newPage();let liberar,pronta,concluida,downloads=0;const erros=[];page.on('download',()=>downloads++);page.on('pageerror',e=>erros.push(e.message));
   await page.addInitScript(()=>{
    window.__qaDownloadAttempts=0;const click=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){if(this.download)window.__qaDownloadAttempts++;return click.call(this);};
   });
   await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='cdn.jsdelivr.net')return route.fulfill({contentType:'text/javascript',body:stub});
    if(url.origin!==origem)return route.fulfill({body:'',contentType:'text/plain'});
    if(url.pathname==='/api/kit-documentos'){
     const body=route.request().postDataJSON();if(body.acao==='exportar'){
      const resposta=await route.fetch();await new Promise(r=>{liberar=r;pronta();});await route.fulfill({response:resposta});concluida();return;
     }return route.continue();
    }
    const nome=url.pathname.slice(1);if(arquivos.has(nome)){
     let body=fs.readFileSync(path.join(root,nome));
     if(nome==='kit-documentos-ui.js'){
      // O harness observa a Promise real; a função de exportação continua intacta.
      const listener="() => void executar('exportar')";body=body.toString();assert(body.includes(listener),'listener de exportação deve ser instrumentado');
      body=body.replace(listener,"() => { global.__qaExportacao = executar('exportar'); }");
     }
     return route.fulfill({body,contentType:nome.endsWith('.html')?'text/html':nome.endsWith('.css')?'text/css':'text/javascript'});
    }
    return route.fulfill({status:404,body:''});
   });
   try{
    await page.goto(origem+'/processos.html');await page.locator('[data-processo]').first().click();
    await page.waitForFunction(()=>document.querySelector('[data-contexto]')?.textContent.includes('Aurora'));
    await page.getByLabel('Título da declaração',{exact:true}).fill('Documento fictício');await page.getByLabel('Texto do modelo').fill('Exemplo {{razao_social}}');await page.getByRole('button',{name:'Salvar rascunho',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-preparar]').disabled);await page.getByRole('button',{name:'Preparar prévia'}).click();await page.waitForFunction(()=>!document.querySelector('[data-revisado]').disabled);await page.locator('[data-revisado]').check();await page.waitForFunction(()=>!document.querySelector('[data-exportar]').disabled);
    const chegou=new Promise(r=>pronta=r),terminou=new Promise(r=>concluida=r);await page.getByRole('button',{name:'Baixar DOCX'}).click();await chegou;
    if(caso==='logout')await page.evaluate(()=>window.qa.emitir('SIGNED_OUT',null));
    if(caso==='troca-usuario')await page.evaluate(()=>window.qa.emitir('SIGNED_IN',{user:{id:'outro-usuario-ficticio'},access_token:'outro-token-ficticio'}));
    if(caso==='troca-silenciosa')await page.evaluate(()=>{window.qa.sessao={user:{id:'outro-usuario-ficticio'},access_token:'outro-token-ficticio'};});
    if(caso==='mesmo-usuario'||caso==='token-refresh')await page.evaluate(evento=>window.qa.emitir(evento,{user:{id:window.qa.sessao.user.id},access_token:'token-renovado-ficticio'}),caso==='mesmo-usuario'?'SIGNED_IN':'TOKEN_REFRESHED');
    if(caso==='recarga-pendente-falha'){
     await page.evaluate(()=>{window.qa.recarga=true;document.getElementById('btn-atualizar').click();});await page.waitForFunction(()=>window.qa.liberarRecarga);
     assert.equal(await page.locator('[data-revisado]:checked').count(),0,'revisão deve sumir no início da recarga');
     await page.evaluate(()=>window.qa.liberarRecarga());await page.waitForFunction(()=>document.getElementById('aviso').textContent.includes('Falha fictícia'));
    }
    if(caso==='logout'||caso==='troca-usuario')assert.equal(await page.locator('[data-revisado]:checked').count(),0,'evento de sessão deve invalidar kit imediatamente');
    const positivo=caso==='mesmo-usuario'||caso==='token-refresh',download=positivo?page.waitForEvent('download'):null;
    liberar();await terminou;await page.evaluate(()=>{if(!window.__qaExportacao)throw new Error('Promise de exportação não observada');return window.__qaExportacao;});
    if(positivo){await download;assert.equal(downloads,1,'mesmo usuário pode concluir download');assert.equal(await page.locator('[data-revisado]:checked').count(),1);}
    else{
     assert.equal(await page.evaluate(()=>window.__qaDownloadAttempts),0,caso+': processamento concluído sem iniciar download');
     assert.equal(downloads,0,caso+': resposta da sessão/revisão anterior não pode baixar DOCX');
    }
    assert.deepEqual(erros,[]);
    console.log('processos.html real: '+caso+': OK');
   }catch(e){falhas.push(caso+': '+e.message);console.error(caso+': '+e.message);}finally{liberar?.();await page.close();}
  }
  assert.deepEqual(falhas,[]);
 }finally{await browser.close();servidor.closeAllConnections();await new Promise(r=>servidor.close(r));}
}
if(require.main===module)verificar().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={verificar};
