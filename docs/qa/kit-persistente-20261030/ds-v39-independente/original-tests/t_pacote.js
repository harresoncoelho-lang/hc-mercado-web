const { chromium } = require('playwright'); const fs=require('fs');
const C=process.argv[2], OUT=process.argv[3]; fs.mkdirSync(OUT,{recursive:true});
const TOK=require('path').join(__dirname,'harness_tokens_live.css');
const fails=[], pass=[]; const ok=(c,m)=>{ (c?pass:fails).push(m); console.log((c?'PASS ':'FAIL ')+m); };
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let B;
async function load(w=1280, dark=false){ const p=await B.newPage({viewport:{width:w,height:900}}); p.setDefaultTimeout(4000);
  p.errs=[]; p.on('pageerror',e=>p.errs.push(e.message));
  await p.goto('file://'+C+'/KitProposta/preview.html'); await p.addStyleTag({path:TOK});
  if(dark) await p.click('[data-theme-set=dark]'); await wait(120); return p }
const tab=(p,n)=>p.locator('[role=tab]').nth(n).click();
const pkText=p=>p.evaluate(()=>document.getElementById('pkBox').innerText.replace(/ /g,' '));
const rowTxt=(p,id)=>p.evaluate(i=>{const l=document.querySelector('#pkBox li[data-pk-row="'+i+'"]'); return l?l.innerText.replace(/ /g,' '):'MISSING'},id);
const reqTxt=(p,nome)=>p.evaluate(n=>{const l=[...document.querySelectorAll('#pkBox li.card')].filter(x=>x.innerText.includes(n)&&!x.querySelector('input'))[0]; return l?l.innerText.replace(/ /g,' '):'MISSING'},nome);
const confEnabled=p=>p.evaluate(()=>{const b=document.getElementById('pkConfB'); return !!b && !b.disabled});
const stTxt=p=>p.evaluate(()=>document.getElementById('pkSt').innerText.trim());
const actv=p=>p.evaluate(()=>{const e=document.activeElement; return e&&e!==document.body? e.tagName+'|'+(e.getAttribute('data-pk-key')||e.id||'')+'|'+(e.getAttribute('data-pk-row')||''):'BODY'});
async function setupFull(p){
  await tab(p,0); await p.locator('[data-cconf]').click();
  await tab(p,1); await p.locator('[data-act=attach][data-d=atestado]').click(); await p.locator('[data-act=dconf][data-d=atestado]').click();
  await tab(p,2); await p.locator('input[name=mod][value=anexo2]').check();
  await p.locator('#pr_i2').fill('200'); await p.locator('#pr_i2').dispatchEvent('change');
  await p.locator('#c_ent').fill('30 dias (fictício)'); await p.locator('#c_pag').fill('30 dias após a nota (fictício)');
  await tab(p,4); await wait(50) }
const visPrev=p=>p.evaluate(()=>{ const pn=document.getElementById('cfTp3'), po=document.getElementById('prevOut'); return {tabOn:!pn.hidden, rect:!!po&&po.getClientRects().length>0, txt:po?po.innerText.replace(/ /g,' '):'', paper:po?po.classList.contains('paper'):false} });
const guardTxt=p=>p.evaluate(()=>document.getElementById('guardL').innerText.replace(/ /g,' '));
const forgeRevok=p=>p.evaluate(()=>{ const f=document.createElement('button'); f.type='button'; f.setAttribute('data-pk-do','revok'); f.setAttribute('data-pk-key','revok|'); document.body.appendChild(f); f.click(); f.remove() });
async function genRev(p,mod){ await tab(p,4); await p.locator('[data-pk-do=gen][data-pk="mod:'+mod+'"]').click(); await wait(800);
  const v=await visPrev(p); ok(v.tabOn && v.rect && v.txt.includes('Prévia'), 'genRev '+mod+': documento apresentado visível antes de revisar');
  await p.locator('#pkRevOk').click(); await wait(50); await tab(p,4) }
async function confirmed(){ const p=await load(); await setupFull(p); await genRev(p,'anexo3'); await genRev(p,'anexo2'); await p.locator('#pkConfB').click(); await wait(50); return p }

