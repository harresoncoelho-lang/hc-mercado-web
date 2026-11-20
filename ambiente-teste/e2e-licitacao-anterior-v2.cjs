/* global document, window -- usado só dentro de p.waitForFunction/p.evaluate (roda no navegador) */
// E2E local da "Licitação anterior" v2 (ComprasNet antigo sem captcha, motivos dos pregões gravados, selo de sanção,
// fonte sem HTTPS) e da fila da análise por CNPJ. Ambiente: subir.cjs + servidor.cjs (PORTA_TESTE=8801) rodando.
//   PORTA_TESTE=8801 node ambiente-teste/servidor.cjs
//   SITE_TESTE=http://127.0.0.1:8801 PRINTS=<pasta> node ambiente-teste/e2e-licitacao-anterior-v2.cjs
// Lê as páginas PÚBLICAS e SEM captcha do ComprasNet antigo (IFAM 23/2022, INPA 13/2022 e UASG 160014 2/2022) pelo
// mesmo código do robô, com a pausa de 1,5 s, e grava no banco LOCAL. A ata com captcha NUNCA é aberta: a "gravação" dos
// motivos é a da fixture sintética da extensão (dado fictício). Sanção fictícia no CEIS; tudo é apagado no fim.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-licitacao-anterior-v2';
const { banco, comoUsuario, passo, exigir, novaPagina, seed, chaves, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const L = require('../netlify/functions/_licitacao_anterior');
const CN = require('../netlify/functions/_comprasnet_antigo');
const H = require('../scripts/historico_licitacoes');
const { chaveConsulta } = require('../netlify/functions/licitacao-anterior');

const RAIZ = path.resolve(__dirname, '..');
const CPF = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/;
const IFAM = '15814205000232022', INPA = '24010505000132022', U160014 = '16001405000022022';
const BETA = '22333444000181'; // participante fictício da fixture da extensão
const COD_SANCAO = '990000000077';

const servicoRest = async (caminho, op = {}) => fetch(`${chaves.API_URL}/rest/v1/${caminho}`, { ...op,
  headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: `Bearer ${chaves.SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', ...(op.headers || {}) } });
const rest = async (caminho, op) => { const r = await servicoRest(caminho, op); if (!r.ok) throw new Error(`${caminho.split('?')[0]} HTTP ${r.status} ${(await r.text()).slice(0, 200)}`); return r; };
function psql(sql) {
  const r = require('node:child_process').spawnSync('docker', ['exec', '-i', 'supabase_db_licitaplena-teste', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('psql: ' + r.stderr);
  return r.stdout;
}
const IDS = [IFAM, INPA, U160014].map((i) => `'${i}'`).join(',');
const limpar = () => psql(`delete from public.historico_consultas where chave like '158142|%tradu%'; delete from public.historico_compras where id_compra in (${IDS});
  delete from public.pregoes_gravados where id_compra in ('${IFAM}'); delete from public.sancoes_empresas where cadastro='CEIS' and codigo_sancao='${COD_SANCAO}';`);

// O que a Pesquisa de Preços do Compras.gov deixa no banco para um pregão antigo (só o vencedor): ponto de partida do robô.
const pesquisa = (id, orgao, numero, objeto, data, itens) => ({
  compra: { id_compra: id, uasg: id.slice(0, 6), orgao_nome: orgao, unidade_nome: orgao, ano: Number(id.slice(13)), numero, modalidade: 'Pregão', plataforma: 'ComprasNet (antigo)', objeto, data_publicacao: data,
    link_origem: CN.linkPregaoAntigo(L.decifrarIdCompra(id)) },
  itens: itens.map(([n, descricao, ni, nome]) => ({ item: { id_compra: id, numero_item: n, descricao, situacao_item: 'Homologado', tem_resultado: true },
    part: ni ? { id_compra: id, numero_item: n, ...L.fornecedor(ni, nome, 'pp') } : null })),
});

(async () => {
  const navegador = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: process.env.VER !== '1' });
  const p = await novaPagina(navegador, seed.usuarios.gestor);
  limpar();
  const antes = { pedidos: [] };

  await passo('robô lê as páginas públicas sem captcha do ComprasNet antigo (3 pregões) e grava no banco local', null, async () => {
    const bases = [
      pesquisa(IFAM, 'INST.FED.DE EDUC.,CIENC.E TEC.DO AMAZONAS', '00023/2022', 'Serviços de tradução e apoio administrativo', null,
        [[1, 'Tradução / interpretação simultânea / consecutiva', '08759521000139', 'VIP MULTISERVICOS E CONSULTORIA LTDA'], [3, 'Prestação de Serviços de Apoio Administrativo', '25044767000143', 'KADOSH SERVICOS DE APOIO ADMINISTRATIVOS LTDA']]),
      pesquisa(INPA, 'INSTITUTO NACIONAL DE PESQUISAS DA AMAZONIA', '00013/2022', 'Reagentes químicos', '2022-12-05',
        [[1, 'Ácido Sulfúrico', '07944100000115', 'PROC9 INDUSTRIA QUIMICA LTDA'], [4, 'Álcool Etílico', '07944100000115', 'PROC9 INDUSTRIA QUIMICA LTDA']]),
      pesquisa(U160014, 'COMANDO DA MARINHA (teste)', '00002/2022', 'Gêneros alimentícios', '2022-12-06',
        [[3, 'Açúcar', null, null], [7, 'Café', '07638718000157', 'IMPERIAL CAFE COMERCIO EXPORTACAO E IMPORTACAO LTDA']]),
    ];
    const compras = bases.map((b) => b.compra), itens = bases.flatMap((b) => b.itens.map((i) => i.item)), parts = bases.flatMap((b) => b.itens.map((i) => i.part).filter(Boolean));
    await L.gravar(rest, { compras, itens, participacoes: parts });
    const numeros = new Map(bases.map((b) => [b.compra.id_compra, new Set(b.itens.map((i) => i.item.numero_item))]));
    const pedidos = [];
    const t0 = Date.now();
    const r = await H.lerComprasAntigas({ compras, numeros }, { rest, fetchImpl: async (url, op) => { pedidos.push({ url: String(url), t: Date.now() }); return fetch(url, op); } });
    await L.gravar(rest, { compras: r.compras, itens: r.itens, participacoes: r.participacoes });
    antes.pedidos = pedidos;
    const folgas = pedidos.slice(1).map((x, i) => x.t - pedidos[i].t);
    exigir(pedidos.length === 12, `esperava 12 páginas, foram ${pedidos.length}`);
    exigir(pedidos.every((x) => x.url.startsWith('https://www.comprasnet.gov.br/livre/pregao/') && !/AtaEletronico/i.test(x.url)), 'página fora da lista ou ata com captcha');
    exigir(Math.min(...folgas) >= 1450, `pausa menor que 1,5 s: ${Math.min(...folgas)} ms`);
    exigir(r.resumo.lidos === 3, 'pregões lidos: ' + JSON.stringify(r.resumo));
    const [ifam] = await banco(`historico_compras?id_compra=eq.${IFAM}&select=fonte,fonte_lida_em,link_origem,data_publicacao`);
    exigir(ifam.fonte === 'comprasnet-antigo' && ifam.data_publicacao === '2022-12-05' && ifam.link_origem.startsWith('https://www.comprasnet.gov.br/'), 'compra IFAM: ' + JSON.stringify(ifam));
    const proc9 = await banco(`historico_participacoes?id_compra=eq.${INPA}&numero_item=eq.1&select=marca,fabricante,modelo,descricao_ofertada,valor_homologado,ordem_classificacao`);
    exigir(proc9[0].marca === 'Proc9' && /Ácido Sulfúrico/.test(proc9[0].descricao_ofertada) && Number(proc9[0].valor_homologado) === 147.12, 'marca/valor INPA: ' + JSON.stringify(proc9));
    const [cafe] = await banco(`historico_participacoes?id_compra=eq.${U160014}&numero_item=eq.7&select=marca,valor_homologado,quantidade_homologada`);
    const [acucar] = await banco(`historico_itens?id_compra=eq.${U160014}&numero_item=eq.3&select=situacao_item,motivo_situacao,tem_resultado`);
    exigir(/cancel/i.test(acucar.situacao_item) && /propostas/.test(acucar.motivo_situacao), 'item cancelado sem motivo: ' + JSON.stringify(acucar));
    return `12 páginas, pausa mínima ${Math.min(...folgas)} ms, ${(Date.now() - t0) / 1000}s; IFAM data ${ifam.data_publicacao}; INPA marca ${proc9[0].marca} unit ${proc9[0].valor_homologado}; café UASG 160014 marca ${cafe.marca} ${cafe.valor_homologado} x ${cafe.quantidade_homologada}; açúcar: ${acucar.situacao_item} — ${acucar.motivo_situacao}`;
  });

  // Gravação dos motivos: a mesma fixture sintética do ata da extensão (IFAM 23/2022), pelo endpoint real, como gestor aprovado.
  await passo('extensão (fixture sintética) grava motivos pelo endpoint real; participante fictício ganha sanção no CEIS', null, async () => {
    const leitor = await import('file:///' + path.join(RAIZ, 'extensao-leitura/pregao-leitor.mjs').replace(/\\/g, '/'));
    const ATA = 'http://comprasnet.gov.br/livre/pregao/AtaEletronico.asp?co_no_uasg=158142&numprp=232022&f_tpPregao=E&Seq=1';
    const leitura = JSON.parse(JSON.stringify(vm.runInNewContext(`(${leitor.lerPaginaPregao})(entrada)`, { URL, entrada: { href: ATA, html: fs.readFileSync(path.join(RAIZ, 'extensao-leitura/fixtures/comprasnet-ata-sintetica.html'), 'utf8'), captcha: false } })));
    const pregao = { ...leitura }; delete pregao.status; delete pregao.pendentes;
    const login = await comoUsuario(seed.usuarios.gestor, '/rest/v1/clientes?select=status');
    const r = await fetch(`${SITE}/api/pregao-gravado`, { method: 'POST', headers: { Authorization: `Bearer ${login.token}`, 'content-type': 'application/json' }, body: JSON.stringify(pregao) });
    exigir(r.status === 200, 'POST ' + r.status + ' ' + (await r.text()).slice(0, 200));
    const [pg] = await banco(`pregoes_gravados?id_compra=eq.${IFAM}&select=fonte,fonte_sem_https,leituras_concordantes`);
    exigir(pg.fonte_sem_https === true && pg.leituras_concordantes === 1, 'pregão gravado: ' + JSON.stringify(pg));
    psql(`insert into public.sancoes_empresas(cadastro,codigo_sancao,cnpj,razao_social,tipo_sancao,orgao_sancionador,data_inicio,data_fim,data_carga)
      values('CEIS','${COD_SANCAO}','${BETA}','EMPRESA FICTICIA BETA LTDA (sanção fictícia, teste local)','Impedimento de licitar (fictício)','Órgão fictício', current_date - 10, current_date + 200, current_date)`);
    return `gravado (fonte_sem_https=${pg.fonte_sem_https}, leituras=${pg.leituras_concordantes}); sanção fictícia no CNPJ ${BETA}`;
  });

  // Cache da consulta avulsa: os 3 pregões como se a busca tivesse achado (a descoberta real é da Pesquisa de Preços).
  const desdeAno = new Date().getUTCFullYear() - 3;
  const chave = chaveConsulta({ uasg: '158142', catmat: null, palavras: 'tradução' }, desdeAno);
  const casamentos = [[IFAM, 1], [IFAM, 3], [INPA, 1], [INPA, 4], [U160014, 3], [U160014, 7]].map(([id_compra, numero_item]) => ({ item_edital: null, id_compra, numero_item, confianca: 'baixa', regra: 'descrição parecida', semelhanca: 0.5 }));
  await rest('historico_consultas?on_conflict=chave', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ chave, uasg: '158142', catmat: null, palavras: 'tradução', desde_ano: desdeAno, compras: [IFAM, INPA, U160014], casamentos, situacao: 'completo', gerado_em: new Date().toISOString() }]) });

  const consultar = async (pagina, largura) => {
    await pagina.setViewportSize({ width: largura, height: 900 });
    await pagina.goto(SITE + '/painel.html#diagnostico');
    await pagina.click('[data-subaba="licitacao-anterior"]');
    const alvo = pagina.locator('#dg-licitacao-anterior');
    await alvo.locator('[name=orgao]').fill('158142');
    await alvo.getByRole('button', { name: 'Buscar órgão' }).click();
    await pagina.waitForFunction(() => document.querySelector('#dg-licitacao-anterior [name=uasg]')?.value === '158142', null, { timeout: 60000 })
      .catch(async () => { throw new Error('órgão não encontrado: ' + (await alvo.innerText()).slice(0, 200)); });
    await alvo.locator('[name=palavras]').fill('tradução');
    await alvo.getByRole('button', { name: 'Consultar licitações anteriores' }).click();
    await pagina.waitForFunction(() => /Resultado guardado|Consulta feita agora|Não foi|indispon/i.test(document.querySelector('#dg-licitacao-anterior .la-apoio[role=status]')?.textContent || ''), null, { timeout: 120000 });
    await pagina.waitForTimeout(2500); // gravados e selos chegam depois do cartão
    return alvo;
  };

  await passo('avulsa 1280: ComprasNet antigo (marca, motivo do cancelamento), motivos gravados com selo e sanção', p, async () => {
    const alvo = await consultar(p, 1280);
    const estado = await alvo.locator('.la-apoio[role=status]').innerText();
    exigir(/Resultado guardado/.test(estado), 'estado: ' + estado);
    for (const d of await alvo.locator('details.la-itens').all()) await d.evaluate((e) => { e.open = true; });
    for (const d of await alvo.locator('details.la-participantes').all()) await d.evaluate((e) => { e.open = true; });
    const t = (await alvo.innerText()).replace(/\s+/g, ' ');
    exigir(!CPF.test(t), 'CPF na tela');
    exigir(/Marca: Proc9/.test(t), 'marca Proc9 (INPA) ausente');
    exigir(/Cancelado no julgamento/.test(t) && /Motivo \(termo de adjudicação do ComprasNet\): Por não haver propostas validas/.test(t), 'motivo do item cancelado ausente');
    exigir(/Abrir pregão anterior no ComprasNet/.test(t), 'link do ComprasNet antigo ausente');
    exigir(/Marca, situação e vencedor lidos das páginas públicas do ComprasNet antigo \(sem captcha\)/.test(t), 'fonte do ComprasNet antigo não declarada');
    exigir(/produto ofertado é álcool em gel/.test(t) && /Recusa em/.test(t), 'motivo literal da recusa gravada ausente');
    exigir(/lido por usuário, não verificado · lido em/.test(t), 'selo não verificado ausente');
    exigir(/fonte sem HTTPS/.test(t), 'selo fonte sem HTTPS ausente');
    exigir(/Empresa com sanção vigente \(CEIS\)/.test(t), 'selo de sanção ausente');
    exigir(/grave com a extensão do LicitaPlena/.test(t), 'dica de gravar ausente nas compras sem gravação');
    // O cartão híbrido tem o link explícito "Ver tudo"/"Abrir a ata completa" (o usuário resolve o captcha); nenhum OUTRO link pode levar à ata com captcha.
    const links = await alvo.locator('a').evaluateAll((as) => as.map((a) => ({ href: a.href, texto: a.textContent })));
    const fora = links.filter((l) => /AtaEletronico/i.test(l.href) && !/ver tudo|abrir a ata completa/i.test(l.texto));
    exigir(!fora.length, 'link para a ata com captcha fora do botão "Ver tudo": ' + JSON.stringify(fora));
    const nSelos = await alvo.locator('.sancao-selo').count();
    return `selos de sanção ${nSelos}; ${t.slice(t.indexOf('Pregão'), t.indexOf('Pregão') + 260)}`;
  });
  await p.screenshot({ path: path.join(PRINTS, 'avulsa-1280.png'), fullPage: true });

  const movel = await novaPagina(navegador, seed.usuarios.gestor);
  await passo('avulsa 375 (celular): mesmo conteúdo sem rolagem horizontal', movel, async () => {
    const alvo = await consultar(movel, 375);
    for (const d of await alvo.locator('details.la-itens').all()) await d.evaluate((e) => { e.open = true; });
    for (const d of await alvo.locator('details.la-participantes').all()) await d.evaluate((e) => { e.open = true; });
    const largura = await movel.evaluate(() => ({ doc: document.documentElement.scrollWidth, janela: window.innerWidth }));
    exigir(largura.doc <= largura.janela + 1, `rolagem horizontal no celular: ${JSON.stringify(largura)}`);
    await movel.screenshot({ path: path.join(PRINTS, 'avulsa-375.png'), fullPage: true });
    return `scrollWidth ${largura.doc} <= ${largura.janela}`;
  });

  // Cartão do processo (sistema): a tarefa 'historico' do processo do seed ganha o detalhe dos 3 pregões.
  const [proc] = await banco(`operacao_processos?id=eq.${seed.ids.procA}&select=id,empresa_id`);
  const [tarefa] = await banco(`operacao_esteira_tarefas?processo_id=eq.${proc.id}&etapa=eq.historico&select=estado,detalhe,erro`);
  await passo('cartão do processo (sistema): mesma leitura, 1280 e 375', p, async () => {
    exigir(tarefa, 'processo do seed sem tarefa historico');
    const detalhe = { compras: [IFAM, INPA, U160014], casamentos, alvos: [], gerado_em: new Date().toISOString() };
    await rest(`operacao_esteira_tarefas?processo_id=eq.${proc.id}&etapa=eq.historico`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ estado: 'feito', erro: null, detalhe }) });
    try {
      for (const [pagina, largura, nome] of [[p, 1280, 'processo-1280.png'], [movel, 375, 'processo-375.png']]) {
        await pagina.setViewportSize({ width: largura, height: 900 });
        await pagina.goto(`${SITE}/sistema?empresa=${proc.empresa_id}&processo=${proc.id}`);
        await pagina.waitForSelector('#licitacao-anterior:not([hidden]) .la-compra', { timeout: 30000 });
        await pagina.waitForTimeout(2500);
        for (const d of await pagina.locator('#licitacao-anterior details').all()) await d.evaluate((e) => { e.open = true; });
        const t = (await pagina.locator('#licitacao-anterior').innerText()).replace(/\s+/g, ' ');
        exigir(/produto ofertado é álcool em gel/.test(t) && /lido por usuário, não verificado/.test(t) && /fonte sem HTTPS/.test(t) && /Empresa com sanção vigente/.test(t), `cartão ${largura} sem as camadas novas: ${t.slice(0, 200)}`);
        exigir(!CPF.test(t), 'CPF no cartão');
        if (largura === 375) { const w = await pagina.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); exigir(w[0] <= w[1] + 1, 'rolagem horizontal no cartão (celular): ' + w); }
        await pagina.locator('#licitacao-anterior').scrollIntoViewIfNeeded();
        await pagina.screenshot({ path: path.join(PRINTS, nome), fullPage: true });
      }
      return 'cartão do processo com motivos, selos e fonte sem HTTPS em 1280 e 375';
    } finally {
      await rest(`operacao_esteira_tarefas?processo_id=eq.${proc.id}&etapa=eq.historico`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ estado: tarefa.estado, erro: tarefa.erro, detalhe: tarefa.detalhe }) });
    }
  });

  await passo('lote de sanções: resultado por CNPJ, 201 CNPJs recusado, token inválido recusado', null, async () => {
    const login = await comoUsuario(seed.usuarios.gestor, '/rest/v1/clientes?select=status');
    const post = (cnpjs, token) => fetch(`${SITE}/api/sancoes-cnpj`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ cnpjs }) });
    const ok = await post([BETA, '07944100000115'], login.token);
    const corpo = await ok.json();
    exigir(ok.status === 200 && corpo.resultados[BETA].vigentes.length === 1 && corpo.resultados['07944100000115'].vigentes.length === 0, 'lote: ' + JSON.stringify(corpo).slice(0, 300));
    const muitos = await post(Array.from({ length: 201 }, (_, i) => String(10000000000000 + i)), login.token);
    exigir(muitos.status === 400, 'lote de 201 não recusado: ' + muitos.status);
    const semLogin = await post([BETA], 'invalido');
    exigir(semLogin.status === 401, 'sem login: ' + semLogin.status);
    return `lote OK (1 sancionado de 2); 201 -> 400; token inválido -> ${semLogin.status}`;
  });

  limpar();
  await navegador.close();
  fs.writeFileSync(path.join(PRINTS, 'resultado.json'), JSON.stringify(resultados, null, 1));
  const falhas = resultados.filter((r) => !r.ok);
  console.log(falhas.length ? `\nE2E v2 FALHOU em ${falhas.length} passo(s)` : '\nE2E v2 OK');
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error('E2E v2 FALHOU:', e); try { limpar(); } catch { /* sem docker */ } process.exit(1); });
