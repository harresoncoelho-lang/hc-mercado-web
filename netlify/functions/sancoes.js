// Netlify Function: consulta sanções (CEIS e CNEP) por CNPJ no Portal da Transparência.
// Existe pra esconder o TRANSPARENCIA_TOKEN do navegador — o token fica só nas variáveis
// de ambiente do Netlify (Site settings > Environment variables), nunca no código do site.
//
// Uso: GET /.netlify/functions/sancoes?cnpj=00000000000000
//
// Resposta: { temSancao: boolean, ceis: [...], cnep: [...], erro: string|null }

const BASE_URL = "https://api.portaldatransparencia.gov.br/api-de-dados";

async function consultar(caminho, token) {
  try {
    const resp = await fetch(`${BASE_URL}${caminho}`, {
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
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

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

  const [ceis, cnep] = await Promise.all([
    consultar(`/ceis?cnpjSancionado=${cnpj}&pagina=1`, token),
    consultar(`/cnep?cnpjSancionado=${cnpj}&pagina=1`, token),
  ]);

  const falhouAlguma = !ceis.ok && !cnep.ok;

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      temSancao: ceis.dados.length > 0 || cnep.dados.length > 0,
      ceis: ceis.dados,
      cnep: cnep.dados,
      erro: falhouAlguma ? "Não foi possível consultar o Portal da Transparência agora." : null,
    }),
  };
};
