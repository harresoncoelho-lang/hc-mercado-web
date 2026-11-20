/* global module, require, URL */
// HTML do resumo de edital aprovado pelo dono: o mesmo usado no e-mail (enviar-resumo-edital.js)
// e na impressão/PDF do painel. Uma fonte só: qualquer mudança aqui aparece nos dois.
(function (raiz) {
  "use strict";
  const ResumoModelo = typeof module !== "undefined" && module.exports ? require("./resumo-modelo") : raiz.ResumoModelo;
  // Logo branca para a faixa institucional azul. PNG é usado em vez de SVG porque
  // clientes de e-mail, especialmente em iPhone, têm suporte inconsistente a SVG.
  const URL_LOGO = "https://licitaplena.com.br/logo.png?v=20260908";
  function escapeHtml(valor) {
    return String(valor || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function linkPncpValido(link) {
    try {
      const url = new URL(String(link || "").trim());
      return url.protocol === "https:" && (url.hostname === "pncp.gov.br" || url.hostname.endsWith(".pncp.gov.br"));
    } catch {
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

  // Alguns portais publicam descrições de item com tags do sistema de origem.
  // O e-mail é uma saída para cliente e nunca deve revelar esse HTML técnico.
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
    const modelo = ResumoModelo.montar(resumo, edital || {}, resumo.consideracoes);
    const cobertura = resumo.coberturaLeitura || {};
    const status = !resumo.fonteLida ? "O edital não foi lido; esta ficha não confirma os documentos exigidos."
      : resumo.modoDegradado ? resumo.aviso || "A síntese ainda não foi concluída. Confira os documentos oficiais."
      : cobertura.parcial !== false || cobertura.documentosNaoLidos?.length ? "Leitura parcial: confira as pendências e referências indicadas." : "Resumo elaborado a partir dos documentos analisados.";
    const secoes = modelo.secoes.map(secao => secaoResumo(secao.titulo, secao.campos.length ? secao.campos.map(campo => Array.isArray(campo.valor)
      ? `<p style="color:#637085;font-size:12px;">${escapeHtml(campo.rotulo)}</p>${listaResumo(campo.valor)}`
      : tabelaResumo([[campo.rotulo, campo.valor]])).join("") : "<p>Não informado</p>")).join("");
    const documentos = tabelaResumo([
      ["Documentos lidos", Array.isArray(cobertura.documentosLidos) ? cobertura.documentosLidos.map(textoResumo).filter(Boolean).join("; ") : ""],
      ["Documentos não lidos", Array.isArray(cobertura.documentosNaoLidos) ? cobertura.documentosNaoLidos.map(textoResumo).filter(Boolean).join("; ") : ""],
    ]);
    return `<table role="presentation" width="100%" style="border-collapse:collapse"><tr><td><h2>Resumo do Edital ${escapeHtml(modelo.numero)}</h2><p>${escapeHtml(modelo.objeto)}</p>${tabelaResumo(modelo.cards)}<p>${escapeHtml(status)}</p>${documentos}${listaResumo(cobertura.motivos)}</td></tr>${secoes}</table>`;
  }

// O template fica sem recuo extra: o HTML do e-mail precisa sair idêntico ao aprovado.
function montarHtml(texto, linkEdital, resumoEstruturado, edital, decisaoHtml = "", urlLogo = URL_LOGO) {
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
        <tr><td class="lp-cabecalho" bgcolor="#082243" style="padding:20px 32px;background-color:#082243;background-image:linear-gradient(#082243,#082243);color:#ffffff;-webkit-text-fill-color:#ffffff;font-size:21px;font-weight:700;line-height:1.2;"><img src="${escapeHtml(urlLogo)}" alt="" width="38" height="38" style="display:inline-block;vertical-align:middle;width:38px;height:38px;object-fit:contain;margin-right:11px;border:0;"> <font class="lp-marca" color="#ffffff" style="vertical-align:middle;color:#ffffff !important;-webkit-text-fill-color:#ffffff !important;">LicitaPlena</font></td></tr>
        <tr><td style="padding:26px 24px;font-size:15px;line-height:1.6;color:#162d4c;">${conteudoEstruturado || conteudo}${chamadaEdital}${decisaoHtml}</td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #dce5f0;color:#66778e;font-size:12px;line-height:1.5;">Resumo preparado no LicitaPlena com base em dados públicos. Confira sempre o edital oficial antes de decidir.</td></tr>
      </table>
    </td></tr></table></body></html>`;
}

  const api = { URL_LOGO, escapeHtml, linkPncpValido, formatarDataHoraBR, montarConteudoEstruturado, montarHtml };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.ResumoEmail = api;
})(globalThis);
