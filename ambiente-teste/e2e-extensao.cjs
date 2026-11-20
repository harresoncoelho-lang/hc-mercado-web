// Extensão carregada de verdade no Edge (Playwright, launchPersistentContext + --load-extension) contra as fixtures
// HTML locais servidas NO ENDEREÇO do portal por page.route (nada sai para o governo) e o site de teste local.
//   PORTA_TESTE=8831 node ambiente-teste/servidor.cjs     (em outro terminal; Supabase local de pé)
//   SITE_TESTE=http://127.0.0.1:8831 node ambiente-teste/e2e-extensao.cjs
// Cópia de teste da extensão: o pacote de produção (mesmos arquivos de npm run empacotar:extensao) + host_permissions
// do portal e do site local, porque a automação não tem o clique que concede activeTab. O manifesto da pasta não muda.
// Confere: gravar (leitor), preencher (preenche sem clicar Salvar), diagnóstico (estrutura -> /api -> banco, sem CPF),
// acompanhar (notificação, palavra-chave, reconexão depois de recarregar). Prints em PRINTS.
/* global chrome, document, window -- usados só dentro de evaluate (rodam no navegador/extensão) */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { spawnSync } = require('node:child_process');
const { chromium } = require('playwright');

const RAIZ = path.resolve(__dirname, '..'), EXT = path.join(RAIZ, 'extensao-leitura');
const SITE = process.env.SITE_TESTE || 'http://127.0.0.1:8831';
const PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-extensao-portal';
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed.local.json'), 'utf8'));
const PORTAL = 'https://cnetmobile.estaleiro.serpro.gov.br';
const ITEM = `${PORTAL}/comprasnet-web/public/compras/acompanhamento-compra/item/1?compra=19302805900082025`;
const CADASTRO = `${PORTAL}/comprasnet-web/seguro/fornecedor/cadastro-propostas?compra=16013705000332026`;
const fixture = n => fs.readFileSync(path.join(EXT, 'fixtures', n), 'utf8');
fs.mkdirSync(PRINTS, { recursive: true });

const resultados = [];
async function passo(nome, f) {
  try { await f(); resultados.push(['ok', nome]); console.log('ok  ', nome); } catch (e) { resultados.push(['FALHA', nome, e.message]); console.log('FALHA', nome, '-', e.message); }
}
const exigir = (c, msg) => { if (!c) throw new Error(msg); };
function psql(sql) {
  const r = spawnSync('docker', ['exec', '-i', 'supabase_db_licitaplena-teste', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('psql: ' + r.stderr);
  return r.stdout.trim();
}

async function copiaDeTeste() {
  const { arquivosDaExtensao } = await import('../scripts/empacotar-extensao.mjs');
  const { manifesto, arquivos } = await arquivosDaExtensao();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-ext-e2e-'));
  for (const a of arquivos) fs.copyFileSync(path.join(EXT, a), path.join(dir, a));
  manifesto.host_permissions = [`${PORTAL}/*`, 'http://127.0.0.1/*'];
  manifesto.optional_host_permissions = [...manifesto.optional_host_permissions, 'http://127.0.0.1/*'];
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifesto, null, 2));
  return dir;
}

// Página do portal servida a partir da fixture, no endereço real (o navegador nunca chega ao governo).
async function rotas(ctx, paginas) {
  await ctx.route(`${PORTAL}/**`, rota => {
    const u = new URL(rota.request().url());
    const html = paginas[u.pathname];
    return html ? rota.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }) : rota.fulfill({ status: 404, body: '' });
  });
  await ctx.route(/hcaptcha\.com|gov\.br/, rota => (rota.request().url().startsWith(PORTAL) ? rota.fallback() : rota.abort()));
}

