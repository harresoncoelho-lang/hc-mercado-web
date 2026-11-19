// Licitação anterior: acha as contratações anteriores do mesmo órgão (UASG) e do mesmo produto e junta,
// com fonte, o vencedor, o preço, o cadastro reserva, a situação do item, a marca e os participantes.
// Um núcleo só para os dois usos:
//   - robô da esteira (scripts/esteira_processos.js, etapa 'historico'): orçamento grande, com pausa;
//   - consulta avulsa (/api/licitacao-anterior no Cloudflare): orçamento de 40 chamadas, abaixo das
//     50 subrequisições do plano grátis (as 2 a 3 do Supabase ficam fora desse teto).
// Fontes públicas e sem captcha:
//   - Pesquisa de Preços do Compras.gov (dados abertos): por UASG + CATMAT, já traz cada item vencido com
//     vencedor, preço e marca, de vários anos, numa chamada. É a descoberta principal.
//   - PNCP /api/search: acha a contratação pelo id do Compras.gov e, por palavras, as do mesmo órgão.
//   - PNCP /api/pncp/v1 itens e resultados: situação do item (fracassado/deserto), estimado, cadastro
//     reserva (ordem 2, 3...) e motivo do cancelamento.
//   - Arquivo semanal de propostas (repositorio.dados.gov.br, CSV ";" zipado): todos os participantes com
//     classificação e valores. Só no robô (90 MB zipados e 1,2 GB de CSV por mês).
// O que fica de fora e por quê: o motivo de desclassificação, o chat e a ata completa estão na página
// pública do Compras.gov, que exige hCaptcha em cada chamada (etapa 4, pela extensão com a pessoa na frente).
const { marcaUtil, separarMarcaModelo } = require("./comprasgov-marcas-produto");
const { semCpf } = require("./_cpf");

const PNCP = "https://pncp.gov.br";
const PESQUISA = "https://dadosabertos.compras.gov.br/modulo-pesquisa-preco/1_consultarMaterial";
// Sem User-Agent de navegador alguns endpoints do PNCP resetam a conexão (ver pncp-proxy.js).
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const TIMEOUT_MS = 15000;
// O arquivo de propostas (scripts/historico_licitacoes.js) é lido só no robô; aqui ficam o filtro e os meses.
const MAX_PROPOSTAS_ITEM = 30;
// PNCP: portes-empresa. O arquivo de propostas usa os mesmos códigos.
const PORTES = { 1: "ME", 2: "EPP", 3: "Demais", 4: "Não se aplica", 5: "Não informado" };

class SemOrcamento extends Error {}

const texto = (v, max) => (v === null || v === undefined ? null : String(v).replace(/\s+/g, " ").trim().slice(0, max) || null);
const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const numero = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const inteiro = (v) => (Number.isSafeInteger(Number(v)) && String(v).trim() !== "" ? Number(v) : null);
const digitos = (v) => String(v ?? "").replace(/\D/g, "");

// Palavras que descrevem o produto. Rótulos de atributo do CATMAT ("apresentação:", "tipo:") e medidas
// não contam: estão em quase todo item e fariam "café" casar com "açúcar".
const PARADAS = new Set(("de da do das dos e em para com sem a o as os um uma por ou no na nos nas ao aos tipo cor material " +
  "apresentacao aplicacao caracteristicas adicionais unidade fornecimento embalagem empacotamento formato tamanho modelo " +
  "marca referencia similar equivalente qualidade superior conforme termo edital item lote mínimo minimo maximo cada medida " +
  "dimensoes comprimento largura altura peso capacidade volume quantidade intensidade composicao uso " +
  "aquisicao contratacao registro precos eventual futura objeto destinados destinado atender necessidades demanda").split(" "));
function palavras(descricao) {
  const vistas = [];
  for (const p of semAcento(descricao).split(/[^a-z0-9]+/)) {
    if (p.length < 3 || /\d/.test(p) || PARADAS.has(p) || vistas.includes(p)) continue;
    vistas.push(p);
    if (vistas.length === 8) break;
  }
  return vistas;
}

