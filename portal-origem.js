/* global module, URL */
// Portal onde a disputa acontece (pedido do dono, 19/11): o PNCP traz em cada contratação
// "usuarioNome" (sistema que publicou) e "linkSistemaOrigem" (página do processo nesse sistema).
// Aqui o nome vira o rótulo amigável que o licitante conhece e o link só passa se for http(s).
// Sem DOM nem rede: painel.html, sistema.html (CRM) e a function busca-publica usam este arquivo.
// Variações levantadas numa amostra real de 1.350 contratações (_historico/portais-origem-pncp-20261119.md).
(function (raiz) {
  "use strict";
  const norm = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  // Ordem importa: o primeiro padrão que casar vence.
  const PORTAIS = [
    [/compras\.gov|comprasnet|comprasgov|siasg|cnetmobile/, "Compras.gov.br"],
    [/ecustomize|portal de compras publicas|portaldecompraspublicas/, "Portal de Compras Públicas"],
    [/licitanet/, "Licitanet"],
    [/\bbll\b/, "BLL"],
    [/bolsa nacional de compras|\bbnc\b/, "BNC"],
    [/bbmnet|\bbbm\b/, "BBMNET"],
    [/br ?conectado/, "BR Conectado"],
    [/licitacoes-e\b|licitacoes e bb|banco do brasil/, "Licitações-e (BB)"],
    [/licitar digital/, "Licitar Digital"],
    [/licita ?\+ ?brasil|licita mais brasil/, "Licita+Brasil"],
    [/licitacon/, "LicitaCon (TCE-RS)"],
  ];

  function nomePortal(bruto) {
    if (typeof bruto !== "string" || !bruto.trim()) return null;
    const n = norm(bruto);
    for (const [padrao, nome] of PORTAIS) if (padrao.test(n)) return nome;
    return bruto.replace(/\s+/g, " ").trim().slice(0, 80);
  }

  // Link vem do órgão (cadastro livre no PNCP) e vira href: só http(s) com host válido.
  function linkDisputa(url) {
    if (typeof url !== "string" || !url.trim() || url.length > 2000) return null;
    try {
      const u = new URL(url.trim());
      return (u.protocol === "https:" || u.protocol === "http:") && u.hostname ? u.href : null;
    } catch {
      return null;
    }
  }

  // Registro do robô/busca (usuarioNome) ou do detalhe (plataforma); sistema = coluna do CRM.
  function portalDe(r) {
    if (!r || typeof r !== "object") return { nome: null, link: null };
    return { nome: nomePortal(r.usuarioNome || r.plataforma || r.sistema), link: linkDisputa(r.linkSistemaOrigem) };
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // Selo + link prontos para os cartões; vazio quando o registro não tem nenhum dos dois.
  function htmlPortal(r) {
    const { nome, link } = portalDe(r);
    if (!nome && !link) return "";
    const selo = nome ? `<span class="portal-selo">Portal: ${esc(nome)}</span>` : "";
    const a = link ? `<a class="portal-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer" aria-label="Acessar local da disputa (abre em nova aba)">Acessar local da disputa</a>` : "";
    return `<div class="portal-origem">${selo}${a}</div>`;
  }

  const api = { nomePortal, linkDisputa, portalDe, htmlPortal };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.PortalOrigem = api;
})(globalThis);
