// Modo "Gravar pregão no LicitaPlena": lê o que a página pública do pregão JÁ carregou na aba do próprio
// usuário (Compras.gov "Acompanhar Contratação" ou ata completa do ComprasNet antigo depois do captcha de
// imagem). Não faz chamada de rede, não lê nem reaproveita token de captcha e não resolve desafio: com um
// hCaptcha visível devolve captcha_pendente e o usuário resolve na página. As funções exportadas são
// autocontidas porque chrome.scripting.executeScript serializa só o corpo da função injetada.
// CPF nunca sai daqui: participante pessoa física vira "pf:<n>" sem nome, e CPF em texto livre é mascarado.

export function lerPaginaPregao(entrada) {
  const VAZIOS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ordm: 'º', ordf: 'ª', deg: '°' };
  const decodificar = s => s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]+);/gi, (m, c) => {
    if (c[0] !== '#') return ENT[c.toLowerCase()] ?? m;
    const n = c[1].toLowerCase() === 'x' ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10);
    return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
  });
  const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const semCpf = s => s.replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{11}\b/g, '***.***.***-**');
  const curto = (s, n) => { const t = semCpf(String(s ?? '').replace(/\s+/g, ' ').trim()).slice(0, n); return t && t !== '-' ? t : null; };
  const num = s => {
    const m = /-?\d[\d.]*(,\d+)?/.exec(String(s || ''));
    const n = m ? Number(m[0].replace(/\./g, '').replace(',', '.')) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const dinheiro = s => [...String(s || '').matchAll(/R\$\s*([\d.]+(?:,\d+)?)/g)].map(m => num(m[1]));
  const dataHora = s => {
    const m = /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ''));
    return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] || '00'}` : null;
  };
  const tipoMensagem = t => {
    const s = semAcento(t);
    if (/recusad|\brecusa\b|recusou/.test(s)) return 'recusa';
    if (/desclassifica/.test(s)) return 'desclassificacao';
    if (/inabilita/.test(s)) return 'inabilitacao';
    if (/convoca/.test(s)) return 'convocacao';
    if (/habilita/.test(s)) return 'habilitacao';
    if (/adjudica/.test(s)) return 'adjudicacao';
    if (/aceit/.test(s)) return 'aceite';
    return 'outro';
  };
  const motivo = t => curto(/(?:motivo|justificativa)\s*:\s*([\s\S]+)/i.exec(t)?.[1], 2000);
  // Participante: CNPJ fica; CPF (ou CPF mascarado pelo portal) vira chave posicional sem nome.
  const fornecedor = (doc, nome, pfs) => {
    const d = String(doc || '').replace(/\D/g, '');
    if (d.length === 14) return { chave: d, cnpj: d, nome: curto(nome, 300) };
    const k = d || String(doc);
    if (!pfs.has(k)) pfs.set(k, `pf:${pfs.size + 1}`);
    return { chave: pfs.get(k), cnpj: null, nome: 'Pessoa física' };
  };

  const href = entrada ? entrada.href : location.href;
  let url;
  try { url = new URL(href); } catch { return { status: 'pagina_nao_suportada' }; }
  const novo = url.protocol === 'https:' && url.hostname === 'cnetmobile.estaleiro.serpro.gov.br' && !url.username
    && /^\/comprasnet-web\/public\/compras\/acompanhamento-compra(\/item\/\d{1,5})?$/.test(url.pathname);
  const antigo = /^https?:$/.test(url.protocol) && /^(www\.)?comprasnet\.gov\.br$/.test(url.hostname) && !url.username
    && /^\/livre\/pregao\/ataeletronico\.asp$/i.test(url.pathname);
  if (!novo && !antigo) return { status: 'pagina_nao_suportada' };
  const captchaVisivel = () => [...document.querySelectorAll('iframe')].some(f => {
    if (!/hcaptcha\.com|recaptcha/.test(f.src || '')) return false;
    const r = f.getBoundingClientRect();
    return r.width * r.height > 0 && r.bottom > 0 && r.top < globalThis.innerHeight && f.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) !== false;
  });
  if (entrada ? entrada.captcha : captchaVisivel()) return { status: 'captcha_pendente' };
  const html = entrada ? entrada.html : document.documentElement.outerHTML;
  if (html.length > 8e6) return { status: 'pagina_grande_demais' };

  if (antigo) {
    const linhas = decodificar(html.replace(/<!--[\s\S]*?-->|<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<br\s*\/?>|<\/(tr|p|div|table|h\d|li|caption)\s*>/gi, '\n').replace(/<\/t[dh]\s*>/gi, '\t').replace(/<[^>]*>/g, ''))
      .split('\n').map(l => l.split('\t').map(c => c.replace(/\s+/g, ' ').trim()).filter(Boolean)).filter(l => l.length);
    const titulo = linhas.flat().map(c => /Preg[aã]o\s+(?:Eletr[oô]nico\s+)?N[º°o.]*\s*(\d{1,5})\/(\d{4})/i.exec(c)).find(Boolean);
    const uasg = (url.searchParams.get('co_no_uasg') || url.searchParams.get('coduasg') || '').replace(/\D/g, '')
      || /UASG\s*:?\s*(\d{6})/i.exec(linhas.flat().join(' '))?.[1] || '';
    if (!titulo || !/^\d{1,6}$/.test(uasg)) return { status: 'sem_dados' };
    const compra = uasg.padStart(6, '0') + '05' + titulo[1].padStart(5, '0') + titulo[2];
    const orgao = linhas.flat().map(c => /UASG\s*:?\s*\d{6}\s*-\s*(.+)/i.exec(c)?.[1]).find(Boolean);
    const DOC = /^(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{14}|\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11})$/;
    const itens = [], mensagens = [];
    let item = null, modo = null, cab = null, pfs = new Map();
    const proposta = (doc, nome) => {
      const f = fornecedor(doc, nome, pfs);
      let p = item.propostas.find(x => x.chave === f.chave);
      if (!p) item.propostas.push(p = { ...f, uf: null, meEpp: null, situacao: null, valorOfertado: null, valorNegociado: null, valorProposta: null, valorTotal: null, quantidade: null, marca: null, fabricante: null, modelo: null, chatLido: true, propostaLida: true, lances: [] });
      if (nome && !p.nome) p.nome = f.nome;
      return p;
    };
    for (const cel of linhas) {
      const l = cel.join(' ');
      const it = /^Item\s*:?\s*(\d{1,5})\b/i.exec(cel[0]);
      if (it) {
        item = { numero: Number(it[1]), descricao: null, situacao: null, quantidade: null, valorEstimado: null, unidade: null, propostas: [], mensagens: [] };
        itens.push(item); modo = 'item'; cab = null; pfs = new Map();
      } else if (/^(Troca de Mensagens|Mensagens)\b/i.test(cel[0])) { item = null; modo = 'chat'; continue; }
      else if (/^Eventos do Preg[aã]o/i.test(cel[0])) { item = null; modo = 'chat'; continue; }
      else if (item && /^Eventos do Item/i.test(cel[0])) { modo = 'eventos'; continue; }
      else if (item && /^Lances\b/i.test(cel[0])) { modo = 'lances'; continue; }
      else if (item && /^Propostas?\b/i.test(cel[0])) { modo = 'propostas'; continue; }
      if (modo === 'chat') {
        const quando = dataHora(cel[1]);
        if (!quando || cel.length < 3) continue;
        const texto = cel.slice(2).join(' ');
        mensagens.push({ fornecedor: null, dataHora: quando, autor: DOC.test(cel[0]) ? 'fornecedor' : curto(cel[0], 40), texto: curto(texto, 4000), tipo: tipoMensagem(texto), motivo: motivo(texto) });
        continue;
      }
      if (!item) continue;
      if (modo === 'eventos') {
        const quando = dataHora(cel[1]);
        if (!quando) continue;
        const texto = [cel[0], ...cel.slice(2)].join(': ');
        const doc = /CNPJ(?:\/CPF)?\s*:?\s*([\d./-]{11,18})/i.exec(texto)?.[1];
        item.mensagens.push({ fornecedor: doc ? proposta(doc, null).chave : null, dataHora: quando, autor: 'sistema', texto: curto(texto, 4000), tipo: tipoMensagem(cel[0] + ' ' + texto), motivo: motivo(texto) });
        continue;
      }
      if (modo === 'lances' && /R\$/.test(cel[0])) {
        const doc = cel.find(c => DOC.test(c));
        if (doc) proposta(doc, null).lances.push({ valor: dinheiro(cel[0])[0], dataHora: dataHora(cel.find(c => dataHora(c)) || ''), excluido: cel[0].startsWith('*') });
        continue;
      }
      if (modo === 'propostas' && cel.some(c => /valor\s+unit/i.test(c))) { cab = cel.map(semAcento); continue; }
      if (modo === 'propostas' && DOC.test(cel[0])) {
        const p = proposta(cel[0], cel[1]);
        const col = re => cab ? cab.findIndex(c => re.test(c)) : -1;
        const valores = dinheiro(l);
        const iPorte = col(/porte|me\/epp/);
        const iQtd = col(/quantidade/);
        p.meEpp = iPorte >= 0 ? /^sim$/i.test(cel[iPorte] || '') : null;
        p.quantidade = iQtd >= 0 ? num(cel[iQtd]) : null;
        p.valorProposta = valores[0] ?? null;
        p.valorTotal = valores[1] ?? null;
        continue;
      }
      for (const c of cel) {
        const m = /^([^:]{2,60}):\s*(.*)$/.exec(c);
        if (!m) continue;
        const r = semAcento(m[1]).replace(/\s+/g, ' ').trim();
        const ultima = item.propostas.at(-1);
        if (modo === 'propostas' && ultima && /^marca$/.test(r)) ultima.marca = curto(m[2], 200);
        else if (modo === 'propostas' && ultima && /^fabricante$/.test(r)) ultima.fabricante = curto(m[2], 200);
        else if (modo === 'propostas' && ultima && /^modelo/.test(r)) ultima.modelo = curto(m[2], 200);
        else if (modo === 'item' && r === 'descricao') item.descricao ??= curto(m[2], 2000);
        else if (modo === 'item' && r === 'quantidade') item.quantidade = num(m[2]);
        else if (modo === 'item' && r === 'valor estimado') item.valorEstimado = dinheiro(m[2])[0] ?? num(m[2]);
        else if (modo === 'item' && r.startsWith('unidade')) item.unidade = curto(m[2], 60);
        else if (r === 'situacao') item.situacao = curto(m[2], 120);
      }
    }
    if (!itens.length && !mensagens.length) return { status: 'sem_dados' };
    // Situação de cada proposta vem dos eventos (último evento do fornecedor no item).
    for (const i of itens) for (const m of i.mensagens) {
      const p = i.propostas.find(x => x.chave === m.fornecedor);
      if (p && m.tipo !== 'outro') p.situacao = { recusa: 'Recusada', desclassificacao: 'Desclassificada', inabilitacao: 'Inabilitada', aceite: 'Aceita', habilitacao: 'Habilitada', adjudicacao: 'Adjudicada', convocacao: p.situacao }[m.tipo] ?? p.situacao;
    }
    const n = titulo[1].replace(/^0+/, '');
    return { status: 'ok', versao: 1, fonte: 'comprasnet', compra, url: url.origin + url.pathname,
      cabecalho: { uasg: uasg.padStart(6, '0'), orgao: curto(orgao, 300), numero: n, ano: Number(titulo[2]), modalidade: 'Pregão Eletrônico' },
      itens, mensagens, pendentes: [] };
  }

  // Compras.gov novo (Angular): árvore mínima a partir do HTML serializado, igual na aba e nos testes.
  const compra = url.searchParams.getAll('compra');
  if (compra.length !== 1 || !/^\d{17}$/.test(compra[0])) return { status: 'pagina_nao_suportada' };
  const raiz = { tag: '', a: {}, f: [] };
  const pilha = [raiz];
  for (const m of html.matchAll(/<!--[\s\S]*?-->|<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>|<\/([a-z][\w:-]*)\s*>|<([a-z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+)/gi)) {
    const topo = pilha.at(-1);
    if (m[5] !== undefined) { topo.f.push(decodificar(m[5])); continue; }
    if (m[2]) { const t = m[2].toLowerCase(); const i = pilha.findLastIndex(n => n.tag === t); if (i > 0) pilha.length = i; continue; }
    if (!m[3]) continue;
    const no = { tag: m[3].toLowerCase(), a: {}, f: [], pai: topo };
    for (const at of m[4].matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) no.a[at[1].toLowerCase()] = decodificar(at[2] ?? at[3] ?? at[4] ?? '');
    topo.f.push(no);
    if (!VAZIOS.has(no.tag) && !/\/\s*$/.test(m[4])) pilha.push(no);
  }
  const elementos = no => no.f.filter(f => typeof f !== 'string');
  const todos = (no, p, out = []) => { for (const f of elementos(no)) { if (p(f)) out.push(f); todos(f, p, out); } return out; };
  const um = (no, p) => todos(no, p)[0] || null;
  const texto = no => !no ? '' : typeof no === 'string' ? no : no.f.map(texto).join(' ');
  const limpo = no => texto(no).replace(/\s+/g, ' ').trim();
  const classe = (no, re) => (no.a.class || '').split(/\s+/).some(c => re.test(c));
  const tag = t => n => n.tag === t;
  const dt = v => n => n.a['data-test'] === v;
  const vizinho = (no, d) => { const irm = no.pai ? elementos(no.pai) : []; return irm[irm.indexOf(no) + d] || null; };
  const rotulo = n => semAcento(limpo(n)).replace(/[:\s]+$/, '').replace(/\s+/g, ' ');
  // Pares rótulo/valor do portal: valor cp-valor-item* com o rótulo ao lado, ou colunas paralelas zipadas.
  const pares = no => {
    const r = {};
    const par = (l, v) => {
      if (!l || !v) return;
      const le = elementos(l), ve = elementos(v);
      if (le.length > 1 && le.length === ve.length) le.forEach((x, i) => { r[rotulo(x)] ??= limpo(ve[i]); });
      else r[rotulo(l)] ??= limpo(v);
    };
    for (const v of todos(no, n => classe(n, /^cp-valor-item(-08)?$/))) par(vizinho(v, -1), v);
    for (const l of todos(no, n => classe(n, /^cp-texto-item-08$/))) par(l, vizinho(l, 1));
    return r;
  };
  const cabCompra = um(raiz, tag('app-identificacao-compra'));
  const tituloCompra = limpo(um(cabCompra || raiz, n => n.tag === 'p' && classe(n, /^compra$/)));
  const nc = /(\d{1,5})\/(\d{4})/.exec(tituloCompra);
  const uasgTxt = /UASG\s+(\d{1,6})\s*-\s*(.+)/.exec(limpo(um(cabCompra || raiz, n => classe(n, /^uasg$/))));
  const cabecalho = { uasg: compra[0].slice(0, 6), orgao: curto(uasgTxt?.[2], 300), numero: nc ? nc[1].replace(/^0+/, '') : null,
    ano: nc ? Number(nc[2]) : null, modalidade: curto(/^[^N]*?(?=\s*N°|$)/.exec(tituloCompra)?.[0], 80) };
  const identificacaoItem = no => {
    const spans = todos(um(no, tag('app-identificacao-item')) || { f: [] }, tag('span')).map(limpo).filter(Boolean);
    return { numero: Number(spans[0]) || null, descricao: curto(spans.slice(1).join(' '), 2000), situacao: curto(limpo(um(no, dt('situacao-item'))), 120) };
  };
  const itemPagina = /\/item\/(\d{1,5})$/.exec(url.pathname);

  if (!itemPagina) {
    const itens = todos(raiz, dt('item')).map(row => {
      const id = identificacaoItem(row);
      const t = limpo(row);
      const m = /Valor estimado[^$]*?(\d[\d.,]*)\s+R\$\s*([\d.]+(?:,\d+)?)/i.exec(t);
      return { ...id, quantidade: m ? num(m[1]) : null, valorEstimado: m ? num(m[2]) : null, unidade: null, propostas: [], mensagens: [], propostasLidas: false };
    }).filter(i => i.numero);
    if (!itens.length) return { status: 'sem_dados' };
    return { status: 'ok', versao: 1, fonte: 'comprasgov', compra: compra[0], url: `${url.origin}${url.pathname}?compra=${compra[0]}`, cabecalho, itens, mensagens: [],
      pendentes: itens.map(i => ({ item: i.numero, fornecedor: null, falta: ['propostas'] })) };
  }

  const cabItem = um(raiz, tag('app-cabecalho-item'));
  const cards = todos(raiz, tag('app-dados-proposta-item-em-selecao-fornecedores'));
  if (!cabItem && !cards.length) return { status: 'sem_dados' };
  const pi = cabItem ? pares(cabItem) : {};
  const item = { ...identificacaoItem(cabItem || raiz), quantidade: num(pi['quantidade solicitada'] ?? pi['qtde solicitada']),
    valorEstimado: dinheiro(pi['valor estimado (unitario)'])[0] ?? null, unidade: curto(pi['unidade de fornecimento'], 60), propostas: [], mensagens: [], propostasLidas: true };
  item.numero = Number(itemPagina[1]);
  const pfs = new Map(), pendentes = [];
  for (const [i, card] of cards.entries()) {
    const doc = limpo(um(card, dt('identificacao-participante')));
    const f = fornecedor(doc || `#${i}`, limpo(um(card, dt('nome-participante'))), pfs);
    const pc = pares(card);
    const det = um(card, tag('app-detalhes-proposta-item'));
    const chat = um(card, tag('app-mensagens-chat-lista'));
    const pp = det ? pares(det) : {};
    const prop = dinheiro(pp['valor proposta (unitario | total)']);
    const p = { ...f, uf: curto(limpo(um(card, dt('uf-participante'))), 2), meEpp: !!um(card, dt('declarante-me-epp')),
      situacao: curto(limpo(um(card, dt('situacao-proposta'))), 120),
      valorOfertado: dinheiro(pc['valor ofertado (unitario)'])[0] ?? null, valorNegociado: dinheiro(pc['valor negociado (unitario)'])[0] ?? null,
      valorProposta: prop[0] ?? null, valorTotal: prop[1] ?? null, quantidade: det ? num(pp['quantidade ofertada']) : null,
      marca: det ? curto(pp['marca/fabricante'] ?? pp.marca, 200) : null, fabricante: det ? curto(pp.fabricante, 200) : null,
      modelo: det ? curto(pp['modelo/versao'] ?? pp['modelo/versão'] ?? pp.modelo, 200) : null,
      chatLido: !!chat, propostaLida: !!det, lances: [] };
    item.propostas.push(p);
    if (chat) {
      for (const t of todos(chat, n => classe(n, /^mensagens-texto$/))) {
        const caixa = t.pai;
        const corpo = limpo(t);
        item.mensagens.push({ fornecedor: f.chave, dataHora: dataHora(limpo(um(caixa, n => classe(n, /^mensagens-data$/)))),
          autor: classe(caixa, /participante|fornecedor/) ? 'fornecedor' : 'orgao', texto: curto(corpo, 4000), tipo: tipoMensagem(corpo), motivo: motivo(corpo) });
      }
      if (todos(um(card, tag('app-mensagens-chat-item')) || chat, tag('button')).some(b => /mais|anterior/i.test(limpo(b)))) pendentes.push({ item: item.numero, fornecedor: f.cnpj || f.chave, nome: f.nome, falta: ['chat_mais_antigo'] });
    }
    if (!chat || !det) pendentes.push({ item: item.numero, fornecedor: f.cnpj || f.chave, nome: f.nome, falta: [...(chat ? [] : ['chat']), ...(det ? [] : ['proposta'])] });
  }
  return { status: 'ok', versao: 1, fonte: 'comprasgov', compra: compra[0], url: `${url.origin}${url.pathname}?compra=${compra[0]}`, cabecalho, itens: [item], mensagens: [], pendentes };
}

