/* global document, window, location, localStorage, navigator, module -- script de navegador (e funções puras testadas no Node) */
// Tela SINAPI (sinapi.html): busca por código ou descrição na tabela sinapi_precos (robô mensal
// scripts/coletar_sinapi.js). Lê direto pelo PostgREST com a sessão do usuário; a RLS (cliente_aprovado) é a barreira.
// "Usar este preço" copia o valor e o guarda no navegador; no item do processo (sistema.html), o formulário oferece
// "Usar no valor unitário" (itens-processo-ui.js lê a mesma chave).
(function () {
  'use strict';
  const CHAVE_SINAPI = 'licitaplena_sinapi_preco';
  const LIMITE = 100;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Mesma normalização do robô (coluna busca): minúsculo, sem acento; só letras/dígitos/espaço, sem curinga do ILIKE.
  const termo = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Texto digitado → { codigo } (só dígitos), { palavras } (até 6, com 2+ letras) ou { erro }.
  function filtroBusca(texto) {
    const t = termo(String(texto || '').slice(0, 200));
    if (/^[0-9]{1,10}$/.test(t)) return { codigo: t };
    const palavras = [...new Set(t.split(' ').filter((p) => p.length >= 2))].slice(0, 6);
    return palavras.length ? { palavras } : { erro: 'Digite o código ou parte da descrição. Ex.: 104658 ou areia media' };
  }
  const reais = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const mesBr = (d) => (/^\d{4}-\d{2}/.test(String(d || '')) ? `${String(d).slice(5, 7)}/${String(d).slice(0, 4)}` : '—');
  function linhaHtml(l, i) {
    return `<tr><td data-rotulo="Código"><b>${esc(l.codigo)}</b>${l.grupo ? `<small>${esc(l.grupo)}</small>` : ''}</td>`
      + `<td data-rotulo="Descrição" class="item">${esc(l.descricao)}${l.origem ? `<small>Origem do preço: ${esc(l.origem)}</small>` : ''}</td>`
      + `<td data-rotulo="Unidade">${esc(l.unidade || '—')}</td><td data-rotulo="Preço">${esc(reais(l.preco))}</td>`
      + `<td data-rotulo="Ação"><button type="button" class="btn" data-usar="${i}">Usar este preço</button></td></tr>`;
  }
  // O que vai para o navegador: só os campos que itens-processo-ui.js valida e mostra.
  const guardado = (l) => JSON.stringify({ codigo: l.codigo, preco: Number(l.preco).toFixed(2), uf: l.uf, referencia: l.referencia, tipo: l.tipo, desonerado: l.desonerado === true });

  if (typeof module !== 'undefined' && module.exports) module.exports = { filtroBusca, linhaHtml, guardado, termo, esc };
  if (typeof document === 'undefined') return;

  const $ = (id) => document.getElementById(id);
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); // eslint-disable-line no-undef -- globais de supabase-config.js
  let linhas = [], carga = 0;
  function aviso(texto, tipo) { const a = $('aviso'); a.textContent = texto || ''; a.className = texto ? `aviso ${tipo || 'info'}` : 'aviso'; }

  async function autenticar() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.replace('login.html?voltar=/sinapi'); return null; }
    const { data: cliente } = await sb.from('clientes').select('status,boletim_filtro').eq('id', session.user.id).maybeSingle();
    if (!cliente || cliente.status !== 'aprovado') { await sb.auth.signOut(); location.replace('login.html?voltar=/sinapi'); return null; }
    return cliente;
  }

  async function buscar() {
    const f = filtroBusca($('f-busca').value);
    if (f.erro) { aviso(f.erro, 'erro'); return; }
    const minha = ++carga;
    $('tabela-corpo').innerHTML = '<tr><td colspan="5" class="vazio">Buscando…</td></tr>';
    let q = sb.from('sinapi_precos').select('uf,tipo,desonerado,codigo,descricao,unidade,grupo,origem,preco,referencia')
      .eq('uf', $('f-uf').value).eq('tipo', $('f-tipo').value).eq('desonerado', $('f-deson').value === 'sim');
    if (f.codigo) q = q.eq('codigo', f.codigo);
    else for (const p of f.palavras) q = q.ilike('busca', `%${p}%`);
    const { data, error } = await q.order('descricao').limit(LIMITE + 1);
    if (minha !== carga) return;
    if (error) { $('tabela-corpo').innerHTML = '<tr><td colspan="5" class="vazio">Sem resultado.</td></tr>'; aviso('Não foi possível consultar o SINAPI agora. Tente de novo.', 'erro'); return; }
    linhas = (data || []).slice(0, LIMITE);
    $('tabela-corpo').innerHTML = linhas.length ? linhas.map(linhaHtml).join('') : '<tr><td colspan="5" class="vazio">Nada encontrado nesta UF e tabela. Confira o código ou tente menos palavras.</td></tr>';
    $('contador').textContent = linhas.length ? `${linhas.length}${data.length > LIMITE ? '+ (refine a busca)' : ''} resultado${linhas.length === 1 ? '' : 's'} · referência ${mesBr(linhas[0].referencia)}` : '';
    aviso('');
  }

  $('form-busca').addEventListener('submit', (ev) => { ev.preventDefault(); void buscar(); });
  $('tabela-corpo').addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-usar]');
    const l = b ? linhas[Number(b.dataset.usar)] : null;
    if (!l) return;
    const valor = Number(l.preco).toFixed(2);
    try { localStorage.setItem(CHAVE_SINAPI, guardado(l)); } catch { /* sem armazenamento: fica só a cópia */ }
    let copiou = false;
    try { await navigator.clipboard.writeText(valor.replace('.', ',')); copiou = true; } catch { /* navegador sem permissão de cópia */ }
    aviso(`${copiou ? 'Valor R$ ' + valor.replace('.', ',') + ' copiado. ' : ''}No processo, abra Editar no item e use "Usar no valor unitário" (ou cole o valor).`, 'info');
  });
  $('btn-tema').addEventListener('click', () => {
    const claro = document.documentElement.classList.toggle('tema-claro');
    document.documentElement.dataset.theme = claro ? 'light' : 'dark';
    try { localStorage.setItem('licitaplena_tema', claro ? 'claro' : 'escuro'); } catch { /* segue sem persistir */ }
  });

  autenticar().then((cliente) => {
    if (!cliente) return;
    const uf = cliente.boletim_filtro?.ufs?.[0];
    if (uf && [...$('f-uf').options].some((o) => o.value === uf)) $('f-uf').value = uf;
    $('f-busca').focus();
  }).catch(() => aviso('Não foi possível validar a sessão. Recarregue a página.', 'erro'));
})();
