const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const t = require("../lib/ia-edital").__test;

test("transporte usa índices inteiros globais e conserva schemas canônicos", () => {
  const msgs = t.mensagensDaEtapa(t.INSTRUCOES_ETAPA, "", "", "Fonte");
  const schema = t.schemaTransporteDaEtapa(msgs);
  const p = schema.properties.fatos.items;
  const campos = t.SCHEMA_ETAPA.properties.fatos.items.properties.campo.enum;
  assert.equal(p.additionalProperties, false);
  assert.deepEqual(p.required, ["campoId", "valor", "referencia"]);
  assert.deepEqual(p.properties.campoId, { type: "integer", enum: campos.map((_, i) => i) });
  assert.equal(p.properties.campo, undefined);
  assert.deepEqual(t.SCHEMA_ETAPA.properties.fatos.items.required, ["campo", "valor", "referencia"]);
  const minuta = t.schemaTransporteDaEtapa(t.mensagensDaEtapa(t.INSTRUCOES_MINUTA, "", "", "Fonte"));
  assert.deepEqual(minuta.properties.fatos.items.properties.campoId.enum, [campos.indexOf("outrasInformacoesRelevantes")]);
});

test("transporte não aceita alias real, strings, floats, limites inválidos ou extras", () => {
  const campos = t.SCHEMA_ETAPA.properties.fatos.items.properties.campo.enum;
  const base = { requisitos: [], fatos: [{ campoId: 0, valor: "Texto literal", referencia: "Edital p.1" }] };
  for (const id of [0, campos.length - 1]) {
    const traduzida = t.traduzirEtapaTransportada({ ...base, fatos: [{ ...base.fatos[0], campoId: id }] });
    assert.equal(traduzida.fatos[0].campo, campos[id]);
    assert.equal(traduzida.fatos[0].campoId, undefined);
  }
  for (const id of [-1, campos.length, 0.5, "0", null, true]) assert.equal(t.traduzirEtapaTransportada({ ...base, fatos: [{ ...base.fatos[0], campoId: id }] }), null);
  for (const fato of [{ ...base.fatos[0], campo: "identificacao.objeto" }, { campo: "sessaoPublica.portalRealizacao", valor: "Banrisul", referencia: "Edital p.1" }, { ...base.fatos[0], extra: "x" }, { ...base.fatos[0], valor: 4 }]) assert.equal(t.traduzirEtapaTransportada({ ...base, fatos: [fato] }), null);
  assert.equal(t.traduzirEtapaTransportada({ ...base, extra: [] }), null);
  assert.equal(t.traduzirEtapaTransportada(base, t.SCHEMA_MINUTA), null);
  const erro = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../docs/qa/editais-reais-novos/88124961000159-125/reteste-integral-ocr/resultados-batch/etapa-01.json"), "utf8"));
  assert.equal(t.traduzirEtapaTransportada(JSON.parse(erro.respostaProvedor.erro.failed_generation)), null);
});

test("chamada transporta JSON numérico estrito com orçamento do corpo real e retorna estrutura canônica", async () => {
  const msgs = t.mensagensDaEtapa(t.INSTRUCOES_ETAPA, "Ficha sem prova", "", "--- Edital ---\n[Página 1]\n1.1. Aquisição de equipamentos quando solicitados.");
  const fetchAnterior = global.fetch;
  let body;
  global.fetch = async (_u, opts) => { body = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ requisitos: [], fatos: [{ campoId: 0, valor: "Aquisição de equipamentos quando solicitados", referencia: "Edital p.1, cláusula 1.1" }] }) }, finish_reason: "stop" }] }) }; };
  try {
    const r = await t.chamarSinteseEdital("chave-teste", msgs);
    assert.equal(r.ok, true);
    assert.match(JSON.parse(r.texto).identificacao.objeto, /quando solicitados.*Edital p.1/);
    assert.equal(body.model, "openai/gpt-oss-120b");
    assert.equal(body.response_format.json_schema.strict, true);
    assert.deepEqual(body.response_format.json_schema.schema, t.schemaTransporteDaEtapa(msgs));
    assert.deepEqual(body.messages, t.mensagensTransporteDaEtapa(msgs));
    assert.match(body.messages.at(-1).content, /campoId.*inteiro/);
    assert.doesNotMatch(JSON.stringify(body.messages), /Em fatos\.campo|campo é um caminho|Fatos: caminho permitido/);
    assert.equal(JSON.stringify(body.messages).match(/Mapa campoId:/g).length, 1);
    assert.ok(body.messages.at(-1).content.includes('"0":"identificacao.objeto"'));
    const { Tiktoken } = require("js-tiktoken/lite");
    const enc = new Tiktoken(require("js-tiktoken/ranks/o200k_base"));
    const entrada = 256 + enc.encode(JSON.stringify(body), [], []).length;
    assert.equal(t.tokensEntradaResumo(msgs, body.max_tokens), entrada);
    assert.ok(entrada + body.max_tokens <= 7200);
    assert.ok(Buffer.byteLength(JSON.stringify(body)) <= 48000);
    assert.doesNotMatch(r.texto, /campoId|FIM DA FONTE OFICIAL/);
  } finally { global.fetch = fetchAnterior; }
});