// DESLIGADO. Não habilitar sem parecer jurídico: o captcha do portal existe para impedir consulta automatizada, e
// clicar/navegar pelo usuário pode ser lido assim mesmo em ritmo humano. Nenhum botão chama abrirDetalhesItem
// enquanto MODO_AUTOMATICO for false; o popup só lê o que o usuário já abriu e lista o que falta abrir.
export const MODO_AUTOMATICO = false;

// Abre, na aba visível do usuário e em ritmo humano, o detalhe de cada fornecedor do item (Chat e Proposta).
// São os mesmos cliques que ele faria; a página busca os dados com o captcha dela. Para no primeiro desafio.
export async function abrirDetalhesItem(pausaMinMs = 1200, pausaMaxMs = 2600) {
  const esperar = ms => new Promise(r => setTimeout(r, ms));
  const pausa = () => esperar(pausaMinMs + Math.random() * (pausaMaxMs - pausaMinMs));
  const captcha = () => [...document.querySelectorAll('iframe')].some(f => {
    if (!/hcaptcha\.com|recaptcha/.test(f.src || '')) return false;
    const r = f.getBoundingClientRect();
    return r.width * r.height > 0 && r.bottom > 0 && r.top < globalThis.innerHeight && f.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) !== false;
  });
  let abertos = 0;
  for (const card of document.querySelectorAll('app-dados-proposta-item-em-selecao-fornecedores')) {
    if (captcha()) return { status: 'captcha_pendente', abertos };
    const botao = card.querySelector('button[data-test="btn-expandir"]');
    if (botao && botao.getAttribute('aria-expanded') !== 'true') { botao.scrollIntoView({ block: 'center' }); botao.click(); abertos++; await pausa(); }
    for (const titulo of ['Chat', 'Proposta']) {
      if (captcha()) return { status: 'captcha_pendente', abertos };
      const secao = [...card.querySelectorAll('app-secoes-proposta-item-acesso-publico button')].find(b => b.textContent.trim() === titulo);
      if (secao && !secao.nextElementSibling) { secao.click(); abertos++; await pausa(); }
    }
  }
  return { status: captcha() ? 'captcha_pendente' : 'ok', abertos };
}


