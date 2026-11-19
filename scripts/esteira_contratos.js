// Etapas 'resultado' (7) e 'contrato' (8) da esteira (supabase/operacao_esteira.sql, operacao_contratos_publicos.sql).
// Só lê fontes públicas sem login: PNCP (integração e consulta) e Contratos.gov.br (/api/contrato/...).
//   resultado  confere o resultado dos itens pendentes no PNCP e grava a SUGESTÃO em detalhe.sugestao. Nunca grava
//              em operacao_itens_resultado: quem confirma é o usuário, na tela do processo.
//   contrato   com vitória registrada, busca contrato/empenho/aditivos (PNCP) e liquidado/pago/faturas (Contratos.gov)
//              e faz upsert em operacao_contratos_publicos. Repete todo dia até a vigência acabar.
// Cada etapa devolve o patch da tarefa ({estado, proximo_em, detalhe}); o robô aplica.
const { referencia } = require("../netlify/functions/importar-item-pncp");
const cp = require("../contrato-publico.js");

const PNCP = "https://pncp.gov.br/api/pncp/v1/orgaos";
const CONSULTA = "https://pncp.gov.br/api/consulta/v1/orgaos";
const GOV = "https://contratos.comprasnet.gov.br/api/contrato";
const HORA = 3600000;
const REVERIFICAR_RESULTADO_MS = 6 * HORA;
const REVERIFICAR_CONTRATO_MS = 24 * HORA;
const DESISTIR_RESULTADO_DIAS = 120;
const TETO_ITENS_RESULTADO = 1000;
const q = encodeURIComponent;
const iso = (ms) => new Date(ms).toISOString();

class ErroFonte extends Error {}

// GET JSON: 204/404 = vazio (null); 5xx/rede = erro (a tarefa tenta de novo com backoff). Timeout alto no /ug/ da UASG (lista grande).
async function pegar(fetchImpl, url, timeoutMs = 30000) {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: ctrl.signal, redirect: "error" });
    if (r.status === 204 || r.status === 404) return null;
    if (!r.ok) throw new ErroFonte(`Fonte indisponível (HTTP ${r.status}).`);
    return await r.json();
  } catch (e) {
    throw e instanceof ErroFonte ? e : new ErroFonte(`Fonte indisponível (${e?.name === "AbortError" ? "tempo esgotado" : "rede"}).`);
  } finally { clearTimeout(t); }
}

async function lerProcesso(rest, tarefa) {
  const [p] = await (await rest(`operacao_processos?id=eq.${q(tarefa.processo_id)}&empresa_id=eq.${q(tarefa.empresa_id)}&organizacao_id=eq.${q(tarefa.organizacao_id)}` +
    "&select=id,empresa_id,organizacao_id,url_origem,origem_externa_id,numero,status,data_sessao")).json();
  const [e] = await (await rest(`operacao_empresas?id=eq.${q(tarefa.empresa_id)}&select=cnpj`)).json();
  return { p, cnpj: cp.cnpjLimpo(e?.cnpj) };
}

