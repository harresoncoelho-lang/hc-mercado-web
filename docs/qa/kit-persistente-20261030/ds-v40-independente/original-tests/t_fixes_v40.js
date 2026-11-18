// Revisão independente (v39 -> v40): operações de gravação com dono/época, papel, sessão e teclado na aba Peças salvas.
// Cliques reais; latência controlada por esperas explícitas (gravação simulada = 500 ms).
const { chromium } = require('playwright'); const fs=require('fs'); const path=require('path');
const C=process.argv[2], OUT=process.argv[3]; fs.mkdirSync(OUT,{recursive:true});
const TOK=path.join(__dirname,'harness_tokens_live.css');
const fails=[], pass=[]; const ok=(c,m)=>{ (c?pass:fails).push(m); console.log((c?'PASS ':'FAIL ')+m); };
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let B;
async function load(w=1280, dark=false){ const p=await B.newPage({viewport:{width:w,height:900}}); p.setDefaultTimeout(4000); p.errs=[]; p.on('pageerror',e=>p.errs.push(e.message));
  await p.goto('file://'+C+'/KitProposta/preview.html'); await p.addStyleTag({path:TOK}); if(dark) await p.click('[data-theme-set=dark]'); await wait(120); return p }
const tab=(p,n)=>p.locator('[role=tab]').nth(n).click();
const listN=p=>p.evaluate(()=>document.querySelectorAll('#pkDocs .pd-list li').length);
const listTxt=p=>p.evaluate(()=>{const l=document.querySelector('#pkDocs .pd-list'); return l?l.innerText:''});
const statusTxt=p=>p.evaluate(()=>{const s=document.getElementById('pdMsgL'); return s?s.innerText.replace(/\s+/g,' ').trim():''});
const saveState=p=>p.evaluate(()=>{const b=document.getElementById('pdSave'); return b?{dis:b.disabled}:{dis:null}});
const clickSave=p=>p.locator('#pdSave').click({timeout:1500}).catch(()=>{});

