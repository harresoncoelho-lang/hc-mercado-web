// Modo "Preencher proposta" (assistido): preenche, na página de cadastro de propostas do Compras.gov que o usuário já
// abriu e logou, os campos de cada item visível (quantidade, valor, marca/fabricante, modelo/versão) a partir do lote
// do LicitaPlena ou de uma planilha CSV. NUNCA clica em Salvar, não marca termo nem declarações Sim/Não, não resolve
// captcha, não navega e não chama a API do portal. O usuário confere e clica Salvar em cada item.
// Único clique permitido: o da seta de expandir o cartão (btn-expandir-proposta), e só se os campos ainda não estão
// abertos. Seletores data-test: docs em _historico/mapa-cadastro-proposta-comprasgov-20261118.md.
// As funções injetadas (preencherPaginaCadastro, buscarLoteNaPagina) são autocontidas: chrome.scripting.executeScript
// serializa só o corpo da função.

const COLUNAS = ['item', 'descricao', 'quantidade', 'unidade', 'valor_unitario', 'marca', 'modelo', 'fabricante', 'preco_minimo'];
const MAX_LINHAS = 1000;
const MAX_BYTES = 2 * 1024 * 1024;

export const URL_CADASTRO = /^https:\/\/cnetmobile\.estaleiro\.serpro\.gov\.br\/comprasnet-web\/seguro\/fornecedor\/cadastro-propostas\?(?:.*&)?compra=(\d{17})(?:&|$)/;
export const compraDaUrl = url => URL_CADASTRO.exec(String(url || ''))?.[1] || null;

// ---------- planilha CSV (padrão de planilha-itens.js: ';', cabeçalho, decimal com vírgula) ----------
function registros(texto) {
  const out = []; let campo = '', reg = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') aspas = false; else campo += c;
    } else if (c === '"' && campo === '') aspas = true;
    else if (c === ';') { reg.push(campo); campo = ''; } else if (c === '\r' || c === '\n') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      reg.push(campo); out.push(reg); campo = ''; reg = [];
    } else campo += c;
  }
  if (aspas) return null;
  if (campo !== '' || reg.length) { reg.push(campo); out.push(reg); }
  return out;
}

// "10,5" -> "10.5". Sem milhar, no máximo 4 casas (o portal mostra o estimado com 4).
function decimalTexto(t) {
  const s = String(t ?? '').trim();
  if (!/^\d+([.,]\d{1,4})?$/.test(s)) return null;
  const [i, f = ''] = s.split(/[.,]/);
  const frac = f.replace(/0+$/, ''), int = i.replace(/^0+(?=\d)/, '');
  return frac ? `${int}.${frac}` : int;
}

