// Netlify Function: lista os itens (lotes/produtos/serviços) de uma contratação no PNCP —
// equivalente ao "Ver itens" do ConLicitação. Proxy simples pra fugir de CORS, já que o
// navegador não consegue chamar pncp.gov.br diretamente do nosso domínio. API pública, sem
// necessidade de token.
//
// Uso: GET /.netlify/functions/pncp-itens?cnpj=...&ano=...&sequencial=...
const BASE_URL = "https://pncp.gov.br/api/pncp/v1/orgaos";

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  const q = event.queryStringParameters || {};
  const cnpj = (q.cnpj || "").replace(/\D/g, "");
  const ano = parseInt(q.ano, 10);
  const sequencial = parseInt(q.sequencial, 10);
  if (cnpj.length !== 14 || !ano || !sequencial) {
    return { statusCode: 400, headers, body: JSON.stringify({ erro: "Informe cnpj, ano e sequencial válidos.", itens: [] }) };
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const resp = await fetch(`${BASE_URL}/${cnpj}/compras/${ano}/${sequencial}/itens`, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!resp.ok) {
      return { statusCode: 200, headers, body: JSON.stringify({ erro: null, itens: [] }) };
    }
    const dados = await resp.json();
    const itens = (Array.isArray(dados) ? dados : []).map((i) => ({
      numero: i.numeroItem,
      descricao: i.descricao || "",
      quantidade: i.quantidade,
      unidade: i.unidadeMedida || "",
      valorUnitarioEstimado: i.valorUnitarioEstimado,
      valorTotal: i.valorTotal,
      materialOuServico: i.materialOuServicoNome || "",
      situacao: i.situacaoCompraItemNome || "",
    }));
    return { statusCode: 200, headers, body: JSON.stringify({ erro: null, itens }) };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ erro: String((e && e.message) || e), itens: [] }) };
  }
};
