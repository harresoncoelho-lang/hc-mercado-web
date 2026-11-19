// Pesquisa pública de marcas por produto no ecossistema Compras.gov.
//
// Fluxo: termo livre -> PDMs do Catálogo público -> resultados homologados da
// Pesquisa de Preços. A marca é retornada somente quando foi declarada na
// fonte oficial. Não consulta área autenticada ou documentos de participantes.
//
// Usada pela Pesquisa de Preços do painel e pelo "Buscar no mercado" do catálogo e do preço por item.
// Cloudflare (plano gratuito): 1 + MAX_PDMS subrequisições (limite 50) e 10 ms de CPU, por isso
// poucos PDMs bem escolhidos e no máximo 200 linhas lidas por busca (cada linha traz o objeto da compra inteiro).

const CATALOGO_URL = "https://cnbs.estaleiro.serpro.gov.br/cnbs-api/material/v1/palavra";
const PRECO_URL = "https://dadosabertos.compras.gov.br/modulo-pesquisa-preco/1_consultarMaterial";
const LINK_COMPRA = "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/landing?destino=acompanhamento-compra&compra=";
const MAX_PDMS = 6;
// Linhas lidas no total, divididas entre os PDMs (1 PDM = 200 linhas; 6 PDMs = 33 cada). Medido: 300 linhas = 4-7 ms de CPU, perto demais do teto.
const MAX_LINHAS = 200;
// A fonte muda no máximo uma vez por dia; 10 min no navegador/CDN poupam a API pública em buscas repetidas.
const CACHE = "public, max-age=600";

