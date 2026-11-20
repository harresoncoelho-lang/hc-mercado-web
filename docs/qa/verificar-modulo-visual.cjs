const { chromium } = require('C:/Users/harre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const fixture=require('../../netlify/functions/__tests__/fixtures/de81-revisado.json');
const stub = `window.supabase = {
 createClient() {
  const perfil = {id:'11111111-1111-4111-8111-111111111111',nome:'Assessor exemplo',empresa:'Empresa exemplo',cnpj:'11222333000181',status:'aprovado',plano:'assessoria'};
  const session = {user:{id:perfil.id,email:'assessor@example.com'},access_token:'teste-local'};
  const chain = new Proxy({}, {get(_,key) {
   if(key==='then') return resolve => resolve({data:[],error:null,count:0});
   if(key==='maybeSingle'||key==='single') return async()=>({data:perfil,error:null});
   return ()=>chain;
  }});
  return {
   auth:{getSession:async()=>({data:{session}}), getUser:async()=>({data:{user:session.user}}), onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
   from:(table)=>table==='operacao_empresas'?new Proxy({}, {get(_,key){if(key==='then')return resolve=>resolve({data:[{id:'33333333-3333-4333-8333-333333333333',organizacao_id:'33333333-3333-4333-8333-333333333333',razao_social:'Empresa exemplo',cnpj:'11222333000181',ativa:true}],error:null});return ()=>window.supabase.createClient().from(table)}}):chain, rpc:async(nome)=>({data:nome==='bootstrap_operacao'?'33333333-3333-4333-8333-333333333333':[],error:null})
  };
 }
};`;
new (require('node:vm').Script)(stub);
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[],envios=[];let confirmar=0;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*', async route=>{
  const url=new URL(route.request().url()), pathname=url.pathname;
  if(url.hostname==='cdn.jsdelivr.net')return route.fulfill({contentType:'text/javascript',body:stub});
  if(url.hostname!=='qa.licitaplena.test')return route.fulfill({contentType:'application/json',body:'[]'});
  if(pathname==='/api/enviar-resumo-edital'){envios.push(route.request().postDataJSON());return route.fulfill({json:{ok:true,quantidade:1}})}
  if(pathname==='/api/decisao-oportunidade'){
   if(route.request().method()==='GET')return route.fulfill({json:{habilitada:true}});
   const body=route.request().postDataJSON();if(body.acao==='confirmar')confirmar++;
   return route.fulfill({json:body.acao==='listar'?{decisoes:[]}:{empresa:'Empresa exemplo',cnpj:'11222333000181',edital:'11222333000181-1-1/2026',objeto:'Aquisição de materiais',expiraEm:'2026-12-30T18:00:00Z',decisao:body.acao==='confirmar'?body.decisao:null}});
  }
  if(pathname.startsWith('/api/'))return route.fulfill({json:{estrutura:fixture.estrutura,fonteLida:true,itens:[]}});
  const file=path.join(root,pathname.slice(1));
  if(file.startsWith(root+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({body:fs.readFileSync(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]||'text/plain'});
  return route.fulfill({json:[]});
 });
 try {
  await page.goto('https://qa.licitaplena.test/painel.html');
  await page.waitForFunction(()=>window.ContatosResumo && window.__clienteIdAtual);
  assert(await page.locator('#decisoes-clientes-atualizar').count());
  await page.evaluate(()=>document.documentElement.classList.add('tema-claro'));
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('nav button')).color==='rgb(82, 98, 125)');
  await page.screenshot({animations:'disabled',path:path.join(__dirname,'modulo-painel-claro.png')});
  await page.locator('#nav-colapsar-btn').click();assert(await page.locator('nav').evaluate(e=>e.classList.contains('colapsada')));await page.locator('#nav-colapsar-btn').click();
  await page.evaluate(()=>document.documentElement.classList.remove('tema-claro'));
  await page.screenshot({animations:'disabled',path:path.join(__dirname,'modulo-painel-escuro.png')});
  await page.evaluate(f=>{empresaOperacionalId='33333333-3333-4333-8333-333333333333';abrirModalIA({...f.edital,numeroControlePNCP:'11222333000181-1-1/2026'});renderizarEstruturaIA(f.estrutura);bloquearAcoesResumo(false)},fixture);
  await page.waitForFunction(()=>document.querySelector('[data-resumo-secao="Identificação da Licitação"]')?.open);
  const fechadas=await page.locator('[data-resumo-secao]').evaluateAll(es=>es.filter(e=>!e.open).map(e=>e.dataset.resumoSecao));
  assert(fechadas.every(n=>['Conferir complementos e evidências documentais','Consultar itens da oportunidade','Entender a CAPAG e consultar indicadores'].includes(n)),fechadas.join(','));
  await page.screenshot({animations:'disabled',path:path.join(__dirname,'modulo-resumo-aberto.png')});
  await page.locator('#modal-ia-checklist-email').click();
  await page.locator('#modal-enviar-resumo-destino').fill('barbara@example.com');await page.locator('#modal-enviar-resumo-nome').fill('Bárbara');
  await page.locator('#solicitar-decisao-cliente').check();
  await page.locator('#modal-enviar-resumo-confirmar').click();
  await page.waitForFunction(()=>document.getElementById('modal-enviar-resumo-aviso').textContent.includes('sucesso'));
  assert.equal(envios.length,1);assert.equal(envios[0].solicitarDecisao,true);assert.equal(envios[0].empresaId,'33333333-3333-4333-8333-333333333333');
  await page.locator('#modal-enviar-resumo-destino').fill('');await page.locator('#contatos-resumo-busca').fill('barbara');
  await page.getByRole('button',{name:'Bárbara — barbara@example.com',exact:true}).click();assert.equal(await page.locator('#modal-enviar-resumo-destino').inputValue(),'barbara@example.com');
  await page.screenshot({animations:'disabled',path:path.join(__dirname,'modulo-contatos-envio.png')});
  await page.setViewportSize({width:375,height:812});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow mobile');
  assert(await page.locator('#modal-enviar-resumo-confirmar').evaluate(e=>{const r=e.getBoundingClientRect();return r.right<=innerWidth}));
  await page.evaluate(()=>{for(let i=0;i<8;i++)ContatosResumo.registrarEnvio({usuarioId:window.__clienteIdAtual,destinos:`pessoa${i}@example.com`,nome:`Pessoa ${i}`});ContatosResumo.atualizar()});
  await page.locator('#modal-enviar-resumo-confirmar').scrollIntoViewIfNeeded();
  assert(await page.locator('#modal-enviar-resumo-confirmar').evaluate(e=>{const r=e.getBoundingClientRect();return r.bottom<=innerHeight&&r.top>=0}));
  await page.screenshot({animations:'disabled',path:path.join(__dirname,'modulo-contatos-mobile.png')});
  await page.evaluate(()=>{window.__tokenOriginal=obterTokenSessao;obterTokenSessao=()=>new Promise(resolve=>{window.__liberarToken=resolve})});
  await page.locator('#modal-enviar-resumo-confirmar').click();
  await page.waitForFunction(()=>window.__liberarToken);
  await page.evaluate(()=>{empresaOperacionalId='outra-empresa';window.__liberarToken('teste');obterTokenSessao=window.__tokenOriginal});
  await page.waitForFunction(()=>document.getElementById('modal-enviar-resumo-aviso').textContent.includes('mudou durante o envio'));
  assert.equal(envios.length,1,'contexto mudou: não transmitir');
  await page.goto('https://qa.licitaplena.test/responder-oportunidade.html#token='+'a'.repeat(64)+'&escolha=participar');
  await page.locator('#nome').waitFor({state:'visible'});assert.equal(confirmar,0);assert.equal(new URL(page.url()).hash,'');
  await page.locator('#nome').fill('Dedé');await page.locator('#revisado').check();
  await page.screenshot({animations:'disabled',path:path.join(__dirname,'modulo-decisao-cliente.png')});
  await page.locator('#confirmar').click();await page.waitForFunction(()=>document.getElementById('mensagem').textContent.includes('Decisão registrada'));assert.equal(confirmar,1);
  assert.deepEqual(errors,[]);console.log('UI: temas, recolher menu, resumo aberto, envio simulado, contatos, 375px e decisão com confirmação: OK. Nenhuma rede externa ou e-mail real.');
 } catch(e) { console.error({url:page.url(),errors}); await page.screenshot({animations:'disabled',path:path.join(__dirname,"modulo-falha.png")}); throw e; } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
