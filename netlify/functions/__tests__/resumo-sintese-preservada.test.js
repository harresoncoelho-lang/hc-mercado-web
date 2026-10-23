const test = require("node:test");
const assert = require("node:assert/strict");
const { conferirEvidenciasDoResumo } = require("../_resumo_evidencias");
const fonte = "--- Edital ---\n[Página 1]\n1. OBJETO\n1.1. Aquisição de tubos de concreto.\n2. PAGAMENTO\n2.1. O pagamento será efetuado em até 30 dias após o adimplemento.\n3. SANÇÕES\n3.1. Aplicam-se as sanções previstas na legislação.\n";
const novo = () => ({ textoEdital: fonte, fonteLida: true, modoDegradado: false, estrutura: { resumoGeral: "Aquisição de tubos de concreto com pagamento em até 30 dias.", condicoesPagamento: "Até 30 dias após adimplemento [Edital, página 1, cláusula 2.1]", documentosHabilitacao: [], documentosCredenciamento: [], requisitosProposta: [], declaracoesExigidas: [], outrasInformacoesRelevantes: [], coberturaLeitura: { parcial: true, documentosLidos: ["Edital"], documentosNaoLidos: ["Anexo"] } } });
test("preserva síntese recebida antes da complementação e mantém evidências canônicas", () => {
 const r = conferirEvidenciasDoResumo(novo());
 assert.match(r.estrutura.estruturaSintetica.condicoesPagamento, /30 dias após o adimplemento/);
 assert.equal(r.estrutura.estruturaSintetica.outrasInformacoesRelevantes.length, 0);
 assert.match(r.estrutura.condicoesPagamento, /30 dias/);
 assert.match(r.estrutura.penalidades, /3\.1/);
 assert.equal(r.estrutura.estruturaSintetica.coberturaLeitura.parcial, true);
 assert.equal(r.estrutura.estruturaSintetica.hashFonte, r.estrutura.hashFonte);
});
test("reabertura preserva síntese sem expansão ou cópias recursivas", () => {
 const a = conferirEvidenciasDoResumo(novo()), b = conferirEvidenciasDoResumo(a);
 assert.deepEqual(b.estrutura.estruturaSintetica, a.estrutura.estruturaSintetica);
 assert.equal(b.estrutura.estruturaSintetica.estruturaSintetica, undefined);
});
test("síntese preservada também filtra exigência sem fonte e valor sem evidência", () => {
 const x=novo(); x.estrutura.estruturaSintetica={...x.estrutura, documentosHabilitacao:["Certidão de falência"], detalhes:{valorEstimado:"R$ 999,00 [Edital, página 1]"}};
 const r=conferirEvidenciasDoResumo(x);
 assert.deepEqual(r.estrutura.estruturaSintetica.documentosHabilitacao, []);
 assert.equal(r.estrutura.estruturaSintetica.detalhes.valorEstimado, "Não informado");
});
test("dossiê antigo separa transcrição identificável sem cortar condições nem inventar síntese", () => {
 const x=novo(); x.estrutura.outrasInformacoesRelevantes=["2.1. O pagamento será efetuado em até 30 dias após o adimplemento. [Edital, página 1, cláusula 2.1]", "Conferir o adimplemento e a documentação exigida antes do pagamento."];
 const r=conferirEvidenciasDoResumo(x);
 assert.deepEqual(r.estrutura.estruturaSintetica.outrasInformacoesRelevantes, [x.estrutura.outrasInformacoesRelevantes[1]]);
 assert.ok(r.estrutura.outrasInformacoesRelevantes.includes(x.estrutura.outrasInformacoesRelevantes[0]));
 assert.match(r.estrutura.estruturaSintetica.avisoSintese, /não foi regenerada/);
});
test("sem fonte não cria apresentação supostamente verificada", () => {
 const x=novo();delete x.textoEdital;
 assert.equal(conferirEvidenciasDoResumo(x).estrutura.estruturaSintetica, undefined);
});

