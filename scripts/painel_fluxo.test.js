const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

// Mesmo padrão dos outros testes do painel: extrai o trecho real do painel.html e roda
// isolado, sem navegador. Cobre as regras novas de prazo, filtro rápido e endereço (#seção).
const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
const inicioPrazo = html.indexOf("  function classePrazoKanban(");
const fimPrazo = html.indexOf('  document.querySelectorAll(".seletor-empresa-acompanhamento")', inicioPrazo);
assert.ok(inicioPrazo > 0 && fimPrazo > inicioPrazo, "bloco de prazos deve existir no painel");
const codigoPrazo = html.slice(inicioPrazo, fimPrazo);
const codigoHash = html.match(/ {2}function secaoDoHash\(hash, alvos\) \{[\s\S]*?\n {2}\}/)[0];
const codigoFiltro = html.match(/ {2}function aplicarFiltroRapidoBoletim\(container, modo\) \{[\s\S]*?\n {2}\}/)[0];

function carregar(extra = {}) {
  const contexto = vm.createContext({ idOportunidade: (r) => r.numeroControlePNCP, ...extra });
  vm.runInContext(codigoPrazo + codigoHash + codigoFiltro, contexto);
  return contexto;
}

// 18/11/2026 às 23:30 em Brasília.
const AGORA = Date.parse("2026-11-18T23:30:00-03:00");

test("vence em X dias conta dias civis de Brasília, não blocos de 24 horas", () => {
  const { diasParaPrazo, textoPrazo } = carregar();
  assert.equal(diasParaPrazo("2026-11-19T08:00:00", AGORA), 1, "amanhã cedo é 1 dia, mesmo faltando menos de 24h");
  assert.equal(textoPrazo("2026-11-19T08:00:00", AGORA), "Vence em 1 dia");
  assert.equal(textoPrazo("2026-11-18T23:59:00", AGORA), "Vence hoje");
  assert.equal(textoPrazo("2026-11-25T10:00:00", AGORA), "Vence em 7 dias");
  assert.equal(textoPrazo("2026-11-18T10:00:00", AGORA), "Encerrado");
  // Horário com fuso explícito: 02h45 UTC do dia 19 ainda é dia 18 (23h45) em Brasília.
  assert.equal(textoPrazo("2026-11-19T02:45:00Z", AGORA), "Vence hoje");
  // Só a data vale até o fim daquele dia.
  assert.equal(textoPrazo("2026-11-18", AGORA), "Vence hoje");
  assert.equal(textoPrazo("2026-11-17", AGORA), "Encerrado");
});

test("prazo ausente ou inválido não vira número", () => {
  const { diasParaPrazo, textoPrazo, classePrazoKanban } = carregar();
  for (const valor of [null, undefined, "", "sem data"]) {
    assert.equal(diasParaPrazo(valor, AGORA), null);
    assert.equal(textoPrazo(valor, AGORA), null);
    assert.equal(classePrazoKanban(valor, AGORA), null);
  }
});

test("o resultado não depende do fuso do computador", () => {
  const anterior = process.env.TZ;
  process.env.TZ = "America/Manaus";
  try {
    const { textoPrazo } = carregar();
    assert.equal(textoPrazo("2026-11-19T08:00:00", AGORA), "Vence em 1 dia");
    assert.equal(textoPrazo("2026-11-18T23:59:00", AGORA), "Vence hoje");
  } finally {
    if (anterior === undefined) delete process.env.TZ;
    else process.env.TZ = anterior;
  }
});

test("classe de prazo e filtro de 3 dias usam a mesma contagem", () => {
  const { classePrazoKanban, venceEmAteDias } = carregar();
  assert.equal(classePrazoKanban("2026-11-21T10:00:00", AGORA), "perto");
  assert.equal(classePrazoKanban("2026-11-22T10:00:00", AGORA), "ok");
  assert.equal(classePrazoKanban("2026-11-18T10:00:00", AGORA), "vencido");
  assert.equal(venceEmAteDias("2026-11-21T10:00:00", 3, AGORA), true);
  assert.equal(venceEmAteDias("2026-11-18T23:59:00", 3, AGORA), true);
  assert.equal(venceEmAteDias("2026-11-22T10:00:00", 3, AGORA), false);
  assert.equal(venceEmAteDias("2026-11-18T10:00:00", 3, AGORA), false, "encerrado não entra em vence em 3 dias");
  assert.equal(venceEmAteDias(null, 3, AGORA), false);
});

test("boletim ordena por prazo: mais urgente primeiro, sem prazo depois, encerrados no fim", () => {
  const { ordenarPorPrazo } = carregar();
  const lista = [
    { id: "encerrado-antigo", encerramento: "2026-11-01T10:00:00" },
    { id: "sem-prazo-1", encerramento: null },
    { id: "cinco-dias", encerramento: "2026-11-23T10:00:00" },
    { id: "encerrado-recente", encerramento: "2026-11-18T09:00:00" },
    { id: "amanha", encerramento: "2026-11-19T09:00:00" },
    { id: "sem-prazo-2" },
  ];
  assert.deepEqual([...ordenarPorPrazo(lista, AGORA).map((r) => r.id)],
    ["amanha", "cinco-dias", "sem-prazo-1", "sem-prazo-2", "encerrado-recente", "encerrado-antigo"]);
  assert.equal(lista[0].id, "encerrado-antigo", "não altera a lista original");
  assert.equal(ordenarPorPrazo([], AGORA).length, 0);
});

