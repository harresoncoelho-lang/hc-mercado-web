// Cadeia de provedores de IA para o "Pergunte ao edital". A Groq falhou várias vezes
// (429/5xx) e o produto não pode depender de um único provedor. Só usa `fetch`: roda no
// Cloudflare Pages Functions (plano gratuito, 10 ms de CPU por requisição; esperar o fetch
// não conta), então nada de SDK nem processamento pesado aqui.
// Ordem: Groq (chamarGroq existente) → Gemini → OpenRouter → Cloudflare Workers AI.
// Provedor sem chave é ignorado. Qualquer falha (429/413/5xx/401/403/404, timeout, rede ou
// resposta vazia) passa ao próximo; a primeira resposta com texto encerra a cadeia.

const URL_GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const URL_OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";
const MODELOS_GEMINI_PADRAO = "gemini-3.8-flash,gemini-3.7-flash";
const MODELO_CLOUDFLARE_PADRAO = "@cf/openai/gpt-oss-120b";
// Evita a requisição pendurada: cada chamada tem prazo próprio e, passado o orçamento total,
// nenhum provedor novo é iniciado (a Function tem um limite de tempo total).
const TIMEOUT_CHAMADA_MS = 15000;
const ORCAMENTO_TOTAL_MS = 40000;
const ERRO_TODOS_FALHARAM = "Os provedores de IA estão indisponíveis agora. Tente novamente mais tarde; os dados básicos da licitação continuam acessíveis.";

const lista = (valor, padrao = "") => String(valor || padrao).split(",").map((m) => m.trim()).filter(Boolean);

// Provedores OpenAI-compatíveis configurados no ambiente, na ordem da cadeia (sem a Groq).
function montarProvedoresCompat(env = process.env) {
  const provedores = [];
  const entradas = [
    ["gemini", URL_GEMINI, env.GEMINI_API_KEY, lista(env.GEMINI_MODELOS_PERGUNTA, MODELOS_GEMINI_PADRAO)],
    ["openrouter", URL_OPENROUTER, env.OPENROUTER_API_KEY, lista(env.OPENROUTER_MODELOS)],
    // Sem o ID da conta a URL nem existe, então os dois são obrigatórios.
    ["cloudflare", `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID || "")}/ai/v1/chat/completions`,
      env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_TOKEN, env.CLOUDFLARE_AI_MODELO ? [env.CLOUDFLARE_AI_MODELO.trim()] : [MODELO_CLOUDFLARE_PADRAO]],
  ];
  for (const [nome, url, chave, modelos] of entradas) {
    if (!chave || !modelos.length) continue;
    provedores.push({ nome, url, apiKey: nome === "cloudflare" ? env.CLOUDFLARE_AI_TOKEN : chave, modelos });
  }
  return provedores;
}

function haProvedorConfigurado(env = process.env) {
  return Boolean(env.GROQ_API_KEY) || montarProvedoresCompat(env).length > 0;
}

async function chamarCompat(provedor, modelo, mensagens, opcoes, fetchFn) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_CHAMADA_MS);
  try {
    const resp = await fetchFn(provedor.url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${provedor.apiKey}` },
      body: JSON.stringify({ model: modelo, messages: mensagens, max_tokens: opcoes.maxTokens, temperature: 0.2 }),
    });
    // Nunca loga o corpo nem a chave: só o código curto.
    if (!resp.ok) { console.warn(`ia-provedores: ${provedor.nome} HTTP ${resp.status}`); return null; }
    const dados = await resp.json();
    const escolha = dados?.choices?.[0];
    const texto = String(escolha?.message?.content || "").trim();
    if (!texto || escolha?.finish_reason === "tool_calls") { console.warn(`ia-provedores: ${provedor.nome} resposta vazia`); return null; }
    return texto;
  } catch (e) {
    console.warn(`ia-provedores: ${provedor.nome} interrompido (${e?.name || "erro"})`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

// `groq` = chamarGroq já pronto para uso ((apiKey, mensagens, opts) => {ok,texto,erro}).
// Retorna { ok, texto, provedor, modelo } ou { ok:false, erro } (erro da Groq quando ela falhou,
// para manter a mensagem ao usuário de antes).
async function responderComFallback(mensagens, opcoes, { env = process.env, fetchFn = fetch, groq, agora = Date.now } = {}) {
  const inicio = agora();
  let erroGroq = null;
  const dentroDoOrcamento = () => agora() - inicio <= ORCAMENTO_TOTAL_MS;

  if (env.GROQ_API_KEY && groq) {
    const r = await groq(env.GROQ_API_KEY, mensagens, opcoes);
    if (r?.ok && r.texto) return { ok: true, texto: r.texto, provedor: "groq", modelo: r.modelo || null };
    erroGroq = r?.erro || null;
    console.warn("ia-provedores: groq falhou, tentando o próximo provedor");
  }
  for (const provedor of montarProvedoresCompat(env)) {
    for (const modelo of provedor.modelos) {
      if (!dentroDoOrcamento()) return { ok: false, erro: erroGroq || ERRO_TODOS_FALHARAM };
      const texto = await chamarCompat(provedor, modelo, mensagens, opcoes, fetchFn);
      if (texto) return { ok: true, texto, provedor: provedor.nome, modelo };
    }
  }
  return { ok: false, erro: erroGroq || ERRO_TODOS_FALHARAM };
}

module.exports = { responderComFallback, haProvedorConfigurado, montarProvedoresCompat, ERRO_TODOS_FALHARAM };
