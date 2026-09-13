const test = require("node:test");
const assert = require("node:assert/strict");
const { validarResumoRequisito, validarCamposResumidos, dividirCatalogo, orcamentoCatalogo, sintetizarLoteCatalogo, atualizarValidacaoCatalogo } = require("../lib/ia-edital").__test;
const { executarEtapa } = require("../_resumo_progressivo");

test("condensação dispensa referências legais e cláusulas, preservando prazo e condição operacional", () => {
  assert.equal(validarResumoRequisito("7.1. Conforme art. 69 da Lei 14.133/2021, apresentar balanço em 3 dias se solicitado [Edital, página 12].", "Apresentar balanço em 3 dias se solicitado."), true);
});

test("abreviações jurídicas e ano de referência não obrigam transcrição nem dispensam prazo operacional", () => {
  for (const referencia of ["Lei n. 5.764, de 1971, art. 107", "Lei n.º 5.764, de 1971, art. 107", "Lei nº 5.764, de 1971, art. 107", "Decreto-Lei n. 5.764, de 1971, art. 107"]) {
    const fonte = `Conforme ${referencia}, apresentar registro da cooperativa em 3 dias se solicitado.`;
    assert.equal(validarResumoRequisito(fonte, "Apresentar registro da cooperativa em 3 dias se solicitado."), true, referencia);
    assert.equal(validarResumoRequisito(fonte, "Apresentar registro da cooperativa se solicitado."), false, referencia);
  }
});

test("evidência de validação permanece no job privado e não aparece no progresso público", async () => {
  const originalFetch = global.fetch;
  const original = { id: "R0001", categoria: "documentosHabilitacao", texto: "Apresentar certidão fiscal em 30 dias se solicitado." };
  const valido = { id: "R0001", resumo: original.texto, campos: {}, categoriaHabilitacao: "Fiscal, social e trabalhista" };
  const casos = [
    { itens: [], guarda: "id_ausente_ou_duplicado" },
    { itens: [valido, valido], guarda: "id_ausente_ou_duplicado" },
    { itens: [{ ...valido, resumo: "Apresentar certidão fiscal em 10 dias se solicitado." }], guarda: "conteudo_numeros_condicoes_aplicabilidade" },
    { itens: [{ ...valido, campos: { desconhecido: "texto estranho" } }], guarda: "campos" },
    { itens: [{ ...valido, categoriaHabilitacao: "INVENTADA" }], guarda: "categoria_habilitacao" },
  ];
  try {
    for (const caso of casos) {
      global.fetch = async () => new globalThis.Response(JSON.stringify({ usage: { total_tokens: 123 }, choices: [{ message: { content: JSON.stringify({ requisitos: caso.itens }) } }] }), { status: 200 });
      const rejeicao = await sintetizarLoteCatalogo("teste-sem-custo", JSON.stringify([original]));
      const evidencia = JSON.parse(rejeicao.estrutura.validacaoCatalogoPrivada[0]);
      assert.equal(evidencia.parsing, "validacao_catalogo");
      assert.equal(evidencia.guarda, caso.guarda);
      assert.ok(rejeicao.estrutura.documentosHabilitacao[0].includes(original.texto));
      const store = memoria();
      const etapa = await executarEtapa({ store, chave: "job", inicial: { texto: "fonte" }, dividir: () => ["lote", "outro"], permitirDivisao: false, executar: async () => rejeicao });
      const salvo = (await store.getWithMetadata()).data;
      assert.deepEqual(salvo.resultados[0].validacaoCatalogoPrivada, rejeicao.estrutura.validacaoCatalogoPrivada);
      const publico = JSON.stringify(etapa.pendente);
      assert.doesNotMatch(publico, /certidão fiscal|candidato|numerosFaltantes|numerosNovos|validacao_catalogo|R0001|INVENTADA/);
      assert.equal(etapa.pendente.emProcessamento, true);
    }
  } finally { global.fetch = originalFetch; }
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

test("resposta ausente ou ID desconhecido preserva requisito oficial sem aproveitar conteúdo inventado", async () => {
  const originalFetch = global.fetch;
  const lote = [{ id: "R0001", categoria: "requisitosProposta", texto: "Apresentar proposta válida por 90 dias." }];
  try {
    for (const requisitos of [[], [{ id: "R0001" }], [{ id: "R9999", resumo: "Apresentar proposta válida por 90 dias.", campos: {} }]]) {
      global.fetch = async () => new globalThis.Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ requisitos }) } }] }), { status: 200 });
      const resultado = await sintetizarLoteCatalogo("chave-ficticia", JSON.stringify(lote));
      assert.deepEqual(resultado.estrutura.requisitosProposta, [`${lote[0].texto} [R0001]`]);
      assert.doesNotMatch(JSON.stringify(resultado.estrutura.requisitosProposta), /R9999/);
    }
  } finally { global.fetch = originalFetch; }
});