// ---- resultado -----------------------------------------------------------------------------------------------
async function etapaResultado(tarefa, { rest, fetchPncp, esperar, agora, prazoFinal, pausaMs = 400 }) {
  const { p, cnpj } = await lerProcesso(rest, tarefa);
  const detalhe0 = tarefa.detalhe || {};
  const depois = (ms, detalhe) => ({ estado: "pendente", proximo_em: iso(agora() + ms), detalhe, erro: null });
  if (!p || p.status === "arquivado") return { estado: "feito", detalhe: { ...detalhe0, situacao: "processo_arquivado" }, erro: null };
  if (cnpj.length !== 14) return { estado: "feito", detalhe: { ...detalhe0, situacao: "empresa_sem_cnpj" }, erro: null };
  const sessao = p.data_sessao ? Date.parse(p.data_sessao) : NaN;
  if (Number.isFinite(sessao) && sessao > agora()) return { estado: "pendente", proximo_em: iso(sessao + HORA), detalhe: { ...detalhe0, situacao: "aguardando_sessao" }, erro: null };
  const itens = await (await rest(`operacao_itens_resultado?processo_id=eq.${q(p.id)}&select=id,tipo,identificador,situacao&limit=1000`)).json();
  const pendentes = itens.filter((i) => i.tipo === "item" && i.situacao === "pendente" && /^\d+$/.test(String(i.identificador)));
  if (itens.length && !pendentes.length) return { estado: "feito", detalhe: { ...detalhe0, situacao: "sem_pendencias", sugestao: null }, erro: null };
  if (!pendentes.length) return depois(REVERIFICAR_RESULTADO_MS, { ...detalhe0, situacao: "aguardando_itens" });
  const ref = referencia(p);
  const cab = await pegar(fetchPncp, `${CONSULTA}/${ref.cnpj}/compras/${ref.ano}/${ref.seq}`);
  const atualizado = cab?.dataAtualizacaoGlobal || null;
  const base = { verificadoEm: iso(agora()), compraAtualizadaEm: atualizado };
  if (!cab?.existeResultado) {
    const limite = Number.isFinite(sessao) ? sessao + DESISTIR_RESULTADO_DIAS * 24 * HORA : Infinity;
    return agora() > limite ? { estado: "feito", detalhe: { ...base, situacao: "sem_resultado_publicado", sugestao: null }, erro: null }
      : depois(REVERIFICAR_RESULTADO_MS, { ...base, situacao: "sem_resultado_publicado", sugestao: null });
  }
  // Compra sem mudança desde a última sugestão e com ela ainda pendente: não repete as chamadas por item.
  if (detalhe0.sugestao && detalhe0.compraAtualizadaEm === atualizado && !detalhe0.coletados) return depois(REVERIFICAR_RESULTADO_MS, { ...detalhe0, verificadoEm: base.verificadoEm });
  const coletados = detalhe0.coletados || {};
  for (const it of pendentes.slice(0, TETO_ITENS_RESULTADO)) {
    const n = Number(it.identificador);
    if (coletados[n]) continue;
    if (agora() >= prazoFinal) return { estado: "pendente", proximo_em: iso(agora()), detalhe: { ...detalhe0, ...base, situacao: "coletando", coletados }, erro: null };
    const resultados = await pegar(fetchPncp, `${PNCP}/${ref.cnpj}/compras/${ref.ano}/${ref.seq}/itens/${n}/resultados`);
    const situacaoItem = resultados?.length ? null : (await pegar(fetchPncp, `${PNCP}/${ref.cnpj}/compras/${ref.ano}/${ref.seq}/itens/${n}`))?.situacaoCompraItemNome;
    coletados[n] = cp.classificarItem(resultados, cnpj, situacaoItem) || { situacao: null };
    await esperar(pausaMs);
  }
  const fonte = `https://pncp.gov.br/app/editais/${ref.cnpj}/${ref.ano}/${ref.seq}`;
  const sugeridos = Object.entries(coletados).filter(([, s]) => s.situacao).map(([n, s]) => ({ numero: Number(n), ...s, fonte }));
  return depois(REVERIFICAR_RESULTADO_MS, { ...base, situacao: sugeridos.length ? "sugestao" : "sem_resultado_nos_itens", sugestao: sugeridos.length ? { itens: sugeridos } : null });
}

// ---- contrato ------------------------------------------------------------------------------------------------
// Lista de contratos de uma UASG: pesada (UFAM: 3 MB, 40 s). Só quando o id do Contratos.gov ainda não é conhecido.
async function acharContratoGov({ fetchPncp, esperar, cache }, pncp) {
  const uasg = pncp.unidadeOrgao?.codigoUnidade;
  if (!/^\d{5,6}$/.test(String(uasg || ""))) return null;
  if (pncp.tipoContrato?.id === 7 || /^\d{4}NE\d+$/.test(pncp.numeroContratoEmpenho || "")) {
    const r = await pegar(fetchPncp, `${GOV}/ugorigem/${uasg}/numeroano/${q(pncp.numeroContratoEmpenho)}`);
    return Array.isArray(r) ? r.find((c) => cp.cnpjLimpo(c.fornecedor?.cnpj_cpf_idgener) === cp.cnpjLimpo(pncp.niFornecedor)) || null : null;
  }
  const numero = `${String(pncp.numeroContratoEmpenho).padStart(5, "0")}/${pncp.anoContrato}`;
  for (const caminho of ["ug", "inativo/ug"]) {
    const chave = `${caminho}:${uasg}`;
    if (!cache.has(chave)) { cache.set(chave, await pegar(fetchPncp, `${GOV}/${caminho}/${uasg}`, 150000)); await esperar(500); }
    const achado = (cache.get(chave) || []).find((c) => c.numero === numero && cp.cnpjLimpo(c.fornecedor?.cnpj_cpf_idgener) === cp.cnpjLimpo(pncp.niFornecedor));
    if (achado) return achado;
  }
  return null;
}

