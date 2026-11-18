// Portal do cliente (PÚBLICO, sem login): o cliente da empresa abre /cliente#t=<token>, lê os itens do
// processo e aprova/recusa item a item. Contrato: supabase/operacao_portal_cliente.sql (portal_ler,
// portal_responder; só service_role).
// - Desligado por padrão: só responde com PORTAL_CLIENTE_LIGADO=1.
// - O token nunca sai daqui: o banco recebe só sha256(token) em hex. O IP também não: vai como
//   HMAC-SHA256(PORTAL_IP_SALT, ip). Sem salt, 503 (sem salt o hash do IP seria reversível por força bruta).
// - Token fora do formato (43 caracteres base64url) responde 404 sem tocar no banco.
// - Link inexistente, expirado ou revogado: a RPC devolve null e a resposta é sempre o mesmo 404.
// - 1 subrequisição por chamada (limite do Cloudflare Pages grátis), com timeout de 8 s.
// - Cada resposta é validada aqui com o mesmo contrato do SQL (uuid, decisão, versão de 32 hex, observação
//   de até 1000 caracteres) antes de ir ao banco. portal_responder devolve {erro, codigo} em vez de raise,
//   então o contador de limite e a auditoria 'negado' ficam gravados mesmo quando a resposta é recusada.
// - O limitador em memória abaixo é só uma segunda barreira por isolate (cada isolate do Cloudflare tem o
//   próprio Map e ele some quando o isolate recicla): NÃO substitui o limite do banco.
// IP de origem (revisão de segurança, M2): cada plataforma tem UM cabeçalho confiável, e só ele vale.
// - Cloudflare Pages: cf-connecting-ip, que a borda sempre reescreve. Só é lido quando o código roda no
//   runtime do Workers (navigator.userAgent === "Cloudflare-Workers"). Isso não vem da requisição, então
//   um cliente não forja; um cabeçalho interno marcado pelo adaptador seria forjável se o adaptador um
//   dia deixasse de apagá-lo.
// - Fora do Workers (Netlify): só x-nf-client-connection-ip, que a borda do Netlify define. cf-connecting-ip
//   e x-forwarded-for vindos do cliente são ignorados.
// - Sem IP confiável: a origem vira o próprio token, com limite em memória mais estrito (10/min). No banco
//   os limites "por IP" passam a valer por token; o token tem 256 bits, então isso não abre enumeração.
const { createHash, createHmac } = require("node:crypto");
const { cabecalhosPadrao } = require("./_auth");

const SUPABASE_URL = "https://lsqjamqvmrcyrvowndiu.supabase.co";
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MAX_CORPO = 32 * 1024;
const MAX_RESPOSTAS = 200;
const MAX_PAGINA = 1000;
const TIMEOUT_MS = 8000;
const LINK_INVALIDO = "Link inválido ou expirado.";
// Nunca vão para o navegador, mesmo que a RPC passe a devolvê-las por engano.
const CHAVES_PROIBIDAS = new Set(["cnpj", "organizacao_id", "token_hash", "ip_hash"]);

// Limitador em memória por isolate: 30 requisições por minuto por ip_hash.
const LIMITE_MEMORIA = 30;
const LIMITE_MEMORIA_SEM_IP = 10;
const JANELA_MS = 60000;
const MAX_ENTRADAS = 5000;
const contagens = new Map();
function estourouMemoria(chave, limite = LIMITE_MEMORIA, agora = Date.now()) {
  const atual = contagens.get(chave);
  if (atual && agora - atual.inicio < JANELA_MS) {
    atual.n += 1;
    return atual.n > limite;
  }
  contagens.delete(chave);
  if (contagens.size >= MAX_ENTRADAS) {
    for (const [k, v] of contagens) if (agora - v.inicio >= JANELA_MS) contagens.delete(k);
    // Ainda cheio: descarta a entrada mais antiga (Map mantém a ordem de inserção).
    if (contagens.size >= MAX_ENTRADAS) contagens.delete(contagens.keys().next().value);
  }
  contagens.set(chave, { n: 1, inicio: agora });
  return false;
}

const emCloudflare = () => globalThis.navigator?.userAgent === "Cloudflare-Workers";

// IP confiável da plataforma ou null (ver o cabeçalho deste arquivo).
function ipDoEvento(headers, naCloudflare = emCloudflare()) {
  const h = headers || {};
  const ip = naCloudflare ? h["cf-connecting-ip"] : h["x-nf-client-connection-ip"];
  return typeof ip === "string" && ip.trim() ? ip.trim() : null;
}

