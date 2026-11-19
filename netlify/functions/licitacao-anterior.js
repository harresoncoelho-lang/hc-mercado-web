// Consulta avulsa "Licitação anterior" (Inteligência de Mercado do painel): órgão (UASG) + produto (CATMAT
// ou palavras) + período -> contratações anteriores com vencedor, preço, cadastro reserva, situação do
// item, marca e participantes. Mesmo núcleo do robô da esteira (_licitacao_anterior.js).
//   POST {acao:"orgaos", q}                                  -> unidades compradoras (código ou nome; CNPJ do órgão)
//   POST {acao:"consultar", uasg, catmat?, palavras?, anos}  -> resultado
// Login obrigatório e cota diária (são até 40 chamadas a fontes públicas por consulta). Resultado guardado
// em historico_consultas por 7 dias (dado público, compartilhado): a segunda pessoa que pergunta o mesmo
// não gasta fonte nem cota. Os participantes de quem perdeu vêm do arquivo semanal de propostas, que só o
// robô baixa: a consulta nova fica 'parcial' e o robô da esteira completa na rodada seguinte.
const { cabecalhosPadrao, exigirUsuarioLogado, verificarLimiteDiario } = require("./_auth");
const L = require("./_licitacao_anterior");

const SUPABASE_URL = "https://lsqjamqvmrcyrvowndiu.supabase.co";
const LIMITE_DIARIO = 30;
const VALIDADE_MS = 7 * 24 * 3600 * 1000;
const PNCP = "https://pncp.gov.br";

// Sem a chave de serviço (ambiente sem segredo) a consulta roda e só não guarda: fail-open, como o _auth.js.
async function rest(caminho, opcoes = {}) {
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, { ...opcoes, signal: globalThis.AbortSignal.timeout(10000),
    headers: { apikey: chave, Authorization: `Bearer ${chave}`, "Content-Type": "application/json", ...(opcoes.headers || {}) } });
  if (!r.ok) throw new Error(`Supabase ${caminho.split("?")[0]} HTTP ${r.status}`);
  return r;
}

