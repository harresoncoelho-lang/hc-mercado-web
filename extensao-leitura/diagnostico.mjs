// Modo diagnóstico: quando um fluxo não reconhece a página do portal, o usuário pode mandar SÓ a estrutura dela
// (tags, classes, ids, data-test, rótulos de campo) para a equipe ajustar os seletores. Nunca vai: valor digitado
// (value, checked, selected), texto corrido da página, href/src com parâmetros, CPF, nem nada fora do portal do governo.
// estruturaPagina é injetada na aba do portal (autocontida: executeScript serializa só o corpo); enviarDiagnosticoNaPagina
// roda na aba do LicitaPlena já logada (mesma regra de enviarNaPagina). O servidor (extensao-diagnostico.js) filtra de novo.

export const HOSTS_PORTAL = ['cnetmobile.estaleiro.serpro.gov.br', 'comprasnet.gov.br', 'www.comprasnet.gov.br'];
// Permissão opcional do portal: só para o vigia do chat voltar sozinho depois que a página recarrega.
export const PORTAL = 'https://cnetmobile.estaleiro.serpro.gov.br/*';

export function estruturaPagina(entrada) {
  const HOSTS = ['cnetmobile.estaleiro.serpro.gov.br', 'comprasnet.gov.br', 'www.comprasnet.gov.br'];
  const MAX_NOS = 4000, MAX_PROF = 40, MAX_TXT = 60;
  // Seletores de que cada fluxo depende (mapas de 18 e 19/11): a contagem já diz qual deles sumiu.
  const ESPERADOS = {
    gravar: ['app-identificacao-compra', '[data-test="item"]', 'app-cabecalho-item', 'app-dados-proposta-item-em-selecao-fornecedores',
      '[data-test="identificacao-participante"]', 'app-detalhes-proposta-item', 'app-mensagens-chat-lista', '.mensagens-texto', '.mensagens-data',
      '.cp-valor-item', '.cp-texto-item-08', 'app-secoes-proposta-item-acesso-publico button'],
    preencher: ['div.cp-itens-card', 'app-identificacao-item span', '[data-test="situacao-item"]', '[data-test="valor-estimado-item"]',
      '[data-test="btn-expandir-proposta"]', 'input[data-test="input-quantidade-ofertada"]', 'input[data-test="input-valor-proposta"]',
      'input[data-test="input-marca-fabricante"]', 'input[data-test="input-modelo-versao"]', '[data-test="btn-aceitar-declaracoes"]'],
    acompanhar: ['.mensagens-texto', '.mensagens-data', 'app-mensagens-chat-lista', 'app-mensagens-chat-item', '[class*="mensagem"]', '[class*="chat"]'],
  };
  const fluxo = Object.hasOwn(ESPERADOS, entrada?.fluxo) ? entrada.fluxo : null;
  const href = entrada?.href ?? globalThis.location.href;
  let url;
  try { url = new URL(href); } catch { return { status: 'fora_do_portal' }; }
  if (!/^https?:$/.test(url.protocol) || url.username || !HOSTS.includes(url.hostname)) return { status: 'fora_do_portal' };
  const doc = entrada?.document ?? globalThis.document;

  // Dígitos em sequência (CPF, CNPJ, telefone, nº de processo) viram "#": o rótulo continua legível sem o dado.
  const limpar = s => String(s ?? '').replace(/\s+/g, ' ').trim().replace(/\d[\d.\-/\s]{4,}\d/g, '#').replace(/\d{5,}/g, '#').slice(0, MAX_TXT);
  // Classes e ids gerados (Angular, PrimeNG) e qualquer coisa com dígito longo ficam de fora ou mascarados.
  const nome = s => limpar(s).replace(/\s/g, '');
  const COM_TEXTO = new Set(['label', 'legend', 'th', 'button', 'caption', 'option', 'summary', 'dt']);
  const ATRIBUTOS = ['data-test', 'role', 'type', 'name', 'for', 'aria-label', 'placeholder', 'title', 'maxlength', 'formcontrolname'];
  // option pode trazer razão social na lista de empresas: só a quantidade, nunca o texto.
  const textoDe = el => (COM_TEXTO.has(el.localName) && el.localName !== 'option' ? limpar(el.textContent) : null);

  const nos = [];
  let cortado = false;
  const visitar = (el, prof) => {
    if (nos.length >= MAX_NOS) { cortado = true; return; }
    const t = el.localName;
    if (['script', 'style', 'noscript', 'svg', 'path', 'template', 'link', 'meta'].includes(t)) return;
    const no = { t, p: prof };
    if (el.id) no.id = nome(el.id);
    const cls = [...(el.classList || [])].filter(c => !/^ng-|^_ng|\d{3,}/.test(c)).slice(0, 8).map(nome);
    if (cls.length) no.c = cls;
    for (const a of ATRIBUTOS) { const v = el.getAttribute?.(a); if (v) (no.a ||= {})[a] = limpar(v); }
    if (t === 'iframe') { try { no.src = new URL(el.getAttribute('src') || '', url).hostname; } catch { no.src = null; } }
    if (t === 'a') { try { const u = new URL(el.getAttribute('href') || '', url); no.href = HOSTS.includes(u.hostname) ? u.pathname.replace(/\d{5,}/g, '#') : u.hostname; } catch { /* href inválido fica de fora */ } }
    if (['input', 'textarea', 'select'].includes(t)) no.preenchido = !!(el.value && String(el.value).trim()); // só se tem algo, nunca o quê
    const tx = textoDe(el);
    if (tx) no.tx = tx;
    const filhos = [...(el.children || [])];
    if (filhos.length && prof >= MAX_PROF) { no.cortado = true; nos.push(no); return; }
    nos.push(no);
    for (const f of filhos) visitar(f, prof + 1);
  };
  if (doc.body) visitar(doc.body, 0);

  const seletores = {};
  for (const [f, lista] of Object.entries(ESPERADOS)) {
    if (fluxo && f !== fluxo) continue;
    for (const s of lista) { try { seletores[s] = doc.querySelectorAll(s).length; } catch { seletores[s] = -1; } }
  }
  const compra = url.searchParams.get('compra');
  return {
    status: 'ok', versao: 1, fluxo, motivo: limpar(entrada?.motivo).slice(0, 40) || null, extensao: entrada?.extensao || null,
    pagina: { host: url.hostname, caminho: url.pathname.replace(/\d{5,}/g, '#'), compra: /^\d{17}$/.test(compra || '') ? compra : null,
      titulo: limpar(doc.title), largura: globalThis.innerWidth || null, carregando: doc.readyState !== 'complete' },
    seletores, nos, cortado,
  };
}

