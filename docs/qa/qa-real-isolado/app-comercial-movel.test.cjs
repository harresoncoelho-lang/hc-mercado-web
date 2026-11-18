// Validação de /app com servidor QA real (login, sessão e descoberta filtrada pela allowlist, com doubles de REST)
// e módulos reais do navegador. As respostas de /api/kit-documentos e /api/empresa-identificacao são SIMULADAS
// no navegador (page.route) e marcadas como tal nas evidências. Não há autenticação real aqui.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { criarServidor } = require('./servidor.cjs');
const { preparar, QA } = require('./isolamento.cjs');

const USER = '258eddfe-d761-4ec9-ae63-ee5e5b8db408';
const ORG_A = 'a1000000-0000-4000-8000-000000000001', ORG_B = 'b1000000-0000-4000-8000-000000000001';
const EMP_A = 'a1000000-0000-4000-8000-000000000002', EMP_B = 'b1000000-0000-4000-8000-000000000002';
const PROC_A = 'a1000000-0000-4000-8000-000000000003', PROC_A2 = 'a1000000-0000-4000-8000-000000000004';
const PROC_B = 'b1000000-0000-4000-8000-000000000003';
// Empresa autorizada SEM processo (fixture de empresa, fora dos pares): alvo do onboarding.
const EMP_C = 'c1000000-0000-4000-8000-000000000002';
const ITEM = 'e1000000-0000-4000-8000-000000000001';
const ALLOWLIST = [{ empresaId: EMP_A, processoId: PROC_A }, { empresaId: EMP_A, processoId: PROC_A2 }, { empresaId: EMP_B, processoId: PROC_B }];
const SHOTS = process.env.LAYOUT_SHOTS_DIR || null;

function servidorQA(t) {
  const copia = preparar({ authUrl: QA, restUrl: QA, storageUrl: QA, publicKey: 'sb_publishable_qa_ficticia' });
  const membro = org => ({ usuario_id: USER, organizacao_id: org, empresa_id: null, papel: 'operador' });
  const s = criarServidor({ copia, serviceKey: 'SERVICE-SECRETA', emailsPermitidos: ['operador-a@qa.invalid'], contextos: ALLOWLIST, empresasQA: [EMP_C], fetchImpl: async url => {
    const u = new URL(url);
    if (u.pathname === '/auth/v1/token') return Response.json({ access_token: 'TOKEN-FICTICIO', expires_in: 600, user: { id: USER } });
    if (u.pathname === '/rest/v1/operacao_membros') return Response.json([membro(ORG_A), membro(ORG_B)]);
    if (u.pathname === '/rest/v1/operacao_empresas') return Response.json([{ id: EMP_A, organizacao_id: ORG_A, razao_social: 'EMPRESA FICTÍCIA A', ativo: true }, { id: EMP_B, organizacao_id: ORG_B, razao_social: 'EMPRESA FICTÍCIA B', ativo: true }, { id: EMP_C, organizacao_id: ORG_A, razao_social: 'EMPRESA FICTÍCIA C (sem processo)', ativo: true }]);
    if (u.pathname === '/rest/v1/operacao_processos') return Response.json([
      { id: PROC_A, empresa_id: EMP_A, organizacao_id: ORG_A }, { id: PROC_A2, empresa_id: EMP_A, organizacao_id: ORG_A },
      { id: PROC_B, empresa_id: EMP_B, organizacao_id: ORG_B }]);
    throw Error('Destino inesperado ' + u.pathname);
  } });
  return new Promise(resolve => s.listen(0, '127.0.0.1', () => { t.after(() => new Promise(r => s.close(r))); resolve(s.address().port); }));
}

