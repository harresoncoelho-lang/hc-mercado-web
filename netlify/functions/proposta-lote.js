// Lote de proposta para a extensão ("Preencher proposta", extensao-leitura/preencher-proposta.mjs).
//   GET ?compra=<17 dígitos>[&processo=<uuid>] -> {ok, compra, processo, itens[]} | {ok, escolher:[processos]} | {ok, processo:null}
// Só LEITURA, com o token do próprio usuário (a RLS isola a organização): login e cadastro aprovado obrigatórios.
// O processo é achado pela UASG + número/ano da compra (dígitos do código 17: UASG(6) modalidade(2) número(5) ano(4)).
// Não é a revisão do kit de documentos: são os itens com valor unitário cadastrados no processo; a extensão ainda
// confere cada valor contra o mínimo e o estimado do portal. Nada é gravado aqui.
const { cabecalhosPadrao, exigirUsuarioAprovado, verificarLimiteDiario } = require("./_auth");
const { falhar } = require("./_empresa_identificacao");
const { uuid } = require("./_kit_documentos");
const { listarPaginaItens } = require("./_kit_proposta_itens");

const URL_BANCO = "https://lsqjamqvmrcyrvowndiu.supabase.co";
const ANON = "sb_publishable_yH695cc52QUKYfFEgV5RwQ_0a8GLIeb";
const LIMITE_DIARIO = 300;
const MAX_ITENS = 1000;

// "33/2026", "000033/2026" ou "33" casam com número 33 e ano 2026; qualquer outra forma não casa.
function mesmoNumero(texto, numero, ano) {
  const m = /^\s*0*(\d{1,5})\s*\/\s*(\d{4})\s*$/.exec(String(texto ?? ""));
  return Boolean(m) && Number(m[1]) === numero && Number(m[2]) === ano;
}

exports.handler = async (event) => {
  const headers = { ...cabecalhosPadrao(event), "Cache-Control": "no-store" };
  const resposta = (status, body) => ({ statusCode: status, headers, body: JSON.stringify(body) });
  if (event.httpMethod === "OPTIONS") return resposta(204, {});
  if (event.httpMethod !== "GET") return resposta(405, { erro: "Método não permitido." });
  try {
    const auth = await exigirUsuarioAprovado(event);
    if (!auth.ok) return resposta(auth.status, { erro: auth.erro });
    const q = event.queryStringParameters || {};
    const compra = String(q.compra || "");
    if (!/^\d{17}$/.test(compra) || (q.processo !== undefined && !uuid(q.processo))) return resposta(400, { erro: "Informe a compra (17 dígitos)." });
    const cota = await verificarLimiteDiario(auth.userId, "proposta-lote", LIMITE_DIARIO);
    if (!cota.ok) return resposta(cota.status, { erro: cota.erro });

    const token = event.headers?.authorization || event.headers?.Authorization || "";
    const request = (caminho, op = {}) => fetch(URL_BANCO + caminho, { ...op, headers: { apikey: ANON, Authorization: token, Accept: "application/json", ...(op.headers || {}) }, signal: globalThis.AbortSignal.timeout(10000) });
    const uasg = compra.slice(0, 6), numero = Number(compra.slice(8, 13)), ano = Number(compra.slice(13));
    const r = await request(`/rest/v1/operacao_processos?uasg=eq.${uasg}&status=neq.arquivado&select=id,empresa_id,organizacao_id,numero,objeto&limit=50`);
    if (!r.ok) falhar("Processos indisponíveis.", 503);
    const candidatos = (await r.json()).filter((p) => uuid(p?.id) && uuid(p.organizacao_id) && mesmoNumero(p.numero, numero, ano));
    const escolhido = q.processo ? candidatos.find((p) => p.id === q.processo) : candidatos.length === 1 ? candidatos[0] : null;
    if (!candidatos.length || (q.processo && !escolhido)) return resposta(200, { ok: true, compra, processo: null });
    if (!escolhido) return resposta(200, { ok: true, compra, escolher: candidatos.map((p) => ({ processoId: p.id, numero: p.numero, objeto: p.objeto })) });

    const itens = [];
    let afterId;
    do {
      const pagina = await listarPaginaItens({ request, organizacaoId: escolhido.organizacao_id, processoId: escolhido.id, afterId, limit: 100 });
      itens.push(...pagina.itens);
      afterId = pagina.hasMore ? pagina.nextCursor : null;
    } while (afterId && itens.length < MAX_ITENS);
    if (afterId) falhar("Processo com itens demais para uma leitura.", 422);
    return resposta(200, {
      ok: true, compra,
      processo: { processoId: escolhido.id, numero: escolhido.numero, objeto: escolhido.objeto },
      itens: itens.filter((i) => i.valor_unitario_proposta).map((i) => ({
        item: i.identificador, quantidade: i.quantidade, valorUnitario: i.valor_unitario_proposta,
        marca: i.marca ?? null, modelo: i.modelo ?? null, fabricante: i.fabricante ?? null, valorMinimo: i.valor_unitario_minimo ?? null,
      })),
    });
  } catch (e) {
    return resposta(e.status || 503, { erro: e.status ? e.message : "Lote indisponível neste ambiente." });
  }
};