export async function enviarDiagnosticoNaPagina(diagnostico) {
  let sessao = null;
  for (let i = 0; i < globalThis.localStorage.length && !sessao?.access_token; i++) {
    const k = globalThis.localStorage.key(i);
    if (!/^sb-[\w-]+-auth-token$/.test(k || '')) continue;
    try { const v = JSON.parse(globalThis.localStorage.getItem(k)); sessao = v?.access_token ? v : v?.currentSession || null; } catch { sessao = null; }
  }
  if (!sessao?.access_token) return { ok: false, status: 401, erro: 'Entre no LicitaPlena nesta janela e tente de novo.' };
  if (sessao.expires_at && sessao.expires_at * 1000 < Date.now()) return { ok: false, status: 401, erro: 'A sessão do LicitaPlena expirou: recarregue a aba do LicitaPlena e tente de novo.' };
  try {
    const r = await fetch('/api/extensao-diagnostico', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.access_token}` }, body: JSON.stringify(diagnostico) });
    const corpo = await r.json().catch(() => ({}));
    return { ...corpo, ok: r.ok && corpo.ok === true, status: r.status };
  } catch {
    return { ok: false, status: 0, erro: 'Sem conexão com o LicitaPlena.' };
  }
}

// Origens do LicitaPlena no manifesto (a do portal, pedida só para reconectar o chat, não conta).
export const origensLicitaPlena = manifest => (manifest?.optional_host_permissions || []).filter(o => !HOSTS_PORTAL.some(h => o.includes(`//${h}/`)));
export const ehPortal = href => { try { const u = new URL(href); return HOSTS_PORTAL.includes(u.hostname); } catch { return false; } };

export function resumoDiagnostico(d) {
  const faltando = Object.entries(d.seletores).filter(([, n]) => n === 0).map(([s]) => s);
  return `Estrutura da página: ${d.nos.length} elementos${d.cortado ? ' (cortada no limite)' : ''}. Vai só tag, classe, id e rótulo de campo; nenhum valor digitado nem texto da página.`
    + (faltando.length ? `\nNão achei: ${faltando.slice(0, 6).join(', ')}${faltando.length > 6 ? '…' : ''}` : '');
}
