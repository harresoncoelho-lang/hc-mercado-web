const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

// Mesmo padrão de frescor_boletim.test.js: extrai do painel.html só o trecho testado.
const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
function extrairFuncao(nome) {
  const inicio = html.search(new RegExp(`  (?:async )?function ${nome}\\(`));
  assert.ok(inicio >= 0, `Função ${nome} deve existir`);
  return html.slice(inicio, html.indexOf("\n  }", inicio) + 4);
}
function extrairConst(nome) {
  const m = html.match(new RegExp(`^  const ${nome} = [^;]*;`, "m"));
  assert.ok(m, `Constante ${nome} deve existir`);
  return m[0];
}

const AGORA = Date.parse("2026-09-18T12:00:00Z");
const haHoras = (h) => new Date(AGORA - h * 3600000).toISOString();

function criarContexto({ consulta } = {}) {
  const elementos = new Map();
  const erros = [];
  let idas = 0;
  const contexto = vm.createContext({
    window: { __sbClient: { from: (tabela) => ({ select: async (colunas) => { idas++; return consulta(tabela, colunas); } }) } },
    document: { getElementById(id) {
      if (!elementos.has(id)) elementos.set(id, { innerHTML: "" });
      return elementos.get(id);
    } },
    console: { error: (...args) => erros.push(args) },
    normalizarUfs: (ufs) => ufs,
    aguardarSupabaseAutenticado: async () => {},
    escapeHtml: (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"),
  });
  for (const c of ["FRESCOR_UF_FRESCA_ATE_H", "FRESCOR_UF_DEFASADA_APOS_H", "CACHE_COBERTURA_UF_TTL_MS"]) {
    vm.runInContext(extrairConst(c), contexto);
  }
  vm.runInContext("let promessaCoberturaUf = null; let coberturaUfEm = 0;", contexto);
  for (const f of ["frescorPorUf", "carregarCoberturaUf", "htmlSeloFrescorUf", "mostrarSeloFrescorUf"]) {
    vm.runInContext(extrairFuncao(f), contexto);
  }
  return { contexto, elementos, erros, idas: () => idas };
}

test("frescorPorUf classifica pelos limiares (6h e 24h inclusivos no nível de baixo)", () => {
  const { contexto } = criarContexto();
  const linhas = [
    { uf: "AM", atualizado_em: haHoras(5), completa: true },
    { uf: "RR", atualizado_em: haHoras(6), completa: true },
    { uf: "AC", atualizado_em: haHoras(6.01), completa: true },
    { uf: "AP", atualizado_em: haHoras(24), completa: true },
    { uf: "PA", atualizado_em: haHoras(24.01), completa: true },
  ];
  const r = contexto.frescorPorUf(linhas, AGORA, ["AM", "RR", "AC", "AP", "PA"]);
  assert.deepEqual(r.map((i) => i.nivel), ["fresca", "fresca", "atencao", "atencao", "defasada"]);
  assert.equal(Math.round(r[0].horas), 5);
});

test("frescorPorUf: nunca coletada (NULL ou data inválida) é defasada sem horas", () => {
  const { contexto } = criarContexto();
  const r = contexto.frescorPorUf([{ uf: "AM", atualizado_em: null, completa: true }, { uf: "RR", atualizado_em: "lixo" }], AGORA, ["AM", "RR"]);
  assert.deepEqual(r.map((i) => [i.nivel, i.horas, i.atualizadoEm]), [["defasada", null, null], ["defasada", null, null]]);
});

test("frescorPorUf: parcial só quando completa === false", () => {
  const { contexto } = criarContexto();
  const r = contexto.frescorPorUf([
    { uf: "AM", atualizado_em: haHoras(1), completa: false },
    { uf: "RR", atualizado_em: haHoras(1), completa: true },
    { uf: "AC", atualizado_em: haHoras(1), completa: null },
  ], AGORA, ["AM", "RR", "AC"]);
  assert.deepEqual(r.map((i) => i.parcial), [true, false, false]);
});

test("frescorPorUf: UF ausente na tabela é omitida, só devolve as pedidas e usa o relógio injetado", () => {
  const { contexto } = criarContexto();
  const linhas = [{ uf: "AM", atualizado_em: haHoras(2) }, { uf: "SP", atualizado_em: haHoras(2) }];
  assert.deepEqual(contexto.frescorPorUf(linhas, AGORA, ["AM", "RR"]).map((i) => i.uf), ["AM"]);
  assert.equal(contexto.frescorPorUf(linhas, AGORA + 30 * 3600000, ["AM"])[0].nivel, "defasada");
  assert.deepEqual(contexto.frescorPorUf(null, AGORA, ["AM"]), []);
  // Relógio do cliente atrasado em relação ao servidor: não vira horas negativas.
  assert.equal(contexto.frescorPorUf(linhas, AGORA - 3600000 * 5, ["AM"])[0].horas, 0);
});

test("htmlSeloFrescorUf mostra texto, título com data exata e aviso claro de defasada", () => {
  const { contexto } = criarContexto();
  const itens = contexto.frescorPorUf([
    { uf: "AM", atualizado_em: haHoras(5), completa: true },
    { uf: "RR", atualizado_em: haHoras(30), completa: false },
    { uf: "AC", atualizado_em: null, completa: true },
  ], AGORA, ["AM", "RR", "AC"]);
  const out = contexto.htmlSeloFrescorUf(itens, "Atualizar boletim");
  assert.match(out, /AM · coletada há 5h/);
  assert.match(out, /RR · coletada há 30h · cobertura parcial/);
  assert.match(out, /AC · nunca coletada/);
  assert.match(out, /selo-frescor-fresca/);
  assert.match(out, /title="AM · coletada há 5h \(dados recentes; última coleta em /);
  assert.match(out, /Dados de RR têm mais de 24h — podem faltar editais recentes\. Use "Atualizar boletim" para consultar o PNCP ao vivo\./);
  assert.match(out, /Dados de AC ainda não foram coletados/);
  assert.equal(contexto.htmlSeloFrescorUf([], "x"), "");
  // Só fresca: sem aviso.
  assert.doesNotMatch(contexto.htmlSeloFrescorUf(itens.slice(0, 1), "x"), /class="aviso/);
});

test("carregarCoberturaUf: 1 request memoizado entre chamadas e telas", async () => {
  const { contexto, idas } = criarContexto({ consulta: async () => ({ data: [{ uf: "AM", atualizado_em: haHoras(1) }], error: null }) });
  await Promise.all([contexto.carregarCoberturaUf(), contexto.carregarCoberturaUf()]);
  await contexto.carregarCoberturaUf();
  assert.equal(idas(), 1);
});

test("selo não quebra nada quando a consulta falha e a falha não fica memoizada", async () => {
  for (const consulta of [async () => ({ data: null, error: { message: "relation does not exist" } }), async () => { throw new Error("rede"); }]) {
    const { contexto, elementos, erros, idas } = criarContexto({ consulta });
    await contexto.mostrarSeloFrescorUf("bol-frescor", ["AM"], "Atualizar boletim");
    assert.equal(elementos.get("bol-frescor").innerHTML, "");
    assert.ok(erros.length > 0);
    await contexto.mostrarSeloFrescorUf("bol-frescor", ["AM"], "Atualizar boletim");
    assert.equal(idas(), 2);
  }
});

test("mostrarSeloFrescorUf renderiza no alvo e não consulta sem UFs", async () => {
  const { contexto, elementos, idas } = criarContexto({ consulta: async () => ({ data: [{ uf: "AM", atualizado_em: new Date(Date.now() - 3600000 * 1.5).toISOString(), completa: true }], error: null }) });
  await contexto.mostrarSeloFrescorUf("op-frescor", [], "Buscar oportunidades");
  assert.equal(idas(), 0);
  await contexto.mostrarSeloFrescorUf("op-frescor", ["AM"], "Buscar oportunidades");
  assert.match(elementos.get("op-frescor").innerHTML, /AM · coletada há 1h/); // relógio real aqui: 1,5h atrás
});
