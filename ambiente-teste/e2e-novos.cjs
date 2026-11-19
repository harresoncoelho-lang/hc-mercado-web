/* global document, window -- usados só dentro de p.waitForFunction/p.evaluate (rodam no navegador) */
// Passos do e2e para as funções novas (chamado pelo main de e2e.cjs depois dos 21 passos originais).
// Mesmo ambiente: Supabase local + servidor.cjs + robôs com a trava redirecionar-fetch.cjs.
// Dado fictício criado aqui (sanção no Hoje, conta pendente) é apagado no fim, mesmo com passo falhando.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { banco, comoUsuario, robo, passo, exigir, novaPagina, seed, chaves, SITE, PRINTS } = require('./e2e.cjs');

const RAIZ = path.resolve(__dirname, '..');
const CPF = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/;
const PROD = 'https://lsqjamqvmrcyrvowndiu.supabase.co';
const CNPJ_SANCAO_FICTICIA = '12345678000195'; // Materiais Horizonte Teste (org A, seed)
const CODIGO_SANCAO_FICTICIA = '990000000001';

// REST com service_role LOCAL para preparar e limpar dado de teste.
async function servico(metodo, caminho, corpo, extra = {}) {
  const r = await fetch(chaves.API_URL + caminho, { method: metodo, body: corpo === undefined ? undefined : (Buffer.isBuffer(corpo) ? corpo : JSON.stringify(corpo)),
    headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + chaves.SERVICE_ROLE_KEY, 'content-type': 'application/json', Prefer: 'return=representation', ...extra } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${caminho}: ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}

// PDF mínimo válido de 1 página (xref com offsets corretos), para o "PDF único" ter o que juntar.
function pdfMinimo(texto) {
  const conteudo = `BT /F1 18 Tf 72 720 Td (${texto}) Tj ET`;
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let s = '%PDF-1.4\n';
  const offs = objs.map((o, i) => { const off = s.length; s += `${i + 1} 0 obj\n${o}\nendobj\n`; return off; });
  const xref = s.length;
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(s, 'latin1');
}

function psql(sql) {
  const r = require('node:child_process').spawnSync('docker', ['exec', '-i', 'supabase_db_licitaplena-teste', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('psql: ' + r.stderr);
  return r.stdout;
}
const psqlLinhas = (sql) => psql(sql).split('\n').map(l => l.trim()).filter(Boolean);

async function analisar(p, cnpj) {
  await p.goto(SITE + '/painel.html#empresa');
  await p.waitForSelector('#emp-cnpj', { state: 'visible', timeout: 20000 });
  await p.fill('#emp-cnpj', cnpj);
  await p.click('#emp-buscar');
  await p.waitForSelector('#emp-analise-cnpj .acn-participacoes', { timeout: 120000 });
  await p.waitForTimeout(1500);
  return (await p.innerText('#emp-analise-cnpj')).replace(/\s+/g, ' ');
}

async function passosNovos({ navegador, p, contexto, urlProcesso }) {
  const { usuarios: U, ids } = seed;
  const empresa = contexto.proc.empresa_id;
  const limpar = [];
  // URL assinada do Storage sai com o host de produção fixo na function (em produção é o certo); no navegador de
  // teste ela é servida pelo Storage local, como a trava faz no servidor. Nada vai a *.supabase.co.
  await p.context().route(u => u.hostname === new URL(PROD).hostname, async (rota) => {
    const u = new URL(rota.request().url());
    if (!u.pathname.startsWith('/storage/v1/object/sign/')) return rota.abort();
    const r = await fetch(chaves.API_URL + u.pathname + u.search);
    await rota.fulfill({ status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/octet-stream' }, body: Buffer.from(await r.arrayBuffer()) });
  });
  try {
    await passo('dados da empresa unificado: identificação + perfil + logo', p, async () => {
      await p.goto(`${SITE}/operacao.html?aba=identificacao`);
      await p.waitForSelector('#perfil-salvar', { timeout: 20000 });
      await p.selectOption('#empresa-atual', empresa); await p.waitForTimeout(3000);
      const aba = p.locator('#aba-identificacao');
      exigir(await aba.isVisible(), 'aba "Dados da empresa" não está visível');
      const ident = await p.inputValue('#empresa-identificacao-endereco').catch(() => '');
      const fantasia = await p.inputValue('#perfil-nome_fantasia');
      exigir(ident.includes('Rua Fictícia'), `identificação não aparece no quadro único: "${ident}"`);
      exigir(fantasia === 'Horizonte Teste', `perfil não aparece no quadro único: "${fantasia}"`);
      const logo = aba.locator('#perfil-logo-area img');
      exigir(await logo.count() && await logo.first().evaluate(i => i.complete && i.naturalWidth > 0), 'logo sem prévia carregada');
      const ordem = await aba.locator('#identificacao-empresa, #perfil-empresa').evaluateAll(n => n.map(x => x.id));
      return `mesma aba: ${ordem.join(' + ')}; endereço "${ident}"; nome fantasia "${fantasia}"; logo com prévia`;
    });

    // Termo curto da 1ª descrição do processo: o produto do catálogo precisa "parecer" com o item para "Usar do catálogo".
    // Item 2: o item 1 ficou com mínimo 36,15 acima do valor 35,90 (passos 12-13) e o servidor recusa mudar o custo dele (bug listado no RESULTADO.md).
    const [item1] = await banco(`operacao_itens_resultado?processo_id=eq.${contexto.proc.id}&select=id,descricao,identificador&order=numero_ordem.asc.nullslast&offset=1&limit=1`);
    const termoItem = String(item1.descricao).split(/[,;:(\n–]| - /)[0].replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ').slice(0, 100);

    await passo('catálogo: cadastrar produto', p, async () => {
      await p.click('.aba[data-aba="catalogo"]');
      const cat = p.locator('#catalogo-produtos');
      await cat.locator('[data-acao="novo"]').click({ timeout: 15000 });
      await p.fill('#cat-nome', termoItem); await p.fill('#cat-marca', 'Marca do Catálogo'); await p.fill('#cat-modelo', 'Mod C1');
      await p.fill('#cat-unidade', 'UNIDADE'); await p.fill('#cat-custo_unitario', '12,34'); await p.fill('#cat-fornecedor_nome', 'Fornecedor Fictício');
      await cat.getByRole('button', { name: 'Salvar produto' }).click(); await p.waitForTimeout(2500);
      const [prod] = await banco(`operacao_catalogo_produtos?empresa_id=eq.${empresa}&nome=eq.${encodeURIComponent(termoItem)}&select=id,nome,marca,custo_unitario`);
      exigir(prod && Number(prod.custo_unitario) === 12.34, 'produto não gravado: ' + JSON.stringify(prod) + ' ' + (await cat.innerText()).slice(0, 300));
      contexto.produto = prod;
      return JSON.stringify(prod);
    });

    await passo('catálogo: Buscar no mercado (Compras.gov real) e adicionar ao catálogo', p, async () => {
      const cat = p.locator('#catalogo-produtos');
      await cat.locator('[data-acao="mercado"]').click();
      const busca = cat.locator('.catalogo-mercado-busca');
      await busca.locator('input[type=search]').fill('caneta esferográfica');
      const usar = busca.locator('[data-mercado-usar], [data-mercado-marca-usar]').first();
      // A Pesquisa de Preços às vezes não responde (a tela avisa "não respondeu agora"): até 3 tentativas, como a pessoa faria.
      for (let tentativa = 1; tentativa <= 3; tentativa++) {
        await busca.getByRole('button', { name: 'Buscar', exact: true }).click();
        await p.waitForFunction(() => !/Buscando no Compras/.test(document.querySelector('.catalogo-mercado-busca p.nota[role=status]')?.textContent || ''), null, { timeout: 90000 });
        if (await usar.count()) break;
      }
      await usar.waitFor({ timeout: 90000 }).catch(async () => { throw new Error('sem resultado do Compras.gov: ' + (await busca.innerText()).replace(/\s+/g, ' ').slice(0, 400)); });
      const resumo = (await busca.locator('.mercado-resumo').innerText()).replace(/\s+/g, ' ');
      await usar.click(); await p.waitForTimeout(800);
      const nome = await p.inputValue('#cat-nome'), marca = await p.inputValue('#cat-marca');
      exigir(nome && marca, `formulário não veio preenchido: nome "${nome}", marca "${marca}"`);
      exigir(await cat.locator('.catalogo-referencia').count(), 'sem "Preço de referência do mercado" no formulário');
      await p.fill('#cat-custo_unitario', '1,10');
      await cat.getByRole('button', { name: 'Salvar produto' }).click(); await p.waitForTimeout(2500);
      const prods = await banco(`operacao_catalogo_produtos?empresa_id=eq.${empresa}&preco_referencia=not.is.null&select=nome,marca,preco_referencia,referencia_fonte,referencia_em`);
      exigir(prods.length, 'produto com preço de referência não gravado: ' + (await cat.innerText()).slice(0, 300));
      return `resumo: ${resumo.slice(0, 160)} | gravado: ${JSON.stringify(prods[0])}`;
    });

    await passo('item: "Usar do catálogo" e "Buscar no mercado"', p, async () => {
      await p.goto(urlProcesso());
      const li = p.locator('#itens-processo [data-item-lista] li', { has: p.locator('#itens-custo-' + item1.id) });
      await li.waitFor({ timeout: 20000 });
      await li.getByRole('button', { name: 'Usar do catálogo' }).click();
      const opcao = li.locator('.catalogo-usar-opcao', { hasText: termoItem.slice(0, 20) }).first();
      await opcao.waitFor({ timeout: 10000 }).catch(async () => { throw new Error('sem sugestão do catálogo: ' + (await li.locator('.catalogo-usar').innerText())); });
      await opcao.getByRole('button', { name: 'Usar' }).click(); await p.waitForTimeout(2000);
      const form = p.locator('#itens-processo form').first();
      const marca = await form.locator('[name=marca]').inputValue();
      exigir(marca === 'Marca do Catálogo', `marca do catálogo não foi para o formulário: "${marca}"`);
      const [it] = await banco(`operacao_itens_resultado?id=eq.${item1.id}&select=custo_unitario`);
      exigir(Number(it.custo_unitario) === 12.34, 'custo do catálogo não gravado: ' + JSON.stringify(it));
      await form.getByRole('button', { name: /Cancelar/ }).click().catch(() => {});
      await li.getByRole('button', { name: 'Buscar no mercado' }).click();
      const resultado = li.locator('[data-mercado-usar], [data-mercado-marca-usar], .mercado-compras li, p.nota[role=status]').first();
      await resultado.waitFor({ timeout: 90000 });
      await p.waitForFunction(id => !/Buscando no Compras/.test(document.querySelector(`#itens-custo-${id}`)?.closest('li')?.innerText || ''), item1.id, { timeout: 90000 });
      const txt = (await li.innerText()).replace(/\s+/g, ' ');
      const achou = await li.locator('[data-mercado-usar], [data-mercado-marca-usar]').count();
      return `catálogo: marca "${marca}", custo 12,34 gravado; mercado (termo do item): ${achou} opção(ões) de marca — ${(txt.match(/(\d+ compra[^.]*|Nenhum[^.]*)/) || [''])[0].slice(0, 160)}`;
    });

    await passo('PDF único dos documentos', p, async () => {
      const docs = await banco(`operacao_documentos?empresa_id=eq.${ids.empA1}&select=id,tipo&order=tipo`);
      const [pdf1, img] = docs;
      const enviar = async (d, nome, corpo, tipo) => {
        const caminho = `${ids.orgA}/${ids.empA1}/e2e-${nome}`;
        await servico('POST', `/storage/v1/object/operacao-documentos/${caminho}`, corpo, { 'content-type': tipo, 'x-upsert': 'true' });
        await servico('PATCH', `/rest/v1/operacao_documentos?id=eq.${d.id}`, { arquivo_caminho: caminho, arquivo_nome: nome, arquivo_tipo: tipo, arquivo_tamanho: corpo.length }).catch(() =>
          servico('PATCH', `/rest/v1/operacao_documentos?id=eq.${d.id}`, { arquivo_caminho: caminho }));
      };
      await enviar(pdf1, 'certidao.pdf', pdfMinimo('Certidao ficticia de teste'), 'application/pdf');
      await enviar(img, 'logo.png', fs.readFileSync(path.join(RAIZ, 'logo-assinatura-azul.png')), 'image/png');
      await p.goto(`${SITE}/operacao.html?aba=documentos`);
      await p.waitForSelector('#empresa-atual', { timeout: 20000 });
      await p.selectOption('#empresa-atual', ids.empA1); await p.waitForTimeout(2500);
      for (const d of [img, pdf1]) await p.locator(`.pdf-marca input[data-id="${d.id}"]`).check();
      const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), p.click('#btn-pdf-unico')]);
      const destino = path.join(PRINTS, 'pdf-unico.pdf'); await dl.saveAs(destino);
      const buf = fs.readFileSync(destino);
      exigir(buf.subarray(0, 5).toString() === '%PDF-', 'download não é PDF');
      // Páginas contadas pelo próprio pdf-lib da página (o pdf.js antigo do pdf-parse não lê o PDF 1.7 que ele gera; o pypdf lê).
      const paginas = await p.evaluate(async b64 => (await window.PDFLib.PDFDocument.load(Uint8Array.from(atob(b64), c => c.charCodeAt(0)))).getPageCount(), buf.toString('base64'));
      exigir(paginas === 2, `esperava 2 páginas (imagem + PDF), veio ${paginas}; avisos: ${await p.innerText('#pdf-unico-avisos')}`);
      exigir(buf.toString('latin1').includes('(Certidao ficticia de teste)'), 'conteúdo do PDF original não está no PDF único');
      return `pdf-unico.pdf: ${paginas} páginas na ordem marcada (logo PNG -> A4, depois a certidão PDF); ${buf.length} bytes`;
    });

    await passo('licitação anterior no processo (esteira: etapa histórico)', p, async () => {
      let [t] = await banco(`operacao_esteira_tarefas?processo_id=eq.${contexto.proc.id}&etapa=eq.historico&select=estado,erro,detalhe,tentativas`);
      let nota = '';
      if (t?.estado === 'pendente') {
        // Fonte fora do ar na rodada anterior (ex.: PNCP 503): adianta o backoff e roda a próxima rodada do robô.
        nota = `1ª rodada: ${t.erro || 'pendente'}; `;
        await servico('PATCH', `/rest/v1/operacao_esteira_tarefas?processo_id=eq.${contexto.proc.id}&etapa=eq.historico`, { proximo_em: new Date().toISOString() });
        robo('esteira_processos.js', { LIMITE_MINUTOS_ESTEIRA: '5', LOTE_ANALISE_CNPJ: '0' });
        [t] = await banco(`operacao_esteira_tarefas?processo_id=eq.${contexto.proc.id}&etapa=eq.historico&select=estado,erro,detalhe,tentativas`);
      }
      await p.goto(urlProcesso());
      await p.waitForSelector('#area:not([hidden])', { timeout: 20000 }); await p.waitForTimeout(4000);
      const card = p.locator('#licitacao-anterior');
      const visivel = await card.isVisible();
      const txt = visivel ? (await card.innerText()).replace(/\s+/g, ' ') : '';
      if (visivel) await card.scrollIntoViewIfNeeded();
      exigir(['feito', 'aguardando_leitura'].includes(t?.estado) || t?.estado === 'falhou' && visivel, `tarefa histórico: ${JSON.stringify(t)}`);
      exigir(visivel, `cartão "Licitação anterior" oculto; tarefa ${JSON.stringify({ estado: t?.estado, erro: t?.erro })}`);
      return `${nota}tarefa ${t.estado}; cartão: ${txt.slice(0, 300)}`;
    });

    await passo('licitação anterior avulsa (Inteligência de Mercado)', p, async () => {
      await p.goto(SITE + '/painel.html#diagnostico');
      await p.click('[data-subaba="licitacao-anterior"]');
      const alvo = p.locator('#dg-licitacao-anterior');
      await alvo.locator('[name=orgao]').fill('193028');
      await alvo.getByRole('button', { name: 'Buscar órgão' }).click();
      await p.waitForFunction(() => document.querySelector('#dg-licitacao-anterior [name=uasg]')?.value, null, { timeout: 60000 })
        .catch(async () => { throw new Error('órgão não encontrado: ' + await alvo.innerText()); });
      await alvo.locator('[name=palavras]').fill('álcool');
      await alvo.getByRole('button', { name: 'Consultar licitações anteriores' }).click();
      await p.waitForFunction(() => /Consulta feita agora|Resultado guardado|Não foi|erro|indispon/i.test(document.querySelector('#dg-licitacao-anterior .la-apoio')?.textContent || ''), null, { timeout: 120000 });
      const estado = await alvo.locator('.la-apoio[role=status]').innerText();
      exigir(/Consulta feita agora|Resultado guardado/.test(estado), 'consulta falhou: ' + estado);
      const txt = (await alvo.innerText()).replace(/\s+/g, ' ');
      exigir(!CPF.test(txt), 'CPF na tela da licitação anterior');
      return `${estado} | ${txt.slice(txt.indexOf(estado) + estado.length, txt.indexOf(estado) + estado.length + 300)}`;
    });

    // Vencedor real do histórico gravado pela esteira; com sanção no CEIS/CNEP, se algum tiver.
    const vencedores = await banco('historico_participacoes?fornecedor_ni=not.is.null&valor_homologado=not.is.null&select=fornecedor_ni,fornecedor_nome&limit=500');
    const nis = [...new Set(vencedores.map(v => v.fornecedor_ni))];
    const comSancao = nis.length ? await banco(`sancoes_empresas?cnpj=in.(${nis.slice(0, 300).join(',')})&select=cnpj,cadastro,data_fim,fora_da_lista&limit=1`) : [];
    const vencedor = comSancao[0]?.cnpj || nis[0];

    await passo('análise por CNPJ: vencedor real do histórico (+ fila do robô)', p, async () => {
      exigir(vencedor, 'nenhum vencedor com CNPJ no histórico gravado pela esteira');
      const antes = await analisar(p, vencedor);
      // Fila da análise (aberta pela tela): o robô completa no fim da rodada da esteira.
      const [fila] = await banco(`historico_cnpj_consultas?cnpj=eq.${vencedor}&select=situacao,meses_pendentes`);
      const r = robo('esteira_processos.js', { LIMITE_MINUTOS_ESTEIRA: '6', LOTE_ANALISE_CNPJ: '1', MAX_COMPRAS_ANALISE_CNPJ: '10' });
      const [depois] = await banco(`historico_cnpj_consultas?cnpj=eq.${vencedor}&select=situacao,meses_pendentes,tentativas`);
      const txt = await analisar(p, vencedor);
      const disputas = (txt.match(/Disputas \(itens\) (\d+)/) || [])[1];
      exigir(Number(disputas) > 0, 'nenhuma disputa na análise: ' + txt.slice(0, 400));
      const selo = await p.locator('#emp-analise-cnpj .sancao-selo').count();
      exigir(!comSancao.length || selo, 'vencedor tem sanção no CEIS/CNEP e o selo não apareceu');
      exigir(!CPF.test(txt), 'CPF na análise por CNPJ');
      return `CNPJ ${vencedor} (${comSancao.length ? 'com sanção ' + comSancao[0].cadastro : 'sem sanção'}; selo ${selo ? 'visível' : 'ausente'}); ${disputas} disputa(s); fila ${fila?.situacao}->${depois?.situacao} (meses pendentes ${JSON.stringify(depois?.meses_pendentes || []).slice(0, 60)}); robô saiu ${r.status}${antes.includes('Disputas') ? '' : ' (1ª abertura sem participações)'}`;
    });

    await passo('prospecção: 4 abas (AM) e link no menu', p, async () => {
      const links = {};
      for (const pg of ['/sistema', '/painel.html', '/operacao.html', '/processos.html']) {
        await p.goto(SITE + pg); await p.waitForSelector('#menu-principal', { state: 'attached', timeout: 20000 });
        links[pg] = await p.locator('#menu-principal a[href="prospeccao.html"]').count();
      }
      exigir(Object.values(links).every(n => n === 1), 'link Prospecção faltando no menu: ' + JSON.stringify(links));
      await p.locator('#menu-principal a[href="prospeccao.html"]').click();
      await p.waitForURL(/prospeccao/); await p.waitForSelector('#form-filtros');
      await p.selectOption('#f-uf', 'AM').catch(() => p.fill('#f-uf', 'AM'));
      await p.fill('#f-palavras', ''); // o filtro do boletim (passo 2) restringe demais
      const contagem = {};
      for (const aba of ['pca', 'irp', 'ata', 'contrato']) {
        await p.click(`.aba[data-aba="${aba}"]`);
        await p.waitForFunction(() => !/Carregando/.test(document.getElementById('tabela-corpo').textContent), null, { timeout: 30000 });
        const erro = (await p.innerText('#aviso')).trim();
        exigir(!/erro|indispon|Sessão/i.test(erro), `aba ${aba}: ${erro}`);
        contagem[aba] = (await p.innerText('#contador')).trim() || (await p.innerText('#tabela-corpo')).trim().slice(0, 80);
        await p.screenshot({ path: path.join(PRINTS, `prospeccao-${aba}.png`), fullPage: true });
      }
      const banco4 = {};
      for (const t of ['pca', 'irp', 'ata', 'contrato']) banco4[t] = (await banco(`prospeccao_itens?tipo=eq.${t}&select=tipo&limit=1000`)).length;
      exigir(!CPF.test(await p.innerText('body')), 'CPF na tela de prospecção');
      return `menu: ${JSON.stringify(links)}; banco (até 1000): ${JSON.stringify(banco4)}; tela: ${JSON.stringify(contagem)}`;
    });

    await passo('Hoje: aviso de sanção (sanção fictícia numa empresa do seed)', p, async () => {
      // service_role não tem DELETE em sancoes_empresas (o robô só faz upsert/expurgo por RPC): apaga como postgres.
      limpar.push(async () => psql(`delete from public.sancoes_empresas where cadastro = 'CNEP' and codigo_sancao = '${CODIGO_SANCAO_FICTICIA}'`));
      await servico('POST', '/rest/v1/sancoes_empresas', { cadastro: 'CNEP', codigo_sancao: CODIGO_SANCAO_FICTICIA, cnpj: CNPJ_SANCAO_FICTICIA,
        razao_social: 'MATERIAIS HORIZONTE TESTE LTDA (FICTÍCIA)', tipo_sancao: 'Multa - Lei Anticorrupção (fictícia, teste local)', orgao_sancionador: 'Órgão fictício',
        data_inicio: new Date(Date.now() - 86400000 * 10).toISOString().slice(0, 10), data_fim: new Date(Date.now() + 86400000 * 200).toISOString().slice(0, 10), data_carga: new Date().toISOString().slice(0, 10) });
      await p.goto(SITE + '/sistema');
      await p.waitForSelector('#hoje-sancoes-titulo', { timeout: 30000 }).catch(async () => { throw new Error('sem bloco de sanções no Hoje: ' + (await p.innerText('#hoje')).slice(0, 300)); });
      const bloco = (await p.locator('section.hoje-alerta', { has: p.locator('#hoje-sancoes-titulo') }).innerText()).replace(/\s+/g, ' ');
      exigir(/Materiais Horizonte/.test(bloco) && /CGU/.test(bloco), 'aviso sem empresa/fonte: ' + bloco);
      await p.locator('#hoje-sancoes-titulo').scrollIntoViewIfNeeded();
      return bloco.slice(0, 300);
    });

    // Extensão simulada: o mesmo lerPaginaPregao (fixture sintética do ComprasNet) e o mesmo enviarNaPagina da extensão.
    const leitor = await import('file:///' + path.join(RAIZ, 'extensao-leitura/pregao-leitor.mjs').replace(/\\/g, '/'));
    const ATA = 'http://comprasnet.gov.br/livre/pregao/AtaEletronico.asp?co_no_uasg=158142&numprp=232022&f_tpPregao=E&Seq=1';
    const leitura = JSON.parse(JSON.stringify(vm.runInNewContext(`(${leitor.lerPaginaPregao})(entrada)`, { URL, entrada: { href: ATA,
      html: fs.readFileSync(path.join(RAIZ, 'extensao-leitura/fixtures/comprasnet-ata-sintetica.html'), 'utf8'), captcha: false } })));
    const pregao = { ...leitura }; delete pregao.status; delete pregao.pendentes;
    const recusada = leitura.itens.flatMap(i => i.mensagens).find(m => m.tipo === 'recusa')?.fornecedor;

    await passo('pregão gravado: conta aprovada grava (extensão simulada com a fixture)', p, async () => {
      exigir(leitura.status === 'ok' && recusada, 'fixture não leu: ' + leitura.status);
      await p.goto(SITE + '/sistema'); await p.waitForTimeout(1500);
      const r = await p.evaluate(`(${leitor.enviarNaPagina})(${JSON.stringify(pregao)})`);
      exigir(r.ok && r.status === 200, 'POST recusado: ' + JSON.stringify(r));
      const [pg] = await banco(`pregoes_gravados?id_compra=eq.${leitura.compra}&select=id_compra,origem,leituras_concordantes`);
      const props = await banco(`pregoes_gravados_propostas?id_compra=eq.${leitura.compra}&select=fornecedor_chave,cnpj,nome`);
      exigir(pg && props.length, 'nada gravado no banco');
      const pf = props.filter(x => x.fornecedor_chave.startsWith('pf:'));
      exigir(pf.every(x => x.cnpj === null && x.nome === 'Pessoa física'), 'pessoa física gravada com documento/nome: ' + JSON.stringify(pf));
      exigir(!CPF.test(JSON.stringify(await banco(`pregoes_gravados_mensagens?id_compra=eq.${leitura.compra}&select=texto,motivo`))), 'CPF gravado em mensagem');
      return `HTTP ${r.status}; compra ${leitura.compra}; ${props.length} proposta(s) (${pf.length} PF como "pf:n" sem nome); origem ${pg.origem}, leituras ${pg.leituras_concordantes}; resposta ${JSON.stringify(r).slice(0, 160)}`;
    });

    await passo('pregão gravado: conta NÃO aprovada é recusada', null, async () => {
      const email = 'pendente@teste-licitaplena.example.com', senha = require('node:crypto').randomBytes(15).toString('base64url') + 'a1!';
      const u = await servico('POST', '/auth/v1/admin/users', { email, password: senha, email_confirm: true });
      limpar.push(() => servico('DELETE', `/auth/v1/admin/users/${u.id}`));
      limpar.push(() => servico('DELETE', `/rest/v1/clientes?id=eq.${u.id}`));
      await servico('POST', '/rest/v1/clientes', { id: u.id, nome: 'Conta Pendente Teste', email, status: 'pendente', aceite_termos: true });
      const post = await comoUsuario({ email, senha }, '/rest/v1/', {});
      const r = await fetch(SITE + '/api/pregao-gravado', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + post.token }, body: JSON.stringify(pregao) });
      const g = await fetch(`${SITE}/api/pregao-gravado?compra=${leitura.compra}`, { headers: { authorization: 'Bearer ' + post.token } });
      exigir([401, 403].includes(r.status) && [401, 403].includes(g.status), `pendente: POST ${r.status}, GET ${g.status}`);
      return `POST ${r.status} ${(await r.text()).slice(0, 100)}; GET ${g.status}`;
    });

    await passo('pregão gravado: selo "não verificado" (GET e análise por CNPJ)', p, async () => {
      const t = await comoUsuario(U.gestor, '/rest/v1/', {});
      const g = await fetch(`${SITE}/api/pregao-gravado?compra=${leitura.compra}`, { headers: { authorization: 'Bearer ' + t.token } }).then(r => r.json());
      exigir(g.ok && g.pregao && g.pregao.verificado === false && g.pregao.mensagens.every(m => m.verificado === false), 'GET sem verificado=false: ' + JSON.stringify(g).slice(0, 300));
      const txt = await analisar(p, recusada);
      const selo = p.locator('#emp-analise-cnpj .selo-nao-verificado').first();
      exigir(await selo.count(), 'selo "não verificado" ausente: ' + txt.slice(0, 500));
      await selo.scrollIntoViewIfNeeded();
      return `GET verificado=false (${g.pregao.mensagens.length} mensagens); análise ${recusada}: "${await selo.innerText()}"; ${(txt.match(/Desclassificações \(pregões gravados\) \d+/) || [''])[0]}`;
    });

    const leitorPg = await novaPagina(navegador, U.leitura);
    await passo('segurança: papel leitura nas funções novas', leitorPg, async () => {
      const ins = await comoUsuario(U.leitura, '/rest/v1/operacao_catalogo_produtos', { method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ organizacao_id: ids.orgA, empresa_id: empresa, nome: 'Produto do leitura' }) });
      exigir(ins.status >= 400, `leitura gravou no catálogo: ${ins.status} ${ins.corpo}`);
      const upd = await comoUsuario(U.leitura, `/rest/v1/operacao_catalogo_produtos?id=eq.${contexto.produto.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ custo_unitario: 1 }) });
      exigir(upd.status >= 400 || upd.corpo === '[]', `leitura alterou o catálogo: ${upd.status} ${upd.corpo}`);
      const leit = await comoUsuario(U.leitura, '/rest/v1/pregoes_gravados_leituras?select=*');
      exigir(leit.status >= 400 || leit.corpo === '[]', 'leitura vê quem gravou o pregão: ' + leit.corpo.slice(0, 200));
      await leitorPg.goto(`${SITE}/operacao.html?aba=catalogo`); await leitorPg.waitForTimeout(2500);
      await leitorPg.selectOption('#empresa-atual', empresa).catch(() => {}); await leitorPg.click('.aba[data-aba="catalogo"]'); await leitorPg.waitForTimeout(2500);
      const tela = await leitorPg.innerText('body');
      exigir(!tela.includes('529.982.247') && !CPF.test(tela), 'CPF visível ao leitura');
      const botaoNovo = await leitorPg.locator('#catalogo-produtos [data-acao="novo"]:visible:enabled').count();
      return `INSERT catálogo ${ins.status}; PATCH ${upd.status} ${upd.corpo.slice(0, 20)}; leituras do pregão ${leit.status} ${leit.corpo.slice(0, 20)}; botão "+ Produto" ativo na tela: ${botaoNovo}`;
    });

    const outraPg = await novaPagina(navegador, U.outra_org);
    await passo('segurança: outra organização e CPF nunca aparece', outraPg, async () => {
      const vaz = {};
      for (const [t, f] of [['operacao_catalogo_produtos', `empresa_id=eq.${empresa}`], ['operacao_documentos', `empresa_id=eq.${ids.empA1}`], ['pregoes_gravados_leituras', 'select=*'],
        ['pregoes_gravados_mensagens_leitores', 'select=*']]) {
        const r = await comoUsuario(U.outra_org, `/rest/v1/${t}?${f}`);
        if (r.status < 400 && r.corpo !== '[]') vaz[t] = r.corpo.slice(0, 120);
      }
      const st = await comoUsuario(U.outra_org, `/storage/v1/object/authenticated/operacao-documentos/${ids.orgA}/${ids.empA1}/e2e-certidao.pdf`);
      if (st.status === 200) vaz.storage_pdf = 1;
      await outraPg.goto(`${SITE}/operacao.html?aba=catalogo`); await outraPg.waitForTimeout(3000);
      if ((await outraPg.innerText('body')).includes(termoItem.slice(0, 20))) vaz.tela_catalogo = 1;
      // Hoje da outra org: não pode ver a sanção da empresa da org A.
      await outraPg.goto(SITE + '/sistema'); await outraPg.waitForTimeout(4000);
      if (/Materiais Horizonte/.test(await outraPg.innerText('body'))) vaz.hoje_sancao = 1;
      exigir(!Object.keys(vaz).length, 'VAZAMENTO: ' + JSON.stringify(vaz));
      // CPF: nenhuma tabela nova guarda CPF (PF descartada/mascarada na entrada).
      // Tabela inteira pelo psql (o REST para em 1000 linhas): linha com CPF formatado, ou documento de 11 dígitos.
      const tabelas = ['sancoes_empresas', 'prospeccao_itens', 'historico_compras', 'historico_itens', 'historico_participacoes', 'historico_cnpj_consultas',
        'pregoes_gravados', 'pregoes_gravados_propostas', 'pregoes_gravados_mensagens', 'operacao_catalogo_produtos'];
      const contagem = psqlLinhas(tabelas.map(t => String.raw`select '${t}', count(*), count(*) filter (where row_to_json(x)::text ~ '\m\d{3}\.\d{3}\.\d{3}-\d{2}\M') from public.${t} x`).join(' union all ') + ';')
        .map(l => l.split('|'));
      const comCpf = contagem.filter(([, , c]) => Number(c) > 0);
      exigir(contagem.length === tabelas.length && !comCpf.length, 'CPF formatado em: ' + JSON.stringify(comCpf));
      const onze = psqlLinhas(String.raw`select (select count(*) from public.historico_participacoes where fornecedor_ni ~ '^\d{11}$') + (select count(*) from public.sancoes_empresas where cnpj ~ '^\d{11}$') + (select count(*) from public.pregoes_gravados_propostas where cnpj ~ '^\d{11}$');`);
      exigir(onze[0] === '0', 'documento de 11 dígitos (CPF) gravado: ' + onze[0]);
      return `4 tabelas + Storage + 2 telas: nada da org A; CPF ausente nas tabelas inteiras: ${contagem.map(([t, n]) => `${t} ${n}`).join(', ')}`;
    });
  } finally {
    for (const f of limpar.reverse()) await f().catch(e => console.warn('limpeza:', e.message));
  }
}

module.exports = { passosNovos, pdfMinimo };