// Casamento item do edital × item anterior, do mais forte ao mais fraco. A primeira palavra é o nome do
// produto: as duas descrições têm de começar por ela, senão "papel A4" casaria com "pasta de papel A4".
function casar(alvo, anterior) {
  const c1 = digitos(alvo?.catmat), c2 = digitos(anterior?.catmat);
  if (c1 && c2) return c1 === c2 ? { confianca: "alta", regra: "mesmo item de catálogo (CATMAT)" } : casarPdm(alvo, anterior);
  const pdm = casarPdm(alvo, anterior);
  if (pdm) return pdm;
  const a = palavras(alvo?.descricao), b = palavras(anterior?.descricao);
  if (!a.length || !b.length || a[0] !== b[0]) return null;
  const comuns = a.filter((p) => b.includes(p)).length;
  const semelhanca = comuns / new Set([...a, ...b]).size;
  if (a.length === 1 || (comuns >= 2 && semelhanca >= 0.25)) {
    return { confianca: "baixa", regra: "descrição parecida", semelhanca: Math.round(semelhanca * 100) / 100 };
  }
  return null;
}
function casarPdm(alvo, anterior) {
  const p1 = digitos(alvo?.pdm), p2 = digitos(anterior?.pdm);
  return p1 && p2 && p1 === p2 ? { confianca: "media", regra: "mesmo produto do catálogo (PDM), tamanho ou tipo diferente" } : null;
}
const PESO = { alta: 3, media: 2, baixa: 1 };
function melhorCasamento(alvos, anterior) {
  let melhor = null;
  for (const alvo of alvos) {
    const c = casar(alvo, anterior);
    if (c && (!melhor || PESO[c.confianca] > PESO[melhor.casamento.confianca])) melhor = { alvo, casamento: c };
  }
  return melhor;
}

// Marca digitada pelo licitante é suja ("500GR", "Conforme Termo de Re..."): sem marca útil fica null e a
// tela mostra "não informada". Nunca deduz marca da descrição.
// Sobras vistas nos pregões da SUFRAMA (nov/2026) que o filtro geral de marcaUtil deixa passar.
const MARCA_VAZIA = /^(o mesmo|a mesma|mesma|mesmo|uso geral|original|originais|ondulad[ao]s?|comum|standard|qualidade|1a linha|primeira linha|sem referencia)$/;
function normalizarMarca(bruta, descricao) {
  const util = marcaUtil(bruta, descricao);
  if (!util || MARCA_VAZIA.test(chaveMarca(util))) return null;
  return texto(separarMarcaModelo(util).marca, 120);
}
const chaveMarca = (m) => semAcento(m).replace(/[^a-z0-9]+/g, " ").trim();

// CPF nunca entra no banco: pessoa física vira "Pessoa física" sem documento (o nome dela é dado pessoal).
function fornecedor(ni, nome, sufixoPf) {
  const d = digitos(ni);
  // Razão social de MEI vem com o CPF do titular no fim ("FULANA DE TAL 97048143215"): o CPF sai, o resto é público.
  if (d.length === 14) return { fornecedor_chave: d, fornecedor_ni: d, fornecedor_nome: texto(semCpf(nome, " "), 300) };
  return { fornecedor_chave: `pf:${sufixoPf}`.slice(0, 40), fornecedor_ni: null, fornecedor_nome: "Pessoa física" };
}

// id do Compras.gov: UASG(6) + modalidade(2) + número(5) + ano(4). O JSON da Pesquisa de Preços manda
// idCompra como número > 2^53 (arredonda); o idCompraItem vem como texto = idCompra + 5 dígitos do item.
function idDaLinhaPesquisa(linha) {
  const item = String(linha?.idCompraItem || "");
  if (/^\d{22}$/.test(item)) return item.slice(0, 17);
  return typeof linha?.idCompra === "string" && /^\d{17}$/.test(linha.idCompra) ? linha.idCompra : null;
}
function decifrarIdCompra(id) {
  const m = /^(\d{6})(\d{2})(\d{5})(\d{4})$/.exec(String(id || ""));
  if (!m) return null;
  return { uasg: m[1], modalidade: Number(m[2]), numero: m[3], ano: Number(m[4]), lei14133: m[3][0] === "9" };
}
// link_sistema_origem vem do PNCP (cadastrado pelo órgão) e vira href na tela: só https e hosts oficiais.
// Mesma lista de licitacao-anterior-ui.js (última barreira antes do href).
const HOSTS_OFICIAIS = new Set(["pncp.gov.br", "dadosabertos.compras.gov.br", "contratos.comprasnet.gov.br",
  "cnetmobile.estaleiro.serpro.gov.br", "comprasnet.gov.br", "www.comprasnet.gov.br"]);
