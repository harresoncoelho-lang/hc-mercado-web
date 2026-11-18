/* global module, document, location, fetch, setTimeout, URL, URLSearchParams -- script de navegador; module só nos testes em Node */
// Portal do cliente (cliente.html): o cliente da assessoria abre /cliente#t=<token>, confere os itens do
// processo e aprova/recusa item a item. Contrato: netlify/functions/portal-cliente.js (POST /api/portal-cliente,
// acao 'ler' com pagina, acao 'responder' com 1 a 200 respostas, cada uma com a versao do item).
// - Todo texto do servidor entra por textContent; nenhuma montagem de HTML com dado.
// - Dinheiro em BigInt (decimal exato), nunca float: 0,1 × 3 = 0,30.
// - O cliente é leigo e está com pressa: um botão por decisão, "Aprovar todos os pendentes" e um único envio.
(function () {
  'use strict';
  const TOKEN = /^[A-Za-z0-9_-]{43}$/;
  const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;
  const DIA = /^(\d{4})-(\d{2})-(\d{2})$/;
  const MAX_LOTE = 200;
  const MAX_OBS = 1000;

  // Valor decimal exato vindo do JSON (número ou texto) -> { n: BigInt sem vírgula, escala: casas }.
  function decimal(v) {
    if (v === null || v === undefined || typeof v === 'boolean') return null;
    const m = DECIMAL.exec(String(v).trim());
    if (!m) return null;
    const frac = m[3] || '';
    const n = BigInt(m[2] + frac);
    return { n: m[1] ? -n : n, escala: frac.length };
  }

  const DEZ = (k) => 10n ** BigInt(k);

  // quantidade × valor unitário em centavos, arredondando meio centavo para cima (em valor absoluto).
  function totalCentavos(quantidade, valorUnitario) {
    const q = decimal(quantidade);
    const v = decimal(valorUnitario);
    if (!q || !v) return null;
    const produto = q.n * v.n;
    const escala = q.escala + v.escala;
    const neg = produto < 0n;
    const abs = neg ? -produto : produto;
    const c = escala <= 2 ? abs * DEZ(2 - escala) : (abs + DEZ(escala - 2) / 2n) / DEZ(escala - 2);
    return neg ? -c : c;
  }

  const milhar = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  // BigInt com 'escala' casas -> texto pt-BR, sem zeros à direita além de 'minCasas'.
  function textoDecimal(n, escala, minCasas) {
    const neg = n < 0n;
    const dig = (neg ? -n : n).toString().padStart(escala + 1, '0');
    const inteiro = dig.slice(0, dig.length - escala);
    let frac = dig.slice(dig.length - escala).replace(/0+$/, '');
    frac = frac.padEnd(minCasas, '0');
    return (neg ? '-' : '') + milhar(inteiro) + (frac ? ',' + frac : '');
  }

  function formatarCentavos(c) {
    return c === null ? '—' : 'R$ ' + textoDecimal(c, 2, 2);
  }

  function formatarValor(v, moeda) {
    const d = decimal(v);
    if (!d) return '—';
    return (moeda ? 'R$ ' : '') + textoDecimal(d.n, d.escala, moeda ? 2 : 0);
  }

  function linkSeguro(url) {
    if (typeof url !== 'string') return null;
    try {
      const u = new URL(url);
      return u.protocol === 'https:' ? u.href : null;
    } catch {
      return null;
    }
  }

  function tokenDoHash(hash) {
    const t = new URLSearchParams(String(hash || '').replace(/^#/, '')).get('t');
    return t && TOKEN.test(t) ? t : null;
  }

  // Aceita 'AAAA-MM-DD' (só data, sem deslocar o fuso) ou carimbo ISO com hora.
  function formatarData(v, comHora) {
    if (typeof v !== 'string' || !v) return '—';
    const dia = DIA.exec(v);
    if (dia) return `${dia[3]}/${dia[2]}/${dia[1]}`;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '—';
    const opcoes = comHora ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'short' };
    return new Intl.DateTimeFormat('pt-BR', opcoes).format(d);
  }

  function segundosDeEspera(valor) {
    const s = Number.parseInt(valor, 10);
    return Number.isSafeInteger(s) && s >= 1 && s <= 600 ? s : 60;
  }

  // Mensagem para o cliente por status da resposta; 0 = falha de rede.
  function mensagemDeErro(status) {
    if (status === 404) return { texto: 'Este link não é mais válido. Peça um novo link a quem enviou.', tentar: false, fim: true };
    if (status === 409) return { texto: 'Alguns itens mudaram desde que você abriu. Confira de novo.', tentar: false };
    if (status === 429) return { texto: 'Muitas tentativas. Aguarde um minuto.', tentar: true };
    if (status === 503) return { texto: 'Indisponível no momento. Tente de novo em instantes.', tentar: true };
    if (status === 0) return { texto: 'Sem conexão. Confira a internet e toque em Tentar de novo.', tentar: true };
    return { texto: 'Não foi possível concluir. Peça um novo link a quem enviou.', tentar: false, fim: true };
  }

  const lotes = (lista, tamanho) => Array.from({ length: Math.ceil(lista.length / tamanho) }, (_, k) => lista.slice(k * tamanho, (k + 1) * tamanho));

  const api = { decimal, totalCentavos, formatarCentavos, formatarValor, linkSeguro, tokenDoHash, formatarData, segundosDeEspera, mensagemDeErro, lotes, MAX_LOTE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;

  // ===== Página =====
  const $ = (id) => document.getElementById(id);
  const el = (tag, classe, texto) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined && texto !== null) e.textContent = String(texto);
    return e;
  };
  const estado = {
    token: tokenDoHash(location.hash),
    pagina: 1,
    dados: null,
    paginas: new Map(), // pagina -> itens já carregados (para contar e aprovar todos)
    escolhas: new Map(), // item_id -> { decisao, versao }
    observacoes: new Map(), // item_id -> texto
    divergentes: new Set(),
    ocupado: false,
    bloqueadoAte: 0,
  };
  const DECISAO_TEXTO = { aprovado: 'Aprovado', recusado: 'Recusado' };

  async function chamar(corpo) {
    let r;
    try {
      r = await fetch('/api/portal-cliente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: estado.token, ...corpo }),
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
    } catch {
      return { status: 0, dados: null };
    }
    const dados = await r.json().catch(() => null);
    return { status: r.status, dados, espera: segundosDeEspera(r.headers.get('Retry-After')) };
  }

  function mostrarErroPagina(status, espera) {
    const m = mensagemDeErro(status);
    $('carregando').hidden = true;
    $('erro-texto').textContent = m.texto;
    $('erro').hidden = false;
    const botao = $('erro-tentar');
    botao.hidden = !m.tentar;
    if (m.fim) {
      $('conteudo').hidden = true;
      $('barra').hidden = true;
      $('historico').hidden = true;
      $('confirmacao').hidden = true;
    }
    if (status === 429) {
      botao.disabled = true;
      setTimeout(() => { botao.disabled = false; }, espera * 1000);
    }
  }

  async function ler(pagina) {
    $('erro').hidden = true;
    const r = await chamar({ acao: 'ler', pagina });
    if (r.status !== 200 || !r.dados || !Array.isArray(r.dados.itens)) {
      mostrarErroPagina(r.status === 200 ? 503 : r.status, r.espera);
      return false;
    }
    estado.pagina = pagina;
    estado.dados = r.dados;
    estado.paginas.set(pagina, r.dados.itens);
    renderizar();
    return true;
  }

  function preencher(id, valor) {
    $(id).textContent = valor === null || valor === undefined || valor === '' ? '—' : String(valor);
  }

  function renderizarProcesso(d) {
    const p = d.processo || {};
    $('empresa').textContent = d.empresa && d.empresa.razao_social ? d.empresa.razao_social : '';
    preencher('p-numero', p.numero);
    preencher('p-orgao', p.orgao);
    preencher('p-modalidade', p.modalidade);
    $('p-sessao').textContent = formatarData(p.data_sessao, true);
    preencher('p-objeto', p.objeto);
    const edital = $('p-edital');
    const url = linkSeguro(p.url_origem);
    if (url) {
      const a = el('a', 'cl-link', 'Abrir o edital');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      edital.replaceChildren(a);
    } else {
      edital.replaceChildren();
    }
    $('validade').textContent = 'Link válido até ' + formatarData(d.expira_em, true);
  }

  function colunas(itens) {
    const cols = [
      ['Nº', (i) => i.identificador],
      ['Descrição', (i) => i.descricao, 'cl-col-descricao'],
      ['Qtd.', (i) => formatarValor(i.quantidade, false), 'cl-num'],
      ['Unidade', (i) => i.unidade],
      ['Valor unitário', (i) => formatarValor(i.valor_unitario_proposta, true), 'cl-num'],
      ['Total', (i) => formatarCentavos(totalCentavos(i.quantidade, i.valor_unitario_proposta)), 'cl-num cl-total'],
      ['Marca', (i) => i.marca],
      ['Modelo', (i) => i.modelo],
      ['Fabricante', (i) => i.fabricante],
    ];
    // O mínimo só aparece se o link foi criado para mostrá-lo (o servidor manda o campo só nesse caso).
    if (itens.some((i) => Object.hasOwn(i, 'valor_unitario_minimo'))) {
      cols.push(['Preço mínimo', (i) => formatarValor(i.valor_unitario_minimo, true), 'cl-num']);
    }
    return cols;
  }

  function renderizar() {
    const d = estado.dados;
    renderizarProcesso(d);
    const cols = colunas(d.itens);
    const cab = $('cabecalho');
    cab.replaceChildren(...cols.map(([rotulo, , classe]) => {
      const th = el('th', classe, rotulo);
      th.scope = 'col';
      return th;
    }), Object.assign(el('th', 'cl-col-decisao', 'Sua decisão'), { scope: 'col' }));
    $('itens').replaceChildren(...d.itens.map((item) => linhaItem(item, cols)));
    if (!d.itens.length) {
      const td = el('td', 'cl-vazio', 'Este processo ainda não tem itens para aprovar.');
      td.colSpan = cols.length + 1;
      const tr = el('tr');
      tr.append(td);
      $('itens').append(tr);
    }
    renderizarPaginacao(d);
    renderizarHistorico(d.aceites);
    $('carregando').hidden = true;
    $('conteudo').hidden = false;
    $('barra').hidden = false;
    $('historico').hidden = false;
    atualizarProgresso();
  }

  function linhaItem(item, cols) {
    const tr = el('tr');
    tr.id = 'item-' + item.id;
    if (estado.divergentes.has(item.id)) tr.classList.add('cl-mudou');
    for (const [rotulo, valor, classe] of cols) {
      const v = valor(item);
      const td = el('td', classe, v === null || v === undefined || v === '' ? '—' : v);
      td.dataset.rotulo = rotulo;
      tr.append(td);
    }
    const td = el('td', 'cl-col-decisao');
    td.dataset.rotulo = 'Sua decisão';
    td.append(controleDecisao(item));
    tr.append(td);
    return tr;
  }

  function controleDecisao(item) {
    const caixa = el('div', 'cl-decisao');
    const grupo = el('fieldset', 'cl-segmentos');
    grupo.append(el('legend', 'cl-sr', 'Decisão do item ' + (item.identificador || '')));
    for (const [valor, texto] of [['aprovado', 'Aprovar'], ['recusado', 'Recusar']]) {
      const id = `d-${valor}-${item.id}`;
      const input = el('input');
      input.type = 'radio';
      input.name = 'd-' + item.id;
      input.id = id;
      input.value = valor;
      input.checked = estado.escolhas.get(item.id)?.decisao === valor;
      input.addEventListener('change', () => escolher(item, valor));
      const label = el('label', 'cl-seg cl-seg-' + valor, texto);
      label.htmlFor = id;
      grupo.append(input, label);
    }
    caixa.append(grupo, el('p', 'cl-situacao'));
    if (estado.divergentes.has(item.id)) caixa.append(el('p', 'cl-chip cl-chip-atencao', 'Este item mudou. Confira e escolha de novo.'));
    caixa.append(...respostaAnterior(item), ...observacao(item));
    atualizarSituacao(caixa, item);
    return caixa;
  }

  function respostaAnterior(item) {
    const r = item.resposta;
    if (!r || !DECISAO_TEXTO[r.decisao]) return [];
    const p = el('p', 'cl-anterior', `Resposta anterior: ${DECISAO_TEXTO[r.decisao]} em ${formatarData(r.criado_em, true)}`);
    const saida = [p];
    if (r.observacao) saida.push(el('p', 'cl-anterior', 'Observação: ' + r.observacao));
    if (r.versao && r.versao !== item.versao) saida.push(el('p', 'cl-chip cl-chip-atencao', 'O item mudou depois dessa resposta.'));
    return saida;
  }

  function observacao(item) {
    const id = 'obs-' + item.id;
    const botao = el('button', 'cl-obs-botao', 'Adicionar observação');
    botao.type = 'button';
    botao.setAttribute('aria-expanded', 'false');
    botao.setAttribute('aria-controls', 'obs-bloco-' + item.id);
    const bloco = el('div', 'cl-obs');
    bloco.id = 'obs-bloco-' + item.id;
    const label = el('label', null, 'Observação (opcional)');
    label.htmlFor = id;
    const campo = el('textarea');
    campo.id = id;
    campo.rows = 2;
    campo.maxLength = MAX_OBS;
    campo.value = estado.observacoes.get(item.id) || '';
    campo.addEventListener('input', () => estado.observacoes.set(item.id, campo.value));
    bloco.append(label, campo);
    bloco.hidden = !campo.value;
    botao.hidden = !!campo.value;
    botao.addEventListener('click', () => {
      bloco.hidden = false;
      botao.hidden = true;
      botao.setAttribute('aria-expanded', 'true');
      campo.focus();
    });
    return [botao, bloco];
  }

  function atualizarSituacao(caixa, item) {
    const s = caixa.querySelector('.cl-situacao');
    const escolha = estado.escolhas.get(item.id);
    const anterior = item.resposta && DECISAO_TEXTO[item.resposta.decisao];
    if (escolha) {
      s.className = 'cl-situacao cl-chip cl-chip-info';
      s.textContent = (escolha.decisao === 'aprovado' ? 'Vai aprovar' : 'Vai recusar') + ' · falta enviar';
    } else if (anterior) {
      s.className = 'cl-situacao cl-chip ' + (item.resposta.decisao === 'aprovado' ? 'cl-chip-ok' : 'cl-chip-erro');
      s.textContent = 'Respondido: ' + anterior;
    } else {
      s.className = 'cl-situacao cl-chip cl-chip-atencao';
      s.textContent = 'Pendente';
    }
  }

  function escolher(item, decisao) {
    estado.escolhas.set(item.id, { decisao, versao: item.versao });
    estado.divergentes.delete(item.id);
    const tr = $('item-' + item.id);
    if (tr) {
      tr.classList.remove('cl-mudou');
      tr.querySelector('.cl-chip-atencao:not(.cl-situacao)')?.remove();
      atualizarSituacao(tr.querySelector('.cl-decisao'), item);
    }
    $('barra-msg').textContent = '';
    atualizarProgresso();
  }

  function todosCarregados() {
    return [...estado.paginas.values()].flat();
  }

  function atualizarProgresso() {
    const total = Number(estado.dados?.total_itens) || 0;
    const respondidos = todosCarregados().filter((i) => estado.escolhas.has(i.id) || (i.resposta && DECISAO_TEXTO[i.resposta.decisao])).length;
    const n = estado.escolhas.size;
    $('progresso').textContent = `${respondidos} de ${total} respondidos` + (n ? ` · ${n} para enviar` : '');
    $('enviar').textContent = n ? `Enviar ${n} ${n === 1 ? 'resposta' : 'respostas'}` : 'Enviar respostas';
    $('enviar').disabled = estado.ocupado || Date.now() < estado.bloqueadoAte;
    $('aprovar-todos').disabled = estado.ocupado;
  }

  function aprovarTodos() {
    const pendentes = todosCarregados().filter((i) => !estado.escolhas.has(i.id) && !(i.resposta && DECISAO_TEXTO[i.resposta.decisao]));
    for (const item of pendentes) estado.escolhas.set(item.id, { decisao: 'aprovado', versao: item.versao });
    for (const item of pendentes) estado.divergentes.delete(item.id);
    if (estado.dados) renderizar();
    $('barra-msg').textContent = pendentes.length
      ? `${pendentes.length} ${pendentes.length === 1 ? 'item marcado' : 'itens marcados'} como Aprovar. Confira e toque em Enviar.`
      : 'Não há itens pendentes.';
  }

  function validarEnvio() {
    const semDecisao = [...estado.observacoes].find(([id, texto]) => texto.trim() && !estado.escolhas.has(id));
    if (semDecisao) {
      const item = todosCarregados().find((i) => i.id === semDecisao[0]);
      return { texto: `O item ${item?.identificador || ''} tem observação, mas falta escolher Aprovar ou Recusar.`, foco: 'd-aprovado-' + semDecisao[0] };
    }
    if (!estado.escolhas.size) {
      const pendente = todosCarregados().find((i) => !(i.resposta && DECISAO_TEXTO[i.resposta.decisao]));
      return { texto: 'Escolha Aprovar ou Recusar em pelo menos um item.', foco: pendente ? 'd-aprovado-' + pendente.id : null };
    }
    return null;
  }

  function bloquear(segundos) {
    estado.bloqueadoAte = Date.now() + segundos * 1000;
    setTimeout(() => {
      $('barra-msg').textContent = 'Pode enviar de novo.';
      atualizarProgresso();
    }, segundos * 1000 + 50);
  }

  async function enviar() {
    if (estado.ocupado || Date.now() < estado.bloqueadoAte) return;
    const msg = $('barra-msg');
    const invalido = validarEnvio();
    if (invalido) {
      msg.textContent = invalido.texto;
      if (invalido.foco) $(invalido.foco)?.focus();
      return;
    }
    const respostas = [...estado.escolhas].map(([item_id, e]) => {
      const obs = (estado.observacoes.get(item_id) || '').trim();
      return obs ? { item_id, decisao: e.decisao, versao: e.versao, observacao: obs } : { item_id, decisao: e.decisao, versao: e.versao };
    });
    estado.ocupado = true;
    atualizarProgresso();
    $('enviar').textContent = 'Enviando…';
    msg.textContent = '';
    let enviadas = 0;
    try {
      for (const lote of lotes(respostas, MAX_LOTE)) {
        const r = await chamar({ acao: 'responder', respostas: lote });
        if (r.status !== 200 || !r.dados?.ok) {
          await tratarFalhaEnvio(r, enviadas);
          return;
        }
        for (const resp of lote) {
          estado.escolhas.delete(resp.item_id);
          estado.observacoes.delete(resp.item_id);
        }
        enviadas += lote.length;
      }
    } finally {
      estado.ocupado = false;
      atualizarProgresso();
    }
    await concluirEnvio(enviadas);
  }

  async function tratarFalhaEnvio(r, enviadas) {
    const m = mensagemDeErro(r.status);
    const parcial = enviadas ? ` ${enviadas} já foram enviadas.` : '';
    if (m.fim) {
      mostrarErroPagina(r.status);
      return;
    }
    if (r.status === 409) {
      const ids = Array.isArray(r.dados?.divergentes) ? r.dados.divergentes.map(String) : [];
      for (const id of ids) {
        estado.divergentes.add(id);
        estado.escolhas.delete(id);
      }
      estado.paginas.clear();
      await ler(estado.pagina);
      $('aviso-mudou-texto').textContent = `${m.texto} ${ids.length === 1 ? '1 item está marcado' : ids.length + ' itens estão marcados'} com "Este item mudou".${parcial}`;
      $('aviso-mudou').hidden = false;
      $('barra-msg').textContent = m.texto;
      document.querySelector('.cl-mudou')?.scrollIntoView({ block: 'center' });
      return;
    }
    if (r.status === 429) bloquear(r.espera);
    $('barra-msg').textContent = m.texto + parcial;
  }

  async function concluirEnvio(enviadas) {
    estado.paginas.clear();
    $('aviso-mudou').hidden = true;
    await ler(estado.pagina);
    $('conteudo').hidden = true;
    $('barra').hidden = true;
    $('confirmacao-texto').textContent = `Recebemos ${enviadas} ${enviadas === 1 ? 'resposta' : 'respostas'}. Quem enviou o link já pode ver. Se mudar de ideia, volte aos itens e responda de novo.`;
    $('confirmacao').hidden = false;
    $('confirmacao-titulo').focus();
  }

  function renderizarPaginacao(d) {
    const total = Number(d.total_itens) || 0;
    const por = Number(d.por_pagina) || MAX_LOTE;
    const paginas = Math.max(1, Math.ceil(total / por));
    const inicio = total ? (estado.pagina - 1) * por + 1 : 0;
    const fim = Math.min(total, estado.pagina * por);
    $('paginacao-texto').textContent = paginas > 1 ? `Itens ${inicio} a ${fim} de ${total}` : `${total} ${total === 1 ? 'item' : 'itens'}`;
    $('paginas').hidden = paginas <= 1;
    $('pag-atual').textContent = `Página ${estado.pagina} de ${paginas}`;
    $('pag-anterior').disabled = estado.pagina <= 1;
    $('pag-proxima').disabled = estado.pagina >= paginas;
  }

  function renderizarHistorico(aceites) {
    const lista = Array.isArray(aceites) ? aceites : [];
    $('historico-vazio').hidden = lista.length > 0;
    $('historico-lista').replaceChildren(...lista.map((a) => {
      const li = el('li', 'cl-historico-item');
      li.append(
        el('span', 'cl-meta', formatarData(a.criado_em, true)),
        el('span', 'cl-historico-nome', 'Item ' + (a.identificador || '—')),
        el('span', 'cl-chip ' + (a.decisao === 'aprovado' ? 'cl-chip-ok' : 'cl-chip-erro'), DECISAO_TEXTO[a.decisao] || '—'),
      );
      if (a.observacao) li.append(el('span', 'cl-historico-obs', a.observacao));
      return li;
    }));
  }

  function iniciar() {
    $('erro-tentar').addEventListener('click', () => ler(estado.pagina));
    $('aprovar-todos').addEventListener('click', aprovarTodos);
    $('enviar').addEventListener('click', enviar);
    $('pag-anterior').addEventListener('click', () => ler(estado.pagina - 1));
    $('pag-proxima').addEventListener('click', () => ler(estado.pagina + 1));
    $('voltar-itens').addEventListener('click', () => {
      $('confirmacao').hidden = true;
      $('conteudo').hidden = false;
      $('barra').hidden = false;
      $('itens-titulo').scrollIntoView();
    });
    if (!estado.token) {
      $('carregando').hidden = true;
      $('erro-texto').textContent = 'Link inválido ou expirado. Peça um novo link a quem enviou.';
      $('erro').hidden = false;
      return;
    }
    ler(1);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
