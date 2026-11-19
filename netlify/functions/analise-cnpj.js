// Análise por CNPJ (tela "Analisar concorrente" do painel): coleta por demanda e guarda nas tabelas historico_*.
//   POST {acao:"buscar", q}      -> {fornecedores:[{cnpj, nome, total}]}  (nome ou CNPJ, filtro do PNCP; sem CPF)
//   POST {acao:"coletar", cnpj}  -> {situacao, total_pncp, coletadas, compras_pendentes, meses_pendentes, gerado_em}
// A leitura dos dados é direto do navegador (RPC analise_cnpj_participacoes, com a RLS do usuário).
// Orçamento (Cloudflare grátis, 50 subrequisições): login 1 + cache 1 + cota 1 + PNCP até 3 + dados abertos
// 4 compras x 3 + gravação ~6 + fila 1 ≈ 27. O resto (compras do PNCP fora do Compras.gov e o arquivo
// semanal de propostas, que traz as disputas perdidas) fica na fila historico_cnpj_consultas para o robô
// (scripts/analise_cnpj.js, na esteira). Cache de 7 dias por CNPJ: quem pergunta de novo não gasta fonte nem cota.
// Só cadastro aprovado. Fila com teto: MAX_FILA_GLOBAL CNPJs 'parcial' no total e MAX_FILA_SOLICITANTE novos por
// organização (ou usuário sem organização) em 24 h; sem isso uma conta enche a fila do robô e trava a de todos.
// A busca por nome tem cota própria (LIMITE_BUSCA_DIARIO): cada uma é uma chamada ao PNCP.
const { cabecalhosPadrao, exigirUsuarioAprovado, verificarLimiteDiario } = require("./_auth");
const L = require("./_licitacao_anterior");
const A = require("./_analise_cnpj");

const SUPABASE_URL = "https://lsqjamqvmrcyrvowndiu.supabase.co";
const LIMITE_DIARIO = 20;
const LIMITE_BUSCA_DIARIO = 100;
const MAX_FILA_GLOBAL = 200;
const MAX_FILA_SOLICITANTE = 10;
const VALIDADE_MS = 7 * 24 * 3600 * 1000;
const COMPRAS_NA_HORA = 4;
const PAGINAS_PNCP = 2;

async function rest(caminho, opcoes = {}) {
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, { ...opcoes, signal: globalThis.AbortSignal.timeout(10000),
    headers: { apikey: chave, Authorization: `Bearer ${chave}`, "Content-Type": "application/json", ...(opcoes.headers || {}) } });
  if (!r.ok) throw new Error(`Supabase ${caminho.split("?")[0]} HTTP ${r.status}`);
  return r;
}

// Contagem exata pelo PostgREST (Range 0-0: não traz linhas).
async function contar(caminho) {
  const r = await rest(caminho, { headers: { Prefer: "count=exact", Range: "0-0" } });
  return Number((r.headers.get("content-range") || "").split("/")[1]) || 0;
}

// Quem enfileira: a organização do usuário (a mesma conta pode ter vários logins) ou, sem organização, o próprio usuário.
async function solicitanteDe(userId) {
  const [m] = await (await rest(`operacao_membros?usuario_id=eq.${encodeURIComponent(userId)}&select=organizacao_id&order=organizacao_id&limit=1`)).json();
  return m?.organizacao_id || userId;
}

async function filaCheia(solicitante, agora = Date.now()) {
  if (await contar("historico_cnpj_consultas?situacao=eq.parcial&select=cnpj") >= MAX_FILA_GLOBAL) return "A fila de análises está cheia agora. Tente de novo mais tarde.";
  const desde = new Date(agora - 864e5).toISOString();
  if (await contar(`historico_cnpj_consultas?solicitante=eq.${encodeURIComponent(solicitante)}&gerado_em=gte.${encodeURIComponent(desde)}&select=cnpj`) >= MAX_FILA_SOLICITANTE) {
    return `Sua organização já pediu ${MAX_FILA_SOLICITANTE} análises novas nas últimas 24 horas. Tente de novo amanhã.`;
  }
  return null;
}

const resumoFila = (l, guardado) => ({ situacao: l.situacao, nome: l.nome, total_pncp: l.total_pncp, compras_pendentes: l.compras_pendentes.length,
  meses_pendentes: l.meses_pendentes.length, meses_lidos: l.meses_lidos, gerado_em: l.gerado_em, atualizado_em: l.atualizado_em, guardado });