function linkOficial(u) {
  try {
    const url = new URL(String(u || ""));
    return url.protocol === "https:" && HOSTS_OFICIAIS.has(url.hostname) && !url.username && !url.password ? url.href.slice(0, 500) : null;
  } catch { return null; }
}
function linkCompraGov(id) {
  return decifrarIdCompra(id) ? `https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/landing?destino=acompanhamento-compra&compra=${id}` : null;
}
const idDoLink = (link) => /[?&]compra=(\d{17})\b/.exec(String(link || ""))?.[1] || null;

// Leitor de uma linha do CSV ";" com aspas (padrão do repositório). Aspas dobradas dentro do campo = aspas.
function lerLinhaCsv(linha) {
  const campos = [];
  let atual = "", aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (aspas) {
      if (c === '"' && linha[i + 1] === '"') { atual += '"'; i++; } else if (c === '"') aspas = false; else atual += c;
    } else if (c === '"') aspas = true;
    else if (c === ";") { campos.push(atual); atual = ""; } else if (c !== "\r") atual += c;
  }
  campos.push(atual);
  return campos;
}

// Filtro do arquivo de propostas: recebe as linhas uma a uma (o CSV inteiro não cabe na memória com folga)
// e guarda só as das compras/itens pedidos. alvos: Map(id_compra -> Set(numero_item)).
function criarFiltroPropostas(alvos) {
  let cab = null;
  const porItem = new Map();
  return {
    linha(l) {
      if (!cab) { cab = Object.fromEntries(lerLinhaCsv(l.replace(/^\uFEFF/, "")).map((n, i) => [n, i])); return; }
      // Atalho barato antes de ler a linha: o id da compra é a 2ª coluna.
      const i = l.indexOf('";"');
      const id = i < 0 ? "" : l.slice(i + 3, l.indexOf('"', i + 3));
      const itens = alvos.get(id);
      if (!itens) return;
      const c = lerLinhaCsv(l);
      const n = inteiro(c[cab.numero_item]);
      if (!n || !itens.has(n)) return;
      const chave = `${id}|${n}`;
      if (!porItem.has(chave)) porItem.set(chave, []);
      porItem.get(chave).push(c);
    },
    resultado() {
      const linhas = [];
      for (const [chave, lista] of porItem) {
        const [id, n] = chave.split("|");
        const ordenada = lista.sort((a, b) => (inteiro(a[cab.classificacao]) ?? 1e9) - (inteiro(b[cab.classificacao]) ?? 1e9));
        for (const c of ordenada.slice(0, MAX_PROPOSTAS_ITEM)) {
          const uf = String(c[cab.uf] || "").toUpperCase();
          linhas.push({
            id_compra: id, numero_item: Number(n),
            ...fornecedor(c[cab.identificacao_participante], c[cab.nome_participante], `p${c[cab.id] || c[cab.classificacao]}`),
            porte: PORTES[c[cab.porte_empresa_participante]] || null, uf: /^[A-Z]{2}$/.test(uf) ? uf : null,
            classificacao: inteiro(c[cab.classificacao]), valor_proposta: numero(c[cab.valor_proposta_calculado]),
            valor_lance: numero(c[cab.valor_lance_calculado]), valor_negociado: numero(c[cab.valor_negociado_julgamento_calculado]),
          });
        }
      }
      return { linhas, itens: porItem.size };
    },
  };
}

// Meses de arquivo a ler: o arquivo é particionado pelo mês de inclusão do item, que fica perto da
// publicação da compra; o mês seguinte entra para pegar o item incluído depois.
function mesesDePropostas(compras, teto) {
  const meses = new Set();
  for (const c of compras) {
    const m = /^(\d{4})-(\d{2})/.exec(String(c.data_publicacao || ""));
    if (!m || Number(m[1]) < 2022) continue;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
    for (const k of [0, 1]) {
      const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 1));
      meses.add(`${x.getUTCFullYear()}/${String(x.getUTCMonth() + 1).padStart(2, "0")}`);
    }
  }
  return [...meses].sort().reverse().slice(0, teto);
}