function validarConsulta(d) {
  const uasg = String(d?.uasg || "").replace(/\D/g, "");
  const catmat = String(d?.catmat || "").replace(/\D/g, "");
  const palavras = String(d?.palavras || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const anos = Number(d?.anos || 3);
  if (!/^\d{5,8}$/.test(uasg)) return { erro: "Escolha o órgão (UASG)." };
  if (!/^\d{1,12}$/.test(catmat) && L.palavras(palavras).length === 0) return { erro: "Informe o código CATMAT ou palavras do produto." };
  if (!Number.isInteger(anos) || anos < 1 || anos > 3) return { erro: "Período de 1 a 3 anos." };
  return { uasg, catmat: catmat || null, palavras: palavras || null, anos };
}
const chaveConsulta = (c, desdeAno) => [c.uasg, c.catmat || "", L.palavras(c.palavras || "").join(" "), desdeAno].join("|");

async function buscarOrgaos(termo) {
  const t = String(termo || "").trim().slice(0, 80);
  const cnpj = t.replace(/\D/g, "");
  const cabecalho = { headers: { Accept: "application/json", "User-Agent": L.UA }, signal: globalThis.AbortSignal.timeout(12000) };
  if (/^\d{14}$/.test(cnpj)) {
    const r = await fetch(`${PNCP}/api/search?q=${cnpj}&tipos_documento=edital&pagina=1&tam_pagina=50`, cabecalho);
    const itens = r.ok ? (await r.json()).items || [] : [];
    const vistas = new Map();
    for (const i of itens) if (i.orgao_cnpj === cnpj && i.unidade_codigo) vistas.set(String(i.unidade_codigo), String(i.unidade_nome || ""));
    return [...vistas].map(([uasg, nome]) => ({ uasg, nome }));
  }
  if (t.length < 3) return [];
  const r = await fetch(`${PNCP}/api/search/suggest?tipos_documento=edital&campo=unidades&q=${encodeURIComponent(t)}&tam_pagina=15`, cabecalho);
  const itens = r.ok ? (await r.json()).items || [] : [];
  // A mesma UASG aparece com vários ids internos no PNCP: uma linha por código.
  const vistas = new Map();
  for (const u of itens) if (/^\d{1,8}$/.test(String(u.codigo || "")) && !vistas.has(u.codigo)) vistas.set(String(u.codigo), String(u.nome || "").slice(0, 200));
  return [...vistas].map(([uasg, nome]) => ({ uasg, nome }));
}

const lista = (ids) => ids.map((x) => `"${String(x).replace(/[^0-9A-Za-z/-]/g, "")}"`).join(",");
async function lerGuardado(linha) {
  if (!linha.compras.length) return { compras: [], itens: [], participacoes: [] };
  const ids = lista(linha.compras);
  // Filtro no banco só pelos itens casados: a compra pode ter 200 itens (o PostgREST corta em 1.000 linhas).
  const porCompra = new Map();
  for (const c of linha.casamentos) {
    const n = Number(c.numero_item);
    if (!Number.isSafeInteger(n)) continue;
    if (!porCompra.has(c.id_compra)) porCompra.set(c.id_compra, new Set());
    porCompra.get(c.id_compra).add(n);
  }
  if (!porCompra.size) return { compras: [], itens: [], participacoes: [] };
  const filtroItens = [...porCompra].map(([id, ns]) => `and(id_compra.eq.${lista([id])},numero_item.in.(${[...ns].join(",")}))`).join(",");
  const [compras, itens, participacoes] = await Promise.all([
    rest(`historico_compras?id_compra=in.(${ids})&select=*`).then((r) => r.json()),
    rest(`historico_itens?or=(${encodeURIComponent(filtroItens)})&select=*`).then((r) => r.json()),
    rest(`historico_participacoes?or=(${encodeURIComponent(filtroItens)})&select=*&order=id_compra,numero_item,classificacao&limit=1000`).then((r) => r.json()),
  ]);
  // Só os itens casados: a compra pode ter 200 itens e a consulta pediu um produto.
  const casados = new Set(linha.casamentos.map((c) => `${c.id_compra}|${c.numero_item}`));
  const doCasado = (x) => casados.has(`${x.id_compra}|${x.numero_item}`);
  return { compras, itens: itens.filter(doCasado), participacoes: participacoes.filter(doCasado) };
}

exports.handler = async (event) => {
  const headers = { ...cabecalhosPadrao(event), "Cache-Control": "no-store" };
  const responder = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  if (event.httpMethod === "OPTIONS") return responder(204, {});
  if (event.httpMethod !== "POST") return responder(405, { erro: "Método não permitido." });
  if (String(event.body || "").length > 2000) return responder(413, { erro: "Pedido muito grande." });
  let dados;
  try { dados = JSON.parse(event.body || "{}"); } catch { return responder(400, { erro: "Pedido inválido." }); }
  const usuario = await exigirUsuarioLogado(event);
  if (!usuario.ok) return responder(usuario.status, { erro: usuario.erro });
  try {
    if (dados?.acao === "orgaos") return responder(200, { orgaos: await buscarOrgaos(dados.q) });
    if (dados?.acao !== "consultar") return responder(400, { erro: "Ação inválida." });
    const c = validarConsulta(dados);
    if (c.erro) return responder(400, { erro: c.erro });
    const desdeAno = new Date().getUTCFullYear() - c.anos;
    const chave = chaveConsulta(c, desdeAno);
    const alvos = [{ numero: null, catmat: c.catmat, descricao: c.palavras || "" }];
    const comBanco = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
    if (comBanco) {
      const [linha] = await (await rest(`historico_consultas?chave=eq.${encodeURIComponent(chave)}&select=*`)).json();
      if (linha && linha.situacao !== "falhou" && Date.now() - Date.parse(linha.gerado_em) < VALIDADE_MS) {
        return responder(200, { ...(await lerGuardado(linha)), casamentos: linha.casamentos, alvos, situacao: linha.situacao, gerado_em: linha.gerado_em, guardado: true });
      }
    }
    const cota = await verificarLimiteDiario(usuario.userId, "licitacao-anterior", LIMITE_DIARIO);
    if (!cota.ok) return responder(429, { erro: cota.erro || "Limite diário de consultas atingido. Tente amanhã." });
    // 36 + login, cache, cota e até 5 gravações = abaixo das 50 subrequisições do Cloudflare grátis.
    const r = await L.coletar({ uasg: c.uasg, alvos, palavrasBusca: c.catmat ? "" : c.palavras, desdeAno, orcamento: 36 });
    const gerado_em = new Date().toISOString();
    if (comBanco) {
      await L.gravar(rest, r);
      await rest("historico_consultas?on_conflict=chave", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ chave, uasg: c.uasg, catmat: c.catmat, palavras: c.palavras, desde_ano: desdeAno, compras: r.compras.map((x) => x.id_compra),
          casamentos: r.casamentos, situacao: "parcial", erro: null, gerado_em }]) });
    }
    return responder(200, { compras: r.compras, itens: r.itens, participacoes: r.participacoes, casamentos: r.casamentos, alvos,
      situacao: "parcial", parcial: r.parcial, avisos: r.avisos, gerado_em, guardado: false });
  } catch (e) {
    console.warn(`[licitacao-anterior] ${String(e?.message || e).slice(0, 200)}`);
    return responder(502, { erro: "As fontes públicas não responderam agora. Tente de novo em alguns minutos." });
  }
};

module.exports.validarConsulta = validarConsulta;
module.exports.chaveConsulta = chaveConsulta;
