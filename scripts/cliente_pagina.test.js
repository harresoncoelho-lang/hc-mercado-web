// Portal do cliente (cliente.html/js/css): página pública com CSP própria, sem inline, sem HTML montado com dado
// e com o total do item calculado em BigInt (nunca float).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..");
const ler = (nome) => fs.readFileSync(path.join(RAIZ, nome), "utf8");
const cliente = require("../cliente.js");

test("cliente.html não tem <script> inline nem style=, e tem noindex e no-referrer", () => {
  const html = ler("cliente.html").replace(/<!--[\s\S]*?-->/g, "");
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length >= 1);
  for (const [, attrs, corpo] of scripts) {
    assert.match(attrs, /\bsrc=/, "todo <script> tem src");
    assert.equal(corpo.trim(), "", "nenhum <script> com conteúdo");
  }
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  assert.doesNotMatch(html, /<style\b/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, "nenhum handler inline");
  assert.doesNotMatch(html, /supabase/i);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
});

const CSP = "default-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

test("_headers tem o bloco /cliente* que desanexa os globais e aplica CSP estrita e no-store", () => {
  const bloco = ler("_headers").split(/\n(?=\S)/).find((b) => b.startsWith("/cliente*\n"));
  assert.ok(bloco, "bloco /cliente* existe");
  for (const linha of ["! Content-Security-Policy", "! Referrer-Policy", "! Cache-Control", `Content-Security-Policy: ${CSP}`, "Referrer-Policy: no-referrer", "Cache-Control: no-store", "X-Robots-Tag: noindex"]) {
    assert.ok(bloco.includes(`\n  ${linha}`), linha);
  }
});

test("netlify.toml repete a mesma regra para /cliente*", () => {
  const toml = ler("netlify.toml");
  const bloco = toml.split("[[headers]]").find((b) => b.includes('for = "/cliente*"'));
  assert.ok(bloco, "bloco /cliente* existe");
  assert.ok(bloco.includes(`Content-Security-Policy = "${CSP}"`));
  assert.ok(bloco.includes('Referrer-Policy = "no-referrer"'));
  assert.ok(bloco.includes('Cache-Control = "no-store"'));
  assert.ok(bloco.includes('X-Robots-Tag = "noindex"'));
});

test("cliente.js não monta HTML: nada de innerHTML, outerHTML, insertAdjacentHTML nem document.write", () => {
  const js = ler("cliente.js");
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  assert.doesNotMatch(js, /\.style\b|setAttribute\(\s*['"]style/, "nada de style inline (CSP sem unsafe-inline)");
});

test("o total do item usa BigInt e nunca float", () => {
  const js = ler("cliente.js");
  const corpo = js.slice(js.indexOf("function decimal("), js.indexOf("const milhar"));
  assert.match(corpo, /BigInt\(/);
  assert.doesNotMatch(corpo, /parseFloat|Number\(|Math\.round|toFixed|\* ?100\b/);
  const { totalCentavos, formatarCentavos, formatarValor } = cliente;
  assert.equal(totalCentavos(3, 0.1), 30n, "0,1 × 3 em float daria 0,30000000000000004");
  assert.equal(totalCentavos("1.005", "1"), 101n, "meio centavo arredonda para cima");
  assert.equal(totalCentavos("2.5", "51.2"), 12800n);
  assert.equal(totalCentavos("7", "123456789012.3456"), 86419752308642n);
  assert.equal(totalCentavos(10, "0.0001"), 0n);
  assert.equal(totalCentavos(null, 1), null);
  assert.equal(totalCentavos("abc", 1), null);
  assert.equal(totalCentavos(1, "1e3"), null);
  assert.equal(formatarCentavos(86419752308642n), "R$ 864.197.523.086,42");
  assert.equal(formatarCentavos(null), "—");
  assert.equal(formatarValor("51.2", true), "R$ 51,20");
  assert.equal(formatarValor("0.1234", true), "R$ 0,1234");
  assert.equal(formatarValor(1500, false), "1.500");
});

test("token só passa no formato de 43 caracteres base64url, e link só https", () => {
  const { tokenDoHash, linkSeguro } = cliente;
  const t = "A".repeat(42) + "b";
  assert.equal(tokenDoHash("#t=" + t), t);
  for (const h of ["", "#", "#t=", "#t=" + "A".repeat(42), "#t=" + "A".repeat(44), "#t=" + "A".repeat(42) + "=", "#x=" + t]) assert.equal(tokenDoHash(h), null, h);
  assert.equal(linkSeguro("https://pncp.gov.br/edital"), "https://pncp.gov.br/edital");
  for (const u of ["http://pncp.gov.br", "javascript:alert(1)", "data:text/html,x", "//x.com", null, 5]) assert.equal(linkSeguro(u), null, String(u));
});

test("mensagens por status e espera do Retry-After", () => {
  const { mensagemDeErro, segundosDeEspera, lotes } = cliente;
  assert.equal(mensagemDeErro(404).texto, "Este link não é mais válido. Peça um novo link a quem enviou.");
  assert.equal(mensagemDeErro(409).texto, "Alguns itens mudaram desde que você abriu. Confira de novo.");
  assert.equal(mensagemDeErro(429).texto, "Muitas tentativas. Aguarde um minuto.");
  assert.match(mensagemDeErro(503).texto, /^Indisponível no momento/);
  assert.equal(mensagemDeErro(0).tentar, true);
  assert.equal(segundosDeEspera("30"), 30);
  for (const v of [null, "", "abc", "0", "9999"]) assert.equal(segundosDeEspera(v), 60);
  assert.deepEqual(lotes([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.equal(lotes(Array.from({ length: 401 }, (_, k) => k), cliente.MAX_LOTE).length, 3);
});

test("cliente.* entra no publico/", () => {
  const { arquivosDaRaiz } = require("./montar_publico.js");
  const raiz = arquivosDaRaiz();
  for (const nome of ["cliente.html", "cliente.js", "cliente.css", "ds-tokens.css", "logo-icone.svg"]) assert.ok(raiz.includes(nome), nome);
});
