import { allowedUrl, validateContext } from './adapter.mjs';
import { collectSnapshot } from './collector.mjs';
import { criarClienteLeitura } from './ponte-cliente.mjs';

const fields = ['cnpj', 'uasg', 'number', 'year', 'purchaseId'];
const expected = () => Object.fromEntries(fields.map(key => [key, document.getElementById(key).value.trim()]));
const result = document.getElementById('result');
const button = document.getElementById('read');
// Somente pacote QA explícito possui worker; manifesto fonte continua fechado.
const ponte = globalThis.licitaplenaPonteLeitura || (globalThis.chrome?.runtime?.getManifest?.().background?.service_worker==='worker-qa.mjs' ? criarClienteLeitura(chrome.runtime) : null);
globalThis.addEventListener?.('pagehide',()=>ponte?.fechar?.());
const cancelar = async id => {try{await ponte?.cancelar(id);}catch{}};
let tentativaAtiva = null;
const adopt = document.getElementById('adopt');
if(adopt && ponte?.obterTentativa){adopt.hidden=false;adopt.addEventListener('click',async()=>{
  if(button.disabled||adopt.disabled)return;
  const current=++revision;adopt.disabled=true;
  let attempt;try{attempt=await ponte.obterTentativa();}catch{}finally{adopt.disabled=false;}
  if(current!==revision){if(attempt)await cancelar(attempt.tentativaId);return;}
  if(!attempt){result.textContent='Nenhuma tentativa válida. Inicie novamente no LicitaPlena.';return;}
  tentativaAtiva=attempt.tentativaId;revision++;
  for(const key of fields)document.getElementById(key).value=attempt.contexto[key];
  result.textContent=`Peça ${attempt.documentoId}, versão ${attempt.versao}. Confira o CNPJ e o pregão antes de ler.`;
});}
const messages = {
  confirmado: 'Contexto observado corresponde ao esperado nesta leitura. Escrita não autorizada.',
  esperado_invalido: 'Preencha um contexto esperado válido. Nenhuma leitura do portal foi feita.',
  pagina_nao_suportada: 'Abra a página de cadastro de propostas do Compras.gov.br. Esta página não é suportada.',
  leitura_incompleta: 'Leitura incompleta. Contexto não confirmado.',
  sessao_ou_verificacao_pendente: 'Sessão ou verificação do portal pendente. Resolva diretamente no portal e leia novamente.',
  identidade_nao_confirmada: 'CNPJ do fornecedor não foi identificado no cabeçalho ou rótulo suportado. Identidade não confirmada.',
  compra_nao_confirmada: 'UASG ou número/ano não foram identificados na página. Compra não confirmada.',
  contexto_ambiguo: 'Mais de uma identidade ou compra encontrada. Contexto não confirmado.',
  contexto_divergente: 'O contexto observado diverge do esperado. Nenhuma operação permitida.',
};
let revision = 0;
for (const key of fields) document.getElementById(key).addEventListener('input', () => {
  if(tentativaAtiva){void cancelar(tentativaAtiva);tentativaAtiva=null;}
  revision++;
  result.textContent = 'Contexto esperado alterado. Faça nova leitura.';
});
button.addEventListener('click', async () => {
  const wanted = expected();
  const currentRevision = revision;
  const tentativaId = tentativaAtiva;
  const cancelarEsta = async () => { if(tentativaId)await cancelar(tentativaId);if(tentativaAtiva===tentativaId)tentativaAtiva=null; };
  if (validateContext(null, wanted).status === 'esperado_invalido') {
    result.textContent = messages.esperado_invalido;
    return;
  }
  button.disabled = true;
  if(adopt)adopt.disabled=true;
  result.textContent = 'Lendo a identificação e os itens públicos visíveis da aba atual…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !allowedUrl(tab.url)) { result.textContent = messages.pagina_nao_suportada; return; }
    if(tentativaId&&(tentativaAtiva!==tentativaId||!await ponte.vincularPortal(tentativaId,tab))){await cancelarEsta();result.textContent='Tentativa indisponível. Reinicie no LicitaPlena.';return;}
    if(revision!==currentRevision||tentativaAtiva!==tentativaId)return;
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, func: collectSnapshot });
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tentativaAtiva !== tentativaId || revision !== currentRevision || active?.id !== tab.id || active?.url !== tab.url
      || results.length !== 1 || results[0].frameId !== 0 || results[0].result?.url !== tab.url) {
      result.textContent = 'A aba ou o contexto mudou durante a leitura. Leia novamente.';
      return;
    }
    const validation = validateContext(results[0].result, wanted);
    result.textContent = messages[validation.status] || 'Contexto não confirmado.';
    if (validation.paginaObservada) {
      result.textContent += '\nPágina observada parcial. Não comprova carga da próxima página nem catálogo completo. Grupo e exigências desconhecidos. Não autoriza cadastro.\n'
        + validation.paginaObservada.itens.map(item => `Item ${item.id}: ${item.descricao} — Quantidade solicitada: ${item.quantidadeSolicitada}; unidade: ${item.unidade}`).join('\n');
    }
    if(tentativaId){
      const sent=await ponte.concluir(tentativaId,results[0].result,active);if(revision!==currentRevision||tentativaAtiva!==tentativaId)return;if(tentativaAtiva===tentativaId)tentativaAtiva=null;
      result.textContent+=sent?'\nRelato enviado ao LicitaPlena; aguarde recibo na peça.':'\nTentativa invalidada. Nenhuma leitura registrada.';
    }
  } catch {
    await cancelarEsta();
    result.textContent = 'Não foi possível ler a aba. Nenhum dado foi salvo ou enviado. Reabra a extensão na página correta.';
  } finally { await cancelarEsta();button.disabled = false;if(adopt)adopt.disabled=false; }
});
