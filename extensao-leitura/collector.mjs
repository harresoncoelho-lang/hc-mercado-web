// Função autocontida: executeScript serializa apenas seu corpo, sem imports.
export function collectSnapshot() {
  const snapshot = { url: '', headings: [], supplierLabels: [], notices: [], collectionComplete: false };
  // Revalida no próprio frame: pode ter navegado depois de tabs.query.
  // Regra duplicada intencionalmente, pois executeScript serializa sem imports.
  try {
    const url = new URL(location.href);
    if (url.origin !== 'https://cnetmobile.estaleiro.serpro.gov.br'
      || url.pathname !== '/comprasnet-web/seguro/fornecedor/cadastro-propostas'
      || url.username || url.password || url.hash
      || [...url.searchParams.keys()].length !== 1
      || !/^\d{17}$/.test(url.searchParams.get('compra') || '')) return snapshot;
    snapshot.url = url.href;
    snapshot.collectionComplete = true;
  } catch { return snapshot; }
  const nodes = document.querySelectorAll('h1,h2,h3,p,dt,dd,label,span,div,iframe,[role="alert"],[role="dialog"]');
  if (nodes.length > 5000) snapshot.collectionComplete = false;
  for (const node of Array.from(nodes).slice(0, 5000)) {
    // aria-hidden é acessibilidade, não ocultação visual de um desafio iframe.
    if ((node.tagName !== 'IFRAME' && node.closest('[hidden],[aria-hidden="true"]')) || !node.getClientRects().length) continue;
    if (node.tagName === 'IFRAME' && !Array.from(node.getClientRects()).some(rect => rect.width > 0 && rect.height > 0)) continue;
    // Sem esta API, não há evidência suficiente de visibilidade inclusive ancestral.
    if (typeof node.checkVisibility !== 'function') { snapshot.collectionComplete = false; continue; }
    if (!node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility !== 'visible') continue;
    if (node.tagName === 'IFRAME') {
      // Origem e título observados no portal; nunca acessa conteúdo cross-origin.
      try {
        if (new URL(node.getAttribute('src'), snapshot.url).origin === 'https://newassets.hcaptcha.com') {
          if (node.getAttribute('title') === 'Desafio hCaptcha') snapshot.notices.push('CAPTCHA pendente');
          else snapshot.collectionComplete = false; // Frame visível ambíguo, não afirma desafio/badge.
        }
      } catch { snapshot.collectionComplete = false; }
      continue;
    }
    const role = node.getAttribute('role');
    // Não lê wrappers inteiros: div com filhos só pode ser aviso explícito.
    if (node.tagName === 'DIV' && node.children.length && role !== 'alert' && role !== 'dialog') continue;
    const text = (node.textContent || '').trim().replace(/\s+/g, ' ');
    if (text.length > 240) {
      if (role === 'alert' || role === 'dialog') snapshot.collectionComplete = false;
      continue;
    }
    // Avisos podem conter strong/span: retorna somente sinal genérico, nunca o texto.
    if (/sess[aã]o.*expir|acesso n[aã]o autorizado|captcha/i.test(text)) snapshot.notices.push('Sessão expirada ou CAPTCHA pendente');
    // Título real possui três spans; exceção restrita, não vale para breadcrumb.
    if (node.matches('app-identificacao-compra > p.compra')) {
      const structure = node.children.length === 3
        && Array.from(node.children).every(child => child.tagName === 'SPAN' && child.children.length === 0
          && child.getClientRects().length && typeof child.checkVisibility === 'function'
          && child.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
          && getComputedStyle(child).display !== 'none' && getComputedStyle(child).visibility === 'visible')
        && node.children[0].textContent.trim() === 'N°'
        && node.children[1].textContent.trim() === '(SRP)'
        && node.children[2].textContent.trim() === '(Lei 14.133/2021)';
      const heading = text.match(/^Pregão Eletrônico N°\s*(\d{1,5})\/(\d{4})\s+\(SRP\)\s+\(Lei 14\.133\/2021\)$/);
      if (structure && heading) snapshot.headings.push(`Pregão Eletrônico N° ${heading[1]}/${heading[2]}`);
      else snapshot.collectionComplete = false;
      continue;
    }
    // Identificadores somente em elementos curtos sem filhos.
    if (node.children.length) continue;
    const purchase = text.match(/^Preg[aã]o Eletr[oô]nico N[°ºo.]?\s*(\d{1,5})\/(\d{4})(?:\s|$)/i);
    const uasg = text.match(/^UASG\s+(\d{6})(?:\s|$)/i);
    // Este rótulo é contrato conservador, não seletor homologado do portal.
    const supplier = text.match(/^CNPJ do fornecedor\s*:\s*((?:\d{14}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}))$/i);
    // Estrutura do header observada em 02/11: só o leaf CNPJ, nunca nome/CPF.
    const headerIdentity = node.matches('span.ml-1.text-nowrap')
      && node.parentElement?.tagName === 'SPAN' && node.parentElement.children.length === 2
      && node.parentElement.parentElement?.matches('div#usuarioAtual > div[role="tab"]');
    const headerSupplier = headerIdentity && text.match(/^\|\s*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})$/);
    if (headerIdentity && !headerSupplier && !/^\|\s*\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(text)) snapshot.collectionComplete = false;
    if (/^CNPJ do fornecedor\s*:/i.test(text) && !supplier) snapshot.collectionComplete = false;
    if (purchase) snapshot.headings.push(`Pregão Eletrônico N° ${purchase[1]}/${purchase[2]}`);
    if (uasg) snapshot.headings.push(`UASG ${uasg[1]}`);
    if (supplier) snapshot.supplierLabels.push(`CNPJ do fornecedor: ${supplier[1]}`);
    if (headerSupplier) snapshot.supplierLabels.push(`CNPJ do fornecedor: ${headerSupplier[1]}`);
  }
  for (const key of ['headings', 'supplierLabels', 'notices']) {
    snapshot[key] = [...new Set(snapshot[key])];
    if (snapshot[key].length > 20) { snapshot.collectionComplete = false; snapshot[key] = snapshot[key].slice(0, 20); }
  }
  snapshot.paginaObservada = { completa: false, itens: [] };
  if (!snapshot.collectionComplete || snapshot.notices.length) return snapshot;
  const cards = document.querySelectorAll('p-dataview > div.p-dataview-content > div.cp-itens-card.cp-item-expansivel');
  if (!cards.length || cards.length > 10) return snapshot;
  const visible = element => element && element.getClientRects().length && typeof element.checkVisibility === 'function'
    && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const leaf = element => visible(element) && element.children.length === 0 ? element.textContent.trim() : null;
  const itens = []; const ids = new Set();
  for (const card of cards) {
    if (!visible(card)) return snapshot;
    const headings = card.querySelectorAll('app-identificacao-item > div.dots.cp-item-bold.cp-texto-item-08');
    if (headings.length !== 1 || headings[0].children.length !== 2) return snapshot;
    const [number, description] = headings[0].children;
    const id = leaf(number); const descricao = leaf(description);
    if (number.tagName !== 'SPAN' || !description.matches('span.text-uppercase.pl-1') || !/^[1-9]\d{0,17}$/.test(id || '') || ids.has(id) || !descricao || descricao.length > 2000) return snapshot;
    const rows = card.querySelectorAll(':scope > div.col-md-3.col-sm-12.col-12.row.pr-0.align-items-center.ng-star-inserted > div.col-12.pr-0.pl-1.conteudo-div-centralizado.cp-valor-responsivo > div.row.m-0');
    if (rows.length !== 1 || rows[0].children.length !== 2) return snapshot;
    const columns = Array.from(rows[0].children);
    if (!columns.every(column => column.matches('div.cp-texto-item.cp-label') && column.children.length === 3)) return snapshot;
    if (!columns.every(column => Array.from(column.children).every(value => value.matches('div.mb-half-half')))) return snapshot;
    const labels = Array.from(columns[0].children).map(leaf);
    const values = Array.from(columns[1].children).map(leaf);
    if (labels.join('|') !== 'Quantidade solicitada|Quantidade mínima|Unidade fornecimento'
      || !values[0] || values[0].length > 64 || !/^\d+(?:[.,]\d+)?$/.test(values[0]) || !values[2] || values[2].length > 120) return snapshot;
    ids.add(id);
    itens.push({ id, descricao, quantidadeSolicitada: values[0], unidade: values[2], grupo: null, exigencias: null });
  }
  snapshot.paginaObservada = { completa: true, itens };
  return snapshot;
}