// Respostas simuladas por processo (dados fictícios; não representam o banco real).
function simular(page, documentos, evidencias) {
  const porProcesso = {
    [PROC_A]: { empresa: EMP_A, razao: 'EMPRESA FICTÍCIA A', cnpj: '11222333000181', numero: 'PE-FICT-A-001' },
    [PROC_A2]: { empresa: EMP_A, razao: 'EMPRESA FICTÍCIA A', cnpj: '11222333000181', numero: 'PE-FICT-A-002' },
    [PROC_B]: { empresa: EMP_B, razao: 'EMPRESA FICTÍCIA B', cnpj: '11222333000262', numero: 'PE-FICT-B-001' },
  };
  const json = (route, status, obj) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });
  const itensSalvos = new Map();
  const porEmpresa = { [EMP_C]: { empresa: EMP_C, razao: 'EMPRESA FICTÍCIA C', cnpj: '11222333000424', numero: null } };
  page.route('**/api/empresa-identificacao', async route => {
    const b = route.request().postDataJSON();
    const d = Object.values(porProcesso).find(x => x.empresa === b.empresaId) || porEmpresa[b.empresaId];
    // Isolamento: identificação recebe só a empresa (sem processoId), inclusive na preparação.
    evidencias.push({ rota: 'api/empresa-identificacao', acao: b.acao, empresa: b.empresaId, temProcesso: 'processoId' in b, status: d ? 200 : 404, origem: 'simulada' });
    if (!d) return json(route, 404, { erro: 'Empresa indisponível.' });
    return json(route, 200, { empresa: { id: b.empresaId, razao_social: d.razao, cnpj: d.cnpj }, documentos: [], perfil: null });
  });
  page.route('**/api/kit-documentos', async route => {
    const b = route.request().postDataJSON();
    const d = porProcesso[b.processoId];
    const chave = b.empresaId + ':' + b.processoId;
    if (b.empresaId === EMP_C) evidencias.push({ rota: 'api/kit-documentos', acao: b.acao, empresa: EMP_C, status: 'ERRO-kit-em-empresa-sem-processo', origem: 'simulada' });
    if (!d || d.empresa !== b.empresaId) { evidencias.push({ rota: 'api/kit-documentos', acao: b.acao, status: 403, origem: 'simulada' }); return json(route, 403, {}); }
    const itens = [{ id: ITEM, tipo: 'item', identificador: '1', descricao: 'Item fictício', quantidade: 2, valorUnitario: 100, marca: '', modelo: '' }];
    const consulta = { empresa: { id: b.empresaId, razaoSocial: d.razao, cnpj: d.cnpj }, processo: { id: b.processoId, numero: d.numero, orgao: 'Órgão fictício' }, identificacao: { status: 'pendente' }, itens, requisitos: ['Certidão fictícia'], pendencias: [], paginacaoItens: { hasMore: false, nextCursor: null }, limitesProposta: { itens: 100 } };
    let corpo;
    // MOCK: consultar devolve também os itens salvos neste navegador (catálogo renovado após salvar item).
    if (b.acao === 'consultar') corpo = { ...consulta, itens: [...itens, ...(itensSalvos.get(b.processoId) || [])] };
    else if (b.acao === 'listarItens') corpo = { ...consulta, itens: [...itens, ...(itensSalvos.get(b.processoId) || [])], paginacaoItens: { hasMore: false, nextCursor: null } };
    else if (b.acao === 'salvarItem') {
      // MOCK de /api/kit-documentos (salvarItem): validação mínima simulada; nenhuma gravação real.
      const i = b.item || {};
      if (String(i.quantidade).startsWith('-') || String(i.valorUnitario).startsWith('-')) { evidencias.push({ rota: 'api/kit-documentos', acao: 'salvarItem', empresaId: b.empresaId, processoId: b.processoId, status: 400, origem: 'simulada' }); return json(route, 400, { erro: 'Quantidade e valor devem ser positivos.' }); }
      const lista = itensSalvos.get(b.processoId) || [];
      const existente = lista.find(x => x.id === i.id);
      const novo = { id: i.id, tipo: 'item', identificador: i.identificador, descricao: i.descricao, quantidade: i.quantidade, valorUnitario: i.valorUnitario, marca: i.marca, modelo: i.modelo };
      if (existente) Object.assign(existente, novo); else lista.push(novo);
      itensSalvos.set(b.processoId, lista);
      evidencias.push({ rota: 'api/kit-documentos', acao: 'salvarItem', modo: b.modo, empresaId: b.empresaId, processoId: b.processoId, status: existente ? 200 : 201, origem: 'simulada' });
      return json(route, existente ? 200 : 201, { item: novo, reaproveitado: false });
    }
    else if (b.acao === 'listar') corpo = { documentos: documentos.get(chave) || [] };
    else if (b.acao === 'salvar') {
      const doc = { id: b.documentoId || b.id || '11111111-1111-4111-8111-111111111111', empresaId: b.empresaId, processoId: b.processoId, tipo: 'proposta', titulo: 'Nova proposta', versao: 1, dados: { proposta: b.proposta || {} } };
      documentos.set(chave, [doc]); corpo = { documento: doc };
    } else if (b.acao === 'preparar') corpo = { previa: { texto: 'Prévia fictícia integral.', fontes: ['Edital fictício'] }, revisaoHash: 'a'.repeat(64) };
    else if (b.acao === 'abrir') corpo = { documento: (documentos.get(chave) || [])[0] || null, revisaoVigente: false, itensNaoVerificados: false };
    else { evidencias.push({ rota: 'api/kit-documentos', acao: b.acao, status: 400, origem: 'simulada' }); return json(route, 400, {}); }
    evidencias.push({ rota: 'api/kit-documentos', acao: b.acao, empresaId: b.empresaId, processoId: b.processoId, processo: d.numero, status: 200, origem: 'simulada' });
    return json(route, 200, corpo);
  });
}

async function medir(page) {
  return page.evaluate(() => {
    const visivel = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[hidden]'); };
    const controles = [...document.querySelectorAll('button, input:not([type=hidden]), select, textarea, a[href]')].filter(visivel);
    const alvo = el => { if (el.type !== 'checkbox' && el.type !== 'radio') return el; const r = el.closest('label') || (el.id && document.querySelector(`label[for="${el.id}"]`)); return r || el; };
    const fora = controles.filter(el => { const r = el.getBoundingClientRect(); return r.left < -0.5 || r.right > window.innerWidth + 0.5; }).map(el => el.textContent.trim().slice(0, 40) || el.name || el.id);
    const pequenos = controles.filter(el => alvo(el).getBoundingClientRect().height < 43.5).map(el => (el.textContent.trim().slice(0, 40) || el.id || el.name || el.tagName));
    return {
      largura: window.innerWidth, scrollX: document.documentElement.scrollWidth - window.innerWidth,
      controles: controles.length, foraDaTela: fora, alvosMenoresQue44: pequenos,
      tema: document.documentElement.dataset.theme,
      camposVisiveis: ['login', 'hoje', 'hoje-lista', 'area', 'empresa-ativa', 'processo-ativo', 'identificacao', 'kit'].filter(id => { const e = document.getElementById(id); return e && visivel(e); }),
    };
  });
}

