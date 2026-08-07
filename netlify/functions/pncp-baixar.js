// Netlify Function: baixa (proxy) um documento anexado a uma contratação no PNCP e devolve
// com Content-Disposition: attachment, pra forçar o download de verdade no navegador do
// cliente (em vez de abrir a página do PNCP e o cliente ter que procurar o botão de baixar
// lá dentro). Usado pelo botão "📥 Baixar Edital" nos cards do Boletim.
//
// Uso: GET /.netlify/functions/pncp-baixar?cnpj=...&ano=...&sequencial=...&documento=...&nome=...
const BASE_URL = "https://pncp.gov.br/pncp-api/v1/orgaos";

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const cnpj = (q.cnpj || "").replace(/\D/g, "");
  const ano = parseInt(q.ano, 10);
  const sequencial = parseInt(q.sequencial, 10);
  const documento = parseInt(q.documento, 10);
  const nomeArquivo = (q.nome || "edital.pdf").replace(/[^\w.\- ]/g, "_");

  if (cnpj.length !== 14 || !ano || !sequencial || !documento) {
    return { statusCode: 400, headers: { "Content-Type": "text/plain" }, body: "Parâmetros inválidos." };
  }

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000);
    const resp = await fetch(`${BASE_URL}/${cnpj}/compras/${ano}/${sequencial}/arquivos/${documento}`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!resp.ok) {
      return { statusCode: 502, headers: { "Content-Type": "text/plain" }, body: "Não foi possível baixar o arquivo no PNCP." };
    }
    const buffer = Buffer.from(await resp.arrayBuffer());
    const tipo = resp.headers.get("content-type") || "application/octet-stream";
    return {
      statusCode: 200,
      headers: {
        "Content-Type": tipo,
        "Content-Disposition": `attachment; filename="${nomeArquivo}"`,
        "Access-Control-Allow-Origin": "*",
      },
      body: buffer.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (e) {
    return { statusCode: 500, headers: { "Content-Type": "text/plain" }, body: "Erro ao baixar: " + String((e && e.message) || e) };
  }
};
