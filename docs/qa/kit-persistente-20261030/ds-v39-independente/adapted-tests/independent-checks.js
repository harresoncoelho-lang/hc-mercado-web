const {chromium}=require('./isolated-playwright.cjs');
const fs=require('fs'),path=require('path'),{pathToFileURL}=require('url');
const QA=path.resolve(__dirname,'..');
const url=pathToFileURL('C:/Users/harre/AppData/Local/LicitaPlena/revisao-kitproposta-v39-20261030/revisao_pecas_salvas_kitproposta_v39/2_final_v39/project/components/KitProposta/preview.html').href;
const results=[];
let B;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const tab=(p,n)=>p.locator('[role=tab]').nth(n).click();
async function load(w=1280){const p=await B.newPage({viewport:{width:w,height:900}});await p.goto(url);await p.addStyleTag({path:path.join(__dirname,'harness_tokens_live.css')});return p;}
const state=p=>p.evaluate(()=>({list:document.querySelectorAll('#pkDocs .pd-list li').length,status:document.getElementById('pdMsgL').innerText,disabled:document.getElementById('pdSave').disabled,current:document.getElementById('pdCurBox').innerText,ctx:document.getElementById('coSel').value+'|'+document.getElementById('pSel').value,role:document.getElementById('roleSel').value}));
function check(name,expected,actual){const pass=expected(actual);results.push({name,pass,actual});fs.writeFileSync(path.join(QA,'extra','independent-results.json'),JSON.stringify(results,null,2));console.log((pass?'PASS ':'FAIL ')+name+' '+JSON.stringify(actual));}
async function race(name,transition){const p=await load();await tab(p,5);await p.locator('#pdSave').click();const started=Date.now();await transition(p);const transitionMs=Date.now()-started;await delay(800);check(name,x=>x.list===0,{...await state(p),transitionMs});await p.close();}
(async()=>{
B=await chromium.launch();
await race('E1 A-B-A durante gravação deve descartar resposta',async p=>{await p.locator('#coSel').selectOption('e2');await p.locator('#coSel').selectOption('e1');});
await race('E2 sair-reentrar durante gravação deve descartar resposta',async p=>{await p.locator('#exitB').click();await p.locator('#enterB').click();});
await race('E3 processo P1-P2-P1 durante gravação deve descartar resposta',async p=>{await p.locator('#pSel').selectOption('p2');await p.locator('#pSel').selectOption('p1');});
await race('E4 perder permissão durante gravação deve impedir commit',async p=>{await p.locator('#roleSel').selectOption('leitor');});
let p=await load();await tab(p,5);await p.locator('#pdSave').click();await tab(p,2);await p.locator('input[name=mod][value=anexo2]').check();await delay(800);await tab(p,5);check('E5 trocar modelo durante gravação não pode travar Salvar',x=>!x.disabled&&!x.status.includes('Gravando'),await state(p));await p.screenshot({path:path.join(QA,'extra','stuck-saving.png'),fullPage:true});await p.close();
for(const width of [375,630,704]){
 p=await load(width);await p.locator('[role=tab]').first().focus();await p.keyboard.press('End');await delay(100);
 const geometry=await p.evaluate(()=>{const e=document.activeElement,tl=e.closest('[role=tablist]');const r=e.getBoundingClientRect(),tr=tl.getBoundingClientRect();return {text:e.textContent,selected:e.getAttribute('aria-selected'),left:r.left,right:r.right,width:innerWidth,tablistLeft:tr.left,tablistRight:tr.right,scrollLeft:tl.scrollLeft,fullyVisible:r.left>=Math.max(0,tr.left)&&r.right<=Math.min(innerWidth,tr.right)+1};});
 check('E6 End deve mostrar aba ativa '+width+'px',x=>x.fullyVisible,geometry);
 if(width===630)await p.screenshot({path:path.join(QA,'extra','tab-end-630.png'),fullPage:true});await p.close();
}
p=await B.newPage({viewport:{width:1280,height:1000}});fs.writeFileSync(path.join(QA,'extra','iframe-harness.html'),'<iframe title="Harness local 630px" style="width:630px;height:900px;border:0" src="'+url+'"></iframe>');await p.goto(pathToFileURL(path.join(QA,'extra','iframe-harness.html')).href);const frame=p.frames().find(f=>f.parentFrame());await frame.waitForSelector('[role=tab]');await frame.addStyleTag({path:path.join(__dirname,'harness_tokens_live.css')});await frame.locator('[role=tab]').first().focus();await p.keyboard.press('End');await delay(100);const geom=await frame.evaluate(()=>{const e=document.activeElement,t=e.closest('[role=tablist]'),r=e.getBoundingClientRect(),q=t.getBoundingClientRect();return {text:e.textContent,selected:e.getAttribute('aria-selected'),left:r.left,right:r.right,width:innerWidth,scrollLeft:t.scrollLeft,fullyVisible:r.left>=Math.max(0,q.left)&&r.right<=Math.min(innerWidth,q.right)+1};});check('E7 iframe630 End deve mostrar aba ativa',x=>x.fullyVisible,geom);await p.screenshot({path:path.join(QA,'extra','iframe-630-End.png'),fullPage:true});await p.close();
await B.close();fs.writeFileSync(path.join(QA,'extra','independent-results.json'),JSON.stringify(results,null,2));console.log('SUMMARY pass='+results.filter(x=>x.pass).length+' fail='+results.filter(x=>!x.pass).length);if(results.some(x=>!x.pass))process.exitCode=1;
})().catch(async e=>{console.error(e.stack);if(B)await B.close();process.exitCode=2;});