test("apresentação não reexibe pagamento antecipado de 90 dias corrigido pela fonte", () => {
 const x=novo();x.estrutura.condicoesPagamento="Pagamento antecipado em 90 dias";
 const r=conferirEvidenciasDoResumo(x).estrutura.estruturaSintetica;
 assert.doesNotMatch(r.condicoesPagamento,/90|antecipad/i);
 assert.match(r.condicoesPagamento,/30 dias após o adimplemento/);
});
test("dispensa real de Belém conserva marco e prazo documental na apresentação", () => {
 const fs=require("node:fs"),path=require("node:path");
 const fonte=fs.readFileSync(path.join(__dirname,"../../../docs/qa/editais-reais-novos/08928517000157-116/fonte-produto.txt"),"utf8");
 const x=novo();x.textoEdital=fonte;x.estrutura.condicoesPagamento="Pagamento antecipado em 90 dias";
 const r=conferirEvidenciasDoResumo(x).estrutura.estruturaSintetica;
 assert.doesNotMatch(r.condicoesPagamento,/90|antecipad/i);
 assert.match(r.condicoesPagamento,/(?:30|trinta).*adimplemento/s);
});


test("pregão real 28/2026: 322 entradas voltam às três observações originais sem cortar evidências", () => {
 const fs=require("node:fs"),path=require("node:path");
 // Fonte pública: PNCP 00394452000103-1-022237/2026, arquivo 1, extraída sem IA.
 const fonte=fs.readFileSync(path.join(__dirname,"fixtures/ux28-fonte-publica.txt"),"utf8");
 const outras=require("./fixtures/ux28-outras-publicas.json");
 assert.equal(outras.length,322);
 const r=conferirEvidenciasDoResumo({textoEdital:fonte,estrutura:{outrasInformacoesRelevantes:outras}});
 assert.deepEqual(r.estrutura.estruturaSintetica.outrasInformacoesRelevantes,outras.slice(0,3));
 for(const texto of outras)assert.ok(r.estrutura.outrasInformacoesRelevantes.includes(texto));
 assert.equal(r.textoEdital,fonte);
});

test("questionamentos reais do pregão 28 recebem apenas cláusulas rastreáveis", () => {
 const fs=require("node:fs"),path=require("node:path");
 const fonte=fs.readFileSync(path.join(__dirname,"fixtures/ux28-fonte-publica.txt"),"utf8");
 const pontos=require("./fixtures/ux28-pontos-publicos.json");
 const r=conferirEvidenciasDoResumo({textoEdital:fonte,estrutura:{possiveisQuestionamentos:pontos}}).estrutura;
 assert.deepEqual(r.possiveisQuestionamentos,pontos);
 assert.deepEqual(r.evidenciasQuestionamentos[0].evidencias.map(e=>`${e.numero}:${e.escopoDocumento}`),["14.4:Edital","7.7:Termo de Referência"]);
 assert.equal(r.evidenciasQuestionamentos[0].motivo,undefined);
 assert.deepEqual(r.evidenciasQuestionamentos[1].evidencias.map(e=>`${e.numero}:${e.escopoDocumento}`),["3.6:Edital","4.4:Termo de Referência"]);
 assert.equal(r.evidenciasQuestionamentos[1].motivo,undefined);
 assert.deepEqual(r.evidenciasQuestionamentos[2].evidencias,[]);
 assert.match(r.evidenciasQuestionamentos[2].motivo,/nenhuma prova/);
 assert.ok(r.evidenciasQuestionamentos[3].evidencias.length>0);
});
test("cláusulas homônimas são vinculadas ao documento explícito, sem escolher por tema", () => {
 const f="--- Edital ---\n[Página 1]\n1. MULTAS\n1.1. A multa será de vinte por cento.\n--- TR ---\n[Página 2]\n1. ENTREGA\n1.1. A entrega será realizada em trinta dias.";
 const r=conferirEvidenciasDoResumo({textoEdital:f,estrutura:{questionamentosSugeridos:["Esclarecer a multa no item 1.1 do TR."]}}).estrutura.evidenciasQuestionamentos[0];
 assert.equal(r.evidencias.length,1);assert.equal(r.evidencias[0].documento,"TR");assert.match(r.evidencias[0].texto,/entrega/);assert.doesNotMatch(r.evidencias[0].texto,/multa/);
});

test("referência única fornece documento, página e texto sem interpretação adicional", () => {
 const f="--- Edital.pdf ---\n[Página 7]\n9. ENTREGA\n9.9. A entrega ocorrerá em trinta dias após a ordem de fornecimento.";
 const r=conferirEvidenciasDoResumo({textoEdital:f,estrutura:{questionamentosSugeridos:["Esclarecer o item 9.9."]}}).estrutura.evidenciasQuestionamentos[0];
 assert.deepEqual(r.evidencias,[{documento:"Edital.pdf",pagina:"7",numero:"9.9",texto:"9.9. A entrega ocorrerá em trinta dias após a ordem de fornecimento.",escopoDocumento:"Edital"}]);
 assert.equal(r.motivo,undefined);
});