function lerCorpo(event) {
  if (typeof event.body !== "string") return null;
  const texto = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  if (Buffer.byteLength(texto) > MAX_CORPO) return null;
  try {
    const b = JSON.parse(texto);
    return b && typeof b === "object" && !Array.isArray(b) ? b : null;
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const VERSAO = /^[0-9a-f]{32}$/;
// Mesmo contrato de portal_responder; o tamanho da observação conta caracteres como o length() do Postgres.
function respostaValida(r) {
  return r !== null && typeof r === "object" && !Array.isArray(r)
    && Object.keys(r).every((k) => ["item_id", "decisao", "versao", "observacao"].includes(k))
    && typeof r.item_id === "string" && UUID.test(r.item_id)
    && (r.decisao === "aprovado" || r.decisao === "recusado")
    && typeof r.versao === "string" && VERSAO.test(r.versao)
    && (r.observacao === undefined || r.observacao === null || (typeof r.observacao === "string" && [...r.observacao].length <= 1000));
}

function pedidoValido(b) {
  if (Object.keys(b).some((k) => !["token", "acao", "pagina", "respostas"].includes(k))) return false;
  if (b.acao === "ler") return b.respostas === undefined && (b.pagina === undefined || (Number.isSafeInteger(b.pagina) && b.pagina >= 1 && b.pagina <= MAX_PAGINA));
  if (b.acao === "responder") return b.pagina === undefined && Array.isArray(b.respostas) && b.respostas.length >= 1 && b.respostas.length <= MAX_RESPOSTAS && b.respostas.every(respostaValida);
  return false;
}

async function chamarRpc(nome, args, chave) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nome}`, {
    method: "POST",
    headers: { apikey: chave, Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    signal: globalThis.AbortSignal.timeout(TIMEOUT_MS),
  });
  const dados = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, dados };
}

exports.handler = async (event) => {
  const headers = { ...cabecalhosPadrao(event), "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
  const resposta = (statusCode, body, extra = {}) => ({
    statusCode,
    headers: { ...headers, ...extra },
    body: JSON.stringify(body, (k, v) => (CHAVES_PROIBIDAS.has(k) ? undefined : v)),
  });
  if (event.httpMethod === "OPTIONS") return resposta(204, {});
  if (event.httpMethod !== "POST") return resposta(405, { erro: "Método não permitido." });
  const salt = process.env.PORTAL_IP_SALT;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.PORTAL_CLIENTE_LIGADO !== "1" || !salt || !chave) return resposta(503, { erro: "Portal indisponível no momento." });

  const b = lerCorpo(event);
  if (!b || !pedidoValido(b)) return resposta(400, { erro: "Requisição inválida." });
  const ip = ipDoEvento(event.headers);
  const ipHash = createHmac("sha256", salt).update(ip ? `ip:${ip}` : `token:${String(b.token)}`).digest("hex");
  if (estourouMemoria(ipHash, ip ? LIMITE_MEMORIA : LIMITE_MEMORIA_SEM_IP)) return resposta(429, { erro: "Muitas tentativas. Aguarde um minuto." }, { "Retry-After": "60" });
  if (typeof b.token !== "string" || !TOKEN.test(b.token)) return resposta(404, { erro: LINK_INVALIDO });
  const tokenHash = createHash("sha256").update(b.token).digest("hex");

  let r;
  try {
    r = b.acao === "ler"
      ? await chamarRpc("portal_ler", { p_token_hash: tokenHash, p_ip_hash: ipHash, p_pagina: b.pagina ?? 1 }, chave)
      : await chamarRpc("portal_responder", { p_token_hash: tokenHash, p_respostas: b.respostas, p_ip_hash: ipHash }, chave);
  } catch {
    return resposta(503, { erro: "Portal indisponível no momento. Tente de novo em instantes." });
  }
  if (!r.ok) {
    const codigo = r.dados?.code;
    if (codigo === "PT400" || r.status === 400) return resposta(400, { erro: "Requisição inválida." });
    if (codigo === "PT403" || r.status === 403) return resposta(403, { erro: "Acesso não autorizado." });
    return resposta(503, { erro: "Portal indisponível no momento. Tente de novo em instantes." });
  }
  const d = r.dados;
  if (d === null || typeof d !== "object") return resposta(404, { erro: LINK_INVALIDO });
  if (d.codigo === "invalido") return resposta(400, { erro: "Requisição inválida." });
  if (d.codigo === "proibido") return resposta(403, { erro: "Acesso não autorizado." });
  if (d.limite === true) return resposta(429, { erro: "Muitas tentativas. Aguarde um minuto." }, { "Retry-After": "60" });
  if (Array.isArray(d.divergentes)) return resposta(409, { erro: "Alguns itens mudaram desde que você abriu a página. Recarregue e confira.", divergentes: d.divergentes });
  return resposta(200, d);
};
