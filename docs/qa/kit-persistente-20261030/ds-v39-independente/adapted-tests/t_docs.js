// Peças salvas do processo (KitProposta v39): cliques reais, repositório simulado em memória. Controles negativos incluídos.
const { chromium } = require('./isolated-playwright.cjs'); const fs=require('fs'); const path=require('path');
const C=process.argv[2], OUT=process.argv[3]; fs.mkdirSync(OUT,{recursive:true});
const TOK=path.join(__dirname,'harness_tokens_live.css');
const fails=[], pass=[]; const ok=(c,m)=>{ (c?pass:fails).push(m); console.log((c?'PASS ':'FAIL ')+m); };
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let B;
async function load(w=1280, dark=false){ const p=await B.newPage({viewport:{width:w,height:900}}); p.setDefaultTimeout(4000);
  p.errs=[]; p.on('pageerror',e=>p.errs.push(e.message));
  await p.goto(require('url').pathToFileURL(require('path').join(C,'KitProposta','preview.html')).href); await p.addStyleTag({path:TOK});
  if(dark) await p.click('[data-theme-set=dark]'); await wait(120); return p }
const tab=(p,n)=>p.locator('[role=tab]').nth(n).click();
const docsTxt=p=>p.evaluate(()=>document.getElementById('pkDocs').innerText.replace(/ /g,' '));
const curTxt=p=>p.evaluate(()=>document.getElementById('pdCurBox').innerText.replace(/ /g,' '));
const listN=p=>p.evaluate(()=>document.querySelectorAll('#pkDocs .pd-list li').length);
const statusTxt=p=>p.evaluate(()=>document.getElementById('pdMsgL').innerText.replace(/ /g,' ').trim());
const actv=p=>p.evaluate(()=>{const e=document.activeElement; return e&&e!==document.body? e.tagName+'|'+(e.id||'')+'|'+(e.getAttribute('data-pd-key')||e.getAttribute('data-pk-key')||''):'BODY'});
const save=async p=>{ await tab(p,5); await p.locator('#pdSave').click(); await wait(700) };
const forgeDoc=p=>p.evaluate(()=>{ const f=document.createElement('button'); f.type='button'; f.setAttribute('data-pd','save'); f.setAttribute('data-pd-key','save|'); document.body.appendChild(f); f.click(); f.remove() });
const rowTxt=(p,id)=>p.evaluate(i=>{const l=document.querySelector('#pkBox li[data-pk-row="'+i+'"]'); return l?l.innerText.replace(/ /g,' '):'MISSING'},id);
async function setupFull(p){
  await tab(p,0); await p.locator('[data-cconf]').click();
  await tab(p,1); await p.locator('[data-act=attach][data-d=atestado]').click(); await p.locator('[data-act=dconf][data-d=atestado]').click();
  await tab(p,2); await p.locator('input[name=mod][value=anexo2]').check();
  await p.locator('#pr_i2').fill('200'); await p.locator('#pr_i2').dispatchEvent('change');
  await p.locator('#c_ent').fill('30 dias (fictício)'); await p.locator('#c_pag').fill('30 dias após a nota (fictício)');
  await p.locator('input[name=mod][value=anexo3]').check(); await wait(30); await tab(p,5); await wait(30) }
async function genRev(p,mod){ await tab(p,4); await p.locator('[data-pk-do=gen][data-pk="mod:'+mod+'"]').click(); await wait(800);
  await p.locator('#pkRevOk').click(); await wait(40); await tab(p,5) }

