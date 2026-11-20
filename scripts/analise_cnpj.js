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
// PAUSA_MS_ANALISE_CNPJ (400 entre chamadas às fontes), MAX_FALHAS_ANALISE_CNPJ (3 falhas no mesmo mês -> 'falhou',
// para um arquivo quebrado não travar a fila), MAX_LINHAS_ANALISE_CNPJ (5000 participações por CNPJ) e
// MESES_GUARDA_ANALISE_CNPJ (37: cobre os 3 anos da "Licitação anterior", que lê as mesmas linhas).
// Fila "parcial" (a tela mostrava "Completando…" por dias): LOTE_MESES_ANALISE_CNPJ (30 CNPJs entram no filtro de cada mês
// lido: ler o mês custa o mesmo para 1 ou 30), PRIORIDADE_HORAS_ANALISE_CNPJ (6: CNPJ pedido por usuário nessas horas vai
// na frente; o resto segue por ordem de chegada, então ninguém fica para trás). Os meses seguem enquanto sobrar tempo:
// só começa outro mês se o tempo que falta cobre o último (medido), e o primeiro mês da rodada sempre começa.
// Parte 2 (supabase/analise_cnpj_v2.sql), antes dos meses:
//   4) contratos do fornecedor no PNCP (todas as páginas, até MAX_PAGINAS_CONTRATOS_ANALISE_CNPJ=10, 1.000 contratos);
//   5) contrato FEDERAL ganha empenhado, liquidado, pago e faturado pelo Contratos.gov.br (MAX_CONTRATOS_GOV_ANALISE_CNPJ=15
//      por rodada, refeito a cada 7 dias; a lista da UASG é pesada e fica em cache na rodada);
//   6) dados cadastrais da Receita (BrasilAPI/minhareceita) de quem está na fila sem cadastro ou com mais de 30 dias.
// A análise só fica 'completo' depois que os contratos foram lidos (contratos_lidos_em).
const L = require("../netlify/functions/_licitacao_anterior");
const A = require("../netlify/functions/_analise_cnpj");
const { lerMesPropostas } = require("./historico_licitacoes");
const { enriquecerComGov } = require("./esteira_contratos");
const cp = require("../contrato-publico.js");

const LOTE = Math.max(1, Number(process.env.LOTE_ANALISE_CNPJ || 5));
const MAX_COMPRAS = Math.max(1, Number(process.env.MAX_COMPRAS_ANALISE_CNPJ || 40));
const MAX_ITENS_PNCP = Math.max(1, Number(process.env.MAX_ITENS_PNCP_ANALISE_CNPJ || 60));
const MAX_CABECALHOS = Math.max(0, Number(process.env.MAX_CABECALHOS_ANALISE_CNPJ ?? 80));
const PAUSA_MS = Math.max(0, Number(process.env.PAUSA_MS_ANALISE_CNPJ ?? 400));
const MAX_FALHAS = Math.max(1, Number(process.env.MAX_FALHAS_ANALISE_CNPJ || 3));
const MAX_LINHAS = Math.max(100, Number(process.env.MAX_LINHAS_ANALISE_CNPJ || 5000));
const MESES_GUARDA = Math.max(37, Number(process.env.MESES_GUARDA_ANALISE_CNPJ || 37));
const LOTE_MESES = Math.max(LOTE, Number(process.env.LOTE_MESES_ANALISE_CNPJ || 30));
const PRIORIDADE_MS = Math.max(0, Number(process.env.PRIORIDADE_HORAS_ANALISE_CNPJ ?? 6)) * 3600000;
const MAX_PAGINAS_CONTRATOS = Math.max(1, Number(process.env.MAX_PAGINAS_CONTRATOS_ANALISE_CNPJ || 10));
const MAX_CONTRATOS_GOV = Math.max(0, Number(process.env.MAX_CONTRATOS_GOV_ANALISE_CNPJ ?? 15));
const VALIDADE_GOV_MS = 7 * 864e5;
const VALIDADE_CADASTRO_MS = 30 * 864e5;
const DADOS_ABERTOS = "https://dadosabertos.compras.gov.br/modulo-contratacoes";
const listaIn = (ids) => ids.map((x) => `"${String(x).replace(/[^0-9A-Za-z/-]/g, "")}"`).join(",");

