const { chromium } = require('C:/Users/harre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const AdmZip = require('adm-zip');
const { criarServidor, cenarios, processoAdicional } = require('./servir-kit-documentos-local.cjs');
const evidencias = path.join(__dirname, 'kit-persistente-20261030');
function instrumentar() {
  let fonte = fs.readFileSync(path.join(__dirname, '../../kit-documentos-ui.js'), 'utf8');
  for (const [nome, arg] of [['executar','acao'], ['abrir','id'], ['listar','']]) {
    const assinatura = `async function ${nome}(${arg}) {`;
    assert(fonte.includes(assinatura), `Instrumentação observa a operação real ${nome}`);
    fonte = fonte.replace(assinatura, `function ${nome}(${arg}) { const p = ${nome}Observado(${arg}); global.__qaOperacoes ||= {}; global.__qaOperacoes[${nome === 'executar' ? 'acao' : `'${nome}'`}] = p; return p; }\nasync function ${nome}Observado(${arg}) {`);
  }
  return fonte;
}
async function verificar() {
  fs.mkdirSync(evidencias, {recursive:true});
  const servidor = criarServidor(); await new Promise(r => servidor.listen(0,'127.0.0.1',r));
  const origem = `http://127.0.0.1:${servidor.address().port}`;
  const browser = await chromium.launch({channel:'msedge',headless:true});
  const erros = [], externas = [], resultados = [], requisicoes = [];
  let downloads = 0, interceptar = null;
  async function pagina() {
    const p = await browser.newPage({viewport:{width:1280,height:950},acceptDownloads:true});
    p.setDefaultTimeout(10000);p.on('pageerror',e=>erros.push(e.message));p.on('download',()=>downloads++);
    await p.route('**/*',async route=>{
      const url = new URL(route.request().url());
      if(url.origin !== origem){externas.push(url.href);return route.abort();}
      if(url.pathname === '/kit-documentos-ui.js')return route.fulfill({contentType:'text/javascript',body:instrumentar()});
      if(url.pathname === '/api/kit-documentos') {
        const body=route.request().postDataJSON();requisicoes.push(body);
        if(interceptar?.page===p && interceptar.acao===body.acao) {
          const regra=interceptar;interceptar=null;
          if(regra.modo==='falha')return route.fulfill({status:regra.status||503,json:{erro:'Falha fictícia controlada'}});
          const resposta=await route.fetch();
          if(regra.modo==='timeout')return route.fulfill({status:503,json:{erro:'Timeout fictício depois de persistir'}});
          if(regra.modo==='invalida')return route.fulfill({status:200,json:regra.transformar(await resposta.json())});
          await new Promise(r=>{regra.liberar=r;regra.pronta();});
          if(regra.modo==='atraso-rede')await route.abort('connectionreset');else await route.fulfill({response:resposta});regra.concluida();return;
        }
      }
      return route.continue();
    });
    await p.goto(origem); await pronta(p); return p;
  }
  const pronta = p => p.waitForFunction(()=>document.querySelector('[data-contexto]')?.textContent.includes('FICTÍCIA') && document.querySelector('#kit').getAttribute('aria-busy')==='false');
  const concluir = (p,acao) => p.evaluate(a=>{const operacao=window.__qaOperacoes?.[a];if(!operacao)throw new Error('Operação não observada: '+a);return operacao;},acao);
  const status = p => p.locator('[data-estado]').textContent();
  async function salvar(p) { await p.locator('[data-salvar]').click(); await concluir(p,'salvar'); assert((await status(p)).startsWith('Salvo'), await status(p)); assert(await p.evaluate(()=>document.activeElement.hasAttribute('data-preparar')),'salvar preserva continuidade pelo teclado'); }
  async function preparar(p) { await p.locator('[data-preparar]').click(); await concluir(p,'preparar'); assert(await p.locator('[data-revisado]').isEnabled(), await p.locator('[data-aviso]').textContent()); }
  async function confirmar(p) { await p.locator('[data-revisado]').check();await concluir(p,'confirmarRevisao');assert(await p.locator('[data-exportar]').isEnabled());assert(await p.evaluate(()=>document.activeElement.hasAttribute('data-exportar')),'confirmação leva foco à ação disponível'); }
  async function preencher(p,titulo='Declaração fictícia') { await p.getByRole('button',{name:'Preencher exemplo fictício'}).click();if(await p.locator('[data-declaracao]').isVisible())await p.getByLabel('Título da declaração',{exact:true}).fill(titulo); }
  async function abrir(p,id) { await p.locator(`[data-abrir="${id}"]`).click();if(await p.locator('[data-descarte]').isVisible())await p.locator('[data-descartar]').click();await concluir(p,'abrir'); }
  async function nova(p,tipo='declaracao') { await p.locator(`[data-novo="${tipo}"]`).click();if(await p.locator('[data-descarte]').isVisible())await p.locator('[data-descartar]').click(); }
  function atrasar(p,acao,modo='atraso') {
    let pronta,concluida;const chegou=new Promise(r=>pronta=r),terminou=new Promise(r=>concluida=r);
    const regra={page:p,acao,modo,pronta,concluida};interceptar=regra;
    return {chegou,async liberar(){regra.liberar();await terminou;},async capturar(){await chegou;await p.evaluate(a=>{window.__qaPendente=window.__qaOperacoes[a];},acao);},async concluir(){await this.liberar();await p.evaluate(()=>window.__qaPendente);}};
  }
  const falha=(p,acao,status=503)=>{interceptar={page:p,acao,modo:'falha',status};};
  const ok = nome => {resultados.push(nome);console.log('OK: '+nome);};
  let page;
  try {
    page = await pagina();
    assert.equal((await fetch(origem+'/.git/config')).status,404);assert.equal((await fetch(origem+'/package.json')).status,404);
    assert.equal(await page.getByRole('button',{name:'Salvar rascunho',exact:true}).count(),1);
    assert(await page.locator('[data-preparar]').isDisabled());assert(await page.locator('[data-exportar]').isDisabled());
    await page.getByLabel('Título da declaração',{exact:true}).fill('Não perder ao trocar tipo');await page.getByLabel('Tipo de documento').selectOption('proposta');
    assert(await page.locator('[data-descarte]').isVisible(),'mudar o tipo pede descarte explícito');await page.locator('[data-cancelar-troca]').click();assert.equal(await page.getByLabel('Título da declaração',{exact:true}).inputValue(),'Não perder ao trocar tipo');assert.equal(await page.getByLabel('Tipo de documento').inputValue(),'declaracao');
    await nova(page,'proposta');await page.locator('[data-item]').check();await page.locator('[data-novo="declaracao"]').click();assert(await page.locator('[data-descarte]').isVisible(),'seleção de item também é alteração não salva');await page.locator('[data-descartar]').click();
    await preencher(page,'Declaração principal');await page.getByLabel('Texto do modelo').fill('A empresa {{razao_social}}, CNPJ {{cnpj}}, apresenta este exemplo para {{numero_edital}}.\n'+ 'Condição fictícia para conferência integral.\n'.repeat(40)+'FIM DA PRÉVIA INTEGRAL');await salvar(page);
    const idA = requisicoes.find(r=>r.acao==='salvar').documentoId;
    assert.match(idA,/^[0-9a-f-]{36}$/);assert.equal(requisicoes.find(r=>r.acao==='salvar').versaoEsperada,0);
    await page.reload();await pronta(page);await abrir(page,idA);
    assert.equal(await page.getByLabel('Título da declaração',{exact:true}).inputValue(),'Declaração principal');assert((await status(page)).includes('versão 1'));
    await page.getByRole('button',{name:'Fechar seção',exact:true}).click();await page.getByRole('button',{name:'Reabrir seção'}).click();await pronta(page);await abrir(page,idA);
    assert.equal(await page.getByLabel('Título da declaração',{exact:true}).inputValue(),'Declaração principal');
    await preparar(page);assert((await page.locator('[data-previa]').textContent()).includes('00000000000100'));assert((await page.locator('[data-previa]').textContent()).includes('FIM DA PRÉVIA INTEGRAL'));assert((await page.locator('[data-fontes]').textContent()).includes('Modelo fictício'));
    assert(await page.locator('[data-exportar]').isDisabled());assert.equal(await page.evaluate(()=>document.activeElement.hasAttribute('data-titulo-previa')),true);
    const confirmacao=atrasar(page,'confirmarRevisao');await page.locator('[data-revisado]').focus();await page.keyboard.press('Space');await confirmacao.capturar();assert(await page.locator('[data-exportar]').isDisabled());await confirmacao.concluir();assert(await page.locator('[data-exportar]').isEnabled());
    const downloadPromise=page.waitForEvent('download');await page.locator('[data-exportar]').click();const download=await downloadPromise;await concluir(page,'exportar');
    const destino=path.join(evidencias,'declaracao-real.docx');await download.saveAs(destino);const xml=new AdmZip(fs.readFileSync(destino)).readAsText('word/document.xml');assert(xml.includes('Aurora'));assert(!xml.includes('Horizonte'));
    await abrir(page,idA);assert(await page.locator('[data-exportar]').isDisabled());assert.equal(await page.locator('[data-revisado]').isChecked(),false);assert((await page.locator('[data-historico]').textContent()).includes('histórica'));
    await preparar(page);await page.getByRole('button',{name:'Cancelar revisão',exact:true}).click();assert(await page.locator('[data-revisado]').isDisabled());await abrir(page,idA);await preparar(page);await confirmar(page);
    await page.getByLabel('Referência informada pelo usuário').fill('Anexo fictício');assert(await page.locator('[data-exportar]').isDisabled());assert.equal(await page.locator('[data-revisado]').isChecked(),false);assert(await page.locator('[data-preparar]').isDisabled());await salvar(page);
    ok('salvar, recarregar, fechar/reabrir, revisão explícita no servidor, edição e DOCX real');

    await nova(page);await preencher(page,'Declaração segunda');await salvar(page);const idB=requisicoes.filter(r=>r.acao==='salvar').at(-1).documentoId;
    await nova(page,'proposta');assert((await page.locator('[data-itens]').textContent()).includes('Quantidade: 2,000 · Unitário ofertado: R$ 12,50'));assert((await page.locator('[data-contexto]').textContent()).includes('00.000.000/0001-00'));
    await preencher(page);await salvar(page);const idP=requisicoes.filter(r=>r.acao==='salvar').at(-1).documentoId;await preparar(page);assert((await page.locator('[data-previa]').textContent()).includes('25,00'));await confirmar(page);
    const propostaDownload=page.waitForEvent('download');await page.locator('[data-exportar]').click();await (await propostaDownload).saveAs(path.join(evidencias,'proposta-real.docx'));await concluir(page,'exportar');
    const propostaXml=new AdmZip(fs.readFileSync(path.join(evidencias,'proposta-real.docx'))).readAsText('word/document.xml');assert(propostaXml.includes('25,00'));assert(!propostaXml.includes('Horizonte'));assert(!propostaXml.includes('custo interno'));
    assert.equal(await page.locator('[data-abrir]').count(),3);await abrir(page,idB);assert(await page.locator('[data-exportar]').isDisabled());assert(await page.getByLabel('Tipo de documento').isDisabled());
    for(const tema of ['escuro','claro']){
      if(tema==='claro')await page.getByRole('button',{name:'Alternar tema'}).click();
      for(const width of [1280,704,375]){await page.setViewportSize({width,height:950});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${tema} ${width}px`);await page.screenshot({path:path.join(evidencias,`kit-${tema}-${width}.png`),fullPage:true});}
    }
    await page.setViewportSize({width:1280,height:950});
    await page.locator('#cenario').selectOption('1');await pronta(page);assert.equal(await page.locator('[data-abrir]').count(),0);assert(!(await page.locator('#kit').textContent()).includes('Aurora'));
    await page.locator('#cenario').selectOption('0');await pronta(page);assert.equal(await page.locator('[data-abrir]').count(),3);
    const isolado=await fetch(origem+'/api/kit-documentos',{method:'POST',headers:{Authorization:'Bearer demonstracao-local-ficticia','Content-Type':'application/json'},body:JSON.stringify({acao:'abrir',empresaId:cenarios[1].empresa.id,processoId:cenarios[1].processo.id,documentoId:idA})});assert.equal(isolado.status,404);
    const outroProcesso=await fetch(origem+'/api/kit-documentos',{method:'POST',headers:{Authorization:'Bearer demonstracao-local-ficticia','Content-Type':'application/json'},body:JSON.stringify({acao:'listar',empresaId:cenarios[0].empresa.id,processoId:processoAdicional.id})});assert.equal(outroProcesso.status,200);assert.deepEqual(await outroProcesso.json(),{documentos:[]});
    assert.deepEqual(await page.evaluate(()=>[Object.keys(localStorage),Object.keys(sessionStorage)]),[[],[]]);
    ok('duas declarações e proposta coexistem, revisão individual, isolamento, temas e 375/704/1280 px');

    await nova(page);await salvar(page);await page.locator('[data-preparar]').click();await concluir(page,'preparar');assert((await status(page)).includes('incompleto'));assert(await page.locator('[data-exportar]').isDisabled());
    await preencher(page);await page.getByLabel('Texto do modelo').fill('{{variavel_desconhecida}}');await salvar(page);await page.locator('[data-preparar]').click();await concluir(page,'preparar');assert((await page.locator('[data-pendencias]').textContent()).includes('Variável desconhecida'));
    await nova(page,'proposta');await salvar(page);await page.locator('[data-preparar]').click();await concluir(page,'preparar');assert((await status(page)).includes('incompleto'));assert(await page.locator('[data-exportar]').isDisabled());
    ok('rascunhos incompletos salvam; proposta incompleta e variável desconhecida não geram');

    await nova(page);await preencher(page,'Criação com timeout');const quantidade=await page.locator('[data-abrir]').count();interceptar={page,acao:'salvar',modo:'timeout'};
    await page.locator('[data-salvar]').click();await concluir(page,'salvar');assert((await status(page)).includes('Falha ao salvar'));assert.equal(await page.getByLabel('Título da declaração',{exact:true}).inputValue(),'Criação com timeout');const primeira=requisicoes.filter(r=>r.acao==='salvar').at(-1);
    await page.getByLabel('Texto do modelo').fill('Texto posterior ao timeout');await page.locator('[data-salvar]').click();await concluir(page,'salvar');const segunda=requisicoes.filter(r=>r.acao==='salvar').at(-1);assert.deepEqual(segunda,primeira);assert((await status(page)).includes('posteriores'));assert.equal(await page.getByLabel('Texto do modelo').inputValue(),'Texto posterior ao timeout');assert(await page.locator('[data-preparar]').isDisabled());await salvar(page);assert.equal(await page.locator('[data-abrir]').count(),quantidade+1);
    ok('timeout após persistir repete UUID e payload, sem duplicação ou perda de alterações posteriores');

    await abrir(page,idA);const outra=await pagina();await abrir(outra,idA);await outra.getByLabel('Título da declaração',{exact:true}).fill('Versão da outra aba');await salvar(outra);
    await page.getByLabel('Título da declaração',{exact:true}).fill('Meu trabalho local');await page.locator('[data-salvar]').click();await concluir(page,'salvar');assert((await status(page)).includes('Conflito'));assert.equal(await page.getByLabel('Título da declaração',{exact:true}).inputValue(),'Meu trabalho local');assert(await page.locator('[data-preparar]').isDisabled());assert(await page.locator('[data-exportar]').isDisabled());
    await page.screenshot({path:path.join(evidencias,'conflito-sem-perda.png'),fullPage:true});await page.getByRole('button',{name:'Carregar versão do servidor',exact:true}).click();assert(await page.locator('[data-descarte]').isVisible());await page.getByRole('button',{name:'Continuar editando',exact:true}).click();assert.equal(await page.getByLabel('Título da declaração',{exact:true}).inputValue(),'Meu trabalho local');
    await page.getByRole('button',{name:'Carregar versão do servidor',exact:true}).click();await page.locator('[data-descartar]').click();await concluir(page,'abrir');assert.equal(await page.getByLabel('Título da declaração',{exact:true}).inputValue(),'Versão da outra aba');await outra.close();
    ok('duas abas causam 409; formulário preservado e versão remota só após ação explícita');

    falha(page,'listar');await page.getByRole('button',{name:'Atualizar lista',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-lista]').textContent.includes('Não foi possível'));assert(!(await page.locator('[data-lista]').textContent()).includes('Nenhum documento'));await page.getByRole('button',{name:'Atualizar lista',exact:true}).click();await pronta(page);
    falha(page,'abrir');await page.locator(`[data-abrir="${idB}"]`).click();await concluir(page,'abrir');assert.equal(await page.getByLabel('Título da declaração',{exact:true}).inputValue(),'Versão da outra aba');assert(await page.locator('[data-exportar]').isDisabled());
    await preparar(page);falha(page,'confirmarRevisao');await page.locator('[data-revisado]').click();await concluir(page,'confirmarRevisao');assert(await page.locator('[data-exportar]').isDisabled());assert.equal(await page.locator('[data-revisado]').isChecked(),false);
    await page.getByLabel('Título da declaração',{exact:true}).fill('Falha conserva');falha(page,'salvar');await page.locator('[data-salvar]').click();await concluir(page,'salvar');assert.equal(await page.getByLabel('Título da declaração',{exact:true}).inputValue(),'Falha conserva');assert(await page.locator('[data-preparar]').isDisabled());await salvar(page);
    await preparar(page);interceptar={page,acao:'confirmarRevisao',modo:'invalida',transformar:r=>({...r,documento:{...r.documento,versao:r.documento.versao-1}})};await page.locator('[data-revisado]').click();await concluir(page,'confirmarRevisao');assert(await page.locator('[data-exportar]').isDisabled());
    falha(page,'consultar');await page.getByRole('button',{name:'Reabrir seção'}).click();await page.waitForFunction(()=>document.querySelector('[data-aviso]').textContent.includes('Falha fictícia'));assert(await page.locator('form').evaluate(f=>f.inert));assert(await page.locator('[data-salvar]').isDisabled());await page.getByRole('button',{name:'Atualizar lista',exact:true}).click();await pronta(page);
    ok('falhas listar/abrir/salvar/revisar e resposta de versão anterior não concedem sucesso ou exportação');

    for(const acao of ['salvar','abrir','preparar','confirmarRevisao']){
      await abrir(page,idA);if(acao==='salvar')await page.getByLabel('Título da declaração',{exact:true}).fill('Salvamento tardio');
      if(acao==='confirmarRevisao')await preparar(page);
      const atraso=atrasar(page,acao);
      if(acao==='abrir')await page.locator(`[data-abrir="${idB}"]`).click();else if(acao==='confirmarRevisao')await page.locator('[data-revisado]').check();else await page.locator(`[data-${acao}]`).click();
      await atraso.capturar();
      await page.locator('#cenario').selectOption('1');await pronta(page);await page.locator('#cenario').selectOption('0');await pronta(page);
      await abrir(page,idB);const antes=await page.locator('#kit').textContent();await atraso.concluir();assert.equal(await page.locator('#kit').textContent(),antes);assert(await page.locator('[data-exportar]').isDisabled());
    }
    // Trocar somente a peça invalida confirmação, sem depender de desmontar o componente.
    await abrir(page,idA);await preparar(page);const outraPeca=atrasar(page,'confirmarRevisao');await page.locator('[data-revisado]').check();await outraPeca.capturar();await abrir(page,idB);await abrir(page,idA);await outraPeca.concluir();assert(await page.locator('[data-exportar]').isDisabled());assert.equal(await page.locator('[data-revisado]').isChecked(),false);
    await preparar(page);await confirmar(page);const antesDownloads=downloads,exportacao=atrasar(page,'exportar');await page.locator('[data-exportar]').click();await exportacao.capturar();await page.getByRole('button',{name:'Fechar seção',exact:true}).click();await page.getByRole('button',{name:'Reabrir seção'}).click();await pronta(page);await exportacao.concluir();assert.equal(downloads,antesDownloads);assert(await page.locator('[data-exportar]').isDisabled());
    ok('salvar/abrir/preparar/confirmar tardios descartados em A→B→A; troca de peça e exportação após fechar bloqueadas');

    for(const acao of ['salvar','abrir','confirmarRevisao'])for(const mudanca of ['usuario','expirada','fechar']) {
      await page.evaluate(c=>{
        window.__qaMontagem?.fechar();document.getElementById('fechar').click();
        window.__qaSessao={userId:c.userId,accessToken:'demonstracao-local-ficticia'};
        window.__qaMontagem=LicitaKitDocumentos.montar({alvo:document.getElementById('kit'),contexto:{empresaId:c.empresa.id,processoId:c.processo.id},obterSessao:async()=>window.__qaSessao});
      },cenarios[0]);await pronta(page);await abrir(page,idB);
      if(acao==='salvar')await page.getByLabel('Título da declaração',{exact:true}).fill('Sessão tardia fictícia');if(acao==='confirmarRevisao')await preparar(page);
      const atraso=atrasar(page,acao,mudanca==='usuario'?'atraso-rede':'atraso');
      if(acao==='abrir')await page.locator(`[data-abrir="${idA}"]`).click();else if(acao==='confirmarRevisao')await page.locator('[data-revisado]').check();else await page.locator('[data-salvar]').click();await atraso.capturar();
      await page.evaluate(m=>{if(m==='fechar')window.__qaMontagem.fechar();else window.__qaSessao=m==='expirada'?null:{userId:'outro-usuario-ficticio',accessToken:'outro-token'};},mudanca);
      await atraso.concluir();assert.equal(await page.locator('#kit').textContent(),'',`${acao}/${mudanca}: nenhum callback da sessão antiga`);
    }
    ok('salvar/abrir/confirmar tardios após usuário trocado, sessão expirada ou fechamento');

    await page.getByRole('button',{name:'Reabrir seção'}).click();await pronta(page);

    const itensAntes=cenarios[0].itens;cenarios[0].itens=[];
    try {
      await page.getByRole('button',{name:'Reabrir seção'}).click();await pronta(page);await abrir(page,idP);
      assert.equal(await page.locator('[data-item]:checked').count(),1,'item salvo removido do cadastro permanece visível e selecionado');assert.equal(await page.getByLabel('Unidade manual deste item').inputValue(),'pacote');
      await page.locator('[data-preparar]').click();await concluir(page,'preparar');assert(await page.locator('[data-exportar]').isDisabled());
      await page.getByLabel('Prazo de entrega').fill('11 dias');await page.locator('[data-salvar]').click();await concluir(page,'salvar');assert((await status(page)).includes('Falha'));assert.equal(await page.locator('[data-item]:checked').count(),1);assert.equal(await page.getByLabel('Prazo de entrega').inputValue(),'11 dias');
    } finally { cenarios[0].itens=itensAntes; }
    await page.getByRole('button',{name:'Reabrir seção'}).click();await pronta(page);
    ok('item removido do cadastro permanece no formulário, com pendência e sem perda silenciosa');

    await abrir(page,idP);await preparar(page);await confirmar(page);
    const externo=await fetch(origem+'/api/kit-documentos',{method:'POST',headers:{Authorization:'Bearer demonstracao-local-ficticia','Content-Type':'application/json'},body:JSON.stringify({...requisicoes.filter(r=>r.acao==='salvar'&&r.documentoId===idP).at(-1),versaoEsperada:1,proposta:{itemIds:[],unidades:{},validade:'',prazoEntrega:'',pagamento:''}})});assert.equal(externo.status,200);
    await page.locator('[data-exportar]').click();await concluir(page,'exportar');assert(await page.locator('[data-exportar]').isDisabled());assert((await status(page)).includes('desatualizada'));
    assert.deepEqual(erros,[]);assert.deepEqual(externas,[]);
    ok('alteração externa bloqueia exportação; rede externa zero; erros JavaScript zero');

    for(const gesto of ['editar','nova']) {
      const lista=atrasar(page,'listar');await page.getByRole('button',{name:'Reabrir seção'}).click();await lista.capturar();
      if(gesto==='editar')await page.getByLabel('Título da declaração',{exact:true}).fill('Edição durante listagem');else await nova(page,'proposta');
      await lista.concluir();assert(!(await page.locator('[data-lista]').textContent()).includes('Carregando documentos'),`${gesto}: listagem deve concluir independentemente da peça`);
      assert.equal(await page.locator(`[data-abrir="${idA}"]`).count(),1);assert.equal(await page.locator('#kit').getAttribute('aria-busy'),'false');
      if(gesto==='editar')assert.equal(await page.getByLabel('Título da declaração',{exact:true}).inputValue(),'Edição durante listagem');else assert.equal(await page.getByLabel('Tipo de documento').inputValue(),'proposta');
    }
    await page.getByRole('button',{name:'Reabrir seção'}).click();await pronta(page);
    const listaDuranteSave=atrasar(page,'listar');await page.locator('[data-listar]').click();await listaDuranteSave.capturar();await preencher(page,'Salvamento durante listagem');
    const saveDuranteLista=atrasar(page,'salvar');await page.locator('[data-salvar]').click();await saveDuranteLista.chegou;
    await listaDuranteSave.concluir();assert(await page.locator('[data-salvar]').isDisabled(),'lista não libera a operação da peça mais nova');assert.equal(await page.locator('#kit').getAttribute('aria-busy'),'true');assert((await status(page)).startsWith('Salvando'));
    await saveDuranteLista.liberar();await concluir(page,'salvar');assert((await status(page)).startsWith('Salvo'));

    const listaAnterior=atrasar(page,'listar');await page.getByRole('button',{name:'Reabrir seção'}).click();await listaAnterior.capturar();await preencher(page,'Peça salva depois do snapshot');await salvar(page);const idDepois=requisicoes.filter(r=>r.acao==='salvar').at(-1).documentoId;
    await pronta(page);await listaAnterior.concluir();assert.equal(await page.locator(`[data-abrir="${idDepois}"]`).count(),1,'snapshot antigo não apaga a atualização feita pelo salvamento');
    await preparar(page);const listaAntesRevisao=atrasar(page,'listar');await page.locator('[data-listar]').click();await listaAntesRevisao.capturar();await confirmar(page);await pronta(page);await listaAntesRevisao.concluir();
    assert((await page.locator(`[data-abrir="${idDepois}"]`).evaluate(b=>b.closest('li').textContent)).includes('Revisão histórica registrada'),'snapshot anterior não rebaixa metadados após confirmar revisão');
    const lista1=atrasar(page,'listar');await page.locator('[data-listar]').click();await lista1.capturar();const lista2=atrasar(page,'listar');await page.locator('[data-listar]').click();await lista2.chegou;
    await lista1.concluir();assert((await page.locator('[data-lista]').textContent()).includes('Carregando documentos'));assert.equal(await page.locator('#kit').getAttribute('aria-busy'),'true','lista antiga não termina a mais recente');
    await lista2.liberar();await concluir(page,'listar');assert.equal(await page.locator('#kit').getAttribute('aria-busy'),'false');
    const listaAntesErro=atrasar(page,'listar');await page.locator('[data-listar]').click();await listaAntesErro.capturar();falha(page,'listar');await page.locator('[data-listar]').click();await concluir(page,'listar');const erroLista=await page.locator('[data-lista]').textContent();assert(erroLista.includes('Não foi possível'));
    await listaAntesErro.concluir();assert.equal(await page.locator('[data-lista]').textContent(),erroLista,'lista antiga não apaga erro da atualização posterior');

    for(const mudanca of ['usuario','expirada','contexto','fechar-reabrir']) {
      const lista=atrasar(page,'listar');
      await page.evaluate(c=>{window.__qaMontagem?.fechar();document.getElementById('fechar').click();window.__qaSessao={userId:c.userId,accessToken:'demonstracao-local-ficticia'};window.__qaContexto={empresaId:c.empresa.id,processoId:c.processo.id};window.__qaMontagem=LicitaKitDocumentos.montar({alvo:document.getElementById('kit'),contexto:window.__qaContexto,obterSessao:async()=>window.__qaSessao});},cenarios[0]);await lista.capturar();
      await page.getByLabel('Título da declaração',{exact:true}).fill('Campo em edição');
      await page.evaluate(({mudanca,processo})=>{if(mudanca==='usuario')window.__qaSessao={userId:'outro-usuario-ficticio',accessToken:'outro-token'};if(mudanca==='expirada')window.__qaSessao=null;if(mudanca==='contexto')window.__qaContexto.processoId=processo;if(mudanca==='fechar-reabrir'){window.__qaMontagem.fechar();window.__qaContexto.processoId=processo;document.getElementById('abrir').click();}}, {mudanca,processo:processoAdicional.id});
      if(mudanca==='fechar-reabrir')await pronta(page);const antes=await page.locator('#kit').textContent();await lista.concluir();assert.equal(await page.locator('#kit').textContent(),mudanca==='fechar-reabrir'?antes:'',`lista tardia após ${mudanca}`);
    }
    assert.deepEqual(erros,[]);assert.deepEqual(externas,[]);
    ok('listagem independente de edição/nova peça; versões da lista, ocupado e invalidação de sessão/contexto/fechamento preservados');
    fs.writeFileSync(path.join(evidencias,'resultado-ui.json'),JSON.stringify({resultados,downloads,erros,redeExterna:externas.length,acoes:requisicoes.reduce((a,r)=>(a[r.acao]=(a[r.acao]||0)+1,a),{})},null,2));
  } finally { interceptar?.liberar?.();await browser.close();servidor.closeAllConnections();await new Promise(r=>servidor.close(r)); }
}
if(require.main===module)verificar().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={verificar};