// Chamada externa com timeout e orçamento. Orçamento acabou: para tudo e devolve o que já tem (parcial).
function criarBuscador({ fetchImpl, orcamento, esperar, pausaMs }) {
  let restante = orcamento;
  let primeira = true;
  return {
    get usadas() { return orcamento - restante; },
    async json(url) {
      if (restante <= 0) throw new SemOrcamento("orçamento de chamadas esgotado");
      restante -= 1;
      if (!primeira && pausaMs) await esperar(pausaMs);
      primeira = false;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const r = await fetchImpl(url, { headers: { Accept: "application/json", "User-Agent": UA }, signal: ctrl.signal });
        if (r.status === 204 || r.status === 404) return null;
        if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
        return await r.json();
      } finally { clearTimeout(timer); }
    },
  };
}

function compraDaBusca(i) {
  const m = /^\/compras\/(\d{14})\/(\d{4})\/(\d+)$/.exec(String(i?.item_url || ""));
  if (!m) return null;
  const id = idDoLink(i.link_sistema_origem) || i.numero_controle_pncp;
  return {
    id_compra: id, numero_controle_pncp: texto(i.numero_controle_pncp, 60), orgao_cnpj: m[1], orgao_nome: texto(i.orgao_nome, 300),
    uasg: digitos(i.unidade_codigo) || null, unidade_nome: texto(i.unidade_nome, 300), ano: Number(m[2]), numero: texto(i.numero || i.title, 40),
    modalidade: texto(i.modalidade_licitacao_nome, 80), plataforma: texto(i.usuario_nome, 80) || (idDoLink(i.link_sistema_origem) ? "Compras.gov.br" : null),
    situacao: texto(i.situacao_nome, 80), objeto: texto(i.description, 1000), data_publicacao: texto(i.data_publicacao_pncp, 10),
    link_origem: linkOficial(i.link_sistema_origem) || linkCompraGov(id), link_pncp: `${PNCP}/app/editais/${m[1]}/${m[2]}/${m[3]}`,
    _ref: { cnpj: m[1], ano: m[2], seq: m[3] },
  };
}

// Compra só conhecida pela Pesquisa de Preços (pregão antigo, fora do PNCP): fica com o link do Compras.gov.
function compraSoPeloId(id, linha) {
  const d = decifrarIdCompra(id);
  return {
    id_compra: id, numero_controle_pncp: null, orgao_cnpj: null, orgao_nome: texto(linha?.nomeOrgao, 300), uasg: d?.uasg || null,
    unidade_nome: texto(linha?.nomeUasg, 300), ano: d?.ano || null, numero: d ? `${d.numero}/${d.ano}` : null,
    modalidade: d?.modalidade === 5 ? "Pregão" : null, plataforma: d?.lei14133 ? "Compras.gov.br" : "ComprasNet (antigo)",
    situacao: null, objeto: texto(linha?.objetoCompra, 1000), data_publicacao: texto(linha?.dataCompra, 10),
    link_origem: linkCompraGov(id), link_pncp: null, _ref: null,
  };
}

const DADOS_ABERTOS = "https://dadosabertos.compras.gov.br/modulo-contratacoes";

function participacaoDoResultado(id, n, r) {
  const uf = String(r.ufFornecedor || "").toUpperCase();
  return { id_compra: id, numero_item: n, ...fornecedor(r.niFornecedor, r.nomeRazaoSocialFornecedor, `r${r.sequencialResultado || r.ordemClassificacaoSrp || 0}`),
    porte: texto(r.porteFornecedorNome, 40), uf: /^[A-Z]{2}$/.test(uf) ? uf : null,
    ordem_classificacao: inteiro(r.ordemClassificacaoSrp), situacao_resultado: texto(r.situacaoCompraItemResultadoNome, 80),
    valor_homologado: numero(r.valorUnitarioHomologado), quantidade_homologada: numero(r.quantidadeHomologada),
    data_resultado: texto(r.dataResultadoPncp || r.dataResultado, 10), motivo_cancelamento: texto(r.motivoCancelamento, 1000) };
}
// Número do item na compra = 5 últimos dígitos do idCompraItem (o mesmo da Pesquisa de Preços e do arquivo de propostas).
const numeroDoItem = (l) => inteiro(/^\d{22}$/.test(String(l?.idCompraItem || "")) ? String(l.idCompraItem).slice(-5) : l?.numeroItemCompra ?? l?.numeroItemPncp);

