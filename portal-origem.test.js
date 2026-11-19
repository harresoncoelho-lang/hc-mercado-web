const test = require("node:test");
const assert = require("node:assert/strict");
const { nomePortal, linkDisputa, portalDe, htmlPortal } = require("./portal-origem.js");

test("nomePortal normaliza as variações vistas no PNCP", () => {
  const casos = {
    "Compras.gov.br": "Compras.gov.br", "comprasnet": "Compras.gov.br", "SIASG": "Compras.gov.br",
    "ECustomize Consultoria em Software S.A": "Portal de Compras Públicas", "Portal de Compras Públicas": "Portal de Compras Públicas",
    "Licitanet Licitações Eletrônicas LTDA": "Licitanet", "BLL Compras": "BLL", "Bolsa Nacional De Compras - BNC": "BNC",
    "Novo BBMNET Licitações": "BBMNET", "BR Conectado": "BR Conectado", "Licitações-E BB": "Licitações-e (BB)",
    "Licitar Digital - Plataforma de Licitações Online": "Licitar Digital", "Licita + Brasil": "Licita+Brasil",
    "LicitaCon - TCE-RS": "LicitaCon (TCE-RS)",
  };
  for (const [bruto, esperado] of Object.entries(casos)) assert.equal(nomePortal(bruto), esperado, bruto);
});

test("nomePortal devolve o nome como veio quando não conhece e nada quando vazio", () => {
  assert.equal(nomePortal("  IPM   Sistemas "), "IPM Sistemas");
  assert.equal(nomePortal("Contratosgov Sistemas"), "Contratosgov Sistemas"); // não é o Compras.gov
  for (const v of [undefined, null, "", "   ", 42]) assert.equal(nomePortal(v), null);
});

test("linkDisputa aceita só http(s)", () => {
  assert.equal(linkDisputa("https://bllcompras.com/Process/ProcessView?param1=x"), "https://bllcompras.com/Process/ProcessView?param1=x");
  assert.equal(linkDisputa(" http://www.licitacoari.com.br/ "), "http://www.licitacoari.com.br/");
  for (const v of ["javascript:alert(1)", "data:text/html,x", "www.semprotocolo.com.br", "", null, undefined, {}]) assert.equal(linkDisputa(v), null, String(v));
});

test("portalDe lê usuarioNome, plataforma (detalhe) ou sistema (CRM)", () => {
  assert.deepEqual(portalDe({ usuarioNome: "BLL Compras", linkSistemaOrigem: "https://bllcompras.com/x" }), { nome: "BLL", link: "https://bllcompras.com/x" });
  assert.deepEqual(portalDe({ plataforma: "Compras.gov.br" }), { nome: "Compras.gov.br", link: null });
  assert.deepEqual(portalDe({ sistema: "Licitanet" }), { nome: "Licitanet", link: null });
  assert.deepEqual(portalDe(null), { nome: null, link: null });
});

test("htmlPortal: vazio sem dados, escapa o nome e abre em nova aba", () => {
  assert.equal(htmlPortal({ objeto: "registro antigo" }), "");
  const html = htmlPortal({ usuarioNome: "<b>Portal X</b>", linkSistemaOrigem: "https://x.gov.br/?a=1&b=2" });
  assert.match(html, /Portal: &lt;b&gt;Portal X&lt;\/b&gt;/);
  assert.match(html, /href="https:\/\/x\.gov\.br\/\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /undefined|null/);
  assert.doesNotMatch(htmlPortal({ usuarioNome: "BNC", linkSistemaOrigem: "javascript:alert(1)" }), /href/);
});
