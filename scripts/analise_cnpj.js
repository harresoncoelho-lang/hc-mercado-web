// Análise por CNPJ no robô (chamado por scripts/esteira_processos.js no fim da rodada, com tempo sobrando):
// completa a fila historico_cnpj_consultas que a função /api/analise-cnpj abriu.
//   1) compras pendentes do PNCP (as que a função não coube no orçamento): itens e resultados dos itens em
//      que o CNPJ aparece (dados abertos do Compras.gov; outras plataformas pelo PNCP, item a item);
//   2) arquivo semanal de propostas, mês a mês e retomável (meses_pendentes): todas as disputas do CNPJ no
//      Compras.gov, inclusive as PERDIDAS, com posição, valores e situacao_proposta, mais o vencedor do item.
//      Um mês é baixado uma vez para todos os CNPJs da fila.
//   3) compra que veio só do arquivo ganha órgão, UF e data pelos dados abertos (1 chamada por compra).
// Env opcionais: LOTE_ANALISE_CNPJ (5 CNPJs por rodada), MAX_COMPRAS_ANALISE_CNPJ (40 compras por CNPJ e rodada),
// MAX_ITENS_PNCP_ANALISE_CNPJ (60 itens por compra fora do Compras.gov), MAX_CABECALHOS_ANALISE_CNPJ (80 por mês),
// PAUSA_MS_ANALISE_CNPJ (400 entre chamadas às fontes).
const L = require("../netlify/functions/_licitacao_anterior");
const A = require("../netlify/functions/_analise_cnpj");
const { lerMesPropostas } = require("./historico_licitacoes");

const LOTE = Math.max(1, Number(process.env.LOTE_ANALISE_CNPJ || 5));
const MAX_COMPRAS = Math.max(1, Number(process.env.MAX_COMPRAS_ANALISE_CNPJ || 40));
const MAX_ITENS_PNCP = Math.max(1, Number(process.env.MAX_ITENS_PNCP_ANALISE_CNPJ || 60));
const MAX_CABECALHOS = Math.max(0, Number(process.env.MAX_CABECALHOS_ANALISE_CNPJ ?? 80));
const PAUSA_MS = Math.max(0, Number(process.env.PAUSA_MS_ANALISE_CNPJ ?? 400));
const DADOS_ABERTOS = "https://dadosabertos.compras.gov.br/modulo-contratacoes";
const listaIn = (ids) => ids.map((x) => `"${String(x).replace(/[^0-9A-Za-z/-]/g, "")}"`).join(",");

