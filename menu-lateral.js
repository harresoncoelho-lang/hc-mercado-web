/* global document, window, localStorage -- script de navegador */
// Menu lateral do CRM (sistema.html, operacao.html, processos.html): mesmo comportamento do menu do painel.html.
// Recolher no computador (mesma chave hc_sidebar_colapsada do painel) e gaveta no celular (até 768px), que abre pelo
// botão "Menu" do topo e fecha com Esc, com clique fora e ao escolher um item.
(function () {
  'use strict';
  const nav = document.getElementById('menu-principal');
  if (!nav) return;

  // A nav gruda logo abaixo do topo, que também é sticky: mede a altura real do topo (muda entre larguras).
  const topo = document.querySelector('header');
  function medir() { if (topo) document.documentElement.style.setProperty('--altura-header', topo.offsetHeight + 'px'); }
  medir();
  window.addEventListener('resize', medir);

  const recolher = document.getElementById('nav-colapsar-btn');
  if (recolher) {
    const CHAVE = 'hc_sidebar_colapsada';
    const aplicar = (colapsada) => {
      nav.classList.toggle('colapsada', colapsada);
      recolher.title = colapsada ? 'Expandir menu' : 'Recolher menu';
      recolher.setAttribute('aria-expanded', colapsada ? 'false' : 'true');
      const rotulo = recolher.querySelector('.nav-label');
      if (rotulo) rotulo.textContent = colapsada ? 'Expandir' : 'Recolher';
    };
    let colapsada = false;
    try { colapsada = localStorage.getItem(CHAVE) === '1'; } catch { /* localStorage indisponível */ }
    aplicar(colapsada);
    recolher.addEventListener('click', () => {
      colapsada = !colapsada;
      aplicar(colapsada);
      try { localStorage.setItem(CHAVE, colapsada ? '1' : '0'); } catch { /* segue sem persistir */ }
    });
  }

  const btn = document.getElementById('nav-gaveta-btn');
  const fundo = document.getElementById('nav-gaveta-fundo');
  if (!btn || !fundo) return;
  const celular = window.matchMedia('(max-width: 768px)');
  function definir(aberta) {
    nav.classList.toggle('gaveta-aberta', aberta);
    fundo.hidden = !aberta;
    btn.setAttribute('aria-expanded', aberta ? 'true' : 'false');
    if (aberta) (nav.querySelector('a.ativo') || nav.querySelector('a'))?.focus();
  }
  btn.addEventListener('click', () => definir(!nav.classList.contains('gaveta-aberta')));
  fundo.addEventListener('click', () => definir(false));
  nav.addEventListener('click', (ev) => { if (celular.matches && ev.target.closest('a')) definir(false); });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && nav.classList.contains('gaveta-aberta')) { definir(false); btn.focus(); }
  });
  celular.addEventListener('change', () => definir(false));
})();
