// "Envie sua Dúvida" do painel. Substitui o Netlify Forms (que não existe no Cloudflare Pages).
//
// Por quê exige login e cota: o envio gasta a cota do e-mail transacional (ZeptoMail) e chega à
// caixa do suporte; sem sessão, qualquer um que descobrisse a URL poderia inundá-la de spam.
// O honeypot (campo "duvida-empresa", invisível ao usuário) continua como segunda barreira contra robôs.
const { cabecalhosPadrao, exigirUsuarioLogado, verificarLimiteDiario } = require("./_auth");
const { ZEPTOMAIL_URL, REMETENTE_PADRAO, NOME_REMETENTE, emailValido, normalizarTokenZepto, mensagemErroZepto } = require("./enviar-resumo-edital").compartilhado;

const LIMITE_DIARIO = 5;
const MAX_NOME = 100;
const MAX_EMAIL = 200;
const MAX_MENSAGEM = 5000;

function resposta(event, statusCode, body) {
  return { statusCode, headers: cabecalhosPadrao(event), body: JSON.stringify(body) };
}

// Valores vindos do cliente entram no assunto e no corpo: tira quebras de linha para impedir
// injeção de cabeçalho/linhas falsas no e-mail.
const linhaUnica = (valor, max) => String(valor || "").replace(/[\r\n]+/g, " ").trim().slice(0, max);

function validar(dados) {
  const nome = linhaUnica(dados.nome, MAX_NOME);
  const email = linhaUnica(dados.email, MAX_EMAIL);
  const mensagem = String(dados.mensagem || "").trim().slice(0, MAX_MENSAGEM);
  if (!nome) return { erro: "Informe seu nome." };
  if (!emailValido(email)) return { erro: "Informe um e-mail válido." };
  if (!mensagem) return { erro: "Escreva sua dúvida." };
  return { nome, email, mensagem };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return resposta(event, 204, {});
  if (event.httpMethod !== "POST") return resposta(event, 405, { erro: "Método não permitido." });

  const usuario = await exigirUsuarioLogado(event);
  if (!usuario.ok) return resposta(event, usuario.status, { erro: usuario.erro });

  const limite = await verificarLimiteDiario(usuario.userId, "enviar_duvida", LIMITE_DIARIO);
  if (!limite.ok) return resposta(event, limite.status, { erro: limite.erro });

  let dados;
  try {
    dados = JSON.parse(event.body || "{}");
  } catch (e) {
    return resposta(event, 400, { erro: "Dados da dúvida inválidos." });
  }
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) return resposta(event, 400, { erro: "Dados da dúvida inválidos." });

  // Robô preencheu o campo escondido: responde sucesso para não revelar o filtro, mas não envia.
  if (String(dados["duvida-empresa"] || "").trim()) return resposta(event, 200, { ok: true });

  const campos = validar(dados);
  if (campos.erro) return resposta(event, 400, { erro: campos.erro });

  const token = normalizarTokenZepto(process.env.ZEPTOMAIL_TOKEN);
  if (!token) return resposta(event, 503, { erro: "O serviço de e-mail ainda não foi configurado. Tente novamente após a conclusão da configuração." });
  // Destino configurável; sem a variável, cai no endereço do próprio site (o mesmo remetente
  // verificado usado nos e-mails de resumo) — nunca um e-mail pessoal fixo no código.
  const destino = linhaUnica(process.env.EMAIL_DUVIDAS, MAX_EMAIL) || REMETENTE_PADRAO;
  if (!emailValido(destino)) return resposta(event, 503, { erro: "O destino das dúvidas não está configurado corretamente." });

  try {
    const api = await fetch(ZEPTOMAIL_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Zoho-enczapikey ${token}` },
      body: JSON.stringify({
        from: { address: REMETENTE_PADRAO, name: NOME_REMETENTE },
        to: [{ email_address: { address: destino } }],
        // Responder ao e-mail leva direto ao cliente que perguntou.
        reply_to: [{ address: campos.email, name: campos.nome }],
        subject: `Dúvida de cliente: ${campos.nome}`,
        textbody: `Nome: ${campos.nome}\nE-mail: ${campos.email}\n\n${campos.mensagem}`,
      }),
    });
    if (!api.ok) {
      const erro = mensagemErroZepto(api.status, await api.text());
      console.error("ZeptoMail recusou a dúvida:", api.status, erro);
      return resposta(event, 502, { erro });
    }
    return resposta(event, 200, { ok: true });
  } catch (e) {
    console.error("Falha ao enviar dúvida por e-mail:", e.message);
    return resposta(event, 502, { erro: "Não foi possível enviar sua dúvida agora. Tente novamente em instantes." });
  }
};

exports.__test = { validar };
