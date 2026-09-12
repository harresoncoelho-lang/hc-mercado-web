const test = require("node:test");
const assert = require("node:assert/strict");
const { validarResumoRequisito, validarCamposResumidos, dividirCatalogo, orcamentoCatalogo, sintetizarLoteCatalogo } = require("../lib/ia-edital").__test;
const { executarEtapa } = require("../_resumo_progressivo");

test("condensação dispensa referências legais e cláusulas, preservando prazo e condição operacional", () => {
  assert.equal(validarResumoRequisito("7.1. Conforme art. 69 da Lei 14.133/2021, apresentar balanço em 3 dias se solicitado [Edital, página 12].", "Apresentar balanço em 3 dias se solicitado."), true);
});

test("síntese rejeita perda de alternativas, exceções e números operacionais", () => {
  for (const [fonte, resumo] of [
    ["Entregar em 30 dias após NE ou ordem de compra.", "Entregar em 30 dias após ordem de compra."],
    ["Capital mínimo de 10% se índice insuficiente.", "Capital mínimo de 10% para todos os licitantes."],
    ["Garantia de 12 meses, salvo prazo maior do fabricante.", "Garantia de 12 meses para todos os materiais."],
    ["Não subcontratar a execução em 30 dias.", "Subcontratar a execução dentro de 30 dias."],
    ["Atestados cobrindo 50% das quantidades.", "Atestados cobrindo 10% das quantidades."],
  ]) assert.equal(validarResumoRequisito(fonte, resumo), false, resumo);
});

test("orçamento conserva cada ID exatamente uma vez sem ultrapassar 7200 tokens", () => {
  const catalogo = Array.from({ length: 270 }, (_, i) => ({ id: `R${String(i + 1).padStart(4, "0")}`, categoria: "requisitosProposta", texto: "Apresentar proposta válida por 90 dias, com preços unitários e totais, indicando marca quando aplicável." }));
  const lotes = dividirCatalogo(catalogo).map(JSON.parse);
  assert.ok(lotes.length > 1);
  assert.deepEqual(lotes.flat(), catalogo);
  for (const lote of lotes) {
    const { entrada, saida } = orcamentoCatalogo(lote);
    assert.ok(entrada + saida <= 7200 && saida > 0);
  }
});

test("campos não aceitam destinos estranhos nem números inventados", () => {
  const original = { texto: "Entrega em 30 dias no almoxarifado.", destinos: ["entregaExecucao.prazo"] };
  assert.equal(validarCamposResumidos(original, { "entregaExecucao.prazo": "30 dias" }), true);
  assert.equal(validarCamposResumidos(original, { "entregaExecucao.prazo": "60 dias" }), false);
  assert.equal(validarCamposResumidos(original, { "__proto__.poluido": "30 dias" }), false);
  assert.equal(validarResumoRequisito("Capital mínimo de 10% do valor estimado.", "Capital mínimo de 100% do valor estimado."), false);
  assert.equal(validarCamposResumidos({ texto: "Não será permitida a subcontratação do objeto", destinos: ["analiseCritica.permiteSubcontratacao"] }, { "analiseCritica.permiteSubcontratacao": "Permitida a subcontratação" }), false);
});

test("resposta Groq deve cobrir IDs conhecidos com conteúdo útil", async () => {
  const originalFetch = global.fetch;
  const lote = [{ id: "R0001", categoria: "requisitosProposta", texto: "Apresentar proposta válida por 90 dias." }];
  try {
    for (const requisitos of [[], [{ id: "R0001" }], [{ id: "R9999", resumo: "Apresentar proposta válida por 90 dias.", campos: {} }]]) {
      global.fetch = async () => new globalThis.Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ requisitos }) } }] }), { status: 200 });
      assert.ok((await sintetizarLoteCatalogo("chave-ficticia", JSON.stringify(lote))).erro);
    }
  } finally { global.fetch = originalFetch; }
});

function memoria() {
  let estado, versao = 0;
  return {
    async getWithMetadata() { return estado ? { data: globalThis.structuredClone(estado), etag: String(versao) } : null; },
    async setJSON(_chave, valor, opcoes = {}) {
      if (opcoes.onlyIfMatch && opcoes.onlyIfMatch !== String(versao)) return { modified: false };
      estado = globalThis.structuredClone(valor); return { modified: true, etag: String(++versao) };
    },
  };
}

test("cota precede custo e é persistida uma vez por usuário e job", async () => {
  const eventos = [], store = memoria();
  const parametros = { store, chave: "job", inicial: { texto: "fonte" }, dividir: () => ["a", "b"], usuario: "u1", permitirDivisao: false,
    autorizar: async () => { eventos.push("cota"); return { ok: true }; }, executar: async () => { eventos.push("IA"); return { estrutura: {} }; } };
  const primeira = await executarEtapa(parametros);
  assert.deepEqual(eventos, ["cota", "IA"]);
  assert.deepEqual(primeira.estado.usuariosComCota, ["u1"]);
  await executarEtapa(parametros);
  assert.deepEqual(eventos, ["cota", "IA"]);
  await executarEtapa({ ...parametros, agora: Date.now() + 66000 });
  assert.deepEqual(eventos, ["cota", "IA", "IA"]);
});

test("cota negada não chama IA; três falhas encerram sem multiplicar lotes", async () => {
  let chamadas = 0;
  const base = { chave: "job", inicial: { texto: "fonte" }, dividir: () => ["a"], permitirDivisao: false, executar: async () => { chamadas++; return { erro: "Formato inválido", diagnostico: { status: 413 } }; } };
  const negado = await executarEtapa({ ...base, store: memoria(), usuario: "u1", autorizar: async () => ({ ok: false, status: 429, erro: "Cota esgotada" }) });
  assert.equal(negado.status, 429);
  assert.equal(chamadas, 0);
  const store = memoria();
  let resultado;
  for (let i = 0; i < 4; i++) resultado = await executarEtapa({ ...base, store, agora: Date.now() + i * 66000 });
  assert.equal(chamadas, 3);
  assert.equal(resultado.falhou, true);
  assert.equal(resultado.estado.blocos.length, 1);
});