// Compra do Compras.gov (Lei 14.133) pelos dados abertos: cabeçalho, itens com CATMAT/PDM e todos os resultados
// em 3 chamadas. O PNCP não traz o CATMAT desses itens (catalogoCodigoItem vem nulo). Falhou: cai no PNCP.
async function fonteDadosAbertos(b, c) {
  const q = `tipo=idCompra&codigo=${c.id_compra}`;
  try {
    const cab = (await b.json(`${DADOS_ABERTOS}/1.1_consultarContratacoes_PNCP_14133_Id?${q}`))?.resultado?.[0];
    if (!cab) return null;
    const itensDa = await b.json(`${DADOS_ABERTOS}/2.1_consultarItensContratacoes_PNCP_14133_Id?${q}`);
    const res = await b.json(`${DADOS_ABERTOS}/3.1_consultarResultadoItensContratacoes_PNCP_14133_Id?${q}`);
    Object.assign(c, {
      numero_controle_pncp: texto(cab.numeroControlePNCP, 60), orgao_cnpj: digitos(cab.orgaoEntidadeCnpj) || null, orgao_nome: texto(cab.orgaoEntidadeRazaoSocial, 300),
      uasg: digitos(cab.unidadeOrgaoCodigoUnidade) || c.uasg, unidade_nome: texto(cab.unidadeOrgaoNomeUnidade, 300), ano: inteiro(cab.anoCompraPncp) || c.ano,
      numero: `${cab.numeroCompra}/${cab.anoCompraPncp}`, modalidade: texto(cab.modalidadeNome, 80), plataforma: "Compras.gov.br",
      situacao: texto(cab.situacaoCompraNomePncp, 80), objeto: texto(cab.objetoCompra, 1000), data_publicacao: texto(cab.dataPublicacaoPncp, 10),
      link_origem: linkCompraGov(c.id_compra),
      link_pncp: cab.orgaoEntidadeCnpj ? `${PNCP}/app/editais/${digitos(cab.orgaoEntidadeCnpj)}/${cab.anoCompraPncp}/${cab.sequencialCompraPncp}` : null,
    });
    const resultados = new Map();
    for (const r of res?.resultado || []) {
      const n = numeroDoItem(r);
      if (!n) continue;
      if (!resultados.has(n)) resultados.set(n, []);
      resultados.get(n).push(r);
    }
    return {
      itens: (itensDa?.resultado || []).map((it) => ({ n: numeroDoItem(it), catmat: digitos(it.codItemCatalogo) || null, pdm: digitos(it.codigoPdm) || null,
        descricao: it.descricaodetalhada || it.descricaoResumida, quantidade: it.quantidade, unidade: it.unidadeMedida, valor_estimado: it.valorUnitarioEstimado,
        situacao: it.situacaoCompraItemNome, temResultado: it.temResultado === true })).filter((it) => it.n),
      resultados, parcial: Number(itensDa?.paginasRestantes) > 0 || Number(res?.paginasRestantes) > 0,
      // Fora de c: a coluna uf de historico_compras só existe com analise_cnpj.sql (a licitação anterior não a grava).
      uf: /^[A-Z]{2}$/.test(String(cab.unidadeOrgaoUfSigla || "")) ? cab.unidadeOrgaoUfSigla : null,
    };
  } catch (e) {
    if (e instanceof SemOrcamento) throw e;
    return null;
  }
}

// Qualquer plataforma pelo PNCP: acha a compra (se veio só o id do Compras.gov) e lista os itens.
async function fontePncp(b, c) {
  if (!c._ref && decifrarIdCompra(c.id_compra)) {
    const r = await b.json(`${PNCP}/api/search?q=${c.id_compra}&tipos_documento=edital&pagina=1&tam_pagina=3`);
    const achada = (r?.items || []).map(compraDaBusca).find((x) => x && x.id_compra === c.id_compra);
    if (achada) Object.assign(c, achada, { objeto: achada.objeto || c.objeto });
  }
  if (!c._ref) return null;
  const lista = await b.json(`${PNCP}/api/pncp/v1/orgaos/${c._ref.cnpj}/compras/${c._ref.ano}/${c._ref.seq}/itens?pagina=1&tamanhoPagina=500`);
  return { ref: c._ref, itens: (Array.isArray(lista) ? lista : []).map((it) => ({ n: inteiro(it.numeroItem), catmat: digitos(it.catalogoCodigoItem) || null, pdm: null,
    descricao: it.descricao, quantidade: it.quantidade, unidade: it.unidadeMedida, valor_estimado: it.valorUnitarioEstimado,
    situacao: it.situacaoCompraItemNome, temResultado: it.temResultado === true })).filter((it) => it.n), resultados: null, parcial: false };
}