test("resposta de transporte não recupera wrappers JSON nem campo canônico enviado pelo modelo", async () => {
  const anterior = global.fetch;
  try {
    for (const texto of ['```json\n{"requisitos":[],"fatos":[]}\n```', '{"requisitos":[],"fatos":[{"campo":"identificacao.objeto","valor":"Texto literal","referencia":"Edital p.1"}]}']) {
      global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: texto }, finish_reason: "stop" }] }) });
      const r = await t.chamarSinteseEdital("chave-teste", [{ role: "user", content: "Fonte curta" }]);
      assert.equal(r.ok, false);
    }
  } finally { global.fetch = anterior; }
});

test("guarda final rejeita pagamento classificado como modalidade, número ou valor, mesmo com referência real", () => {
  const { conferirEvidenciasDoResumo } = require("../_resumo_evidencias");
  const campos = t.SCHEMA_ETAPA.properties.fatos.items.properties.campo.enum;
  const fonte = "--- TR.pdf ---\n[Página 1]\n1. O pagamento ocorrerá em dez dias após o recebimento.\n";
  const dados = t.traduzirEtapaTransportada({ requisitos: [], fatos: ["identificacao.modalidade", "identificacao.numero", "detalhes.valorEstimado"].map(campo => ({ campoId: campos.indexOf(campo), valor: "O pagamento ocorrerá em dez dias após o recebimento.", referencia: "TR.pdf, página 1, cláusula 1" })) });
  const estrutura = t.converterEtapaOperacional(dados, fonte);
  const r = conferirEvidenciasDoResumo({ textoEdital: fonte, estrutura, metadadosCanonicos: { numero: "125", modalidade: "Pregão - Eletrônico", valor: 300 } });
  assert.equal(r.estrutura.identificacao.modalidade, "Não informado");
  assert.equal(r.estrutura.identificacao.numero, "Não informado");
  assert.equal(r.estrutura.detalhes.valorEstimado, "Não informado");
  assert.deepEqual(r.metadadosCanonicos, { numero: "125", modalidade: "Pregão - Eletrônico", valor: 300 });
});

test("guarda final conserva modalidades e identificadores atômicos comprovados e ficha sem referência", () => {
  const { conferirEvidenciasDoResumo } = require("../_resumo_evidencias");
  for (const modalidade of ["Pregão - Eletrônico", "Concorrência - Eletrônica", "Dispensa de Licitação", "Credenciamento", "Inexigibilidade"]) {
    const fonte = `--- Edital ---\n[Página 1]\n${modalidade} Nº DV00041/2026. Valor R$ 57.382,60.\n`;
    const estrutura = { identificacao: { modalidade: `${modalidade} [Edital p.1]`, numero: "DV00041/2026 [Edital p.1]" }, detalhes: { valorEstimado: "R$ 57.382,60 [Edital p.1]" }, orgao: { nome: "MUNICIPIO CANÔNICO" } };
    const r = conferirEvidenciasDoResumo({ textoEdital: fonte, estrutura }).estrutura;
    assert.equal(r.identificacao.modalidade, estrutura.identificacao.modalidade);
    assert.equal(r.identificacao.numero, estrutura.identificacao.numero);
    assert.equal(r.detalhes.valorEstimado, estrutura.detalhes.valorEstimado);
    assert.equal(r.orgao.nome, "MUNICIPIO CANÔNICO");
  }
});
