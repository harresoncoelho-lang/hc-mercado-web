/* global document */
// E2E curto da tela "Robô de lances" (modo assistido + simulador). Ambiente: subir.cjs + servidor.cjs rodando.
//   PORTA_TESTE=8830 node ambiente-teste/servidor.cjs
//   SITE_TESTE=http://127.0.0.1:8830 node ambiente-teste/e2e-robo-lances.cjs
// Cria um processo fictício com 2 itens (custo + margens), configura o robô, simula e tira prints em 1280 e 375.
// O processo e os itens criados aqui são apagados no fim.
const path = require('node:path');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-robo-lances';
const { passo, exigir, novaPagina, entrar, seed, chaves, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');

async function servico(metodo, caminho, corpo) {
  const r = await fetch(chaves.API_URL + caminho, { method: metodo, body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + chaves.SERVICE_ROLE_KEY, 'content-type': 'application/json', Prefer: 'return=representation' } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${caminho}: ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}

async function main() {
  const { usuarios: U, ids } = seed;
  const navegador = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: process.env.VER !== '1' });
  let proc = null;
  try {
    proc = (await servico('POST', '/rest/v1/operacao_processos', { organizacao_id: ids.orgA, empresa_id: ids.empA1, objeto: 'Processo fictício e2e robô de lances',
      tributos_percentual: 8, margem_percentual: 20, margem_minima_percentual: 8 }))[0];
    await servico('POST', '/rest/v1/operacao_itens_resultado', [['1', 'Cadeira giratória', 20, 60, 40], ['2', 'Mesa de escritório', 5, 15, 10]].map(([n, d, q, v, c]) => ({
      organizacao_id: ids.orgA, processo_id: proc.id, identificador: n, tipo: 'item', situacao: 'pendente', descricao: d, quantidade: q, valor_unitario_proposta: v, custo_unitario: c })));
    const url = `${SITE}/sistema?empresa=${ids.empA1}&processo=${proc.id}`;
    const p = await novaPagina(navegador);
    await entrar(p, U.gestor);

    for (const largura of [1280, 375]) {
      await p.setViewportSize({ width: largura, height: largura === 375 ? 812 : 900 });
      await passo(`robô: configurar e simular em ${largura}px`, null, async () => {
        await p.goto(url);
        await p.waitForSelector('#robo-lances [data-robo-item]', { timeout: 30000 });
        const cartoes = p.locator('#robo-lances [data-robo-item]');
        exigir(await cartoes.count() === 2, 'esperava 2 itens no robô');
        const piso = await cartoes.first().locator('dd').nth(1).innerText();
        exigir(/R\$/.test(piso), 'piso (preço-limite) não calculado: ' + piso);
        await p.selectOption('#robo-modo', 'aberto_fechado');
        await p.fill('#robo-diferenca', '0,10'); await p.press('#robo-diferenca', 'Tab');
        const c1 = cartoes.nth(0);
        await c1.locator('[data-campo=valor]').fill('0,50'); await c1.locator('[data-campo=valor]').press('Tab');
        await p.locator('#robo-lances [data-robo-item]').nth(0).locator('[data-campo=ligado]').check();
        await p.locator('#robo-lances [data-robo-item]').nth(1).locator('[data-campo=tipo]').selectOption('percentual');
        await p.locator('#robo-lances [data-robo-item]').nth(1).locator('[data-campo=valor]').fill('1'); await p.locator('#robo-lances [data-robo-item]').nth(1).locator('[data-campo=valor]').press('Tab');
        await p.locator('#robo-lances [data-robo-item]').nth(1).locator('[data-campo=ligado]').check();
        await p.locator('#robo-lances').screenshot({ path: path.join(PRINTS, `robo-${largura}-1-configurado.png`) });
        await p.click('#robo-lances [data-robo-simular]');
        await p.waitForSelector('#robo-lances [data-robo-resultado]:not([hidden]) [data-robo-resumo] li', { timeout: 10000 });
        const resumo = await p.innerText('#robo-lances [data-robo-resumo]');
        const sugestoes = await p.locator('#robo-lances tr[data-tipo=sugestao]').count();
        exigir(sugestoes > 0, 'nenhuma sugestão na simulação');
        const registro = await p.locator('#robo-lances [data-robo-registro] li').count();
        exigir(registro > 1, 'registro vazio');
        // Sem rolagem horizontal da página (tabela rola dentro da própria caixa).
        const rola = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        exigir(!rola, 'página com rolagem horizontal');
        await p.locator('#robo-lances').screenshot({ path: path.join(PRINTS, `robo-${largura}-2-simulado.png`) });
        if (largura === 1280) { await p.click('#robo-lances .robo-tempo > summary'); await p.locator('#robo-lances').screenshot({ path: path.join(PRINTS, 'robo-1280-3-linha-do-tempo.png') }); }
        return `${sugestoes} sugestões · registro ${registro} linhas · ${resumo.replace(/\s+/g, ' ').slice(0, 240)}`;
      });
    }
    const erros = p.erros.filter((e) => e.startsWith('pageerror') || e.startsWith('console'));
    await passo('sem erro de JavaScript na página', null, async () => { exigir(!erros.length, erros.join(' | ')); });
  } finally {
    if (proc) {
      await servico('DELETE', `/rest/v1/operacao_itens_resultado?processo_id=eq.${proc.id}`).catch(() => null);
      await servico('DELETE', `/rest/v1/operacao_processos?id=eq.${proc.id}`).catch(() => null);
    }
    await navegador.close();
  }
  const falhas = resultados.filter((r) => !r.ok).length;
  console.log(falhas ? `${falhas} passo(s) com falha` : 'tudo certo');
  process.exitCode = falhas ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
