// Licitação anterior no robô (chamado por scripts/esteira_processos.js):
//   etapaHistorico      tarefa 'historico' da esteira: lê o edital no PNCP, acha as contratações anteriores
//                       do mesmo órgão e produto (netlify/functions/_licitacao_anterior.js), completa todos os
//                       participantes pelo arquivo semanal de propostas e grava nas tabelas historico_*.
//                       O casamento item do edital × item anterior fica em operacao_esteira_tarefas.detalhe.
//   completarConsultas  consultas avulsas (historico_consultas 'parcial') que a função não completou:
//                       a função no Cloudflare não baixa o arquivo de propostas (90 MB por mês).
// Env opcionais: ANOS_HISTORICO (3), PAUSA_MS_HISTORICO (400 entre chamadas às fontes),
// MAX_COMPRAS_HISTORICO (12), MAX_CATMATS_HISTORICO (80), MESES_PROPOSTAS_HISTORICO (4 arquivos por tarefa),
// PROPOSTAS_HISTORICO ("0" desliga o arquivo de propostas).
// Recorte do arquivo de propostas: só as linhas das compras/itens casados (no teste real, 1 compra de
// 233 itens tinha 3.041 propostas no mês; os 2 itens de café, 14). Nada do resto do arquivo é gravado.
const L = require("../netlify/functions/_licitacao_anterior");
const { referencia } = require("../netlify/functions/importar-item-pncp");

const ANOS = Math.max(1, Number(process.env.ANOS_HISTORICO || 3));
const PAUSA_MS = Math.max(0, Number(process.env.PAUSA_MS_HISTORICO ?? 400));
const MAX_COMPRAS = Math.max(1, Number(process.env.MAX_COMPRAS_HISTORICO || 12));
const MAX_CATMATS = Math.max(1, Number(process.env.MAX_CATMATS_HISTORICO || 80));
const MESES_PROPOSTAS = Math.max(0, Number(process.env.MESES_PROPOSTAS_HISTORICO ?? 4));
const PROPOSTAS_LIGADO = process.env.PROPOSTAS_HISTORICO !== "0";
const PROPOSTAS = "https://repositorio.dados.gov.br/seges/comprasgov/propostas";
const MAX_CASAMENTOS_DETALHE = 1500;
const q = encodeURIComponent;

class ErroHistorico extends Error {}

async function pncpJson(fetchPncp, url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetchPncp(url, { headers: { Accept: "application/json", "User-Agent": L.UA }, signal: ctrl.signal });
    if (r.status === 204 || r.status === 404) return null;
    if (!r.ok) throw new Error(`PNCP HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

// Baixa um mês do arquivo de propostas e passa as linhas ao filtro sem descompactar o CSV inteiro (1,2 GB).
// shortcut: o zip (~90 MB) fica inteiro na memória para achar a entrada; serve no GitHub Actions (7 GB).
async function lerMesPropostas(mes, filtro, { fetchImpl = (...a) => fetch(...a) } = {}) {
  const AdmZip = require("adm-zip");
  const zlib = require("node:zlib");
  const [ano, mm] = mes.split("/");
  const r = await fetchImpl(`${PROPOSTAS}/${ano}/${mm}/propostas-${ano}-${mm}.csv.zip`, { headers: { "User-Agent": L.UA } });
  if (r.status === 404) return { mes, linhas: 0, bytes: 0 };
  if (!r.ok) throw new Error(`Arquivo de propostas ${mes}: HTTP ${r.status}`);
  const zip = Buffer.from(await r.arrayBuffer());
  const entrada = new AdmZip(zip).getEntries().find((e) => e.entryName.endsWith(".csv"));
  if (!entrada) throw new Error(`Arquivo de propostas ${mes} sem CSV`);
  let resto = "", linhas = 0;
  const consumir = (pedaco) => {
    resto += pedaco.toString("utf8");
    let i;
    while ((i = resto.indexOf("\n")) >= 0) { filtro.linha(resto.slice(0, i)); resto = resto.slice(i + 1); linhas++; }
  };
  if (entrada.header.method === 0) consumir(entrada.getCompressedData());
  else {
    await new Promise((ok, falha) => {
      const s = zlib.createInflateRaw();
      s.on("data", consumir).on("end", ok).on("error", falha);
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

async function etapaHistorico(tarefa, { rest, fetchPncp = (...a) => fetch(...a), esperar, agora = Date.now, lerMes }) {
  const [p] = await (await rest(`operacao_processos?id=eq.${q(tarefa.processo_id)}&empresa_id=eq.${q(tarefa.empresa_id)}` +
    `&organizacao_id=eq.${q(tarefa.organizacao_id)}&select=id,url_origem,origem_externa_id,numero`)).json();
  if (!p) throw new ErroHistorico("Processo indisponível.");
  const ref = referencia(p);
  const cab = await pncpJson(fetchPncp, `https://pncp.gov.br/api/consulta/v1/orgaos/${ref.cnpj}/compras/${ref.ano}/${Number(ref.seq)}`);
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
  await L.gravar(rest, { compras: r.compras, itens: r.itens, participacoes: [...r.participacoes, ...prop.linhas] });
  return { uasg, unidade: cab.unidadeOrgao?.nomeUnidade || null, orgao_cnpj: ref.cnpj, compras: r.compras.map((c) => c.id_compra),
    casamentos: r.casamentos.slice(0, MAX_CASAMENTOS_DETALHE), totalCasamentos: r.casamentos.length,
    alvos: alvos.map(({ numero, catmat, pdm, descricao, valor_estimado }) => ({ numero, catmat, pdm, descricao: descricao.slice(0, 200), valor_estimado })),
    parcial: r.parcial, avisos: r.avisos, chamadas: r.chamadas, propostas: prop.resumo, gerado_em: new Date(agora()).toISOString() };
}

// Consultas avulsas pendentes: completa participantes pelo arquivo de propostas e marca 'completo'.
async function completarConsultas({ rest, fetchPncp = (...a) => fetch(...a), lerMes, limite = 3 }) {
  const pendentes = await (await rest(`historico_consultas?situacao=eq.parcial&select=chave,compras,casamentos&order=gerado_em.asc&limit=${limite}`)).json();
  let feitas = 0;
  for (const c of pendentes) {
    try {
      const compras = c.compras.length ? await (await rest(`historico_compras?id_compra=in.(${c.compras.map((x) => `"${x}"`).join(",")})&select=id_compra,data_publicacao`)).json() : [];
      const prop = await propostasDosCasados({ compras, casamentos: c.casamentos }, { fetchImpl: fetchPncp, lerMes });
      if (prop.linhas.length) await L.gravar(rest, { compras: [], itens: [], participacoes: prop.linhas });
      await rest(`historico_consultas?chave=eq.${q(c.chave)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ situacao: "completo", erro: null }) });
      feitas++;
    } catch (e) {
      await rest(`historico_consultas?chave=eq.${q(c.chave)}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ situacao: "falhou", erro: String(e.message || e).slice(0, 300) }) });
    }
  }
  return feitas;
}

module.exports = { etapaHistorico, completarConsultas, propostasDosCasados, lerMesPropostas, ErroHistorico };
