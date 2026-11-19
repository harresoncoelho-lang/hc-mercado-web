// Popup, seção "Acompanhar chat". Injeta vigiarChat na aba ativa (clique do usuário) ou para o acompanhamento.
// Empresa/opções ficam no localStorage do popup (só no navegador). A permissão de site do LicitaPlena só é pedida se
// o usuário marcar "gravar no LicitaPlena".
import { pararChat, vigiarChat } from './acompanhar-chat.mjs';
import { PORTAL, ehPortal, origensLicitaPlena } from './diagnostico.mjs';
import { oferecerDiagnostico } from './diagnostico-popup.mjs';

const $ = id => document.getElementById(id);
const status = $('acompanharStatus');
const CHAVE = 'lp-acompanhar-config';
const MSG = {
  pagina_nao_suportada: 'Abra a página pública "Acompanhar contratação" ou a sala do fornecedor no Compras.gov e clique de novo.',
  nao_estava: 'Esta aba não estava sendo acompanhada.',
};
const cnpjValido = d => {
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const dv = n => { let s = 0, p = n - 7; for (let i = 0; i < n; i++) { s += Number(d[i]) * p--; if (p < 2) p = 9; } return (s % 11 < 2 ? 0 : 11 - (s % 11)); };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
};
const guardado = () => { try { return JSON.parse(globalThis.localStorage.getItem(CHAVE)) || {}; } catch { return {}; } };
const g = guardado();
$('acompanharCnpj').value = g.cnpj || '';
$('acompanharNome').value = g.nome || '';
$('acompanharSom').checked = g.som !== false;
$('acompanharGravar').checked = !!g.gravar;

const executar = async (tabId, func, args = []) => (await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func, args }))?.[0]?.result;

$('acompanharIniciar').addEventListener('click', () => {
  const cnpj = $('acompanharCnpj').value.replace(/\D/g, '');
  const cfg = { cnpj, nome: $('acompanharNome').value.trim(), som: $('acompanharSom').checked, gravar: $('acompanharGravar').checked };
  if (cnpj && !cnpjValido(cnpj)) { status.textContent = 'CNPJ inválido: confira os dígitos (ou deixe em branco).'; return; }
  try { globalThis.localStorage.setItem(CHAVE, JSON.stringify(cfg)); } catch { /* sem armazenamento */ }
  // Pedido de permissão precisa ser a primeira coisa do clique (gesto do usuário). Um pedido só: o portal (para voltar a
  // acompanhar sozinho se a página recarregar) e, se "gravar", o LicitaPlena. Recusar só o portal não impede acompanhar.
  const pedido = chrome.permissions.request({ origins: [PORTAL, ...(cfg.gravar ? origensLicitaPlena(chrome.runtime.getManifest()) : [])] });
  (async () => {
    const aceito = await pedido.catch(() => false);
    if (!aceito && cfg.gravar) { status.textContent = 'Sem permissão para gravar no LicitaPlena. Desmarque "gravar" ou aceite.'; return; }
    const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
    const r = await executar(aba.id, vigiarChat, [{ empresaCnpj: cnpj, empresaNome: cfg.nome, som: cfg.som, gravar: cfg.gravar }]);
    status.textContent = r?.status === 'iniciado'
      ? `Acompanhando esta aba (${r.jaNaTela} mensagens já na tela, não alertam). Mantenha a aba aberta e o computador ligado.${aceito ? ' Se a página recarregar, volto a acompanhar sozinho.' : ' Sem a permissão do portal: se a página recarregar, clique "Acompanhar" de novo.'}`
      : MSG[r?.status] || 'Não foi possível iniciar nesta aba.';
    // Chat visível mas 0 mensagens lidas = seletor diferente (sala de disputa ainda não mapeada).
    if (r?.status === 'iniciado' && r.jaNaTela === 0) status.textContent += '\nNão achei nenhuma mensagem na tela. Se o chat está aberto e tem mensagens, envie o diagnóstico abaixo.';
    if ((r?.status === 'iniciado' && r.jaNaTela === 0) || (r?.status === 'pagina_nao_suportada' && ehPortal(aba.url))) oferecerDiagnostico('acompanhar', r.jaNaTela === 0 ? 'chat_vazio' : r.status);
  })().catch(() => { status.textContent = 'Falha ao iniciar. Reabra a extensão na página do pregão.'; });
});

$('acompanharParar').addEventListener('click', () => {
  (async () => {
    const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
    const r = await executar(aba.id, pararChat);
    status.textContent = r?.status === 'parado' ? 'Parei de acompanhar esta aba.' : MSG[r?.status] || 'Não foi possível parar.';
  })().catch(() => { status.textContent = 'Falha ao parar. Feche ou recarregue a aba do pregão.'; });
});
