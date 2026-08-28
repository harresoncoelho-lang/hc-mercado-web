// Pesquisa pública de marcas por produto no ecossistema Compras.gov.
//
// Fluxo: termo livre -> PDMs do Catálogo público -> resultados homologados da
// Pesquisa de Preços. A marca é retornada somente quando foi declarada na
// fonte oficial. Não consulta área autenticada ou documentos de participantes.

const CATALOGO_URL = "https://cnbs.estaleiro.serpro.gov.br/cnbs-api/material/v1/palavra";
const PRECO_URL = "https://dadosabertos.compras.gov.br/modulo-pesquisa-preco/1_consultarMaterial";
const MAX_PDMS = 10;
const MAX_ITENS_POR_PDM = 50;

function textoSeguro(valor, limite = 100) {
  return String(valor || "").trim().replace(/\s+/g, " ").slice(0, limite);
}

function marcaUtil(valor) {
  const marca = textoSeguro(valor, 120);
  const normalizada = marca.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  if (!marca || /^[.-]+$/.test(marca) || /^\d{4}$/.test(marca)) return null;
  if (["nao se aplica", "na", "nao informado", "conforme edital", "diversas", "propria", "caneta", "produto", "material"].includes(normalizada)) return null;
  return marca;
}

function selecionarPdms(registros, termo, limite = MAX_PDMS) {
  const busca = textoSeguro(termo).toLocaleLowerCase("pt-BR");
  const buscaSemAcento = busca.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const unicos = new Map();
  for (const registro of registros || []) {
    const codigo = Number(registro.codigoPdm ?? registro.codigoPDM);
    const descricao = textoSeguro(registro.descricaoPDM || registro.nomePdm || registro.descricao);
    if (!Number.isInteger(codigo) || codigo <= 0 || !descricao) continue;
    if (!unicos.has(codigo)) unicos.set(codigo, { codigo, descricao });
  }
  return [...unicos.values()]
    .sort((a, b) => {
      const aInicio = a.descricao.toLocaleLowerCase("pt-BR").startsWith(busca) ? 1 : 0;
      const bInicio = b.descricao.toLocaleLowerCase("pt-BR").startsWith(busca) ? 1 : 0;
      if (aInicio !== bInicio) return bInicio - aInicio;
      // Em buscas curtas, preferir a variação de uso mais comum evita que
      // "caneta" comece por equipamento odontológico ou marcador laser.
      const aDescricao = a.descricao.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const bDescricao = b.descricao.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const aCanonico = aDescricao === `${buscaSemAcento} esferografica` ? 1 : 0;
      const bCanonico = bDescricao === `${buscaSemAcento} esferografica` ? 1 : 0;
      if (aCanonico !== bCanonico) return bCanonico - aCanonico;
      return a.descricao.localeCompare(b.descricao, "pt-BR");
    })
    .slice(0, limite)
    .map((pdm, ordem) => ({ ...pdm, ordem }));
}

function normalizarResultado(linha, pdm) {
  const marca = marcaUtil(linha.marca);
  if (!marca) return null;
  const semAcento = (valor) => textoSeguro(valor, 120).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  if (semAcento(marca) === semAcento(pdm.descricao)) return null;
  return {
    marca,
    produtoCatalogo: pdm.descricao,
    codigoPdm: pdm.codigo,
    ordemCatalogo: pdm.ordem,
    descricaoItem: textoSeguro(linha.descricaoItem || linha.descricaoDetalhadaItem, 500),
    fornecedor: textoSeguro(linha.nomeFornecedor || linha.niFornecedor, 240),
    documentoFornecedor: textoSeguro(linha.niFornecedor, 30),
    valorUnitario: Number(linha.precoUnitario) || null,
    quantidade: Number(linha.quantidade) || null,
    dataResultado: textoSeguro(linha.dataResultado || linha.dataCompra, 20),
    uf: textoSeguro(linha.estado, 2).toUpperCase(),
    municipio: textoSeguro(linha.municipio, 120),
    orgao: textoSeguro(linha.nomeUasg || linha.nomeOrgao, 240),
    compra: textoSeguro(linha.idCompra, 30),
    itemCompra: textoSeguro(linha.idCompraItem || linha.idItemCompra, 30),
    catalogoCodigo: textoSeguro(linha.codigoItemCatalogo, 20),
  };
}

async function buscarJson(url, signal) {
  const resposta = await fetch(url, { headers: { Accept: "application/json" }, signal });
  if (!resposta.ok) throw new Error(`fonte-${resposta.status}`);
  return resposta.json();
}

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  const termo = textoSeguro(event.queryStringParameters?.termo, 100);
  const uf = textoSeguro(event.queryStringParameters?.uf, 2).toUpperCase();
  if (termo.length < 2) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, erro: "Informe ao menos 2 caracteres do produto." }) };
  if (uf && !/^[A-Z]{2}$/.test(uf)) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, erro: "UF inválida." }) };

  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), 18000);
  try {
    const catalogo = await buscarJson(`${CATALOGO_URL}?${new URLSearchParams({ palavra: termo })}`, controlador.signal);
    const pdms = selecionarPdms(catalogo, termo);
    if (!pdms.length) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, itens: [], catalogos: [] }) };

    const consultas = await Promise.allSettled(pdms.map(async (pdm) => {
      const params = new URLSearchParams({ pagina: "1", tamanhoPagina: String(MAX_ITENS_POR_PDM), tipo: "codigoPdm", codigo: String(pdm.codigo), dataResultado: "true" });
      if (uf) params.set("estado", uf);
      const dados = await buscarJson(`${PRECO_URL}?${params}`, controlador.signal);
      return { pdm, itens: (dados.resultado || []).map((linha) => normalizarResultado(linha, pdm)).filter(Boolean) };
    }));
    // Para um termo amplo (por exemplo, "caneta"), o catálogo devolve vários
    // PDMs. Colocar primeiro o PDM com mais registros declarados evita que uma
    // variação rara, como caneta laser, esconda o produto principal pesquisado.
    const grupos = consultas.filter((consulta) => consulta.status === "fulfilled").map((consulta) => consulta.value);
    grupos.sort((a, b) => a.pdm.ordem - b.pdm.ordem || b.itens.length - a.itens.length);
    const itens = grupos.flatMap((grupo) => grupo.itens.sort((a, b) => String(b.dataResultado).localeCompare(String(a.dataResultado))));
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, fonte: "Catálogo e Pesquisa de Preços do Compras.gov", catalogos: pdms, itens: itens.slice(0, 200), consultasComFalha: consultas.filter((c) => c.status === "rejected").length }),
    };
  } catch (erro) {
    return { statusCode: 502, headers, body: JSON.stringify({ ok: false, erro: "Não foi possível consultar as fontes públicas agora." }) };
  } finally {
    clearTimeout(timeout);
  }
};

module.exports.marcaUtil = marcaUtil;
module.exports.selecionarPdms = selecionarPdms;
module.exports.normalizarResultado = normalizarResultado;
