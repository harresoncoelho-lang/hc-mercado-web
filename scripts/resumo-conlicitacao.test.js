const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const AdmZip = require("adm-zip");
const modelo = require("../resumo-modelo");
const ResumoEmail = require("../resumo-email");

const SECOES = ["Identificação da Licitação", "Informações da Sessão Pública", "Órgão Responsável", "Detalhes da Licitação", "Seguro Garantia",
  "Informações sobre entrega e execução", "Prazos importantes", "Critérios da Proposta e Julgamento", "Resumo dos Itens", "Documentos de habilitação exigidos",
  "Atestado de capacidade técnica", "Legislação", "Anexos e declarações", "Outras informações relevantes", "Condições de pagamento", "Penalidades e multas",
  "Possíveis questionamentos", "Análise crítica", "Análise e Considerações do Licitante"];
const campo = (ficha, secao, rotulo) => ficha.secoes.find((s) => s.titulo === secao).campos.find((c) => c.rotulo === rotulo)?.valor;

test("ficha segue as 19 seções do ConLicitação na ordem, com CAPAG e cobertura só no fim", () => {
  const ficha = modelo.montarFicha({ coberturaLeitura: { parcial: true, documentosLidos: ["Edital.pdf"], documentosNaoLidos: ["ETP.pdf: download indisponível"] } }, {});
  assert.deepEqual(ficha.secoes.slice(0, 19).map((s) => s.titulo), SECOES);
  assert.deepEqual(ficha.secoes.slice(19).map((s) => s.titulo), ["CAPAG — situação fiscal do ente", "Cobertura da análise"]);
  assert.ok(ficha.secoes.slice(19).every((s) => s.apoio));
  // Garantias atuais preservadas: motivo do documento não lido continua visível e não há "confiança 100%".
  assert.match(JSON.stringify(campo(ficha, "Cobertura da análise", "Documentos não lidos")), /PNCP não entregou o arquivo; vale tentar ler de novo/);
  assert.doesNotMatch(JSON.stringify(ficha), /100\s?%/);
});

test("dossiê antigo sem os campos novos mostra Não informado sem quebrar", () => {
  const antigo = { identificacao: { objeto: "Papel A4" }, prazos: { prazoRecurso: "3 dias úteis" }, legislacao: "Lei 14.133/2021; LC 123/2006", penalidades: "Multa de 10%" };
  const ficha = modelo.montarFicha(antigo, {});
  for (const rotulo of ["Tipo de fornecimento", "Prazo para manifestação de recurso", "Prazo contratual ou ARP", "Esclarecimentos"]) assert.equal(campo(ficha, "Prazos importantes", rotulo), "Não informado");
  assert.equal(campo(ficha, "Prazos importantes", "Prazo para recursos e contrarrazões"), "3 dias úteis");
  assert.deepEqual(campo(ficha, "Legislação", "Base legal"), ["Lei 14.133/2021", "LC 123/2006"]);
  assert.deepEqual(campo(ficha, "Penalidades e multas", "Penalidades e multas"), ["Multa de 10%"]);
  for (const rotulo of ["Conflito objeto / minuta", "Permite subcontratação", "Estabelece condições de pagamento"]) assert.equal(campo(ficha, "Análise crítica", rotulo), "Não informado");
  assert.equal(campo(ficha, "Atestado de capacidade técnica", "Exigência"), "Não informado");
  assert.equal(modelo.montarFicha().secoes.length, 20, "estrutura vazia também monta");
});

test("campos novos do esquema aparecem nos lugares da referência", () => {
  const ficha = modelo.montarFicha({
    prazos: { tipoFornecimento: "Entrega parcelada", prazoManifestacaoRecurso: "10 minutos após o resultado", prazoContratualArp: "ARP de 12 meses", prazoRecurso: "3 dias úteis", prazoContrarrazoes: "3 dias úteis após o recurso" },
    sessaoPublica: { data: "2026-12-02", horario: "09:00", modoDisputa: "Aberto", intervaloMinimo: "R$ 0,50" },
    criteriosProposta: { programaIntegridade: "Exigido para contratos acima de R$ 200 milhões" },
  }, { numeroControlePNCP: "12345678000190-1-000021/2026", valor: 0, modalidade: "Pregão Eletrônico - SRP" }, "", new Date(2026, 10, 19));
  assert.equal(campo(ficha, "Prazos importantes", "Tipo de fornecimento"), "Entrega parcelada");
  assert.equal(campo(ficha, "Prazos importantes", "Prazo para recursos e contrarrazões"), "Recurso: 3 dias úteis\nContrarrazões: 3 dias úteis após o recurso");
  assert.equal(campo(ficha, "Informações da Sessão Pública", "Intervalo mínimo"), "R$ 0,50");
  const integridade = ficha.secoes.find((s) => s.id === "criterios").campos.find((c) => c.rotulo === "Programa de Integridade");
  assert.equal(integridade.acao, "integridade");
  assert.deepEqual({ data: ficha.cartoes.data, dias: ficha.cartoes.dias, modo: ficha.cartoes.modoDisputa }, { data: "02/12/2026", dias: "Em 13 dias", modo: "Aberto" });
  assert.equal(ficha.controlePncp, "12345678000190-1-000021/2026");
});

