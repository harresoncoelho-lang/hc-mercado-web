const test = require("node:test");
const assert = require("node:assert/strict");

process.env.MAX_TENTATIVAS_DOSSIE = "2";
const { ajustarAoSchema, schemaParaGemini, corpoGemini, chamarGemini, montarResultado, selecionarCandidatos, CotaEsgotada, VERSAO_DOSSIE } = require("./gerar_dossies_gemini");
const contrato = require("../netlify/functions/_resumo_gateway_contrato");
const { estruturaValida } = require("../netlify/functions/_resumo_gateway");

function respostaGemini(status, corpo) {
  return { status, ok: status >= 200 && status < 300, json: async () => corpo };
}

function saidaModelo(texto = "{}") {
  return respostaGemini(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: texto }] } }], usageMetadata: { totalTokenCount: 10 } });
}

test("ajuste ao schema descarta chaves extras, preenche ausentes e passa na validação do contrato", () => {
  const ajustado = ajustarAoSchema({ estrutura: { resumoGeral: "Pregão de papel.", campoInventado: "x", documentosHabilitacao: [{ categoria: "Inexistente" }] } }, contrato.schema);
  assert.equal(ajustado.estrutura.resumoGeral, "Pregão de papel.");
  assert.equal(ajustado.estrutura.campoInventado, undefined);
  assert.equal(ajustado.estrutura.identificacao.objeto, "Não informado");
  assert.deepEqual(ajustado.estrutura.declaracoesExigidas, []);
  assert.ok(contrato.schema.properties.estrutura.properties.documentosHabilitacao.items.properties.categoria.enum.includes(ajustado.estrutura.documentosHabilitacao[0].categoria));
  assert.ok(estruturaValida(ajustado));
});

test("schema enviado ao Gemini não leva marcações exclusivas da OpenAI", () => {
  assert.ok(!JSON.stringify(schemaParaGemini(contrato.schema)).includes("additionalProperties"));
  assert.ok(corpoGemini({}, "fonte").generationConfig.responseJsonSchema);
  assert.equal(corpoGemini({}, "fonte", false).generationConfig.responseJsonSchema, undefined);
});

test("cota esgotada interrompe sem consumir tentativa", async () => {
  await assert.rejects(chamarGemini({}, "fonte", { apiKey: "k", fetchFn: async () => respostaGemini(429, {}) }), CotaEsgotada);
});

test("modelo indisponível passa ao próximo e schema recusado repete só com JSON", async () => {
  const chamadas = [];
  const fetchFn = async (url, opcoes) => {
    chamadas.push({ url, comSchema: Boolean(JSON.parse(opcoes.body).generationConfig.responseJsonSchema) });
    if (chamadas.length === 1) return respostaGemini(404, {});
    if (chamadas.length === 2) return respostaGemini(400, { error: { message: "Invalid JSON schema" } });
    return saidaModelo('{"estrutura":{}}');
  };
  const resultado = await chamarGemini({}, "fonte", { apiKey: "k", fetchFn, modelos: ["a", "b"] });
  assert.equal(resultado.modelo, "b");
  assert.deepEqual(chamadas.map((c) => [c.url.includes("/b:"), c.comSchema]), [[false, true], [true, true], [true, false]]);
});

test("resposta cortada por limite de saída é falha, não dossiê", async () => {
  const fetchFn = async () => respostaGemini(200, { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{" }] } }] });
  await assert.rejects(chamarGemini({}, "fonte", { apiKey: "k", fetchFn, modelos: ["a"] }), /resposta_incompleta_MAX_TOKENS/);
});

test("data da fonte ausente no resumo vira pendência em vez de derrubar o dossiê", () => {
  const agora = Date.parse("2026-10-08T12:00:00Z");
  const resultado = montarResultado({ estrutura: { resumoGeral: "Resumo." } }, "Sessão em 20/10/2026 às 9h.", { documentosLidos: ["Edital.pdf"] }, agora);
  assert.equal(resultado.versao, VERSAO_DOSSIE);
  assert.equal(resultado.revisaoPrazos, true);
  assert.equal(resultado.metodoResumo, "sintese_gemini");
  assert.deepEqual(resultado.estrutura.documentosConsultados, ["Edital.pdf"]);
  assert.match(resultado.estrutura.pendenciasParaConferencia.at(-1), /20\/10\/2026/);
});

test("seleção põe cliques antes do boletim e pula pronto, repetido e esgotado", () => {
  const candidatos = selecionarCandidatos({
    fila: [{ numero_controle_pncp: "clique2", pedido_em: "2026-10-08T10:00:00Z" }, { numero_controle_pncp: "clique1", pedido_em: "2026-10-08T09:00:00Z" }],
    boletim: [
      { numero_controle_pncp: "velho", publicacao: "2026-10-01" },
      { numero_controle_pncp: "clique1", publicacao: "2026-10-07" },
      { numero_controle_pncp: "pronto", publicacao: "2026-10-08" },
      { numero_controle_pncp: "esgotado", publicacao: "2026-10-08" },
      { numero_controle_pncp: "novo", publicacao: "2026-10-07" },
    ],
    dossiesProntos: new Set(["pronto"]),
    tentativas: new Map([["esgotado", 2], ["novo", 1]]),
    limite: 10,
  });
  assert.deepEqual(candidatos.map((c) => `${c.origem}:${c.numero}`), ["clique:clique1", "clique:clique2", "boletim:novo", "boletim:velho"]);
});

test("seleção respeita o teto restante do dia", () => {
  const boletim = ["a", "b", "c"].map((numero) => ({ numero_controle_pncp: numero, publicacao: "2026-10-08" }));
  const base = { fila: [], boletim, dossiesProntos: new Set(), tentativas: new Map() };
  assert.equal(selecionarCandidatos({ ...base, limite: 2 }).length, 2);
  assert.equal(selecionarCandidatos({ ...base, limite: -5 }).length, 0);
});
