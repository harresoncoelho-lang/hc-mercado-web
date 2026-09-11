const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
const inicio = html.indexOf("  let bolResultadosCompletos = [];");
const fim = html.indexOf("  function filtrarResultadosDoBoletim(", inicio);
assert.ok(inicio >= 0 && fim > inicio, "Bloco do calendário deve existir no painel");
const codigoCalendario = html.slice(inicio, fim);
const codigoFormatarData = html.match(/ {2}function formatarDataIso\(s\) \{[\s\S]*?\n {2}\}/)[0];

function criarCalendario(resultados) {
  const elementos = new Map();
  const renderizacoes = [];
  const calendario = {
    set innerHTML(valor) {
      this.html = valor;
      elementos.clear();
      this.dias = [...valor.matchAll(/<(?:button|div)\b[^>]*class="([^"]*bol-cal-dia[^"]*)"[^>]*data-dia="([^"]+)"/g)]
        .map((match) => ({
          classe: match[1], dataset: { dia: match[2] },
          addEventListener(evento, callback) { this[evento] = callback; },
        }));
      for (const id of ["bol-cal-prev", "bol-cal-next", "bol-cal-limpar"]) {
        if (valor.includes(`id="${id}"`)) {
          elementos.set(id, { addEventListener(evento, callback) { this[evento] = callback; } });
        }
      }
    },
    querySelectorAll(seletor) {
      return seletor.includes(".tem-dados")
        ? this.dias.filter((dia) => dia.classe.includes("tem-dados")) : this.dias;
    },
  };
  const contexto = vm.createContext({
    window: {},
    document: { getElementById(id) { return id === "bol-calendario" ? calendario : elementos.get(id); } },
    renderizarPainelBoletim: (_alvo, lista, aviso) => renderizacoes.push({ lista, aviso }),
    resultados,
  });
  vm.runInContext(codigoFormatarData + codigoCalendario, contexto);
  vm.runInContext('bolMesReferencia = new Date(2026, 8, 1); renderizarBoletimComCalendario(resultados, "");', contexto);
  return { contexto, calendario, elementos, renderizacoes };
}

test("calendário abre dia sem dados e permite limpar o filtro", () => {
  const { calendario, elementos, renderizacoes } = criarCalendario([{ publicacao: "2026-09-10T12:00:00" }]);
  const dia11 = calendario.dias.find((dia) => dia.dataset.dia === "2026-09-11");
  assert.equal(typeof dia11.click, "function", "Dia 11 sem dados precisa responder ao clique");
  dia11.click();
  assert.equal(renderizacoes.at(-1).lista.length, 0);
  assert.match(renderizacoes.at(-1).aviso, /Nenhuma oportunidade publicada/);
  elementos.get("bol-cal-limpar").click();
  assert.equal(renderizacoes.at(-1).lista.length, 1);
});

test("calendário filtra dias com dados, desmarca e navega entre meses", () => {
  const { calendario, elementos, renderizacoes } = criarCalendario([
    { publicacao: "2026-09-11T12:00:00" }, { publicacao: "2026-09-10T12:00:00" },
  ]);
  calendario.dias.find((dia) => dia.dataset.dia === "2026-09-11").click();
  assert.equal(renderizacoes.at(-1).lista.length, 1);
  assert.equal(renderizacoes.at(-1).lista[0].publicacao, "2026-09-11T12:00:00");
  calendario.dias.find((dia) => dia.dataset.dia === "2026-09-11").click();
  assert.equal(renderizacoes.at(-1).lista.length, 2);
  elementos.get("bol-cal-next").click();
  assert.match(calendario.html, /Outubro de 2026/);
  elementos.get("bol-cal-prev").click();
  assert.match(calendario.html, /Setembro de 2026/);
});

test("datas sem horário mantêm o dia de publicação no fuso de Manaus", () => {
  const anterior = process.env.TZ;
  process.env.TZ = "America/Manaus";
  try {
    const { contexto, calendario } = criarCalendario([]);
    assert.equal(vm.runInContext('bolChaveDia("2026-09-11")', contexto), "2026-09-11");
    assert.equal(vm.runInContext('bolChaveDia("2026-09-11T02:00:00Z")', contexto), "2026-09-10");
    assert.equal(vm.runInContext('bolChaveDia("inválida")', contexto), null);
    assert.match(calendario.html, /data-dia="2026-09-11"[^>]*aria-label="11\/09\/2026:/);
    calendario.dias.find((dia) => dia.dataset.dia === "2026-09-11").click();
    assert.match(calendario.html, /Mostrando oportunidades de 11\/09\/2026/);
  } finally {
    if (anterior === undefined) delete process.env.TZ;
    else process.env.TZ = anterior;
  }
});

test("todos os dias reais são botões acessíveis, incluindo dias sem dados", () => {
  const { calendario } = criarCalendario([]);
  assert.equal([...calendario.html.matchAll(/<button\b[^>]*data-dia=/g)].length, 30);
  assert.match(calendario.html, /aria-pressed="false"/);
});