async function patchFila(rest, cnpj, campos) {
  await rest(`historico_cnpj_consultas?cnpj=eq.${cnpj}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ...campos, atualizado_em: new Date().toISOString() }) });
}

async function comprasPendentes(rest, b, fila, { agora, prazoFinal }) {
  const ids = fila.compras_pendentes.slice(0, MAX_COMPRAS);
  if (!ids.length) return 0;
  const guardadas = await (await rest(`historico_compras?id_compra=in.(${listaIn(ids)})&select=*`)).json();
  const feitas = new Set();
  for (const c of guardadas) {
    if (agora() >= prazoFinal) break;
    try {
      const r = await A.coletarCompra(b, c, fila.cnpj, { maxItensPncp: MAX_ITENS_PNCP });
      if (r) await L.gravar(rest, { compras: [r.compra], itens: r.itens, participacoes: r.participacoes });
    } catch (e) {
      console.warn(`[analise-cnpj] compra ${c.id_compra}: ${String(e.message || e).slice(0, 200)}`);
    }
    feitas.add(c.id_compra); // falha não volta para a fila: a próxima análise do CNPJ (7 dias) tenta de novo
  }
  // Id sem cabeçalho gravado (não deveria acontecer) também sai da fila.
  for (const id of ids) if (!guardadas.some((c) => c.id_compra === id)) feitas.add(id);
  await patchFila(rest, fila.cnpj, { compras_pendentes: fila.compras_pendentes.filter((id) => !feitas.has(id)) });
  fila.compras_pendentes = fila.compras_pendentes.filter((id) => !feitas.has(id));
  return feitas.size;
}

// Compra que só o arquivo conhece: órgão, UF e data pelos dados abertos.
async function completarCabecalhos(rest, b, ids) {
  if (!ids.length || !MAX_CABECALHOS) return 0;
  const semUf = await (await rest(`historico_compras?id_compra=in.(${listaIn(ids)})&uf=is.null&select=id_compra&limit=${MAX_CABECALHOS}`)).json();
  const linhas = [];
  for (const { id_compra } of semUf) {
    const cab = (await b.json(`${DADOS_ABERTOS}/1.1_consultarContratacoes_PNCP_14133_Id?tipo=idCompra&codigo=${id_compra}`).catch(() => null))?.resultado?.[0];
    if (!cab || !/^[A-Z]{2}$/.test(String(cab.unidadeOrgaoUfSigla || ""))) continue;
    linhas.push({ id_compra, uf: cab.unidadeOrgaoUfSigla, orgao_cnpj: /^\d{14}$/.test(String(cab.orgaoEntidadeCnpj || "")) ? cab.orgaoEntidadeCnpj : null,
      orgao_nome: String(cab.orgaoEntidadeRazaoSocial || "").slice(0, 300) || null, unidade_nome: String(cab.unidadeOrgaoNomeUnidade || "").slice(0, 300) || null,
      modalidade: String(cab.modalidadeNome || "").slice(0, 80) || null, data_publicacao: String(cab.dataPublicacaoPncp || "").slice(0, 10) || null });
  }
  if (linhas.length) await L.upsertPorColunas(rest, "historico_compras", "id_compra", linhas);
  return linhas.length;
}

async function completarAnalises({ rest, fetchPncp = (...a) => fetch(...a), lerMes = lerMesPropostas, agora = Date.now, prazoFinal = Infinity,
  esperar = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const filas = await (await rest(`historico_cnpj_consultas?situacao=eq.parcial&select=*&order=gerado_em.asc&limit=${LOTE}`)).json();
  const contagem = { cnpjs: filas.length, compras: 0, meses: 0, linhas: 0, cabecalhos: 0, completos: 0 };
  if (!filas.length) return contagem;
  const b = L.criarBuscador({ fetchImpl: fetchPncp, orcamento: 100000, esperar, pausaMs: PAUSA_MS });
  for (const fila of filas) {
    if (agora() >= prazoFinal) break;
    contagem.compras += await comprasPendentes(rest, b, fila, { agora, prazoFinal });
  }
  // Mês mais novo primeiro: é o que muda toda semana e o que o usuário mais quer ver.
  const meses = [...new Set(filas.flatMap((f) => f.meses_pendentes))].sort().reverse();
  for (const mes of meses) {
    if (agora() >= prazoFinal) break;
    const daqui = filas.filter((f) => f.meses_pendentes.includes(mes));
    const filtro = A.criarFiltroCnpjs(new Set(daqui.map((f) => f.cnpj)));
    try {
      await lerMes(mes, filtro, { fetchImpl: fetchPncp });
    } catch (e) {
      console.warn(`[analise-cnpj] propostas ${mes}: ${String(e.message || e).slice(0, 200)}`);
      continue; // fica pendente para a próxima rodada
    }
    const res = filtro.resultado();
    await A.gravarDoArquivo(rest, res);
    contagem.meses++;
    contagem.linhas += res.participacoes.length;
    contagem.cabecalhos += await completarCabecalhos(rest, b, res.compras.map((c) => c.id_compra));
    for (const f of daqui) {
      f.meses_pendentes = f.meses_pendentes.filter((m) => m !== mes);
      f.meses_lidos = [...new Set([...f.meses_lidos, mes])].sort().reverse();
      await patchFila(rest, f.cnpj, { meses_pendentes: f.meses_pendentes, meses_lidos: f.meses_lidos });
    }
  }
  for (const f of filas) {
    if (f.compras_pendentes.length || f.meses_pendentes.length) continue;
    await patchFila(rest, f.cnpj, { situacao: "completo", erro: null });
    contagem.completos++;
  }
  return contagem;
}

module.exports = { completarAnalises };
