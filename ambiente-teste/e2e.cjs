// Teste ponta a ponta do CRM no ambiente local (subir.cjs + servidor.cjs rodando).
//   node ambiente-teste/e2e.cjs
// Navegador real (Edge, ou Chrome com NAVEGADOR=chrome) via playwright-core; PLAYWRIGHT_CORE aponta a cópia instalada.
// Prints e resultado.json em PRINTS (padrão: C:\Users\harre\Desktop\LICITAPLENA\_historico\teste-ponta-a-ponta).
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const AdmZip = require('adm-zip');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');

const AQUI = __dirname, RAIZ = path.resolve(AQUI, '..');
const SITE = process.env.SITE_TESTE || 'http://127.0.0.1:8788'; // outra porta: PORTA_TESTE no servidor + SITE_TESTE aqui
const PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/teste-ponta-a-ponta';
const seed = JSON.parse(fs.readFileSync(path.join(AQUI, 'seed.local.json'), 'utf8'));
const chaves = JSON.parse(fs.readFileSync(path.join(AQUI, 'chaves.local.json'), 'utf8'));
fs.mkdirSync(PRINTS, { recursive: true });

// REST com service_role LOCAL, só para conferir o que a tela gravou.
async function banco(caminho) {
  const r = await fetch(chaves.API_URL + '/rest/v1/' + caminho, { headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + chaves.SERVICE_ROLE_KEY } });
  if (!r.ok) throw new Error(`banco ${caminho}: ${r.status} ${await r.text()}`);
  return r.json();
}
// REST como o usuário (anon + JWT do login), para provar o que o RLS deixa ver.
async function comoUsuario(u, caminho, op = {}) {
  const t = await fetch(chaves.API_URL + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: chaves.ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: u.email, password: u.senha }) }).then(r => r.json());
  const r = await fetch(chaves.API_URL + caminho, { ...op, headers: { apikey: chaves.ANON_KEY, Authorization: 'Bearer ' + t.access_token, 'content-type': 'application/json', ...(op.headers || {}) } });
  return { status: r.status, corpo: await r.text(), token: t.access_token };
}
function robo(script, env = {}) {
  const r = spawnSync(process.execPath, ['-r', path.join(AQUI, 'redirecionar-fetch.cjs'), path.join(RAIZ, 'scripts', script)],
    { cwd: RAIZ, encoding: 'utf8', env: { ...process.env, AMBIENTE_TESTE_REDIRECIONAR: '1', ...env }, timeout: 600000 });
  return { status: r.status, saida: (r.stdout + r.stderr).slice(-3000) };
}

