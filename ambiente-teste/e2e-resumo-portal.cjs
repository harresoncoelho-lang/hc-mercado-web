/* global document, window, iaEstruturaAtual, iaEditalAtual, montarResumoParaCliente, resumoParaEnvio, editalParaResumo, linkPncp -- só dentro de p.evaluate */
// E2E curto do Resumo do Edital (estrutura do ConLicitação) e do portal de origem. Ambiente: subir.cjs + servidor.cjs rodando.
//   PORTA_TESTE=8836 node ambiente-teste/servidor.cjs
//   SITE_TESTE=http://127.0.0.1:8836 PRINTS=<pasta> node ambiente-teste/e2e-resumo-portal.cjs
// Sem IA paga: o dossiê é fictício (fixture de81-revisado) gravado no banco LOCAL e o /api/ia-edital real só o lê.
// A busca do painel usa resposta simulada do PNCP (page.route); a busca pública lê uma linha fictícia de oportunidades_abertas.
// Tudo que é criado aqui é apagado no fim.
const path = require('node:path');
const { passo, exigir, novaPagina, seed, chaves, PRINTS, SITE, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const fixture = require('../netlify/functions/__tests__/fixtures/de81-revisado.json');
const { __test: envio } = require('../netlify/functions/enviar-resumo-edital');
const ResumoEmail = require('../resumo-email');

const NUMERO = '99999999000191-1-000777/2026'; // fictício: não existe no PNCP
const TERMO = 'grampeador zetaquinze'; // objeto fictício único (busca pública)
const LINK = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=99999905907772026';
const SECOES = ['Identificação da Licitação', 'Informações da Sessão Pública', 'Órgão Responsável', 'Detalhes da Licitação', 'Seguro Garantia',
  'Informações sobre entrega e execução', 'Prazos importantes', 'Critérios da Proposta e Julgamento', 'Resumo dos Itens', 'Documentos de habilitação exigidos',
  'Atestado de capacidade técnica', 'Legislação', 'Anexos e declarações', 'Outras informações relevantes', 'Condições de pagamento', 'Penalidades e multas',
  'Possíveis questionamentos', 'Análise crítica', 'Análise e Considerações do Licitante'];
const BOTOES = ['Baixar Edital Completo', 'Enviar Checklist por E-mail', 'Gerar Checklist .docx', 'Imprimir Checklist'];

async function servico(metodo, caminho, corpo, extra = {}) {
  const r = await fetch(chaves.API_URL + caminho, { method: metodo, body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + chaves.SERVICE_ROLE_KEY, 'content-type': 'application/json', Prefer: 'return=representation,resolution=merge-duplicates', ...extra } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${caminho}: ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}
const titulosEmail = (html) => [...html.matchAll(/font-size:15px;font-weight:700;">([^<]+)<\/div>/g)].map((m) => m[1]);

async function main() {
  const futuro = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  const estrutura = { ...fixture.estrutura, sessaoPublica: { data: futuro, horario: '09:00', modoDisputa: 'Aberto' }, detalhes: { valorEstimado: '15000' } };
  // Mesmas marcas que o ia-edital exige para responder do dossiê sem reler nem chamar IA (VERSAO_RESUMO 17).
  await servico('POST', '/rest/v1/dossies_editais?on_conflict=numero_controle_pncp', { numero_controle_pncp: NUMERO, versao: 17, status: 'pronto', fonte_lida: true, gerado_em: new Date().toISOString(),
    dossie: { versao: 17, versaoValidacao: 17, fonteLida: true, prazosEmConferencia: true, revisaoPrazos: true, resposta: 'Resumo fictício do e2e.', estrutura, textoEdital: 'EDITAL FICTÍCIO DO E2E. Objeto: materiais de informática.', geradoEm: new Date().toISOString() } });
  await servico('POST', '/rest/v1/oportunidades_abertas?on_conflict=chave', { chave: 'e2e-resumo-portal', numero_controle_pncp: NUMERO, objeto: `Aquisição de ${TERMO} para escritório`, uf: 'AM',
    publicacao: new Date().toISOString().slice(0, 10), encerramento: futuro, dado: { orgao: 'Órgão Fictício do E2E', municipio: 'Manaus', modalidadeNome: 'Pregão - Eletrônico', usuarioNome: 'Compras.gov.br', linkSistemaOrigem: LINK } });

  const navegador = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: process.env.VER !== '1' });
  const chamadasIA = [];
  try {
    const p = await novaPagina(navegador, seed.usuarios.gestor);
    await p.context().addInitScript(() => { window.print = () => { window.__impresso = true; }; });
    const item = { numero_controle_pncp: NUMERO, description: 'Materiais de informática (e2e resumo/portal)', title: 'Materiais de informática (e2e resumo/portal)', uf: 'AM', municipio_nome: 'Manaus',
      orgao_nome: 'Órgão Fictício do E2E', data_fim_vigencia: `${futuro}T17:00:00`, data_publicacao_pncp: '2026-11-18T10:00:00', modalidade_licitacao_nome: 'Pregão - Eletrônico',
      usuario_nome: 'COMPRASNET - SIASG', link_sistema_origem: LINK };
    await p.route('**/api/pncp-proxy**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [item], total: 1 }) }));
    p.on('request', (r) => { if (/\/api\/ia-edital/.test(r.url())) chamadasIA.push(r.url()); });
    await p.goto(SITE + '/painel.html');
    await p.locator('nav button[data-alvo="oportunidades"]').dispatchEvent('click');
    await p.waitForSelector('#op-palavras', { state: 'visible' });
    const card = p.locator('#op-resultado .boletim-card').first();

    await passo('busca do painel: selo "Portal: …" e link "Acessar local da disputa" no cartão', p, async () => {
      await p.evaluate(() => { document.querySelector('#op-uf').querySelectorAll('option').forEach((o) => { o.selected = false; }); });
      await p.fill('#op-palavras', 'informática'); await p.click('#op-buscar');
      await card.waitFor({ timeout: 20000 }); await p.waitForTimeout(1500);
      const selo = (await card.locator('.portal-selo').innerText()).trim();
      exigir(selo === 'Portal: Compras.gov.br', `selo: "${selo}"`);
      const a = card.locator('a.portal-link');
      exigir((await a.innerText()).trim() === 'Acessar local da disputa', 'texto do link');
      exigir(await a.getAttribute('href') === LINK && await a.getAttribute('target') === '_blank' && /noopener/.test(await a.getAttribute('rel')), 'href/target/rel do link');
      await card.screenshot({ path: path.join(PRINTS, 'cartao-busca-portal.png') });
      return `${selo}; link ${LINK.slice(0, 60)}…`;
    });

    await passo('Resumo do Edital: 19 seções na ordem, 3 cartões e rodapé com 4 botões (dossiê local, sem IA)', p, async () => {
      await card.getByRole('button', { name: /Resumir edital/ }).click();
      await p.waitForSelector('#modal-ia-fundo.aberto', { timeout: 15000 });
      await p.waitForFunction(() => document.querySelectorAll('#modal-ia-cartoes-topo .modal-ia-cartao-topo').length === 3 && document.querySelector('[data-resumo-secao="Identificação da Licitação"]'), null, { timeout: 30000 })
        .catch(async () => { throw new Error('resumo não montou: ' + (await p.innerText('#modal-ia-fundo')).replace(/\s+/g, ' ').slice(0, 400)); });
      // "Possíveis questionamentos" é a Central de Defesa (defesa-ui.js): mesma gaveta, título no <summary>.
      await p.waitForSelector('#modal-ia-defesa details.secao-ia', { timeout: 15000 }).catch(() => {});
      const secoes = await p.locator('[data-resumo-estrutura] details.secao-ia').evaluateAll((n) => n.filter((x) => !x.parentElement.closest('details'))
        .map((x) => x.dataset.resumoSecao || x.querySelector('summary')?.textContent.trim()));
      const principais = secoes.filter((s) => SECOES.includes(s));
      exigir(JSON.stringify(principais) === JSON.stringify(SECOES), `ordem: ${principais.join(' | ')}`);
      exigir(secoes.indexOf(SECOES[18]) >= secoes.indexOf(SECOES[17]), 'considerações fora do fim');
      const cartoes = await p.locator('#modal-ia-cartoes-topo .resumo-cartao-rotulo').allInnerTexts();
      exigir(JSON.stringify(cartoes.map((c) => c.trim())) === JSON.stringify(['Valor Estimado', 'Modalidade', 'Data da Sessão']), 'cartões: ' + cartoes.join('|'));
      const dias = await p.locator('#modal-ia-cartoes-topo .resumo-selo').allInnerTexts();
      exigir(dias.some((d) => /Em \d+ dias/.test(d)), 'selo "Em N dias" ausente: ' + dias.join('|'));
      const botoes = (await p.locator('#modal-ia-fundo > .modal-ia > .modal-ia-acoes-rodape button').allInnerTexts()).map((b) => b.trim());
      exigir(JSON.stringify(botoes) === JSON.stringify(BOTOES), 'rodapé: ' + botoes.join('|'));
      exigir(await p.locator('#modal-ia-fundo > .modal-ia > .modal-ia-acoes-rodape').isVisible(), 'rodapé não visível');
      return `${secoes.length} seções (19 principais na ordem); cartões ${cartoes.join(' / ')}; ${dias.join(' ')}`;
    });

    await passo('impressão sai da mesma função do e-mail (resumo-email.js)', p, async () => {
      await p.waitForFunction(() => !document.getElementById('modal-ia-imprimir').disabled, null, { timeout: 15000 });
      const [janela] = await Promise.all([p.waitForEvent('popup'), p.click('#modal-ia-imprimir')]);
      await janela.waitForLoadState();
      const impresso = await janela.evaluate(() => '<!DOCTYPE html>' + document.documentElement.outerHTML);
      exigir(await janela.evaluate(() => window.__impresso === true), 'janela.print() não foi chamado');
      await janela.screenshot({ path: path.join(PRINTS, 'impressao-resumo.png'), fullPage: true });
      // O mesmo payload que o envio de e-mail manda ao servidor, montado com a função do servidor (enviar-resumo-edital).
      const dados = await p.evaluate(() => ({ texto: montarResumoParaCliente(iaEditalAtual, iaEstruturaAtual), link: linkPncp(iaEditalAtual.numeroControlePNCP),
        resumo: resumoParaEnvio(iaEstruturaAtual), edital: editalParaResumo(iaEditalAtual) }));
      const email = envio.montarHtml(dados.texto, dados.link, dados.resumo, dados.edital, null);
      const titulosImpr = titulosEmail(impresso), titulosMail = titulosEmail(email);
      exigir(titulosMail.length >= 15 && JSON.stringify(titulosImpr) === JSON.stringify(titulosMail), `seções impressão ≠ e-mail:\n${titulosImpr.join('|')}\n${titulosMail.join('|')}`);
      exigir(impresso.includes('class="lp-emitido"') && !/Deseja participar|responder-oportunidade/.test(impresso), 'impressão sem data de emissão ou com bloco de decisão');
      exigir(email.includes(ResumoEmail.URL_LOGO), 'e-mail sem a logo pública');
      await janela.close();
      return `${titulosImpr.length} seções iguais às do e-mail; window.print chamado`;
    });

    await passo('nenhuma IA paga: ia-edital respondeu do dossiê local', p, async () => {
      const r = await p.evaluate(async (n) => { const { data } = await window.__sbClient.auth.getSession();
        const resp = await fetch('/api/ia-edital', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + data.session.access_token }, body: JSON.stringify({ modo: 'resumo', edital: { numeroControlePNCP: n } }) });
        return resp.json(); }, NUMERO);
      exigir(r.doCache === true && r.estrutura, 'resposta sem doCache: ' + JSON.stringify(r).slice(0, 300));
      return `${chamadasIA.length} chamada(s) ao /api/ia-edital, todas do cache (doCache=true)`;
    });

    const pub = await novaPagina(navegador);
    await passo('busca pública: selo "Portal: …" e link "Acessar local da disputa"', pub, async () => {
      await pub.goto(SITE + '/index.html');
      await pub.fill('#busca-termo', TERMO); await pub.click('#busca-botao');
      const li = pub.locator('#busca-resultados li.op', { hasText: TERMO }).first();
      await li.waitFor({ timeout: 20000 }).catch(async () => { throw new Error('sem resultado: ' + (await pub.innerText('#busca-resultados')).slice(0, 300)); });
      const chip = (await li.locator('.chip-portal').innerText()).trim();
      exigir(chip === 'Portal: Compras.gov.br', `chip: "${chip}"`);
      const a = li.getByRole('link', { name: /Acessar local da disputa/ });
      exigir(await a.getAttribute('href') === LINK && await a.getAttribute('target') === '_blank', 'href/target do link');
      await li.screenshot({ path: path.join(PRINTS, 'busca-publica-portal.png') });
      return chip;
    });
  } finally {
    await navegador.close();
    await servico('DELETE', `/rest/v1/dossies_editais?numero_controle_pncp=eq.${encodeURIComponent(NUMERO)}`).catch(() => {});
    await servico('DELETE', '/rest/v1/oportunidades_abertas?chave=eq.e2e-resumo-portal').catch(() => {});
    await servico('DELETE', `/rest/v1/fila_dossies?numero_controle_pncp=eq.${encodeURIComponent(NUMERO)}`).catch(() => {});
  }
  const falhas = resultados.filter((r) => !r.ok);
  console.log(falhas.length ? `FALHOU: ${falhas.length}` : `E2E RESUMO/PORTAL OK (${resultados.length}/${resultados.length})`);
  process.exit(falhas.length ? 1 : 0);
}
main().catch((e) => { console.error('E2E FALHOU:', e); process.exit(1); });
