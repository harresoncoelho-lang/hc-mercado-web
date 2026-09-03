// Netlify Function: consulta o registro completo de uma compra no PNCP. A busca rápida
// do portal retorna somente um resumo; este proxy preenche modo de disputa, amparo legal,
// SRP, valores, processo e demais campos oficiais sem expor o navegador ao bloqueio CORS.
const BASE_URL = "https://pncp.gov.br/api/consulta/v1/orgaos";
const USER_AGENT_NAVEGADOR =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function fonteOrcamentaria(dados) {
  if (typeof dados.fonteOrcamentaria === "string" && dados.fonteOrcamentaria.trim()) return dados.fonteOrcamentaria.trim();
  if (!Array.isArray(dados.fontesOrcamentarias)) return null;
  const fontes = dados.fontesOrcamentarias
    .map((fonte) => typeof fonte === "string" ? fonte : (fonte && (fonte.nome || fonte.descricao)) || "")
    .filter(Boolean);
  return fontes.length ? fontes.join(", ") : null;
}

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  const q = event.queryStringParameters || {};
  const cnpj = String(q.cnpj || "").replace(/\D/g, "");
  const ano = Number.parseInt(q.ano, 10);
  const sequencial = Number.parseInt(q.sequencial, 10);
  if (cnpj.length !== 14 || !ano || !sequencial) {
    return { statusCode: 400, headers, body: JSON.stringify({ erro: "Informe cnpj, ano e sequencial válidos.", detalhe: null }) };
  }
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 12000);
    const resp = await fetch(`${BASE_URL}/${cnpj}/compras/${ano}/${sequencial}`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT_NAVEGADOR }, signal: ctrl.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return { statusCode: 200, headers, body: JSON.stringify({ erro: "PNCP não retornou o detalhe.", detalhe: null }) };
    const dados = await resp.json();
    const detalhe = {
      modalidadeNome: dados.modalidadeNome || null,
      tipoInstrumentoConvocatorioNome: dados.tipoInstrumentoConvocatorioNome || null,
      amparoLegal: dados.amparoLegal && (dados.amparoLegal.nome || dados.amparoLegal.descricao) || null,
      modoDisputaNome: dados.modoDisputaNome || null,
      srp: typeof dados.srp === "boolean" ? dados.srp : null,
      fonteOrcamentaria: fonteOrcamentaria(dados),
      situacaoCompraNome: dados.situacaoCompraNome || null,
      valorTotalEstimado: dados.valorTotalEstimado ?? null,
      valorTotalHomologado: dados.valorTotalHomologado ?? null,
      numeroCompra: dados.numeroCompra || null,
      anoCompra: dados.anoCompra || null,
      processo: dados.processo || null,
      codigoUnidade: dados.unidadeOrgao && dados.unidadeOrgao.codigoUnidade || null,
      esferaId: dados.orgaoEntidade && dados.orgaoEntidade.esferaId || null,
      encerramento: dados.dataEncerramentoProposta || null,
      publicacao: dados.dataPublicacaoPncp || null,
    };
    return { statusCode: 200, headers, body: JSON.stringify({ erro: null, detalhe }) };
  } catch (erro) {
    return { statusCode: 200, headers, body: JSON.stringify({ erro: String(erro && erro.message || erro), detalhe: null }) };
  }
};
