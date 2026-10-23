const test = require("node:test");
const assert = require("node:assert/strict");
const t = require("../lib/ia-edital").__test;
const fonte = "--- Edital ---\n[Página 4]\n[EXIGÊNCIA R0022 requisitosProposta]\n5.6. As propostas que não correspondam  às descrições\ncontidas no ANEXO I serão desconsideradas.\n[EXIGÊNCIA R0023 requisitosProposta]\n5.7. Poderão ser admitidos erros formais pelo Pregoeiro, desde que não comprometam o interesse público.";
const mensagens = () => t.mensagensDaEtapa(t.INSTRUCOES_ETAPA, "", "", fonte);

test("transporte de requisitos pede só IDs exatos conhecidos, sem enum vazio", () => {
  const requisitos = t.schemaTransporteDaEtapa(mensagens()).properties.requisitos;
  assert.deepEqual(requisitos.items, { type: "string", enum: ["R0022", "R0023"] });
  assert.equal(requisitos.minItems, 2);
  assert.equal(requisitos.maxItems, 2);
  const vazio = t.schemaTransporteDaEtapa(t.mensagensDaEtapa(t.INSTRUCOES_ETAPA, "", "", "--- Edital ---\n[Página 1]\nAviso sem exigências.")).properties.requisitos;
  assert.equal(vazio.maxItems, 0);
  assert.equal(vazio.items.enum, undefined);
  assert.equal(t.SCHEMA_ETAPA.properties.requisitos.items.type, "object");
});

test("servidor exige cada ID uma vez e deriva texto e categoria exclusivamente da fonte", () => {
  const dados = t.traduzirEtapaTransportada({ requisitos: ["R0023", "R0022"], fatos: [] }, t.SCHEMA_ETAPA, fonte);
  assert.ok(dados);
  assert.equal(dados.requisitos[0].acao, "Conferir");
  assert.equal(dados.requisitos[0].categoria, "requisitosProposta");
  assert.match(dados.requisitos[0].documento, /5\.7\..*Pregoeiro.*desde que/);
  for (const requisitos of [[], ["R0022"], ["R0022", "R0022"], ["R0022", "R9999"], ["R0022", { id: "R0023" }], ["R0022", "R0023", "R0023"]]) assert.equal(t.traduzirEtapaTransportada({ requisitos, fatos: [] }, t.SCHEMA_ETAPA, fonte), null);
  assert.equal(t.traduzirEtapaTransportada({ requisitos: ["R0022"], fatos: [] }), null);
});

test("híbrido preserva cláusula5.6 com espaços múltiplos e condições sem recópia pela IA", async () => {
  const anterior = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"requisitos":["R0022","R0023"],"fatos":[]}' }, finish_reason: "stop" }] }) });
  try {
    const resultado = await t.chamarSinteseEdital("chave-teste", mensagens());
    assert.equal(resultado.ok, true);
    const est = JSON.parse(resultado.texto);
    assert.match(est.requisitosProposta.join("\n"), /5\.6\..*não correspondam.*ANEXO I.*desconsideradas/);
    assert.match(est.requisitosProposta.join("\n"), /5\.7\..*Pregoeiro.*desde que/);
    assert.doesNotMatch(JSON.stringify(est), /FIM DA FONTE OFICIAL/);
    const prompt = t.mensagensTransporteDaEtapa(mensagens());
    assert.doesNotMatch(JSON.stringify(prompt), /ação concreta no infinitivo|documento\/objeto, condições e prazo separados|Agrupe equivalentes/);
    assert.match(prompt.at(-1).content, /cada ID.*uma.*vez/);
  } finally { global.fetch = anterior; }
});

test("schema de IDs reduz orçamento do corpo completo e mantém limites existentes", () => {
  const { Tiktoken } = require("js-tiktoken/lite");
  const enc = new Tiktoken(require("js-tiktoken/ranks/o200k_base"));
  const msgs = mensagens();
  const schema = t.schemaTransporteDaEtapa(msgs);
  const anterior = { ...schema, properties: { ...schema.properties, requisitos: t.SCHEMA_ETAPA.properties.requisitos } };
  const corpoAnterior = t.montarCorpoGroq("openai/gpt-oss-120b", t.mensagensTransporteDaEtapa(msgs), { maxTokens: 2200, schema: anterior, reasoningEffort: "low" });
  const tokensAnteriores = 256 + enc.encode(JSON.stringify(corpoAnterior), [], []).length;
  assert.ok(t.tokensEntradaResumo(msgs) < tokensAnteriores);
  const orcamento = t.orcamentoResumo(msgs);
  assert.ok(orcamento.entrada + orcamento.saida <= 7200);
  assert.ok(t.cabeResumo(msgs, orcamento));
});