const cenarios = [
  { nome: '375-claro', largura: 375, tema: 'light' },
  { nome: '375-escuro', largura: 375, tema: 'dark' },
  { nome: '390-claro', largura: 390, tema: 'light' },
  { nome: '390-escuro', largura: 390, tema: 'dark' },
];

for (const c of cenarios) {
  test(`/app ${c.nome}: login, descoberta, empresa→processo, identificação, lista e proposta`, async t => {
    const porta = await servidorQA(t);
    const base = `http://127.0.0.1:${porta}`;
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const ctx = await browser.newContext({ viewport: { width: c.largura, height: 844 }, deviceScaleFactor: 2 });
    await ctx.addInitScript(tema => { try { localStorage.setItem('licitaplena.tema', tema); } catch { /* sem storage */ } }, c.tema);
    const page = await ctx.newPage();
    const documentos = new Map(), evidencias = [];
    simular(page, documentos, evidencias);
    let sessaoJson = null;
    page.on('response', async r => { if (r.url() === base + '/qa/session' && r.status() === 200) sessaoJson = await r.json(); });
    const medidas = {};
    const registrar = async etapa => { medidas[etapa] = await medir(page); if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `app_${c.nome}_${etapa}.png`), fullPage: true }); };
    await page.goto(base + '/app');
    await page.waitForSelector('#login:not([hidden])');
    await registrar('1login');
    await page.fill('#app-login input[name="email"]', 'operador-a@qa.invalid');
    await page.fill('#app-login input[name="password"]', 'FICTICIA-NAO-REAL');
    await page.click('#login-entrar');
    // Login leva ao Hoje (sem módulo montado). Abre o processo pelo botão do Hoje.
    await page.waitForSelector('button[data-processo]');
    await page.waitForFunction(() => !document.getElementById('hoje').hidden && document.getElementById('area').hidden);
    await registrar('0hoje');
    await page.click(`button[data-processo="${PROC_A}"]`);
    await page.waitForSelector('#area:not([hidden])');
    await page.waitForSelector('#identificacao details');
    await page.waitForFunction(() => document.querySelector('[data-lista]') && !document.querySelector('[data-lista] p')?.textContent.includes('Carregando'), null, { timeout: 15000 });
    assert.ok(sessaoJson && sessaoJson.contextos.length === 3, 'descoberta devolveu os três pares da allowlist');
    assert.deepEqual((await page.$$eval('#empresa-ativa option', os => os.map(o => o.value))).sort(), [EMP_A, EMP_B, EMP_C].sort(), 'empresas distintas (inclui a sem processo)');
    assert.deepEqual(await page.$$eval('#processo-ativo option', os => os.map(o => o.value)), [PROC_A, PROC_A2], 'processos da empresa ativa');
    await registrar('2empresa');
    await page.selectOption('#processo-ativo', PROC_A2);
    await page.waitForFunction(() => document.querySelector('#contexto-atual')?.textContent.includes('PE-FICT-A-002'), null, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelector('[data-lista]') && !document.querySelector('[data-lista] p')?.textContent.includes('Carregando'), null, { timeout: 15000 });
    assert.equal(await page.textContent('#kit').then(x => x.includes('PE-FICT-A-001')), false, 'módulo do processo anterior foi limpo');
    await page.selectOption('#empresa-ativa', EMP_B);
    await page.waitForFunction(() => document.querySelector('#contexto-atual')?.textContent.includes('PE-FICT-B-001'), null, { timeout: 15000 });
    assert.deepEqual(await page.$$eval('#processo-ativo option', os => os.map(o => o.value)), [PROC_B], 'processos da empresa B');
    await page.selectOption('#empresa-ativa', EMP_A);
    await page.waitForFunction(() => document.querySelector('#contexto-atual')?.textContent.includes('PE-FICT-A-001'), null, { timeout: 15000 });
    await page.selectOption('#processo-ativo', PROC_A2);
    await page.waitForFunction(() => document.querySelector('#contexto-atual')?.textContent.includes('PE-FICT-A-002'), null, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelector('[data-lista]') && !document.querySelector('[data-lista] p')?.textContent.includes('Carregando'), null, { timeout: 15000 });
    await registrar('3identificacao');
    await page.click('[data-novo="proposta"]');
    await page.waitForSelector('[data-proposta]:not([hidden])');
    await page.click('[data-salvar]');
    await page.waitForFunction(() => /Salvo|pendente|Rascunho salvo/i.test(document.querySelector('[data-aviso]')?.textContent || '') || document.querySelector('[data-peca]')?.textContent.includes('Nova proposta'), null, { timeout: 15000 });
    await page.click('[data-preparar]').catch(() => {});
    await page.waitForFunction(() => document.querySelector('[data-previa]')?.textContent.includes('Prévia fictícia'), null, { timeout: 15000 }).catch(() => {});
    await registrar('4proposta');
    for (const [etapa, m] of Object.entries(medidas)) {
      assert.equal(m.scrollX <= 0, true, `${etapa}: sem rolagem horizontal (${m.scrollX}px)`);
      assert.deepEqual(m.foraDaTela, [], `${etapa}: controles fora da tela`);
      assert.deepEqual(m.alvosMenoresQue44, [], `${etapa}: alvos menores que 44px`);
      assert.equal(m.tema, c.tema, `${etapa}: tema ${c.tema} aplicado`);
    }
    assert.ok(medidas['4proposta'].camposVisiveis.includes('kit'), 'kit visível na proposta');
    assert.equal(await page.textContent('[data-previa]').then(x => x.includes('Prévia fictícia')), true, 'prévia exibida com resposta simulada 200');
    if (SHOTS) fs.writeFileSync(path.join(SHOTS, `evidencias_${c.nome}.json`), JSON.stringify({ cenario: c.nome, aviso: 'Respostas de /api/* simuladas no navegador; servidor QA real com doubles de REST; sem autenticação real.', descoberta: sessaoJson.contextos, medidas, chamadas: evidencias }, null, 2));
  });
}