const resultados = [];
let n = 0;
async function passo(nome, pagina, fn) {
  n += 1;
  const id = String(n).padStart(2, '0');
  const r = { n: id, nome, ok: false, notas: [] };
  try { const nota = await fn(); if (nota) r.notas.push(String(nota)); r.ok = true; } catch (e) { r.notas.push('ERRO: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); }
  if (pagina) { r.print = `${id}-${nome.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 50)}.png`; await pagina.screenshot({ path: path.join(PRINTS, r.print), fullPage: true }).catch(() => { r.print = null; }); }
  resultados.push(r);
  console.log(`${r.ok ? '✔' : '✘'} ${id} ${nome} ${r.notas.join(' ; ')}`);
  return r.ok;
}
function exigir(cond, msg) { if (!cond) throw new Error(msg); }

async function novaPagina(navegador, quem) {
  const contexto = await navegador.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true, locale: 'pt-BR' });
  const p = await contexto.newPage();
  p.erros = [];
  p.on('pageerror', e => p.erros.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') p.erros.push('console: ' + m.text().slice(0, 200)); });
  p.on('response', r => { if (r.status() >= 400) p.erros.push(`${r.status()} ${r.request().method()} ${r.url().replace(SITE, '').slice(0, 160)}`); });
  if (quem) await entrar(p, quem);
  return p;
}
async function entrar(p, u) {
  await p.goto(SITE + '/login.html');
  await p.fill('#email', u.email); await p.fill('#senha', u.senha);
  await Promise.all([p.waitForURL(/painel\.html|sistema/, { timeout: 20000 }), p.click('#btn-entrar')]);
}

module.exports = { banco, comoUsuario, robo, passo, exigir, novaPagina, entrar, seed, chaves, SITE, PRINTS, AdmZip, resultados };

async function escolherEdital(editais) {
  const pulados = [];
  // EDITAL_TESTE força um edital do seed (ex.: o da Licitanet, com numeroItem acima de 1.000.000).
  for (const e of process.env.EDITAL_TESTE ? [process.env.EDITAL_TESTE] : editais.slice(1)) {
    const [cnpj, , resto] = e.split('-'); const [seq, ano] = resto.split('/');
    const base = `https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${Number(seq)}`;
    try {
      const itens = await fetch(base + '/itens?pagina=1&tamanhoPagina=50').then(r => r.json());
      const arqs = await fetch(base + '/arquivos').then(r => r.json());
      if (!Array.isArray(itens) || !itens.length || itens.some(i => !(i.numeroItem >= 1 && i.numeroItem <= 2147483647))) { pulados.push(`${e}: numeroItem fora de 1..2147483647`); continue; }
      if (!arqs.some(a => /\.pdf$/i.test(a.titulo || ''))) { pulados.push(`${e}: sem PDF no PNCP`); continue; }
      return { edital: e, pulados };
    } catch (err) { pulados.push(`${e}: ${err.message}`); }
  }
  throw new Error('nenhum edital utilizável: ' + pulados.join('; '));
}

async function main() {
  const navegador = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: process.env.VER !== '1' });
  const { usuarios: U, editais, ids } = seed;
  // Os 15 editais vêm do PNCP ao vivo e mudam a cada seed. Usa o primeiro (fora o [0], que o seed já pôs no Funil)
  // com PDF no PNCP (o dossiê simulado lê o texto) e numeroItem que o gravar_importacao_pncp aceita (1..2147483647).
  const { edital, pulados } = await escolherEdital(editais);
  if (pulados.length) console.log('editais pulados: ' + pulados.join('; '));
  const p = await novaPagina(navegador);
  const contexto = {};

  await passo('login do gestor', p, async () => { await entrar(p, U.gestor); return p.url(); });

  await passo('painel: boletim com editais reais do PNCP', p, async () => {
    await p.goto(SITE + '/painel.html#boletim');
    await p.waitForSelector('#bol-uf', { state: 'attached' });
    if (!(await p.isVisible('#bol-palavras'))) await p.click('#bol-config-toggle');
    await p.selectOption('#bol-uf', ['AM']);
    const objeto = (await banco(`oportunidades_abertas?numero_controle_pncp=eq.${encodeURIComponent(edital)}&select=objeto`))[0].objeto;
    contexto.palavra = (objeto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z]{7,}/g) || ['aquisicao']).find(w => !/registro|eventual|aquisicao|contratacao|empresa|atender|necessidades|prestacao|servicos|especializada/.test(w)) || 'aquisicao';
    await p.fill('#bol-palavras', contexto.palavra);
    await p.click('#bol-salvar');
    await p.waitForSelector(`#bol-resultado [data-id="${edital}"]`, { timeout: 30000 });
    const faltando = p.erros.filter(e => /dashboard_|dados_robo|lembretes/.test(e));
    exigir(!faltando.length, 'objetos do painel faltando (B8): ' + faltando.join(' | '));
    return `palavra-chave "${contexto.palavra}", ${await p.locator('#bol-resultado [data-id]').count()} edital(is) na lista; RPCs do dashboard sem 404`;
  });

  await passo('marcar "Tenho interesse" no edital', p, async () => {
    const card = p.locator(`#bol-resultado [data-id="${edital}"]`).first();
    await card.locator('.btn-acompanhar').click();
    await card.locator('.select-status-licitacao').selectOption('interesse');
    let proc;
    for (let i = 0; i < 20 && !proc; i++) { await p.waitForTimeout(500); [proc] = await banco(`operacao_processos?origem_externa_id=eq.${encodeURIComponent(edital)}&select=id,status,empresa_id,etapa_id`); }
    exigir(proc, 'processo não foi criado no banco');
    contexto.proc = proc;
    return `processo ${proc.id} status=${proc.status}`;
  });

  await passo('processo aparece no Funil', p, async () => {
    await p.goto(SITE + '/painel.html#kanban');
    await p.waitForTimeout(4000);
    const txt = await p.innerText('body');
    const [op] = await banco(`oportunidades_abertas?numero_controle_pncp=eq.${encodeURIComponent(edital)}&select=objeto`);
    exigir(txt.includes(op.objeto.slice(0, 40).trim()), 'cartão do edital não encontrado no Funil');
  });

  await passo('esteira: tarefas criadas pelo gatilho', null, async () => {
    const t = await banco(`operacao_esteira_tarefas?processo_id=eq.${contexto.proc.id}&select=etapa,estado`);
    exigir(t.length === 4, `esperava 4 tarefas, veio ${JSON.stringify(t)}`);
    const fila = await banco(`fila_dossies?numero_controle_pncp=eq.${encodeURIComponent(edital)}&select=origem`);
    return `tarefas ${t.map(x => x.etapa + ':' + x.estado).join(', ')}; fila_dossies=${fila[0]?.origem}`;
  });

  await passo('esteira: robô importa os itens do PNCP', null, async () => {
    const r = robo('esteira_processos.js', { LIMITE_MINUTOS_ESTEIRA: '5', PAUSA_ITEM_MS_ESTEIRA: '300' });
    const t = await banco(`operacao_esteira_tarefas?processo_id=eq.${contexto.proc.id}&etapa=eq.itens&select=estado,erro,detalhe`);
    exigir(t[0]?.estado === 'feito', `tarefa itens: ${JSON.stringify(t[0])} | ${r.saida.slice(-500)}`);
    const itens = await banco(`operacao_itens_resultado?processo_id=eq.${contexto.proc.id}&select=id`);
    exigir(itens.length > 0, 'nenhum item importado');
    return `${itens.length} item(ns); detalhe ${JSON.stringify(t[0].detalhe)}`;
  });

  await passo('dossiê simulado: texto real do edital no PNCP, sem IA', null, async () => {
    const [cnpj, , resto] = edital.split('-'); const [seq, ano] = resto.split('/');
    const arqs = await fetch(`https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${Number(seq)}/arquivos`).then(r => r.json());
    const edt = a => /edital/i.test(`${a.titulo} ${a.tipoDocumentoNome}`) ? 0 : 1;
    const pdfs = arqs.filter(a => /\.pdf$/i.test(a.titulo || '') || /edital/i.test(a.tipoDocumentoNome || '')).sort((a, b) => edt(a) - edt(b)).slice(0, 2);
    const pdfParse = require(path.join(RAIZ, 'node_modules/pdf-parse/lib/pdf-parse.js'));
    let texto = '';
    for (const a of pdfs) {
      const buf = Buffer.from(await fetch(a.url).then(r => r.arrayBuffer()));
      if (buf.subarray(0, 4).toString() !== '%PDF') continue;
      texto += `--- ${a.titulo} ---\n${(await pdfParse(buf)).text}\n`;
    }
    exigir(texto.length > 1000, `sem texto de edital (arquivos: ${arqs.map(a => a.titulo).join(', ')})`);
    const r = await fetch(chaves.API_URL + '/rest/v1/dossies_editais', { method: 'POST', headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + chaves.SERVICE_ROLE_KEY, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ numero_controle_pncp: edital, versao: 17, status: 'parcial', fonte_lida: true, gerado_em: new Date().toISOString(), dossie: { textoEdital: texto } }) });
    exigir(r.ok, 'gravar dossiê: ' + r.status + ' ' + await r.text());
    return `${pdfs.map(a => a.titulo).join(', ')}: ${texto.length} caracteres`;
  });

  await passo('esteira: robô monta as exigências', null, async () => {
    // A tarefa espera 30 min pelo dossiê (ESPERA_DOSSIE_MINUTOS_ESTEIRA); aqui a espera é antecipada.
    await fetch(`${chaves.API_URL}/rest/v1/operacao_esteira_tarefas?processo_id=eq.${contexto.proc.id}&estado=eq.pendente`, { method: 'PATCH',
      headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + chaves.SERVICE_ROLE_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ proximo_em: new Date().toISOString() }) });
    const r = robo('esteira_processos.js', { LIMITE_MINUTOS_ESTEIRA: '5' });
    const t = await banco(`operacao_esteira_tarefas?processo_id=eq.${contexto.proc.id}&select=etapa,estado,erro,detalhe`);
    const ex = t.find(x => x.etapa === 'exigencias');
    const linhas = await banco(`operacao_exigencias_processo?processo_id=eq.${contexto.proc.id}&select=categoria,incomum`);
    // O dossiê simulado não traz estrutura.coberturaLeitura: o robô grava as exigências e fica em 'aguardando_leitura' (comportamento correto).
    exigir(['feito', 'aguardando_leitura'].includes(ex?.estado) && linhas.length > 0, `exigencias: ${JSON.stringify(ex)} | ${r.saida.slice(-400)}`);
    return `${linhas.length} exigência(s) gravadas (${linhas.filter(l => l.incomum).length} marcadas "fora do comum"); ${t.map(x => x.etapa + ':' + x.estado).join(', ')}; ${ex.detalhe?.mensagem || ''}`;
  });

  const urlProcesso = () => `${SITE}/sistema?empresa=${contexto.proc.empresa_id}&processo=${contexto.proc.id}`;
  await passo('sistema: abrir o processo (checklist e itens)', p, async () => {
    await p.goto(urlProcesso());
    await p.waitForSelector('#area:not([hidden])', { timeout: 20000 });
    await p.waitForSelector('#itens-processo [data-item-lista] li', { timeout: 20000 });
    await p.waitForTimeout(1500);
    fs.writeFileSync(path.join(PRINTS, 'dom-processo.txt'), await p.innerText('main'));
    const ck = await p.innerText('#checklist-esteira');
    exigir(/Pronto: \d+ itens/.test(ck), 'checklist sem "Pronto: N itens": ' + ck.slice(0, 300));
    const ordem = await p.locator('#itens-processo [data-item-lista] li .itens-cabeca strong').allInnerTexts();
    const ordenada = [...ordem].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
    exigir(ordem.join('|') === ordenada.join('|'), 'itens fora de ordem (B4): ' + ordem.join(', '));
    // Mais de 100 itens: a 1ª página tem de começar no menor número do processo (paginação por numero_ordem).
    const menor = (await banco(`operacao_itens_resultado?processo_id=eq.${contexto.proc.id}&numero_ordem=not.is.null&select=numero_ordem&order=numero_ordem.asc&limit=1`))[0]?.numero_ordem;
    const total = (await banco(`operacao_itens_resultado?processo_id=eq.${contexto.proc.id}&select=id`)).length;
    exigir(menor !== undefined && (ordem[0].match(/\d+/) || [])[0] === String(menor), `lista começa em "${ordem[0]}", menor número é ${menor}`);
    return `${total} itens no processo; lista começa em ${ordem[0]} (menor número ${menor}); ${ordem.length} na 1ª página: ${ordem.slice(0, 12).join(', ')}…; ` + ck.replace(/\s+/g, ' ').slice(0, 200);
  });

  await passo('identificação da empresa (endereço, representante, cargo)', p, async () => {
    await p.fill('#empresa-identificacao-endereco', 'Rua Fictícia de Teste, 100 — Manaus/AM');
    await p.fill('#empresa-identificacao-representante', 'Pessoa Representante Fictícia');
    await p.fill('#empresa-identificacao-cargo', 'Sócia administradora');
    await p.check('#empresa-identificacao-revisao');
    await p.getByRole('button', { name: 'Salvar identificação confirmada' }).click();
    await p.waitForTimeout(2500);
    const id = await banco(`operacao_identificacao_empresa?empresa_id=eq.${contexto.proc.empresa_id}&select=versao,dados_confirmados`);
    exigir(id.length === 1, 'identificação não gravada: ' + (await p.innerText('#identificacao')).slice(0, 300));
    return `versão ${id[0].versao}`;
  });

  await passo('perfil da empresa com logo (operacao.html)', p, async () => {
    await p.goto(`${SITE}/operacao.html?aba=identificacao`);
    await p.waitForSelector('#perfil-salvar', { timeout: 20000 });
    await p.selectOption('#empresa-atual', contexto.proc.empresa_id);
    await p.waitForTimeout(2500);
    await p.waitForSelector('#perfil-salvar');
    const campos = { 'perfil-nome_fantasia': 'Horizonte Teste', 'perfil-telefone': '(92) 3333-0000', 'perfil-email': 'contato@teste-licitaplena.example.com',
      'perfil-cpf_representante': '529.982.247-25', 'perfil-aliquota_efetiva': '6,5', 'perfil-banco-banco': 'Banco Fictício', 'perfil-banco-agencia': '0001',
      'perfil-banco-conta': '12345-6', 'perfil-proposta_padrao-validade': '60 dias', 'perfil-proposta_padrao-pagamento': '30 dias após o aceite', 'perfil-proposta_padrao-prazo_entrega': '10 dias' };
    for (const [k, v] of Object.entries(campos)) await p.fill('#' + k, v);
    await p.selectOption('#perfil-uf_sede', 'AM'); await p.selectOption('#perfil-porte', 'me'); await p.selectOption('#perfil-regime_tributario', 'simples');
    await p.setInputFiles('#perfil-logo', path.join(RAIZ, 'logo-assinatura-azul.png'));
    await p.waitForTimeout(3000);
    const avisoLogo = await p.innerText('#perfil-logo-aviso');
    await p.click('#perfil-salvar');
    await p.waitForTimeout(3000);
    const aviso = await p.innerText('#perfil-aviso');
    const [perfil] = await banco(`operacao_perfil_empresa?empresa_id=eq.${contexto.proc.empresa_id}&select=*`);
    exigir(perfil, `perfil não gravado; aviso "${aviso}"; logo "${avisoLogo}"`);
    exigir(perfil.cpf_representante === '52998224725', 'CPF não gravado');
    const logo = perfil.logo_caminho || perfil.logo?.caminho || JSON.stringify(perfil).match(/[0-9a-f-]{36}\/[^"]+\.(png|jpe?g)/)?.[0];
    exigir(logo, `logo não registrado; aviso logo "${avisoLogo}"`);
    contexto.perfil = perfil;
    return `aviso: "${aviso}"; logo: "${avisoLogo}" (${logo})`;
  });

  await passo('preço por item: premissas, custo, alvo/limite, simulador e preço mínimo', p, async () => {
    await p.goto(urlProcesso());
    await p.waitForSelector('#itens-processo [data-item-lista] li', { timeout: 20000 });
    for (const [id, v] of [['tributos', '8'], ['margem', '20'], ['margemMinima', '8'], ['garantia', '1']]) { await p.fill('#itens-premissa-' + id, v); await p.press('#itens-premissa-' + id, 'Tab'); await p.waitForTimeout(700); }
    const custo = p.locator('input[id^="itens-custo-"]').first();
    const itemId = (await custo.getAttribute('id')).replace('itens-custo-', '');
    await custo.fill('30'); await custo.press('Tab'); await p.waitForTimeout(1500);
    const li = p.locator('#itens-processo [data-item-lista] li', { has: p.locator('#itens-custo-' + itemId) });
    const precos = (await li.locator('.itens-precos').innerText()).replace(/\s+/g, ' ');
    exigir(/Preço-alvo R\$ ?\d/.test(precos), 'preço-alvo não calculado: ' + precos);
    await p.fill('#itens-lance-' + itemId, '33,50'); await p.waitForTimeout(800);
    const sim = (await p.innerText('#itens-simulacao-' + itemId).catch(() => li.locator('.itens-simulacao').innerText())).replace(/\s+/g, ' ');
    await li.getByRole('button', { name: 'Usar limite como preço mínimo' }).click(); await p.waitForTimeout(1500);
    const [it] = await banco(`operacao_itens_resultado?id=eq.${itemId}&select=custo_unitario,valor_unitario_minimo`);
    exigir(it && Number(it.custo_unitario) === 30 && it.valor_unitario_minimo, 'custo/mínimo não gravados: ' + JSON.stringify(it));
    contexto.itemId = itemId;
    return `${precos} | simulação: ${sim.slice(0, 120)} | banco: ${JSON.stringify(it)}`;
  });

  await passo('item: valor ofertado, marca e modelo (Editar)', p, async () => {
    const li = p.locator('#itens-processo [data-item-lista] li', { has: p.locator('#itens-custo-' + contexto.itemId) });
    await li.getByRole('button', { name: /^Editar/ }).click();
    const form = p.locator('#itens-processo form').first();
    await form.locator('[name=marca]').fill('Marca Fictícia'); await form.locator('[name=modelo]').fill('Modelo X');
    await form.locator('[name=valorUnitario]').fill('35.90');
    await form.getByRole('button', { name: /Salvar item/ }).click(); await p.waitForTimeout(2000);
    const [it] = await banco(`operacao_itens_resultado?id=eq.${contexto.itemId}&select=marca,modelo,valor_unitario_proposta,quantidade`);
    exigir(it?.marca === 'Marca Fictícia' && Number(it.valor_unitario_proposta) === 35.9, 'item não atualizado: ' + JSON.stringify(it) + ' ' + (await p.innerText('#itens-processo')).slice(0, 300));
    return JSON.stringify(it);
  });

  const baixarDocx = async (rotulo) => {
    const kit = p.locator('#kit');
    await kit.getByRole('button', { name: 'Salvar rascunho' }).click(); await p.waitForTimeout(2000);
    await kit.getByRole('button', { name: 'Preparar prévia' }).click(); await p.waitForTimeout(2500);
    const conferi = kit.getByLabel(/Conferi os dados e o conteúdo/);
    if (!(await conferi.isVisible())) throw new Error('prévia não abriu: ' + (await kit.innerText()).replace(/\s+/g, ' ').slice(0, 700));
    await conferi.check();
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), kit.getByRole('button', { name: 'Baixar DOCX' }).click()]);
    const destino = path.join(PRINTS, `${rotulo}.docx`); await dl.saveAs(destino);
    const zip = new AdmZip(destino);
    const xml = zip.readAsText('word/document.xml').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    return { destino, xml, entradas: zip.getEntries().map(e => e.entryName) };
  };

  await passo('declaração: gerar, revisar e exportar DOCX (zip conferido)', p, async () => {
    await p.goto(urlProcesso()); await p.waitForSelector('#kit form', { timeout: 20000 });
    const kit = p.locator('#kit');
    await kit.getByRole('button', { name: 'Nova declaração' }).click();
    await kit.locator('[name=tipo]').selectOption({ label: 'Declaração com texto informado' }).catch(() => {});
    await kit.locator('[name=titulo]').fill('Declaração de inexistência de fato impeditivo (teste)');
    await kit.locator('[name=texto]').fill('A empresa {{razao_social}}, CNPJ {{cnpj}}, com sede em {{endereco}}, por seu representante {{representante}} ({{cargo}}), CPF [CPF do representante], declara para o edital {{numero_edital}} do órgão {{orgao}} que não há fato impeditivo.');
    await kit.locator('[name=fonte]').fill('Modelo de teste do ambiente local');
    const d = await baixarDocx('declaracao');
    for (const t of ['Materiais Horizonte Teste LTDA', 'Rua Fictícia de Teste', 'Pessoa Representante Fictícia', '529.982.247-25'])
      exigir(d.xml.includes(t), `DOCX sem "${t}": ${d.xml.slice(0, 400)}`);
    exigir(d.xml.includes('12.345.678/0001-95') && !d.xml.includes('12345678000195'), 'DOCX com CNPJ sem máscara (B1): ' + d.xml.slice(0, 400));
    return `${path.basename(d.destino)}: ${d.entradas.length} partes; contém razão social, CNPJ 12.345.678/0001-95 (com máscara), endereço, representante e CPF`;
  });

  await passo('proposta: exportar DOCX com itens e valores', p, async () => {
    await p.goto(urlProcesso()); await p.waitForSelector('#kit form', { timeout: 20000 });
    const kit = p.locator('#kit');
    await kit.getByRole('button', { name: 'Nova proposta' }).click(); await p.waitForTimeout(1000);
    const caixa = kit.locator('[data-item]:not(:disabled)').first();
    await caixa.check();
    const form = kit.locator('form').first();
    // B2: validade, prazo e pagamento vêm da "Proposta padrão" do perfil; a unidade vem do PNCP. Nada é digitado aqui.
    const padrao = { validade: '60 dias', prazoEntrega: '10 dias', pagamento: '30 dias após o aceite' };
    for (const [n, v] of Object.entries(padrao)) { const atual = await form.locator(`[name=${n}]`).inputValue(); exigir(atual === v, `${n} não veio do perfil (B2): "${atual}"`); }
    const itemProposta = await caixa.getAttribute('value');
    const [{ unidade: unidadePncp }] = await banco(`operacao_itens_resultado?id=eq.${itemProposta}&select=unidade`);
    const unidade = await form.locator(`[name="unidade-${itemProposta}"]`).inputValue();
    exigir(unidadePncp && unidade === unidadePncp, `unidade não veio do PNCP (B2): tela "${unidade}", banco "${unidadePncp}"`);
    const textoKit = await kit.innerText();
    exigir(!/\d,000\b/.test(textoKit), 'quantidade com 3 casas no formulário (B5)');
    exigir(!/Conferir itens observados|Nao autoriza|Conferir página com extensão/.test(textoKit), 'bloco técnico da extensão visível (B6)');
    const d = await baixarDocx('proposta');
    exigir(/35,90/.test(d.xml) && /Marca Fictícia/.test(d.xml), 'DOCX da proposta sem valor 35,90/marca: ' + d.xml.slice(0, 500));
    exigir(d.xml.includes('Validade: 60 dias') && d.xml.includes('30 dias após o aceite') && d.xml.includes(unidadePncp), 'DOCX sem condições do perfil/unidade: ' + d.xml.slice(-500));
    return `${path.basename(d.destino)} com item, marca, R$ 35,90, unidade "${unidadePncp}" do PNCP e validade/prazo/pagamento do perfil, sem digitar; sem bloco da extensão; quantidade sem ",000"`;
  });

  await passo('checklist: gerar declarações exigidas pelo edital', p, async () => {
    await p.goto(urlProcesso()); await p.waitForSelector('#checklist-esteira:not([hidden])', { timeout: 20000 }); await p.waitForTimeout(1500);
    const ck = p.locator('#checklist-esteira');
    const txt = (await ck.innerText()).replace(/\s+/g, ' ');
    const botao = ck.getByRole('button', { name: 'Gerar declarações' });
    if (!(await botao.count())) return `sem botão "Gerar declarações" (edital sem declaração reconhecida): ${txt.slice(0, 300)}`;
    await botao.click(); await p.waitForTimeout(3000);
    const kits = await banco(`operacao_kit_documentos?processo_id=eq.${contexto.proc.id}&select=tipo,modelo_codigo`);
    exigir(kits.some(k => k.modelo_codigo), 'nenhuma declaração por modelo gravada: ' + (await ck.innerText()).slice(0, 300));
    const livres = await banco(`operacao_kit_documentos?processo_id=eq.${contexto.proc.id}&modelo_codigo=in.(livre,edital)&select=dados`);
    const titulos = livres.map(k => k.dados.declaracao.titulo);
    exigir(titulos.every(t => t.length <= 91 && /^Declaração/.test(t)), 'título cru de cláusula (B3): ' + titulos.join(' | '));
    exigir(!titulos.some(t => /reconsidera|san[cç][aã]o/i.test(t)), 'cláusula de sanção virou declaração (B3)');
    return `${kits.filter(k => k.modelo_codigo).length} declaração(ões) por modelo: ${kits.map(k => k.modelo_codigo).filter(Boolean).join(', ')}; títulos livres: ${titulos.join(' | ') || 'nenhum'}`;
  });

  await passo('portal do cliente: gerar link', p, async () => {
    await p.goto(urlProcesso()); await p.waitForSelector('[data-portal-abrir]', { timeout: 20000 });
    await p.click('[data-portal-abrir]');
    await p.fill('#portal-contato', 'Compras do Cliente Fictício');
    await p.click('[data-portal-gerar]');
    await p.waitForSelector('[data-portal-novo]:not([hidden])', { timeout: 15000 });
    contexto.link = await p.inputValue('#portal-link');
    exigir(contexto.link.startsWith(SITE + '/cliente#t='), 'link não aponta para o site local (B9): ' + contexto.link.replace(/#t=.*/, ''));
    return contexto.link.replace(/#t=.*/, '#t=…');
  });

  const cli = await novaPagina(navegador);
  await passo('cliente abre o link (sem login) e aprova um item', cli, async () => {
    await cli.goto(contexto.link); // B9: o link já sai com a origem local (PORTAL_ORIGEM_LINK)
    // Só o primeiro item (rádio "Aprovar"); o botão "Aprovar todos os pendentes" fica de fora.
    await cli.locator('label.cl-seg-aprovado').first().click({ timeout: 20000 });
    await cli.click('#enviar');
    await cli.waitForTimeout(2500);
    const t = (await cli.innerText('body')).replace(/\s+/g, ' ');
    exigir(/Resposta enviada|Respondido|Aprovado/.test(t), 'sem confirmação: ' + t.slice(0, 300));
    return t.match(/(Resposta enviada|Respondido[^.]*)/)?.[0] || 'aprovado';
  });

  await passo('histórico: resposta do cliente aparece no sistema', p, async () => {
    await p.goto(urlProcesso()); await p.waitForSelector('#portal-cliente [data-portal-resumo]', { timeout: 20000 }); await p.waitForTimeout(2500);
    const t = (await p.innerText('#portal-cliente')).replace(/\s+/g, ' ');
    exigir(/1 aprovado/.test(t), 'resumo sem 1 aprovado: ' + t.slice(0, 300));
    exigir(/Histórico \([1-9]/.test(t), 'histórico vazio: ' + t.slice(0, 300));
    return t.match(/\d+ aprovados?[^·]*·[^·]*·[^H]*/)?.[0] + ' | ' + t.match(/Histórico \(\d+\)/)?.[0];
  });

  const leitor = await novaPagina(navegador, U.leitura);
  await passo('papel leitura: não vê CPF nem dados bancários', leitor, async () => {
    await leitor.goto(`${SITE}/operacao.html?aba=identificacao`); await leitor.waitForTimeout(3000);
    await leitor.selectOption('#empresa-atual', contexto.proc.empresa_id).catch(() => {}); await leitor.waitForTimeout(2500);
    const tela = await leitor.innerText('body');
    exigir(!tela.includes('529.982.247') && !tela.includes('52998224725') && !tela.includes('12345-6'), 'CPF/conta visível na tela do leitura');
    const rest = await comoUsuario(U.leitura, `/rest/v1/operacao_perfil_empresa?empresa_id=eq.${contexto.proc.empresa_id}&select=cpf_representante,banco`);
    exigir(!rest.corpo.includes('52998224725'), 'REST devolveu CPF ao leitura: ' + rest.corpo);
    const api = await fetch(SITE + '/api/empresa-identificacao', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + rest.token }, body: JSON.stringify({ acao: 'lerPerfil', empresaId: contexto.proc.empresa_id }) });
    const corpoApi = await api.text();
    exigir(!corpoApi.includes('52998224725'), 'API devolveu CPF ao leitura');
    return `tela: "${(tela.match(/Seu acesso é só de leitura[^.]*\./) || ['(sem aviso)'])[0]}"; REST ${rest.status} ${rest.corpo.slice(0, 60)}; API ${api.status}`;
  });

  const outra = await novaPagina(navegador, U.outra_org);
  await passo('outra organização não vê nada da organização A', outra, async () => {
    const checar = async (tabela, filtro) => { const r = await comoUsuario(U.outra_org, `/rest/v1/${tabela}?${filtro}&select=*`); return JSON.parse(r.corpo || '[]').length; };
    const vazamentos = {};
    for (const [t, f] of [['operacao_processos', `organizacao_id=eq.${ids.orgA}`], ['operacao_empresas', `organizacao_id=eq.${ids.orgA}`], ['operacao_documentos', `organizacao_id=eq.${ids.orgA}`],
      ['operacao_itens_resultado', `processo_id=eq.${contexto.proc.id}`], ['operacao_perfil_empresa', `empresa_id=eq.${contexto.proc.empresa_id}`], ['operacao_kit_documentos', `processo_id=eq.${contexto.proc.id}`],
      ['operacao_identificacao_empresa', `empresa_id=eq.${contexto.proc.empresa_id}`], ['operacao_esteira_tarefas', `processo_id=eq.${contexto.proc.id}`], ['operacao_exigencias_processo', `processo_id=eq.${contexto.proc.id}`]]) {
      const n2 = await checar(t, f); if (n2) vazamentos[t] = n2;
    }
    const st = await comoUsuario(U.outra_org, `/storage/v1/object/authenticated/operacao-documentos/${contexto.perfil.logo_caminho}`);
    if (st.status === 200) vazamentos.storage_logo = 1;
    await outra.goto(urlProcesso()); await outra.waitForTimeout(5000);
    const tela = await outra.innerText('body');
    if (/Materiais Horizonte|Papelaria Aurora|Rua Fictícia/.test(tela)) vazamentos.tela_sistema = 1;
    await outra.goto(SITE + '/painel.html#kanban'); await outra.waitForTimeout(4000);
    if (/Materiais Horizonte|Papelaria Aurora/.test(await outra.innerText('body'))) vazamentos.tela_funil = 1;
    exigir(!Object.keys(vazamentos).length, 'VAZAMENTO: ' + JSON.stringify(vazamentos));
    return `9 tabelas + Storage + telas: nada da org A (logo no Storage: HTTP ${st.status})`;
  });

  fs.writeFileSync(path.join(PRINTS, 'resultado.json'), JSON.stringify({ quando: new Date().toISOString(), resultados, errosPagina: p.erros }, null, 2));
  await navegador.close();
}
if (require.main === module) main().catch(e => { console.error('E2E FALHOU:', e); process.exit(1); });
