/* global document, window -- usados só dentro de p.evaluate/p.waitForFunction (rodam no navegador) */
// E2E local da busca avançada do painel: filtros salvos, "sem interesse", raio/região, "Monte minha busca com IA"
// e lembretes com hora. Ambiente: subir.cjs + servidor.cjs rodando.
//   PORTA_TESTE=8804 node ambiente-teste/servidor.cjs
//   SITE_TESTE=http://127.0.0.1:8804 node ambiente-teste/e2e-busca-painel.cjs
// O PNCP e a IA são simulados com fixtures (page.route): nada sai para a internet e nenhum provedor pago é chamado.
// Dado criado aqui é apagado no fim. O robô de lembretes roda em modo "só registrar" contra o banco LOCAL.
const path = require('node:path'), { spawnSync } = require('node:child_process');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-backlog-painel';
const { banco, comoUsuario, passo, exigir, novaPagina, seed, chaves, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');

const FUTURO = '2027-03-10T17:00:00';
const item = (num, objeto, uf, municipio) => ({ numero_controle_pncp: `04312239000141-1-0001${num}/2026`, description: objeto, title: objeto, uf, municipio_nome: municipio,
  orgao_nome: `Prefeitura de ${municipio}`, data_fim_vigencia: FUTURO, data_publicacao_pncp: '2026-11-10T10:00:00', modalidade_licitacao_nome: 'Pregão - Eletrônico' });
const ITENS = [
  item(11, 'Aquisição de material de limpeza e descartáveis', 'AM', 'Manaus'),
  item(12, 'Material de limpeza para escolas', 'AM', 'Iranduba'),
  item(13, 'Material de limpeza para veículos da frota', 'AM', 'Manaus'),
  item(14, 'Material de limpeza e descartáveis', 'RR', 'Boa Vista'),
  item(15, 'Serviço de limpeza predial', 'SP', 'São Paulo'),
];
const cartoes = (p) => p.locator('#op-resultado .boletim-card');
const psql = (sql) => { const r = spawnSync('docker', ['exec', '-i', 'supabase_db_licitaplena-teste', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }); if (r.status !== 0) throw new Error('psql: ' + r.stderr); return r.stdout.trim(); };
async function buscar(p, palavras) {
  await p.fill('#op-palavras', palavras);
  await p.click('#op-buscar');
  await p.waitForSelector('#op-resultado .boletim-card, #op-resultado .aviso', { timeout: 20000 });
  await p.waitForTimeout(600);
}
const municipios = async (p) => (await p.locator('#op-resultado .boletim-card').allInnerTexts()).map((t) => /Município\/UF\s*\n?\s*([^\n]+)/.exec(t)?.[1]?.trim());

(async () => {
  const nav = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: true });
  const p = await novaPagina(nav, seed.usuarios.gestor);
  const uid = (await p.evaluate(() => window.__clienteIdAtual)) || (await p.waitForFunction(() => window.__clienteIdAtual).then((h) => h.jsonValue()));
  let nIA = 0;
  await p.route('**/api/pncp-proxy**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: ITENS, total: ITENS.length }) }));
  await p.route('**/api/monte-busca-ia', (r) => { nIA += 1; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ palavras: ['limpeza', 'descartáveis'], variacoes: ['limpezas', 'higiene'], exclusoes: ['veículo', 'obra'] }) }); });
  await p.goto(SITE + '/painel.html');
  await p.locator('nav button[data-alvo="oportunidades"]').dispatchEvent('click');
  await p.waitForSelector('#op-palavras', { state: 'visible' });
  const limpar = async () => psql(`delete from public.filtros_salvos where cliente_id='${uid}'; delete from public.editais_sem_interesse where cliente_id='${uid}'; delete from public.lembretes where cliente_id='${uid}';`);
  // O seed local traz editais reais do PNCP (oportunidades_abertas) que podem casar com "limpeza" e somar um cartão a mais.
  // Só no banco LOCAL (a trava do fetch recusa produção): tira-os para a contagem da fixture ficar exata.
  psql(`delete from public.oportunidades_abertas where objeto ilike '%limpeza%';`);
  await limpar();
  try {
    await passo('busca simples traz os 5 editais da fixture', p, async () => {
      // A UF padrão do perfil (AM) vem marcada: a busca nacional começa sem estado.
      await p.evaluate(() => { document.querySelector('#op-uf').querySelectorAll('option').forEach((o) => { o.selected = false; }); });
      await buscar(p, 'limpeza');
      exigir((await cartoes(p).count()) === 5, 'esperava 5 cards, veio ' + (await cartoes(p).count()) + ': ' + (await municipios(p)).join('|'));
    });
    await passo('"Não quero ver" tira o edital de veículos', p, async () => {
      await p.fill('#op-excluir', 'veículo');
      await p.click('#op-buscar'); await p.waitForTimeout(800);
      exigir((await cartoes(p).count()) === 4, 'esperava 4 cards sem veículo');
      await p.fill('#op-excluir', '');
    });
    await passo('raio de 100 km de Manaus: só Manaus e Iranduba', p, async () => {
      await p.fill('#op-raio-km', '100'); await p.fill('#op-raio-cidade', 'Manaus');
      await p.click('#op-buscar'); await p.waitForTimeout(1200);
      const m = await municipios(p);
      exigir(m.length === 3 && m.every((x) => /Manaus|Iranduba/.test(x)), 'cards: ' + m.join('|'));
      exigir(/100 km de Manaus-AM: consultando AM/.test(await p.innerText('#op-onde-status')), 'status do raio: ' + await p.innerText('#op-onde-status'));
      exigir((await p.inputValue('#op-raio-cidade')) === 'Manaus - AM', 'cidade normalizada');
    });
    await passo('raio de 800 km inclui Boa Vista (RR) e deixa São Paulo de fora', p, async () => {
      await p.fill('#op-raio-km', '800');
      await p.click('#op-buscar'); await p.waitForTimeout(1200);
      const m = await municipios(p);
      exigir(m.some((x) => /Boa Vista/.test(x)) && !m.some((x) => /São Paulo/.test(x)), 'cards: ' + m.join('|'));
    });
    await passo('raio incompleto avisa em vez de buscar tudo', p, async () => {
      await p.fill('#op-raio-cidade', ''); await p.click('#op-buscar'); await p.waitForTimeout(500);
      exigir(/informe os km .* e a cidade/.test(await p.innerText('#op-resultado')), 'aviso ausente');
      await p.fill('#op-raio-km', '');
    });
    await passo('região Sudeste marca SP e a busca só traz São Paulo', p, async () => {
      await p.selectOption('#op-regiao', 'Sudeste');
      await p.click('#op-buscar'); await p.waitForTimeout(1000);
      const m = await municipios(p);
      exigir(m.length === 1 && /São Paulo/.test(m[0]), 'cards: ' + m.join('|'));
      await p.selectOption('#op-regiao', ''); await p.evaluate(() => { document.querySelector('#op-uf').querySelectorAll('option').forEach((o) => { o.selected = false; }); });
    });
    await passo('salvar, listar, renomear, escolher e apagar filtros com nome', p, async () => {
      await p.fill('#op-palavras', 'limpeza'); await p.fill('#op-excluir', 'obra');
      await p.fill('#op-raio-km', '100'); await p.fill('#op-raio-cidade', 'Manaus - AM');
      await p.click('#op-salvos-salvar'); await p.fill('#op-salvos-nome', 'Limpeza perto de Manaus'); await p.click('#op-salvos-confirmar');
      await p.waitForFunction(() => document.querySelectorAll('#op-salvos-lista option').length === 2);
      await p.fill('#op-raio-km', ''); await p.fill('#op-raio-cidade', ''); await p.fill('#op-excluir', ''); await p.fill('#op-palavras', 'material de escritório');
      await p.click('#op-salvos-salvar'); await p.fill('#op-salvos-nome', 'Escritório'); await p.click('#op-salvos-confirmar');
      await p.waitForFunction(() => document.querySelectorAll('#op-salvos-lista option').length === 3);
      let linhas = await banco(`filtros_salvos?select=nome,filtro&cliente_id=eq.${uid}&order=nome`);
      exigir(linhas.length === 2 && linhas[1].filtro.raio.km === 100 && linhas[1].filtro.excluir === 'obra', JSON.stringify(linhas));
      // duplicado (outra caixa) atualiza em vez de criar
      await p.click('#op-salvos-salvar'); await p.fill('#op-salvos-nome', 'escritório'); await p.click('#op-salvos-confirmar');
      await p.waitForTimeout(800);
      exigir((await banco(`filtros_salvos?select=id&cliente_id=eq.${uid}`)).length === 2, 'duplicou o nome');
      // escolher aplica nos campos e já busca
      await p.selectOption('#op-salvos-lista', await p.locator('#op-salvos-lista option', { hasText: 'Limpeza perto' }).getAttribute('value'));
      await p.waitForFunction(() => document.querySelector('#op-palavras').value === 'limpeza' && document.querySelector('#op-raio-km').value === '100');
      await p.waitForSelector('#op-resultado .boletim-card');
      await p.screenshot({ path: path.join(PRINTS, '1280-filtro-salvo-aplicado.png'), fullPage: true });
      // renomear
      await p.click('#op-salvos-renomear'); await p.fill('#op-salvos-nome', 'Manaus 100 km'); await p.click('#op-salvos-confirmar');
      await p.waitForFunction(() => /renomeado/.test(document.querySelector('#op-salvos-status').textContent));
      // apagar
      await p.click('#op-salvos-apagar'); await p.click('#op-salvos-confirmar');
      await p.waitForFunction(() => /apagado/.test(document.querySelector('#op-salvos-status').textContent));
      linhas = await banco(`filtros_salvos?select=nome&cliente_id=eq.${uid}`);
      exigir(linhas.length === 1 && linhas[0].nome === 'Escritório', JSON.stringify(linhas));
    });
    await passo('filtro do Boletim da conta continua intacto', null, async () => {
      const antes = await banco(`clientes?select=boletim_filtro&id=eq.${uid}`);
      exigir(!JSON.stringify(antes).includes('Escritório'), 'boletim_filtro foi tocado');
    });
    await passo('RLS: outra conta não vê nem apaga filtros e descartes', null, async () => {
      const o = seed.usuarios.outra_org;
      const v = await comoUsuario(o, '/rest/v1/filtros_salvos?select=id');
      exigir(v.status === 200 && JSON.parse(v.corpo).length === 0, 'outra conta leu: ' + v.corpo);
      const d = await comoUsuario(o, `/rest/v1/filtros_salvos?cliente_id=eq.${uid}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
      exigir(d.status < 300 && JSON.parse(d.corpo || '[]').length === 0, 'outra conta apagou: ' + d.corpo);
      exigir((await banco(`filtros_salvos?select=id&cliente_id=eq.${uid}`)).length === 1, 'filtro sumiu');
    });
    await passo('"Sem interesse" some o edital, persiste na conta e some após recarregar', p, async () => {
      await p.fill('#op-palavras', 'limpeza'); await p.fill('#op-excluir', ''); await p.fill('#op-raio-km', ''); await p.fill('#op-raio-cidade', '');
      await p.click('#op-buscar'); await p.waitForTimeout(1000);
      const antes = await cartoes(p).count();
      await cartoes(p).first().locator('.btn-sem-interesse').click();
      await p.waitForFunction((n) => document.querySelectorAll('#op-resultado .boletim-card').length === n, antes - 1);
      const linhas = await banco(`editais_sem_interesse?select=numero_controle&cliente_id=eq.${uid}`);
      exigir(linhas.length === 1, 'descarte não gravado');
      await p.screenshot({ path: path.join(PRINTS, '1280-sem-interesse.png'), fullPage: true });
      await p.reload(); await p.locator('nav button[data-alvo="oportunidades"]').dispatchEvent('click'); await p.waitForSelector('#op-palavras', { state: 'visible' });
      await p.waitForFunction(() => !document.querySelector('#op-sem-interesse-restaurar').hidden, null, { timeout: 15000 });
      await p.fill('#op-palavras', 'limpeza'); await p.click('#op-buscar'); await p.waitForTimeout(1200);
      exigir((await cartoes(p).count()) === antes - 1, 'edital descartado voltou após recarregar');
      await p.click('#op-sem-interesse-restaurar'); await p.waitForFunction((n) => document.querySelectorAll('#op-resultado .boletim-card').length === n, antes);
      exigir((await banco(`editais_sem_interesse?select=numero_controle&cliente_id=eq.${uid}`)).length === 0, 'restaurar não apagou');
    });
    await passo('"Monte minha busca com IA": sugere, usuário confirma, campos mudam só no "Usar"', p, async () => {
      await p.click('#op-ia > summary');
      await p.fill('#op-ia-descricao', 'vendo material de limpeza e descartáveis');
      await p.click('#op-ia-sugerir'); await p.waitForSelector('#op-ia-resultado:not([hidden])');
      exigir(nIA === 1, 'IA chamada ' + nIA + 'x');
      exigir((await p.inputValue('#op-palavras')) === 'limpeza', 'campo mudou antes da confirmação');
      await p.uncheck('#op-ia-variacoes input[value="higiene"]');
      await p.screenshot({ path: path.join(PRINTS, '1280-monte-busca-ia.png'), fullPage: true });
      await p.click('#op-ia-usar');
      exigir((await p.inputValue('#op-palavras')) === 'limpeza, descartáveis, limpezas', await p.inputValue('#op-palavras'));
      exigir((await p.inputValue('#op-excluir')) === 'veículo, obra', await p.inputValue('#op-excluir'));
    });
    await passo('lembrete com hora e antecedência grava hora_aviso e avisa quando sai o e-mail', p, async () => {
      await p.click('#op-buscar'); await p.waitForSelector('#op-resultado .boletim-card');
      const card = cartoes(p).first();
      await card.locator('.boletim-detalhes > summary').click();
      await card.locator('.btn-criar-lembrete').click();
      await p.selectOption('#lembrete-dias-antes', '2'); await p.selectOption('#lembrete-hora', '7');
      exigir(/Você recebe o e-mail em 08\/03\/2027,? 07:00/.test(await p.innerText('#lembrete-quando')), await p.innerText('#lembrete-quando'));
      await p.screenshot({ path: path.join(PRINTS, '1280-lembrete-hora.png') });
      await p.click('#modal-lembrete-salvar'); await p.waitForTimeout(1200);
      const l = await banco(`lembretes?select=dias_antes,hora_aviso,enviado&cliente_id=eq.${uid}`);
      exigir(l.length === 1 && l[0].dias_antes === 2 && l[0].hora_aviso === 7 && l[0].enviado === false, JSON.stringify(l));
    });
    await passo('robô de lembretes (só registrar): avisa o que passou da hora e não envia nada', null, async () => {
      // Aviso 1 h atrás e prazo daqui a 3 h: deve "enviar" (registrar); o de 2027 não.
      psql(`insert into public.lembretes(cliente_id,numero_controle_pncp,objeto_resumo,data_final_proposta,dias_antes,hora_aviso)
        values ('${uid}','TESTE-AGORA','Edital fictício',now()+interval '3 hours',0,extract(hour from (now() at time zone 'America/Sao_Paulo') - interval '1 hour')::int);`);
      const r = spawnSync('python', [path.join(__dirname, '../scripts/lembretes_licitacoes.py')], { encoding: 'utf8',
        env: { ...process.env, SUPABASE_URL: chaves.API_URL, SUPABASE_SERVICE_ROLE_KEY: chaves.SERVICE_ROLE_KEY, LEMBRETES_SO_REGISTRAR: '1', ZEPTOMAIL_TOKEN: '', EMAIL_REMETENTE: '', EMAIL_SENHA_APP: '' } });
      const saida = (r.stdout || '') + (r.stderr || '');
      exigir(r.status === 0 && /\[SO REGISTRAR\] enviaria para .*TESTE-AGORA/.test(saida), saida.slice(-600));
      exigir(!/2027|TESTE-AGORA.*enviado/.test(saida.replace(/enviaria/g, '')), 'registrou o de 2027');
      const l = await banco(`lembretes?select=numero_controle_pncp,enviado&cliente_id=eq.${uid}`);
      exigir(l.every((x) => x.enviado === false), 'marcou como enviado em modo só registrar');
      return saida.split('\n').filter((x) => /SO REGISTRAR|pendente/.test(x)).map((x) => x.replace(/\S+@\S+/, '<e-mail>')).join(' ; ');
    });
    await passo('celular 375 px: filtros salvos, raio e IA cabem sem rolagem lateral', p, async () => {
      await p.setViewportSize({ width: 375, height: 812 });
      await p.reload(); await p.locator('nav button[data-alvo="oportunidades"]').dispatchEvent('click'); await p.waitForSelector('#op-ferramentas', { state: 'visible' });
      await p.click('#op-ia > summary');
      const largura = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      exigir(largura[0] <= largura[1] + 1, 'rolagem lateral ' + largura.join('/'));
      await p.screenshot({ path: path.join(PRINTS, '375-busca-avancada.png'), fullPage: true });
      await p.setViewportSize({ width: 1280, height: 900 });
      await p.reload(); await p.locator('nav button[data-alvo="oportunidades"]').dispatchEvent('click'); await p.waitForSelector('#op-ferramentas', { state: 'visible' });
      await p.click('#op-ia > summary');
      await p.screenshot({ path: path.join(PRINTS, '1280-busca-avancada.png'), fullPage: true });
    });
    const errosGraves = p.erros.filter((e) => !/pncp|fonts|favicon|404/i.test(e));
    await passo('sem erro de página no console', null, async () => { exigir(errosGraves.length === 0, errosGraves.join(' | ').slice(0, 400)); });
  } finally {
    await limpar();
    await nav.close();
  }
  const falhas = resultados.filter((r) => !r.ok);
  console.log(falhas.length ? `FALHOU: ${falhas.map((f) => f.nome).join('; ')}` : 'E2E BUSCA PAINEL OK');
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
