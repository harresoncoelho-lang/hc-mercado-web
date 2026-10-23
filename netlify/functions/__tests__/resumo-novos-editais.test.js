const test = require("node:test");
const assert = require("node:assert/strict");
const { montarResultado } = require("../../../scripts/gerar_dossies_gemini");
const { conferirEvidenciasDoResumo } = require("../_resumo_evidencias");
const modelo = require("../../../resumo-modelo");

// Fontes sintéticas, distintas do caso Jutaí; nenhuma chamada de IA ou de rede.
for (const modalidade of ["Dispensa eletrônica", "Pregão eletrônico", "Concorrência"]) {
  test(`${modalidade}: recupera omissões da síntese na fonte e exibe todos os temas operacionais`, () => {
    const fonte = `--- ${modalidade}.pdf ---
[Página 2]
3. HABILITAÇÃO
3.1. Apresentar comprovante de inscrição no CNPJ.
3.2. Caso o fornecedor seja pessoa jurídica, deverá apresentar o contrato social.
4. DECLARAÇÕES EXIGIDAS
4.1. Declarar que não emprega menores em trabalho proibido.
4.2. Para ME/EPP, apresentar declaração de enquadramento.
5. PAGAMENTO
5.1. O pagamento ocorrerá em até 15 dias úteis após o atesto da nota fiscal.
6. SANÇÕES ADMINISTRATIVAS
6.1. O atraso injustificado sujeita a contratada à multa de 0,2% por dia, limitada a 10%.
[Página 3]
ANEXO I - Termo de Referência
ANEXO II - Modelo de declaração de enquadramento`;
    const r = montarResultado({ estrutura: { identificacao: { modalidade }, resumoGeral: "Síntese simulada com omissões" } }, fonte,
      { parcial: false, documentosLidos: [`${modalidade}.pdf`], documentosNaoLidos: [] }, Date.parse("2026-10-22T12:00:00Z"));
    assert.match(JSON.stringify(r.estrutura.documentosHabilitacao), /inscrição no CNPJ/);
    assert.match(JSON.stringify(r.estrutura.documentosHabilitacao), /Caso o fornecedor seja pessoa jurídica/);
    assert.match(JSON.stringify(r.estrutura.declaracoesExigidas), /Para ME\/EPP/);
    assert.match(r.estrutura.anexosDeclaracoes, /ANEXO II/);
    assert.match(r.estrutura.penalidades, /0,2%.*10%/);
    assert.match(r.estrutura.condicoesPagamento, /15 dias úteis após o atesto/);
    const exibido = JSON.stringify(modelo.montar(r.estrutura));
    for (const trecho of ["inscrição no CNPJ", "não emprega menores", "ANEXO II", "0,2%", "15 dias úteis"]) assert.ok(exibido.includes(trecho), trecho);
    assert.deepEqual(conferirEvidenciasDoResumo(r), r);
  });
}

test("complementação não apaga fatos existentes nem importa sanções de outro tema", () => {
  const entrada = { textoEdital: `--- Aviso.pdf ---
[Página 1]
1. OBJETO
1.1. Aquisição de material para o setor de pagamentos.
2. HABILITAÇÃO
2.1. Certidão fiscal válida.`, estrutura: {
    documentosHabilitacao: [{ texto: "Balanço patrimonial conforme a fonte já conferida", categoria: "Econômica" }],
    condicoesPagamento: "20 dias após liquidação [TR.pdf, página 4]", penalidades: "Advertência [TR.pdf, página 5]",
    anexosDeclaracoes: "Anexo contratual [TR.pdf, página 6]",
  } };
  const r = conferirEvidenciasDoResumo(entrada);
  assert.deepEqual(r.estrutura.documentosHabilitacao[0], entrada.estrutura.documentosHabilitacao[0]);
  assert.equal(r.estrutura.condicoesPagamento, entrada.estrutura.condicoesPagamento);
  assert.equal(r.estrutura.penalidades, entrada.estrutura.penalidades);
  assert.equal(r.estrutura.anexosDeclaracoes, entrada.estrutura.anexosDeclaracoes);
  assert.equal(entrada.estrutura.documentosHabilitacao.length, 1);
});

test("requisito filho mantém caput condicional somente do mesmo documento", () => {
  const r = conferirEvidenciasDoResumo({ textoEdital: `--- Edital.pdf ---
[Página 5]
12. HABILITAÇÃO
12.1. Apenas a vencedora enquadrada como ME/EPP deverá apresentar os seguintes documentos:
12.1.1. Certidão de regularidade fiscal.
--- Outro.pdf ---
[Página 1]
12. HABILITAÇÃO
12.1. Caso seja pessoa física, apresentar documento de identidade.
12.1.1. CPF.`, estrutura: {} });
  const fiscal = r.estrutura.documentosHabilitacao.find((item) => item.includes("12.1.1. Certidão"));
  assert.match(fiscal, /Apenas a vencedora enquadrada como ME\/EPP/);
  assert.doesNotMatch(fiscal, /pessoa física/);
  assert.deepEqual(conferirEvidenciasDoResumo(r), r);
});

test("nova dispensa conserva complementos após persistência e leitura simuladas sem rede", async () => {
  const fixture = require("../../../docs/qa/novos-editais-fixture.json");
  const { salvarDossiePersistido, buscarDossiePersistido } = require("../_dossies_persistidos");
  const fetchAnterior = global.fetch;
  const chaveAnterior = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "somente-teste-sem-validade";
  let gravado;
  global.fetch = async (url, opcoes = {}) => {
    assert.ok(url.includes("/rest/v1/dossies_editais?"));
    if (opcoes.method === "POST") {
      gravado = JSON.parse(opcoes.body)[0];
      return new Response(null, { status: 201 });
    }
    return new Response(JSON.stringify([{ dossie: gravado.dossie, versao: gravado.versao }]));
  };
  try {
    await salvarDossiePersistido(fixture.edital.numeroControlePNCP, fixture.dossie);
    assert.equal(gravado.status, "pronto");
    const recuperado = await buscarDossiePersistido(fixture.edital.numeroControlePNCP);
    assert.deepEqual(recuperado, conferirEvidenciasDoResumo(fixture.dossie));
    assert.match(JSON.stringify(modelo.montar(recuperado.estrutura)), /ANEXO II/);
    assert.equal(recuperado.estrutura.questionamentosDocumentais.length, 1);
  } finally {
    global.fetch = fetchAnterior;
    if (chaveAnterior === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = chaveAnterior;
  }
});
