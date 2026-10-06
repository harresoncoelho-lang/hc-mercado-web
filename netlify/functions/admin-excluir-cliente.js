const { cabecalhosPadrao, exigirUsuarioLogado } = require("./_auth");

const BASE = "https://lsqjamqvmrcyrvowndiu.supabase.co";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function resposta(headers, statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

async function requisicaoServico(path, key, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${BASE}${path}`, {
      ...options,
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...options.headers },
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch (_) { data = { message: text }; }
    }
    return { ok: response.ok, status: response.status, data };
  } finally { clearTimeout(timer); }
}

async function linhas(tabela, filtro, key, select = "id") {
  const path = `/rest/v1/${tabela}?${filtro}&select=${encodeURIComponent(select)}&limit=1`;
  const result = await requisicaoServico(path, key);
  if (!result.ok || !Array.isArray(result.data)) throw new Error(`Falha ao verificar ${tabela}`);
  return result.data;
}

exports.handler = async (event) => {
  const headers = cabecalhosPadrao(event);
  if (event.httpMethod === "OPTIONS") return resposta(headers, 204, {});
  if (event.httpMethod !== "POST") return resposta(headers, 405, { erro: "Método não permitido." });
  const sessao = await exigirUsuarioLogado(event);
  if (!sessao.ok) return resposta(headers, sessao.status, { erro: sessao.erro });
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return resposta(headers, 503, { erro: "Exclusão indisponível: serviço administrativo não configurado." });
  try {
    const jwt = (event.headers?.authorization || event.headers?.Authorization || "").replace(/^Bearer\s+/i, "");
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1] || "", "base64url").toString("utf8"));
    if (payload.aal !== "aal2") return resposta(headers, 403, { erro: "Confirme a autenticação em duas etapas no painel administrativo." });
    const admin = await linhas("admins", `email=eq.${encodeURIComponent(sessao.email)}`, key, "email,role");
    if (admin[0]?.role !== "owner") return resposta(headers, 403, { erro: "Apenas o proprietário pode excluir clientes." });

    const { id, acao, confirmarEmail } = JSON.parse(event.body || "{}");
    if (!UUID.test(id || "") || !["verificar", "excluir"].includes(acao)) return resposta(headers, 400, { erro: "Solicitação inválida." });
    if (id === sessao.userId) return resposta(headers, 403, { erro: "Você não pode excluir sua própria conta." });
    const cliente = await linhas("clientes", `id=eq.${id}`, key, "id,email,nome,empresa");
    if (!cliente.length) return resposta(headers, 404, { erro: "Cliente não encontrado." });
    const [adminAlvo, orgs, membros] = await Promise.all([
      linhas("admins", `email=eq.${encodeURIComponent(cliente[0].email)}`, key),
      linhas("operacao_organizacoes", `owner_id=eq.${id}`, key),
      linhas("operacao_membros", `usuario_id=eq.${id}`, key),
    ]);
    const bloqueios = [];
    if (adminAlvo.length) bloqueios.push("Esta pessoa é administradora.");
    if (orgs.length || membros.length) bloqueios.push("Esta pessoa possui operação, empresas ou acessos vinculados. Revogue o acesso e preserve ou transfira os dados antes da exclusão.");
    if (acao === "verificar") return resposta(headers, 200, { cliente: cliente[0], podeExcluir: bloqueios.length === 0, bloqueios });
    if (bloqueios.length) return resposta(headers, 409, { erro: bloqueios.join(" ") });
    if (String(confirmarEmail || "").trim().toLowerCase() !== cliente[0].email.toLowerCase()) {
      return resposta(headers, 400, { erro: "Digite exatamente o e-mail do cadastro para confirmar." });
    }
    const removido = await requisicaoServico(`/auth/v1/admin/users/${id}`, key, { method: "DELETE" });
    if (!removido.ok) return resposta(headers, 409, { erro: "Não foi possível remover a conta. Ela pode ter dados ou arquivos vinculados. Nada foi excluído.", detalhe: removido.data?.msg || removido.data?.message });
    const perfil = await linhas("clientes", `id=eq.${id}`, key);
    if (perfil.length) {
      const excluido = await requisicaoServico(`/rest/v1/clientes?id=eq.${id}`, key, { method: "DELETE" });
      if (!excluido.ok) return resposta(headers, 500, { erro: "A conta de login foi removida, mas o perfil ainda precisa de revisão manual." });
    }
    return resposta(headers, 200, { ok: true });
  } catch (error) {
    console.error("admin-excluir-cliente:", error);
    return resposta(headers, 503, { erro: "Não foi possível verificar a exclusão com segurança. Tente novamente." });
  }
};