// Roda NA ABA DO LICITAPLENA (mesma origem do site): usa a sessão que a página já tem e chama /api/pregao-gravado.
// O token não sai daquela aba nem passa pelo popup ou pelo portal do governo.
export async function enviarNaPagina(pregao) {
  let sessao = null;
  for (let i = 0; i < globalThis.localStorage.length && !sessao?.access_token; i++) {
    const k = globalThis.localStorage.key(i);
    if (!/^sb-[\w-]+-auth-token$/.test(k || '')) continue;
    try { const v = JSON.parse(globalThis.localStorage.getItem(k)); sessao = v?.access_token ? v : v?.currentSession || null; } catch { sessao = null; }
  }
  if (!sessao?.access_token) return { ok: false, status: 401, erro: 'Entre no LicitaPlena nesta janela e tente de novo.' };
  if (sessao.expires_at && sessao.expires_at * 1000 < Date.now()) return { ok: false, status: 401, erro: 'A sessão do LicitaPlena expirou: recarregue a aba do LicitaPlena e tente de novo.' };
  try {
    const r = await fetch('/api/pregao-gravado', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.access_token}` }, body: JSON.stringify(pregao) });
    const corpo = await r.json().catch(() => ({}));
    return { ...corpo, ok: r.ok && corpo.ok === true, status: r.status };
  } catch {
    return { ok: false, status: 0, erro: 'Sem conexão com o LicitaPlena.' };
  }
}