(async()=>{ B=await chromium.launch();
 // ---- T1 estado inicial e gap
 let p=await load(); await tab(p,4);
 let t=await pkText(p);
 ok(!(await confEnabled(p)), 'T1 pacote inicial: confirmar bloqueado');
 ok(/Exigência: Atestado/.test(t) && /Exigência: Proposta de preços/.test(t) && !/Exigência: Certidão/.test(t), 'T1 bloqueios listam atestado e proposta; certidão válida não bloqueia');
 ok(/Faltando/.test(await reqTxt(p,'Atestado')), 'T1 atestado vazio aparece Faltando');
 ok(!(await p.locator('[data-pk-do=rev]').count()), 'T1 nenhuma revisão automática antes de gerar prévia');
 ok((await rowTxt(p,'mod:anexo3')).includes('Abra a prévia completa desta peça para revisar'), 'T1 peça modelo sem prévia: pendente de revisão');
 ok((await rowTxt(p,'doc:certidao')).includes('Revisada na versão atual'), 'T1 certidão válida do cofre já revisada (validade existente reaproveitada)');
 ok((await rowTxt(p,'doc:atestado')).includes('Faltando'), 'T1 atestado do cofre Faltando');
 ok(p.errs.length===0, 'T1 sem erro de página'); await p.close();

 // ---- T2 setup completo e revisão individual (anexo3 revisado não revisa anexo2)
 p=await load(); await setupFull(p);
 await tab(p,4); t=await pkText(p);
 ok(/Exigência:/.test(t)===false || !/Atestado/.test(t.split('Exigência')[1]||''), 'T2 atestado deixou de bloquear após confirmação');
 ok((await reqTxt(p,'Atestado de capacidade técnica')).includes('Atendida'), 'T2 exigência atestado atendida pela peça do cofre');
 await genRev(p,'anexo3');
 ok((await rowTxt(p,'mod:anexo3')).includes('Revisada na versão atual'), 'T2 declaração revisada após prévia integral');
 ok((await rowTxt(p,'mod:anexo2')).includes('Abra a prévia completa desta peça para revisar'), 'T2 proposta continua pendente (revisar uma não revisa todas)');
 ok(!(await confEnabled(p)), 'T2 confirmar bloqueado enquanto proposta não revisada');
 // voltar ao checklist conserva revisão
 await tab(p,0); await tab(p,4); ok((await rowTxt(p,'mod:anexo3')).includes('Revisada na versão atual'), 'T2 voltar ao checklist conserva revisão válida da declaração');
 await genRev(p,'anexo2'); ok(await confEnabled(p), 'T2 confirmar habilitado com seleção completa e peças revisadas');
 await p.locator('#pkConfB').click(); await wait(50);
 ok((await stTxt(p)).includes('Pacote confirmado'), 'T2 pacote confirmado');
 t=await pkText(p); ok(t.includes('00.000.000/0001-00') && t.includes('PE 346/2026 (fictício)') && t.includes('versão 3 (fictícia)'), 'T2 resumo mostra CNPJ, processo e versões');
 ok(!/7,77|1,11|0,33|Custo|Frete|Acréscimo|Formação|sugest/i.test(t), 'T2 pacote sem custos internos');
 ok(p.errs.length===0, 'T2 sem erro de página'); await p.close();

 // ---- T3 desmarcar exigida não apaga exigência; seleção vazia bloqueia
 p=await confirmed(); await tab(p,4);
 await p.locator('[data-pk-sel="doc:certidao"]').uncheck(); await wait(30);
 ok((await reqTxt(p,'Certidão negativa')).includes('Faltando: nenhuma peça selecionada'), 'T3 desmarcar certidão: exigência continua Faltando');
 ok((await stTxt(p)).includes('Pacote desfeito'), 'T3 seleção alterada desfaz pacote confirmado');
 ok(!(await confEnabled(p)), 'T3 confirmar bloqueado sem certidão');
 await p.locator('[data-pk-sel="doc:certidao"]').check(); await wait(30);
 ok((await reqTxt(p,'Certidão negativa')).includes('Atendida'), 'T3 marcar de novo: exigência atendida');
 for (const id of ['doc:certidao','doc:fgts','doc:atestado','doc:balanco','mod:anexo3','mod:anexo2']) await p.locator('[data-pk-sel="'+id+'"]').uncheck();
 await wait(30); ok((await pkText(p)).includes('Seleção vazia'), 'T3 seleção vazia bloqueia');
 ok(!(await confEnabled(p)), 'T3 confirmar bloqueado com seleção vazia');
 await p.close();

 // ---- T4 remover peça obrigatória volta a Faltando, revisão preservada ao reincluir
 p=await confirmed(); await tab(p,4);
 await p.locator('[data-pk-sel="mod:anexo3"]').uncheck(); await wait(30);
 ok((await reqTxt(p,'Declaração (Anexo III)')).includes('Faltando'), 'T4 remover declaração volta a Faltando');
 await p.locator('[data-pk-sel="mod:anexo3"]').check(); await wait(30);
 ok((await rowTxt(p,'mod:anexo3')).includes('Revisada na versão atual'), 'T4 reincluir: revisão válida da declaração preservada');
 await p.close();

 // ---- T5 invalidações do pacote confirmado
 p=await confirmed(); await tab(p,0); await p.locator('#f_razao').fill('Empresa Exemplo LTDA (alterada)'); await wait(30);
 await tab(p,4); ok((await stTxt(p)).includes('Pacote desfeito'), 'T5 alterar identidade desfaz pacote');
 ok((await rowTxt(p,'mod:anexo2')).includes('Abra a prévia completa') || (await rowTxt(p,'mod:anexo2')).includes('Revisão anterior desfeita'), 'T5 identidade invalida revisão da proposta');
 await p.close();

 p=await confirmed(); await tab(p,2); await p.locator('#pr_i2').fill('210'); await p.locator('#pr_i2').dispatchEvent('change'); await tab(p,4);
 ok((await stTxt(p)).includes('Pacote desfeito'), 'T5 preço externo alterado desfaz pacote');
 ok((await rowTxt(p,'mod:anexo2')).includes('Revisão anterior desfeita'), 'T5 preço externo invalida revisão da proposta');
 await p.close();

 p=await confirmed(); await tab(p,1); await p.locator('[data-act=ddisc][data-d=atestado]').click(); await tab(p,4);
 ok((await stTxt(p)).includes('Pacote desfeito') && (await rowTxt(p,'doc:atestado')).includes('Faltando'), 'T5 documento descartado desfaz pacote e volta a Faltando');
 await p.close();

 p=await confirmed(); await tab(p,1); await p.locator('[data-act=attach][data-d=certidao]').click(); await wait(20); await tab(p,4);
 ok((await stTxt(p)).includes('Pacote desfeito') && (await rowTxt(p,'doc:certidao')).includes('Pendente de validação'), 'T5 trocar documento (anexo) torna certidão Pendente de validação');
 await p.close();

 // custo interno sem aplicar não altera pacote
 p=await confirmed(); await tab(p,2); await p.locator('[data-cost=base][data-item=i1]').fill('7,77'); await p.locator('[data-cost=frt][data-item=i1]').fill('1,11'); await p.locator('[data-cost=out][data-item=i1]').fill('0,33'); await p.locator('[data-cost=pct][data-item=i1]').fill('20'); await wait(30);
 await tab(p,4); ok((await stTxt(p)).includes('Pacote confirmado'), 'T5 custo interno não aplicado não altera pacote');
 ok((await p.inputValue('#pr_i1'))==='330', 'T5 custo interno não altera preço externo');
 // aplicar preço sugerido invalida
 await tab(p,2); await p.locator('#ap_i1').click(); await wait(20); await tab(p,4);
 ok((await stTxt(p)).includes('Pacote desfeito'), 'T5 aplicar preço sugerido invalida pacote');
 await p.close();

 // ---- T6 A->B->A e troca de processo não ressuscitam
 p=await confirmed(); await p.locator('#coSel').selectOption('e2'); await wait(30); await tab(p,4);
 ok((await pkText(p)).includes('Escolha um CNPJ') === false, 'T6 empresa B mostra pacote próprio (vazio)');
 ok(!(await confEnabled(p)), 'T6 empresa B sem pacote confirmado');
 await p.locator('#coSel').selectOption('e1'); await wait(30); await tab(p,4);
 ok((await stTxt(p)).includes('Pacote não confirmado'), 'T6 A->B->A não ressuscita pacote');
 ok((await rowTxt(p,'mod:anexo3')).includes('Abra a prévia completa') , 'T6 A->B->A não ressuscita revisão da declaração');
 await p.locator('#pSel').selectOption('p2'); await wait(30); await tab(p,4);
 ok((await pkText(p)).includes('Preços unitários e condições') && (await stTxt(p)).includes('Pacote não confirmado'), 'T6 processo 2: preços pendentes e pacote não confirmado');
 await p.locator('#pSel').selectOption('p1'); await wait(30); await tab(p,4);
 ok((await stTxt(p)).includes('Pacote não confirmado'), 'T6 volta ao processo 1 sem pacote ressuscitado');
 await p.close();

 // ---- T7 leitor e sessão
 p=await confirmed(); await p.locator('#roleSel').selectOption('leitor'); await wait(30); await tab(p,4);
 ok(await p.evaluate(()=>[...document.querySelectorAll('#pkBox input[type=checkbox]')].every(x=>x.disabled)), 'T7 leitor: seleção desabilitada');
 await p.evaluate(()=>{ const c=document.querySelector('[data-pk-sel="doc:fgts"]'); c.checked=false; c.dispatchEvent(new Event('change',{bubbles:true})) }); await wait(30);
 ok(await p.evaluate(()=>document.querySelector('[data-pk-sel="doc:fgts"]').checked===true), 'T7 leitor: desmarcação programática revertida');
 ok((await p.locator('#guardL').innerText()).includes('perfil de leitura'), 'T7 leitor: mensagem de acesso negado');
 await p.evaluate(()=>document.getElementById('pkConfB').click()); await wait(30);
 ok((await stTxt(p)).includes('Pacote confirmado'), 'T7 leitor não altera confirmação');
 await p.locator('#roleSel').selectOption('editor'); await p.close();

 p=await confirmed(); await p.locator('#exitB').click(); await wait(30); await p.locator('#enterB').click(); await wait(30); await tab(p,4);
 ok((await stTxt(p)).includes('Pacote não confirmado') && (await rowTxt(p,'mod:anexo2')).includes('Abra a prévia completa'), 'T7 sair e reentrar exige nova revisão e confirmação');
 await p.close();

 // ---- T8 callback tardio descartado
 p=await load(); await setupFull(p); await tab(p,4);
 await p.locator('[data-pk-do=gen][data-pk="mod:anexo3"]').click(); await p.locator('#coSel').selectOption('e2'); await wait(900);
 await p.locator('#coSel').selectOption('e1'); await wait(30); await tab(p,4);
 ok((await rowTxt(p,'mod:anexo3')).includes('Abra a prévia completa') && !(await p.locator('[data-pk-do=rev][data-pk="mod:anexo3"]').count()), 'T8 prévia tardia de empresa anterior não gera revisão');
 await p.close();

 // ---- T9 vazamento de custos no pacote e no texto externo
 p=await confirmed(); const all=await pkText(p); ok(!/7,77|1,11|0,33|Custo|Frete|Acréscimo|Formação|sugest/i.test(all), 'T9 pacote confirmado sem custos');
 await p.close();

 // ---- T10 teclado
 p=await load(); await setupFull(p); await tab(p,4);
 await p.locator('[data-pk-sel="doc:fgts"]').focus(); await p.keyboard.press('Space'); await wait(30);
 ok((await actv(p)).includes('sel|doc:fgts') && !(await p.locator('[data-pk-sel="doc:fgts"]').isChecked()), 'T10 Espaço desmarca peça e mantém foco');
 await p.keyboard.press('Space'); await wait(30); ok(await p.locator('[data-pk-sel="doc:fgts"]').isChecked(), 'T10 Espaço remarca');
 const lbl=await p.evaluate(()=>[...document.querySelectorAll('#pkBox input[type=checkbox]')].filter(x=>!(x.labels&&x.labels.length)).length);
 ok(lbl===0, 'T10 todas as seleções do pacote têm nome (label)');
 await p.locator('[data-pk-do=gen][data-pk="mod:anexo3"]').focus(); await p.keyboard.press('Enter'); await wait(800);
 ok((await actv(p)).includes('prevTitle'), 'T10 Enter em Gerar prévia: foco vai ao título da prévia apresentada');
 await p.locator('#pkRevOk').focus(); await p.keyboard.press('Enter'); await wait(50);
 ok((await rowTxt(p,'mod:anexo3')).includes('Revisada na versão atual') && (await actv(p))!=='BODY', 'T10 Enter em Confirmar revisão: peça revisada e foco no pacote ('+(await actv(p))+')');
 const ol=await p.evaluate(()=>{ const s=getComputedStyle(document.activeElement); return s.outlineStyle }); ok(ol==='solid', 'T10 foco visível (outline sólido com tokens ao vivo)');
 await p.close();

 // ---- T11 layout e contraste
 const rep={};
 for (const w of [375,704,1280]) for (const dark of [false,true]) { const q=await load(w,dark); await setupFull(q); await genRev(q,'anexo3');
   const sc=await q.evaluate(()=>document.documentElement.scrollWidth-innerWidth); ok(sc<=0, 'T11 '+w+'px'+(dark?' escuro':'')+' sem rolagem horizontal ('+sc+')');
   const ch=await q.evaluate(()=>[...document.querySelectorAll('#pkBox .chip')].map(c=>{ const s=getComputedStyle(c); return [s.color,s.backgroundColor] }));
   rep[w+(dark?'d':'l')]=ch.length; await q.close(); }
 const L=s=>{ const m=s.match(/\d+/g).map(Number).slice(0,3).map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)}); return 0.2126*m[0]+0.7152*m[1]+0.0722*m[2] };
 const CR=(a,b)=>{ const x=L(a),y=L(b); return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05) };
 const q=await load(1280,false); await setupFull(q); await genRev(q,'anexo3');
 const chipsL=await q.evaluate(()=>[...document.querySelectorAll('#pkBox .chip')].map(c=>{ const s=getComputedStyle(c); return s.color+'|'+s.backgroundColor }));
 let minL=99; chipsL.forEach(x=>{ const [f,b]=x.split('|'); minL=Math.min(minL,CR(f,b)) }); ok(minL>=4.5, 'T11 chips do pacote (claro) contraste mínimo '+minL.toFixed(2)+' ≥ 4,5:1');
 await q.close();
 const qd=await load(1280,true); await setupFull(qd); await genRev(qd,'anexo3');
 const chipsD=await qd.evaluate(()=>[...document.querySelectorAll('#pkBox .chip')].map(c=>{ const s=getComputedStyle(c); return s.color+'|'+s.backgroundColor }));
 let minD=99; chipsD.forEach(x=>{ const [f,b]=x.split('|'); minD=Math.min(minD,CR(f,b)) }); ok(minD>=4.5, 'T11 chips do pacote (escuro) contraste mínimo '+minD.toFixed(2)+' ≥ 4,5:1');
 await qd.close();

 // ---- T12 gerar não revisa; abrir peça preserva revisões; sem CNPJ não há pacote
 p=await load(); await setupFull(p); await tab(p,4);
 await p.locator('[data-pk-do=gen][data-pk="mod:anexo3"]').click(); await wait(800);
 ok((await rowTxt(p,'mod:anexo3')).includes('Prévia gerada; falta a revisão desta peça na aba Prévia e revisão'), 'T12 gerar prévia não revisa a peça');
 await p.locator('#pkRevOk').click(); await wait(30);
 await genRev(p,'anexo2'); await p.locator('#pkConfB').click(); await wait(30);
 ok((await stTxt(p)).includes('Pacote confirmado'), 'T12 pacote confirmado antes de abrir peça');
 await p.locator('[data-pk-do=open][data-pk="mod:anexo2"]').click(); await wait(30); await tab(p,4);
 ok((await rowTxt(p,'mod:anexo3')).includes('Revisada na versão atual') && (await stTxt(p)).includes('Pacote confirmado'), 'T12 abrir proposta sem alteração preserva revisão da declaração e pacote');
 await p.locator('#coSel').selectOption(''); await wait(30); await tab(p,4);
 ok((await pkText(p)).includes('Escolha um CNPJ') && !(await p.locator('#pkConfB').count()), 'T12 sem CNPJ: não há pacote nem consolidado');
 await p.close();

 // ---- T13 teclado: abrir peça, confirmar, foco sempre dentro do pacote
 p=await load(); await setupFull(p); await tab(p,4);
 await p.locator('[data-pk-do=gen][data-pk="mod:anexo3"]').focus(); await p.keyboard.press('Enter'); await wait(800);
 await p.locator('#pkRevOk').focus(); await p.keyboard.press('Enter'); await wait(40);
 await genRev(p,'anexo2'); await p.locator('#pkConfB').focus(); await p.keyboard.press('Enter'); await wait(40);
 ok((await stTxt(p)).includes('Pacote confirmado') && (await actv(p))!=='BODY', 'T13 Enter em Confirmar pacote: confirmado e foco preservado ('+(await actv(p))+')');
 await p.locator('[data-pk-do=open][data-pk="mod:anexo3"]').focus(); await p.keyboard.press('Enter'); await wait(40);
 ok((await actv(p)).includes('input') || (await p.evaluate(()=>document.activeElement.name))==='mod', 'T13 Enter em Abrir modelo: foco vai ao modelo na aba Modelos');
 await tab(p,4); ok((await stTxt(p)).includes('Pacote confirmado'), 'T13 abrir modelo sem alteração mantém pacote confirmado');
 await p.close();

 // ---- T14 exigência sem correspondência (somente harness: pcs da exigência 'certidao' apontam para peça inexistente; dados publicados não mudam)
 p=await confirmed(); await tab(p,4);
 ok((await stTxt(p)).includes('Pacote confirmado'), 'T14 base: pacote confirmado antes da remoção de correspondência');
 await p.evaluate(()=>{ D.pkReq.find(r=>r.id==='certidao').pcs=['doc:sem-correspondencia-harness'] });
 await p.locator('[data-pk-sel="doc:fgts"]').uncheck(); await p.locator('[data-pk-sel="doc:fgts"]').check(); await wait(30);
 const r14=await reqTxt(p,'Certidão negativa');
 ok(r14.includes('Faltando') && r14.includes('sem peça correspondente'), 'T14 exigência sem peça correspondente fica Faltando sem referência inventada');
 ok((await stTxt(p)).includes('Pacote desfeito') && !(await confEnabled(p)), 'T14 pacote confirmado é desfeito e confirmação bloqueada');
 ok((await pkText(p)).includes('Exigência: Certidão negativa'), 'T14 bloqueio aparece na lista de pendências');
 await p.close();
 p=await load(); await setupFull(p); await genRev(p,'anexo3'); await genRev(p,'anexo2');
 await p.evaluate(()=>{ D.pkReq.find(r=>r.id==='certidao').pcs=['doc:sem-correspondencia-harness'] });
 await tab(p,4); await p.locator('[data-pk-sel="doc:fgts"]').uncheck(); await p.locator('[data-pk-sel="doc:fgts"]').check(); await wait(30);
 ok(!(await confEnabled(p)) && (await reqTxt(p,'Certidão negativa')).includes('Faltando'), 'T14 sem correspondência antes da confirmação: confirmar continua bloqueado');
 ok((await p.evaluate(()=>JSON.stringify(D.docs.map(d=>d.k)))).includes('certidao'), 'T14 cofre publicado intacto (certidão continua no cofre)');
 await p.close();

 // ---- N: apresentação real, confirmação, cancelamento, chamadas forjadas, invalidações e teclado
 // N1 gerar apresenta o documento completo e visível, sem marcar revisão
 p=await load(); await setupFull(p); await tab(p,4);
 const mo3=await p.evaluate(()=>D.modelos.filter(x=>x.id==='anexo3')[0]);
 await p.locator('[data-pk-do=gen][data-pk="mod:anexo3"]').click(); await wait(800);
 let v=await visPrev(p);
 ok(v.tabOn && v.rect && v.paper, 'N1 gerar: aba Prévia visível e documento renderizado visível');
 ok(v.txt.includes('00.000.000/0001-00') && v.txt.includes('PE 346/2026 (fictício)') && v.txt.includes('Declaração (Anexo III'), 'N1 texto apresentado traz CNPJ, processo e modelo');
 ok(v.txt.includes(mo3.fonte) && v.txt.includes(mo3.versao), 'N1 texto apresentado traz fonte e versão da peça');
 ok(!(await p.locator('#pkRevOk').isDisabled()), 'N1 confirmação habilitada somente com documento apresentado');
 ok((await rowTxt(p,'mod:anexo3')).includes('Prévia gerada; falta') && !(await rowTxt(p,'mod:anexo3')).includes('Revisada na versão atual'), 'N1 gerar não marca a peça como Revisada');
 ok((await actv(p)).includes('prevTitle'), 'N1 foco no título da prévia apresentada');
 await p.close();

 // N2 voltar ao pacote sem revisar
 p=await load(); await setupFull(p); await tab(p,4);
 await p.locator('[data-pk-do=gen][data-pk="mod:anexo3"]').click(); await wait(800);
 await p.locator('#pkRevNo').click(); await wait(30);
 ok((await rowTxt(p,'mod:anexo3')).includes('Prévia gerada; falta') && !(await rowTxt(p,'mod:anexo3')).includes('Revisada na versão atual'), 'N2 voltar sem revisar mantém peça pendente');
 ok((await actv(p)).includes('mod:anexo3'), 'N2 foco volta à linha da peça no pacote');
 ok((await p.locator('#pkRevBox').innerText()).trim()==='', 'N2 caixa de revisão some após voltar');
 await p.close();

 // N3 chamada de confirmação sem abrir a prévia não revisa
 p=await load(); await setupFull(p); await tab(p,4);
 await forgeRevok(p); await wait(30);
 ok((await rowTxt(p,'mod:anexo3')).includes('Abra a prévia completa') && !(await rowTxt(p,'mod:anexo3')).includes('Revisada na versão atual'), 'N3 confirmação forjada sem abrir a prévia não revisa');
 ok((await guardTxt(p)).includes('Não há peça aberta'), 'N3 mensagem clara de bloqueio');
 await p.close();

 // N4 aba oculta: não revisa; controle positivo depois de voltar à aba
 p=await load(); await setupFull(p); await tab(p,4);
 await p.locator('[data-pk-do=gen][data-pk="mod:anexo3"]').click(); await wait(800);
 await tab(p,0); await wait(20); v=await visPrev(p);
 ok(!v.tabOn, 'N4 aba Prévia oculta após trocar de aba (controle de visibilidade)');
 await forgeRevok(p); await wait(30);
 await tab(p,4); ok(!(await rowTxt(p,'mod:anexo3')).includes('Revisada na versão atual'), 'N4 confirmação com aba oculta não revisa');
 await tab(p,3); await wait(20); await p.locator('#pkRevOk').click(); await wait(30); await tab(p,4);
 ok((await rowTxt(p,'mod:anexo3')).includes('Revisada na versão atual'), 'N4 controle positivo: com documento visível a confirmação revisa');
 await p.close();

 // N5 mudança de CNPJ/dados depois de apresentar invalida a confirmação
 p=await load(); await setupFull(p); await tab(p,4);
 await p.locator('[data-pk-do=gen][data-pk="mod:anexo3"]').click(); await wait(800);
 await tab(p,0); await p.locator('#f_razao').fill('Empresa Exemplo LTDA (alterada)'); await wait(30);
 await tab(p,3); await wait(20); v=await visPrev(p);
 const rb5=await p.locator('#pkRevOk').count(); ok(!v.txt.includes('Declaração (Anexo III') && (rb5===0 || await p.locator('#pkRevOk').isDisabled()), 'N5 após alterar dados, documento antigo não fica apresentado para confirmar');
 await forgeRevok(p); await wait(30); await tab(p,4);
 ok(!(await rowTxt(p,'mod:anexo3')).includes('Revisada na versão atual'), 'N5 confirmação após mudança de dados não revisa');
 await p.close();

 // N6 sair da sessão com documento apresentado descarta a revisão
 p=await load(); await setupFull(p); await tab(p,4);
 await p.locator('[data-pk-do=gen][data-pk="mod:anexo3"]').click(); await wait(800);
 await p.locator('#exitB').click(); await wait(30); await p.locator('#enterB').click(); await wait(30);
 await tab(p,4); await forgeRevok(p); await wait(30);
 ok(!(await rowTxt(p,'mod:anexo3')).includes('Revisada na versão atual'), 'N6 sair e reentrar: confirmação não revisa e peça segue pendente');
 await p.close();

 // N7 clique tardio: confirmação antes da conclusão da geração não revisa
 p=await load(); await setupFull(p); await tab(p,4);
 await p.locator('[data-pk-do=gen][data-pk="mod:anexo3"]').click(); await forgeRevok(p); await wait(900);
 await tab(p,4); ok(!(await rowTxt(p,'mod:anexo3')).includes('Revisada na versão atual'), 'N7 confirmação durante a geração não revisa; geração tardia não vale como revisão');
 await p.close();

 // N8 abrir outra peça preserva revisão válida da anterior; sem documento de outra peça
 p=await load(); await setupFull(p); await genRev(p,'anexo3');
 await p.locator('[data-pk-do=open][data-pk="mod:anexo2"]').click(); await wait(30); await tab(p,4);
 ok((await rowTxt(p,'mod:anexo3')).includes('Revisada na versão atual'), 'N8 abrir a proposta preserva a revisão válida da declaração');
 v=await visPrev(p); ok(!v.txt.includes('Declaração (Anexo III') && !v.txt.includes('Proposta de preços'), 'N8 ao abrir a proposta não aparece o documento da declaração');
 await p.close();

 // N9 gerar a proposta depois da declaração mostra só a proposta e preserva a revisão da declaração
 p=await load(); await setupFull(p); await genRev(p,'anexo3');
 await tab(p,4); await p.locator('[data-pk-do=gen][data-pk="mod:anexo2"]').click(); await wait(800);
 v=await visPrev(p);
 ok(v.txt.includes('Proposta de preços (Anexo II') && !v.txt.includes('Declaração (Anexo III'), 'N9 documento apresentado é o da proposta, sem HTML da declaração');
 ok(!/Custo|Frete|Formação|Acréscimo|7,77|1,11|0,33/.test(v.txt), 'N9 documento externo não traz custos internos');
 ok(!(await p.locator('#pkRevOk').isDisabled()), 'N9 confirmação habilitada para a proposta apresentada');
 await p.locator('#pkRevOk').click(); await wait(30); await tab(p,4);
 ok((await rowTxt(p,'mod:anexo3')).includes('Revisada na versão atual') && (await rowTxt(p,'mod:anexo2')).includes('Revisada na versão atual'), 'N9 as duas peças revisadas individualmente e preservadas');
 await p.close();

 // N11 mudança de seleção depois de apresentar invalida a confirmação (vínculo de seleção)
 p=await load(); await setupFull(p); await tab(p,4);
 await p.locator('[data-pk-do=gen][data-pk="mod:anexo3"]').click(); await wait(800);
 await tab(p,4); await p.locator('[data-pk-sel="doc:fgts"]').uncheck(); await wait(30); await tab(p,3); await wait(20);
 v=await visPrev(p);
 const rb11=await p.locator('#pkRevOk').count(); ok(!v.txt.includes('Declaração (Anexo III') && (rb11===0 || await p.locator('#pkRevOk').isDisabled()), 'N11 após alterar seleção, o documento antigo não fica apresentado e a confirmação não habilita');
 await forgeRevok(p); await wait(30); await tab(p,4);
 ok(!(await rowTxt(p,'mod:anexo3')).includes('Revisada na versão atual'), 'N11 confirmação forjada após mudança de seleção não revisa');
 await p.close();