function textoSeguro(valor, limite = 100) {
  return String(valor || "").trim().replace(/\s+/g, " ").slice(0, limite);
}
const semAcento = (valor) => String(valor || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");
const palavras = (valor) => semAcento(valor).replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((p) => p.length > 1);

// A marca da Pesquisa de Preços é texto livre: o fornecedor escreve "Conforme TR", "20L", "Cor: Amarela"
// ou repete a descrição. Só fica o que parece nome de marca; o resto vira "marca não informada" (a compra não some).
const MARCAS_INUTEIS = new Set(["nao se aplica", "na", "n a", "nao informado", "nao informada", "nao consta", "sem marca", "conforme edital", "conforme tr",
  "conforme termo de referencia", "conforme especificacao", "diversas", "diversos", "diverso", "propria", "proprio", "generica", "generico", "similar", "nacional",
  "importado", "importada", "multimarcas", "caneta", "produto", "material", "outros", "outra", "varias", "padrao", "un", "und", "unid", "unidade", "pc", "peca",
  "eco", "ink", "sem", "marca", "fabricante", "marca fabricante", "modelo"]);
// Siglas de 1-2 letras ("sm", "TR", "FC") quase sempre são abreviação ou lixo; estas são marcas de verdade.
const MARCAS_CURTAS = new Set(["3m", "hp", "lg", "bd", "ge"]);
// "Conforme o TR", "de acordo com o edital", "Não especificado": remete ao edital, não declara marca.
const REFERENCIA_EDITAL = /\b(tr|edital|termo de referencia|conforme|de acordo|especificad[ao]s?|especificacao|solicitad[ao]|informad[ao]|exigid[ao]|proposta)\b/;
// Número com unidade em qualquer posição ("20L", "A4 90 gramas", "galão c/ 5 lts"): é embalagem/medida, não marca.
const MEDIDA = /\b\d+( \d+)?\s*(l|lt|lts|litros?|ml|g|gr|grs|gramas?|kg|mm|cm|m|un|und|unid|unidades?|fls?|folhas?|pct|cx)\b/;
// Palavras que sozinhas descrevem embalagem, formato ou cor ("FRASCO 1L", "MILILITRO", "A4 BRANCO").
const NAO_MARCA = new Set(["frasco", "galao", "bombona", "litro", "litros", "mililitro", "mililitros", "grama", "gramas", "quilo", "caixa", "pacote", "resma",
  "embalagem", "rolo", "fardo", "kit", "cx", "pct", "ml", "lt", "kg", "a3", "a4", "a5", "oficio", "carta", "branco", "branca", "azul", "preto", "preta",
  "vermelho", "vermelha", "verde", "amarelo", "amarela", "colorido", "colorida", "transparente", "papel", "sulfite", "com", "de", "c"]);
// Muitas linhas repetem a mesma descrição do CATMAT; normalizar uma vez cabe nos 10 ms de CPU do Cloudflare.
const memoDescricao = new Map();
function palavrasDaDescricao(descricao) {
  if (!memoDescricao.has(descricao)) {
    if (memoDescricao.size > 1000) memoDescricao.clear();
    memoDescricao.set(descricao, new Set(palavras(descricao)));
  }
  return memoDescricao.get(descricao);
}
// "REPORT/REPORT", "NSK - NSK", "ENZ ENZ": o fornecedor repetiu a marca; fica uma vez.
function semRepeticao(marca) {
  const partes = marca.split(/\s*[/|]\s*|\s+-\s+/).filter(Boolean);
  if (partes.length > 1 && partes.every((p) => semAcento(p) === semAcento(partes[0]))) return partes[0];
  const p = marca.split(" ");
  const meio = p.length / 2;
  return p.length % 2 === 0 && semAcento(p.slice(0, meio).join(" ")) === semAcento(p.slice(meio).join(" ")) ? p.slice(0, meio).join(" ") : marca;
}
function marcaUtil(valor, descricao = "") {
  const marca = semRepeticao(textoSeguro(valor, 120).replace(/^[\s.,;:/|-]+|[\s.,;:/|-]+$/g, "").replace(/^marca\s*:\s*/i, ""));
  const normalizada = semAcento(marca).replace(/[^a-z0-9]+/g, " ").trim();
  if (MARCAS_CURTAS.has(normalizada)) return marca;
  if (!marca || !/[a-z]/.test(normalizada) || /^\d{4}$/.test(marca) || /r\$|\d+,\d{2}\b/i.test(marca)) return null;
  if (MARCAS_INUTEIS.has(normalizada) || /^(cor|tipo|tamanho|material|capacidade|conforme)\b/.test(normalizada) || MEDIDA.test(normalizada)) return null;
  if (REFERENCIA_EDITAL.test(normalizada)) return null;
  // "PRÓPRIA/PRÓPRIO", "Diversas / genérica": cada parte é texto genérico.
  if (marca.split(/\s*[/|]\s*/).every((p) => MARCAS_INUTEIS.has(semAcento(p).replace(/[^a-z0-9]+/g, " ").trim()))) return null;
  const tokens = normalizada.split(" ");
  if (!MARCAS_CURTAS.has(normalizada) && tokens.every((t) => t.replace(/\d/g, "").length <= 2)) return null;
  if (tokens.every((t) => /^\d/.test(t) || NAO_MARCA.has(t))) return null;
  // Todas as palavras da "marca" já estão na descrição do item: é característica, não marca ("térmico", "A4 90 gramas").
  const descricaoPalavras = palavrasDaDescricao(descricao);
  if (descricaoPalavras.size && palavras(marca).every((p) => descricaoPalavras.has(p))) return null;
  return marca;
}

// "BIC / Modelo Cristal", "Marca: Faber; Modelo: 1212", "Fabricante: X": separa quando a fonte escreveu os rótulos.
function separarMarcaModelo(texto) {
  const t = textoSeguro(texto, 120);
  const fabricante = /\bfabricante\s*:?\s*([^;,/|]+)/i.exec(t)?.[1]?.trim() || null;
  const m = /^(?:marca\s*:?\s*)?(.*?)[\s,;/|-]*\bmod(?:elo|\.)\s*:?\s*([^;,|]+)/i.exec(t);
  const marca = (m ? m[1] : t).replace(/\bfabricante\s*:?.*$/i, "").replace(/^marca\s*:?\s*/i, "").replace(/[\s,;/|-]+$/, "").trim();
  return { marca: marca || t, modelo: m ? m[2].replace(/\bfabricante\s*:?.*$/i, "").trim() || null : null, fabricante };
}

// Preço da fonte (número com até 4 casas) -> centavos inteiros, arredondando meio centavo para cima, sem float.
function centavosDoPreco(valor) {
  const t = typeof valor === "number" ? (Number.isFinite(valor) ? String(valor) : "") : String(valor ?? "").trim();
  const m = /^(\d{1,13})(?:\.(\d+))?$/.exec(t);
  if (!m) return null;
  const casas = (m[2] || "").padEnd(3, "0");
  const c = Number(m[1]) * 100 + Number(casas.slice(0, 2)) + (Number(casas[2]) >= 5 ? 1 : 0);
  return c > 0 ? c : null;
}

// Especificação no termo ("papel A4", "caneta azul", "detergente 500 ml"): medida, formato de papel e cor.
// O catálogo público não filtra por isso; aqui cada compra é marcada se a descrição dela tem esses atributos.
const CORES = [["azul", "azu(?:l|is)"], ["preta", "pret[ao]s?"], ["vermelha", "vermelh[ao]s?"], ["verde", "verdes?"], ["amarela", "amarel[ao]s?"],
  ["branca", "branc[ao]s?"], ["rosa", "rosas?"], ["roxa", "rox[ao]s?"], ["laranja", "laranjas?"], ["cinza", "cinzas?"], ["marrom", "marro(?:m|ns)"]];
const FORMATOS = { a3: [297, 420], a4: [210, 297], a5: [148, 210], oficio: [216, 330], carta: [216, 279] };
// Unidade -> [grandeza, fator para a menor unidade]. 1,5 L = 1500 ml; 0,5 kg = 500 g.
const UNIDADES = { ml: ["volume", 1], l: ["volume", 1000], lt: ["volume", 1000], lts: ["volume", 1000], litro: ["volume", 1000], litros: ["volume", 1000],
  g: ["massa", 1], gr: ["massa", 1], grs: ["massa", 1], grama: ["massa", 1], gramas: ["massa", 1], kg: ["massa", 1000], mm: ["comprimento", 1], cm: ["comprimento", 10], m: ["comprimento", 1000] };
const RE_MEDIDA = /(\d{1,6})(?:[.,](\d{1,3}))?\s*(ml|litros?|lts?|l|gramas?|grs?|g|kg|mm|cm|m)(?![a-z])/g;
// Valor em milésimos da menor unidade, só com inteiros ("0,5 l" -> 500000).
const medidasDe = (texto) => [...semAcento(texto).matchAll(RE_MEDIDA)].map((m) => {
  const [grandeza, fator] = UNIDADES[m[3]];
  return { grandeza, valor: (Number(m[1]) * 1000 + Number((m[2] || "").padEnd(3, "0"))) * fator, texto: m[0].replace(/\s+/g, " ") };
});
function separarEspecificacao(termo) {
  const busca = semAcento(textoSeguro(termo));
  const atributos = medidasDe(busca).map((m) => ({ rotulo: m.texto, confere: (d) => medidasDe(d).some((x) => x.grandeza === m.grandeza && x.valor === m.valor) }));
  let resto = busca.replace(RE_MEDIDA, " ");
  for (const [nome, [a, b]] of Object.entries(FORMATOS)) {
    const re = new RegExp(`\\b${nome}\\b`);
    if (!re.test(resto)) continue;
    resto = resto.replace(re, " ");
    // "A4" na descrição do CATMAT aparece como "TAMANHO (C X L): 297 X 210 MM".
    const medida = new RegExp(`\\b(${a}\\s*(mm)?\\s*x\\s*${b}|${b}\\s*(mm)?\\s*x\\s*${a})\\b`);
    atributos.push({ rotulo: nome.toUpperCase(), confere: (d) => re.test(semAcento(d)) || medida.test(semAcento(d)) });
  }
  for (const [rotulo, raiz] of CORES) {
    const re = new RegExp(`\\b${raiz}\\b`);
    if (!re.test(resto)) continue;
    resto = resto.replace(re, " ");
    atributos.push({ rotulo, confere: (d) => re.test(semAcento(d)) });
  }
  return { produto: resto.replace(/\s+/g, " ").trim(), atributos };
}

// Termo amplo devolve dezenas de PDMs. Ordem: apelido conhecido, nome igual ao termo, mais palavras do
// termo no nome, nome começando pelo termo, alfabética. Ex.: "papel A4" não está no nome de PDM nenhum.
// shortcut: apelidos fixos para os produtos mais buscados; trocar por busca de itens do CATMAT se a lista crescer.
const APELIDOS = [[/\b(a4|sulfite|oficio|chamex)\b/, "papel para impressao formatado"], [/^caneta$/, "caneta esferografica"]];
function selecionarPdms(registros, termo, limite = MAX_PDMS) {
  const completo = semAcento(textoSeguro(termo));
  const apelido = APELIDOS.find(([re]) => re.test(completo))?.[1];
  // "caneta esferográfica azul": "azul" não está no nome de PDM nenhum; sem tirá-lo, entram caneta odontológica e afins.
  const busca = separarEspecificacao(termo).produto || completo;
  const termos = palavras(busca);
  const unicos = new Map();
  for (const registro of registros || []) {
    const codigo = Number(registro.codigoPdm ?? registro.codigoPDM);
    const descricao = textoSeguro(registro.descricaoPDM || registro.nomePdm || registro.descricao);
    if (!Number.isInteger(codigo) || codigo <= 0 || !descricao) continue;
    if (!unicos.has(codigo)) unicos.set(codigo, { codigo, descricao });
  }
  const nota = (pdm) => {
    const nome = semAcento(pdm.descricao);
    const doNome = new Set(palavras(nome));
    return [nome === apelido ? 1 : 0, nome === busca ? 1 : 0, termos.filter((p) => doNome.has(p)).length, nome.startsWith(busca) ? 1 : 0];
  };
  const notas = [...unicos.values()].map((pdm) => ({ pdm, n: nota(pdm) }));
  // Havendo PDM do apelido ou com todas as palavras do termo, os parciais ("Caneta - indicador" para "caneta esferográfica",
  // "Dobradeira papel" para "papel A4") só gastam consulta e dividem as 200 linhas com o produto certo.
  // "papel A4": sem o "A4" sobra "papel", que casaria papel alumínio, almaço…; com especificação no termo, o apelido manda.
  const doApelido = busca !== completo ? notas.filter((x) => x.n[0]) : [];
  const completos = doApelido.length ? doApelido : notas.filter((x) => x.n[0] || x.n[2] === termos.length);
  return (completos.length ? completos : notas)
    .sort((a, b) => b.n[0] - a.n[0] || b.n[1] - a.n[1] || b.n[2] - a.n[2] || b.n[3] - a.n[3] || a.pdm.descricao.localeCompare(b.pdm.descricao, "pt-BR"))
    .slice(0, limite)
    .map(({ pdm }, ordem) => ({ ...pdm, ordem }));
}

function normalizarResultado(linha, pdm) {
  const descricaoItem = textoSeguro(linha.descricaoItem || linha.descricaoDetalhadaItem, 500);
  const util = marcaUtil(linha.marca, descricaoItem);
  // "DETERGENTE DESINCRUS" ou a própria categoria: o fornecedor repetiu o nome do produto no campo marca.
  const declarada = util && semAcento(util) !== semAcento(pdm.descricao) && palavras(util)[0] !== palavras(pdm.descricao)[0] ? util : null;
  // Sem marca aproveitável a compra continua (preço e órgão valem), no grupo "marca não informada".
  const { marca, modelo, fabricante } = declarada ? separarMarcaModelo(declarada) : { marca: null, modelo: null, fabricante: null };
  // idCompra vem como número JSON de 17 dígitos (> 2^53): o JSON.parse arredonda (…025 vira …024). O idCompraItem vem
  // como texto = idCompra + 5 dígitos do item; dele sai o número exato. Sem ele, só aceita o número se ainda for exato.
  const itemCompra = textoSeguro(linha.idCompraItem || linha.idItemCompra, 30);
  const compra = /^\d{13,25}$/.test(String(linha.idCompraItem || "")) ? String(linha.idCompraItem).slice(0, -5)
    : typeof linha.idCompra === "string" || Number.isSafeInteger(linha.idCompra) ? textoSeguro(linha.idCompra, 30) : "";
  return {
    marca,
    modelo,
    fabricante,
    produtoCatalogo: pdm.descricao,
    codigoPdm: pdm.codigo,
    ordemCatalogo: pdm.ordem,
    descricaoItem,
    fornecedor: textoSeguro(linha.nomeFornecedor || linha.niFornecedor, 240),
    documentoFornecedor: textoSeguro(linha.niFornecedor, 30),
    valorUnitario: Number(linha.precoUnitario) || null,
    valorUnitarioCentavos: centavosDoPreco(linha.precoUnitario),
    quantidade: Number(linha.quantidade) || null,
    unidade: textoSeguro(linha.siglaUnidadeFornecimento, 20).toUpperCase(),
    unidadeNome: textoSeguro(linha.nomeUnidadeFornecimento, 60),
    // "FR" sozinho não diz o tamanho; a fonte informa a capacidade à parte (FR 500 ML, EMB 5 L).
    embalagem: Number(linha.capacidadeUnidadeFornecimento) > 0 && linha.siglaUnidadeMedida ? textoSeguro(`${linha.capacidadeUnidadeFornecimento} ${linha.siglaUnidadeMedida}`, 30).toUpperCase() : null,
    dataResultado: textoSeguro(linha.dataResultado || linha.dataCompra, 20),
    uf: textoSeguro(linha.estado, 2).toUpperCase(),
    municipio: textoSeguro(linha.municipio, 120),
    orgao: textoSeguro(linha.nomeUasg || linha.nomeOrgao, 240),
    compra,
    itemCompra,
    catalogoCodigo: textoSeguro(linha.codigoItemCatalogo, 20),
    link: /^\d{8,25}$/.test(compra) ? LINK_COMPRA + compra : null,
  };
}

// especificacao: true = a descrição tem todos os atributos do termo; false = diferente; null = termo sem atributo.
// Muitas linhas repetem a descrição: uma conferência por descrição (teto de CPU do Cloudflare).
function marcarEspecificacao(itens, termo) {
  const { atributos } = separarEspecificacao(termo);
  const memo = new Map();
  return itens.map((item) => {
    if (!atributos.length) return { ...item, especificacao: null };
    const texto = `${item.descricaoItem} ${item.embalagem || ""}`;
    if (!memo.has(texto)) memo.set(texto, atributos.every((a) => a.confere(texto)));
    return { ...item, especificacao: memo.get(texto) };
  });
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
    if (!pdms.length) return { statusCode: 200, headers: { ...headers, "Cache-Control": CACHE }, body: JSON.stringify({ ok: true, itens: [], catalogos: [] }) };

    const tamanhoPagina = Math.max(10, Math.floor(MAX_LINHAS / pdms.length));
    const consultas = await Promise.allSettled(pdms.map(async (pdm) => {
      const params = new URLSearchParams({ pagina: "1", tamanhoPagina: String(tamanhoPagina), tipo: "codigoPdm", codigo: String(pdm.codigo), dataResultado: "true" });
      if (uf) params.set("estado", uf);
      const dados = await buscarJson(`${PRECO_URL}?${params}`, controlador.signal);
      return { pdm, itens: (dados.resultado || []).map((linha) => normalizarResultado(linha, pdm)).filter(Boolean) };
    }));
    // Para um termo amplo (por exemplo, "caneta"), o catálogo devolve vários
    // PDMs. Colocar primeiro o PDM com mais registros declarados evita que uma
    // variação rara, como caneta laser, esconda o produto principal pesquisado.
    const grupos = consultas.filter((consulta) => consulta.status === "fulfilled").map((consulta) => consulta.value);
    grupos.sort((a, b) => a.pdm.ordem - b.pdm.ordem || b.itens.length - a.itens.length);
    const itens = marcarEspecificacao(grupos.flatMap((grupo) => grupo.itens.sort((a, b) => String(b.dataResultado).localeCompare(String(a.dataResultado)))).slice(0, MAX_LINHAS), termo);
    const falhas = consultas.filter((c) => c.status === "rejected").length;
    return {
      statusCode: 200,
      // Resposta parcial (alguma consulta falhou) não fica em cache: a próxima busca tenta de novo.
      headers: falhas ? headers : { ...headers, "Cache-Control": CACHE },
      body: JSON.stringify({ ok: true, fonte: "Catálogo e Pesquisa de Preços do Compras.gov", catalogos: pdms, atributos: separarEspecificacao(termo).atributos.map((a) => a.rotulo), itens, consultasComFalha: falhas }),
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
module.exports.separarMarcaModelo = separarMarcaModelo;
module.exports.centavosDoPreco = centavosDoPreco;
module.exports.separarEspecificacao = separarEspecificacao;
module.exports.marcarEspecificacao = marcarEspecificacao;
module.exports.MAX_PDMS = MAX_PDMS;