test("falha de aplicabilidade preserva apenas o item estrangeiro e mantém síntese válida do outro", async () => {
  const originalFetch = global.fetch;
  const fonte = "Para sociedade estrangeira, apresentar autorização de funcionamento no Brasil conforme IN 77/2020.";
  const lote = [{ id: "R0019", categoria: "documentosHabilitacao", texto: fonte }, { id: "R0020", categoria: "requisitosProposta", texto: "Apresentar proposta comercial com validade de 90 dias." }];
  try {
    const requisitos = [{ id: "R0019", resumo: "Apresentar autorização de funcionamento no Brasil.", campos: {}, categoriaHabilitacao: "Jurídica" }, { id: "R0020", resumo: "Enviar proposta válida por 90 dias.", campos: {} }];
    global.fetch = async () => new globalThis.Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ requisitos }) } }] }), { status: 200 });
    const { estrutura } = await sintetizarLoteCatalogo("teste", JSON.stringify(lote));
    assert.equal(estrutura.documentosHabilitacao[0], `${fonte} [R0019]`);
    assert.equal(estrutura.classificacoesHabilitacao.R0019, "Jurídica");
    assert.match(estrutura.requisitosProposta[0], /^Enviar proposta válida por 90 dias\./);
    assert.equal(validarResumoRequisito(fonte, "Para sociedade estrangeira, apresentar autorização de funcionamento no Brasil."), true);
  } finally { global.fetch = originalFetch; }
});

test("revisão CAS reabre validação uma única vez e preserva resultados, cotas e falhas HTTP", async () => {
  for (const parsing of ["validacao_catalogo", "erro_http"]) {
    const store = memoria();
    // Chaves e tipos reproduzem job-diagnostico-84ed547.json; conteúdo e usuário anonimizados.
    const realAnonimizado = require("./fixtures/job-validacao-anonimizado.json");
    const anterior = { ...realAnonimizado, diagnostico: { ...realAnonimizado.diagnostico, parsing, status: parsing === "erro_http" ? 429 : 200 } };
    await store.setJSON("job", anterior);
    await atualizarValidacaoCatalogo(store, "job");
    const primeira = await store.getWithMetadata();
    assert.equal(primeira.data.versaoValidacao, 2);
    assert.deepEqual(primeira.data.resultados, anterior.resultados);
    assert.deepEqual(primeira.data.usuariosComCota, anterior.usuariosComCota);
    assert.equal(primeira.data.falhas, parsing === "validacao_catalogo" ? 0 : 3);
    if (parsing === "validacao_catalogo") assert.equal(primeira.data.validacaoAnterior.texto, "evidência privada");
    else assert.deepEqual(primeira.data.diagnostico, anterior.diagnostico);
    await atualizarValidacaoCatalogo(store, "job");
    assert.deepEqual(await store.getWithMetadata(), primeira);
  }
});

test("migração de validação não libera reserva de job ainda ativo", async () => {
  const fixture = require("./fixtures/job-validacao-anonimizado.json");
  const store = memoria();
  const ativo = { ...fixture, falhas: 1, proximaEtapaEm: Date.now() + 65000 };
  await store.setJSON("job", ativo);
  await atualizarValidacaoCatalogo(store, "job");
  const migrado = (await store.getWithMetadata()).data;
  assert.equal(migrado.falhas, 1);
  assert.equal(migrado.proximaEtapaEm, ativo.proximaEtapaEm);
  assert.deepEqual(migrado.diagnostico, ativo.diagnostico);
  assert.deepEqual(migrado.usuariosComCota, ativo.usuariosComCota);
  assert.equal(migrado.validacaoAnterior, undefined);
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