test("o que vence esta semana junta Boletim e Funil sem repetir edital", () => {
  const { prazosDaSemana } = carregar();
  const boletim = [
    { numeroControlePNCP: "A", objeto: "Limpeza", encerramento: "2026-11-20T10:00:00" },
    { numeroControlePNCP: "B", objeto: "Papel", encerramento: "2026-12-10T10:00:00" },
    { numeroControlePNCP: "C", objeto: "Encerrado", encerramento: "2026-11-10T10:00:00" },
  ];
  const funil = {
    A: { objeto: "Limpeza", encerramento: "2026-11-20T10:00:00" },
    D: { objeto: "Veículos", encerramento: "2026-11-19T10:00:00" },
    E: { objeto: "Sem status", encerramento: "2026-11-19T10:00:00" },
  };
  const itens = prazosDaSemana(boletim, funil, { A: "interesse", D: "participando" }, AGORA);
  assert.deepEqual(JSON.parse(JSON.stringify(itens.map((i) => [i.id, i.origem]))), [["D", "funil"], ["A", "funil"]]);
  assert.equal(prazosDaSemana(null, null, null, AGORA).length, 0);
});

test("filtro rápido 'Vencem em 3 dias' esconde o que vence depois ou já encerrou", () => {
  const agora = Date.now();
  const iso = (dias) => new Date(agora + dias * 24 * 60 * 60 * 1000).toISOString();
  const cards = [
    { dataset: { id: "1", encerramento: iso(1) } },
    { dataset: { id: "2", encerramento: iso(10) } },
    { dataset: { id: "3", encerramento: iso(-1) } },
    { dataset: { id: "4", encerramento: "" } },
  ].map((c) => { c.oculto = false; c.classList = { toggle: (_classe, valor) => { c.oculto = valor; } }; return c; });
  const { aplicarFiltroRapidoBoletim } = carregar({ lerConjunto: () => new Set() });
  const container = { querySelectorAll: () => cards };
  aplicarFiltroRapidoBoletim(container, "vence-3");
  assert.deepEqual(cards.map((c) => c.oculto), [false, true, true, true]);
  aplicarFiltroRapidoBoletim(container, "todos");
  assert.deepEqual(cards.map((c) => c.oculto), [false, false, false, false]);
});

test("endereço #seção só abre seções que existem no menu", () => {
  const { secaoDoHash } = carregar();
  const alvos = ["dashboard", "boletim", "precos"];
  assert.equal(secaoDoHash("#precos", alvos), "precos");
  assert.equal(secaoDoHash("precos", alvos), "precos");
  assert.equal(secaoDoHash("#Precos", alvos), null);
  assert.equal(secaoDoHash("#nao-existe", alvos), null);
  assert.equal(secaoDoHash("", alvos), null);
  assert.equal(secaoDoHash(null, alvos), null);
  assert.equal(secaoDoHash("#%E0%A4%A", alvos), null, "hash malformado não quebra a página");
  assert.equal(secaoDoHash("#__proto__", alvos), null);
});

// Cartão acompanhado (Boletim, Encontrar Licitações e Funil) → processo no sistema.
const codigoLink = html.match(/ {2}function linkSistemaProcesso\(empresaId, processoId\) \{[\s\S]*?\n {2}\}/)[0];
const codigoLinkCard = html.match(/ {2}function atualizarLinkSistemaCard\(card, statusMapa, kanbanMapa\) \{[\s\S]*?\n {2}\}/)[0];

test("link 'Abrir no sistema' só sai com empresa e processo uuid", () => {
  const contexto = vm.createContext({});
  vm.runInContext(codigoLink, contexto);
  const E = "aaaaaaaa-0000-4000-8000-000000000001", P = "bbbbbbbb-0000-4000-8000-000000000002";
  assert.equal(contexto.linkSistemaProcesso(E, P), `/sistema?empresa=${E}&processo=${P}`);
  for (const [e, p] of [[E, null], [null, P], [E, "x&processo=y"], ["../painel", P], [E, 123], [E, ` ${P}`]]) {
    assert.equal(contexto.linkSistemaProcesso(e, p), null);
  }
});

test("cartão ganha o link só quando acompanhado pela empresa ativa com processo salvo; sem status o link sai", () => {
  const E = "aaaaaaaa-0000-4000-8000-000000000001", P = "bbbbbbbb-0000-4000-8000-000000000002";
  const criados = [];
  const contexto = vm.createContext({
    empresaOperacionalId: E, empresaAcompanhamentoPronta: true,
    document: { createElement: () => { const a = { removido: false, remove() { this.removido = true; } }; criados.push(a); return a; } },
  });
  vm.runInContext(codigoLink + codigoLinkCard, contexto);
  let link = null;
  const acoes = { append: (a) => { link = a; } };
  const card = { dataset: { id: "ed1" }, querySelector: (s) => (s === ".link-sistema" ? (link && !link.removido ? link : null) : acoes) };
  contexto.atualizarLinkSistemaCard(card, { ed1: "interesse" }, { ed1: { processoId: P } });
  assert.equal(link.href, `/sistema?empresa=${E}&processo=${P}`);
  assert.equal(link.textContent, "Abrir no sistema");
  contexto.atualizarLinkSistemaCard(card, {}, { ed1: { processoId: P } });
  assert.equal(link.removido, true, "tirou do acompanhamento, o link some");
  contexto.atualizarLinkSistemaCard(card, { ed1: "interesse" }, {});
  assert.equal(criados.length, 1, "sem processo salvo não cria link");
  contexto.empresaAcompanhamentoPronta = false;
  contexto.atualizarLinkSistemaCard(card, { ed1: "interesse" }, { ed1: { processoId: P } });
  assert.equal(criados.length, 1, "empresa ainda carregando não mostra link");
});
