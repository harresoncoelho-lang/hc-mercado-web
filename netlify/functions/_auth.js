// Utilitário compartilhado pelas Netlify Functions que custam dinheiro por chamada
// (ia-edital, despesas-fornecedor, sancoes) ou consultam dado sensível.
//
// Por quê isso existe: até agora, essas funções aceitavam chamada de qualquer lugar
// (Access-Control-Allow-Origin: "*") sem checar se quem chamou é um usuário logado do
// LicitaPlena — ou seja, qualquer pessoa que descobrisse o endereço da função podia chamá-la
// direto, sem estar logada e sem ser assinante, e isso soma na conta (cota da Groq, cota do
// token do Portal da Transparência). Ver Achado #3 do Diagnóstico Técnico Crítico.
//
// SUPABASE_URL/SUPABASE_ANON_KEY são as mesmas usadas no site (supabase-config.js) — a chave
// anon é pública por design, não é segredo. O que É segredo é SUPABASE_SERVICE_ROLE_KEY,
// usada só aqui, do lado do servidor, para gravar o contador de uso diário ignorando RLS.

const SUPABASE_URL = "https://lsqjamqvmrcyrvowndiu.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yH695cc52QUKYfFEgV5RwQ_0a8GLIeb";

// Origens permitidas a chamar essas funções. Ajuste aqui se o domínio mudar ou se for
// necessário liberar um ambiente de testes.
const ORIGENS_PERMITIDAS = [
  "https://licitaplena.com.br",
  "https://www.licitaplena.com.br",
  "https://hc-mercado-web.netlify.app",
];

function origemPermitida(event) {
  const origem = event.headers?.origin || event.headers?.Origin || "";
  return ORIGENS_PERMITIDAS.includes(origem) ? origem : ORIGENS_PERMITIDAS[0];
}

function cabecalhosPadrao(event) {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origemPermitida(event),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
}

// Confere se a requisição tem um token de sessão válido do Supabase (usuário realmente
// logado no LicitaPlena). Espera o token no cabeçalho Authorization: Bearer <token>, que o
// front-end já tem disponível via `(await sb.auth.getSession()).data.session.access_token`.
async function exigirUsuarioLogado(event) {
  const auth = event.headers?.authorization || event.headers?.Authorization || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { ok: false, status: 401, erro: "É preciso estar logado pra usar esta ferramenta." };
  }
  try {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      return { ok: false, status: 401, erro: "Sessão expirada ou inválida — faça login de novo." };
    }
    const user = await resp.json();
    if (!user || !user.id) {
      return { ok: false, status: 401, erro: "Sessão inválida." };
    }
    return { ok: true, userId: user.id, email: user.email };
  } catch (e) {
    return { ok: false, status: 401, erro: "Não foi possível validar sua sessão agora. Tenta de novo em instantes." };
  }
}

// Limite diário de uso por usuário e por função (ex: 30 resumos de edital/dia). Guardado no
// Supabase via a função incrementar_uso (ver supabase/rls_e_limite_de_uso.sql). Se
// SUPABASE_SERVICE_ROLE_KEY não estiver configurado no Netlify ainda, a checagem é pulada
// (fail-open) — melhor deixar passar do que derrubar a ferramenta por falta de configuração;
// mas assim que a chave for adicionada, o limite passa a valer automaticamente.
async function verificarLimiteDiario(userId, nomeFuncao, limite) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return { ok: true };
  }
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/incrementar_uso`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_usuario_id: userId, p_funcao: nomeFuncao }),
    });
    if (!resp.ok) {
      // Se a tabela/função ainda não existir no banco (migração não rodada), não trava o uso.
      return { ok: true };
    }
    const contagem = await resp.json();
    if (typeof contagem === "number" && contagem > limite) {
      return {
        ok: false,
        status: 429,
        erro: `Limite diário de uso desta ferramenta atingido (${limite}/dia). Volta amanhã ou fala com a gente pra ajustar seu plano.`,
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: true };
  }
}

module.exports = { cabecalhosPadrao, exigirUsuarioLogado, verificarLimiteDiario, origemPermitida };
