// Interface e SDK reais; sessão fictícia fica apenas no contexto headless efêmero.
const { chromium } = require('C:/Users/harre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const mammoth = require('mammoth');

async function esperarAcao(espera, executar) {
  const [resultado] = await Promise.all([espera, Promise.resolve().then(executar)]);
  return resultado;
}

async function verificarUIReal({ base, evidencias, owner, empresas, itemIds, sanear, registrarFixture }) {
  assert.equal(new URL(base).hostname, '127.0.0.1');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const contexto = await browser.newContext({ viewport: { width: 1280, height: 950 }, acceptDownloads: true });
  const resultados = [], erros = [], externas = [], requisicoes = [], documentos = [];
  let etapa = 'login', failure, authFresh = false;
  contexto.on('page', p => {
    p.setDefaultTimeout(15000);
    p.on('pageerror', e => erros.push(sanear(e)));
    p.on('response', r => {
      const url = new URL(r.url());
      if (url.pathname !== '/api/kit-documentos') return;
      const body = r.request().postDataJSON();
      requisicoes.push({ acao: body.acao, status: r.status(), empresaId: body.empresaId, processoId: body.processoId, documentoId: body.documentoId, versaoEsperada: body.versaoEsperada });
    });
  });
  await contexto.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) { externas.push(url.origin + url.pathname); return route.abort(); }
    return route.continue();
  });
  const cadastroURL = e => `${base}/operacao.html?aba=identificacao&empresa=${e.id}&processo=${e.processoId}`;
  const processoURL = e => `${base}/processos.html?empresa=${e.id}&processo=${e.processoId}`;
  const cadastroPronto = (p, e) => p.waitForFunction(nome => document.getElementById('empresa-identificacao-razao')?.value === nome, e.nome);
  async function kitPronto(p, e) {
    await p.locator('[data-contexto]').filter({ hasText: e.nome }).waitFor();
    await p.waitForFunction(() => document.getElementById('d-kit-documentos')?.getAttribute('aria-busy') === 'false');
  }
  async function acao(p, nome, executar, status = 200) {
    const r = await esperarAcao(p.waitForResponse(r => new URL(r.url()).pathname === '/api/kit-documentos' && r.request().postDataJSON()?.acao === nome), executar);
    assert.equal(r.status(), status, 'UI ' + nome); const data = await r.json();
    await p.waitForFunction(() => document.getElementById('d-kit-documentos')?.getAttribute('aria-busy') === 'false');
    return data;
  }
  const salvar = p => acao(p, 'salvar', () => p.locator('[data-salvar]').click());
  async function abrir(p, id) {
    const promise = acao(p, 'abrir', async () => {
      await p.locator(`[data-abrir="${id}"]`).click();
      if (await p.locator('[data-descarte]').isVisible()) await p.locator('[data-descartar]').click();
    });
    await promise;
    assert(await p.locator('[data-exportar]').isDisabled());
    assert.equal(await p.locator('[data-revisado]').isChecked(), false);
  }
  async function revisar(p) {
    await acao(p, 'preparar', () => p.locator('[data-preparar]').click());
    assert(await p.locator('[data-exportar]').isDisabled());
    assert(await p.locator('[data-revisado]').isEnabled());
    await acao(p, 'confirmarRevisao', () => p.locator('[data-revisado]').check());
    assert(await p.locator('[data-exportar]').isEnabled());
  }
  async function baixar(p, nome, empresa, textoEsperado) {
    const download = await esperarAcao(p.waitForEvent('download'), () => acao(p, 'exportar', () => p.locator('[data-exportar]').click()));
    const destino = path.join(evidencias, nome); assert(!fs.existsSync(destino));
    await download.saveAs(destino);
    const buffer = fs.readFileSync(destino); assert.equal(buffer.subarray(0, 2).toString(), 'PK');
    const texto = (await mammoth.extractRawText({ buffer })).value;
    assert(texto.includes(empresa.nome)); assert(texto.includes(textoEsperado));
    const outraEmpresa = empresas.find(e => e.id !== empresa.id);
    assert(!texto.includes(outraEmpresa.nome));
    assert(new RegExp(`(?:^|\\D)${empresa.cnpj}(?:\\D|$)`).test(texto), 'CNPJ exato no DOCX da UI');
    assert(!texto.includes(outraEmpresa.cnpj), 'DOCX da UI nao contem CNPJ da outra empresa');
    return texto;
  }
  try {
    const p = await contexto.newPage();
    await p.goto(base + '/login.html');
    // O SDK do próprio login grava somente a sessão deste contexto efêmero.
    const auth = await p.evaluate(async credentials => {
      const { data, error } = await sb.auth.signInWithPassword(credentials);
      if (error || !data.session) throw new Error('Auth local recusou login fictício');
      const claims = JSON.parse(atob(data.session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return { id: data.user.id, iat: claims.iat, exp: claims.exp };
    }, { email: owner.email, password: owner.password });
    assert.equal(auth.id, owner.id); assert(auth.exp * 1000 > Date.now() + 60000 && auth.iat * 1000 > Date.now() - 60000);
    authFresh = true;
    await p.evaluate(id => localStorage.setItem('licitaplena_empresa_operacional_id', id), empresas[0].id);
    etapa = 'cadastro real B';
    await p.goto(cadastroURL(empresas[1])); await cadastroPronto(p, empresas[1]);
    assert.equal(await p.locator('#empresa-atual').inputValue(), empresas[1].id);
    for (const [label, value] of [['Endereço', 'Rua fictícia UI, 22'], ['Representante legal', 'Pessoa Fictícia UI'], ['Cargo', 'Administradora']]) await p.getByLabel(label, { exact: true }).fill(value);
    assert(await p.getByRole('button', { name: 'Salvar identificação confirmada', exact: true }).isDisabled());
    await p.getByLabel('Conferi os dados e os poderes do representante.', { exact: true }).check();
    await p.getByRole('button', { name: 'Salvar identificação confirmada', exact: true }).click();
    await p.getByText(/Identificação confirmada. Nenhum documento foi aprovado/).waitFor();
    await p.reload(); await cadastroPronto(p, empresas[1]);
    assert.equal(await p.getByLabel('Endereço', { exact: true }).inputValue(), 'Rua fictícia UI, 22');
    for (const width of [375, 1280]) {
      await p.setViewportSize({ width, height: 950 });
      assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Cadastro sem overflow');
      await p.screenshot({ path: path.join(evidencias, `cadastro-real-${width}.png`), fullPage: true });
    }
    resultados.push('UI cadastro B real: URL prevalece sobre preferencia A; confirmacao, recarga e 375/1280 px');

    etapa = 'atalho e declaração UI';
    await p.goto(processoURL(empresas[0])); await kitPronto(p, empresas[0]);
    await p.getByLabel('Título da declaração', { exact: true }).fill('Declaração UI real');
    await p.getByLabel('Texto do modelo').fill('{{razao_social}}, CNPJ {{cnpj}}, representada por {{representante}}, apresenta exemplo para {{numero_edital}}.\n' + 'Linha fictícia de revisão integral.\n'.repeat(24) + 'FIM INTEGRAL UI');
    await p.getByLabel('Referência informada pelo usuário').fill('Modelo fictício UI; não protocolar.');
    const [cadastro] = await Promise.all([contexto.waitForEvent('page'), p.getByRole('link', { name: 'Conferir dados da empresa (nova aba)' }).click()]);
    await cadastroPronto(cadastro, empresas[0]);
    assert.equal(await cadastro.evaluate(() => window.opener), null);
    assert.equal(await p.getByLabel('Título da declaração', { exact: true }).inputValue(), 'Declaração UI real');
    assert(await p.locator('[data-preparar]').isDisabled());
    await cadastro.getByRole('link', { name: 'Abrir processo de origem' }).click(); await kitPronto(cadastro, empresas[0]);
    assert.equal(await cadastro.locator('#modal-dossie').getAttribute('data-processo-id'), empresas[0].processoId);
    await cadastro.close();
    await acao(p, 'consultar', () => p.getByRole('button', { name: 'Atualizar lista', exact: true }).click());
    assert.equal(await p.getByLabel('Título da declaração', { exact: true }).inputValue(), 'Declaração UI real');
    const declaration = (await salvar(p)).documento; documentos.push(declaration.id);
    registrarFixture('peca', declaration.id);
    assert.equal(declaration.versao, 1);
    await p.reload(); await kitPronto(p, empresas[0]); await abrir(p, declaration.id);
    assert.equal(await p.getByLabel('Título da declaração', { exact: true }).inputValue(), 'Declaração UI real');
    await revisar(p); assert((await p.locator('[data-previa]').textContent()).includes('FIM INTEGRAL UI'));
    await baixar(p, 'ui-declaracao-real.docx', empresas[0], 'FIM INTEGRAL UI');
    await p.goto(processoURL(empresas[1])); await kitPronto(p, empresas[1]); assert.equal(await p.locator(`[data-abrir="${declaration.id}"]`).count(), 0);
    await p.goto(processoURL(empresas[0])); await kitPronto(p, empresas[0]); await abrir(p, declaration.id);
    resultados.push('UI kit real: atalho/retorno preservam rascunho; salvar/recarregar/A-B-A/reabrir exigem revisao; DOCX integral isolado');

    etapa = 'conflito real entre abas';
    const outra = await contexto.newPage(); await outra.goto(processoURL(empresas[0])); await kitPronto(outra, empresas[0]); await abrir(outra, declaration.id);
    await outra.getByLabel('Título da declaração', { exact: true }).fill('Versão vencedora UI');
    assert.equal((await salvar(outra)).documento.versao, 2);
    await p.getByLabel('Título da declaração', { exact: true }).fill('Rascunho perdedor preservado');
    await acao(p, 'salvar', () => p.locator('[data-salvar]').click(), 409);
    assert((await p.locator('[data-estado]').textContent()).includes('Conflito'));
    assert.equal(await p.getByLabel('Título da declaração', { exact: true }).inputValue(), 'Rascunho perdedor preservado');
    assert(await p.locator('[data-exportar]').isDisabled());
    await p.screenshot({ path: path.join(evidencias, 'ui-conflito-real.png'), fullPage: true });
    await acao(p, 'abrir', async () => { await p.getByRole('button', { name: 'Carregar versão do servidor', exact: true }).click(); await p.locator('[data-descartar]').click(); });
    assert.equal(await p.getByLabel('Título da declaração', { exact: true }).inputValue(), 'Versão vencedora UI');
    await outra.close();
    resultados.push('UI duas abas: versao 2 real, 409 preserva rascunho e reabertura explicita recupera vencedor');

    etapa = 'proposta UI';
    await p.getByRole('button', { name: 'Nova proposta', exact: true }).click();
    for (const id of itemIds) { await p.locator(`[data-item][value="${id}"]`).check(); await p.locator(`[name="unidade-${id}"]`).fill('un'); }
    assert.equal(await p.getByRole('checkbox', { name: /Item valido excluido QA/ }).isChecked(), false);
    for (const [label, value] of [['Validade da proposta', '60 dias'], ['Prazo de entrega', '12 dias'], ['Condições de pagamento', '30 dias']]) await p.getByLabel(label, { exact: true }).fill(value);
    const proposal = (await salvar(p)).documento; documentos.push(proposal.id);
    registrarFixture('peca', proposal.id);
    await revisar(p); const textoProposta = await baixar(p, 'ui-proposta-real.docx', empresas[0], 'Total da proposta: R$ 7,04');
    for (const descricao of ['Item decimal QA', 'Item inteiro QA']) assert(textoProposta.includes(descricao), 'Item selecionado no DOCX da UI');
    assert(!textoProposta.includes('Item valido excluido QA'), 'Item valido nao selecionado ausente do DOCX da UI');
    const [dados] = await Promise.all([contexto.waitForEvent('page'), p.getByRole('link', { name: 'Conferir dados da empresa (nova aba)' }).click()]);
    await cadastroPronto(dados, empresas[0]);
    assert(await p.locator('[data-exportar]').isDisabled()); assert.equal(await p.locator('[data-revisado]').isChecked(), false);
    await dados.close();
    await acao(p, 'consultar', () => p.getByRole('button', { name: 'Atualizar lista', exact: true }).click());
    assert.equal(await p.getByLabel('Condições de pagamento', { exact: true }).inputValue(), '30 dias');
    assert(await p.locator('[data-exportar]').isDisabled());
    await p.getByLabel('Condições de pagamento', { exact: true }).fill('45 dias');
    assert.equal((await salvar(p)).documento.versao, 2);
    await p.reload(); await kitPronto(p, empresas[0]); await abrir(p, proposal.id);
    assert.equal(await p.getByLabel('Condições de pagamento', { exact: true }).inputValue(), '45 dias');
    await revisar(p);
    for (const width of [375, 1280]) { await p.setViewportSize({ width, height: 950 }); assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Kit sem overflow'); await p.screenshot({ path: path.join(evidencias, `kit-real-${width}.png`), fullPage: true }); }
    resultados.push('UI proposta real: itens, DOCX 7,04, cadastro invalida revisao, edicao salva versao 2 e reabre pagamento 45 dias');
    assert.deepEqual(erros, []); assert.deepEqual(externas, []);
  } catch (e) { failure = e; }
  finally {
    await contexto.close(); await browser.close();
    const report = { aprovado: !failure, etapa, authFresh, resultados, documentos, erros, externas, requisicoes, erro: failure ? sanear(failure) : null };
    fs.writeFileSync(path.join(evidencias, 'ui-real.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  }
  if (failure) throw new Error('UI real / ' + etapa + ': ' + sanear(failure));
  return { resultados, documentos };
}
module.exports = { verificarUIReal, esperarAcao };
