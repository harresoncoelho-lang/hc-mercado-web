// Licitação anterior no robô (chamado por scripts/esteira_processos.js):
//   etapaHistorico      tarefa 'historico' da esteira: lê o edital no PNCP, acha as contratações anteriores
//                       do mesmo órgão e produto (netlify/functions/_licitacao_anterior.js), completa todos os
//                       participantes pelo arquivo semanal de propostas e grava nas tabelas historico_*.
//                       O casamento item do edital × item anterior fica em operacao_esteira_tarefas.detalhe.
//   completarConsultas  consultas avulsas (historico_consultas 'parcial') que a função não completou:
//                       a função no Cloudflare não baixa o arquivo de propostas (90 MB por mês).
// Env opcionais: ANOS_HISTORICO (3), PAUSA_MS_HISTORICO (400 entre chamadas às fontes),
// MAX_COMPRAS_HISTORICO (12), MAX_CATMATS_HISTORICO (80), MESES_PROPOSTAS_HISTORICO (4 arquivos por tarefa),
// PROPOSTAS_HISTORICO ("0" desliga o arquivo de propostas), MAX_MB_ZIP_PROPOSTAS (500), MAX_MB_CSV_PROPOSTAS (5000:
// teto do CSV descompactado, contado no fluxo real, não no header do ZIP), TIMEOUT_MS_PROPOSTAS (600000 = 10 min),
// DIAS_CACHE_CONSULTAS (30: consulta avulsa guardada há mais que isso é apagada, prazo da política de privacidade).
// ComprasNet antigo (pregões até 2023, páginas públicas sem captcha: netlify/functions/_comprasnet_antigo.js):
// COMPRASNET_ANTIGO ("0" desliga), MAX_PREGOES_COMPRASNET_ANTIGO (6 pregões por tarefa; cada um são 4 páginas),
// PAUSA_MS_COMPRASNET_ANTIGO (1500 entre páginas; nunca abaixo disso). A ata com captcha nunca é aberta.
// Recorte do arquivo de propostas: só as linhas das compras/itens casados (no teste real, 1 compra de
// 233 itens tinha 3.041 propostas no mês; os 2 itens de café, 14). Nada do resto do arquivo é gravado.
const L = require("../netlify/functions/_licitacao_anterior");
const CN = require("../netlify/functions/_comprasnet_antigo");
const { semCpf } = require("../netlify/functions/_cpf");
// LGPD: marca/fabricante/modelo são texto livre do fornecedor; sem HTML e sem CPF (o CHECK do banco recusa).
const textoLivre = (v) => (v ? semCpf(String(v).replace(/<[^>]*>/g, " "), " ").replace(/\s+/g, " ").trim().slice(0, 120) || null : null);
const { referencia } = require("../netlify/functions/importar-item-pncp");

const ANOS = Math.max(1, Number(process.env.ANOS_HISTORICO || 3));
const PAUSA_MS = Math.max(0, Number(process.env.PAUSA_MS_HISTORICO ?? 400));
const MAX_COMPRAS = Math.max(1, Number(process.env.MAX_COMPRAS_HISTORICO || 12));
const MAX_CATMATS = Math.max(1, Number(process.env.MAX_CATMATS_HISTORICO || 80));
const MESES_PROPOSTAS = Math.max(0, Number(process.env.MESES_PROPOSTAS_HISTORICO ?? 4));
const PROPOSTAS_LIGADO = process.env.PROPOSTAS_HISTORICO !== "0";
const MAX_ZIP = Math.max(1, Number(process.env.MAX_MB_ZIP_PROPOSTAS || 500)) * 1024 * 1024;
const MAX_CSV = Math.max(1, Number(process.env.MAX_MB_CSV_PROPOSTAS || 5000)) * 1024 * 1024;
const TIMEOUT_MS = Math.max(1000, Number(process.env.TIMEOUT_MS_PROPOSTAS || 600000));
const DIAS_CACHE = Math.max(1, Number(process.env.DIAS_CACHE_CONSULTAS || 30));
const ANTIGO_LIGADO = process.env.COMPRASNET_ANTIGO !== "0";
const MAX_PREGOES_ANTIGOS = Math.max(0, Number(process.env.MAX_PREGOES_COMPRASNET_ANTIGO ?? 6));
const PAUSA_MS_ANTIGO = Math.max(CN.PAUSA_MINIMA_MS, Number(process.env.PAUSA_MS_COMPRASNET_ANTIGO || CN.PAUSA_MINIMA_MS));
const PROPOSTAS = "https://repositorio.dados.gov.br/seges/comprasgov/propostas";
const MAX_CASAMENTOS_DETALHE = 1500;
const q = encodeURIComponent;
const { corpoComTeto } = require("./coletar_sancoes_cgu");

