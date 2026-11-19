const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chaveTurnstile, ehErroDeCaptcha, montarTurnstile, alternarSenha, CHAVE_TESTE, MSG_CAPTCHA, SCRIPT_TURNSTILE } = require("./senha-captcha-ui.js");

test("chave de teste da Cloudflare só em localhost, 127.0.0.1 e [::1]; fora disso, a chave configurada", () => {
  assert.equal(CHAVE_TESTE, "1x00000000000000000000AA");
  for (const h of ["localhost", "127.0.0.1", "[::1]", "LOCALHOST"]) assert.equal(chaveTurnstile(h, "0xREAL"), CHAVE_TESTE);
  for (const h of ["licitaplena.com.br", "www.licitaplena.com.br", "localhost.evil.com", "", undefined]) assert.equal(chaveTurnstile(h, " 0xREAL "), "0xREAL");
  assert.equal(chaveTurnstile("licitaplena.com.br", ""), "");
  assert.equal(chaveTurnstile("licitaplena.com.br", undefined), "");
});

test("ehErroDeCaptcha reconhece só erro do captcha do Supabase", () => {
  assert.equal(ehErroDeCaptcha({ message: "captcha protection: request disallowed (invalid-input-response)" }), true);
  assert.equal(ehErroDeCaptcha({ message: "Invalid login credentials" }), false);
  assert.equal(ehErroDeCaptcha(null), false);
  assert.ok(!/não permitida/i.test(MSG_CAPTCHA));
});

// Página falsa: um .captcha-turnstile, um .captcha-aviso, um head que guarda o <script> injetado e um turnstile simulado.
function paginaFalsa(hostname) {
  const el = { hidden: false };
  const aviso = { hidden: true, textContent: "" };
  const scripts = [];
  const timers = [];
  const doc = {
    documentElement: { dataset: { theme: "dark" } },
    querySelector: (s) => ({ ".captcha-turnstile": el, ".captcha-aviso": aviso })[s] || null,
    createElement: () => ({}),
    head: { appendChild: (s) => scripts.push(s) },
  };
  const chamadas = { render: [], reset: [] };
  const win = {
    location: { hostname },
    setTimeout: (f) => timers.push(f),
    turnstile: {
      render: (alvo, opcoes) => { chamadas.render.push({ alvo, opcoes }); return "w1"; },
      reset: (id) => chamadas.reset.push(id),
    },
  };
  return { el, aviso, scripts, timers, doc, win, chamadas };
}

test("sem chave em produção: não carrega script, esconde o espaço e devolve token vazio", async () => {
  const p = paginaFalsa("licitaplena.com.br");
  const captcha = montarTurnstile(p.doc, p.win, "");
  assert.equal(captcha.ativo, false);
  assert.equal(p.scripts.length, 0);
  assert.equal(p.el.hidden, true);
  assert.equal(await captcha.obterToken(), "");
  captcha.resetar(); // não quebra sem widget
  assert.equal(p.chamadas.reset.length, 0);
});

test("com chave: injeta o api.js em render explícito, renderiza invisível e entrega o token", async () => {
  const p = paginaFalsa("licitaplena.com.br");
  const captcha = montarTurnstile(p.doc, p.win, "0xREAL");
  assert.equal(captcha.ativo, true);
  assert.equal(p.scripts[0].src, SCRIPT_TURNSTILE);
  assert.ok(SCRIPT_TURNSTILE.startsWith("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"));
  const pendente = captcha.obterToken();
  p.win.licitaplenaTurnstilePronto(); // onload do api.js
  const { alvo, opcoes } = p.chamadas.render[0];
  assert.equal(alvo, p.el);
  assert.equal(opcoes.sitekey, "0xREAL");
  assert.equal(opcoes.appearance, "interaction-only");
  assert.equal(opcoes.theme, "dark");
  opcoes.callback("tok-1");
  assert.equal(await pendente, "tok-1");
  assert.equal(await captcha.obterToken(), "tok-1");
  captcha.resetar();
  assert.deepEqual(p.chamadas.reset, ["w1"]);
  // depois do reset o token antigo (uso único) não é reaproveitado
  const proximo = captcha.obterToken();
  p.timers.at(-1)();
  assert.equal(await proximo, "");
});

