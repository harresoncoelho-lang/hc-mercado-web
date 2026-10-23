const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
test('ficha básica usa número e ano publicados na compra, preservando zeros sem deduzir ano do PNCP',async()=>{
 const api=require('../netlify/functions/lib/ia-edital').__test;const compra=require('../docs/qa/editais-reais-novos/88124961000159-125/compra.json');const original=global.fetch;
 global.fetch=async()=>({ok:true,json:async()=>compra});
 try{const ficha=await api.buscarFichaCanonica(compra.numeroControlePNCP);assert.equal(ficha.numeroCompra,'0064');assert.equal(ficha.anoCompra,2026);assert.equal(api.montarEstruturaBasica(ficha).identificacao.numero,'0064/2026');assert.equal(api.montarEstruturaBasica({numero:'0064',numeroControlePNCP:compra.numeroControlePNCP}).identificacao.numero,'0064');}
 finally{global.fetch=original;}
});
test('título identifica explicitamente controle PNCP quando número do edital não existe',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../painel.html'),'utf8');const inicio=html.indexOf('  function renderizarCartoesTopoIA(');const fim=html.indexOf('  // Cria uma seção',inicio);const elementos={'modal-ia-cartoes-topo':{style:{}},'modal-ia-titulo':{}};
 const contexto={document:{getElementById:id=>elementos[id]},ResumoModelo:{montar:()=>({cards:[],numero:'88124961000159-1-000125/2026'})},iaEditalAtual:{},escapeHtml:x=>x};
 vm.runInNewContext(html.slice(inicio,fim)+'\nrenderizarCartoesTopoIA({});',contexto);assert.equal(elementos['modal-ia-titulo'].textContent,'Resumo do Edital — PNCP 88124961000159-1-000125/2026');
});