// Itens do edital atual com CATMAT/PDM (dados abertos); null se a fonte falhar (o robô segue só com o PNCP).
async function catalogoDaCompra(id, { fetchImpl = (...a) => fetch(...a) } = {}) {
  const b = criarBuscador({ fetchImpl, orcamento: 1, esperar: async () => {}, pausaMs: 0 });
  try {
    const r = await b.json(`${DADOS_ABERTOS}/2.1_consultarItensContratacoes_PNCP_14133_Id?tipo=idCompra&codigo=${id}`);
    return new Map((r?.resultado || []).map((it) => [numeroDoItem(it), { catmat: digitos(it.codItemCatalogo) || null, pdm: digitos(it.codigoPdm) || null,
      descricao: it.descricaodetalhada || it.descricaoResumida }]).filter(([n]) => n));
  } catch { return null; }
}

/**
 * Coleta as contratações anteriores. alvos: [{numero, catmat, pdm, descricao}] (itens do edital ou o produto
 * da tela avulsa). Devolve linhas prontas para historico_compras/itens/participacoes e os casamentos.
 */
async function coletar({ uasg, alvos, palavrasBusca = "", excluir = [], desdeAno, fetchImpl = (...a) => fetch(...a),
  orcamento = 40, maxCompras = 5, maxItensPorCompra = 4, maxCatmats = 6, esperar = (ms) => new Promise((r) => setTimeout(r, ms)), pausaMs = 0 }) {
  const b = criarBuscador({ fetchImpl, orcamento, esperar, pausaMs });
  const fora = new Set(excluir.filter(Boolean).map(String));
  const compras = new Map(), itens = new Map(), participacoes = new Map(), casamentos = [];
  const candidatos = new Map(); // id_compra -> Map(numero_item -> {catmat, pdm, descricao, linha})
  const avisos = [];
  let parcial = false;
  const alvosLista = (alvos || []).map((a) => ({ ...a, catmat: digitos(a.catmat) || null, pdm: digitos(a.pdm) || null }));
  const guardarParticipacao = (p) => {
    const k = `${p.id_compra}|${p.numero_item}|${p.fornecedor_chave}`;
    participacoes.set(k, { ...(participacoes.get(k) || {}), ...p });
  };
  try {
    // 1) Pesquisa de Preços por UASG + CATMAT: descobre os itens vencidos com marca.
    const todosCatmats = [...new Set(alvosLista.map((a) => a.catmat).filter(Boolean))];
    const catmats = todosCatmats.slice(0, maxCatmats);
    if (todosCatmats.length > catmats.length) { parcial = true; avisos.push(`Só os primeiros ${catmats.length} de ${todosCatmats.length} itens de catálogo foram pesquisados.`); }
    for (const catmat of catmats) {
      const q = new URLSearchParams({ tipo: "codigoItemCatalogo", codigo: catmat, codigoUasg: uasg, pagina: "1", tamanhoPagina: "500",
        dataCompraInicio: `${desdeAno}-01-01` });
      let dados;
      try { dados = await b.json(`${PESQUISA}?${q}`); } catch (e) { if (e instanceof SemOrcamento) throw e; avisos.push(`Pesquisa de Preços indisponível (CATMAT ${catmat}).`); continue; }
      for (const l of dados?.resultado || []) {
        const id = idDaLinhaPesquisa(l), n = inteiro(l.numeroItemCompra);
        // A fonte ignora dataCompraInicio em parte das linhas: o período é conferido aqui pelo ano do id.
        if (!id || !n || fora.has(id) || (decifrarIdCompra(id)?.ano || 0) < desdeAno) continue;
        if (!candidatos.has(id)) candidatos.set(id, new Map());
        candidatos.get(id).set(n, { catmat, pdm: digitos(l.codigoPdm) || null, descricao: l.descricaoItem, linha: l });
        for (const a of alvosLista) if (a.catmat === catmat && !a.pdm) a.pdm = digitos(l.codigoPdm) || null;
        if (!compras.has(id)) compras.set(id, compraSoPeloId(id, l));
        const marca = normalizarMarca(l.marca, l.descricaoItem);
        guardarParticipacao({ id_compra: id, numero_item: n, ...fornecedor(l.niFornecedor, l.nomeFornecedor, "pp"),
          marca, marca_declarada: texto(l.marca, 120) });
        if (!itens.has(`${id}|${n}`)) itens.set(`${id}|${n}`, { id_compra: id, numero_item: n, catmat, pdm: digitos(l.codigoPdm) || null,
          descricao: texto(l.descricaoDetalhadaItem || l.descricaoItem, 600), quantidade: numero(l.quantidade), unidade: texto(l.siglaUnidadeFornecimento, 60),
          valor_estimado: null, situacao_item: "Homologado", tem_resultado: true });
      }
    }

    // 2) Por palavras: contratações encerradas do mesmo órgão no PNCP (acha também a que só fracassou).
    if (palavrasBusca) {
      const sug = await b.json(`${PNCP}/api/search/suggest?tipos_documento=edital&campo=unidades&q=${encodeURIComponent(uasg)}&tam_pagina=20`);
      const ids = (sug?.items || []).filter((u) => digitos(u.codigo) === uasg).map((u) => u.id).filter(Boolean);
      if (ids.length) {
        const q = new URLSearchParams({ q: palavrasBusca, tipos_documento: "edital", unidades: ids.join("|"), ordenacao: "-data", pagina: "1", tam_pagina: "10" });
        const r = await b.json(`${PNCP}/api/search?${q}`);
        for (const i of r?.items || []) {
          const c = compraDaBusca(i);
          if (!c || fora.has(c.id_compra) || fora.has(c.numero_controle_pncp) || c.ano < desdeAno) continue;
          compras.set(c.id_compra, { ...(compras.get(c.id_compra) || {}), ...c });
          if (!candidatos.has(c.id_compra)) candidatos.set(c.id_compra, new Map());
        }
      }
    }

    // 3) Por contratação, da mais nova para a mais antiga: itens (situação, estimado, CATMAT) e resultados.
    const ordem = [...compras.values()].sort((x, y) => String(y.data_publicacao || "").localeCompare(String(x.data_publicacao || ""))).slice(0, maxCompras);
    for (const sobra of [...compras.keys()].filter((id) => !ordem.some((c) => c.id_compra === id))) {
      compras.delete(sobra); candidatos.delete(sobra);
      for (const k of [...itens.keys()]) if (k.startsWith(`${sobra}|`)) itens.delete(k);
      for (const k of [...participacoes.keys()]) if (k.startsWith(`${sobra}|`)) participacoes.delete(k);
    }
    for (const c of ordem) {
      const fonte = (decifrarIdCompra(c.id_compra)?.lei14133 && await fonteDadosAbertos(b, c)) || await fontePncp(b, c);
      if (!fonte) continue; // pregão antigo, fora do PNCP: fica o que a Pesquisa de Preços trouxe
      const conhecidos = candidatos.get(c.id_compra) || new Map();
      const casados = [];
      for (const it of fonte.itens) {
        const ant = { catmat: it.catmat || conhecidos.get(it.n)?.catmat || null, pdm: it.pdm || conhecidos.get(it.n)?.pdm || null, descricao: it.descricao };
        const m = melhorCasamento(alvosLista, ant);
        if (!m) continue;
        itens.set(`${c.id_compra}|${it.n}`, { ...(itens.get(`${c.id_compra}|${it.n}`) || {}), id_compra: c.id_compra, numero_item: it.n, catmat: ant.catmat, pdm: ant.pdm,
          descricao: texto(it.descricao, 600), quantidade: numero(it.quantidade), unidade: texto(it.unidade, 60),
          valor_estimado: numero(it.valor_estimado), situacao_item: texto(it.situacao, 80), tem_resultado: it.temResultado });
        casados.push({ n: it.n, m, temResultado: it.temResultado });
      }
      casados.sort((x, y) => PESO[y.m.casamento.confianca] - PESO[x.m.casamento.confianca]);
      for (const { n, m } of casados) casamentos.push({ item_edital: m.alvo.numero ?? null, id_compra: c.id_compra, numero_item: n, ...m.casamento });
      if (fonte.parcial) parcial = true;
      if (fonte.resultados) {
        // Dados abertos: todos os resultados da compra numa chamada.
        const quero = new Set(casados.map((x) => x.n));
        for (const [n, linhas] of fonte.resultados) if (quero.has(n)) for (const r of linhas) guardarParticipacao(participacaoDoResultado(c.id_compra, n, r));
        continue;
      }
      // PNCP: uma chamada por item; o teto por compra segura o orçamento da tela avulsa (fortes primeiro).
      const comResultado = casados.filter((x) => x.temResultado);
      for (const { n } of comResultado.slice(0, maxItensPorCompra)) {
        const res = await b.json(`${PNCP}/api/pncp/v1/orgaos/${fonte.ref.cnpj}/compras/${fonte.ref.ano}/${fonte.ref.seq}/itens/${n}/resultados`);
        for (const r of Array.isArray(res) ? res : []) guardarParticipacao(participacaoDoResultado(c.id_compra, n, r));
      }
      if (comResultado.length > maxItensPorCompra) parcial = true;
    }
    // Itens que só a Pesquisa de Preços conhece (pregão antigo): casamento pelo catálogo, sem PNCP.
    for (const [id, mapa] of candidatos) {
      for (const [n, info] of mapa) {
        if (casamentos.some((x) => x.id_compra === id && x.numero_item === n)) continue;
        const m = melhorCasamento(alvosLista, info);
        if (m) casamentos.push({ item_edital: m.alvo.numero ?? null, id_compra: id, numero_item: n, ...m.casamento });
      }
    }
  } catch (e) {
    if (!(e instanceof SemOrcamento)) throw e;
    parcial = true;
    avisos.push("Limite de consultas desta busca atingido: o robô completa o restante.");
  }
  // Participação sem item gravado (item que caiu do teto) não entra: a FK do banco exige o item.
  const linhasItens = [...itens.values()];
  const chavesItens = new Set(linhasItens.map((i) => `${i.id_compra}|${i.numero_item}`));
  return {
    compras: [...compras.values()].filter((c) => [...chavesItens].some((k) => k.startsWith(`${c.id_compra}|`))).map(({ _ref, ...c }) => c),
    itens: linhasItens,
    participacoes: [...participacoes.values()].filter((p) => chavesItens.has(`${p.id_compra}|${p.numero_item}`)),
    casamentos: casamentos.filter((x) => chavesItens.has(`${x.id_compra}|${x.numero_item}`)),
    parcial, avisos, chamadas: b.usadas,
  };
}