async function patchFila(rest, cnpj, campos) {
  await rest(`historico_cnpj_consultas?cnpj=eq.${cnpj}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ...campos, atualizado_em: new Date().toISOString() }) });
}

// Falha de leitura de um mês: conta por mês corrente; na MAX_FALHAS-ésima a análise sai da fila como 'falhou'
// (a tela oferece refazer; a função aceita 'falhou' como cache vencido).
async function registrarFalha(rest, f, erro, agora) {
  const mes = new Date(agora()).toISOString().slice(0, 7);
  f.tentativas = f.mes_falhas === mes ? (f.tentativas || 0) + 1 : 1;
  f.mes_falhas = mes;
  const campos = { tentativas: f.tentativas, mes_falhas: mes };
  if (f.tentativas >= MAX_FALHAS) Object.assign(f, campos, { situacao: "falhou" });
  await patchFila(rest, f.cnpj, f.situacao === "falhou" ? { ...campos, situacao: "falhou", erro: `Arquivo de propostas falhou ${f.tentativas} vezes: ${erro}`.slice(0, 300) } : campos);
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

// Contratos do fornecedor no PNCP: o id do filtro de fornecedor vem da mesma sugestão da busca de compras.
async function lerContratos(rest, b, fila, agora) {
  const ids = (await A.sugerirFornecedores(b, fila.cnpj)).find((f) => f.cnpj === fila.cnpj)?.ids || [];
  const r = ids.length ? await A.contratosDoFornecedor(b, ids, fila.cnpj, MAX_PAGINAS_CONTRATOS) : { contratos: [], total: 0 };
  if (r.contratos.length) await L.upsertPorColunas(rest, "historico_contratos_fornecedor", "numero_controle_pncp", r.contratos);
  fila.contratos_lidos_em = new Date(agora()).toISOString();
  await patchFila(rest, fila.cnpj, { contratos_total: r.total, contratos_lidos_em: fila.contratos_lidos_em });
  return r.contratos.length;
}

// Empenhado/liquidado/pago (empenhos) e faturado (faturas não canceladas) do Contratos.gov.br, só órgão federal.
// Pela mesma rotina da etapa 8 da esteira (scripts/esteira_contratos.js e contrato-publico.js).
const somaFaturas = (faturas) => (faturas.length ? Math.round(faturas.filter((f) => !f.cancelada && f.valor > 0).reduce((s, f) => s + f.valor, 0) * 100) / 100 : null);
async function valoresFederais(rest, filas, { fetchPncp, esperar, agora }) {
  if (!MAX_CONTRATOS_GOV || !filas.length) return 0;
  const vencido = new Date(agora() - VALIDADE_GOV_MS).toISOString();
  // Cota por CNPJ (na ordem da fila: quem pediu há pouco primeiro): um fornecedor com centenas de contratos não toma a rodada toda.
  const porCnpj = Math.max(1, Math.floor(MAX_CONTRATOS_GOV / filas.length));
  const linhas = [];
  for (const f of filas) {
    if (linhas.length >= MAX_CONTRATOS_GOV) break;
    linhas.push(...await (await rest(`historico_contratos_fornecedor?fornecedor_ni=eq.${f.cnpj}&esfera=eq.F` +
      `&or=(gov_consultado_em.is.null,gov_consultado_em.lt.${encodeURIComponent(vencido)})&order=gov_consultado_em.asc.nullsfirst,data_assinatura.desc.nullslast` +
      `&select=numero_controle_pncp,fornecedor_ni,unidade_codigo,numero,ano,tipo,contratos_gov_id&limit=${Math.min(porCnpj, MAX_CONTRATOS_GOV - linhas.length)}`)).json());
  }
  const cache = new Map();
  let feitos = 0;
  for (const c of linhas) {
    const pncp = { unidadeOrgao: { codigoUnidade: c.unidade_codigo }, numeroContratoEmpenho: c.numero, anoContrato: c.ano, niFornecedor: c.fornecedor_ni,
      tipoContrato: { id: /empenho/i.test(c.tipo || "") ? 7 : 1 } };
    let gov;
    try { gov = await enriquecerComGov({ fetchPncp, esperar, cache }, pncp, c.contratos_gov_id); } catch (e) {
      console.warn(`[analise-cnpj] Contratos.gov ${c.numero_controle_pncp}: ${String(e.message || e).slice(0, 200)}`);
      continue; // fonte fora do ar: tenta na próxima rodada
    }
    const l = gov ? cp.montarLinha({ pncp, gov }) : null;
    const campos = { gov_consultado_em: new Date(agora()).toISOString(), ...(l ? { valor_empenhado: l.valor_empenhado, valor_liquidado: l.valor_liquidado,
      valor_pago: l.valor_pago, valor_faturado: somaFaturas(l.faturas), contratos_gov_id: l.contratos_gov_id } : {}) };
    await rest(`historico_contratos_fornecedor?numero_controle_pncp=eq.${encodeURIComponent(c.numero_controle_pncp)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(campos) });
    if (l) feitos++;
  }
  return feitos;
}

