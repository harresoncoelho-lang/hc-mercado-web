// Popup, seção "Preencher proposta". Lote do LicitaPlena (aba logada) ou planilha CSV; preenche a página de cadastro
// que o usuário já abriu. Não clica Salvar, não aceita termo/declarações, não resolve captcha, não navega.
// Lote e diário ficam no globalThis.localStorage do popup, por compra, para retomar se o portal cair.
import { buscarLoteNaPagina, compraDaUrl, expirarArmazenamento, lerCsv, lerDiario, preencherPaginaCadastro, progresso, registrarDiario, resumirPreenchimento } from './preencher-proposta.mjs';

const status = document.getElementById('preencherStatus');
const origensLicitaPlena = () => chrome.runtime.getManifest().optional_host_permissions || [];
const chaveLote = compra => `lp-preencher-lote:${compra}`;
const executar = async (tabId, func, args = []) => (await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func, args }))?.[0]?.result;

async function abaAtiva() {
  const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
  const compra = compraDaUrl(aba?.url);
  if (!compra) throw new Error('Abra a página "Cadastrar propostas" do Compras.gov (já logado) e tente de novo.');
  return { aba, compra };
}
const lerLote = compra => { try { return JSON.parse(globalThis.localStorage.getItem(chaveLote(compra)))?.itens || []; } catch { return []; } };
const apagarLote = compra => { try { globalThis.localStorage.removeItem(chaveLote(compra)); } catch { /* sem armazenamento */ } };
expirarArmazenamento(globalThis.localStorage);
const guardarLote = (compra, itens) => { try { globalThis.localStorage.setItem(chaveLote(compra), JSON.stringify({ em: new Date().toISOString(), itens })); } catch { /* sem armazenamento */ } };
const mostrarProgresso = compra => { const lote = lerLote(compra); return lote.length ? progresso(lerDiario(globalThis.localStorage, compra), lote) : null; };

function falha(e) { status.textContent = e?.message || 'Falha. Nada foi alterado na página.'; }

document.getElementById('preencherBuscar').addEventListener('click', () => {
  const pedido = chrome.permissions.request({ origins: origensLicitaPlena() }); // 1º passo do clique (gesto do usuário)
  (async () => {
    if (!await pedido) throw new Error('Sem permissão para ler o lote no LicitaPlena.');
    const { compra } = await abaAtiva();
    const [lp] = await chrome.tabs.query({ url: origensLicitaPlena() });
    if (!lp) throw new Error('Abra o LicitaPlena (logado) em outra aba desta janela e clique de novo.');
    const r = await executar(lp.id, buscarLoteNaPagina, [compra]) || { ok: false, erro: 'O LicitaPlena não respondeu.' };
    if (!r.ok) throw new Error(r.erro || `Não foi possível ler o lote (HTTP ${r.status}).`);
    if (r.escolher) throw new Error(`Há ${r.escolher.length} processos desta compra no LicitaPlena. Use a planilha CSV ou deixe só um processo ativo.`);
    if (!r.processo) throw new Error('Não achei, no LicitaPlena, um processo com esta UASG e número. Use a planilha CSV.');
    guardarLote(compra, r.itens.map(i => ({ item: String(i.item).replace(/^0+(?=\d)/, ''), quantidade: i.quantidade, valorUnitario: i.valorUnitario, marca: i.marca, modelo: i.modelo, fabricante: i.fabricante, valorMinimo: i.valorMinimo })));
    status.textContent = `Lote do processo ${r.processo.numero}: ${r.itens.length} itens com valor. Confira que é o processo certo e clique em "Preencher esta página".`;
  })().catch(falha);
});

document.getElementById('preencherCsv').addEventListener('change', ev => {
  (async () => {
    const { compra } = await abaAtiva();
    const csv = lerCsv(await ev.target.files[0].text());
    if (!csv.ok) throw new Error(`Planilha com problemas:\n${csv.erros.slice(0, 10).join('\n')}`);
    guardarLote(compra, csv.itens);
    status.textContent = `Planilha lida: ${csv.itens.length} itens. Clique em "Preencher esta página".`;
  })().catch(falha);
});

document.getElementById('preencherAgora').addEventListener('click', () => {
  (async () => {
    const { aba, compra } = await abaAtiva();
    const lote = lerLote(compra);
    if (!lote.length) throw new Error('Carregue antes o lote do LicitaPlena ou a planilha CSV.');
    status.textContent = 'Preenchendo os itens desta página…';
    const r = await executar(aba.id, preencherPaginaCadastro, [{ lote }]);
    if (!r) throw new Error('Não foi possível preencher a página.');
    if (r.status === 'ok') registrarDiario(globalThis.localStorage, compra, r);
    const prog = mostrarProgresso(compra);
    status.textContent = resumirPreenchimento(r, prog);
    if (prog && prog.feitos >= prog.total) apagarLote(compra); // compra concluída: o lote (com valor mínimo) não fica no navegador
  })().catch(falha);
});

abaAtiva().then(({ compra }) => { const p = mostrarProgresso(compra); if (p) status.textContent = `Já preenchidos: ${p.feitos} de ${p.total}.`; }).catch(() => {});
