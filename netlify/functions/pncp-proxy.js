// Netlify Function: proxy genérico para os endpoints públicos de busca/consulta do PNCP
// (api/search, api/consulta/v1/contratos etc.) usados pelo painel na busca "ao vivo" de
// licitações e contratos. O PNCP não libera CORS pra chamada direta do navegador nesses
// endpoints (confirmado: toda chamada direta dá "Failed to fetch") — por isso o painel
// precisa passar por aqui, no mesmo espírito de pncp-arquivos.js e pncp-itens.js, só que
// genérico (repassa a URL completa do PNCP em vez de montar um endpoint fixo).
//
// Uso: GET /.netlify/functions/pncp-proxy?url=<URL completa e codificada do endpoint do PNCP>
// Por segurança (pra não virar um proxy aberto pra qualquer domínio), só aceita URLs https
// cujo host seja pncp.gov.br.
const HOST_PERMITIDO = "pncp.gov.br";

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  const alvo = (event.queryStringParameters && event.queryStringParameters.url) || "";

  let destino;
  try {
    destino = new URL(alvo);
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ erro: "Parâmetro url ausente ou inválido." }) };
  }
  if (destino.protocol !== "https:" || destino.hostname !== HOST_PERMITIDO) {
    return { statusCode: 400, headers, body: JSON.stringify({ erro: "Só é permitido fazer proxy para pncp.gov.br." }) };
  }

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 14000);
    const resp = await fetch(destino.toString(), { headers: { Accept: "application/json" }, signal: ctrl.signal });
    clearTimeout(t);
    const texto = await resp.text();
    return { statusCode: resp.status, headers, body: texto || JSON.stringify({}) };
  } catch (e) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ erro: "Não foi possível falar com a API do PNCP agora: " + String((e && e.message) || e) }),
    };
  }
};
