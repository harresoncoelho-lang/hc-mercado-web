// Netlify Function: raio-X financeiro de um fornecedor (CNPJ) no Portal da Transparência.
// Mostra quanto o governo federal JÁ PAGOU de fato pra essa empresa (não o valor do
// edital/contrato, mas a execução financeira real) — complementa a aba Analisar Empresa,
// que hoje só mostra contratos assinados no PNCP, sem saber se foram realmente pagos.
//
// Uso: GET /.netlify/functions/despesas-fornecedor?cnpj=00000000000000
//
// Resposta: { totalPago, porAno: {2024: x, 2025: y, ...}, documentos: [...], erro }

const BASE_URL = "https://api.portaldatransparencia.gov.br/api-de-dados";
const FASE_PAGAMENTO = 3;
const ANOS_A_CONSULTAR = 4; // ano atual + 3 anteriores
const { cabecalhosPadrao, exigirUsuarioLogado, verificarLimiteDiario } = require("./_auth");

async function consultarAno(cnpj, ano, token) {
  try {
    const url = `${BASE_URL}/despesas/documentos-por-favorecido?codigoPessoa=${cnpj}&fase=${FASE_PAGAMENTO}&ano=${ano}&pagina=1`;
    const resp = await fetch(url, {
      headers: { Accept: "application/json", "chave-api-dados": token },
    });
    if (!resp.ok) return { ok: false, dados: [] };
    const texto = await resp.text();
    if (!texto) return { ok: true, dados: [] };
    const dados = JSON.parse(texto);
    return { ok: true, dados: Array.isArray(dados) ? dados : [] };
  } catch (e) {
    return { ok: false, dados: [] };
  }
}

exports.handler = async (event) => {
  const headers = cabecalhosPadrao(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };

  const sessao = await exigirUsuarioLogado(event);
  if (!sessao.ok) return { statusCode: sessao.status, headers, body: JSON.stringify({ erro: sessao.erro }) };
  const limite = await verificarLimiteDiario(sessao.userId, "despesas-fornecedor", 60);
  if (!limite.ok) return { statusCode: limite.status, headers, body: JSON.stringify({ erro: limite.erro }) };

  const token = process.env.TRANSPARENCIA_TOKEN;
  if (!token) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ erro: "TRANSPARENCIA_TOKEN não configurado no Netlify." }),
    };
  }

  const cnpj = (event.queryStringParameters && event.queryStringParameters.cnpj || "").replace(/\D/g, "");
  if (cnpj.length !== 14) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ erro: "Informe um CNPJ válido de 14 dígitos (parâmetro cnpj)." }),
    };
  }

  const anoAtual = new Date().getFullYear();
  const anos = Array.from({ length: ANOS_A_CONSULTAR }, (_, i) => anoAtual - i);

  const resultados = await Promise.all(anos.map((ano) => consultarAno(cnpj, ano, token)));

  let totalPago = 0;
  const porAno = {};
  const documentos = [];
  let falhouAlguma = false;
  let algumaOk = false;

  resultados.forEach((r, i) => {
    const ano = anos[i];
    if (!r.ok) { falhouAlguma = true; return; }
    algumaOk = true;
    let somaAno = 0;
    for (const doc of r.dados) {
      const valor = Number(doc.valor || 0);
      somaAno += valor;
      documentos.push({
        ano,
        documento: doc.documento || doc.documentoResumido || null,
        data: doc.dataEmissao || doc.data || null,
        valor,
        orgao: (doc.orgaoSuperior && doc.orgaoSuperior.nome) || doc.nomeOrgao || null,
        unidadeGestora: (doc.unidadeGestora && doc.unidadeGestora.nome) || null,
      });
    }
    if (somaAno > 0) porAno[ano] = somaAno;
    totalPago += somaAno;
  });

  documentos.sort((a, b) => (b.data || "").localeCompare(a.data || ""));

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      cnpj,
      totalPago,
      porAno,
      totalDocumentos: documentos.length,
      documentos: documentos.slice(0, 50),
      erro: !algumaOk && falhouAlguma ? "Não foi possível consultar o Portal da Transparência agora." : null,
    }),
  };
};
