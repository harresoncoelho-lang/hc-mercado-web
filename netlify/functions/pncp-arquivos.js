// Netlify Function: lista os documentos anexados a uma contratação no PNCP (edital, projeto
// básico, planilhas etc.) — proxy simples pra fugir de CORS, já que o navegador não consegue
// chamar pncp.gov.br diretamente do nosso domínio. API pública, sem necessidade de token.
//
// Uso: GET /.netlify/functions/pncp-arquivos?cnpj=...&ano=...&sequencial=...
const BASE_URL = "https://pncp.gov.br/api/pncp/v1/orgaos";

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  const q = event.queryStringParameters || {};
  const cnpj = (q.cnpj || "").replace(/\D/g, "");
  const ano = parseInt(q.ano, 10);
  const sequencial = parseInt(q.sequencial, 10);
  if (cnpj.length !== 14 || !ano || !sequencial) {
    return { statusCode: 400, headers, body: JSON.stringify({ erro: "Informe cnpj, ano e sequencial válidos.", arquivos: [] }) };
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const resp = await fetch(`${BASE_URL}/${cnpj}/compras/${ano}/${sequencial}/arquivos`, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!resp.ok) {
      return { statusCode: 200, headers, body: JSON.stringify({ erro: null, arquivos: [] }) };
    }
    const dados = await resp.json();
    const arquivos = (Array.isArray(dados) ? dados : []).map((a) => ({
      sequencialDocumento: a.sequencialDocumento,
      titulo: a.titulo || "",
      tipoDocumentoNome: a.tipoDocumentoNome || a.tipoDocumentoDescricao || "",
    }));
    return { statusCode: 200, headers, body: JSON.stringify({ erro: null, arquivos }) };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ erro: String((e && e.message) || e), arquivos: [] }) };
  }
};