// Cadastro da Receita de quem está na fila sem cadastro ou com cadastro de mais de 30 dias (1 chamada por CNPJ).
async function completarCadastros(rest, filas, { fetchPncp, esperar, agora }) {
  if (!filas.length) return 0;
  const vencido = new Date(agora() - VALIDADE_CADASTRO_MS).toISOString();
  const frescos = new Set((await (await rest(`empresas_cadastro?cnpj=in.(${listaIn(filas.map((f) => f.cnpj))})&consultado_em=gte.${encodeURIComponent(vencido)}&select=cnpj`)).json()).map((x) => x.cnpj));
  let feitos = 0;
  for (const f of filas.filter((x) => !frescos.has(x.cnpj))) {
    try {
      const linha = await A.buscarCadastro(fetchPncp, f.cnpj);
      if (linha) {
        await rest("empresas_cadastro?on_conflict=cnpj", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify([{ ...linha, consultado_em: new Date(agora()).toISOString() }]) });
        feitos++;
      }
    } catch (e) { console.warn(`[analise-cnpj] cadastro ${f.cnpj}: ${String(e.message || e).slice(0, 200)}`); }
    await esperar(PAUSA_MS);
  }
  return feitos;
}

// Fila da rodada: quem um usuário pediu há pouco primeiro (mais recente na frente), depois por ordem de chegada.
async function filaDaRodada(rest, agora) {
  const desde = new Date(agora() - PRIORIDADE_MS).toISOString();
  const lista = async (filtro, ordem) => (await (await rest(`historico_cnpj_consultas?situacao=eq.parcial${filtro}&select=*&order=${ordem}&limit=${LOTE_MESES}`)).json()) || [];
  const prioritarias = PRIORIDADE_MS ? await lista(`&pedido_em=gte.${encodeURIComponent(desde)}`, "pedido_em.desc") : [];
  const vistos = new Set(prioritarias.map((f) => f.cnpj));
  const demais = (await lista("", "gerado_em.asc")).filter((f) => !vistos.has(f.cnpj));
  return { filas: [...prioritarias, ...demais].slice(0, LOTE_MESES), prioritarias: vistos };
}

