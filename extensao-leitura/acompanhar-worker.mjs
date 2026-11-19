// Service worker do modo "Acompanhar chat". Só reage a mensagens do script injetado na aba (chrome.runtime.onMessage):
// mostra a notificação, põe o badge e, se o usuário ligou "gravar", lê a página e envia pela aba do LicitaPlena.
// Não faz requisição: o único envio é o enviarNaPagina, executado NA aba do LicitaPlena (mesma regra do modo "Gravar
// pregão"). Reconexão: se a aba acompanhada recarregar (o portal pede isso no dia da sessão), espera a página terminar
// de carregar e injeta o vigia de novo, sem navegar nem recarregar nada. Precisa da permissão opcional do portal (pedida
// no clique "Acompanhar"); sem ela, avisa "parei" como antes. Estado por aba em chrome.storage.session (o service worker
// do MV3 dorme depois de 30 s; storage.session some quando o navegador fecha). Ver README.
import { vigiarChat } from './acompanhar-chat.mjs';
import { PORTAL, origensLicitaPlena } from './diagnostico.mjs';
import { enviarNaPagina, lerPaginaPregao } from './pregao-leitor.mjs';

const PREFIXO = 'lp-chat';
const ENTRE_GRAVACOES_MS = 30e3;
const PAROU = {
  saiu: 'A aba saiu da página do pregão (ou foi recarregada/fechada).',
  sessao: 'O portal mostrou que a sessão acabou (deslogou ou caiu).',
  recarregou: 'A aba recarregou ou saiu da página do pregão e não consegui voltar a acompanhar. Abra o pregão e clique "Acompanhar" de novo.',
  fechou: 'A aba do pregão foi fechada.',
  extensao: 'A extensão foi recarregada.',
};

export function textoAlerta(itens) {
  const imp = itens.filter(i => i.importante);
  const foco = imp[0] || itens[0];
  const motivos = [...new Set(imp.flatMap(i => [...(i.citaEmpresa ? ['cita sua empresa'] : []), ...i.motivos]))];
  return {
    title: imp.length ? `IMPORTANTE — pregoeiro: ${motivos.join(', ')}` : 'Pregoeiro escreveu no chat',
    message: `${foco.hora ? `${foco.hora} — ` : ''}${foco.trecho}`.slice(0, 300),
    contextMessage: itens.length > 1 ? `${itens.length} mensagens novas` : undefined,
    importante: imp.length > 0,
  };
}

const RECONECTAR_MAX = 5; // recargas em 10 min; depois disso, para e avisa (portal em loop)
const JANELA_RECARGAS_MS = 10 * 60e3;

