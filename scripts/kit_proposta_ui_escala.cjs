const {chromium}=require('C:/Users/harre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),path=require('node:path');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage();await page.route('**/*',r=>r.abort());await page.setContent('<div id="kit"></div>');await page.addScriptTag({path:path.resolve('kit-documentos-ui.js')});
 await page.evaluate(()=>{globalThis.saved=null; let sequence=0; globalThis.crypto.randomUUID=()=>`99999999-9999-9999-9999-${String(++sequence).padStart(12,"0")}`;const id=n=>`33333333-3333-3333-3333-${String(n).padStart(12,'0')}`;
 const itens=Array.from({length:200},(_,i)=>({id:id(i+1),tipo:'item',identificador:String(i+1),descricao:'Material QA',quantidade:'2.000',valorUnitario:'1.25'}));
 LicitaKitDocumentos.montar({alvo:document.querySelector('#kit'),contexto:{empresaId:'empresa',processoId:'processo'},obterSessao:async()=>({userId:'qa',accessToken:'FAKE'}),requisitar:async(_,op)=>{
 const b=JSON.parse(op.body);let data;
 if(b.acao==='listar')data={documentos:[]};
 else if(b.acao==='abrir'){data={documento:{id:globalThis.saved.documentoId,empresaId:'empresa',processoId:'processo',tipo:'proposta',versao:1,dados:{proposta:globalThis.saved.proposta}},itensNaoVerificados:true};}
 else if(b.acao==='salvar'){globalThis.saved=b;data={documento:{id:b.documentoId,empresaId:'empresa',processoId:'processo',tipo:'proposta',versao:1,dados:{proposta:b.proposta}}};}
 else {const start=b.afterId?100:0;data={empresa:{razaoSocial:'QA',cnpj:'11222333000181'},processo:{numero:'1',orgao:'QA'},pendencias:[],itens:itens.slice(start,start+100),paginacaoItens:{hasMore:start===0,nextCursor:start===0?id(100):null},limitesProposta:{itens:1000}};}
 return {ok:true,json:async()=>data};}});});
 await page.locator('[data-novo="proposta"]').click();await page.locator('[data-item]').first().check();await page.locator('input[name^="unidade-"]').first().fill('caixa');
 await page.locator('[data-itens-proxima]').click();await page.waitForFunction(()=>document.querySelector('[data-item]').value.endsWith('000000000101'));
 await page.locator('[data-novo="declaracao"]').click();assert.equal(await page.locator('[data-descarte]').isVisible(),true);assert.equal(await page.locator('select[name=tipo]').inputValue(),'proposta');await page.locator('[data-cancelar-troca]').click();
 await page.locator('[data-item]').first().check();await page.locator('input[name^="unidade-"]').first().fill('un');
 await page.locator('[data-itens-anterior]').click();await page.waitForFunction(()=>document.querySelector('[data-item]').value.endsWith('000000000001'));
 assert.equal(await page.locator('[data-item]').first().isChecked(),true);assert.equal(await page.locator('input[name^="unidade-"]').first().inputValue(),'caixa');
 await page.locator('[data-ver-selecionados]').click();assert.equal(await page.locator('[data-item]').count(),2);
 await page.locator('[data-salvar]').click();await page.waitForFunction(()=>globalThis.saved);const saved=await page.evaluate(()=>globalThis.saved);assert.equal(saved.proposta.itemIds.length,2);assert.equal(Object.values(saved.proposta.unidades).join(','),'caixa,un');
 await page.locator('[data-abrir]').first().click();await page.waitForFunction(()=>document.querySelector('[data-aviso]').textContent.includes('não foi possível conferir'));assert.equal(await page.locator('[data-item]:checked').count(),2);
 console.log('PASS UI real headless: pagina1→2→1, unidades, visão selecionados e salvar preservam conjunto; zero rede.');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

