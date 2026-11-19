/* global document, window, location, localStorage, fetch, URLSearchParams, module -- script de navegador (e funções puras testadas no Node) */
// Tela Prospecção (prospeccao.html): o que o órgão vai comprar antes do edital. Lê /api/prospeccao, uma aba por
// vez (cada aba = uma subrequisição), e pré-preenche UF e palavras com o filtro salvo do boletim
// (clientes.boletim_filtro, o mesmo que painel.html grava).
(function () {
  'use strict';
  const ABAS = {
    pca: { titulo: 'Planos de contratação', data: 'Data prevista', vazio: 'Nenhum item de PCA/PGC com data prevista no período.' },
    irp: { titulo: 'IRP abertas', data: 'Prazo para participar', vazio: 'Nenhuma Intenção de Registro de Preço aberta com esse filtro. O módulo de IRP do PNCP é de 31/08/2026 e ainda tem poucas IRPs.' },
    ata: { titulo: 'Atas para adesão', data: 'Vigente até', vazio: 'Nenhuma ata vigente que permita adesão com esse filtro.' },
    contrato: { titulo: 'Contratos vencendo', data: 'Vence em', vazio: 'Nenhum contrato vencendo no período com esse filtro.' },
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const moeda = (v) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  const qtd = (v) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
  const dataBr = (d) => (/^\d{4}-\d{2}-\d{2}/.test(String(d || '')) ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');
  // Dias corridos de hoje (Brasília) até a data; negativo = já passou.
  function diasAte(d, agora = Date.now()) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(d || ''))) return null;
    const hoje = new Date(agora - 3 * 36e5).toISOString().slice(0, 10);
    return Math.round((Date.parse(String(d).slice(0, 10)) - Date.parse(hoje)) / 864e5);
  }
  // Só link oficial (o robô e o banco já restringem; aqui é a última barreira antes do href).
  const linkOficial = (u) => (/^https:\/\/(pncp\.gov\.br|dadosabertos\.compras\.gov\.br|contratos\.comprasnet\.gov\.br)\//.test(String(u || '')) ? String(u) : null);

  function celulaData(l, agora) {
    const n = diasAte(l.data_ref, agora);
    const urg = n !== null && n <= 30 ? ' urgente' : '';
    return `<td data-rotulo="${esc(ABAS[l.tipo].data)}"><b>${esc(dataBr(l.data_ref))}</b>${n === null ? '' : `<small class="dias${urg}">${n === 0 ? 'hoje' : `em ${n} dia${n === 1 ? '' : 's'}`}</small>`}</td>`;
  }
  function celulaItem(l) {
    const principal = l.descricao || l.objeto || '—';
    const extra = l.descricao && l.objeto && l.objeto !== l.descricao ? `<small>${esc(l.objeto)}</small>` : '';
    return `<td data-rotulo="Item / objeto" class="item">${esc(principal)}${extra}${l.catmat ? `<small>Catálogo ${esc(l.catmat)}</small>` : ''}</td>`;
  }
  function celulaValores(l) {
    if (l.tipo === 'ata') {
      const saldo = l.saldo === null || l.saldo === undefined ? 'saldo não informado' : `saldo ${qtd(l.saldo)} de ${qtd(l.quantidade)}`;
      const adesao = l.maximo_adesao ? ` · adesão até ${qtd(l.maximo_adesao)}` : '';
      return `<td data-rotulo="Preço / saldo">${l.valor_unitario ? `${moeda(l.valor_unitario)} un.` : moeda(l.valor_total)}<small>${esc(l.fonte === 'comprasgov_arp' ? saldo + adesao : 'itens na ata do PNCP')}</small></td>`;
    }
    if (l.tipo === 'contrato') return `<td data-rotulo="Valor global">${moeda(l.valor_total)}</td>`;
    return `<td data-rotulo="Quantidade / valor">${qtd(l.quantidade)} × ${moeda(l.valor_unitario)}<small>total ${moeda(l.valor_total)}</small></td>`;
  }
  function linhaHtml(l, agora = Date.now()) {
    const link = linkOficial(l.link);
    const fornecedor = l.tipo === 'ata' || l.tipo === 'contrato'
      ? `<td data-rotulo="Fornecedor">${esc(l.fornecedor_nome || '—')}${l.fornecedor_cnpj ? `<small>${esc(l.fornecedor_cnpj)}</small>` : ''}</td>` : '';
    const fonte = { pgc: 'PGC (Compras.gov)', comprasgov_arp: 'Compras.gov ARP' }[l.fonte] || (l.plataforma ? `PNCP · ${l.plataforma}` : 'PNCP');
    return `<tr>${celulaData(l, agora)}<td data-rotulo="Órgão">${esc(l.orgao_nome || '—')}<small>${esc([l.unidade_nome, l.municipio, l.uf].filter(Boolean).join(' · '))}</small></td>`
      + `${celulaItem(l)}${fornecedor}${celulaValores(l)}`
      + `<td data-rotulo="Fonte">${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Ver no ${l.fonte === 'pncp' || /pncp\.gov\.br/.test(link) ? 'PNCP' : 'portal'}</a>` : '—'}<small>${esc(fonte)}</small></td></tr>`;
  }
  function cabecalhoHtml(tipo) {
    const fornecedor = tipo === 'ata' || tipo === 'contrato' ? '<th>Fornecedor</th>' : '';
    const valores = { ata: 'Preço / saldo', contrato: 'Valor global' }[tipo] || 'Quantidade / valor';
    return `<tr><th>${esc(ABAS[tipo].data)}</th><th>Órgão</th><th>Item / objeto</th>${fornecedor}<th>${valores}</th><th>Fonte oficial</th></tr>`;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { diasAte, linhaHtml, cabecalhoHtml, linkOficial, esc };
  if (typeof document === 'undefined') return;

  const $ = (id) => document.getElementById(id);
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); // eslint-disable-line no-undef -- globais de supabase-config.js
  let abaAtual = 'pca';
  const cache = new Map();

  function aviso(texto, tipo) { const a = $('aviso'); a.textContent = texto || ''; a.className = texto ? `aviso ${tipo || 'info'}` : 'aviso'; }
  function filtros() {
    return { uf: $('f-uf').value, palavras: $('f-palavras').value.trim(), catmat: $('f-catmat').value.trim(), dias: $('f-dias').value };
  }

  async function autenticar() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.replace('login.html?voltar=/prospeccao'); return null; }
    const { data: cliente } = await sb.from('clientes').select('status,boletim_filtro').eq('id', session.user.id).maybeSingle();
    if (!cliente || cliente.status !== 'aprovado') { await sb.auth.signOut(); location.replace('login.html?voltar=/prospeccao'); return null; }
    return cliente;
  }

  async function carregar(tipo) {
    abaAtual = tipo;
    document.querySelectorAll('.aba').forEach((b) => { const ativa = b.dataset.aba === tipo; b.classList.toggle('ativa', ativa); b.setAttribute('aria-selected', ativa ? 'true' : 'false'); });
    $('tabela-cabecalho').innerHTML = cabecalhoHtml(tipo);
    $('tabela-corpo').innerHTML = '<tr><td colspan="6" class="vazio">Carregando…</td></tr>';
    const f = filtros();
    const q = new URLSearchParams({ tipo, dias: f.dias });
    if (f.uf) q.set('uf', f.uf);
    if (f.palavras) q.set('palavras', f.palavras);
    if (f.catmat) q.set('catmat', f.catmat);
    const chave = q.toString();
    try {
      let dados = cache.get(chave);
      if (!dados) {
        const { data: { session } } = await sb.auth.getSession();
        if (!session?.access_token) throw new Error('Sessão expirada. Entre novamente.');
        const r = await fetch(`/api/prospeccao?${chave}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
        dados = await r.json();
        if (!r.ok) throw new Error(dados.erro || 'Consulta indisponível.');
        cache.set(chave, dados);
      }
      if (abaAtual !== tipo) return;
      const linhas = dados.linhas || [];
      $('tabela-corpo').innerHTML = linhas.length ? linhas.map((l) => linhaHtml(l)).join('') : `<tr><td colspan="6" class="vazio">${esc(ABAS[tipo].vazio)}</td></tr>`;
      $('contador').textContent = linhas.length
        ? `${linhas.length}${dados.truncado ? '+ (mostrando os primeiros ' + dados.limite + '; refine o filtro)' : ''} resultado${linhas.length === 1 ? '' : 's'} · coletado em ${dataBr(dados.coletadoEm)}`
        : '';
      aviso('');
    } catch (e) {
      if (abaAtual !== tipo) return;
      $('tabela-corpo').innerHTML = '<tr><td colspan="6" class="vazio">Sem resultado.</td></tr>';
      $('contador').textContent = '';
      aviso(e.message || 'Não foi possível consultar.', 'erro');
    }
  }

  document.querySelectorAll('.aba').forEach((b) => b.addEventListener('click', () => carregar(b.dataset.aba)));
  $('form-filtros').addEventListener('submit', (ev) => { ev.preventDefault(); carregar(abaAtual); });
  $('btn-tema').addEventListener('click', () => {
    const claro = document.documentElement.classList.toggle('tema-claro');
    document.documentElement.dataset.theme = claro ? 'light' : 'dark';
    try { localStorage.setItem('licitaplena_tema', claro ? 'claro' : 'escuro'); } catch { /* segue sem persistir */ }
  });

  autenticar().then((cliente) => {
    if (!cliente) return;
    const filtro = cliente.boletim_filtro;
    if (filtro && Array.isArray(filtro.ufs) && filtro.ufs[0]) $('f-uf').value = filtro.ufs[0];
    if (filtro && filtro.palavrasRaw) {
      $('f-palavras').value = filtro.palavrasRaw.slice(0, 300);
      $('origem-filtro').textContent = 'UF e palavras vieram do filtro do seu boletim. Ajuste à vontade.';
    }
    carregar('pca');
  }).catch(() => aviso('Não foi possível validar a sessão. Recarregue a página.', 'erro'));
})();