class ErroHistorico extends Error {}

async function pncpJson(fetchPncp, url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetchPncp(url, { headers: { Accept: "application/json", "User-Agent": L.UA }, signal: ctrl.signal });
    if (r.status === 204 || r.status === 404) return null;
    if (!r.ok) throw Object.assign(new Error(`PNCP HTTP ${r.status}`), { status: r.status });
    return await r.json();
  } finally { clearTimeout(timer); }
}

// Cabeçalho do edital: /api/consulta é a fonte principal; fora do ar (5xx, timeout, rede) cai na /api/pncp/v1,
// que devolve o mesmo cadastro da compra. 4xx não troca de fonte: o pedido é que está errado.
async function cabecalhoDoEdital(fetchPncp, ref) {
  const caminho = `orgaos/${ref.cnpj}/compras/${ref.ano}/${Number(ref.seq)}`;
  try { return await pncpJson(fetchPncp, `https://pncp.gov.br/api/consulta/v1/${caminho}`); }
  catch (e) {
    if (e.status && e.status < 500) throw e;
    console.warn(`[historico] /api/consulta falhou (${String(e.message || e).slice(0, 120)}); usando /api/pncp/v1`);
    return pncpJson(fetchPncp, `https://pncp.gov.br/api/pncp/v1/${caminho}`);
  }
}

// Baixa um mês do arquivo de propostas e passa as linhas ao filtro sem descompactar o CSV inteiro (1,2 GB).
// shortcut: o zip (~90 MB) fica inteiro na memória para achar a entrada; serve no GitHub Actions (7 GB).
async function lerMesPropostas(mes, filtro, { fetchImpl = (...a) => fetch(...a), maxZip = MAX_ZIP, maxCsv = MAX_CSV } = {}) {
  const AdmZip = require("adm-zip");
  const zlib = require("node:zlib");
  const [ano, mm] = mes.split("/");
  const r = await fetchImpl(`${PROPOSTAS}/${ano}/${mm}/propostas-${ano}-${mm}.csv.zip`, { headers: { "User-Agent": L.UA }, signal: globalThis.AbortSignal.timeout(TIMEOUT_MS) });
  if (r.status === 404) return { mes, linhas: 0, bytes: 0 };
  if (!r.ok) throw new Error(`Arquivo de propostas ${mes}: HTTP ${r.status}`);
  const zip = await corpoComTeto(r, maxZip);
  const entrada = new AdmZip(zip).getEntries().find((e) => e.entryName.endsWith(".csv"));
  if (!entrada) throw new Error(`Arquivo de propostas ${mes} sem CSV`);
  let resto = "", linhas = 0, bytesCsv = 0;
  const consumir = (pedaco) => {
    bytesCsv += pedaco.length;
    if (bytesCsv > maxCsv) throw new Error(`Arquivo de propostas ${mes}: CSV passou de ${Math.round(maxCsv / 1048576)} MB descompactado`);
    resto += pedaco.toString("utf8");
    let i;
    while ((i = resto.indexOf("\n")) >= 0) { filtro.linha(resto.slice(0, i)); resto = resto.slice(i + 1); linhas++; }
  };
  if (entrada.header.method === 0) consumir(entrada.getCompressedData());
  else {
    await new Promise((ok, falha) => {
      const s = zlib.createInflateRaw();
      s.on("data", (p) => { try { consumir(p); } catch (e) { s.destroy(e); } }).on("end", ok).on("error", falha);
      s.end(entrada.getCompressedData());
    });
  }
  if (resto.trim()) { filtro.linha(resto); linhas++; }
  return { mes, linhas, bytes: zip.length };
}