test('/app 390-claro: cancelar confirm preserva rascunho e seletor; aceitar descarta', async t => {
  const porta = await servidorQA(t);
  const base = `http://127.0.0.1:${porta}`;
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  simular(page, new Map(), []);
  const dialogos = [];
  await page.goto(base + '/app');
  await page.waitForSelector('#login:not([hidden])');
  await page.fill('#app-login input[name="email"]', 'operador-a@qa.invalid');
  await page.fill('#app-login input[name="password"]', 'FICTICIA-NAO-REAL');
  await page.click('#login-entrar');
  await page.waitForSelector('button[data-processo]');
  await page.click(`button[data-processo="${PROC_A}"]`);
  await page.waitForFunction(() => document.querySelector('[data-novo="proposta"]') && !document.querySelector('[data-lista] p')?.textContent.includes('Carregando'), null, { timeout: 15000 });
  await page.click('[data-novo="proposta"]');
  await page.waitForSelector('[data-proposta]:not([hidden])');
  await page.fill('[data-proposta] input[name="validade"]', '2026-12-31');
  // Cancelar: nada muda.
  page.once('dialog', d => { dialogos.push(d.message()); d.dismiss(); });
  await page.selectOption('#empresa-ativa', EMP_B);
  await page.waitForTimeout(300);
  assert.equal(await page.inputValue('#empresa-ativa'), EMP_A, 'seletor de empresa voltou ao atual');
  assert.match(await page.textContent('#contexto-atual'), /PE-FICT-A-001/);
  assert.equal(await page.inputValue('[data-proposta] input[name="validade"]'), '2026-12-31', 'rascunho preservado');
  // Aceitar: descarta e troca.
  page.once('dialog', d => { dialogos.push(d.message()); d.accept(); });
  await page.selectOption('#empresa-ativa', EMP_B);
  await page.waitForFunction(() => document.querySelector('#contexto-atual')?.textContent.includes('PE-FICT-B-001'), null, { timeout: 15000 });
  assert.equal(dialogos.length, 2, 'confirmação pedida nas duas trocas');
  assert.ok(dialogos.every(m => /não salvas/.test(m)));
});

test('/app teclado 390-claro: Hoje abre processo com Enter, volta com teclado e abre o segundo processo', async t => {
  const porta = await servidorQA(t);
  const base = `http://127.0.0.1:${porta}`;
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  simular(page, new Map(), []);
  await page.goto(base + '/app');
  await page.waitForSelector('#login:not([hidden])');
  await page.fill('#app-login input[name="email"]', 'operador-a@qa.invalid');
  await page.fill('#app-login input[name="password"]', 'FICTICIA-NAO-REAL');
  await page.click('#login-entrar');
  await page.waitForSelector(`button[data-processo="${PROC_A}"]`);
  // Tab a partir do título do Hoje alcança o primeiro "Abrir processo".
  await page.focus('#hoje-titulo');
  // Tab percorre os controles do Hoje (inclui "Preparar empresa" da empresa sem processo) até o primeiro processo.
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); if (await page.evaluate(() => document.activeElement?.dataset?.processo) === PROC_A) break; }
  assert.equal(await page.evaluate(() => document.activeElement?.dataset?.processo), PROC_A, 'Tab chega ao primeiro processo do Hoje');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#area:not([hidden])');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'area-titulo', 'foco vai para o título do processo');
  await page.focus('#voltar-hoje');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#hoje:not([hidden])');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'hoje-titulo', 'foco volta ao título do Hoje');
  await page.focus(`button[data-processo="${PROC_A2}"]`);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#contexto-atual')?.textContent.includes('PE-FICT-A-002'), null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => document.getElementById('hoje').hidden), true, 'Hoje oculto no processo');
});