// Coleta na hora: compras com resultado no PNCP e as primeiras do Compras.gov completas. Devolve as linhas
// para gravar e a fila do robô. Puro quanto ao banco (testado com fetch falso).
async function coletarNaHora(cnpj, { fetchImpl = (...a) => fetch(...a), orcamento = 20, agora = Date.now(), anterior = null } = {}) {
  const b = L.criarBuscador({ fetchImpl, orcamento, esperar: async () => {}, pausaMs: 0 });
  const saida = { nome: null, total_pncp: 0, compras: [], itens: [], participacoes: [], pendentes: [], coletadas: 0, avisos: [] };
  try {
    const achado = (await A.sugerirFornecedores(b, cnpj)).find((f) => f.cnpj === cnpj);
    if (achado) {
      saida.nome = achado.nome;
      const { compras, total } = await A.comprasComResultado(b, achado.ids, PAGINAS_PNCP);
      saida.total_pncp = total;
      saida.compras = compras.map(({ _ref, ...c }) => c);
      saida.pendentes = compras.map((c) => c.id_compra);
      if (total > compras.length) saida.avisos.push(`O PNCP lista ${total} contratações; as ${compras.length} mais recentes entram nesta análise.`);
      for (const c of compras.filter((x) => L.decifrarIdCompra(x.id_compra)?.lei14133).slice(0, COMPRAS_NA_HORA)) {
        const r = await A.coletarCompra(b, c, cnpj);
        if (!r) continue;
        // Mesma compra duas vezes no lote quebra o upsert ("cannot affect row a second time"): substitui.
        saida.compras = saida.compras.map((x) => (x.id_compra === r.compra.id_compra ? r.compra : x));
        saida.itens.push(...r.itens);
        saida.participacoes.push(...r.participacoes);
        if (!r.parcial) saida.pendentes = saida.pendentes.filter((id) => id !== c.id_compra);
        saida.coletadas++;
      }
    }
  } catch (e) {
    if (!(e instanceof L.SemOrcamento)) throw e;
    saida.avisos.push("Limite de consultas desta busca atingido: o robô completa o restante.");
  }
  // Refazer um CNPJ já completo relê só os 2 meses que o governo regera toda semana; o resto já está guardado.
  saida.meses = anterior?.situacao === "completo" ? A.mesesJanela(agora, 2) : A.mesesJanela(agora);
  return saida;
}

exports.handler = async (event) => {
  const headers = { ...cabecalhosPadrao(event), "Cache-Control": "no-store" };
  const responder = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  if (event.httpMethod === "OPTIONS") return responder(204, {});
  if (event.httpMethod !== "POST") return responder(405, { erro: "Método não permitido." });
  if (String(event.body || "").length > 1000) return responder(413, { erro: "Pedido muito grande." });
  let dados;
  try { dados = JSON.parse(event.body || "{}"); } catch { return responder(400, { erro: "Pedido inválido." }); }
  const usuario = await exigirUsuarioAprovado(event);
  if (!usuario.ok) return responder(usuario.status, { erro: usuario.erro });
  try {
    if (dados?.acao === "buscar") {
      const q = String(dados.q || "").replace(/\s+/g, " ").trim().slice(0, 80);
      if (q.length < 3) return responder(400, { erro: "Digite pelo menos 3 letras do nome ou o CNPJ." });
      const cotaBusca = await verificarLimiteDiario(usuario.userId, "analise-cnpj-buscar", LIMITE_BUSCA_DIARIO);
      if (!cotaBusca.ok) return responder(429, { erro: cotaBusca.erro || "Limite diário de buscas atingido. Tente amanhã." });
      const b = L.criarBuscador({ fetchImpl: (...a) => fetch(...a), orcamento: 1, esperar: async () => {}, pausaMs: 0 });
      const lista = await A.sugerirFornecedores(b, q);
      return responder(200, { fornecedores: lista.slice(0, 15).map(({ cnpj, nome, total }) => ({ cnpj, nome, total })) });
    }
    if (dados?.acao !== "coletar") return responder(400, { erro: "Ação inválida." });
    const cnpj = String(dados.cnpj || "").replace(/\D/g, "");
    if (!A.cnpjValido(cnpj)) return responder(400, { erro: "Informe um CNPJ válido (14 dígitos)." });
    // Sem chave de serviço não há onde guardar nem fila para o robô: a tela mostra só o que já está no banco.
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return responder(503, { erro: "Coleta indisponível neste ambiente." });
    const [linha] = await (await rest(`historico_cnpj_consultas?cnpj=eq.${cnpj}&select=*`)).json();
    if (linha && linha.situacao !== "falhou" && Date.now() - Date.parse(linha.gerado_em) < VALIDADE_MS) return responder(200, resumoFila(linha, true));
    const solicitante = await solicitanteDe(usuario.userId);
    const cheia = await filaCheia(solicitante);
    if (cheia) return responder(429, { erro: cheia });
    const cota = await verificarLimiteDiario(usuario.userId, "analise-cnpj", LIMITE_DIARIO);
    if (!cota.ok) return responder(429, { erro: cota.erro || "Limite diário de análises atingido. Tente amanhã." });
    const r = await coletarNaHora(cnpj, { anterior: linha });
    // Cabeçalhos de todas as compras do PNCP (órgão, UF, link) e, das coletadas, itens e resultados.
    await L.gravar(rest, r);
    const agora = new Date().toISOString();
    const fila = { cnpj, nome: r.nome || linha?.nome || null, situacao: "parcial", total_pncp: r.total_pncp, compras_pendentes: r.pendentes,
      meses_pendentes: r.meses, meses_lidos: linha?.meses_lidos || [], erro: null, gerado_em: agora, atualizado_em: agora, solicitante, tentativas: 0, mes_falhas: null };
    await rest("historico_cnpj_consultas?on_conflict=cnpj", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([fila]) });
    return responder(200, { ...resumoFila(fila, false), coletadas: r.coletadas, avisos: r.avisos });
  } catch (e) {
    console.error("analise-cnpj:", e.message);
    return responder(502, { erro: "Não foi possível consultar as fontes públicas agora. Tente novamente em instantes." });
  }
};

exports.coletarNaHora = coletarNaHora;
exports.LIMITES = { MAX_FILA_GLOBAL, MAX_FILA_SOLICITANTE, LIMITE_BUSCA_DIARIO };