// PostgREST exige as mesmas chaves em todas as linhas do lote: cada fonte manda só as suas colunas,
// então o upsert vai por grupo de colunas (assim a marca gravada não vira null quando chega o PNCP).
async function upsertPorColunas(rest, tabela, conflito, linhas, resolucao = "merge-duplicates") {
  const grupos = new Map();
  for (const l of linhas) {
    const chave = Object.keys(l).sort().join(",");
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push({ ...l, atualizado_em: new Date().toISOString() });
  }
  for (const lote of grupos.values()) {
    for (let i = 0; i < lote.length; i += 500) {
      await rest(`${tabela}?on_conflict=${conflito}`, { method: "POST", headers: { Prefer: `resolution=${resolucao},return=minimal` },
        body: JSON.stringify(lote.slice(i, i + 500)) });
    }
  }
}

async function gravar(rest, { compras, itens, participacoes }) {
  // Ordem das chaves estrangeiras: compra -> item -> participação.
  if (compras.length) await upsertPorColunas(rest, "historico_compras", "id_compra", compras);
  if (itens.length) await upsertPorColunas(rest, "historico_itens", "id_compra,numero_item", itens);
  if (participacoes.length) await upsertPorColunas(rest, "historico_participacoes", "id_compra,numero_item,fornecedor_chave", participacoes);
}

module.exports = { UA, coletar, catalogoDaCompra, gravar, upsertPorColunas, casar, melhorCasamento, palavras, normalizarMarca, chaveMarca, fornecedor, lerLinhaCsv, criarFiltroPropostas,
  mesesDePropostas, decifrarIdCompra, linkCompraGov, linkOficial, idDaLinhaPesquisa, compraDaBusca, SemOrcamento, MAX_PROPOSTAS_ITEM,
  criarBuscador, fonteDadosAbertos, fontePncp, participacaoDoResultado, PORTES };
