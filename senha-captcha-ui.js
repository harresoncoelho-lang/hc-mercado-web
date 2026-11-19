// Utilidades das telas de acesso (login, cadastro, convite, admin): olho da senha e chave do hCaptcha.
/* global module, window */
(function (raiz) {
  // Chave de produção: vale só no domínio real. Em localhost o hCaptcha a recusa ("Solicitação não permitida").
  const CHAVE_PRODUCAO = "E358601C-A03C-4316-9F24-B3DC4316992E";
  // Chave de teste oficial do hCaptcha. O Supabase local (ambiente-teste) não exige captcha, então o token é ignorado.
  const CHAVE_TESTE = "10000000-ffff-ffff-ffff-000000000001";
  const HOSTS_LOCAIS = ["localhost", "127.0.0.1", "[::1]", "::1"];

  function chaveHCaptcha(hostname) {
    return HOSTS_LOCAIS.includes(String(hostname || "").toLowerCase()) ? CHAVE_TESTE : CHAVE_PRODUCAO;
  }

  // Chamar antes de o api.js renderizar o widget (script inline logo após o .h-captcha).
  function aplicarChaveHCaptcha(doc, hostname) {
    doc.querySelectorAll(".h-captcha").forEach((el) => { el.dataset.sitekey = chaveHCaptcha(hostname); });
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

  const api = { CHAVE_PRODUCAO, CHAVE_TESTE, chaveHCaptcha, aplicarChaveHCaptcha, alternarSenha, ligarOlhosDaSenha };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.SenhaCaptchaUi = api;
})(typeof window !== "undefined" ? window : globalThis);