// ---- Onboarding: Preparar empresa sem processo e Novo processo, nos quatro cenários móveis ----
for (const c of cenarios) {
  test(`/app ${c.nome}: preparar empresa sem processo (sem kit), voltar preservando e medir Novo processo`, async t => {
    const porta = await servidorQA(t);
    const base = `http://127.0.0.1:${porta}`;
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const ctx = await browser.newContext({ viewport: { width: c.largura, height: 844 }, deviceScaleFactor: 2 });
    await ctx.addInitScript(tema => { try { localStorage.setItem('licitaplena.tema', tema); } catch { /* sem storage */ } }, c.tema);
    const page = await ctx.newPage();
    const documentos = new Map(), evidencias = [];
    simular(page, documentos, evidencias);
    const medidas = {};
    const registrar = async etapa => { medidas[etapa] = await medir(page); if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `onboarding_${c.nome}_${etapa}.png`), fullPage: true }); };
    await page.goto(base + '/app');
    await page.waitForSelector('#login:not([hidden])');
    await page.fill('#app-login input[name="email"]', 'operador-a@qa.invalid');
    await page.fill('#app-login input[name="password"]', 'FICTICIA-NAO-REAL');
    await page.click('#login-entrar');
    await page.waitForSelector(`button[data-preparar-empresa="${EMP_C}"]`);
    await registrar('0hoje');
    await page.click(`button[data-preparar-empresa="${EMP_C}"]`);
    await page.waitForSelector('#identificacao details', { timeout: 15000 });
    assert.equal(await page.isVisible('#kit'), false, 'kit oculto na preparação');
    assert.equal(await page.$eval('#kit', k => k.childElementCount), 0, 'kit sem montagem');
    assert.match(await page.textContent('#contexto-atual'), /Preparar empresa: EMPRESA FICTÍCIA C/);
    await registrar('1preparar');
    await page.click('#voltar-hoje');
    await page.waitForSelector('#hoje:not([hidden])');
    await registrar('2voltar');
    await page.click(`button[data-novo-empresa="${EMP_A}"]`);
    await page.waitForSelector('#novo-processo-bloco:not([hidden])');
    await page.fill('#form-novo-processo textarea[name="objeto"]', 'Aquisição fictícia de equipamentos');
    await page.fill('#form-novo-processo input[name="numero"]', 'PE-FICT-NOVO-1');
    await registrar('3novo-processo');
    const kitsEmC = evidencias.filter(e => e.empresa === EMP_C && e.rota === 'api/kit-documentos');
    assert.equal(kitsEmC.length, 0, 'nenhuma chamada de kit para empresa sem processo');
    const identsEmC = evidencias.filter(e => e.rota === 'api/empresa-identificacao' && e.empresa === EMP_C);
    assert.ok(identsEmC.length >= 1 && identsEmC.every(e => e.temProcesso === false), 'identificação sem processoId');
    for (const [etapa, m] of Object.entries(medidas)) {
      assert.equal(m.scrollX <= 0, true, `${etapa}: sem rolagem horizontal (${m.scrollX}px)`);
      assert.deepEqual(m.foraDaTela, [], `${etapa}: controles fora da tela`);
      assert.deepEqual(m.alvosMenoresQue44, [], `${etapa}: alvos menores que 44px`);
      assert.equal(m.tema, c.tema, `${etapa}: tema ${c.tema} aplicado`);
    }
    assert.ok(medidas['3novo-processo'].camposVisiveis.includes('hoje'), 'formulário novo no Hoje');
  });
}

test('/app teclado 390-claro: Preparar empresa e Novo processo funcionam só pelo teclado', async t => {
  const porta = await servidorQA(t);
  const base = `http://127.0.0.1:${porta}`;
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  simular(page, new Map(), []);
  await page.goto(base + '/app');
  await page.waitForSelector('#login:not([hidden])');
  await page.fill('#app-login input[name="email"]', 'operador-a@qa.invalid');
  await page.fill('#app-login input[name="password"]', 'FICTICIA-NAO-REAL');
  await page.click('#login-entrar');
  await page.waitForSelector(`button[data-preparar-empresa="${EMP_C}"]`);
  await page.focus(`button[data-preparar-empresa="${EMP_C}"]`);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#identificacao details', { timeout: 15000 });
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'area-titulo', 'foco no título da preparação');
  await page.focus('#voltar-hoje');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#hoje:not([hidden])');
  await page.focus(`button[data-novo-empresa="${EMP_A}"]`);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#novo-processo-bloco:not([hidden])');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'novo-processo-titulo', 'foco no título do formulário');
  await page.focus('#form-novo-processo textarea[name="objeto"]');
  await page.keyboard.type('Aquisição fictícia');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'novo-processo-cancelar', 'Tab percorre numero, órgão, modalidade, Cadastrar e chega a Cancelar');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('novo-processo-bloco').hidden === true);
  assert.equal(await page.inputValue('#form-novo-processo textarea[name="objeto"]'), '', 'cancelar limpa o formulário');
});