(async()=>{ B=await chromium.launch();

 // D1 salvar e reabrir: estado, versão, lista e abertura por clique real
 let p=await load(); await setupFull(p);
 ok((await listN(p))===0 && (await docsTxt(p)).includes('Nenhuma peça salva'), 'D1 lista inicial vazia com mensagem clara');
 ok((await curTxt(p)).includes('Ainda não salvo'), 'D1 peça nova: estado "Ainda não salvo"');
 await save(p);
 ok((await listN(p))===1 && (await docsTxt(p)).includes('Declaração (Anexo III) · rascunho 1') && (await docsTxt(p)).includes('Versão 1'), 'D1 salvar cria peça com título, tipo e versão 1');
 ok((await curTxt(p)).includes('Salvo · versão 1') && !(await curTxt(p)).includes('Alterações não salvas'), 'D1 após salvar: "Salvo · versão 1" sem alterações pendentes');
 ok((await statusTxt(p)).includes('Salvo como versão 1'), 'D1 mensagem de sucesso visível');
 await p.locator('[data-pd=open][data-pd-id=pc-1]').click(); await wait(40);
 ok((await actv(p)).includes('pdCurT'), 'D1 abrir devolve foco ao título da peça aberta');
 ok((await statusTxt(p)).includes('Peça aberta') && (await statusTxt(p)).includes('nova prévia'), 'D1 abrir exige nova prévia antes de baixar (mensagem)');
 ok(await p.locator('#dlB').isDisabled() && await p.locator('#apprB').isDisabled(), 'D1 após abrir: aprovação e download bloqueados até nova prévia');
 await p.close();

 // D2 várias peças do mesmo modelo, listadas separadamente
 p=await load(); await setupFull(p); await save(p);
 await tab(p,5); await p.locator('[data-pd=new]').click(); await wait(30); await save(p);
 ok((await listN(p))===2 && (await docsTxt(p)).includes('rascunho 2'), 'D2 duas declarações salvas aparecem como peças distintas');
 await p.close();

 // D3 alterações não salvas aparecem ao editar, e a peça salva fica como estava
 p=await load(); await setupFull(p); await tab(p,2); await p.locator('input[name=mod][value=anexo2]').check(); await wait(20);
 await save(p);
 await tab(p,2); await p.locator('#pr_i2').fill('210'); await p.locator('#pr_i2').dispatchEvent('change'); await wait(20);
 await tab(p,5); await wait(20);
 ok((await curTxt(p)).includes('Alterações não salvas'), 'D3 editar preço depois de salvar mostra "Alterações não salvas"');
 ok((await docsTxt(p)).includes('Dados mudaram desde o salvamento'), 'D3 a peça salva indica que os dados mudaram');
 await p.close();

 // D4 incompleto pode ser salvo, mas não é revisado nem baixado
 p=await load(); await tab(p,5); await save(p);
 ok((await docsTxt(p)).includes('Incompleto') && (await statusTxt(p)).includes('incompleta'), 'D4 peça incompleta salva com estado Incompleto e aviso');
 await p.close();

 // D5 falha ao salvar: formulário mantido, sem falso sucesso, sem nova versão (controle negativo)
 p=await load(); await setupFull(p); await p.locator('#pdFail').check(); await save(p);
 ok((await listN(p))===0 && !(await statusTxt(p)).includes('Salvo como'), 'D5 falha: nada salvo e sem mensagem de sucesso (controle negativo)');
 ok((await p.locator('#pdErrT').innerText()).includes('Não foi salvo') && (await actv(p)).includes('pdErrT'), 'D5 falha exibida como alerta com texto claro e foco no aviso');
 ok((await p.locator('#pdCurBox').innerText()).includes('Ainda não salvo'), 'D5 a peça continua em edição, sem estado salvo');
 await p.locator('#pdFail').uncheck(); await save(p);
 ok((await listN(p))===1, 'D5 nova tentativa após falha salva normalmente');
 await p.close();

 // D6 conflito de versão: texto local preservado; carregar só por ação explícita
 p=await load(); await setupFull(p); await tab(p,2); await p.locator('input[name=mod][value=anexo2]').check(); await wait(20); await save(p);
 await tab(p,2); await p.locator('#pr_i2').fill('220'); await p.locator('#pr_i2').dispatchEvent('change'); await wait(20);
 await tab(p,5); await p.locator('#pdConf').check(); await p.locator('#pdSave').click(); await wait(700);
 const cf=await p.locator('#pdConfT').count();
 ok(cf===1 && (await p.locator('#pdConfT').innerText()).includes('Conflito de versão'), 'D6 conflito exibido com texto claro');
 ok((await statusTxt(p)).includes('Salvo como versão') === false, 'D6 conflito não reporta falso sucesso (controle negativo)');
 await tab(p,2); ok((await p.inputValue('#pr_i2'))==='220', 'D6 texto local (preço 220) preservado após conflito');
 await tab(p,5); await p.locator('[data-pd=load]').click(); await wait(40);
 ok((await p.locator('#pdConfT').count())===0 && (await statusTxt(p)).includes('Versão atual carregada'), 'D6 carregar versão atual por ação explícita limpa o conflito');
 await tab(p,2); ok((await p.inputValue('#pr_i2'))==='200', 'D6 versão atual restaurada: preço 200 da peça salva');
 await p.close();

 // D7 edição invalida a revisão imediatamente (pacote) e a confirmação da declaração não revisa a proposta
 p=await load(); await setupFull(p); await genRev(p,'anexo3');
 ok((await rowTxt(p,'mod:anexo3')).includes('Revisada na versão atual'), 'D7 base: declaração revisada');
 ok(!(await rowTxt(p,'mod:anexo2')).includes('Revisada na versão atual'), 'D7 confirmar declaração não revisa a proposta');
 await tab(p,0); await p.locator('#f_end').fill('Rua Nova, 999 (fictício)'); await wait(30);
 await tab(p,4); ok(!(await rowTxt(p,'mod:anexo3')).includes('Revisada na versão atual'), 'D7 editar dado invalida a revisão imediatamente');
 await p.close();

 // D8 cancelar e reabrir a peça no pacote por clique real
 p=await load(); await setupFull(p); await tab(p,4);
 await p.locator('[data-pk-do=gen][data-pk="mod:anexo3"]').click(); await wait(800);
 await p.locator('#pkRevNo').click(); await wait(30);
 await p.locator('[data-pk-do=gen][data-pk="mod:anexo3"]').click(); await wait(60);
 ok(await p.locator('#pkRevOk').isEnabled(), 'D8 cancelar e reabrir a mesma peça: confirmação disponível');
 await p.close();

 // D9 A→B→A: peças salvas de cada empresa ficam separadas; revisão não volta
 p=await load(); await setupFull(p); await save(p); await genRev(p,'anexo3');
 await p.locator('#coSel').selectOption('e2'); await wait(40); await tab(p,5); await wait(20);
 ok((await listN(p))===0 && (await curTxt(p)).includes('Ainda não salvo'), 'D9 empresa B não mostra peças da empresa A (controle negativo de mistura)');
 await p.locator('#coSel').selectOption('e1'); await wait(40); await tab(p,5); await wait(20);
 ok((await listN(p))===1, 'D9 A→B→A: peça salva de A continua listada');
 await tab(p,4); ok(!(await rowTxt(p,'mod:anexo3')).includes('Revisada na versão atual'), 'D9 A→B→A não restaura revisão do pacote');
 await p.close();

 // D10 resposta tardia após trocar de empresa é descartada (nada gravado)
 p=await load(); await setupFull(p); await tab(p,5);
 await p.locator('#pdSave').click(); await p.locator('#coSel').selectOption('e2'); await wait(900);
 await p.locator('#coSel').selectOption('e1'); await wait(40); await tab(p,5);
 ok((await listN(p))===0, 'D10 resposta tardia de outra empresa descartada: nada gravado (controle negativo)');
 await p.close();

 // D11 sair da sessão durante a gravação: resposta descartada
 p=await load(); await setupFull(p); await tab(p,5);
 await p.locator('#pdSave').click(); await p.locator('#exitB').click(); await wait(900);
 await p.locator('#enterB').click(); await wait(40); await tab(p,5);
 ok((await listN(p))===0, 'D11 sair da sessão durante a gravação: nada gravado (controle negativo)');
 await p.close();

 // D12 leitor não salva nem cria peça; ação forjada é recusada
 p=await load(); await setupFull(p); await p.locator('#roleSel').selectOption('leitor'); await wait(30); await tab(p,5);
 ok(await p.locator('#pdSave').isDisabled(), 'D12 leitor: salvar desabilitado');
 await forgeDoc(p); await wait(900);
 ok((await listN(p))===0 && (await p.locator('#guardL').innerText()).includes('perfil de leitura'), 'D12 ação forjada do leitor não grava e mostra o motivo (controle negativo)');
 await p.close();

 // D13 teclado: Enter em Salvar, foco na confirmação; Enter em Abrir devolve foco ao título
 p=await load(); await setupFull(p); await tab(p,5);
 await p.locator('#pdSave').focus(); await p.keyboard.press('Enter'); await wait(800);
 ok((await actv(p)).includes('pdSt'), 'D13 Enter em Salvar: foco na mensagem de resultado');
 await p.locator('[data-pd=open][data-pd-id=pc-1]').focus(); await p.keyboard.press('Enter'); await wait(40);
 ok((await actv(p)).includes('pdCurT'), 'D13 Enter em Abrir: foco no título da peça aberta');
 await p.close();

 // D14 layout 375/704/1280 e claro/escuro, sem rolagem horizontal, com duas peças
 for (const w of [375,704,1280]) for (const dark of [false,true]) {
   const q=await load(w,dark); await setupFull(q); await save(q); await tab(q,5); await q.locator('#pdNew').count();
   await q.locator('[data-pd=new]').click(); await wait(30); await save(q);
   const sc=await q.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
   ok(sc<=0, 'D14 '+w+'px'+(dark?' escuro':' claro')+' sem rolagem horizontal ('+sc+')');
   await q.close(); }

 // D15 sem custos internos na lista e na peça salva
 p=await load(); await setupFull(p); await tab(p,2); await p.locator('input[name=mod][value=anexo2]').check(); await wait(20); await p.locator('[data-cost=base][data-item=i1]').fill('7,77'); await p.locator('[data-cost=frt][data-item=i1]').fill('1,11'); await tab(p,5); await save(p);
 ok(!/7,77|1,11|Custo-base|Frete|Formação/i.test(await docsTxt(p)), 'D15 lista de peças sem custos internos');
 await p.close();

 console.log('SUMMARY pass='+pass.length+' fail='+fails.length);
 if(process.env.NEG_CONTROL) ok(false,'NEG controle deliberado');
 await B.close();
 if(fails.length) process.exitCode=1;
})().catch(e=>{ console.error('ERR', e.message); process.exit(1) });
