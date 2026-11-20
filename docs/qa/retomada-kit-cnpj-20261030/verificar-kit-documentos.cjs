const { chromium } = require('C:/Users/harre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const AdmZip = require('adm-zip');
const { criarServidor } = require('./servir-kit-documentos-local.cjs');
async function verificar() {
 const servidor=criarServidor(); await new Promise(r=>servidor.listen(0,'127.0.0.1',r));
 const origem=`http://127.0.0.1:${servidor.address().port}`;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:950},acceptDownloads:true});
 let downloads=0;page.on('download',()=>downloads++);const erros=[],externas=[];page.on('pageerror',e=>erros.push(e.message));
 await page.route('**/*',route=>{if(new URL(route.request().url()).origin!==origem){externas.push(route.request().url());return route.abort();}return route.continue();});
 let atrasar=false,liberar,avisarPronta,avisarConcluida;
 await page.route('**/api/kit-documentos',async route=>{
  const body=route.request().postDataJSON();
  if(atrasar===body.acao){atrasar=false;const resposta=await route.fetch();await new Promise(r=>{liberar=r;avisarPronta();});await route.fulfill({response:resposta});avisarConcluida();return;}
  return route.continue();
 });
 const previa=page.locator('[data-previa]'),baixar=page.getByRole('button',{name:'Baixar DOCX'}),revisar=page.locator('[data-revisado]');
 async function preencher(){await page.getByRole('button',{name:'Preencher exemplo fictício'}).click();assert.equal(await revisar.isChecked(),false);}
 async function preparar(){await page.getByRole('button',{name:'Preparar prévia'}).click();await revisar.waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('[data-revisado]').disabled);}
 try{
  await page.goto(origem);await page.waitForFunction(()=>document.querySelector('[data-contexto]').textContent.includes('Aurora'));
  assert.equal((await fetch(origem+'/.git/config')).status,404);
  assert.equal((await fetch(origem+'/package.json')).status,404);
  assert(await baixar.isDisabled());await preencher();await preparar();
  assert((await previa.textContent()).includes('00000000000100'));assert(await baixar.isDisabled());
  await revisar.focus();await page.keyboard.press('Space');assert(await baixar.isEnabled());
  const downloadPromise=page.waitForEvent('download');await baixar.click();const download=await downloadPromise;
  const destino=path.join(__dirname,'kit-exemplo-ficticio.docx');await download.saveAs(destino);
  const xml=new AdmZip(fs.readFileSync(destino)).readAsText('word/document.xml');assert(xml.includes('Aurora'));assert(!xml.includes('Horizonte'));
  await page.screenshot({path:path.join(__dirname,'kit-escuro.png'),fullPage:true});
  await page.getByLabel('Referência informada pelo usuário').fill('Anexo fictício');assert(await baixar.isDisabled());assert.equal(await revisar.isChecked(),false);
  await preparar();await revisar.check();await page.getByLabel('Tipo de documento').selectOption('proposta');assert(await baixar.isDisabled());
  assert((await page.locator('[data-itens]').textContent()).includes('Quantidade: 2,000 · Unitário ofertado: R$ 12,50'));assert((await page.locator('[data-contexto]').textContent()).includes('00.000.000/0001-00'));await page.locator('[data-item]').check();await page.getByLabel('Unidade manual deste item').fill('pacote');
  await page.getByLabel('Validade da proposta').fill('60 dias');await page.getByLabel('Prazo de entrega').fill('10 dias');await page.getByLabel('Condições de pagamento').fill('30 dias');await preparar();assert((await previa.textContent()).includes('25,00'));await revisar.check();
  await page.getByRole('button',{name:'Alternar tema'}).click();await page.screenshot({path:path.join(__dirname,'kit-claro.png'),fullPage:true});
  await page.setViewportSize({width:375,height:812});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(__dirname,'kit-mobile.png'),fullPage:true});
  await page.locator('#cenario').selectOption('1');await page.waitForFunction(()=>document.querySelector('[data-contexto]').textContent.includes('Horizonte'));assert(await baixar.isDisabled());assert(!(await page.locator('#kit').textContent()).includes('Aurora'));
  await preencher();const pronta=new Promise(r=>avisarPronta=r),concluida=new Promise(r=>avisarConcluida=r);atrasar='preparar';await page.getByRole('button',{name:'Preparar prévia'}).click();await pronta;
  await page.locator('#cenario').selectOption('0');await page.waitForFunction(()=>document.querySelector('[data-contexto]').textContent.includes('Aurora'));await page.locator('#cenario').selectOption('1');await page.waitForFunction(()=>document.querySelector('[data-contexto]').textContent.includes('Horizonte'));liberar();
  await concluida;assert(!(await previa.textContent()).includes('Declaração fictícia'));assert(await baixar.isDisabled());
  await preencher();await preparar();await revisar.check();await page.getByRole('button',{name:'Fechar seção',exact:true}).click();await page.getByRole('button',{name:'Reabrir seção'}).click();await page.waitForFunction(()=>document.querySelector('[data-contexto]').textContent.includes('Horizonte'));assert(await baixar.isDisabled());
  await preencher();await preparar();await revisar.check();const prontaExportacao=new Promise(r=>avisarPronta=r),concluidaExportacao=new Promise(r=>avisarConcluida=r);atrasar='exportar';await baixar.click();await prontaExportacao;await page.getByRole('button',{name:'Fechar seção',exact:true}).click();await page.getByRole('button',{name:'Reabrir seção'}).click();await page.waitForFunction(()=>document.querySelector('[data-contexto]').textContent.includes('Horizonte'));liberar();await concluidaExportacao;assert.equal(downloads,1,'exportação tardia após fechamento não baixa arquivo');assert(await baixar.isDisabled());
  await preencher();await page.getByLabel('Texto do modelo').fill('{{variavel_desconhecida}}');await page.getByRole('button',{name:'Preparar prévia'}).click();await page.waitForFunction(()=>document.querySelector('[data-pendencias]').textContent.includes('Variável desconhecida'));assert(await baixar.isDisabled());
  assert.deepEqual(erros,[]);assert.deepEqual(externas,[]);
  console.log('Kit UI: declaração, proposta, DOCX real, revisão, pendências, teclado, A→B→A tardio, fechamento, temas e 375px: OK; rede externa: zero.');
 }catch(e){console.error(e);throw e;}finally{liberar?.();await browser.close();servidor.closeAllConnections();await new Promise(r=>servidor.close(r));}
}
if(require.main===module)verificar().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={verificar};