test("localhost usa a chave de teste mesmo sem chave configurada", () => {
  const p = paginaFalsa("127.0.0.1");
  const captcha = montarTurnstile(p.doc, p.win, "");
  assert.equal(captcha.ativo, true);
  p.win.licitaplenaTurnstilePronto();
  assert.equal(p.chamadas.render[0].opcoes.sitekey, CHAVE_TESTE);
});

test("falha do widget ou do script mostra mensagem amigável e libera quem esperava o token", async () => {
  const p = paginaFalsa("licitaplena.com.br");
  const captcha = montarTurnstile(p.doc, p.win, "0xREAL");
  p.win.licitaplenaTurnstilePronto();
  const pendente = captcha.obterToken();
  p.chamadas.render[0].opcoes["error-callback"]("110200");
  assert.equal(await pendente, "");
  assert.equal(p.aviso.hidden, false);
  assert.equal(p.aviso.textContent, MSG_CAPTCHA);
  captcha.resetar();
  assert.equal(p.aviso.hidden, true);

  const q = paginaFalsa("licitaplena.com.br");
  montarTurnstile(q.doc, q.win, "0xREAL");
  q.scripts[0].onerror(); // api.js bloqueado
  assert.equal(q.aviso.textContent, MSG_CAPTCHA);
});

test("sem token a tempo, obterToken segue vazio (o Supabase decide se bloqueia)", async () => {
  const p = paginaFalsa("licitaplena.com.br");
  const captcha = montarTurnstile(p.doc, p.win, "0xREAL");
  const pendente = captcha.obterToken(10);
  p.timers[0]();
  assert.equal(await pendente, "");
});

test("olho alterna tipo do campo, aria-pressed, aria-label e ícone", () => {
  const campo = { type: "password" };
  const attrs = {}; const classes = new Set();
  const btn = {
    dataset: { alvo: "senha" }, title: "",
    setAttribute: (k, v) => { attrs[k] = v; },
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
  };
  const doc = { getElementById: (id) => (id === "senha" ? campo : null) };
  assert.equal(alternarSenha(btn, doc), true);
  assert.equal(campo.type, "text");
  assert.deepEqual(attrs, { "aria-pressed": "true", "aria-label": "Ocultar senha" });
  assert.ok(classes.has("senha-visivel"));
  alternarSenha(btn, doc);
  assert.equal(campo.type, "password");
  assert.deepEqual(attrs, { "aria-pressed": "false", "aria-label": "Mostrar senha" });
  assert.ok(!classes.has("senha-visivel"));
});

test("páginas de acesso usam o olho e o Turnstile, sem hCaptcha nem chave fixa no HTML", () => {
  for (const f of ["login", "cadastro", "convite", "admin"]) {
    const html = fs.readFileSync(`${__dirname}/${f}.html`, "utf8");
    assert.ok(html.includes("senha-captcha-ui.js"), f);
    assert.ok(html.includes("supabase-config.js"), f);
    assert.ok(html.includes('class="captcha-turnstile"'), f);
    assert.ok(html.includes("montarTurnstile(document, window)"), f);
    assert.ok(html.includes("captcha.obterToken()") && html.includes("captcha.resetar()"), f);
    assert.ok(!/hcaptcha|h-captcha|data-sitekey/i.test(html), f);
    assert.ok(!/>Mostrar senha</.test(html), f);
    assert.ok(/aria-label="Mostrar senha"/.test(html), f);
  }
  const csp = fs.readFileSync(`${__dirname}/_headers`, "utf8");
  assert.ok(!/hcaptcha/i.test(csp));
  assert.match(csp, /script-src [^;]*https:\/\/challenges\.cloudflare\.com/);
  assert.match(csp, /frame-src [^;]*https:\/\/challenges\.cloudflare\.com/);
  assert.match(fs.readFileSync(`${__dirname}/supabase-config.js`, "utf8"), /const TURNSTILE_SITEKEY = "/);
});