// ---- R: reabrir por clique real (cancelar e reabrir, peça já revisada, cache invalidado por seleção/fonte/versão)
 // R1 cancelar e reabrir a MESMA peça: documento visível, confirmação habilitada, foco no título, nada revisado até confirmar
 p=await load(); await setupFull(p); await tab(p,4);
 await p.locator('[data-pk-do=gen][data-pk="mod:anexo3"]').click(); await wait(800);
 await p.locator('#pkRevNo').click(); await wait(30);
 await p.locator('[data-pk-do=gen][data-pk="mod:anexo3"]').click(); await wait(60);
 v=await visPrev(p);
 ok(v.tabOn && v.rect && v.txt.includes('Declaração (Anexo III') && v.txt.includes('00.000.000/0001-00'), 'R1 reabrir a mesma peça após cancelar: documento completo visível');
 ok(await p.locator('#pkRevOk').isEnabled(), 'R1 reabrir: confirmação habilitada com o documento visível');
 ok((await actv(p)).includes('prevTitle'), 'R1 reabrir: foco no título da prévia');
 await tab(p,4); ok(!(await rowTxt(p,'mod:anexo3')).includes('Revisada na versão atual'), 'R1 reabrir sem confirmar não revisa');
 await p.locator('[data-pk-do=gen][data-pk="mod:anexo3"]').click(); await wait(60); await p.locator('#pkRevOk').click(); await wait(40);
 ok((await rowTxt(p,'mod:anexo3')).includes('Revisada na versão atual') && (await actv(p)).includes('mod:anexo3'), 'R1 confirmar após reabrir revisa a peça e devolve foco à linha');
 await p.close();

 // R2 reabrir peça já revisada: documento visível, revisão preservada até nova confirmação
 p=await load(); await setupFull(p); await genRev(p,'anexo3');
 await p.locator('[data-pk-do=gen][data-pk="mod:anexo3"]').click(); await wait(60);
 v=await visPrev(p);
 ok(v.tabOn && v.txt.includes('Declaração (Anexo III'), 'R2 reabrir peça já revisada: documento visível');
 ok(await p.locator('#pkRevOk').isEnabled(), 'R2 reabrir peça já revisada: confirmação habilitada');
 await tab(p,4); ok((await rowTxt(p,'mod:anexo3')).includes('Revisada na versão atual'), 'R2 reabrir não remove a revisão válida');
 await p.close();

 // R3 seleção mudou: o cache não é reutilizado; clique em gerar regenera e só depois confirma
 p=await load(); await setupFull(p); await tab(p,4);
 await p.locator('[data-pk-do=gen][data-pk="mod:anexo3"]').click(); await wait(800);
 await tab(p,4); await p.locator('[data-pk-sel="doc:fgts"]').uncheck(); await wait(30);
 await p.locator('[data-pk-do=gen][data-pk="mod:anexo3"]').click(); await wait(30);
 ok((await p.locator('#genS').innerText()).includes('Gerando'), 'R3 após mudança de seleção, gerar não reutiliza o documento antigo (regenera)');
 await wait(800); v=await visPrev(p);
 ok(v.tabOn && v.txt.includes('Declaração (Anexo III') && await p.locator('#pkRevOk').isEnabled(), 'R3 documento regenerado visível e confirmação habilitada');
 await p.locator('#pkRevOk').click(); await wait(40); await tab(p,4);
 ok((await rowTxt(p,'mod:anexo3')).includes('Revisada na versão atual'), 'R3 confirmação válida após regeneração revisa a peça');
 await p.close();

 // R4 fonte/versão mudou: documento anterior não é reutilizado; regenerado com a versão atual
 p=await load(); await setupFull(p); await genRev(p,'anexo3');
 await p.evaluate(()=>{ const m=D.modelos.filter(x=>x.id==='anexo3')[0]; m.versao='4 (fictícia)'; m.fonte=m.fonte+' (rev.)' });
 await p.locator('[data-pk-do=gen][data-pk="mod:anexo3"]').click(); await wait(30);
 ok((await p.locator('#genS').innerText()).includes('Gerando'), 'R4 após mudar versão/fonte, gerar não reutiliza o documento anterior');
 await wait(800); v=await visPrev(p);
 ok(v.tabOn && v.txt.includes('versão 4 (fictícia)') && !v.txt.includes('versão 3 (fictícia)') && v.txt.includes('(rev.)'), 'R4 documento apresentado traz a versão e a fonte atuais');
 ok(await p.locator('#pkRevOk').isEnabled(), 'R4 confirmação habilitada somente para o documento atual');
 await tab(p,4); ok(!(await rowTxt(p,'mod:anexo3')).includes('Revisada na versão atual'), 'R4 a revisão anterior não vale para a versão nova');
 await p.close();

 // N10 pacote confirmado com revisões; sair para outra empresa e voltar não restaura
 p=await confirmed(); await p.locator('#coSel').selectOption('e2'); await wait(30); await p.locator('#coSel').selectOption('e1'); await wait(30); await tab(p,4);
 ok(!(await rowTxt(p,'mod:anexo2')).includes('Revisada na versão atual') && (await stTxt(p)).includes('Pacote não confirmado'), 'N10 A→B→A não restaura revisão nem pacote');
 await p.close();

 if(process.env.NEG_CONTROL) ok(false,'NEG controle deliberado: o harness deve sair com código diferente de zero');
 console.log('SUMMARY pass='+pass.length+' fail='+fails.length);
 if(fails.length) process.exitCode=1;
 await B.close();
})().catch(e=>{ console.error('ERR', e.message); process.exit(1) });
