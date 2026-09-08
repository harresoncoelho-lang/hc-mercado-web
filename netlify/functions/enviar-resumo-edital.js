// Envio individual do resumo de edital pelo e-mail transacional do LicitaPlena.
// O token do ZeptoMail fica exclusivamente nas variáveis de ambiente da Netlify;
// nunca é entregue ao navegador.
const { cabecalhosPadrao, exigirUsuarioLogado, verificarLimiteDiario } = require("./_auth");

const ZEPTOMAIL_URL = "https://api.zeptomail.com/v1.1/email";
const REMETENTE_PADRAO = "licitaplena@licitaplena.com.br";
const NOME_REMETENTE = "LicitaPlena";
const MAX_DESTINATARIOS_POR_ENVIO = 10;
// Logo branca para a faixa institucional azul. PNG é usado em vez de SVG porque
// clientes de e-mail, especialmente em iPhone, têm suporte inconsistente a SVG.
const URL_LOGO = "https://licitaplena.com.br/logo.png?v=20260908";

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

function normalizarDestinatarios(destinos) {
  const lista = Array.isArray(destinos) ? destinos : [destinos];
  const unicos = new Set();
  for (const valor of lista) {
    for (const email of String(valor || "").split(/[;,]+/)) {
      const normalizado = email.trim().toLowerCase();
      if (normalizado) unicos.add(normalizado);
    }
  }
  return [...unicos];
}

function linkPncpValido(link) {
  try {
    const url = new URL(String(link || "").trim());
    return url.protocol === "https:" && (url.hostname === "pncp.gov.br" || url.hostname.endsWith(".pncp.gov.br"));
  } catch (e) {
    return false;
  }
}

function textoResumo(valor) {
  if (valor === null || valor === undefined) return "";
  if (typeof valor !== "object") return String(valor).trim();
  const principal = valor.titulo || valor.pergunta || valor.texto || valor.descricao || valor.item || valor.conteudo || valor.motivo;
  return principal ? String(principal).trim() : "";
}

function valorResumo(valor) {
  const texto = textoResumo(valor);
  return texto && !/^n[ãa]o informado$/i.test(texto) ? texto : "";
}

// A API pública costuma entregar datas no padrão ISO. Não usamos `new Date()`
// aqui porque ele pode deslocar a data conforme o fuso do servidor. A troca é
// puramente textual e mantém o horário exato informado pela fonte.
function formatarDataHoraBR(valor) {
  const texto = valorResumo(valor);
  const partes = texto.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/);
  if (!partes) return texto;
  const [, ano, mes, dia, hora, minuto] = partes;
  return hora && minuto ? `${dia}/${mes}/${ano} às ${hora}:${minuto}` : `${dia}/${mes}/${ano}`;
}

function tabelaResumo(linhas) {
  const visiveis = linhas
    .map(([rotulo, valor]) => [rotulo, valorResumo(valor)])
    .filter(([, valor]) => valor);
  if (!visiveis.length) return "";
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">${visiveis.map(([rotulo, valor]) => `<tr><td style="width:35%;padding:5px 12px 5px 0;color:#637085;font-size:13px;vertical-align:top;">${escapeHtml(rotulo)}</td><td style="padding:5px 0;color:#162d4c;font-size:13px;font-weight:600;vertical-align:top;">${escapeHtml(valor)}</td></tr>`).join("")}</table>`;
}

