// Popup, seção "Gravar pregão no LicitaPlena". Só lê o que o usuário JÁ abriu na aba (sem clicar nem navegar por
// ele: ver MODO_AUTOMATICO em pregao-leitor.mjs) e envia pela aba do LicitaPlena já logada. O que falta abrir vira
// uma lista de passos para o próprio usuário clicar. A permissão de site do LicitaPlena é opcional e pedida no
// primeiro uso; as origens vêm do manifesto (o pacote QA acrescenta o site local do ambiente de teste).
import { enviarNaPagina, lerPaginaPregao } from './pregao-leitor.mjs';

const status = document.getElementById('gravarStatus');
const botao = document.getElementById('gravarLer');
const origensLicitaPlena = () => chrome.runtime.getManifest().optional_host_permissions || [];

const MENSAGENS = {
  pagina_nao_suportada: 'Abra a página pública "Acompanhar Contratação" do Compras.gov (lista ou item) ou a ata completa do ComprasNet.',
  captcha_pendente: 'Há um desafio de verificação na página. Resolva-o na própria página e clique de novo.',
  sem_dados: 'A página ainda não mostra os dados. Espere carregar (no ComprasNet, digite o captcha da ata) e clique de novo.',
  pagina_grande_demais: 'Página grande demais para uma leitura. Grave item por item.',
};
const SECAO = { chat: 'Chat', proposta: 'Proposta', chat_mais_antigo: 'Chat (mensagens anteriores)' };

// Passos para o usuário: "Abra o item 3 → fornecedor X (CNPJ) → Chat e Proposta".
export function oQueFaltaAbrir(pendentes) {
  return pendentes.map(p => p.fornecedor
    ? `Abra o item ${p.item} → fornecedor ${p.nome && p.nome !== 'Pessoa física' ? `${p.nome} (${p.fornecedor})` : p.fornecedor} → ${p.falta.map(f => SECAO[f] || f).join(' e ')}`
    : `Abra o item ${p.item} ("Visualizar propostas") → em cada fornecedor, Chat e Proposta`);
}

export function resumir(leitura) {
  const linhas = [];
  for (const i of leitura.itens) {
    if (!i.propostasLidas) continue;
    const lidas = i.propostas.filter(p => p.propostaLida).length;
    const comMarca = i.propostas.filter(p => p.marca).length;
    linhas.push(`Item ${i.numero}: ${i.propostas.length} participantes, ${lidas} propostas abertas, ${comMarca} com marca, ${i.mensagens.length} mensagens.`);
    for (const m of i.mensagens.filter(x => ['recusa', 'desclassificacao', 'inabilitacao'].includes(x.tipo))) {
      linhas.push(`  ⚠ ${m.tipo} ${m.fornecedor || ''} ${m.dataHora || ''}: ${m.motivo || m.texto}`.slice(0, 300));
    }
  }
  if (leitura.mensagens.length) linhas.push(`Mensagens da sessão: ${leitura.mensagens.length}.`);
  const passos = oQueFaltaAbrir(leitura.pendentes);
  if (passos.length) linhas.push(`Falta abrir (${passos.length}) — abra na página e clique de novo:`, ...passos.slice(0, 15), ...(passos.length > 15 ? [`… e mais ${passos.length - 15}.`] : []));
  return linhas.join('\n');
}

async function executar(tabId, func, args = []) {
  const r = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func, args });
  return r?.[0]?.result;
}

export async function gravar(leitura) {
  const [aba] = await chrome.tabs.query({ url: origensLicitaPlena() });
  if (!aba) return { ok: false, erro: 'Abra o LicitaPlena (logado) em outra aba desta janela e clique de novo.' };
  const pregao = { ...leitura };
  delete pregao.status;
  delete pregao.pendentes;
  return await executar(aba.id, enviarNaPagina, [pregao]) || { ok: false, erro: 'O LicitaPlena não respondeu.' };
}

botao.addEventListener('click', () => {
  // Pedido de permissão precisa ser a primeira coisa do clique (gesto do usuário).
  const pedido = chrome.permissions.request({ origins: origensLicitaPlena() });
  botao.disabled = true;
  (async () => {
    if (!await pedido) { status.textContent = 'Sem permissão para enviar ao LicitaPlena.'; return; }
    status.textContent = 'Lendo o que a página mostra…';
    const [ativa] = await chrome.tabs.query({ active: true, currentWindow: true });
    const leitura = await executar(ativa.id, lerPaginaPregao);
    if (leitura?.status !== 'ok') { status.textContent = MENSAGENS[leitura?.status] || 'Não foi possível ler a página.'; return; }
    const envio = await gravar(leitura);
    status.textContent = resumir(leitura) + '\n' + (envio.ok
      ? `Gravado no LicitaPlena (${envio.propostas} propostas, ${envio.mensagens_novas} mensagens novas).`
      : `Não gravado: ${envio.erro || `HTTP ${envio.status}`}`);
  })().catch(() => { status.textContent = 'Falha ao ler ou enviar. Nada foi gravado desta vez. Reabra a extensão na página do pregão.'; })
    .finally(() => { botao.disabled = false; });
});