async function completarAnalises({ rest, fetchPncp = (...a) => fetch(...a), lerMes = lerMesPropostas, agora = Date.now, prazoFinal = Infinity,
  esperar = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const { filas, prioritarias } = await filaDaRodada(rest, agora);
  const contagem = { cnpjs: filas.length, compras: 0, meses: 0, linhas: 0, cabecalhos: 0, completos: 0, contratos: 0, contratosGov: 0, cadastros: 0 };
  if (!filas.length) return contagem;
  const b = L.criarBuscador({ fetchImpl: fetchPncp, orcamento: 100000, esperar, pausaMs: PAUSA_MS });
  // Compras pendentes custam chamadas por compra: só os LOTE primeiros (os prioritários vêm na frente).
  for (const fila of filas.slice(0, LOTE)) {
    if (agora() >= prazoFinal) break;
    contagem.compras += await comprasPendentes(rest, b, fila, { agora, prazoFinal });
  }
  // Contratos: 1 sugestão + 1 página por CNPJ no caso comum; todos os da rodada, senão a fila não fecha.
  for (const fila of filas.filter((f) => !f.contratos_lidos_em)) {
    if (agora() >= prazoFinal) break;
    try { contagem.contratos += await lerContratos(rest, b, fila, agora); } catch (e) { console.warn(`[analise-cnpj] contratos ${fila.cnpj}: ${String(e.message || e).slice(0, 200)}`); }
  }
  if (agora() < prazoFinal) contagem.contratosGov = await valoresFederais(rest, filas, { fetchPncp, esperar, agora });
  if (agora() < prazoFinal) contagem.cadastros = await completarCadastros(rest, filas, { fetchPncp, esperar, agora });
  // Mês mais novo primeiro (é o que muda toda semana); os meses de quem está esperando antes dos demais.
  const mesesDe = (lista) => [...new Set(lista.flatMap((f) => f.meses_pendentes))].sort().reverse();
  const meses = [...new Set([...mesesDe(filas.filter((f) => prioritarias.has(f.cnpj))), ...mesesDe(filas)])];
  let ultimaDuracao = 0;
  for (const mes of meses) {
    // Primeiro mês da rodada sempre começa (dentro do prazo); os seguintes só se o tempo que falta cobre o último.
    if (agora() >= prazoFinal || (contagem.meses && agora() + ultimaDuracao * 1.2 > prazoFinal)) break;
    const daqui = filas.filter((f) => f.situacao !== "falhou" && f.meses_pendentes.includes(mes));
    if (!daqui.length) continue;
    const filtro = A.criarFiltroCnpjs(new Set(daqui.map((f) => f.cnpj)));
    const comecou = agora();
    try {
      await lerMes(mes, filtro, { fetchImpl: fetchPncp });
    } catch (e) {
      const msg = String(e.message || e).slice(0, 200);
      console.warn(`[analise-cnpj] propostas ${mes}: ${msg}`);
      for (const f of daqui) await registrarFalha(rest, f, msg, agora);
      continue; // fica pendente para a próxima rodada (até MAX_FALHAS no mês)
    }
    ultimaDuracao = Math.max(ultimaDuracao, agora() - comecou);
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
  // Teto de linhas por CNPJ e prazo de guarda em historico_participacoes; o tamanho vai para o log.
  try {
    const poda = await (await rest("rpc/historico_participacoes_podar", { method: "POST",
      body: JSON.stringify({ p_cnpjs: filas.map((f) => f.cnpj), p_max_linhas: MAX_LINHAS, p_meses: MESES_GUARDA }) })).json();
    for (const p of poda || []) console.log(`[analise-cnpj] ${p.cnpj}: ${p.linhas} participações guardadas, ${p.apagadas} apagadas (teto ${MAX_LINHAS}, ${MESES_GUARDA} meses)`);
    contagem.podadas = (poda || []).reduce((s, p) => s + Number(p.apagadas || 0), 0);
  } catch (e) { console.warn(`[analise-cnpj] poda: ${String(e.message || e).slice(0, 200)}`); }
  for (const f of filas) {
    if (f.situacao === "falhou" || f.compras_pendentes.length || f.meses_pendentes.length || !f.contratos_lidos_em) continue;
    await patchFila(rest, f.cnpj, { situacao: "completo", erro: null });
    contagem.completos++;
  }
  return contagem;
}

module.exports = { completarAnalises, MAX_FALHAS };