function listaResumo(itens) {
  const visiveis = Array.isArray(itens) ? itens.map(valorResumo).filter(Boolean) : [];
  if (!visiveis.length) return "";
  return `<ul style="margin:0;padding:0 0 0 19px;color:#162d4c;font-size:13px;line-height:1.55;">${visiveis.map((item) => `<li style="margin:0 0 5px;">${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function secaoResumo(titulo, conteudo) {
  if (!conteudo) return "";
  return `<tr><td style="padding:0 0 18px;"><div style="padding:14px 16px;border:1px solid #dce5f0;background:#f8fafc;"><div style="margin:0 0 9px;color:#102d56;font-size:15px;font-weight:700;">${escapeHtml(titulo)}</div>${conteudo}</div></td></tr>`;
}

function montarConteudoEstruturado(resumo, edital) {
  if (!resumo || typeof resumo !== "object") return "";
  const identificacao = resumo.identificacao || {};
  const sessao = resumo.sessaoPublica || {};
  const orgao = resumo.orgao || {};
  const detalhes = resumo.detalhes || {};
  const uasg = /^\d{5,6}$/.test(String(identificacao.uasg || "").trim()) ? identificacao.uasg : "";
  const temDadosOperacionaisDoPortal = Boolean(detalhes.tipoAnalise || detalhes.regimeExecucao || resumo.criteriosProposta && resumo.criteriosProposta.propostasLancesPor);
  const criterioJulgamento = detalhes.criterioJulgamento || (!temDadosOperacionaisDoPortal ? edital?.criterioJulgamento : "");
  const itensPncp = Array.isArray(resumo.itensPncp) ? resumo.itensPncp : [];
  const cards = [
    ["Modalidade", edital?.modalidade || identificacao.modalidade],
    ["Publicado em", formatarDataHoraBR(edital?.publicacao)],
    ["Prazo final de propostas", formatarDataHoraBR(edital?.encerramento || sessao.data)],
    ["Valor estimado", detalhes.valorEstimado || edital?.valor],
  ].map(([rotulo, valor]) => [rotulo, valorResumo(valor)]).filter(([, valor]) => valor);
  const destaque = cards.length ? `<tr><td style="padding:0 0 18px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:separate;border-spacing:8px 0;margin:0 -8px;"><tr>${cards.map(([rotulo, valor]) => `<td style="padding:13px 14px;background:#eef3f9;border:1px solid #dce5f0;vertical-align:top;"><div style="color:#58708f;font-size:11px;font-weight:700;text-transform:uppercase;">${escapeHtml(rotulo)}</div><div style="margin-top:5px;color:#102d56;font-size:17px;font-weight:700;line-height:1.25;">${escapeHtml(valor)}</div></td>`).join("")}</tr></table></td></tr>` : "";
  const itens = itensPncp.slice(0, 30).map((item, indice) => {
    const descricao = valorResumo(item && item.descricao);
    if (!descricao) return "";
    const quantidade = [item.quantidade, item.unidade].filter((v) => v !== null && v !== undefined && v !== "").join(" ");
    return `<li style="margin:0 0 6px;"><strong>${indice + 1}.</strong> ${escapeHtml(descricao)}${quantidade ? ` <span style="color:#637085;">— ${escapeHtml(quantidade)}</span>` : ""}</li>`;
  }).filter(Boolean);
  const itensHtml = itens.length ? `<ol style="margin:0;padding:0 0 0 20px;color:#162d4c;font-size:13px;line-height:1.5;">${itens.join("")}</ol>${itensPncp.length > 30 ? `<p style="margin:10px 0 0;color:#637085;font-size:12px;">Mostrando 30 de ${itensPncp.length} itens. Consulte o edital oficial para a relação completa.</p>` : ""}` : "";
  const resumoGeral = valorResumo(resumo.resumoGeral);
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">${destaque}
    ${secaoResumo("Visão geral", resumoGeral ? `<p style="margin:0;color:#162d4c;font-size:14px;line-height:1.6;">${escapeHtml(resumoGeral)}</p>` : "")}
    ${secaoResumo("Identificação da licitação", tabelaResumo([["Número", identificacao.numero || edital?.numeroControlePNCP], ["UASG", uasg], ["Contratação", identificacao.contratacao], ["Modalidade", edital?.modalidade || identificacao.modalidade], ["Portal de realização", identificacao.portalRealizacao], ["Regulamentação", identificacao.regulamentacao || resumo.legislacao]]))}
    ${secaoResumo("Dados oficiais da publicação", tabelaResumo([["Publicado em", formatarDataHoraBR(edital?.publicacao)], ["Início do recebimento", formatarDataHoraBR(edital?.inicioRecebimento)], ["Prazo final de propostas", formatarDataHoraBR(edital?.encerramento)], ["Critério de julgamento", criterioJulgamento], ["Regime de execução", detalhes.regimeExecucao || edital?.regimeExecucao]]))}
    ${secaoResumo("Sessão pública", tabelaResumo([["Data", formatarDataHoraBR(sessao.data)], ["Horário", sessao.horario], ["Modo de disputa", edital?.modoDisputa || sessao.modoDisputa], ["Limite para propostas", formatarDataHoraBR(edital?.encerramento || resumo.prazos && resumo.prazos.limiteEnvioPropostas)]]))}
    ${secaoResumo("Órgão responsável", tabelaResumo([["Órgão", orgao.nome || edital?.orgao], ["E-mail", orgao.email], ["Telefone", orgao.telefone], ["Endereço", orgao.endereco || [edital?.municipio, edital?.uf].filter(Boolean).join("/")]]))}
    ${secaoResumo("Detalhes da licitação", tabelaResumo([["Critério de julgamento", criterioJulgamento], ["Tipo de análise", detalhes.tipoAnalise], ["Propostas/lances por", resumo.criteriosProposta && resumo.criteriosProposta.propostasLancesPor], ["Regime de execução", detalhes.regimeExecucao || edital?.regimeExecucao], ["Prazo de entrega", detalhes.prazoEntrega], ["Garantia", resumo.garantias && resumo.garantias.proposta], ["Condições de pagamento", resumo.condicoesPagamento], ["Penalidades", resumo.penalidades], ["Multas", resumo.multas]]))}
    ${secaoResumo("Documentos de habilitação", listaResumo(resumo.documentosHabilitacao))}
    ${secaoResumo("Declarações e formulários", listaResumo(resumo.declaracoesExigidas))}
    ${secaoResumo(`Itens da oportunidade (${itensPncp.length})`, itensHtml)}
    ${secaoResumo("Pendências para conferência", listaResumo(resumo.pendenciasParaConferencia))}
    ${secaoResumo("Perguntas sugeridas ao órgão", listaResumo(resumo.questionamentosSugeridos))}
  </table>`;
}

function resposta(event, statusCode, body) {
  return { statusCode, headers: cabecalhosPadrao(event), body: JSON.stringify(body) };
}

function montarHtml(texto, linkEdital, resumoEstruturado, edital) {
  const conteudo = escapeHtml(texto).replace(/\r?\n/g, "<br>");
  const conteudoEstruturado = montarConteudoEstruturado(resumoEstruturado, edital);
  const chamadaEdital = linkPncpValido(linkEdital)
    ? `<div style="margin-top:24px;"><a href="${escapeHtml(linkEdital)}" style="display:inline-block;background:#1f75df;border-radius:7px;padding:12px 18px;color:#fff;text-decoration:none;font-weight:700;">Abrir licitação no PNCP</a><p style="margin:10px 0 0;color:#66778e;font-size:12px;">Use o portal oficial para consultar o edital, anexos e documentos do processo.</p></div>`
    : "";
  return `<!doctype html><html><head><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><style>
    @media (prefers-color-scheme: dark) { .lp-cabecalho { background:#082243 !important; background-image:linear-gradient(#082243,#082243) !important; } .lp-marca { color:#ffffff !important; -webkit-text-fill-color:#ffffff !important; } }
  </style></head><body style="margin:0;padding:0;background:#eef3f9;font-family:Arial,sans-serif;color:#162d4c;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#eef3f9" style="width:100%;background:#eef3f9;"><tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="960" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:960px;background:#ffffff;border:1px solid #dce5f0;">
        <tr><td class="lp-cabecalho" bgcolor="#082243" style="padding:20px 32px;background-color:#082243;background-image:linear-gradient(#082243,#082243);color:#ffffff;-webkit-text-fill-color:#ffffff;font-size:21px;font-weight:700;line-height:1.2;"><img src="${URL_LOGO}" alt="" width="38" height="38" style="display:inline-block;vertical-align:middle;width:38px;height:38px;object-fit:contain;margin-right:11px;border:0;"> <font class="lp-marca" color="#ffffff" style="vertical-align:middle;color:#ffffff !important;-webkit-text-fill-color:#ffffff !important;">LicitaPlena</font></td></tr>
        <tr><td style="padding:26px 24px;font-size:15px;line-height:1.6;color:#162d4c;">${conteudoEstruturado || conteudo}${chamadaEdital}</td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #dce5f0;color:#66778e;font-size:12px;line-height:1.5;">Resumo preparado no LicitaPlena com base em dados públicos. Confira sempre o edital oficial antes de decidir.</td></tr>
      </table>
    </td></tr></table></body></html>`;
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

  // Aceita o formato antigo (`destino`) e o novo (`destinos`). A separação por
  // vírgula ou ponto e vírgula permite colar uma lista vinda do cliente.
  const destinos = normalizarDestinatarios(dados.destinos || dados.destino);
  const nomeDestino = String(dados.nomeDestino || "").trim().slice(0, 100);
  const assunto = String(dados.assunto || "Oportunidade para análise").trim().slice(0, 180);
  const texto = String(dados.texto || "").trim().slice(0, 25000);
  const linkEdital = String(dados.linkEdital || "").trim().slice(0, 500);
  const resumoEstruturado = dados.resumoEstruturado && typeof dados.resumoEstruturado === "object" ? dados.resumoEstruturado : null;
  const edital = dados.edital && typeof dados.edital === "object" ? dados.edital : null;
  if (!destinos.length) return resposta(event, 400, { erro: "Informe ao menos um e-mail de destino." });
  if (destinos.length > MAX_DESTINATARIOS_POR_ENVIO) {
    return resposta(event, 400, { erro: `Envie no máximo ${MAX_DESTINATARIOS_POR_ENVIO} destinatários por vez.` });
  }
  if (destinos.some((destino) => !emailValido(destino))) {
    return resposta(event, 400, { erro: "Há um e-mail de destino inválido. Separe os endereços por vírgula ou ponto e vírgula." });
  }
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
    // Cada chamada recebe apenas um destinatário, para que e-mails de clientes
    // nunca apareçam uns para os outros no cabeçalho da mensagem.
    for (const destino of destinos) {
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
          htmlbody: montarHtml(texto, linkEdital, resumoEstruturado, edital),
          textbody: texto,
        }),
      });
      if (!api.ok) {
        const corpo = await api.text();
        const erro = mensagemErroZepto(api.status, corpo);
        console.error("ZeptoMail recusou o envio:", api.status, erro);
        return resposta(event, 502, { erro: destinos.length > 1 ? `O envio parou depois de algumas mensagens. ${erro}` : erro });
      }
    }
    return resposta(event, 200, { ok: true, quantidade: destinos.length, mensagem: "E-mail enviado com sucesso." });
  } catch (e) {
    console.error("Falha ao enviar resumo por e-mail:", e.message);
    return resposta(event, 502, { erro: "Não foi possível enviar o e-mail agora. Tente novamente em instantes." });
  }
};

exports.__test = { emailValido, normalizarDestinatarios, linkPncpValido, montarHtml, montarConteudoEstruturado, mensagemErroZepto, normalizarTokenZepto, formatarDataHoraBR };