// Todos os participantes dos itens casados (só compras do Compras.gov: o arquivo não cobre outras plataformas).
async function propostasDosCasados({ compras, casamentos }, { fetchImpl, lerMes = lerMesPropostas }) {
  const alvos = new Map();
  for (const c of casamentos) {
    if (!L.decifrarIdCompra(c.id_compra)) continue;
    if (!alvos.has(c.id_compra)) alvos.set(c.id_compra, new Set());
    alvos.get(c.id_compra).add(c.numero_item);
  }
  const resumo = { meses: [], linhasLidas: 0, bytes: 0, participacoes: 0, itens: 0 };
  if (!PROPOSTAS_LIGADO || !alvos.size || !MESES_PROPOSTAS) return { linhas: [], resumo };
  const filtro = L.criarFiltroPropostas(alvos);
  for (const mes of L.mesesDePropostas(compras.filter((c) => alvos.has(c.id_compra)), MESES_PROPOSTAS)) {
    const r = await lerMes(mes, filtro, { fetchImpl });
    resumo.meses.push(mes); resumo.linhasLidas += r.linhas; resumo.bytes += r.bytes;
  }
  const { linhas, itens } = filtro.resultado();
  resumo.participacoes = linhas.length; resumo.itens = itens;
  return { linhas, resumo };
}

// Itens do edital atual: alvo do casamento (número, CATMAT, descrição, estimado).
async function itensDoEdital(fetchPncp, ref) {
  const alvos = [];
  for (let p = 1; p <= 2; p++) {
    const lista = await pncpJson(fetchPncp, `https://pncp.gov.br/api/pncp/v1/orgaos/${ref.cnpj}/compras/${ref.ano}/${Number(ref.seq)}/itens?pagina=${p}&tamanhoPagina=500`);
    for (const it of Array.isArray(lista) ? lista : []) {
      if (!Number.isSafeInteger(it?.numeroItem)) continue;
      alvos.push({ numero: it.numeroItem, catmat: String(it.catalogoCodigoItem || "").replace(/\D/g, "") || null,
        descricao: String(it.descricao || "").slice(0, 300), valor_estimado: Number(it.valorUnitarioEstimado) || null });
    }
    if (!Array.isArray(lista) || lista.length < 500) break;
  }
  return alvos;
}

