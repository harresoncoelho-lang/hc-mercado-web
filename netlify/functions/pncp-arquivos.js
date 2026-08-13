// Netlify Function: lista os documentos anexados a uma contratação no PNCP (edital, projeto
// básico, avisos, esclarecimentos, impugnações, recursos etc.) — proxy simples pra fugir de
// CORS, já que o navegador não consegue chamar pncp.gov.br diretamente do nosso domínio.
// API pública, sem necessidade de token.
//
// Também devolve a situação atual da licitação (Divulgada no PNCP, Revogada, Anulada,
// Suspensa etc.) — é assim que a gente consegue avisar o cliente quando uma licitação que
// ele está acompanhando muda de status, sem precisar de "monitoramento de chat" em tempo
// real (que dependeria de integrar com cada portal de disputa individualmente, sem API
// pública — Comprasnet, BLL, Licitanet etc. cada um com seu próprio sistema fechado).
//
// Uso: GET /.netlify/functions/pncp-arquivos?cnpj=...&ano=...&sequencial=...
const BASE_URL = "https://pncp.gov.br/api/pncp/v1/orgaos";
const BASE_URL_COMPRA = "https://pncp.gov.br/api/consulta/v1/orgaos";

// Ver nota em pncp-proxy.js: alguns endpoints do PNCP resetam a conexão sem User-Agent de
// navegador. Manda em todo fetch pro PNCP por segurança.
const USER_AGENT_NAVEGADOR =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  const q = event.queryStringParameters || {};
  const cnpj = (q.cnpj || "").replace(/\D/g, "");
  const ano = parseInt(q.ano, 10);
  const sequencial = parseInt(q.sequencial, 10);
  if (cnpj.length !== 14 || !ano || !sequencial) {
    return { statusCode: 400, headers, body: JSON.stringify({ erro: "Informe cnpj, ano e sequencial válidos.", arquivos: [], situacaoCompraNome: null, situacaoCompraId: null }) };
  }

  let arquivos = [];
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const resp = await fetch(`${BASE_URL}/${cnpj}/compras/${ano}/${sequencial}/arquivos`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT_NAVEGADOR },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (resp.ok) {
      const dados = await resp.json();
      arquivos = (Array.isArray(dados) ? dados : []).map((a) => ({
        sequencialDocumento: a.sequencialDocumento,
        titulo: a.titulo || "",
        tipoDocumentoNome: a.tipoDocumentoNome || a.tipoDocumentoDescricao || "",
        dataPublicacaoPncp: a.dataPublicacaoPncp || null,
      }));
    }
  } catch (e) {
    // segue mesmo sem lista de arquivos — não impede de mostrar a situação da compra
  }

  // Busca a situação atual da compra (separado, não crítico: se falhar, só não mostra o
  // aviso de status, mas a lista de arquivos continua funcionando normalmente).
  let situacaoCompraNome = null;
  let situacaoCompraId = null;
  try {
    const ctrl2 = new AbortController();
    const t2 = setTimeout(() => ctrl2.abort(), 10000);
    const respCompra = await fetch(`${BASE_URL_COMPRA}/${cnpj}/compras/${ano}/${sequencial}`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT_NAVEGADOR },
      signal: ctrl2.signal,
    });
    clearTimeout(t2);
    if (respCompra.ok) {
      const dadosCompra = await respCompra.json();
      situacaoCompraNome = dadosCompra.situacaoCompraNome || null;
      situacaoCompraId = dadosCompra.situacaoCompraId ?? null;
    }
  } catch (e) {
    // não crítico
  }

  return { statusCode: 200, headers, body: JSON.stringify({ erro: null, arquivos, situacaoCompraNome, situacaoCompraId }) };
};