test("Seguro Garantia diz se exige ou não sem presumir quando o edital é omisso", () => {
  assert.equal(modelo.situacaoGarantia("Não é exigida garantia contratual. [TR, item 4.32]"), "Não exige");
  assert.equal(modelo.situacaoGarantia("Dispensada a garantia de proposta"), "Não exige");
  assert.equal(modelo.situacaoGarantia("Garantia de 5% do valor do contrato, art. 96"), "Exige");
  assert.equal(modelo.situacaoGarantia("Não informado"), "");
  const ficha = modelo.montarFicha({ garantias: { contrato: "Garantia de 5% do valor do contrato" } }, {});
  assert.deepEqual(ficha.secoes.find((s) => s.id === "garantias").campos.map((c) => c.rotulo),
    ["Garantia de Proposta", "Exige Garantia de Contrato", "Garantia Adicional", "Garantia de Retomada"]);
  assert.equal(modelo.diasAte("Não informado"), null);
  assert.equal(modelo.diasAte("18/11/2026", new Date(2026, 10, 19)), -1);
});

test("gaveta mantém a ordem principal e manda consultas longas recolhidas para o fim", () => {
  const visual = modelo.montarVisual({ itensPncp: [{ numeroItem: 1, descricao: "Papel" }], possiveisQuestionamentos: ["[Presença Irregular] Marca exigida — art. 41 — Edital item 5"] }, {});
  const titulos = visual.secoes.map((s) => s.titulo);
  assert.deepEqual(titulos.slice(0, 19), SECOES);
  assert.ok(titulos.indexOf("Consultar itens da oportunidade") > titulos.indexOf("Cobertura da análise") || titulos.indexOf("Consultar itens da oportunidade") > 19);
  assert.ok(visual.secoes.filter((s) => s.recolhida).every((s) => titulos.indexOf(s.titulo) >= 19));
  assert.deepEqual(campo(visual, "Possíveis questionamentos", "Possíveis questionamentos"), ["[Presença Irregular] Marca exigida — art. 41 — Edital item 5"]);
});

test("impressão/PDF do painel e e-mail vêm da mesma função, com as mesmas seções na mesma ordem", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8").replace(/\r\n/g, "\n");
  const inicio = html.indexOf("  function editalParaResumo(");
  const fim = html.indexOf("  async function baixarChecklistDocx(", inicio);
  const consideracoes = { value: "Participar com marca própria" };
  const contexto = vm.createContext({ ResumoEmail, Date, linkPncp: (id) => `https://pncp.gov.br/app/editais/${id}`, montarResumoParaCliente: () => "texto do resumo",
    escapeHtml: ResumoEmail.escapeHtml, document: { getElementById: (id) => (id === "modal-ia-consideracoes" ? consideracoes : null) } });
  vm.runInContext(html.slice(inicio, fim), contexto);
  const fixture = require("../netlify/functions/__tests__/fixtures/de81-revisado.json");
  const edital = { ...fixture.edital, numeroControlePNCP: "12345678000190-1-000081/2026", objeto: "Materiais de informática", orgao: "Comando da Marinha", extraNaoEnviado: "x" };
  const est = { ...fixture.estrutura, fonteLida: true, itensPncp: [{ numeroItem: 1, descricao: "Mouse" }] };
  const impresso = contexto.montarHtmlImpressaoResumo(edital, est);
  // Mesmo payload que o envio monta (resumoParaEnvio/editalParaResumo) e a função do servidor.
  const email = require("../netlify/functions/enviar-resumo-edital").__test.montarHtml("texto do resumo", `https://pncp.gov.br/app/editais/${edital.numeroControlePNCP}`,
    contexto.resumoParaEnvio(est), contexto.editalParaResumo(edital), null);
  const semExtrasDaImpressao = impresso.replace(/<title>[\s\S]*?<\/style><\/head>/, "</head>").replace(/<p class="lp-emitido">[^<]*<\/p>/, "").replace('src="logo.png?v=20260908"', `src="${ResumoEmail.URL_LOGO}"`);
  assert.equal(semExtrasDaImpressao, email);
  assert.match(impresso, /<p class="lp-emitido">Emitido em \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}<\/p>/);
  assert.doesNotMatch(impresso, /Deseja participar|responder-oportunidade/);
  const secoesEmail = [...email.matchAll(/font-size:15px;font-weight:700;">([^<]+)<\/div>/g)].map((m) => m[1]);
  assert.ok(secoesEmail.length > 15);
  assert.deepEqual([...impresso.matchAll(/font-size:15px;font-weight:700;">([^<]+)<\/div>/g)].map((m) => m[1]), secoesEmail);
  assert.match(impresso, /Participar com marca própria/);
});

test("checklist .docx sai na ordem de seções da gaveta", () => {
  const checklist = require("../netlify/functions/gerar-checklist").__test;
  const xml = new AdmZip(checklist.montarDocx({ numeroControlePNCP: "12345678000190-1-000081/2026" }, { fonteLida: true, documentosHabilitacao: ["Certidão fiscal"] })).readAsText("word/document.xml");
  const posicoes = SECOES.map((titulo) => xml.indexOf(`<w:t>${titulo.replace(/&/g, "&amp;")}</w:t>`));
  assert.ok(posicoes.every((p) => p > 0), JSON.stringify(posicoes));
  assert.deepEqual([...posicoes].sort((a, b) => a - b), posicoes);
});