// Pregões antigos do ComprasNet (plataforma "ComprasNet (antigo)": só a Pesquisa de Preços os conhece e ela traz só o
// vencedor e a marca): lê as páginas públicas sem captcha e devolve linhas para gravar, só dos itens pedidos
// (numeros: Map id_compra -> Set(numero_item)). Cada pregão são 4 páginas com pausa de 1,5 s; um que falha não
// derruba os outros. Compra já lida (fonte gravada) não é lida de novo.
// Linhas sem chave nula: o upsert por colunas não pode apagar a marca que a Pesquisa de Preços já gravou.
const semNulos = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
async function lerComprasAntigas({ compras, numeros }, { rest, fetchImpl = (...a) => fetch(...a), esperar = (ms) => new Promise((r) => setTimeout(r, ms)), agora = Date.now, leitor = null } = {}) {
  const saida = { compras: [], itens: [], participacoes: [], resumo: { pregoes: 0, lidos: 0, jaLidos: 0, naoAchados: 0, falhas: 0 } };
  if (!ANTIGO_LIGADO || !MAX_PREGOES_ANTIGOS) return saida;
  const candidatas = compras.filter((c) => c.plataforma === "ComprasNet (antigo)" && numeros.get(c.id_compra)?.size);
  if (!candidatas.length) return saida;
  const lidas = new Set((await (await rest(`historico_compras?id_compra=in.(${candidatas.map((c) => `"${c.id_compra}"`).join(",")})&fonte=eq.comprasnet-antigo&select=id_compra`)).json()).map((x) => x.id_compra));
  const ler = leitor || CN.criarLeitor({ fetchImpl, esperar, pausaMs: PAUSA_MS_ANTIGO, agora, orcamento: MAX_PREGOES_ANTIGOS * 4 });
  const quando = new Date(agora()).toISOString();
  for (const c of candidatas) {
    saida.resumo.pregoes++;
    if (lidas.has(c.id_compra)) { saida.resumo.jaLidos++; continue; }
    if (saida.resumo.lidos + saida.resumo.naoAchados + saida.resumo.falhas >= MAX_PREGOES_ANTIGOS) break;
    const d = L.decifrarIdCompra(c.id_compra);
    let res;
    try { res = await CN.lerPregaoAntigo({ uasg: d.uasg, numero: d.numero, ano: d.ano }, ler); } catch (e) {
      saida.resumo.falhas++;
      console.warn(`[historico] ComprasNet antigo ${c.id_compra}: ${String(e.message || e).slice(0, 160)}`);
      if (/Orçamento/.test(e.message)) break;
      continue;
    }
    if (!res) { saida.resumo.naoAchados++; continue; }
    saida.resumo.lidos++;
    saida.compras.push(semNulos({ id_compra: c.id_compra, link_origem: res.url, fonte: "comprasnet-antigo", fonte_lida_em: quando, data_publicacao: c.data_publicacao ? null : res.data }));
    for (const n of numeros.get(c.id_compra)) {
      const it = res.itens.get(n);
      if (!it) continue;
      const cancelado = /cancel|fracass|desert|anulad|revogad/i.test(it.situacao || "");
      saida.itens.push(semNulos({ id_compra: c.id_compra, numero_item: n, situacao_item: it.situacao, motivo_situacao: it.motivo, tem_recurso: it.tem_recurso,
        valor_estimado: it.valor_estimado, tem_resultado: !cancelado && Boolean(it.ni) }));
      if (cancelado || !it.ni) continue;
      saida.participacoes.push(semNulos({ id_compra: c.id_compra, numero_item: n, ...L.fornecedor(it.ni, it.nome, "pp"), ordem_classificacao: 1,
        situacao_resultado: it.situacao, valor_homologado: it.valor_unitario, quantidade_homologada: it.qtd_lance ?? it.quantidade, data_resultado: res.data,
        marca: textoLivre(L.normalizarMarca(it.marca, it.descricao)), marca_declarada: textoLivre(it.marca),
        fabricante: textoLivre(it.fabricante), modelo: textoLivre(it.modelo), descricao_ofertada: it.ofertado }));
    }
  }
  return saida;
}
const numerosPorCompra = (itens) => {
  const m = new Map();
  for (const i of itens) { if (!m.has(i.id_compra)) m.set(i.id_compra, new Set()); m.get(i.id_compra).add(i.numero_item); }
  return m;
};

async function etapaHistorico(tarefa, { rest, fetchPncp = (...a) => fetch(...a), esperar, agora = Date.now, lerMes }) {
  const [p] = await (await rest(`operacao_processos?id=eq.${q(tarefa.processo_id)}&empresa_id=eq.${q(tarefa.empresa_id)}` +
    `&organizacao_id=eq.${q(tarefa.organizacao_id)}&select=id,url_origem,origem_externa_id,numero`)).json();
  if (!p) throw new ErroHistorico("Processo indisponível.");
  const ref = referencia(p);
  const cab = await cabecalhoDoEdital(fetchPncp, ref);
  const uasg = String(cab?.unidadeOrgao?.codigoUnidade || "").replace(/\D/g, "");
  if (!uasg) throw new ErroHistorico("Edital sem unidade compradora no PNCP.");
  const idAtual = String(cab.linkSistemaOrigem || "").match(/[?&]compra=(\d{17})\b/)?.[1] || null;
  // O PNCP manda catalogoCodigoItem nulo nos itens do Compras.gov: o CATMAT/PDM vem dos dados abertos.
  const catalogo = idAtual ? await L.catalogoDaCompra(idAtual, { fetchImpl: fetchPncp }) : null;
  const alvos = (await itensDoEdital(fetchPncp, ref)).map((a) => ({ ...a, catmat: a.catmat || catalogo?.get(a.numero)?.catmat || null,
    pdm: catalogo?.get(a.numero)?.pdm || null }));
  // Item ainda sem CATMAT (comum fora do Compras.gov): busca por palavras do objeto do edital.
  const palavrasBusca = alvos.some((a) => !a.catmat) ? L.palavras(cab.objetoCompra).slice(0, 3).join(" ") : "";
  const r = await L.coletar({ uasg, alvos, palavrasBusca, excluir: [idAtual, cab.numeroControlePNCP], desdeAno: Number(ref.ano) - ANOS,
    fetchImpl: fetchPncp, orcamento: 2000, maxCompras: MAX_COMPRAS, maxItensPorCompra: 1000, maxCatmats: MAX_CATMATS, esperar, pausaMs: PAUSA_MS });
  const prop = await propostasDosCasados(r, { fetchImpl: fetchPncp, lerMes });
  // Pregões até 2023 (ComprasNet antigo): marca, descrição ofertada, situação e motivo, sem captcha. Falha aqui não derruba a etapa.
  const antigos = await lerComprasAntigas({ compras: r.compras, numeros: numerosPorCompra(r.itens) }, { rest, fetchImpl: fetchPncp, esperar, agora })
    .catch((e) => { console.warn(`[historico] ComprasNet antigo: ${String(e.message || e).slice(0, 160)}`); return null; });
  await L.gravar(rest, { compras: [...r.compras, ...(antigos?.compras || [])], itens: [...r.itens, ...(antigos?.itens || [])],
    participacoes: [...r.participacoes, ...prop.linhas, ...(antigos?.participacoes || [])] });
  return { uasg, unidade: cab.unidadeOrgao?.nomeUnidade || null, orgao_cnpj: ref.cnpj, compras: r.compras.map((c) => c.id_compra),
    casamentos: r.casamentos.slice(0, MAX_CASAMENTOS_DETALHE), totalCasamentos: r.casamentos.length,
    alvos: alvos.map(({ numero, catmat, pdm, descricao, valor_estimado }) => ({ numero, catmat, pdm, descricao: descricao.slice(0, 200), valor_estimado })),
    parcial: r.parcial, avisos: r.avisos, chamadas: r.chamadas, propostas: prop.resumo, comprasnet_antigo: antigos?.resumo || null, gerado_em: new Date(agora()).toISOString() };
}

