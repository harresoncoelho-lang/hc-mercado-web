const test = require("node:test");
const assert = require("node:assert/strict");
const { conferirEvidenciasDoResumo } = require("../_resumo_evidencias");
const { montarResultado } = require("../../../scripts/gerar_dossies_gemini");
const modelo = require("../../../resumo-modelo");

const fonte = `--- Edital.pdf ---
[Página 3]
DATA E HORA FINAL DAS PROPOSTAS: 06/11/2026 ÀS 08:00h.
DATA DE ABERTURA DAS PROPOSTAS – SESSÃO PÚBLICA: 06/11/2026 ÀS 9:00h – Horário de Brasília.
1. DO OBJETO
1.1. O objeto é aquisição de móveis e eletrodomésticos.
[Página 14]
12. HABILITAÇÃO
12.1.21. Certidão Negativa de insolvência civil, caso se trate de pessoa física admitida ou de sociedade simples.
12.1.22. Certidão Negativa de falência, datada dos últimos 30 dias, ou dentro do prazo de validade expresso na própria Certidão.
--- Minuta.pdf ---
[Página 30]
7. PAGAMENTO
7.3.1. O pagamento será efetuado em até 30 dias contados do recebimento da Nota Fiscal/Fatura.
--- TR.pdf ---
[Página 13]
7. PAGAMENTO
7.8. A contratada deverá manter regularidade fiscal para o recebimento.
7.9. Recebida a Nota Fiscal, correrá o prazo de 10 dias úteis para liquidação, prorrogáveis por igual período.
[Página 14]
7.17. O pagamento será efetuado em até 10 dias úteis contados da finalização da liquidação da despesa.
[Página 16]
8. QUALIFICAÇÃO TÉCNICA
8.6.1. Apresentar comprovações de experiência no fornecimento de produtos do ramo alimentício.
8.6.2. Para os produtos perecíveis carnes e derivados apresentar licença sanitária.`;

test("corrige eventos distintos e preserva regras de pagamento por fonte e condições de certidão", () => {
  const r = conferirEvidenciasDoResumo({ textoEdital: fonte, estrutura: {
    identificacao: { objeto: "Aquisição de móveis e eletrodomésticos" },
    prazos: { limiteEnvioPropostas: "06/11/2026 às 09:00" },
    documentosHabilitacao: [{ categoria: "Econômico-financeira", texto: "Certidão Negativa de Insolvência Civil" }, { categoria: "Econômico-financeira", texto: "Certidão de falência nos últimos 30 dias" }],
    condicoesPagamento: "30 dias após NF",
  } });
  assert.match(r.estrutura.prazos.limiteEnvioPropostas, /08:00/);
  assert.match(r.estrutura.sessaoPublica.horario, /9:00/);
  assert.match(r.estrutura.documentosHabilitacao[0].texto, /pessoa física.*sociedade simples/);
  assert.match(r.estrutura.documentosHabilitacao[1].texto, /ou dentro do prazo/);
  assert.match(r.estrutura.condicoesPagamento, /10 dias úteis.*liquidação/);
  assert.match(r.estrutura.condicoesPagamento, /30 dias.*Nota Fiscal/);
  assert.match(r.estrutura.condicoesPagamento, /regularidade fiscal/);
  assert.ok(r.estrutura.questionamentosDocumentais.some((p) => p.tipo === "pagamento" && p.evidencias.length === 2));
  assert.ok(r.estrutura.questionamentosDocumentais.some((p) => p.tipo === "objeto" && p.evidencias.some((e) => e.documento === "TR.pdf")));
});

test("corte da síntese compatível não se confunde com extração completa, inclusive em dossiê antigo", () => {
  const r = montarResultado({ estrutura: { resumoGeral: "Resumo" } }, "x".repeat(263449),
    { parcial: false, documentosLidos: ["edital.zip"], documentosNaoLidos: [] }, Date.now(), { provedor: "cloudflare", modelo: "modelo-existente" });
  assert.equal(r.estrutura.coberturaSintese.parcial, true);
  assert.equal(r.estrutura.coberturaSintese.caracteresEnviados, 200000);
  assert.equal(r.estrutura.coberturaSintese.caracteresFonte, 263449);
  assert.equal(r.estrutura.coberturaLeitura.parcial, false);
  const antigo = conferirEvidenciasDoResumo({ ...r, estrutura: { resumoGeral: "Resumo" } });
  assert.equal(antigo.estrutura.coberturaSintese.parcial, true);
  const secao = modelo.montar(r.estrutura).secoes.find((s) => s.titulo === "Cobertura da análise");
  assert.match(JSON.stringify(secao), /200000|200.000/);
});

test("fonte integral no Gemini não herda corte da cadeia compatível e análise documental é idempotente", () => {
  const r = montarResultado({ estrutura: {} }, fonte, { parcial: false }, Date.now(), { provedor: "gemini" });
  assert.equal(r.estrutura.coberturaSintese.parcial, false);
  assert.deepEqual(conferirEvidenciasDoResumo(r), r);
});

test("interface separa extração parcial de envio integral à síntese", () => {
  const r = modelo.montar({ coberturaLeitura: { parcial: true, documentosLidos: ["Edital.pdf"], documentosNaoLidos: ["Anexo.pdf: HTTP 503"] }, coberturaSintese: { parcial: false, caracteresFonte: 100, caracteresEnviados: 100 } });
  const s = JSON.stringify(r.secoes.find((secao) => secao.titulo === "Cobertura da análise"));
  assert.match(s, /Extração parcial/);
  assert.match(s, /Anexo.pdf/);
  assert.doesNotMatch(s, /HTTP 503/);
});
