// Regressões da revisão de segurança de 19/11 (docs/qa/integracao-20261118/REVISAO-SEGURANCA-NOITE-20261119.md)
// que não têm módulo testável: script inline do painel, menu duplicado entre páginas e workflows.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..");
const ler = (f) => fs.readFileSync(path.join(RAIZ, f), "utf8");

test("B2: painel limpa CNPJ com \\D e conta letras sem \\d (não /D/ nem /d/)", () => {
  const p = ler("painel.html");
  assert.doesNotMatch(p, /\.replace\(\/D\/g/);
  assert.doesNotMatch(p, /\.replace\(\/d\/g/);
  assert.match(p, /String\(e\.cnpj\)\.replace\(\/\\D\/g, ""\)/);
  assert.match(p, /termo\.replace\(\/\\d\/g, ""\)\.trim\(\)\.length >= 3/);
});

test("menu: Prospecção logo depois de Inteligência de Mercado em todas as páginas com menu", () => {
  for (const f of ["painel.html", "sistema.html", "operacao.html", "processos.html", "prospeccao.html"]) {
    const p = ler(f);
    const im = p.indexOf('title="Inteligência de Mercado"');
    const pr = p.indexOf('<a href="prospeccao.html"');
    assert.ok(im > 0 && pr > im, `${f}: link de Prospecção ausente ou fora de ordem`);
    assert.doesNotMatch(p.slice(im, pr), /title="(?!Inteligência de Mercado)[^"]+"/, `${f}: outro item entre os dois`);
  }
});

test("B7: ações dos workflows novos fixadas por SHA", () => {
  for (const f of ["sancoes-cgu.yml", "prospeccao.yml"]) {
    const usos = [...ler(`.github/workflows/${f}`).matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    assert.ok(usos.length >= 2, f);
    for (const u of usos) assert.match(u, /@[0-9a-f]{40}$/, `${f}: ${u}`);
  }
});

test("B8: arquivo vazio com nome de código não volta para a raiz", () => {
  assert.equal(fs.readdirSync(RAIZ).some((n) => n.startsWith("console.log(")), false);
});

test("B9: teste do portal não varre o expira_em com o regex de vazamento", () => {
  const s = ler("supabase/testar_portal_cliente.sql");
  assert.match(s, /\(lido - 'expira_em'\)::text ~\*/);
  assert.match(s, /\\y8\\\.88\\y/);
  assert.doesNotMatch(s, /if lido::text ~\*/);
});