(async()=>{ B=await chromium.launch();

 // R1 A->B->A: gravação iniciada em A não pode ser aplicada depois de voltar a A
 let p=await load(); await tab(p,5); await clickSave(p); await p.locator('#coSel').selectOption('e2'); await wait(30); await p.locator('#coSel').selectOption('e1'); await wait(900); await tab(p,5);
 ok((await listN(p))===0 && !/Salvo como versão/.test(await statusTxt(p)), 'R1 A→B→A: gravação antiga descartada, nada salvo em A');
 await clickSave(p); await wait(800); await tab(p,5);
 ok((await listN(p))===1, 'R1 controle: nova gravação em A salva normalmente');
 await p.close();

 // R2 P1->P2->P1
 p=await load(); await tab(p,5); await clickSave(p); await p.locator('#pSel').selectOption('p2'); await wait(30); await p.locator('#pSel').selectOption('p1'); await wait(900); await tab(p,5);
 ok((await listN(p))===0, 'R2 P1→P2→P1: gravação antiga descartada');
 await p.close();

 // R3 sair e entrar em menos de 500 ms
 p=await load(); await tab(p,5); await clickSave(p); await p.locator('[data-exit]').click(); await wait(30); await p.locator('[data-enter]').click(); await wait(900); await tab(p,5);
 ok((await listN(p))===0 && !/Salvo como versão/.test(await statusTxt(p)), 'R3 sair→entrar antes de 500 ms: gravação descartada');
 await p.close();

 // R4 troca de modelo durante gravação não pode deixar "Gravando" nem desabilitar Salvar
 p=await load(); await tab(p,5); await clickSave(p); await wait(30); await tab(p,2); await p.locator('input[name=mod][value=anexo2]').check(); await wait(30); await tab(p,5); await wait(30);
 { const s=await saveState(p), st=await statusTxt(p); ok(s.dis===false && !/Gravando/.test(st), 'R4 troca de modelo libera Salvar e remove "Gravando" imediatamente'); }
 await wait(900); await tab(p,5);
 ok((await listN(p))===0, 'R4 gravação do modelo anterior não é salva depois da troca');
 await p.close();

 // R5 operação 1 invalidada não pode destravar operação 2
 p=await load(); await tab(p,5); await clickSave(p); await wait(30); await tab(p,2); await p.locator('input[name=mod][value=anexo2]').check(); await wait(30); await tab(p,5); await wait(30);
 if(!(await saveState(p)).dis) await clickSave(p); else ok(false,'R5 Salvar já estava bloqueado antes de op2 (busy preso)'); await wait(480);            // op1 original já venceu; op2 ainda pendente
 { const s=await saveState(p), st=await statusTxt(p); ok(s.dis===true && /Gravando/.test(st), 'R5 op1 vencida não libera op2 (Salvar continua ocupado)'); }
 await wait(420); await tab(p,5);
 { const txt=await listTxt(p); ok((await listN(p))===1 && /Proposta/.test(txt), 'R5 op2 conclui e salva apenas a proposta'); }
 ok((await saveState(p)).dis===false, 'R5 após op2 concluir, Salvar volta a ficar disponível');
 await p.close();

 // R6 editor -> leitor durante gravação
 p=await load(); await tab(p,5); await clickSave(p); await wait(30); await p.locator('#roleSel').selectOption('leitor'); await wait(900); await tab(p,5);
 ok((await listN(p))===0 && !/Salvo como versão/.test(await statusTxt(p)), 'R6 editor→leitor durante gravação: nada é comitado');
 await p.close();

 // R7 editor -> leitor -> editor dentro do prazo
 p=await load(); await tab(p,5); await clickSave(p); await wait(30); await p.locator('#roleSel').selectOption('leitor'); await wait(30); await p.locator('#roleSel').selectOption('editor'); await wait(900); await tab(p,5);
 ok((await listN(p))===0, 'R7 leitor e volta a editor: gravação anterior não é retomada');
 await p.close();

 // R10 teclado End/Home na aba Peças salvas: rótulo visível dentro da faixa horizontal, sem deslocar a página na vertical
 for (const w of [375,630,704]) for (const dark of [false,true]) {
   p=await load(w,dark);
   await p.locator('[role=tab]').nth(0).focus(); const y0=await p.evaluate(()=>window.scrollY);
   await p.keyboard.press('End'); await wait(150);
   const r=await p.evaluate(()=>{ const a=document.activeElement, tl=a.closest('[role=tablist]'), ra=a.getBoundingClientRect(), rt=tl.getBoundingClientRect();
     return {txt:a.textContent.trim(), fully: ra.left>=rt.left-0.5 && ra.right<=rt.right+0.5, y:window.scrollY, sl:tl.scrollLeft} });
   const tg=(dark?'escuro':'claro')+' '+w+'px';
   ok(r.txt.includes('Peças salvas') && r.fully, 'R10 End: aba Peças salvas inteira visível ('+tg+')');
   ok(r.y===y0, 'R10 End: página não desloca na vertical ('+tg+')');
   await p.keyboard.press('Home'); await wait(150);
   const h=await p.evaluate(()=>{ const a=document.activeElement, tl=a.closest('[role=tablist]'), ra=a.getBoundingClientRect(), rt=tl.getBoundingClientRect(); return {txt:a.textContent.trim(), fully: ra.left>=rt.left-0.5 && ra.right<=rt.right+0.5, y:window.scrollY} });
   ok(h.txt.includes('Cadastro') && h.fully && h.y===y0, 'R10 Home: aba Cadastro visível e página estável ('+tg+')');
   await p.close();
 }

 console.log('SUMMARY pass='+pass.length+' fail='+fails.length);
 if(process.env.NEG_CONTROL) ok(false,'NEG controle deliberado');
 await B.close();
 if(fails.length) process.exitCode=1;
})().catch(e=>{ console.error('ERR', e.message); process.exit(1) });