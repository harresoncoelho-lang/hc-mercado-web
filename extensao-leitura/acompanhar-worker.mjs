// Service worker do modo "Acompanhar chat". Só reage a mensagens do script injetado na aba (chrome.runtime.onMessage):
// mostra a notificação, põe o badge e, se o usuário ligou "gravar", lê a página e envia pela aba do LicitaPlena.
// Não guarda estado (o badge é por aba) e não faz requisição: o único envio é o enviarNaPagina, executado NA aba do
// LicitaPlena (mesma regra do modo "Gravar pregão"). Ver README.
import { enviarNaPagina, lerPaginaPregao } from './pregao-leitor.mjs';

const PREFIXO = 'lp-chat';
const ENTRE_GRAVACOES_MS = 30e3;
const PAROU = {
  saiu: 'A aba saiu da página do pregão (ou foi recarregada/fechada).',
  sessao: 'O portal mostrou que a sessão acabou (deslogou ou caiu).',
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

export function criarWorkerAcompanhar(chrome) {
  const falhouGravar = new Set();
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
      const [lp] = await chrome.tabs.query({ url: chrome.runtime.getManifest().optional_host_permissions || [] });
      if (!lp) return falha('Abra o LicitaPlena (logado) em outra aba.');
      const pregao = { ...leitura }; delete pregao.status; delete pregao.pendentes;
      const r = await exec(lp.id, enviarNaPagina, [pregao]);
      if (!r?.ok) falha(r?.erro || 'O LicitaPlena não aceitou a gravação.');
    } catch { falha('Falha ao ler ou enviar. O alerta continua funcionando.'); }
  }

  chrome.runtime.onMessage.addListener((m, remetente) => {
    const tabId = remetente?.tab?.id;
    if (remetente?.id !== chrome.runtime.id || tabId === undefined || !m || typeof m !== 'object') return;
    if (m.tipo === 'iniciou') { falhouGravar.delete(tabId); badge(tabId, 'ON', '#188038'); }
    else if (m.tipo === 'visto') badge(tabId, 'ON', '#188038');
    else if (m.tipo === 'mensagens' && Array.isArray(m.itens) && m.itens.length) {
      const { importante, ...texto } = textoAlerta(m.itens);
      badge(tabId, String(Math.min(m.naoLidas || m.itens.length, 99)), importante ? '#d93025' : '#2255e0');
      avisar(tabId, { ...texto, silent: !m.som, requireInteraction: importante });
      if (m.gravar) void gravar(tabId);
    } else if (m.tipo === 'parou') {
      if (m.motivo === 'voce') { badge(tabId, ''); return; }
      badge(tabId, 'OFF', '#5f6368');
      avisar(tabId, { title: 'Parei de acompanhar este pregão', message: PAROU[m.motivo] || 'O acompanhamento terminou.', requireInteraction: true, silent: !m.som });
    }
  });
  chrome.notifications.onClicked.addListener(async id => {
    const tabId = Number(id.split(':')[1]);
    if (!id.startsWith(`${PREFIXO}:`) || !Number.isInteger(tabId)) return;
    try {
      const aba = await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(aba.windowId, { focused: true });
    } catch { /* aba já fechada */ }
    chrome.notifications.clear(id);
  });
  return { gravar };
}

if (globalThis.chrome?.runtime?.onMessage && globalThis.chrome.notifications) criarWorkerAcompanhar(globalThis.chrome);
