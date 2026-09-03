// Netlify Function: lista os itens (lotes/produtos/serviços) de uma contratação no PNCP —
// equivalente ao "Ver itens" do ConLicitação. Proxy simples pra fugir de CORS, já que o
// navegador não consegue chamar pncp.gov.br diretamente do nosso domínio. API pública, sem
// necessidade de token.
//
// Uso: GET /.netlify/functions/pncp-itens?cnpj=...&ano=...&sequencial=...
const BASE_URL = "https://pncp.gov.br/api/pncp/v1/orgaos";

// Ver nota em pncp-proxy.js: alguns endpoints do PNCP resetam a conexão sem User-Agent de
// navegador. Manda em todo fetch pro PNCP por segurança, mesmo que este endpoint específico
// não tenha mostrado o problema nos testes.
const USER_AGENT_NAVEGADOR =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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
    const tamanhoPagina = 100;
    const itensPorNumero = new Map();
    try {
      for (let pagina = 1; pagina <= 20; pagina += 1) {
        const resp = await fetch(`${BASE_URL}/${cnpj}/compras/${ano}/${sequencial}/itens?pagina=${pagina}&tamanhoPagina=${tamanhoPagina}`, {
          headers: { Accept: "application/json", "User-Agent": USER_AGENT_NAVEGADOR },
          signal: ctrl.signal,
        });
        if (!resp.ok) break;
        const dados = await resp.json();
        const lote = Array.isArray(dados) ? dados : (dados.data || []);
        if (!Array.isArray(lote) || lote.length === 0) break;
        let novos = 0;
        for (const item of lote) {
          const chave = String(item.numeroItem ?? item.numero ?? "");
          if (!chave || itensPorNumero.has(chave)) continue;
          itensPorNumero.set(chave, item);
          novos += 1;
        }
        // Algumas versões da API devolvem uma lista única e ignoram paginação. Parar ao
        // detectar repetição evita loops e ainda preserva todos os itens recebidos.
        if (lote.length < tamanhoPagina || novos === 0) break;
      }
    } finally {
      clearTimeout(t);
    }
    const itens = [...itensPorNumero.values()].map((i) => ({
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
