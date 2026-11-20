// Popup, seção "Página não reconhecida": aparece quando um fluxo (gravar, preencher, acompanhar) não reconhece a página
// do portal. Só envia depois do clique do usuário, e só a estrutura (ver diagnostico.mjs). Elementos lidos na hora do
// uso (o popup de teste tem só parte do HTML).
import { ehPortal, enviarDiagnosticoNaPagina, estruturaPagina, origensLicitaPlena, resumoDiagnostico } from './diagnostico.mjs';

let pendente = null;
let ligado = false;
const $ = id => globalThis.document?.getElementById?.(id) || null;
const executar = async (tabId, func, args = []) => (await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func, args }))?.[0]?.result;

async function enviar(status) {
  const manifest = chrome.runtime.getManifest();
  const pedido = chrome.permissions.request({ origins: origensLicitaPlena(manifest) }); // 1º passo do clique (gesto do usuário)
  if (!await pedido) { status.textContent = 'Sem permissão para enviar ao LicitaPlena. Nada foi enviado.'; return; }
  const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!ehPortal(aba?.url)) { status.textContent = 'O diagnóstico só é feito na página do Compras.gov ou do ComprasNet. Nada foi enviado.'; return; }
  const d = await executar(aba.id, estruturaPagina, [{ fluxo: pendente.fluxo, motivo: pendente.motivo, extensao: manifest.version }]);
  if (d?.status !== 'ok') { status.textContent = 'Não consegui ler a estrutura desta página. Nada foi enviado.'; return; }
  const [lp] = await chrome.tabs.query({ url: origensLicitaPlena(manifest) });
  if (!lp) { status.textContent = 'Abra o LicitaPlena (logado) em outra aba desta janela e clique de novo.'; return; }
  const r = await executar(lp.id, enviarDiagnosticoNaPagina, [d]) || { ok: false, erro: 'O LicitaPlena não respondeu.' };
  status.textContent = `${resumoDiagnostico(d)}\n${r.ok ? `Diagnóstico enviado (nº ${r.id ?? '—'}). A equipe ajusta a extensão e avisa você.` : `Não enviado: ${r.erro || `HTTP ${r.status}`}`}`;
  if (r.ok) pendente = null;
}

// Mostra o convite. motivo: código curto do que falhou (ex.: "sem_itens").
export function oferecerDiagnostico(fluxo, motivo) {
  const secao = $('diagnostico'), botao = $('diagnosticoEnviar'), status = $('diagnosticoStatus');
  if (!secao || !botao || !status) return false;
  pendente = { fluxo, motivo };
  secao.hidden = false;
  secao.scrollIntoView?.({ block: 'nearest' }); // a seção fica no fim do popup
  status.textContent = 'Se a página está aberta e carregada mas a extensão não a reconhece, envie o diagnóstico: vai só a estrutura da página (nomes de campos e seções), nunca o que você digitou, CPF ou dados pessoais.';
  if (!ligado) {
    ligado = true;
    botao.addEventListener('click', () => {
      if (!pendente || botao.disabled) return;
      botao.disabled = true;
      enviar(status).catch(() => { status.textContent = 'Falha ao enviar o diagnóstico. Nada foi enviado.'; }).finally(() => { botao.disabled = false; });
    });
  }
  return true;
}
