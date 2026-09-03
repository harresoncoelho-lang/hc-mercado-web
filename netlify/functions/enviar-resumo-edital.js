// Envio individual do resumo de edital pelo e-mail transacional do LicitaPlena.
// O token do ZeptoMail fica exclusivamente nas variáveis de ambiente da Netlify;
// nunca é entregue ao navegador.
const { cabecalhosPadrao, exigirUsuarioLogado, verificarLimiteDiario } = require("./_auth");

const ZEPTOMAIL_URL = "https://api.zeptomail.com/v1.1/email";
const REMETENTE_PADRAO = "licitaplena@licitaplena.com.br";
const NOME_REMETENTE = "LicitaPlena";
const URL_LOGO = "https://licitaplena.com.br/logo.png";

function normalizarTokenZepto(token) {
  // Aceita tanto a chave pura quanto o valor copiado do exemplo de cabeçalho da
  // documentação. A variável precisa guardar a chave do Agent, não o prefixo.
  return String(token || "")
    .trim()
    .replace(/^Zoho-enczapikey\s+/i, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function mensagemErroZepto(status, corpo) {
  let respostaProvedor = null;
  try { respostaProvedor = JSON.parse(corpo || "{}"); } catch (e) { respostaProvedor = null; }
  const erro = respostaProvedor && respostaProvedor.error || null;
  // Dependendo do tipo de recusa, o ZeptoMail pode devolver o código no erro
  // principal ou dentro de `details`. Tratamos ambos sem retornar a resposta do
  // provedor ao navegador (ela pode conter informações operacionais internas).
  const codigo = String((erro && erro.code) || "");
  const detalhes = Array.isArray(erro && erro.details) ? erro.details : [];
  const codigos = new Set([codigo, ...detalhes.map((d) => String(d && d.code || ""))]);
  if (codigos.has("LE_101") || codigos.has("LE_102")) return "Os créditos do serviço de e-mail se esgotaram. Verifique a assinatura do ZeptoMail.";
  if (codigos.has("AE_101")) return "A conta do serviço de e-mail está bloqueada e precisa ser liberada no ZeptoMail.";
  if (codigos.has("SM_111")) return "O domínio remetente ainda não está verificado no agente do ZeptoMail. Verifique o domínio licitaplena.com.br no agente de envio.";
  if (codigos.has("SM_128") || codigos.has("SM_133")) return "A conta do ZeptoMail ainda aguarda aprovação para enviar e-mails pela API.";
  if (codigos.has("SERR_157")) return "A chave de envio do ZeptoMail não é válida ou foi revogada. Atualize a variável secreta ZEPTOMAIL_TOKEN.";
  if (codigos.has("SMI_115")) return "O limite diário do agente de e-mail foi atingido. Tente novamente no próximo período.";
  if (codigos.has("SERR_156")) return "O agente do ZeptoMail restringe os IPs de envio. É preciso liberar o ambiente de produção na lista de IPs autorizados.";
  if (codigos.has("SM_113")) return "O endereço de remetente configurado não é aceito pelo ZeptoMail. Verifique o agente e o domínio licitaplena.com.br.";
  const textoErro = [erro && erro.message, ...detalhes.map((d) => d && d.message)].filter(Boolean).join(" ");
  if (/token|api[ _-]?key|authentication|authorization|credencial/i.test(textoErro)) {
    return "A chave do serviço de e-mail não foi aceita. Use a Send API key do Agent do ZeptoMail na variável secreta ZEPTOMAIL_TOKEN.";
  }
  if (/domain|sender|remetente|from/i.test(textoErro)) {
    return "O endereço remetente não foi aceito pelo Agent do ZeptoMail. Confirme licitaplena@licitaplena.com.br como remetente verificado.";
  }
  if (status === 401 || status === 403) return "A chave do serviço de e-mail não foi aceita. Verifique a chave de envio do agente no ZeptoMail.";
  return codigo ? `O serviço de e-mail recusou o envio (código ZeptoMail: ${codigo}). Verifique o Agent do ZeptoMail.` : "O serviço de e-mail recusou o envio. Verifique a Send API key e o remetente verificado no Agent do ZeptoMail.";
}

function escapeHtml(valor) {
  return String(valor || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function emailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function linkPncpValido(link) {
  try {
    const url = new URL(String(link || "").trim());
    return url.protocol === "https:" && (url.hostname === "pncp.gov.br" || url.hostname.endsWith(".pncp.gov.br"));
  } catch (e) {
    return false;
  }
}

function resposta(event, statusCode, body) {
  return { statusCode, headers: cabecalhosPadrao(event), body: JSON.stringify(body) };
}

function montarHtml(texto, linkEdital) {
  const conteudo = escapeHtml(texto).replace(/\r?\n/g, "<br>");
  const chamadaEdital = linkPncpValido(linkEdital)
    ? `<div style="margin-top:24px;"><a href="${escapeHtml(linkEdital)}" style="display:inline-block;background:#1f75df;border-radius:7px;padding:12px 18px;color:#fff;text-decoration:none;font-weight:700;">Abrir licitação no PNCP</a><p style="margin:10px 0 0;color:#66778e;font-size:12px;">Use o portal oficial para consultar o edital, anexos e documentos do processo.</p></div>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#162d4c;">
    <main style="max-width:680px;margin:24px auto;background:#fff;border:1px solid #dce5f0;border-radius:12px;overflow:hidden;">
      <header style="padding:18px 28px;background:#082243;color:#fff;font-size:21px;font-weight:700;"><img src="${URL_LOGO}" alt="LicitaPlena" width="38" height="38" style="display:inline-block;vertical-align:middle;width:38px;height:38px;object-fit:contain;margin-right:11px;"> <span style="vertical-align:middle;">LicitaPlena</span></header>
      <section style="padding:28px;font-size:15px;line-height:1.6;">${conteudo}${chamadaEdital}</section>
      <footer style="padding:16px 28px;border-top:1px solid #dce5f0;color:#66778e;font-size:12px;">Resumo preparado no LicitaPlena com base em dados públicos. Confira sempre o edital oficial antes de decidir.</footer>
    </main></body></html>`;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return resposta(event, 204, {});
  if (event.httpMethod !== "POST") return resposta(event, 405, { erro: "Método não permitido." });

  const usuario = await exigirUsuarioLogado(event);
  if (!usuario.ok) return resposta(event, usuario.status, { erro: usuario.erro });

  const limite = await verificarLimiteDiario(usuario.userId, "enviar_resumo_edital", 20);
  if (!limite.ok) return resposta(event, limite.status, { erro: limite.erro });

  let dados;
  try {
    dados = JSON.parse(event.body || "{}");
  } catch (e) {
    return resposta(event, 400, { erro: "Dados do envio inválidos." });
  }

  const destino = String(dados.destino || "").trim().toLowerCase();
  const nomeDestino = String(dados.nomeDestino || "").trim().slice(0, 100);
  const assunto = String(dados.assunto || "Oportunidade para análise").trim().slice(0, 180);
  const texto = String(dados.texto || "").trim().slice(0, 25000);
  const linkEdital = String(dados.linkEdital || "").trim().slice(0, 500);
  if (!emailValido(destino)) return resposta(event, 400, { erro: "Informe um e-mail de destino válido." });
  if (!texto) return resposta(event, 400, { erro: "Não há conteúdo para enviar." });

  const token = normalizarTokenZepto(process.env.ZEPTOMAIL_TOKEN);
  if (!token) {
    return resposta(event, 503, { erro: "O serviço de e-mail ainda não foi configurado. Tente novamente após a conclusão da configuração." });
  }

  try {
    // O e-mail exibido para o usuário e o e-mail transmitido precisam ser o mesmo.
    // Não usamos variáveis antigas de remetente/resposta, pois uma delas pode apontar para
    // domínio não verificado e fazer o ZeptoMail rejeitar toda a mensagem.
    const remetente = REMETENTE_PADRAO;
    const api = await fetch(ZEPTOMAIL_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Zoho-enczapikey ${token}`,
      },
      body: JSON.stringify({
        from: { address: remetente, name: NOME_REMETENTE },
        to: [{ email_address: { address: destino, ...(nomeDestino ? { name: nomeDestino } : {}) } }],
        reply_to: [{ address: remetente, name: NOME_REMETENTE }],
        subject: assunto,
        htmlbody: montarHtml(texto, linkEdital),
        textbody: texto,
      }),
    });
    if (!api.ok) {
      const corpo = await api.text();
      const erro = mensagemErroZepto(api.status, corpo);
      console.error("ZeptoMail recusou o envio:", api.status, erro);
      return resposta(event, 502, { erro });
    }
    return resposta(event, 200, { ok: true, mensagem: "E-mail enviado com sucesso." });
  } catch (e) {
    console.error("Falha ao enviar resumo por e-mail:", e.message);
    return resposta(event, 502, { erro: "Não foi possível enviar o e-mail agora. Tente novamente em instantes." });
  }
};

exports.__test = { emailValido, linkPncpValido, montarHtml, mensagemErroZepto, normalizarTokenZepto };