// ---- Itens do processo (MOCK de /api/kit-documentos: salvarItem/listarItens simulados no navegador) ----
// Capturas e evidências desta seção são de respostas SIMULADAS; nenhuma gravação real ocorre aqui.
for (const c of cenarios) {
  test(`/app ${c.nome}: itens do processo (mock) — cadastro, total exato, negativo recusado e isolamento por CNPJ`, async t => {
    const porta = await servidorQA(t);
    const base = `http://127.0.0.1:${porta}`;
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const ctx = await browser.newContext({ viewport: { width: c.largura, height: 844 }, deviceScaleFactor: 2 });
    await ctx.addInitScript(tema => { try { localStorage.setItem('licitaplena.tema', tema); } catch { /* sem storage */ } }, c.tema);
    const page = await ctx.newPage();
    const evidencias = [], documentos = new Map();
    simular(page, documentos, evidencias);
    const chamadasItens = [];
    page.on('request', req => {
      if (req.url().endsWith('/api/kit-documentos') && req.method() === 'POST') {
        const b = JSON.parse(req.postData() || '{}');
        if (b.acao === 'listarItens' || b.acao === 'salvarItem') chamadasItens.push({ acao: b.acao, empresaId: b.empresaId, processoId: b.processoId });
      }
    });
    const medidas = {};
    const registrar = async etapa => { medidas[etapa] = await medir(page); if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `itens_${c.nome}_${etapa}.png`), fullPage: true }); };
    await page.goto(base + '/app');
    await page.waitForSelector('#login:not([hidden])');
    await page.fill('#app-login input[name="email"]', 'operador-a@qa.invalid');
    await page.fill('#app-login input[name="password"]', 'FICTICIA-NAO-REAL');
    await page.click('#login-entrar');
    await page.waitForSelector('button[data-processo]');
    await page.click(`button[data-processo="${PROC_A}"]`);
    await page.waitForSelector('#itens-processo form');
    await page.waitForFunction(() => document.querySelector('#itens-processo [data-item-lista] li'), null, { timeout: 15000 });
    assert.match(await page.textContent('#itens-processo [data-item-lista]'), /Item fictício/, 'lista inicial de itens (mock)');
    await registrar('1lista');
    const form = '#itens-processo form';
    await page.fill(`${form} input[name="identificador"]`, '2');
    await page.fill(`${form} textarea[name="descricao"]`, 'Item fictício de teste');
    await page.fill(`${form} input[name="marca"]`, 'MARCA FICTÍCIA');
    await page.fill(`${form} input[name="modelo"]`, 'MODELO-X');
    await page.fill(`${form} input[name="quantidade"]`, '2.500');
    await page.fill(`${form} input[name="valorUnitario"]`, '1.10');
    assert.match(await page.textContent('#itens-processo [data-item-total]'), /R\$ 2,75/, 'total exato 2.500 × 1.10 = R$ 2,75');
    await registrar('2preenchido');
    // Negativo: recusado no navegador, sem envio ao mock.
    const antes = chamadasItens.filter(x => x.acao === 'salvarItem').length;
    await page.fill(`${form} input[name="quantidade"]`, '-1');
    await page.click(`${form} [data-item-salvar]`);
    assert.match(await page.textContent('#itens-processo [data-item-erros]'), /Quantidade/, 'quantidade negativa recusada');
    assert.equal(chamadasItens.filter(x => x.acao === 'salvarItem').length, antes, 'negativo não chega ao servidor');
    await page.fill(`${form} input[name="quantidade"]`, '2.500');
    await page.click(`${form} [data-item-salvar]`);
    await page.waitForFunction(() => document.querySelector('#itens-processo [data-item-estado]')?.textContent.includes('Item salvo'), null, { timeout: 15000 });
    await page.waitForFunction(() => [...document.querySelectorAll('#itens-processo [data-item-lista] li strong')].some(s => s.textContent === '2'), null, { timeout: 15000 });
    await registrar('3salvo');
    // Isolamento: todas as chamadas de itens carregam só EMP_A e PROC_A.
    assert.ok(chamadasItens.length >= 3, 'chamadas de itens observadas');
    assert.ok(chamadasItens.every(x => x.empresaId === EMP_A && x.processoId === PROC_A), 'itens só do CNPJ A / processo A');
    for (const [etapa, m] of Object.entries(medidas)) {
      assert.equal(m.scrollX <= 0, true, `${etapa}: sem rolagem horizontal (${m.scrollX}px)`);
      assert.deepEqual(m.foraDaTela, [], `${etapa}: controles fora da tela`);
      assert.deepEqual(m.alvosMenoresQue44, [], `${etapa}: alvos menores que 44px`);
      assert.equal(m.tema, c.tema, `${etapa}: tema ${c.tema} aplicado`);
    }
    if (SHOTS) fs.writeFileSync(path.join(SHOTS, `evidencias_itens_${c.nome}.json`), JSON.stringify({ cenario: c.nome, aviso: 'MOCK: respostas de /api/kit-documentos (listarItens, salvarItem) simuladas no navegador; nenhuma gravação real; servidor QA com doubles de REST; sem autenticação real.', medidas, chamadasItens, chamadas: evidencias.filter(e => e.acao === 'salvarItem' || e.acao === 'listarItens') }, null, 2));
  });
}

test('/app teclado 390-claro: formulário de itens sem mouse (foco, digitação, Tab e Enter envia)', async t => {
  const porta = await servidorQA(t);
  const base = `http://127.0.0.1:${porta}`;
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  simular(page, new Map(), []);
  await page.goto(base + '/app');
  await page.waitForSelector('#login:not([hidden])');
  await page.fill('#app-login input[name="email"]', 'operador-a@qa.invalid');
  await page.fill('#app-login input[name="password"]', 'FICTICIA-NAO-REAL');
  await page.click('#login-entrar');
  await page.waitForSelector('button[data-processo]');
  await page.focus(`button[data-processo="${PROC_A}"]`);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#itens-processo form');
  await page.waitForFunction(() => document.querySelector('#itens-processo [data-item-lista] li'), null, { timeout: 15000 });
  await page.focus('#itens-processo input[name="identificador"]');
  await page.keyboard.type('3');
  await page.keyboard.press('Tab'); // descrição
  await page.keyboard.type('Item via teclado');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab'); // marca, modelo, quantidade, valor
  assert.equal(await page.evaluate(() => document.activeElement?.name), 'valorUnitario', 'Tab percorre os campos do item');
  await page.keyboard.type('1.10');
  await page.keyboard.press('Tab'); // total (texto) não é foco; próximo controle é Salvar
  await page.focus('#itens-processo input[name="quantidade"]');
  await page.keyboard.type('4');
  assert.match(await page.textContent('#itens-processo [data-item-total]'), /R\$ 4,40/, 'total atualiza pelo teclado');
  await page.focus('#itens-processo input[name="identificador"]');
  await page.keyboard.press('Enter'); // Enter em campo de texto de form com submit: envia
  await page.waitForFunction(() => document.querySelector('#itens-processo [data-item-estado]')?.textContent.includes('Item salvo'), null, { timeout: 15000 });
  assert.equal(await page.inputValue('#itens-processo input[name="identificador"]'), '', 'formulário limpo após salvar');
});

