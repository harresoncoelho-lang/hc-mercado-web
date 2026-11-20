// Utilidades das telas de acesso (login, cadastro, convite, admin): olho da senha e captcha Cloudflare Turnstile.
/* global module, window, TURNSTILE_SITEKEY */
(function (raiz) {
  // Chave de teste oficial da Cloudflare: sempre passa, sem desafio visível. O Supabase local não exige captcha.
  const CHAVE_TESTE = "1x00000000000000000000AA";
  const HOSTS_LOCAIS = ["localhost", "127.0.0.1", "[::1]", "::1"];
  const SCRIPT_TURNSTILE = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=licitaplenaTurnstilePronto";
  const MSG_CAPTCHA = "Não conseguimos concluir a verificação de segurança. Aguarde alguns segundos e tente de novo. Se continuar, recarregue a página.";

  // A chave de produção fica só em supabase-config.js (TURNSTILE_SITEKEY). Vazia = captcha desligado.
  function chaveConfigurada() {
    return typeof TURNSTILE_SITEKEY === "string" ? TURNSTILE_SITEKEY : "";
  }

  function chaveTurnstile(hostname, chaveProducao) {
    if (HOSTS_LOCAIS.includes(String(hostname || "").toLowerCase())) return CHAVE_TESTE;
    return String(chaveProducao || "").trim();
  }

  // Erro do Supabase Auth causado pelo captcha (ex.: "captcha protection: request disallowed").
  function ehErroDeCaptcha(erro) {
    return /captcha/i.test(String((erro && erro.message) || ""));
  }

  // Monta o widget no .captcha-turnstile da página e devolve { ativo, obterToken, resetar }.
  // Sem chave (produção ainda não configurada) não carrega script nenhum e o token sai vazio:
  // o login segue como antes, porque o Supabase só cobra o captcha depois que o dono liga a exigência.
  function montarTurnstile(doc, win, chaveProducao = chaveConfigurada()) {
    const el = doc.querySelector(".captcha-turnstile");
    const aviso = doc.querySelector(".captcha-aviso");
    const sitekey = el ? chaveTurnstile(win.location.hostname, chaveProducao) : "";
    let widgetId = null;
    let token = "";
    let esperando = [];

    const entregar = () => { const fila = esperando; esperando = []; fila.forEach((f) => f(token)); };
    const mostrarFalha = () => { token = ""; if (aviso) { aviso.textContent = MSG_CAPTCHA; aviso.hidden = false; } entregar(); };

    const captcha = {
      ativo: Boolean(sitekey),
      // Espera o token por até limiteMs (o modo Managed costuma responder em 1 a 2 s). Sem token, segue vazio:
      // quem decide se bloqueia é o Supabase, e o erro dele vira MSG_CAPTCHA na tela.
      obterToken(limiteMs = 8000) {
        if (!sitekey || token) return Promise.resolve(token);
        return new Promise((resolver) => { esperando.push(resolver); win.setTimeout(() => resolver(token), limiteMs); });
      },
      // Token é de uso único: resetar depois de cada tentativa (deu certo ou não).
      resetar() {
        token = "";
        if (aviso) aviso.hidden = true;
        if (widgetId !== null && win.turnstile) win.turnstile.reset(widgetId);
      },
    };
    if (!sitekey) { if (el) el.hidden = true; return captcha; }

    win.licitaplenaTurnstilePronto = () => {
      widgetId = win.turnstile.render(el, {
        sitekey,
        theme: doc.documentElement.dataset.theme === "dark" ? "dark" : "light",
        language: "pt-br",
        appearance: "interaction-only", // invisível; só aparece se a Cloudflare pedir interação
        size: "flexible",
        callback: (t) => { token = t; if (aviso) aviso.hidden = true; entregar(); },
        "expired-callback": () => { token = ""; },
        "error-callback": mostrarFalha,
        "timeout-callback": mostrarFalha,
      });
    };
    const s = doc.createElement("script");
    s.src = SCRIPT_TURNSTILE;
    s.async = true;
    s.defer = true;
    s.onerror = mostrarFalha; // bloqueado por extensão/rede: avisa sem travar
    doc.head.appendChild(s);
    return captcha;
  }

  // Alterna type password/text e o estado do botão (aria-label, aria-pressed, ícone do olho).
  function alternarSenha(btn, doc) {
    const alvo = doc.getElementById(btn.dataset.alvo);
    alvo.type = alvo.type === "password" ? "text" : "password";
    const visivel = alvo.type === "text";
    btn.setAttribute("aria-pressed", String(visivel));
    btn.setAttribute("aria-label", visivel ? "Ocultar senha" : "Mostrar senha");
    btn.title = visivel ? "Ocultar senha" : "Mostrar senha";
    btn.classList.toggle("senha-visivel", visivel);
    return visivel;
  }

  function ligarOlhosDaSenha(doc) {
    doc.querySelectorAll(".btn-mostrar-senha").forEach((btn) => btn.addEventListener("click", () => alternarSenha(btn, doc)));
  }

  const api = { CHAVE_TESTE, MSG_CAPTCHA, SCRIPT_TURNSTILE, chaveTurnstile, ehErroDeCaptcha, montarTurnstile, alternarSenha, ligarOlhosDaSenha };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.SenhaCaptchaUi = api;
})(typeof window !== "undefined" ? window : globalThis);