export function lerCsv(texto) {
  const falha = erro => ({ ok: false, erros: [erro], itens: [] });
  if (typeof texto !== 'string') return falha('Arquivo de planilha inválido.');
  if (texto.length > MAX_BYTES) return falha('A planilha passa de 2 MB. Divida em arquivos menores.');
  const regs = registros((texto.charCodeAt(0) === 0xFEFF ? texto.slice(1) : texto));
  if (!regs) return falha('A planilha tem aspas sem fechamento.');
  const cab = (regs[0] || []).map(c => c.trim().toLowerCase());
  if (!cab.includes('item') || !cab.includes('valor_unitario') || cab.some(c => !COLUNAS.includes(c))) {
    return falha(`O cabeçalho precisa ter as colunas item e valor_unitario, entre: ${COLUNAS.join(';')}. Baixe a planilha do LicitaPlena e preencha nela.`);
  }
  const dados = regs.slice(1).map((v, k) => ({ linha: k + 2, v })).filter(l => l.v.some(c => c.trim() !== ''));
  if (dados.length > MAX_LINHAS) return falha(`A planilha tem ${dados.length} itens; o limite é ${MAX_LINHAS}.`);
  const erros = [], itens = [], vistos = new Set();
  for (const { linha, v } of dados) {
    if (v.length !== cab.length) { erros.push(`Linha ${linha}: esperadas ${cab.length} colunas, encontradas ${v.length}.`); continue; }
    // Antifórmula do Excel (apóstrofo antes de =, +, -, @) volta ao texto original.
    const r = Object.fromEntries(cab.map((c, k) => [c, v[k].trim().replace(/^'(?=[=+\-@])/, '')]));
    const item = r.item.replace(/^0+(?=\d)/, '');
    if (!/^\d{1,6}$/.test(item)) { erros.push(`Linha ${linha}: item "${r.item}" precisa ser o número do item no portal.`); continue; }
    if (vistos.has(item)) { erros.push(`Linha ${linha}: item ${item} repetido.`); continue; }
    vistos.add(item);
    const num = (coluna, obrigatorio) => {
      if (!r[coluna]) { if (obrigatorio) erros.push(`Linha ${linha}: informe ${coluna}.`); return null; }
      const d = decimalTexto(r[coluna]);
      if (d === null) erros.push(`Linha ${linha}: ${coluna} "${r[coluna]}" inválido. Use só dígitos e vírgula, sem milhar, até 4 casas.`);
      return d;
    };
    const antes = erros.length;
    const novo = {
      item, quantidade: num('quantidade'), valorUnitario: num('valor_unitario', true), valorMinimo: num('preco_minimo'),
      marca: r.marca || null, modelo: r.modelo || null, fabricante: r.fabricante || null,
    };
    // eslint-disable-next-line no-control-regex -- recusar caractere de controle é o objetivo
    if ([novo.marca, novo.modelo, novo.fabricante].some(t => t && /[\u0000-\u001f\u007f]/.test(t))) erros.push(`Linha ${linha}: texto com caractere de controle.`);
    if (erros.length === antes) itens.push(novo);
  }
  return { ok: erros.length === 0, erros, itens };
}

// ---------- diário (retomada se o portal cair) ----------
// storage: Storage-like (localStorage do popup). Estados por item: 'preenchido' (nós preenchemos; o usuário ainda
// precisa Salvar) e 'salvo' (a página mostra a situação diferente de "Proposta não cadastrada").
const chaveDiario = compra => `lp-preencher-diario:${compra}`;
export function lerDiario(storage, compra) {
  try { const d = JSON.parse(storage.getItem(chaveDiario(compra))); return d && typeof d === 'object' ? d : {}; } catch { return {}; }
}
export function registrarDiario(storage, compra, resultado, agora = new Date().toISOString()) {
  const d = lerDiario(storage, compra);
  for (const p of resultado.preenchidos || []) d[p.item] = { estado: 'preenchido', em: agora };
  for (const n of resultado.jaNoPortal || []) d[n] = { estado: 'salvo', em: agora };
  try { storage.setItem(chaveDiario(compra), JSON.stringify(d)); } catch { /* sem armazenamento: o diário é conveniência */ }
  return d;
}
const PREFIXOS_ARMAZENADOS = ['lp-preencher-lote:', 'lp-preencher-diario:'];
// Lote traz valorMinimo (estratégia do usuário): não fica para sempre no navegador. Lote guarda {em, itens}, diário {item:{em}}; sem data ou com mais de `dias`, apaga.
export function expirarArmazenamento(storage, agora = Date.now(), dias = 30) {
  try {
    for (let i = storage.length - 1; i >= 0; i--) {
      const k = storage.key(i);
      if (!PREFIXOS_ARMAZENADOS.some(p => k?.startsWith(p))) continue;
      let em = NaN;
      try { const v = JSON.parse(storage.getItem(k)); em = Array.isArray(v) ? NaN : Math.max(...[v.em, ...Object.values(v).map(e => e?.em)].map(Date.parse).filter(Number.isFinite)); } catch { /* ilegível: apaga */ }
      if (!(agora - em < dias * 86400000)) storage.removeItem(k);
    }
  } catch { /* sem armazenamento */ }
}
export function progresso(diario, lote) {
  const feitos = lote.filter(l => diario[l.item]).length;
  return { feitos, total: lote.length };
}

// ---------- injetada na aba do cadastro ----------
export async function preencherPaginaCadastro(entrada) {
  const MAXIMO = { quantidade: 12, valor: 18, marca: 50, modelo: 50 };
  const lote = new Map((entrada.lote || []).map(l => [String(l.item), l]));
  const espera = Number.isFinite(entrada.espera) ? entrada.espera : 1500;
  const resultado = { status: 'ok', compra: null, itensNaPagina: 0, preenchidos: [], alertas: [], jaNoPortal: [], foraDoLote: [], foraDaPagina: [], camposFechados: [] };
  const url = new URL(globalThis.location.href);
  if (url.origin !== 'https://cnetmobile.estaleiro.serpro.gov.br' || url.pathname !== '/comprasnet-web/seguro/fornecedor/cadastro-propostas') return { ...resultado, status: 'pagina_nao_suportada' };
  resultado.compra = /^\d{17}$/.test(url.searchParams.get('compra') || '') ? url.searchParams.get('compra') : null;
  const doc = globalThis.document;
  const visivel = el => el && el.getClientRects().length > 0;
  if (Array.from(doc.querySelectorAll('iframe[src*="hcaptcha.com"]')).some(f => visivel(f) && /desafio/i.test(f.getAttribute('title') || ''))) return { ...resultado, status: 'captcha_pendente' };
  const cartoes = Array.from(doc.querySelectorAll('div.cp-itens-card'));
  if (!cartoes.length) return { ...resultado, status: 'sem_itens' };

  // Valores com 4 casas inteiras escaladas (BigInt): "11,8700" e "11.87" -> 118700n. Milhar com ponto só se vier com vírgula.
  const escalar = t => {
    let s = String(t ?? '').replace(/R\$|\s/g, '');
    if (!/^\d[\d.]*,\d{1,4}$|^\d+(\.\d{1,4})?$/.test(s)) return null; // vários pontos só com vírgula decimal: \"1.234.567\" é ambíguo
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const [i, f = ''] = s.split('.');
    return BigInt(i + f.padEnd(4, '0'));
  };
  const br = n => `${n / 10000n},${String(n % 10000n).padStart(4, '0')}`;
  const esperar = ms => new Promise(r => globalThis.setTimeout(r, ms));
  const campo = (cartao, nome) => cartao.querySelector(`input[data-test="${nome}"]`);
  const limite = (el, padrao) => (el.maxLength > 0 ? Math.min(el.maxLength, padrao) : padrao);
  // Setter nativo + eventos que o Angular (formulário reativo) escuta.
  const escrever = (el, valor) => {
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    el.focus();
    if (desc?.set) desc.set.call(el, valor); else el.value = valor;
    for (const tipo of ['input', 'change', 'blur']) el.dispatchEvent(new globalThis.Event(tipo, { bubbles: true }));
  };
  const alertar = (item, tipo, mensagem) => resultado.alertas.push({ item, tipo, mensagem });
  const naPagina = new Set();

  for (const cartao of cartoes) {
    const numero = (cartao.querySelector('app-identificacao-item span')?.textContent || '').trim().replace(/^0+(?=\d)/, '');
    if (!/^\d{1,6}$/.test(numero)) continue;
    naPagina.add(numero);
    resultado.itensNaPagina++;
    const l = lote.get(numero);
    if (!l) { resultado.foraDoLote.push(numero); continue; }
    const situacao = (cartao.querySelector('[data-test="situacao-item"]')?.textContent || '').trim();
    if (situacao && !/n[aã]o\s+cadastrada/i.test(situacao)) { resultado.jaNoPortal.push(numero); continue; }

    // 1) Validar tudo antes de tocar no cartão: item com problema não é preenchido (nem parcialmente).
    const valor = escalar(l.valorUnitario);
    const estimado = escalar(cartao.querySelector('[data-test="valor-estimado-item"]')?.textContent);
    const minimo = escalar(l.valorMinimo);
    const problemas = [];
    if (valor === null || valor <= 0n) problemas.push(['valor_invalido', `valor "${l.valorUnitario}" inválido`]);
    else {
      if (minimo !== null && valor < minimo) problemas.push(['abaixo_do_minimo', `valor R$ ${br(valor)} abaixo do seu mínimo R$ ${br(minimo)}`]);
      if (estimado !== null && valor > estimado) problemas.push(['acima_do_estimado', `valor R$ ${br(valor)} acima do estimado do portal R$ ${br(estimado)}`]);
      if (br(valor).length > MAXIMO.valor) problemas.push(['limite', `valor passa de ${MAXIMO.valor} caracteres`]);
    }
    const marca = [l.marca, l.fabricante].filter((t, i, a) => t && a.findIndex(x => x && x.toLowerCase() === t.toLowerCase()) === i).join(' / ');
    const modelo = l.modelo || '';
    if (marca.length > MAXIMO.marca) problemas.push(['limite', `marca/fabricante tem ${marca.length} caracteres (máximo ${MAXIMO.marca}): "${marca}"`]);
    if (modelo.length > MAXIMO.modelo) problemas.push(['limite', `modelo/versão tem ${modelo.length} caracteres (máximo ${MAXIMO.modelo})`]);
    const qtd = l.quantidade ? String(l.quantidade).replace('.', ',') : '';
    if (qtd.length > MAXIMO.quantidade) problemas.push(['limite', `quantidade passa de ${MAXIMO.quantidade} caracteres`]);
    if (problemas.length) { for (const [tipo, msg] of problemas) alertar(numero, tipo, msg); continue; }

    // 2) Campos fechados: só a seta de expandir (nunca Salvar). Se o termo/declarações não foram aceitos, não abrem.
    if (!campo(cartao, 'input-valor-proposta')) {
      cartao.querySelector('[data-test="btn-expandir-proposta"]')?.click();
      for (let t = 0; t < espera / 100 && !campo(cartao, 'input-valor-proposta'); t++) await esperar(100);
    }
    const iValor = campo(cartao, 'input-valor-proposta');
    if (!iValor) { resultado.camposFechados.push(numero); continue; }
    const iQtd = campo(cartao, 'input-quantidade-ofertada'), iMarca = campo(cartao, 'input-marca-fabricante'), iModelo = campo(cartao, 'input-modelo-versao');
    if (!iQtd || !iMarca || !iModelo) { alertar(numero, 'campos_ausentes', 'o formulário do item não tem todos os campos esperados (quantidade, marca/fabricante, modelo/versão)'); continue; }
    if (iValor.value.trim() && escalar(iValor.value) !== valor) { alertar(numero, 'campo_ja_preenchido', `o campo de valor já tem "${iValor.value}"; não foi alterado`); continue; }

    // 3) Preencher e reler (a máscara do portal pode reformatar).
    if (qtd) escrever(iQtd, qtd.slice(0, limite(iQtd, MAXIMO.quantidade)));
    escrever(iValor, br(valor).slice(0, limite(iValor, MAXIMO.valor)));
    if (marca) escrever(iMarca, marca.slice(0, limite(iMarca, MAXIMO.marca)));
    if (modelo) escrever(iModelo, modelo.slice(0, limite(iModelo, MAXIMO.modelo)));
    if (escalar(iValor.value) !== valor) { alertar(numero, 'mascara', `o portal mostra "${iValor.value}" no valor em vez de R$ ${br(valor)}: corrija esse item na mão`); continue; }
    resultado.preenchidos.push({ item: numero, valor: br(valor), marca: marca || null, modelo: modelo || null, quantidade: qtd || null });
  }
  resultado.foraDaPagina = [...lote.keys()].filter(n => !naPagina.has(n));
  return resultado;
}

// ---------- injetada na aba do LicitaPlena (já logada): lê o lote com a sessão que a própria página guarda ----------
export async function buscarLoteNaPagina(compra, processo) {
  let sessao = null;
  for (let i = 0; i < globalThis.localStorage.length && !sessao?.access_token; i++) {
    const k = globalThis.localStorage.key(i);
    if (!/^sb-[\w-]+-auth-token$/.test(k || '')) continue;
    try { const v = JSON.parse(globalThis.localStorage.getItem(k)); sessao = v?.access_token ? v : v?.currentSession || null; } catch { sessao = null; }
  }
  if (!sessao?.access_token) return { ok: false, status: 401, erro: 'Entre no LicitaPlena nesta janela e tente de novo.' };
  if (sessao.expires_at && sessao.expires_at * 1000 < Date.now()) return { ok: false, status: 401, erro: 'A sessão do LicitaPlena expirou: recarregue a aba do LicitaPlena e tente de novo.' };
  try {
    const q = `compra=${encodeURIComponent(compra)}${processo ? `&processo=${encodeURIComponent(processo)}` : ''}`;
    const r = await fetch(`/api/proposta-lote?${q}`, { headers: { Authorization: `Bearer ${sessao.access_token}` } });
    const corpo = await r.json().catch(() => ({}));
    return { ...corpo, ok: r.ok && corpo.ok === true, status: r.status };
  } catch {
    return { ok: false, status: 0, erro: 'Sem conexão com o LicitaPlena.' };
  }
}

// ---------- texto para o usuário ----------
const ROTULO_ALERTA = { abaixo_do_minimo: 'abaixo do mínimo', acima_do_estimado: 'acima do estimado', valor_invalido: 'valor inválido', limite: 'limite de caracteres', campo_ja_preenchido: 'campo já preenchido', mascara: 'máscara do portal', campos_ausentes: 'campos ausentes' };
export function resumirPreenchimento(r, prog) {
  if (r.status === 'pagina_nao_suportada') return 'Abra a página "Cadastrar propostas" do Compras.gov (cadastro-propostas?compra=...) já logado e clique de novo.';
  if (r.status === 'captcha_pendente') return 'Há um desafio de verificação (captcha) na página. Resolva-o você mesmo e clique de novo.';
  if (r.status === 'sem_itens') return 'Não encontrei a lista de itens. Espere a página carregar e clique de novo.';
  const linhas = [];
  linhas.push(`${r.preenchidos.length} itens preenchidos nesta página — confira e clique Salvar em cada um; depois vá para a próxima página (o portal pede captcha).`);
  if (r.camposFechados.length) linhas.push(`Campos fechados (itens ${r.camposFechados.join(', ')}): aceite você mesmo o termo e as declarações Sim/Não no topo da página, e clique de novo.`);
  if (r.alertas.length) linhas.push('Não preenchidos (confira):', ...r.alertas.map(a => `  Item ${a.item} — ${ROTULO_ALERTA[a.tipo] || a.tipo}: ${a.mensagem}`));
  if (r.jaNoPortal.length) linhas.push(`Já cadastrados no portal (não mexi): ${r.jaNoPortal.join(', ')}.`);
  if (r.foraDoLote.length) linhas.push(`Na página mas fora do seu lote: ${r.foraDoLote.join(', ')}.`);
  if (r.foraDaPagina.length) linhas.push(`No lote mas não nesta página (outras páginas ou ausentes no portal): ${r.foraDaPagina.join(', ')}.`);
  if (prog) linhas.push(`Já preenchidos: ${prog.feitos} de ${prog.total}.`);
  return linhas.join('\n');
}
