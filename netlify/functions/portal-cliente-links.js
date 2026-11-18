// Links do portal do cliente (COM login): criar, listar e revogar. Contrato: supabase/operacao_portal_cliente.sql.
// - criar: o token (256 bits, base64url) nasce aqui e só o sha256 vai para criar_link_cliente. O link
//   volta uma única vez nesta resposta; não há como recuperá-lo depois (o banco não tem o token).
//   Nunca registrar o token em log.
// - listar: lê com o token do PRÓPRIO usuário (RLS pode_acessar_processo_operacao + grant por coluna),
//   sem chave de serviço. Nunca pede token_hash nem ip_hash (o grant de coluna recusaria de qualquer jeito).
// - revogar: revogar_link_cliente confere a gestão do processo no banco.
// - A autorização de criar/revogar (cadastro aprovado, gestor/operador da empresa) mora na RPC.
const { createHash, randomBytes } = require("node:crypto");
const { cabecalhosPadrao, exigirUsuarioLogado, origemPermitida } = require("./_auth");

const SUPABASE_URL = "https://lsqjamqvmrcyrvowndiu.supabase.co";
const ANON = "sb_publishable_yH695cc52QUKYfFEgV5RwQ_0a8GLIeb";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_CORPO = 4096;
const TIMEOUT_MS = 8000;
const uuid = (v) => typeof v === "string" && UUID.test(v);

const COLUNAS_LINKS = "id,empresa_id,processo_id,rotulo,mostrar_minimo,criado_por,criado_em,expira_em,revogado_em,revogado_por,ultimo_acesso_em";
const COLUNAS_ACEITES = "id,link_id,item_id,decisao,observacao,visto,versao,criado_em";
const COLUNAS_AUDITORIA = "id,evento,link_id,usuario_id,detalhe,criado_em";

function validar(b) {
  if (!b || typeof b !== "object" || Array.isArray(b)) return false;
  if (b.acao === "criar") {
    const rotulo = typeof b.rotulo === "string" ? b.rotulo.trim() : "";
    return uuid(b.empresaId) && uuid(b.processoId) && rotulo.length >= 2 && rotulo.length <= 120
      && Number.isSafeInteger(b.dias) && b.dias >= 1 && b.dias <= 60 && typeof b.mostrarMinimo === "boolean";
  }
  if (b.acao === "listar") return uuid(b.processoId);
  if (b.acao === "revogar") return uuid(b.linkId);
  return false;
}

async function rpc(nome, args) {
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!chave) throw Object.assign(Error("sem chave"), { status: 503 });
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nome}`, {
    method: "POST",
    headers: { apikey: chave, Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    signal: globalThis.AbortSignal.timeout(TIMEOUT_MS),
  });
  const dados = await r.json().catch(() => null);
  if (r.ok) return dados;
  const codigo = dados?.code;
  const status = { PT400: 400, PT403: 403, PT409: 409 }[codigo] || ([400, 403, 409].includes(r.status) ? r.status : 503);
  throw Object.assign(Error("rpc"), { status });
}

async function ler(caminho, autorizacao) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, {
    headers: { apikey: ANON, Authorization: autorizacao, Accept: "application/json" },
    signal: globalThis.AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw Object.assign(Error("leitura"), { status: 503 });
  const dados = await r.json();
  if (!Array.isArray(dados)) throw Object.assign(Error("leitura"), { status: 503 });
  return dados;
}

const MENSAGENS = {
  400: "Dados do link inválidos.",
  403: "Acesso não autorizado.",
  409: "Este processo já tem 5 links ativos. Revogue um antes de criar outro.",
  503: "Não foi possível concluir agora. Tente de novo em instantes.",
};

exports.handler = async (event) => {
  const headers = { ...cabecalhosPadrao(event), "Cache-Control": "no-store" };
  const resposta = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  if (event.httpMethod === "OPTIONS") return resposta(204, {});
  if (event.httpMethod !== "POST") return resposta(405, { erro: "Método não permitido." });
  try {
    const auth = await exigirUsuarioLogado(event);
    if (!auth.ok) return resposta(auth.status, { erro: auth.erro });
    if (!uuid(auth.userId)) return resposta(401, { erro: "Sessão inválida." });
    if (typeof event.body !== "string" || Buffer.byteLength(event.body) > MAX_CORPO) return resposta(400, { erro: "Requisição inválida." });
    let b;
    try { b = JSON.parse(event.body); } catch { return resposta(400, { erro: "Requisição inválida." }); }
    if (!validar(b)) return resposta(400, { erro: "Requisição inválida." });

    if (b.acao === "criar") {
      const token = randomBytes(32).toString("base64url");
      const r = await rpc("criar_link_cliente", {
        p_usuario: auth.userId, p_empresa: b.empresaId, p_processo: b.processoId,
        p_token_hash: createHash("sha256").update(token).digest("hex"),
        p_rotulo: b.rotulo.trim(), p_dias: b.dias, p_mostrar_minimo: b.mostrarMinimo,
      });
      return resposta(200, { id: r?.id, link: `${origemPermitida(event)}/cliente#t=${token}`, expiraEm: r?.expira_em });
    }
    if (b.acao === "revogar") {
      const r = await rpc("revogar_link_cliente", { p_usuario: auth.userId, p_link: b.linkId });
      return resposta(200, { id: r?.id, revogadoEm: r?.revogado_em });
    }
    const autorizacao = event.headers?.authorization || event.headers?.Authorization;
    const p = `processo_id=eq.${b.processoId}`;
    const [links, aceites, auditoria] = await Promise.all([
      ler(`operacao_links_cliente?${p}&select=${COLUNAS_LINKS}&order=criado_em.desc&limit=100`, autorizacao),
      ler(`operacao_aceites_item?${p}&select=${COLUNAS_ACEITES}&order=criado_em.desc&limit=1000`, autorizacao),
      ler(`operacao_portal_auditoria?${p}&select=${COLUNAS_AUDITORIA}&order=criado_em.desc&limit=200`, autorizacao),
    ]);
    return resposta(200, { links, aceites, auditoria });
  } catch (e) {
    const status = MENSAGENS[e?.status] ? e.status : 503;
    return resposta(status, { erro: MENSAGENS[status] });
  }
};