// Consultas avulsas pendentes: completa participantes pelo arquivo de propostas e marca 'completo'.
async function completarConsultas({ rest, fetchPncp = (...a) => fetch(...a), lerMes, limite = 3 }) {
  // A esteira chama isto a cada rodada: o prazo de guarda do cache vai junto (falha só avisa, não trava a fila).
  try { console.log(`[historico] cache de consultas: ${JSON.stringify(await limparCacheConsultas(rest))} apagadas (> ${DIAS_CACHE} dias)`); }
  catch (e) { console.warn(`[historico] limpeza do cache: ${String(e.message || e).slice(0, 200)}`); }
  const pendentes = await (await rest(`historico_consultas?situacao=eq.parcial&select=chave,compras,casamentos&order=gerado_em.asc&limit=${limite}`)).json();
  let feitas = 0;
  for (const c of pendentes) {
    try {
      const compras = c.compras.length ? await (await rest(`historico_compras?id_compra=in.(${c.compras.map((x) => `"${x}"`).join(",")})&select=id_compra,data_publicacao,plataforma`)).json() : [];
      const prop = await propostasDosCasados({ compras, casamentos: c.casamentos }, { fetchImpl: fetchPncp, lerMes });
      const antigos = await lerComprasAntigas({ compras, numeros: numerosPorCompra(c.casamentos) }, { rest, fetchImpl: fetchPncp }).catch(() => null);
      if (prop.linhas.length || antigos?.compras.length) await L.gravar(rest, { compras: antigos?.compras || [], itens: antigos?.itens || [], participacoes: [...prop.linhas, ...(antigos?.participacoes || [])] });
      await rest(`historico_consultas?chave=eq.${q(c.chave)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ situacao: "completo", erro: null }) });
      feitas++;
    } catch (e) {
      await rest(`historico_consultas?chave=eq.${q(c.chave)}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ situacao: "falhou", erro: String(e.message || e).slice(0, 300) }) });
    }
  }
  return feitas;
}

// Prazo de guarda do cache de consultas (historico_consultas e historico_cnpj_consultas): RPC só do service_role.
async function limparCacheConsultas(rest, dias = DIAS_CACHE) {
  const r = await rest("rpc/historico_limpar_cache", { method: "POST", body: JSON.stringify({ p_dias: dias }) });
  return r.json();
}

module.exports = { etapaHistorico, completarConsultas, lerComprasAntigas, limparCacheConsultas, propostasDosCasados, lerMesPropostas, ErroHistorico };
