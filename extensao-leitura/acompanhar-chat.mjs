// Modo "Acompanhar chat": alerta quando o pregoeiro escreve no pregão que o usuário JÁ tem aberto na aba.
// Injetado por clique do usuário (popup → "Acompanhar este pregão"). Só observa o DOM que a própria página
// atualiza (MutationObserver): não faz requisição, não recarrega, não navega, não clica, não lê nem reaproveita
// token de captcha. Avisa o service worker (acompanhar-worker.mjs) por chrome.runtime.sendMessage, que mostra a
// notificação e o badge. As funções exportadas são autocontidas (executeScript serializa só o corpo).
// Seletores do chat = os da página pública "Acompanhar contratação" (mapa de 19/11); a sala de disputa do
// fornecedor logado NÃO foi mapeada: se usar outras classes, nada é detectado (ver README).

export function vigiarChat(entrada) {
  const g = globalThis;
  const HOST = 'cnetmobile.estaleiro.serpro.gov.br';
  const JANELA_MS = 30 * 60e3; // mensagem mais velha que isto, ao aparecer, é histórico aberto pelo usuário, não alerta
  const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const semCpf = s => s.replace(/\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s/]?\d{2}\b/g, '***.***.***-**');
  const limpo = s => String(s || '').replace(/\s+/g, ' ').trim();
  const TERMOS = [['convocação', /convoca/], ['anexo', /anex/], ['prazo', /prazo/], ['recusa', /recus/], ['desclassificação', /desclassific/],
    ['inabilitação', /inabilit/], ['diligência', /diligenc/], ['habilitação', /(?<!in)habilita/], ['suspensão', /suspen[sd]/], ['aceite', /aceit/]];
  const cnpj = String(entrada?.empresaCnpj || '').replace(/\D/g, '');
  const nome = semAcento(entrada?.empresaNome).replace(/[^\p{L}\p{N} ]/gu, '');

  // Página aceita (mesma regra do leitor) → chave da compra; null se não suportada.
  const chaveDe = href => {
    let u;
    try { u = new URL(href); } catch { return null; }
    if (u.protocol !== 'https:' || u.hostname !== HOST || u.username) return null;
    const pub = /^\/comprasnet-web\/public\/compras\/acompanhamento-compra(\/item\/\d{1,5})?$/.test(u.pathname);
    const seg = /^\/comprasnet-web\/seguro\/fornecedor\/[\w/-]+$/.test(u.pathname) && !/login/i.test(u.pathname);
    const c = u.searchParams.getAll('compra');
    if ((!pub && !seg) || c.length > 1 || (c[0] && !/^\d{17}$/.test(c[0])) || (pub && c.length !== 1)) return null;
    return `${pub ? 'p' : 's'}:${c[0] || u.pathname}`;
  };
  const chave = chaveDe(g.location.href);
  // Reconexão só na MESMA compra/página: se a aba foi para outra, não segue acompanhando sozinho.
  if (!chave || (entrada?.chave && entrada.chave !== chave)) return { status: 'pagina_nao_suportada' };
  const anterior = g.__lpAcompanhar;
  const vistas = anterior?.chave === chave ? anterior.vistas : new Set();
  anterior?.parar('voce', false);

  const dataHora = s => {
    const m = /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/.exec(s || '');
    return m ? { iso: `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00`, hora: `${m[4]}:${m[5]}` } : null;
  };
  // Reconexão depois de recarregar (acompanhar-worker.mjs): mensagens desde a queda alertam mesmo na 1ª leitura.
  const desde = Number.isFinite(entrada?.desde) ? entrada.desde - 60e3 : null;
  let parou = false, pronto = false, naoLidas = 0, timer = null, tick = null;
  const enviar = msg => {
    try { g.chrome.runtime.sendMessage({ ...msg, compra: chave, som: !!entrada?.som, gravar: !!entrada?.gravar })?.catch?.(() => {}); return true; } catch { return false; }
  };

  const classificar = texto => {
    const s = semAcento(texto);
    const motivos = TERMOS.filter(([, re]) => re.test(s)).map(([n]) => n);
    const cita = (cnpj.length === 14 && new RegExp(`(?<!\\d)${cnpj}(?!\\d)`).test(texto.replace(/[.\-/]/g, '')))
      || (nome.length >= 5 && s.replace(/[^\p{L}\p{N} ]/gu, '').includes(nome));
    return { motivos, cita, primeiro: Math.min(...TERMOS.map(([, re]) => { const i = s.search(re); return i < 0 ? Infinity : i; })) };
  };

  const varrer = () => {
    if (parou) return;
    const novas = [];
    for (const t of g.document.querySelectorAll('.mensagens-texto')) {
      const caixa = t.parentElement;
      const texto = limpo(t.textContent);
      if (!texto) continue;
      const dh = dataHora(caixa?.querySelector('.mensagens-data')?.textContent);
      const k = `${dh?.iso || ''}|${semAcento(texto)}`;
      if (vistas.has(k)) continue;
      vistas.add(k);
      const horario = dh ? g.Date.parse(`${dh.iso}-03:00`) : NaN;
      if (!pronto && !(desde !== null && horario >= desde)) continue; // leitura inicial: só marca o que já estava na tela
      if (/(^|\s)(participante|fornecedor)(\s|$)|mensagens-(participante|fornecedor)/.test(caixa?.className || '')) continue; // não é do pregoeiro
      if (dh && g.Date.now() - horario > JANELA_MS) continue; // histórico aberto agora
      const c = classificar(texto);
      const ini = Number.isFinite(c.primeiro) ? Math.max(0, c.primeiro - 60) : 0;
      novas.push({ trecho: semCpf(texto.slice(ini, ini + 200)), hora: dh?.hora || null, motivos: c.motivos, citaEmpresa: c.cita, importante: c.cita || c.motivos.length > 0 });
    }
    if (!novas.length) return;
    if (g.document.hidden) naoLidas += novas.length;
    if (entrada?.som && novas.some(n => n.importante)) bipe();
    if (!enviar({ tipo: 'mensagens', itens: novas, naoLidas })) parar('extensao', false);
  };
  // Bipe na própria aba: toca mesmo com o som de notificação do Windows desligado. Sem áudio liberado, fica só a notificação.
  const bipe = () => {
    try {
      const ctx = new g.AudioContext();
      const o = ctx.createOscillator(), v = ctx.createGain();
      o.frequency.value = 880; v.gain.value = 0.15;
      o.connect(v); v.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.4);
      o.onended = () => ctx.close();
    } catch { /* sem AudioContext ou autoplay bloqueado */ }
  };
  const agendar = () => { if (!timer) timer = g.setTimeout(() => { timer = null; varrer(); }, 300); };

  const observer = new g.MutationObserver(agendar);
  const aoVoltar = () => { if (!g.document.hidden && naoLidas) { naoLidas = 0; enviar({ tipo: 'visto' }); } };
  const aoSair = () => parar('recarregou'); // pagehide: recarregou, navegou ou fechou; o worker tenta voltar
  function parar(motivo, avisar = true) {
    if (parou) return;
    parou = true;
    observer.disconnect();
    g.clearInterval(tick);
    g.clearTimeout(timer);
    g.removeEventListener('pagehide', aoSair);
    g.document.removeEventListener('visibilitychange', aoVoltar);
    if (g.__lpAcompanhar?.parar === parar) delete g.__lpAcompanhar;
    if (avisar) enviar({ tipo: 'parou', motivo });
  }
  // Saída de rota, logout, sessão encerrada: o Angular troca a rota sem recarregar, então confere a URL a cada 3 s.
  const conferir = () => {
    if (chaveDe(g.location.href) !== chave) return parar('saiu');
    if (/sess[aã]o\s+(expirou|expirada|encerrada)/i.test(String(g.document.body?.innerText || '').slice(0, 20000))) return parar('sessao');
  };

  g.__lpAcompanhar = { chave, vistas, parar };
  varrer();
  pronto = true;
  observer.observe(g.document.body, { childList: true, subtree: true, characterData: true });
  tick = g.setInterval(conferir, 3000);
  g.addEventListener('pagehide', aoSair);
  g.document.addEventListener('visibilitychange', aoVoltar);
  enviar({ tipo: 'iniciou', empresaCnpj: cnpj, empresaNome: String(entrada?.empresaNome || '').slice(0, 120), jaNaTela: vistas.size });
  return { status: 'iniciado', jaNaTela: vistas.size };
}

// Parar a pedido do usuário (botão do popup).
export function pararChat() {
  const a = globalThis.__lpAcompanhar;
  if (!a) return { status: 'nao_estava' };
  a.parar('voce');
  return { status: 'parado' };
}
