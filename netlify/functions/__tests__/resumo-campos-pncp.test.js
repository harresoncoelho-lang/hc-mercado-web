const test = require("node:test");
const assert = require("node:assert/strict");
const modelo = require("../../../resumo-modelo");

const secao = (resultado, titulo) => resultado.secoes.find((s) => s.titulo === titulo).campos;
const campo = (campos, rotulo) => (campos.find((c) => c.rotulo === rotulo) || {}).valor;

test("ficha mostra unidade, plataforma, links e informação complementar do PNCP", () => {
  const r = modelo.montar({}, {
    objeto: "Passagens", nomeUnidade: "DSEI Alto Rio Juruá", plataforma: "Compras.gov.br",
    linkSistemaOrigem: "https://cnetmobile.example/compra", processo: "25032.001045/2025-11",
    informacaoComplementar: "Grupo único com 10 itens",
  });
  const id = secao(r, "Identificação da Licitação");
  assert.equal(campo(id, "Unidade compradora"), "DSEI Alto Rio Juruá");
  assert.equal(campo(id, "Plataforma da disputa"), "Compras.gov.br");
  assert.equal(campo(id, "Link da disputa"), "https://cnetmobile.example/compra");
  assert.equal(campo(id, "Processo administrativo"), "25032.001045/2025-11");
  assert.equal(campo(secao(r, "Outras informações relevantes"), "Informação complementar do órgão (PNCP)"), "Grupo único com 10 itens");
});

test("benefício ME/EPP, margem e conteúdo nacional dos itens viram detalhes e pontos de atenção", () => {
  const itensPncp = [
    { numero: 1, descricao: "Cadeira", beneficio: "Participação exclusiva para ME/EPP", criterioJulgamento: "Menor preço", margemPreferencia: "Margem normal de 10%", exigenciaConteudoNacional: true },
    { numero: 2, descricao: "Mesa", beneficio: "Participação exclusiva para ME/EPP", criterioJulgamento: "Maior desconto" },
    { numero: 3, descricao: "Armário", beneficio: "Não se aplica", criterioJulgamento: "Menor preço" },
  ];
  const r = modelo.montar({ itensPncp }, {});
  const detalhes = secao(r, "Detalhes da Licitação");
  assert.equal(campo(detalhes, "Preferência ME/EPP"), "Participação exclusiva para ME/EPP em 2 de 3 itens");
  assert.equal(campo(detalhes, "Margem de preferência"), "Margem normal de 10% em 1 de 3 itens");
  assert.equal(campo(detalhes, "Conteúdo nacional"), "Exigida em 1 de 3 itens");
  assert.equal(campo(detalhes, "Critério por item"), "Menor preço em 2 de 3 itens; Maior desconto em 1 de 3 itens");
  const atencao = campo(secao(r, "Análise crítica"), "Pontos de atenção (dados oficiais do PNCP)");
  assert.deepEqual(atencao, [
    "Participação exclusiva para ME/EPP: 2 de 3 itens.",
    "Margem normal de 10% para produto nacional: 1 de 3 itens.",
    "Exigência de conteúdo nacional: 1 de 3 itens.",
  ]);
  const linhas = campo(secao(r, "Resumo dos Itens"), "Itens da oportunidade (3)");
  assert.equal(linhas[0], "1. Cadeira — Participação exclusiva para ME/EPP");
  assert.equal(linhas[2], "3. Armário");
});

test("leitura da IA tem prioridade sobre o resumo do PNCP no mesmo campo", () => {
  const r = modelo.montar({ detalhes: { preferenciaMeEpp: "Cota reservada de 25% [Edital, item 4.1]" }, itensPncp: [{ beneficio: "Cota reservada para ME/EPP" }] }, {});
  assert.equal(campo(secao(r, "Detalhes da Licitação"), "Preferência ME/EPP"), "Cota reservada de 25% [Edital, item 4.1]");
});

test("itens sem benefício informam a ausência e critério único preenche o geral", () => {
  const r = modelo.montar({ itensPncp: [{ beneficio: "Sem benefício", criterioJulgamento: "Menor preço" }, { beneficio: "Não se aplica", criterioJulgamento: "Menor preço" }] }, {});
  const detalhes = secao(r, "Detalhes da Licitação");
  assert.equal(campo(detalhes, "Preferência ME/EPP"), "Sem benefício para ME/EPP nos itens");
  assert.equal(campo(detalhes, "Critério de julgamento"), "Menor preço");
  assert.equal(campo(detalhes, "Critério por item"), undefined);
  assert.equal(campo(secao(r, "Análise crítica"), "Pontos de atenção (dados oficiais do PNCP)"), undefined);
});

test("orçamento sigiloso aparece como Sigiloso no lugar de valor zero e gera alerta", () => {
  const r = modelo.montar({}, { valor: 0, orcamentoSigiloso: "Compra totalmente sigilosa" });
  assert.equal(r.cards[0][1], "Sigiloso");
  assert.equal(campo(secao(r, "Detalhes da Licitação"), "Valor estimado"), "Sigiloso");
  assert.deepEqual(campo(secao(r, "Análise crítica"), "Pontos de atenção (dados oficiais do PNCP)"),
    ["Compra totalmente sigilosa: o valor estimado só é divulgado depois da disputa."]);
});

test("item sigiloso não mostra valor unitário e valor público continua formatado", () => {
  const r = modelo.montar({ itensPncp: [
    { numero: 1, descricao: "A", quantidade: 2, unidade: "UN", valorUnitarioEstimado: 10, orcamentoSigiloso: true },
    { numero: 2, descricao: "B", quantidade: 1, unidade: "UN", valorUnitarioEstimado: 471.14 },
  ] }, { valor: 852988.07 });
  const linhas = campo(secao(r, "Resumo dos Itens"), "Itens da oportunidade (2)");
  assert.equal(linhas[0], "1. A — 2 UN");
  assert.match(linhas[1], /^2\. B — 1 UN · R\$\s471,14 un\.$/);
  assert.match(r.cards[0][1], /852\.988,07/);
});

test("pregão presencial entra nos pontos de atenção com a justificativa", () => {
  const r = modelo.montar({}, { modalidadeNome: "Pregão - Presencial", justificativaPresencial: "Internet indisponível no município" });
  assert.deepEqual(campo(secao(r, "Análise crítica"), "Pontos de atenção (dados oficiais do PNCP)"),
    ["Disputa presencial: Internet indisponível no município."]);
});
