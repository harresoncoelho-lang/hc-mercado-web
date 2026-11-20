// Proxy pontual para a marca declarada na Pesquisa de Preços do Compras.gov.
//
// Uso: GET /.netlify/functions/comprasgov-marca?catalogo=453617&compra=15590305900202026&item=1559030590020202600014
// A chamada é feita somente após ação explícita do usuário no dossiê de um
// resultado homologado. Não acessa área autenticada nem coleta documentos.

const { cabecalhosPadrao, limitarPorIp } = require("./_auth");
const BASE_URL = "https://dadosabertos.compras.gov.br/modulo-pesquisa-preco/1_consultarMaterial";

function soDigitos(valor) {
  return String(valor || "").replace(/\D/g, "");
}

function marcaUtil(valor) {
  const marca = String(valor || "").trim();
  return marca && !/^[.-]+$/.test(marca) ? marca : null;
}

exports.handler = async (event) => {
  // Proxy público: CORS só do nosso domínio e teto diário por IP (teste de ataque 19/11, M5).
  const headers = cabecalhosPadrao(event);
  const limite = await limitarPorIp(event, "comprasgov-marca");
  if (!limite.ok) return { statusCode: limite.status, headers, body: JSON.stringify({ erro: limite.erro }) };
  const q = event.queryStringParameters || {};
  const catalogo = soDigitos(q.catalogo);
  const compra = soDigitos(q.compra);
  const item = soDigitos(q.item);
  if (!/^\d{1,10}$/.test(catalogo) || !/^\d{8,25}$/.test(compra) || !/^\d{12,30}$/.test(item)) {
    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, erro: "Parâmetros de item inválidos." }) };
  }

  const parametros = new URLSearchParams({
    tipo: "codigoItemCatalogo",
    codigo: catalogo,
    idCompra: compra,
    pagina: "1",
    tamanhoPagina: "100",
    dataResultado: "true",
  });
  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), 15000);
  try {
    const resposta = await fetch(`${BASE_URL}?${parametros}`, {
      headers: { Accept: "application/json" },
      signal: controlador.signal,
    });
    if (!resposta.ok) {
      return { statusCode: resposta.status === 429 ? 429 : 502, headers, body: JSON.stringify({ ok: false, erro: "Fonte pública indisponível no momento." }) };
    }
    const dados = await resposta.json();
    const registro = (dados.resultado || []).find((linha) => soDigitos(linha.idCompraItem) === item);
    const marca = marcaUtil(registro && registro.marca);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        encontrada: !!marca,
        marca,
        fonte: "Pesquisa de Preços do Compras.gov",
      }),
    };
  } catch (erro) {
    return { statusCode: 502, headers, body: JSON.stringify({ ok: false, erro: "Não foi possível consultar a fonte pública agora." }) };
  } finally {
    clearTimeout(timeout);
  }
};

module.exports.marcaUtil = marcaUtil;