async function enriquecerComGov(deps, pncp, idConhecido) {
  const { fetchPncp, esperar } = deps;
  let contrato = null;
  if (idConhecido) contrato = await pegar(fetchPncp, `${GOV}/id/${idConhecido}`);
  if (!contrato) contrato = await acharContratoGov(deps, pncp);
  if (!contrato?.id) return null;
  const buscar = async (sufixo) => { await esperar(400); return (await pegar(fetchPncp, `${GOV}/${contrato.id}/${sufixo}`)) || []; };
  const empenhos = await buscar("empenhos");
  const historico = await buscar("historico");
  return { contrato, empenhos, historico, faturas: await buscar("faturas") };
}

async function etapaContrato(tarefa, deps) {
  const { rest, fetchPncp, esperar, agora } = deps;
  const { p, cnpj } = await lerProcesso(rest, tarefa);
  const detalhe0 = tarefa.detalhe || {};
  const depois = (ms, detalhe) => ({ estado: "pendente", proximo_em: iso(agora() + ms), detalhe, erro: null });
  if (!p || p.status === "arquivado") return { estado: "feito", detalhe: { ...detalhe0, situacao: "processo_arquivado" }, erro: null };
  const ganhos = await (await rest(`operacao_itens_resultado?processo_id=eq.${q(p.id)}&situacao=eq.ganho&select=id&limit=1`)).json();
  if (!ganhos.length) return depois(REVERIFICAR_CONTRATO_MS / 2, { ...detalhe0, situacao: "aguardando_vitoria" });
  if (cnpj.length !== 14) return { estado: "feito", detalhe: { ...detalhe0, situacao: "empresa_sem_cnpj" }, erro: null };
  const ref = referencia(p);
  const lista = [];
  for (let pagina = 1; pagina <= 10; pagina++) {
    const r = await pegar(fetchPncp, `${PNCP}/${ref.cnpj}/contratos/contratacao/${ref.ano}/${ref.seq}?pagina=${pagina}`);
    lista.push(...(r?.data || []));
    if (!r || !r.paginasRestantes) break;
  }
  const meus = lista.filter((c) => cp.cnpjLimpo(c.niFornecedor) === cnpj);
  const existentes = await (await rest(`operacao_contratos_publicos?processo_id=eq.${q(p.id)}&select=chave,contratos_gov_id`)).json();
  const idGov = new Map(existentes.map((l) => [l.chave, l.contratos_gov_id]));
  const cache = new Map();
  const linhas = [];
  for (const c of meus) {
    const base = `${PNCP}/${ref.cnpj}/contratos/${c.anoContrato}/${c.sequencialContrato}`;
    await esperar(400);
    const termos = await pegar(fetchPncp, `${base}/termos`);
    const empenhosPncp = (await pegar(fetchPncp, `${base}/empenhos?pagina=1`))?.data;
    // Contratos.gov só cobre órgão federal; os demais ficam só com o que o PNCP publica.
    const gov = c.orgaoEntidade?.esferaId === "F" ? await enriquecerComGov({ fetchPncp, esperar, cache }, c, idGov.get(c.numeroControlePNCP)) : null;
    linhas.push({ organizacao_id: p.organizacao_id, empresa_id: p.empresa_id, processo_id: p.id, ...cp.montarLinha({ pncp: c, termos, empenhosPncp, gov }), consultado_em: iso(agora()) });
  }
  if (linhas.length) {
    await rest("operacao_contratos_publicos?on_conflict=processo_id,chave", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(linhas) });
  }
  const hoje = iso(agora()).slice(0, 10);
  const todosEncerrados = linhas.length > 0 && linhas.every((l) => l.vigencia_fim && cp.situacaoContrato(l, hoje).vigencia.dias < -30 && !l.a_pagar);
  const detalhe = { ...detalhe0, situacao: linhas.length ? "encontrado" : "sem_contrato_publicado", contratos: linhas.length, verificadoEm: iso(agora()) };
  return todosEncerrados ? { estado: "feito", detalhe, erro: null } : depois(REVERIFICAR_CONTRATO_MS, detalhe);
}

module.exports = { etapaResultado, etapaContrato, pegar, ErroFonte };
