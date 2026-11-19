/* global document, localStorage -- usado só dentro de p.evaluate (roda no navegador) */
// E2E curto das mudanças de 19-20/11: Turnstile no login, painel rápido (dados_robo/dashboard_mercado), SINAPI,
// curva ABC, CBS/IBS, alerta de logo clara, convite.html e admin.html. Ambiente: subir.cjs + servidor.cjs rodando.
//   PORTA_TESTE=8820 node ambiente-teste/servidor.cjs
//   SITE_TESTE=http://127.0.0.1:8820 node ambiente-teste/e2e-novidades-20261120.cjs
// SINAPI: a tabela precisa ter AM (AMBIENTE_TESTE_REDIRECIONAR=1 SINAPI_UFS=AM node -r ./ambiente-teste/redirecionar-fetch.cjs
// scripts/coletar_sinapi.js). Processo e itens fictícios criados aqui são apagados no fim; o resumo do painel também.
const fs = require('node:fs'), path = require('node:path');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/teste-ponta-a-ponta/prints-20261120';
const { passo, exigir, novaPagina, seed, chaves, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');

async function servico(metodo, caminho, corpo, extra = {}) {
  const r = await fetch(chaves.API_URL + caminho, { method: metodo, body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + chaves.SERVICE_ROLE_KEY, 'content-type': 'application/json', Prefer: 'return=representation', ...extra } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${caminho}: ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}
// Erros de console/página (as 4xx de rede ficam de fora: login/admin consultam tabelas que o RLS pode negar).
const errosJs = (p) => p.erros.filter((e) => e.startsWith('pageerror') || e.startsWith('console'));

async function main() {
  const { usuarios: U, ids } = seed;
  const navegador = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: process.env.VER !== '1' });
  const ctx = {};
  try {
    const p = await novaPagina(navegador);

    await passo('login com Turnstile de teste: token chega ao Supabase', p, async () => {
      await p.goto(SITE + '/login.html');
      await p.fill('#email', U.gestor.email); await p.fill('#senha', U.gestor.senha);
      const pedido = p.waitForRequest((r) => r.url().includes('/auth/v1/token') && r.method() === 'POST', { timeout: 20000 });
      await Promise.all([p.waitForURL(/painel\.html|sistema/, { timeout: 30000 }), p.click('#btn-entrar')]);
      const token = JSON.parse((await pedido).postData() || '{}').gotrue_meta_security?.captcha_token;
      exigir(token, 'login sem captcha_token no pedido ao Supabase (Turnstile não carregou?)');
      const js = errosJs(p); exigir(!js.length, 'erros de console: ' + js.join(' | '));
      return `captcha_token de ${token.length} caracteres (chave de teste da Cloudflare) enviado ao Auth local; entrou em ${p.url().replace(SITE, '')}`;
    });

    await passo('painel: quadros Estados e rankings pelo resumo do robô', p, async () => {
      await servico('POST', '/rest/v1/dados_robo?on_conflict=chave', { chave: 'dashboard_mercado', dado: { total: 12345, estados_distintos: 3,
        estados_top: [{ uf: 'AM', total: 9000 }, { uf: 'PA', total: 3000 }, { uf: 'RR', total: 345 }],
        segmentos_top: [{ segmento: 'limpeza', total: 7000 }, { segmento: 'informatica', total: 2000 }], atualizado_em: new Date().toISOString() } },
      { Prefer: 'resolution=merge-duplicates,return=representation' });
      ctx.resumo = true;
      const rpcs = []; p.on('request', (r) => { if (/\/rpc\/dashboard_/.test(r.url())) rpcs.push(r.url()); });
      await p.goto(SITE + '/painel.html');
      await p.waitForFunction(() => /AM/.test(document.getElementById('dash-ranking-estados')?.innerText || ''), null, { timeout: 20000 });
      const estados = (await p.innerText('#dash-ranking-estados')).replace(/\s+/g, ' ');
      const segmentos = (await p.innerText('#dash-ranking-segmentos')).replace(/\s+/g, ' ');
      const total = await p.innerText('#dashboard');
      exigir(/12\.345/.test(total), 'total 12.345 não apareceu no painel');
      exigir(!rpcs.length, 'painel chamou as RPCs antigas: ' + rpcs.join(', '));
      return `estados: ${estados.slice(0, 80)} | segmentos: ${segmentos.slice(0, 80)} | sem RPC dashboard_*`;
    });

    await passo('SINAPI: buscar e "Usar este preço"', p, async () => {
      await p.goto(SITE + '/sinapi.html');
      await p.selectOption('#f-uf', 'AM'); await p.selectOption('#f-tipo', 'composicao');
      await p.fill('#f-busca', 'alvenaria bloco ceramico'); await p.click('#form-busca button[type=submit]');
      await p.waitForSelector('#tabela-corpo [data-usar]', { timeout: 20000 });
      const linhas = await p.locator('#tabela-corpo tr').count();
      const primeira = (await p.locator('#tabela-corpo tr').first().innerText()).replace(/\s+/g, ' ');
      await p.locator('#tabela-corpo [data-usar]').first().click();
      await p.waitForFunction(() => /Usar no valor unitário/.test(document.getElementById('aviso')?.innerText || ''), null, { timeout: 5000 });
      ctx.sinapi = JSON.parse(await p.evaluate(() => localStorage.getItem('licitaplena_sinapi_preco')));
      exigir(ctx.sinapi?.preco && ctx.sinapi.uf === 'AM', 'preço não guardado: ' + JSON.stringify(ctx.sinapi));
      return `${linhas} linha(s) · ${await p.innerText('#contador')} · 1ª: ${primeira.slice(0, 120)} · guardado ${ctx.sinapi.codigo} R$ ${ctx.sinapi.preco}`;
    });

    // Processo fictício com 4 itens de valores bem diferentes (curva A/B/C previsível).
    ctx.proc = (await servico('POST', '/rest/v1/operacao_processos', { organizacao_id: ids.orgA, empresa_id: ids.empA1, objeto: 'Processo fictício e2e novidades 20/11' }))[0];
    const itens = [['1', 'Cimento', 100, 50], ['2', 'Areia', 10, 30], ['3', 'Tijolo', 1000, 0.8], ['4', 'Prego', 5, 2]];
    await servico('POST', '/rest/v1/operacao_itens_resultado', itens.map(([n, d, q, v]) => ({ organizacao_id: ids.orgA, processo_id: ctx.proc.id, identificador: n,
      tipo: 'item', situacao: 'pendente', descricao: d, quantidade: q, valor_unitario_proposta: v })));
    const urlProcesso = `${SITE}/sistema?empresa=${ids.empA1}&processo=${ctx.proc.id}`;

    await passo('SINAPI: preço chega ao formulário do item (Usar no valor unitário)', p, async () => {
      await p.goto(urlProcesso);
      await p.waitForSelector('#itens-processo [data-item-lista] li', { timeout: 20000 });
      await p.locator('#itens-processo [data-item-lista] li').first().getByRole('button', { name: /^Editar/ }).click();
      await p.waitForSelector('#itens-processo [data-sinapi]:not([hidden])', { timeout: 5000 });
      const rotulo = await p.innerText('#itens-processo [data-sinapi-texto]');
      await p.click('#itens-processo [data-sinapi-usar]');
      const valor = await p.locator('#itens-processo form [name=valorUnitario]').first().inputValue();
      exigir(valor === ctx.sinapi.preco, `valor unitário "${valor}", esperado ${ctx.sinapi.preco}`);
      return `"${rotulo}" → campo valor unitário = ${valor} (não salvo)`;
    });

    await passo('curva ABC no processo', p, async () => {
      await p.goto(urlProcesso);
      await p.waitForSelector('#itens-processo [data-curva]:not([hidden]) [data-curva-linhas] tr', { timeout: 20000 });
      await p.locator('#itens-processo [data-curva]').scrollIntoViewIfNeeded();
      const classes = await p.locator('#itens-processo [data-curva-linhas] tr').evaluateAll((tr) => tr.map((t) => t.dataset.classe + ':' + t.cells[1].innerText.split(' ')[0]));
      const resumo = await p.innerText('#itens-processo [data-curva-resumo]');
      // Totais: 1 = 5.000, 3 = 800, 2 = 300, 4 = 10 (soma 6.110); o maior vem primeiro e é sempre classe A.
      exigir(classes[0] === 'A:1' && classes.length === 4, 'ordem/classe: ' + classes.join(', '));
      exigir(/6\.110,00/.test(resumo), 'total com milhar não apareceu: ' + resumo);
      return `${classes.join(', ')} | ${resumo}`;
    });

    await passo('CBS/IBS ligado: linha por item sem mudar o preço-alvo', p, async () => {
      for (const [id, v] of [['tributos', '8'], ['margem', '20']]) { await p.fill('#itens-premissa-' + id, v); await p.press('#itens-premissa-' + id, 'Tab'); await p.waitForTimeout(700); }
      const custo = p.locator('input[id^="itens-custo-"]').first();
      await custo.fill('40'); await custo.press('Tab'); await p.waitForTimeout(1500);
      const li = p.locator('#itens-processo [data-item-lista] li').first();
      const antes = (await li.locator('.itens-precos').innerText()).replace(/\s+/g, ' ');
      exigir(/Preço-alvo R\$ ?\d/.test(antes), 'sem preço-alvo: ' + antes);
      await p.check('#itens-processo [data-reforma-ligado]'); await p.waitForTimeout(800);
      const linha = await li.locator('[data-reforma-item]').innerText();
      const depois = (await li.locator('.itens-precos').innerText()).replace(/\s+/g, ' ');
      exigir(/CBS .*IBS/.test(linha), 'linha CBS/IBS ausente: ' + linha);
      exigir(antes === depois, `preço mudou: "${antes}" → "${depois}"`);
      const nLinhas = await p.locator('#itens-processo [data-reforma-item]').evaluateAll((e) => e.filter((x) => x.innerText.trim()).length);
      return `${nLinhas} item(ns) com linha · "${linha}" · preços iguais: ${antes.slice(0, 80)}`;
    });

    await passo('perfil: logo quase branca mostra "sua logo é clara"', p, async () => {
      await p.goto(`${SITE}/operacao.html?aba=identificacao`);
      await p.waitForSelector('#perfil-salvar', { timeout: 20000 });
      await p.selectOption('#empresa-atual', ids.empA1); await p.waitForTimeout(2500);
      const b64 = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 100; const g = c.getContext('2d');
        g.fillStyle = '#fbfbfb'; g.fillRect(0, 0, 300, 100); g.fillStyle = '#f2f2f2'; g.font = '40px sans-serif'; g.fillText('LOGO', 80, 65); return c.toDataURL('image/png').split(',')[1]; });
      await p.setInputFiles('#perfil-logo', { name: 'logo-clara.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
      await p.waitForFunction(() => /logo é clara/.test(document.getElementById('perfil-logo-aviso')?.innerText || ''), null, { timeout: 15000 });
      return await p.innerText('#perfil-logo-aviso');
    });

    const anon = await novaPagina(navegador);
    for (const pagina of ['convite.html', 'admin.html']) {
      await passo(`${pagina} carrega sem erro de console`, anon, async () => {
        anon.erros.length = 0;
        await anon.goto(`${SITE}/${pagina}`); await anon.waitForLoadState('load'); await anon.waitForTimeout(4000); // Turnstile mantém conexão aberta: networkidle nunca chega
        const js = errosJs(anon); exigir(!js.length, 'erros: ' + js.join(' | '));
        return `sem erro de console/página; texto: ${(await anon.innerText('body')).replace(/\s+/g, ' ').slice(0, 120)}`;
      });
    }
  } finally {
    if (ctx.proc) await servico('DELETE', `/rest/v1/operacao_processos?id=eq.${ctx.proc.id}`).catch((e) => console.log('limpeza processo:', e.message));
    if (ctx.resumo) await servico('DELETE', '/rest/v1/dados_robo?chave=eq.dashboard_mercado').catch((e) => console.log('limpeza resumo:', e.message));
    await navegador.close();
  }
  fs.writeFileSync(path.join(PRINTS, 'resultado.json'), JSON.stringify(resultados, null, 1));
  const falhas = resultados.filter((r) => !r.ok);
  console.log(falhas.length ? `FALHOU: ${falhas.length}` : `E2E NOVIDADES OK (${resultados.length}/${resultados.length})`);
  process.exit(falhas.length ? 1 : 0);
}
main().catch((e) => { console.error('E2E FALHOU:', e); process.exit(1); });