async function main() {
  const dir = await copiaDeTeste();
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-perfil-'));
  const ctx = await chromium.launchPersistentContext(perfil, {
    channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: process.env.VER !== '1', viewport: { width: 1280, height: 900 }, locale: 'pt-BR',
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  try {
    // Chat novo com data/hora de agora (Brasília) para passar a janela de 30 min do vigia.
    const agoraBr = () => new Date(Date.now() - 3 * 3600e3).toISOString().replace(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d).*/, '$3/$2/$1 $4:$5');
    await rotas(ctx, {
      '/comprasnet-web/public/compras/acompanhamento-compra/item/1': fixture('comprasgov-item-19302805900082025-1.html'),
      '/comprasnet-web/seguro/fornecedor/cadastro-propostas': `<html><head><title>Cadastrar propostas</title></head><body>${fixture('comprasgov-cadastro-propostas.html')}</body></html>`,
      '/comprasnet-web/seguro/fornecedor/disputa': '<html><head><title>Sala</title></head><body><header>Usuário: 123.456.789-09 - FULANA</header><div class="sala-chat"><div class="msg-pregoeiro"><p class="corpo">Senhores, bom dia.</p></div></div></body></html>',
    });
    let [sw] = ctx.serviceWorkers();
    sw ||= await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    const id = new URL(sw.url()).host;
    const ext = await ctx.newPage();
    const errosPopup = [];
    ext.on('pageerror', e => errosPopup.push(e.message));
    ext.on('console', m => { if (m.type() === 'error') errosPopup.push(m.text()); });
    await ext.goto(`chrome-extension://${id}/popup.html`);
    await ext.waitForTimeout(500);
    const portal = await ctx.newPage();
    const abaDe = async url => ext.evaluate(async u => (await chrome.tabs.query({})).find(t => t.url === u)?.id, url);
    const injetar = (tabId, modulo, func, args = []) => ext.evaluate(async ([t, m, f, a]) => {
      const mod = await import(`./${m}`);
      return (await chrome.scripting.executeScript({ target: { tabId: t, frameIds: [0] }, func: mod[f], args: a }))[0].result;
    }, [tabId, modulo, func, args]);

    await passo('extensão carrega no Edge com o manifesto 0.4.0 e o worker', async () => {
      const m = await ext.evaluate(() => chrome.runtime.getManifest());
      exigir(!errosPopup.length, `erro ao abrir o popup: ${errosPopup.join(' | ')}`);
      exigir(m.version === '0.4.0' && m.background.service_worker === 'acompanhar-worker.mjs', JSON.stringify(m).slice(0, 200));
      await ext.screenshot({ path: path.join(PRINTS, 'extensao-01-popup.png'), fullPage: true });
    });

    await passo('gravar: lê a fixture do item no endereço real do portal (3 propostas, chat, marca)', async () => {
      await portal.goto(ITEM);
      const r = await injetar(await abaDe(ITEM), 'pregao-leitor.mjs', 'lerPaginaPregao');
      exigir(r.status === 'ok' && r.itens[0].propostas.length === 3 && r.itens[0].mensagens.length === 4 && r.itens[0].propostas[0].marca === 'santa cruz', JSON.stringify(r).slice(0, 300));
    });

    await passo('preencher: preenche os itens do lote e NUNCA clica Salvar', async () => {
      await portal.goto(CADASTRO);
      await portal.evaluate(() => { window.__salvar = 0; document.querySelectorAll('button').forEach(b => { if (/Salvar/.test(b.textContent)) b.addEventListener('click', () => { window.__salvar++; }); }); });
      const lote = [{ item: '1', valorUnitario: '10,50', marca: 'Marca A', modelo: 'M1', quantidade: '50' }, { item: '2', valorUnitario: '4,9', marca: 'Marca B' }];
      const r = await injetar(await abaDe(CADASTRO), 'preencher-proposta.mjs', 'preencherPaginaCadastro', [{ lote, espera: 300 }]);
      exigir(r.status === 'ok' && r.preenchidos.length === 2, JSON.stringify(r));
      const valores = await portal.$$eval('input[data-test="input-valor-proposta"]', l => l.slice(0, 2).map(i => i.value));
      exigir(valores.join('|') === '10,5000|4,9000', valores.join('|'));
      exigir(await portal.evaluate(() => window.__salvar) === 0, 'clicou Salvar');
      await portal.screenshot({ path: path.join(PRINTS, 'extensao-02-preenchido-fixture.png'), fullPage: true });
    });

    let diagnosticoId = null;
    await passo('diagnóstico: página da sala (não mapeada) vira só estrutura, vai pelo site local e chega ao banco sem CPF', async () => {
      const SALA = `${PORTAL}/comprasnet-web/seguro/fornecedor/disputa`;
      await portal.goto(SALA);
      const d = await injetar(await abaDe(SALA), 'diagnostico.mjs', 'estruturaPagina', [{ fluxo: 'acompanhar', motivo: 'chat_vazio', extensao: '0.4.0' }]);
      exigir(d.status === 'ok' && d.seletores['.mensagens-texto'] === 0 && d.nos.some(n => n.c?.includes('msg-pregoeiro')), JSON.stringify(d).slice(0, 300));
      exigir(!/123\.456|FULANA|bom dia/i.test(JSON.stringify(d)), 'diagnóstico com dado pessoal ou texto');
      const lp = await ctx.newPage();
      await lp.goto(SITE + '/login.html');
      await lp.fill('#email', seed.usuarios.gestor.email); await lp.fill('#senha', seed.usuarios.gestor.senha);
      await Promise.all([lp.waitForURL(/painel\.html|sistema/, { timeout: 20000 }), lp.click('#btn-entrar')]);
      const lpId = await ext.evaluate(async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' }))[0]?.id);
      const r = await injetar(lpId, 'diagnostico.mjs', 'enviarDiagnosticoNaPagina', [d]);
      exigir(r.ok && r.id, JSON.stringify(r));
      diagnosticoId = r.id;
      const linha = psql(`select fluxo || '|' || host || '|' || (estrutura::text ~ '123\\.456|FULANA') from extensao_diagnosticos where id = ${Number(r.id)}`);
      exigir(linha === 'acompanhar|cnetmobile.estaleiro.serpro.gov.br|false', linha);
      await lp.close();
    });

    await passo('popup: convite "Enviar diagnóstico" aparece com o texto de privacidade', async () => {
      await ext.evaluate(async () => { (await import('./diagnostico-popup.mjs')).oferecerDiagnostico('preencher', 'sem_itens'); document.getElementById('diagnostico').scrollIntoView(); });
      exigir(await ext.isVisible('#diagnosticoEnviar'), 'botão invisível');
      await ext.screenshot({ path: path.join(PRINTS, 'extensao-03-convite-diagnostico.png'), fullPage: true });
    });

    await passo('acompanhar: nova mensagem com "suspensa" gera notificação destacada; recarregar a aba reconecta sozinho', async () => {
      await portal.goto(ITEM);
      const tab = await abaDe(ITEM);
      const r = await injetar(tab, 'acompanhar-chat.mjs', 'vigiarChat', [{ som: false, empresaCnpj: '', empresaNome: '' }]);
      exigir(r.status === 'iniciado' && r.jaNaTela > 0, JSON.stringify(r));
      const nova = texto => portal.evaluate(([t, d]) => {
        const lista = document.querySelector('app-mensagens-chat-lista');
        const caixa = document.createElement('div'); caixa.className = 'cp-mensagens-compra';
        caixa.innerHTML = `<div class="mensagens-texto">${t}</div><div class="mensagens-data"><small>${d}</small></div>`;
        lista.appendChild(caixa);
      }, [texto, agoraBr()]);
      const notificacoes = () => ext.evaluate(() => new Promise(res => chrome.notifications.getAll(n => res(Object.keys(n)))));
      await nova('Sessão suspensa até as 14h.');
      await portal.waitForTimeout(1200);
      const n1 = await notificacoes();
      exigir(n1.length === 1, `notificações: ${n1.length}`);
      exigir(await ext.evaluate(t => chrome.action.getBadgeText({ tabId: t }), tab) === '1', 'badge sem contagem');
      await portal.reload();
      await portal.waitForTimeout(2500);
      exigir(await ext.evaluate(t => chrome.action.getBadgeText({ tabId: t }), tab) === 'ON', 'não reconectou depois de recarregar');
      exigir((await notificacoes()).length === 1, 'avisou "parei" mesmo reconectando');
      await nova('Fornecedor convocado para anexo.');
      await portal.waitForTimeout(1200);
      exigir((await notificacoes()).length === 2, 'depois da reconexão não alertou');
      await portal.goto(CADASTRO); // saiu da página do pregão: "parei"
      await portal.waitForTimeout(2500);
      exigir((await notificacoes()).length === 3 && await ext.evaluate(t => chrome.action.getBadgeText({ tabId: t }), tab) === 'OFF', 'não avisou ao sair');
    });

    if (diagnosticoId) psql(`delete from extensao_diagnosticos where id = ${Number(diagnosticoId)}`);
  } finally {
    await ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(perfil, { recursive: true, force: true });
  }
  fs.writeFileSync(path.join(PRINTS, 'resultado-extensao.json'), JSON.stringify(resultados, null, 2));
  const falhas = resultados.filter(r => r[0] !== 'ok');
  console.log(`${resultados.length - falhas.length}/${resultados.length} passos ok`);
  if (falhas.length) process.exit(1);
}
main().catch(e => { console.error('E2E EXTENSÃO FALHOU:', e); process.exit(1); });