export function criarWorkerAcompanhar(chrome) {
  const falhouGravar = new Set();
  const sessao = chrome.storage?.session;
  const chaveAba = tabId => `lp-acompanhar:${tabId}`;
  const lerAba = async tabId => (sessao ? (await sessao.get(chaveAba(tabId)))[chaveAba(tabId)] : null) || null;
  const guardarAba = (tabId, v) => sessao?.set({ [chaveAba(tabId)]: v });
  const esquecerAba = tabId => sessao?.remove(chaveAba(tabId));
  const ultimaGravacao = new Map();
  const badge = (tabId, text, color) => {
    chrome.action.setBadgeText({ tabId, text });
    if (color) chrome.action.setBadgeBackgroundColor({ tabId, color });
  };
  const avisar = (tabId, opts) => chrome.notifications.create(`${PREFIXO}:${tabId}:${Date.now()}`, {
    type: 'basic', iconUrl: 'icone.png', priority: 2, ...opts,
  });

  async function gravar(tabId) {
    const agora = Date.now();
    if (agora - (ultimaGravacao.get(tabId) || 0) < ENTRE_GRAVACOES_MS) return;
    ultimaGravacao.set(tabId, agora);
    const falha = motivo => {
      if (falhouGravar.has(tabId)) return;
      falhouGravar.add(tabId);
      avisar(tabId, { title: 'Não gravei no LicitaPlena', message: motivo, silent: true });
    };
    try {
      const exec = async (alvo, func, args = []) => (await chrome.scripting.executeScript({ target: { tabId: alvo, frameIds: [0] }, func, args }))?.[0]?.result;
      const leitura = await exec(tabId, lerPaginaPregao);
      if (leitura?.status !== 'ok') return falha('Só a página pública "Acompanhar contratação" pode ser gravada; a sala de disputa não.');
      const [lp] = await chrome.tabs.query({ url: origensLicitaPlena(chrome.runtime.getManifest()) });
      if (!lp) return falha('Abra o LicitaPlena (logado) em outra aba.');
      const pregao = { ...leitura }; delete pregao.status; delete pregao.pendentes;
      const r = await exec(lp.id, enviarNaPagina, [pregao]);
      if (!r?.ok) falha(r?.erro || 'O LicitaPlena não aceitou a gravação.');
    } catch { falha('Falha ao ler ou enviar. O alerta continua funcionando.'); }
  }

  chrome.runtime.onMessage.addListener((m, remetente) => {
    const tabId = remetente?.tab?.id;
    if (remetente?.id !== chrome.runtime.id || tabId === undefined || !m || typeof m !== 'object') return;
    if (m.tipo === 'iniciou') {
      falhouGravar.delete(tabId); badge(tabId, 'ON', '#188038');
      void lerAba(tabId).then(a => {
        const reconexao = a?.recarregando;
        guardarAba(tabId, { compra: m.compra, som: !!m.som, gravar: !!m.gravar, empresaCnpj: m.empresaCnpj || '', empresaNome: m.empresaNome || '', recargas: a?.recargas || 0, ultimaRecarga: a?.ultimaRecarga || 0 });
        if (reconexao && !m.jaNaTela) avisar(tabId, { title: 'Voltei a acompanhar, mas não vejo o chat', message: 'A página recarregou e o chat fechou. Abra de novo o chat do fornecedor/item na página.', requireInteraction: true, silent: !m.som });
      });
    }
    else if (m.tipo === 'visto') badge(tabId, 'ON', '#188038');
    else if (m.tipo === 'mensagens' && Array.isArray(m.itens) && m.itens.length) {
      const { importante, ...texto } = textoAlerta(m.itens);
      badge(tabId, String(Math.min(m.naoLidas || m.itens.length, 99)), importante ? '#d93025' : '#2255e0');
      avisar(tabId, { ...texto, silent: !m.som, requireInteraction: importante });
      if (m.gravar) void gravar(tabId);
    } else if (m.tipo === 'parou') {
      if (m.motivo === 'voce') { badge(tabId, ''); void esquecerAba(tabId); return; }
      if (m.motivo === 'recarregou') { void marcarRecarga(tabId, m); return; }
      parou(tabId, m.motivo, m.som);
    }
  });
  const parou = (tabId, motivo, som) => {
    void esquecerAba(tabId);
    badge(tabId, 'OFF', '#5f6368');
    avisar(tabId, { title: 'Parei de acompanhar este pregão', message: PAROU[motivo] || 'O acompanhamento terminou.', requireInteraction: true, silent: !som });
  };
  async function marcarRecarga(tabId, m) {
    const a = await lerAba(tabId);
    const agora = Date.now();
    const recargas = a && agora - a.ultimaRecarga < JANELA_RECARGAS_MS ? a.recargas : 0;
    const pode = a && recargas < RECONECTAR_MAX && await chrome.permissions?.contains?.({ origins: [PORTAL] });
    if (!pode) return parou(tabId, 'recarregou', m.som);
    badge(tabId, '…', '#f29900');
    await guardarAba(tabId, { ...a, recarregando: agora, ultimaRecarga: agora, recargas: recargas + 1 });
  }
  // Fim do carregamento da aba que estava sendo acompanhada: injeta o vigia de novo (o usuário já autorizou).
  async function reconectar(tabId) {
    const a = await lerAba(tabId);
    if (!a?.recarregando) return;
    let r = null;
    try {
      r = (await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: vigiarChat,
        args: [{ chave: a.compra, empresaCnpj: a.empresaCnpj, empresaNome: a.empresaNome, som: a.som, gravar: a.gravar, desde: a.recarregando }] }))?.[0]?.result;
    } catch { /* página de erro do navegador, sem permissão ou aba fechada */ }
    if (r?.status !== 'iniciado') parou(tabId, 'recarregou', a.som);
  }
  chrome.tabs.onUpdated?.addListener((tabId, info) => { if (info.status === 'complete') void reconectar(tabId); });
  chrome.tabs.onRemoved?.addListener(tabId => { void lerAba(tabId).then(a => { if (a) { void esquecerAba(tabId); if (a.recarregando) avisar(tabId, { title: 'Parei de acompanhar este pregão', message: PAROU.fechou, silent: !a.som }); } }); });
  chrome.notifications.onClicked.addListener(async id => {
    const tabId = Number(id.split(':')[1]);
    if (!id.startsWith(`${PREFIXO}:`) || !Number.isInteger(tabId)) return;
    try {
      const aba = await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(aba.windowId, { focused: true });
    } catch { /* aba já fechada */ }
    chrome.notifications.clear(id);
  });
  return { gravar, reconectar };
}

if (globalThis.chrome?.runtime?.onMessage && globalThis.chrome.notifications) criarWorkerAcompanhar(globalThis.chrome);