// ---- Catálogo do kit após salvar item (MOCK de /api/kit-documentos; sem gravação real) ----
const esperar = async (fn, ms = 15000) => { const t0 = Date.now(); while (!(await fn())) { if (Date.now() - t0 > ms) throw new Error('tempo esgotado'); await new Promise(r => setTimeout(r, 50)); } };

async function abrirComKit(page, base) {
  await page.goto(base + '/app');
  await page.waitForSelector('#login:not([hidden])');
  await page.fill('#app-login input[name="email"]', 'operador-a@qa.invalid');
  await page.fill('#app-login input[name="password"]', 'FICTICIA-NAO-REAL');
  await page.click('#login-entrar');
  await page.waitForSelector('button[data-processo]');
  await page.click(`button[data-processo="${PROC_A}"]`);
  await page.waitForFunction(() => document.querySelector('#itens-processo [data-item-lista] li') && document.querySelector('[data-lista]') && !document.querySelector('[data-lista] p')?.textContent.includes('Carregando'), null, { timeout: 15000 });
}

async function salvarItemNovo(page, descricao) {
  const f = '#itens-processo form';
  await page.fill(`${f} input[name="identificador"]`, '2');
  await page.fill(`${f} textarea[name="descricao"]`, descricao);
  await page.fill(`${f} input[name="quantidade"]`, '1');
  await page.fill(`${f} input[name="valorUnitario"]`, '5.00');
  await page.click(`${f} [data-item-salvar]`);
  await page.waitForFunction(() => document.querySelector('#itens-processo [data-item-estado]')?.textContent.includes('Item salvo'), null, { timeout: 15000 });
}

test('/app 390-claro: item salvo renova o catálogo do kit, preserva rascunho e invalida a prévia (mock)', async t => {
  const porta = await servidorQA(t);
  const base = `http://127.0.0.1:${porta}`;
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })).newPage();
  simular(page, new Map(), []);
  await abrirComKit(page, base);
  // Rascunho de proposta com validade preenchida e prévia preparada antes do item.
  await page.click('[data-novo="proposta"]');
  await page.waitForSelector('[data-proposta]:not([hidden])');
  await page.fill('[data-proposta] input[name="validade"]', '2026-12-31');
  await page.click('[data-salvar]');
  await page.waitForFunction(() => document.querySelector('[data-aviso]')?.textContent.includes('Rascunho salvo'), null, { timeout: 15000 });
  await page.click('[data-preparar]');
  await page.waitForFunction(() => document.querySelector('[data-previa]')?.textContent.includes('Prévia fictícia'), null, { timeout: 15000 });
  assert.equal(await page.isDisabled('[data-exportar]'), true, 'exportação indisponível antes da revisão');
  await salvarItemNovo(page, 'Item para catálogo renovado');
  // Catálogo do kit foi consultado de novo e mostra o item salvo.
  await esperar(async () => (await page.textContent('#kit')).includes('Item para catálogo renovado'));
  // Rascunho preservado.
  assert.equal(await page.inputValue('[data-proposta] input[name="validade"]'), '2026-12-31', 'rascunho preservado');
  // Prévia antiga não vale mais.
  await esperar(async () => (await page.textContent('[data-previa]')).includes('Itens atualizados'));
  assert.equal(await page.isDisabled('[data-exportar]'), true, 'exportação continua indisponível após atualização de itens');
  assert.equal(await page.isEnabled('[data-preparar]'), true, 'nova prévia pode ser preparada');
});

test('/app 390-claro: resposta antiga do kit é ignorada após trocar de processo durante atualização (mock)', async t => {
  const porta = await servidorQA(t);
  const base = `http://127.0.0.1:${porta}`;
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })).newPage();
  simular(page, new Map(), []);
  await abrirComKit(page, base);
  // Segura (sem responder) a consulta de A disparada pela atualização de itens; o restante segue o mock normal.
  const segurados = []; let segurar = false;
  await page.route('**/api/kit-documentos', async route => {
    const b = route.request().postDataJSON();
    if (segurar && b.acao === 'consultar' && b.processoId === PROC_A) { segurados.push(route); return; }
    return route.fallback();
  });
  segurar = true;
  await salvarItemNovo(page, 'Item de contexto antigo');
  await esperar(async () => segurados.length === 1);
  await page.selectOption('#processo-ativo', PROC_A2);
  await page.waitForFunction(() => document.querySelector('#contexto-atual')?.textContent.includes('PE-FICT-A-002'), null, { timeout: 15000 });
  segurar = false;
  await segurados[0].fallback();   // libera a resposta antiga (processo A) depois da troca
  await new Promise(r => setTimeout(r, 1500));
  const contextoKit = await page.textContent('[data-contexto]');
  assert.match(contextoKit, /PE-FICT-A-002/, 'kit continua no processo atual');
  assert.doesNotMatch(contextoKit, /PE-FICT-A-001/, 'resposta antiga não sobrescreveu o kit');
});

