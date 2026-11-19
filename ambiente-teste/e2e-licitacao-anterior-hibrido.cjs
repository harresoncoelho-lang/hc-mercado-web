/* global document, window, Event -- usado só dentro de p.waitForFunction/p.evaluate (roda no navegador) */
// E2E local da "Licitação anterior híbrida": selos por camada, completude por pregão e atualização sozinha ao voltar
// da página do governo. Offline: o pregão é sintético (IFAM 23/2022, como no e2e v2) e a "gravação" é a fixture da extensão
// enviada pelo endpoint real /api/pregao-gravado. Nada de captcha, nada de produção; tudo é apagado no fim.
//   PORTA_TESTE=8805 node ambiente-teste/servidor.cjs
//   SITE_TESTE=http://127.0.0.1:8805 node ambiente-teste/e2e-licitacao-anterior-hibrido.cjs
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-licitacao-anterior-hibrido';
const { banco, comoUsuario, passo, exigir, novaPagina, seed, chaves, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const L = require('../netlify/functions/_licitacao_anterior');
const CN = require('../netlify/functions/_comprasnet_antigo');
const { chaveConsulta } = require('../netlify/functions/licitacao-anterior');

const RAIZ = path.resolve(__dirname, '..');
const IFAM = '15814205000232022';

const rest = async (caminho, op = {}) => {
  const r = await fetch(`${chaves.API_URL}/rest/v1/${caminho}`, { ...op, headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: `Bearer ${chaves.SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', ...(op.headers || {}) } });
  if (!r.ok) throw new Error(`${caminho.split('?')[0]} HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r;
};
function psql(sql) {
  const r = require('node:child_process').spawnSync('docker', ['exec', '-i', 'supabase_db_licitaplena-teste', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('psql: ' + r.stderr);
}
const limpar = () => psql(`delete from public.historico_consultas where chave like '158142|%tradu%'; delete from public.historico_compras where id_compra = '${IFAM}'; delete from public.pregoes_gravados where id_compra = '${IFAM}';`);

(async () => {
  const navegador = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: process.env.VER !== '1' });
  const p = await novaPagina(navegador, seed.usuarios.gestor);
  const movel = await novaPagina(navegador, seed.usuarios.gestor);
  limpar();

  const compra = { id_compra: IFAM, uasg: '158142', orgao_nome: 'INST.FED.DE EDUC.,CIENC.E TEC.DO AMAZONAS', unidade_nome: 'INST.FED.DE EDUC.,CIENC.E TEC.DO AMAZONAS', ano: 2022, numero: '00023/2022', modalidade: 'Pregão',
    plataforma: 'ComprasNet (antigo)', fonte: 'comprasnet-antigo', objeto: 'Serviços de tradução e apoio administrativo', data_publicacao: '2022-12-05', link_origem: CN.linkPregaoAntigo(L.decifrarIdCompra(IFAM)) };
  const itens = [[1, 'Tradução / interpretação simultânea / consecutiva', '08759521000139', 'VIP MULTISERVICOS E CONSULTORIA LTDA'], [3, 'Prestação de Serviços de Apoio Administrativo', '25044767000143', 'KADOSH SERVICOS DE APOIO ADMINISTRATIVOS LTDA']];
  await L.gravar(rest, { compras: [compra],
    itens: itens.map(([n, descricao]) => ({ id_compra: IFAM, numero_item: n, descricao, situacao_item: 'Homologado', tem_resultado: true, valor_estimado: 100 })),
    participacoes: itens.map(([n, , ni, nome]) => ({ id_compra: IFAM, numero_item: n, ...L.fornecedor(ni, nome, 'pp'), marca: 'Marca Teste', valor_homologado: 90, ordem_classificacao: 1, classificacao: 1 })) });
  const desdeAno = new Date().getUTCFullYear() - 3;
  const chave = chaveConsulta({ uasg: '158142', catmat: null, palavras: 'tradução' }, desdeAno);
  const casamentos = [1, 3].map((numero_item) => ({ item_edital: null, id_compra: IFAM, numero_item, confianca: 'baixa', regra: 'descrição parecida', semelhanca: 0.5 }));
  await rest('historico_consultas?on_conflict=chave', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ chave, uasg: '158142', catmat: null, palavras: 'tradução', desde_ano: desdeAno, compras: [IFAM], casamentos, situacao: 'completo', gerado_em: new Date().toISOString() }]) });

  const gravar = async () => {
    const leitor = await import('file:///' + path.join(RAIZ, 'extensao-leitura/pregao-leitor.mjs').replace(/\\/g, '/'));
    const ATA = 'http://comprasnet.gov.br/livre/pregao/AtaEletronico.asp?co_no_uasg=158142&numprp=232022&f_tpPregao=E&Seq=1';
    const leitura = JSON.parse(JSON.stringify(vm.runInNewContext(`(${leitor.lerPaginaPregao})(entrada)`, { URL, entrada: { href: ATA, html: fs.readFileSync(path.join(RAIZ, 'extensao-leitura/fixtures/comprasnet-ata-sintetica.html'), 'utf8'), captcha: false } })));
    const pregao = { ...leitura }; delete pregao.status; delete pregao.pendentes;
    const login = await comoUsuario(seed.usuarios.gestor, '/rest/v1/clientes?select=status');
    const r = await fetch(`${SITE}/api/pregao-gravado`, { method: 'POST', headers: { Authorization: `Bearer ${login.token}`, 'content-type': 'application/json' }, body: JSON.stringify(pregao) });
    exigir(r.status === 200, 'POST ' + r.status + ' ' + (await r.text()).slice(0, 200));
  };
  const texto = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ');
  const consultar = async (pagina, largura) => {
    await pagina.setViewportSize({ width: largura, height: 900 });
    await pagina.goto(SITE + '/painel.html#diagnostico');
    await pagina.click('[data-subaba="licitacao-anterior"]');
    const alvo = pagina.locator('#dg-licitacao-anterior');
    await alvo.locator('[name=orgao]').fill('158142');
    await alvo.getByRole('button', { name: 'Buscar órgão' }).click();
    await pagina.waitForFunction(() => document.querySelector('#dg-licitacao-anterior [name=uasg]')?.value === '158142', null, { timeout: 60000 });
    await alvo.locator('[name=palavras]').fill('tradução');
    await alvo.getByRole('button', { name: 'Consultar licitações anteriores' }).click();
    await pagina.waitForSelector('#dg-licitacao-anterior .la-camadas', { timeout: 120000 });
    await pagina.waitForTimeout(1500);
    return alvo;
  };

  await passo('avulsa 1280 antes de gravar: Automático ✔, falta ver (captcha), completude com ✖ e botão Ver tudo', p, async () => {
    const alvo = await consultar(p, 1280);
    const t = await texto(alvo.locator('.la-camadas'));
    exigir(/Automático: ComprasNet antigo · Dados abertos/.test(t), 'selo automático: ' + t);
    exigir(/Falta ver \(precisa do captcha\): 2 item/.test(t), 'falta ver: ' + t);
    exigir(/Vencedor ✔ · Preços ✔ · Marcas ✔/.test(t) && /Motivos de recusa ✖ — abra o pregão/.test(t), 'completude: ' + t);
    exigir(await alvo.getByText('Ver tudo do pregão (você resolve o captcha)').count() === 1, 'botão Ver tudo ausente');
    exigir(await alvo.locator('.la-atualizado').count() === 0, 'aviso de atualização sem gravação nova');
    return t;
  });

  await passo('gravação simulada (extensão, endpoint real) + foco da janela: atualiza sozinho com o aviso, sem clicar', p, async () => {
    await gravar();
    await p.evaluate(() => window.dispatchEvent(new Event('focus'))); // o foco volta da outra aba/janela
    await p.waitForSelector('#dg-licitacao-anterior .la-atualizado', { timeout: 20000 });
    const alvo = p.locator('#dg-licitacao-anterior');
    const t = await texto(alvo);
    exigir(/Atualizado com o que você gravou/.test(t), 'aviso ausente');
    exigir(/Gravado por clientes · não verificado · [12] de 2 itens/.test(t), 'selo gravado: ' + t.slice(0, 600));
    const c = await texto(alvo.locator('.la-camadas').first());
    exigir(/Motivos de recusa [✔◐]/.test(c) && !/Falta ver \(precisa do captcha\): 2 item/.test(c), 'completude depois: ' + c);
    // 1 de 2 itens lidos na fixture é plausível: o que importa é o selo e o ✔/✖ calculados do que existe
    return (await texto(alvo.locator('.la-camadas').first()));
  });
  await p.screenshot({ path: path.join(PRINTS, 'avulsa-1280-depois.png'), fullPage: true });

  await passo('segunda volta de foco sem novidade: não redesenha', p, async () => {
    await p.evaluate(() => { document.querySelector('#dg-licitacao-anterior .la').dataset.marca = '1'; });
    await p.waitForTimeout(3200);
    await p.evaluate(() => window.dispatchEvent(new Event('focus')));
    await p.waitForTimeout(2500);
    exigir(await p.evaluate(() => document.querySelector('#dg-licitacao-anterior .la')?.dataset.marca === '1'), 'redesenhou sem gravação nova');
    return 'sem redesenho';
  });

  await passo('avulsa 375 (celular): selos e completude sem rolagem horizontal', movel, async () => {
    const alvo = await consultar(movel, 375);
    const w = await movel.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    exigir(w[0] <= w[1] + 1, 'rolagem horizontal: ' + w);
    await alvo.locator('.la-camadas').first().scrollIntoViewIfNeeded();
    await movel.screenshot({ path: path.join(PRINTS, 'avulsa-375.png'), fullPage: true });
    return `scrollWidth ${w[0]} <= ${w[1]}`;
  });

  // Cartão do processo (sistema): antes de gravar -> limpa a gravação e refaz; depois com gravação.
  const [proc] = await banco(`operacao_processos?id=eq.${seed.ids.procA}&select=id,empresa_id`);
  const [tarefa] = await banco(`operacao_esteira_tarefas?processo_id=eq.${proc.id}&etapa=eq.historico&select=estado,detalhe,erro`);
  await passo('cartão do processo: 1280 e 375, com gravação feita', p, async () => {
    const detalhe = { compras: [IFAM], casamentos, alvos: [], gerado_em: new Date().toISOString() };
    await rest(`operacao_esteira_tarefas?processo_id=eq.${proc.id}&etapa=eq.historico`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ estado: 'feito', erro: null, detalhe }) });
    try {
      for (const [pagina, largura, nome] of [[p, 1280, 'processo-1280.png'], [movel, 375, 'processo-375.png']]) {
        await pagina.setViewportSize({ width: largura, height: 900 });
        await pagina.goto(`${SITE}/sistema?empresa=${proc.empresa_id}&processo=${proc.id}`);
        await pagina.waitForSelector('#licitacao-anterior:not([hidden]) .la-camadas', { timeout: 30000 });
        await pagina.waitForTimeout(1500);
        const t = await texto(pagina.locator('#licitacao-anterior .la-camadas').first());
        exigir(/Automático:/.test(t) && /Gravado por clientes/.test(t), `cartão ${largura}: ${t}`);
        if (largura === 375) { const w = await pagina.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); exigir(w[0] <= w[1] + 1, 'rolagem horizontal no cartão: ' + w); }
        await pagina.locator('#licitacao-anterior').scrollIntoViewIfNeeded();
        await pagina.screenshot({ path: path.join(PRINTS, nome), fullPage: true });
      }
      return 'cartão com selos nas duas larguras';
    } finally {
      await rest(`operacao_esteira_tarefas?processo_id=eq.${proc.id}&etapa=eq.historico`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ estado: tarefa.estado, erro: tarefa.erro, detalhe: tarefa.detalhe }) });
    }
  });

  limpar();
  await navegador.close();
  fs.writeFileSync(path.join(PRINTS, 'resultado.json'), JSON.stringify(resultados, null, 1));
  const falhas = resultados.filter((r) => !r.ok);
  for (const r of resultados) console.log(r.ok ? 'OK  ' : 'FALHA', r.n, r.nome, '-', (r.notas || []).join(' ').slice(0, 300));
  console.log(falhas.length ? `\nE2E híbrido FALHOU em ${falhas.length} passo(s)` : '\nE2E híbrido OK');
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
