const { chromium } = require('C:/Users/harre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
const { criarServidor, empresas, processos } = require('./t1-servidor.cjs');
async function verificar() {
  const servidor = criarServidor(); await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  const origem = `http://127.0.0.1:${servidor.address().port}`, browser = await chromium.launch({ channel: 'msedge', headless: true });
  const erros = [], externas = [], resultados = [], falhas = [];
  const cadastro = i => `/operacao.html?aba=identificacao&empresa=${empresas[i].id}&processo=${processos[i].id}`;
  async function novo() {
    const contexto = await browser.newContext({ viewport: { width: 1280, height: 950 } });
    contexto.on('page', p => { p.setDefaultTimeout(4500); p.on('pageerror', e => erros.push(e.message)); });
    await contexto.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin !== origem) { externas.push(url.href); return route.abort(); } return route.continue(); });
    return contexto;
  }
  const carregar = p => p.locator('#empresa-identificacao-razao').waitFor({ state: 'visible' });
  const esperarEmpresa = (p, i) => p.waitForFunction(nome => document.getElementById('empresa-identificacao-razao')?.value === nome, empresas[i].razao_social);
  async function caso(nome, fn) {
    if (process.env.T1_CASO && !nome.includes(process.env.T1_CASO)) return;
    const contexto = await novo();
    try { await fn(await contexto.newPage(), contexto); resultados.push(nome); console.log(`OK ${nome}`); }
    catch (e) { falhas.push(`${nome}: ${e.message}`); console.error(`FALHOU ${nome}: ${e.message}`); }
    finally { await contexto.close(); }
  }
  try {
    await caso('cadastro direto respeita empresa da URL, confirma e recarrega', async p => {
      await p.addInitScript(id => localStorage.setItem('licitaplena_empresa_operacional_id', id), empresas[0].id);
      await p.goto(origem + cadastro(1)); await carregar(p); await esperarEmpresa(p, 1);
      assert.equal(await p.locator('#empresa-atual').inputValue(), empresas[1].id);
      assert.equal(await p.locator('#aba-identificacao').getByText(/minuta/).count(), 0);
      const salvar = p.getByRole('button', { name: 'Salvar identificação confirmada', exact: true });
      for (const [label, value] of [['Endereço', 'Rua fictícia, 22'], ['Representante legal', 'Pessoa fictícia'], ['Cargo', 'Administradora']]) await p.getByLabel(label, { exact: true }).fill(value);
      assert.equal(await salvar.isDisabled(), true);
      await p.getByLabel('Conferi os dados e os poderes do representante.', { exact: true }).check(); await salvar.click();
      await p.getByText(/Identificação confirmada. Nenhum documento foi aprovado/).waitFor();
      await p.reload(); await esperarEmpresa(p, 1);
      assert.equal(await p.getByLabel('Endereço', { exact: true }).inputValue(), 'Rua fictícia, 22');
      assert.equal(await salvar.isDisabled(), true);
    });
    await caso('link inválido e cadastro vazio não escolhem outra empresa', async p => {
      let chamadas = 0; p.on('request', r => { if (r.url().endsWith('/api/empresa-identificacao')) chamadas++; });
      await p.goto(origem + '/operacao.html?aba=identificacao&empresa=inexistente');
      await p.locator('#aviso').getByText(/empresa do link não está disponível/i).waitFor();
      assert.equal(await p.locator('#empresa-atual').inputValue(), ''); assert.equal(chamadas, 0);
      await p.selectOption('#empresa-atual', empresas[0].id); await esperarEmpresa(p, 0);
      await p.goto(origem + '/operacao.html?aba=identificacao&vazio=1');
      await p.locator('#identificacao-empresa').getByText(/adicione uma empresa/i).waitFor();
      assert.equal(await p.locator('#empresa-identificacao-razao').count(), 0);
    });
    await caso('falha e leitor mostram erro e permitem repetir sem habilitar gravação', async p => {
      let negar = true;
      await p.route('**/api/empresa-identificacao', r => negar ? r.fulfill({ status: 403, json: { erro: 'Seu acesso de leitor não permite identificação.' } }) : r.continue());
      await p.goto(origem + cadastro(0)); await p.getByText('Seu acesso de leitor não permite identificação.').waitFor();
      assert.equal(await p.getByRole('button', { name: 'Salvar identificação confirmada', exact: true }).isDisabled(), true);
      negar = false; await p.getByRole('button', { name: 'Carregar identificação salva' }).click(); await esperarEmpresa(p, 0);
    });
    await caso('cadastro pendente encerra a página antes de consultar identificação', async p => {
      let chamadas = 0; p.on('request', r => { if (r.url().endsWith('/api/empresa-identificacao')) chamadas++; });
      await p.goto(origem + cadastro(0) + '&pendente=1'); await p.waitForURL('**/login.html'); assert.equal(chamadas, 0);
    });
    await caso('A → B → A descarta resposta antiga', async p => {
      let liberar, chegou; const pronta = new Promise(r => chegou = r); let primeira = true;
      await p.route('**/api/empresa-identificacao', async r => {
        if (!primeira) return r.continue(); primeira = false;
        await new Promise(resolve => { liberar = resolve; chegou(); });
        await r.fulfill({ json: { empresa: { ...empresas[0], razao_social: 'RESPOSTA ANTIGA' }, perfil: null, documentos: [] } });
      });
      await p.goto(origem + cadastro(0)); await pronta;
      try { await p.selectOption('#empresa-atual', empresas[1].id); await esperarEmpresa(p, 1); await p.selectOption('#empresa-atual', empresas[0].id); await esperarEmpresa(p, 0); }
      finally { liberar(); }
      await p.getByRole('button', { name: 'Carregar identificação salva' }).click(); await esperarEmpresa(p, 0);
      assert.equal(await p.locator('#empresa-identificacao-razao').inputValue(), empresas[0].razao_social);
    });
    for (const evento of [false, true]) await caso(`sessão ${evento ? 'A → B → A com evento' : 'trocada sem evento'} invalida resposta`, async p => {
      let liberar, chegou; const pronta = new Promise(r => chegou = r);
      await p.route('**/api/empresa-identificacao', async r => { await new Promise(resolve => { liberar = resolve; chegou(); }); await r.fulfill({ json: { empresa: empresas[0], perfil: null, documentos: [] } }); });
      await p.goto(origem + cadastro(0)); await pronta;
      await p.evaluate(evento => { const original = window.qa.sessao, outro = { user: { id: 'outro-ficticio' }, access_token: 'outro-ficticio' }; if (evento) { window.qa.emitir(outro); window.qa.emitir(original); } else window.qa.sessao = outro; }, evento);
      liberar(); await p.locator('#identificacao-empresa').getByText(/sessão mudou/i).waitFor();
      assert.equal(await p.locator('#empresa-identificacao-razao').count(), 0);
    });
    await caso('atalho do kit preserva rascunho e retorna ao processo autorizado', async (p, contexto) => {
      await p.goto(origem + `/processos.html?empresa=${empresas[1].id}&processo=${processos[1].id}`);
      await p.locator('[data-contexto]').filter({ hasText: empresas[1].razao_social }).waitFor();
      await p.getByLabel('Título da declaração', { exact: true }).fill('Rascunho deve continuar aqui');
      await p.getByLabel('Texto do modelo').fill('Conteúdo ainda não salvo');
      const link = p.getByRole('link', { name: 'Conferir dados da empresa (nova aba)' });
      const [cadastroPage] = await Promise.all([contexto.waitForEvent('page'), link.click()]); await esperarEmpresa(cadastroPage, 1);
      assert.equal(await cadastroPage.evaluate(() => window.opener), null);
      assert.equal(await p.getByLabel('Texto do modelo').inputValue(), 'Conteúdo ainda não salvo');
      assert.equal(await p.locator('[data-estado]').textContent(), 'Novo · não salvo');
      assert(!cadastroPage.url().includes('ficticia')); assert(!cadastroPage.url().includes('Conte%C3%BAdo'));
      await cadastroPage.getByRole('link', { name: 'Abrir processo de origem' }).click();
      await cadastroPage.locator('[data-contexto]').filter({ hasText: empresas[1].razao_social }).waitFor();
      assert.equal(await cadastroPage.locator('#modal-dossie').getAttribute('data-processo-id'), processos[1].id);
      assert.equal(await cadastroPage.evaluate(() => document.activeElement.id), 'd-titulo');
      assert.equal(await p.getByLabel('Título da declaração', { exact: true }).inputValue(), 'Rascunho deve continuar aqui');
    });
    await caso('retorno de outra empresa não abre dossiê e URL externa é ignorada', async p => {
      await p.goto(origem + `/processos.html?empresa=${empresas[0].id}&processo=${processos[1].id}&retorno=https://example.invalid`);
      await p.getByText(/processo do link não está disponível/i).waitFor(); assert.equal(await p.locator('#modal-dossie.aberto').count(), 0);
      await p.goto(origem + `/processos.html?empresa=inexistente&processo=${processos[0].id}`);
      await p.locator('#aviso').getByText(/empresa do link não está disponível/i).waitFor(); assert.equal(await p.locator('#empresa-atual').inputValue(), '');
    });
    for (const abertura of ['clique', 'meio', 'menu']) await caso(`atalho invalida revisão pronta e reconsulta conserva proposta: ${abertura}`, async (p, contexto) => {
      let consultas = 0;
      p.on('request', r => { if (r.url().endsWith('/api/kit-documentos') && r.postDataJSON()?.acao === 'consultar') consultas++; });
      await p.goto(origem + `/processos.html?empresa=${empresas[0].id}&processo=${processos[0].id}`);
      await p.locator('[data-contexto]').filter({ hasText: empresas[0].razao_social }).waitFor();
      await p.getByRole('button', { name: 'Nova proposta', exact: true }).click();
      await p.locator('[data-item]').first().check(); await p.getByLabel('Unidade manual deste item').fill('pacote');
      for (const [label, texto] of [['Validade da proposta', '60 dias'], ['Prazo de entrega', '12 dias'], ['Condições de pagamento', '30 dias']]) await p.getByLabel(label, { exact: true }).fill(texto);
      await p.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
      await p.waitForFunction(() => !document.querySelector('[data-preparar]').disabled);
      await p.getByRole('button', { name: 'Preparar prévia', exact: true }).click();
      await p.waitForFunction(() => !document.querySelector('[data-revisado]').disabled); await p.locator('[data-revisado]').check();
      await p.waitForFunction(() => !document.querySelector('[data-exportar]').disabled);
      const atalho = p.getByRole('link', { name: 'Conferir dados da empresa (nova aba)' });
      if (abertura === 'menu') {
        await atalho.click({ button: 'right' }); await p.keyboard.press('Escape');
        assert.equal(contexto.pages().length, 1, 'menu cancelado não navega, mas invalida conservadoramente');
      } else {
        const [cadastroPage] = await Promise.all([contexto.waitForEvent('page'), atalho.click({ button: abertura === 'meio' ? 'middle' : 'left' })]);
        await esperarEmpresa(cadastroPage, 0); assert.equal(await cadastroPage.evaluate(() => window.opener), null);
      }
      assert.equal(await p.locator('[data-exportar]').isDisabled(), true); assert.equal(await p.locator('[data-revisado]').isChecked(), false);
      assert.equal(await p.locator('[data-preparar]').isDisabled(), true);
      assert.equal(consultas, 1);
      await p.getByRole('button', { name: 'Atualizar lista', exact: true }).click(); await p.waitForFunction(() => !document.querySelector('[data-preparar]').disabled);
      assert.equal(consultas, 2, 'atualizar deve reconsultar a identificação depois de qualquer abertura');
      assert.equal(await p.locator('[data-item]').first().isChecked(), true);
      assert.equal(await p.getByLabel('Unidade manual deste item').inputValue(), 'pacote');
      assert.equal(await p.getByLabel('Validade da proposta', { exact: true }).inputValue(), '60 dias');
      assert.equal(await p.getByLabel('Prazo de entrega', { exact: true }).inputValue(), '12 dias');
      assert.equal(await p.getByLabel('Condições de pagamento', { exact: true }).inputValue(), '30 dias');
      assert.equal(await p.locator('[data-exportar]').isDisabled(), true); assert.equal(await p.locator('[data-revisado]').isChecked(), false);
      await p.getByRole('button', { name: 'Preparar prévia', exact: true }).click(); await p.waitForFunction(() => !document.querySelector('[data-revisado]').disabled);
      assert.equal(await p.locator('[data-exportar]').isDisabled(), true);
    });
    await caso('cadastro em 375, 704 e 1280 nos temas existentes', async p => {
      await p.goto(origem + cadastro(1)); await esperarEmpresa(p, 1);
      for (const tema of ['escuro', 'claro']) for (const width of [375, 704, 1280]) {
        await p.setViewportSize({ width, height: 950 }); await p.evaluate(claro => document.documentElement.classList.toggle('tema-claro', claro), tema === 'claro');
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow ${width} ${tema}`);
        await p.getByLabel('Endereço', { exact: true }).focus();
        assert.equal(await p.getByLabel('Endereço', { exact: true }).evaluate(e => getComputedStyle(e).outlineStyle !== 'none'), true);
        await p.evaluate(() => scrollTo(0, 0));
        await p.screenshot({ path: path.join(__dirname, `t1-${tema}-${width}.png`), fullPage: true });
      }
    });
    assert.deepEqual(erros, []); assert.deepEqual(externas, []); assert.deepEqual(falhas, []);
  } finally {
    fs.writeFileSync(path.join(__dirname, process.env.T1_CASO ? 't1-navegador-focal-resultados.json' : 't1-navegador-resultados.json'), JSON.stringify({ resultados, falhas, erros, externas }, null, 2));
    await browser.close(); servidor.closeAllConnections(); await new Promise(r => servidor.close(r));
  }
}
if (require.main === module) verificar().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { verificar };