// ---- Atualização de itens com resposta do kit ADIADA (MOCK: respostas simuladas; nenhuma gravação real) ----
function segurarKit(page) {
  const segurados = [], ativo = new Set();
  page.route('**/api/kit-documentos', async route => {
    const b = route.request().postDataJSON();
    if (ativo.has(b.acao)) { ativo.delete(b.acao); segurados.push({ acao: b.acao, route }); return; }
    return route.fallback();
  });
  return { segurados, segurar: a => ativo.add(a) };
}

test('/app 390-claro: atualização durante SALVAR (sucesso): exportação não liberada, drena após a gravação, rascunho preservado (mock)', async t => {
  const porta = await servidorQA(t);
  const base = `http://127.0.0.1:${porta}`;
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })).newPage();
  simular(page, new Map(), []);
  await abrirComKit(page, base);
  await page.click('[data-novo="proposta"]');
  await page.waitForSelector('[data-proposta]:not([hidden])');
  await page.fill('[data-proposta] input[name="validade"]', '2026-12-31');
  const h = segurarKit(page);
  h.segurar('salvar');
  await page.click('[data-salvar]');
  await esperar(() => h.segurados.length === 1);
  await salvarItemNovo(page, 'Item durante salvar');
  assert.equal(await page.isDisabled('[data-exportar]'), true, 'exportação bloqueada com atualização pendente');
  await h.segurados[0].route.fallback();          // gravação confirmada
  await esperar(async () => (await page.textContent('#kit')).includes('Item durante salvar'));
  assert.equal(await page.inputValue('[data-proposta] input[name="validade"]'), '2026-12-31', 'rascunho preservado');
  await esperar(async () => (await page.textContent('[data-previa]')).includes('Itens atualizados'));
  assert.equal(await page.isDisabled('[data-exportar]'), true, 'exportação continua bloqueada até nova prévia');
});

test('/app 390-claro: atualização durante SALVAR com falha: ocupado libera, drena, rascunho preservado e nova tentativa salva (mock)', async t => {
  const porta = await servidorQA(t);
  const base = `http://127.0.0.1:${porta}`;
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })).newPage();
  simular(page, new Map(), []);
  await abrirComKit(page, base);
  await page.click('[data-novo="proposta"]');
  await page.waitForSelector('[data-proposta]:not([hidden])');
  await page.fill('[data-proposta] input[name="validade"]', '2026-12-31');
  const h = segurarKit(page);
  h.segurar('salvar');
  await page.click('[data-salvar]');
  await esperar(() => h.segurados.length === 1);
  await salvarItemNovo(page, 'Item com falha no salvar');
  // Falha simulada da gravação: o kit precisa sair de ocupado e drenar a atualização pendente.
  await h.segurados[0].route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ erro: 'Falha simulada (mock).' }) });
  await esperar(async () => (await page.textContent('#kit')).includes('Item com falha no salvar'));
  await esperar(async () => !(await page.isDisabled('[data-salvar]')));
  assert.equal(await page.inputValue('[data-proposta] input[name="validade"]'), '2026-12-31', 'rascunho preservado após falha');
  assert.equal(await page.isDisabled('[data-exportar]'), true, 'sem exportação após falha');
  await page.click('[data-salvar]');                 // nova tentativa do mesmo rascunho
  await esperar(async () => (await page.textContent('[data-aviso]')).includes('Rascunho salvo'));
});

test('/app 390-claro: atualização durante PREPARAR: prévia antiga não libera exportação; drena após a prévia (mock)', async t => {
  const porta = await servidorQA(t);
  const base = `http://127.0.0.1:${porta}`;
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })).newPage();
  simular(page, new Map(), []);
  await abrirComKit(page, base);
  await page.click('[data-novo="proposta"]');
  await page.waitForSelector('[data-proposta]:not([hidden])');
  await page.fill('[data-proposta] input[name="validade"]', '2026-12-31');
  await page.click('[data-salvar]');
  await esperar(async () => (await page.textContent('[data-aviso]')).includes('Rascunho salvo'));
  const h = segurarKit(page);
  h.segurar('preparar');
  await page.click('[data-preparar]');
  await esperar(() => h.segurados.length === 1);
  await salvarItemNovo(page, 'Item durante preparar');
  assert.equal(await page.isDisabled('[data-exportar]'), true, 'exportação bloqueada durante preparação com itens pendentes');
  await h.segurados[0].route.fallback();            // prévia chega, mas os itens mudaram
  await esperar(async () => (await page.textContent('#kit')).includes('Item durante preparar'));
  await esperar(async () => (await page.textContent('[data-previa]')).includes('Itens atualizados'));
  assert.equal(await page.isDisabled('[data-exportar]'), true, 'prévia antiga não libera exportação');
  assert.equal(await page.inputValue('[data-proposta] input[name="validade"]'), '2026-12-31', 'rascunho preservado');
});
