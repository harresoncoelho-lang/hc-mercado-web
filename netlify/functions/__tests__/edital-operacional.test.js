const test = require("node:test");
const assert = require("node:assert/strict");
const { extrairRequisitosOperacionais, complementarRequisitos, selecionarContexto } = require("../_edital_operacional");

test("faixa de minuta termina no próximo anexo/documento e referência ambígua não autoriza fato", () => {
  const { paginasDaFonte, localizarReferencia, validarFatosDaFonte } = require("../_edital_operacional");
  const fonte = `--- Edital (#1) ---
[Página 1]
1. Amostra e visita técnica dispensadas.
[Página 2]
ANEXO I - MINUTA DE CONTRATO
1. O contrato prevê reajuste anual pelo IPCA.
[Página 3]
2. Os bens não terão cantos cortantes.
[Página 4]
ANEXO II - DECLARAÇÃO
Declaro conhecer o objeto.
--- Edital (#2) ---
[Página 1]
1. Apresentar amostra do produto.`;
  const paginas = paginasDaFonte(fonte);
  assert.deepEqual(paginas.map((x) => x.minuta), [false, true, true, false, false]);
  assert.equal(localizarReferencia("Edital p.1", paginas), null);
  assert.equal(localizarReferencia("Documento inexistente p.2", paginas), null);
  assert.equal(localizarReferencia("Edital (#2), página 1", paginas).documento, "Edital (#2)");
  const final = validarFatosDaFonte({ detalhes: { exigeAmostra: "Bens sem cantos cortantes [Edital (#1), página 3]", exigeVisitaTecnica: "Sem acidente [Edital (#1), página 1]", valorEstimado: "R$ ____ [Edital (#1), página 2]" }, analiseCritica: { previsaoReajuste: "Reajuste anual pelo IPCA [Edital (#1), página 2]" } }, fonte);
  assert.equal(final.detalhes.exigeAmostra, "Não informado");
  assert.equal(final.detalhes.exigeVisitaTecnica, "Não informado");
  assert.equal(final.detalhes.valorEstimado, "Não informado");
  assert.ok(final.outrasInformacoesRelevantes.some((x) => /Reajuste anual pelo IPCA/.test(x)));
});

test("PE406 separa esclarecimentos e entrega contratual de análise e entrega de fichas", () => {
  const { aplicarPrazosDaFonte, catalogarRequisitos } = require("../_edital_operacional");
  const fonte = `--- Edital (#2) ---
[Página 16]
11. DA PROPOSTA E ANÁLISE DAS FICHAS TÉCNICAS
11.2. A entrega de fichas técnicas ocorrerá até 28/09/2026, no CSC, Rua Belo Horizonte, 1420, das 8 às 14h.
11.2.4. A análise das fichas técnicas ocorrerá no dia 30/09/2026 às 10:30 horas de Brasília.
[Página 18]
11.2.21. A reabertura da sessão do pregão ocorrerá no dia 02/10/2026 ÀS 12:30 horas de Brasília (DF), para divulgar o resultado da análise das fichas técnicas.
[Página 22]
12. DOS ESCLARECIMENTOS
12.1. Qualquer pessoa poderá até 3 (três) dias úteis inteiros antes da data de abertura do certame por meio de arquivo único, impugnar os termos do edital ou solicitar esclarecimentos sobre os seus termos.
12.4. O CSC responderá os pedidos de esclarecimentos, limitado ao último dia útil anterior à data de abertura do certame.
--- Termo de Referência ---
[Página 8]
9. CRONOGRAMA DE CONTRATAÇÃO/ENTREGA:
PRAZO DA CONTRATAÇÃO: O prazo da contratação será de 30 (trinta) dias contados da data da assinatura do contrato.
PRAZO DE ENTREGA: A entrega do objeto será em até 30 (trinta) dias a contar da data da assinatura do contrato.
LOCAL DE ENTREGA: A entrega dos materiais dar-se-á na Av. Carlos Drummond de Andrade, nº 1460, Bairro Japiim – Bloco G – térreo Sala – 04 (GEMAP) entre 09:00h às 12:00h e de 14:00h as 16:00h.
23. QUALIFICAÇÃO TÉCNICA
23.1. Apresentar atestado que comprove a boa execução dos serviços em condições compatíveis de quantidades e prazos.`;
  const est = aplicarPrazosDaFonte({ prazos: { limiteEsclarecimentos: "30/09/2026 às 10:30" }, entregaExecucao: { local: "CSC" } }, fonte);
  assert.match(est.prazos.limiteEsclarecimentos, /3 \(três\) dias úteis inteiros antes.*\[Edital \(#2\), página 22\]/);
  assert.doesNotMatch(est.prazos.limiteEsclarecimentos, /30\/09|responderá/);
  assert.match(est.entregaExecucao.prazo, /30 \(trinta\) dias a contar da data da assinatura/);
  assert.match(est.entregaExecucao.local, /Carlos Drummond.*Sala – 04.*09:00h.*16:00h/);
  assert.doesNotMatch(JSON.stringify(est.entregaExecucao), /fichas|CSC|atestado/);
  const ref = catalogarRequisitos(fonte).find((x) => x.texto.includes("11.2.21."));
  const final = complementarRequisitos({ requisitosProposta: [`Divulgar resultado da análise das fichas técnicas no dia 02/10/2026 às 12:30 [${ref.id}]`] }, fonte);
  assert.ok(!final.requisitosProposta.some((x) => /^Divulgar resultado/.test(x)));
  assert.ok(final.requisitosProposta.some((x) => x.includes("11.2.21.")));
});

test("DE81 preserva marco da entrega e condições dos subitens sem inventar esclarecimentos", () => {
  const { aplicarPrazosDaFonte } = require("../_edital_operacional");
  const fonte = `--- TR788000_000092_2026.pdf ---
[Página 8]
6. MODELO DE EXECUÇÃO DO CONTRATO
6.4. O prazo de entrega dos bens é de 30 (trinta) dias, contados a partir da data de recebimento da Nota de
Empenho ou Ordem de Compra, em remessa única.
6.4.1 Caso não seja possível a entrega na data assinalada, a empresa deverá comunicar as razões respectivas
com pelo menos 10 (dez) dias de antecedência para que qualquer pleito de prorrogação de prazo seja
analisado, ressalvadas situações de caso fortuito e força maior.
6.4.2 Os bens deverão ser entregues no seguinte endereço:
Rua Bernardo Ramos, S/N - Centro, Manaus - AM, 69005-310 - Comando do 9° Distrito Naval
6.5. Não será necessária transferência de conhecimento.`;
  const est = aplicarPrazosDaFonte({ prazos: { limiteEsclarecimentos: "amanhã" } }, fonte);
  assert.equal(est.prazos.limiteEsclarecimentos, "Não informado");
  assert.match(est.entregaExecucao.prazo, /recebimento da Nota de Empenho ou Ordem de Compra, em remessa única/);
  assert.match(est.entregaExecucao.local, /Rua Bernardo Ramos/);
  assert.match(est.entregaExecucao.condicoes, /10 \(dez\) dias.*ressalvadas situações de caso fortuito e força maior/);
  assert.doesNotMatch(est.entregaExecucao.condicoes, /6\.5\./);
});

test("continuações de habilitação preservam regularização, alcance do CRC e percentual do TR", () => {
  const fonte = `--- Edital (#2) ---
[Página 7]
7. DA HABILITAÇÃO
7.1. b) as CADASTRADAS terão sua habilitação verificada pelo pregoeiro, em relação à
habilitação jurídica, à regularidade fiscal, social e trabalhista, devendo apresentar, quando
[Página 8]
convocadas, os documentos de habilitação econômica e técnica e o CRC.
[Página 9]
7.1.2.8. Em sendo o licitante detentor do menor preço qualificado como Microempresa(s)
e/ou Empresa(s) de Pequeno Porte este deverá apresentar a documentação exigida para
efeito de comprovação de regularidade social e se houver alguma restrição quanto à
regularidade fiscal e trabalhista, será obrigatória a sua regularização e apresentação das
referidas certidões para a assinatura contratual.
[Página 11]
7.1.4.1.1. O documento deverá certificar que o licitante já forneceu pelo menos 10% das quantidades e prazos descritos na proposta.
7.1.5.2. O Certificado de Registro Cadastral – CRC, emitido pelo CSC, que deverá ser
apresentado pelo licitante, substitui as seguintes documentações: habilitação jurídica,
regularidade fiscal, social e trabalhista, exceto a habilitação econômico-financeira e a
habilitação técnica. A aceitação do CRC ficará sujeita à confirmação de sua validade.
--- Termo de Referência (#3) ---
[Página 23]
23. DA QUALIFICAÇÃO TÉCNICA
23.2. Com a finalidade de tornar objetivo o julgamento da documentação de
qualificação técnica, considera(m)-se compatível(eis) o(s) documento(s) que
expressamente certifique(m) que o proponente já forneceu pelo menos 50% das
quantidades estimadas neste Termo de Referência.`;
  const final = complementarRequisitos({}, fonte);
  const itens = final.documentosHabilitacao.join("\n");
  assert.match(itens, /quando convocadas, os documentos/);
  assert.match(itens, /restrição quanto à regularidade fiscal e trabalhista.*assinatura contratual/);
  assert.match(itens, /habilitação jurídica, regularidade fiscal, social e trabalhista, exceto/);
  assert.match(itens, /10% das quantidades e prazos/);
  assert.match(itens, /50% das quantidades estimadas/);
  assert.match(final.pendenciasParaConferencia.join("\n"), /Possível divergência.*10%.*Edital.*50%.*Termo de Referência/);
});

test("registro legado conserva IDs por origem e não transfere IDs removidos ou ambíguos", () => {
  const { catalogarRequisitos } = require("../_edital_operacional");
  const fonte = `--- Documento A ---
[Página 1]
7. DA HABILITAÇÃO
7.1. Apresentar certidão com alcance de
regularidade fiscal e trabalhista, para assinatura
11.1. Apresentar comprovante sem categoria operacional.
--- Documento B ---
[Página 1]
7. DA HABILITAÇÃO
7.1. Apresentar certidão de falência.
7.2. Apresentar atestado de capacidade técnica.`;
  const catalogo = catalogarRequisitos(fonte);
  assert.equal(catalogo.find((x) => x.texto.includes("Documento A")).id, "R0001");
  assert.equal(catalogo.find((x) => x.texto.includes("falência")).id, "R0003");
  assert.equal(catalogo.find((x) => x.texto.includes("atestado")).id, "R0004");
  assert.ok(!catalogo.some((x) => x.id === "R0002"));
  const final = complementarRequisitos({ documentosHabilitacao: ["Apresentar documento inventado [R0002]"] }, fonte);
  assert.ok(!final.documentosHabilitacao.some((x) => x.includes("inventado")));
  const ambiguo = catalogarRequisitos(`--- Documento A ---\n[Página 1]\n7. HABILITAÇÃO\n7.1. Apresentar certidão fiscal.\n7.1. Apresentar certidão trabalhista.`);
  assert.deepEqual(ambiguo.map((x) => x.id), ["R0003", "R0004"]);
});

// Recortes do PE 406/2026 CSC/IDAM, com as cláusulas operacionais após a antiga
// janela de 22 mil caracteres. As referências legais ficam no meio das linhas.
const edital = `--- Edital PE 406/2026 ---
[Página 1]
1. DO OBJETO
1.1. Aquisição de materiais de expediente para atender ao IDAM.
${"Contexto administrativo anterior à documentação. ".repeat(510)}
[Página 3]
4. DO CREDENCIAMENTO
4.1. O Credenciamento é o nível básico do registro cadastral no Cadastro Central de Fornecedores-CCF/AM.
4.5.2. A documentação para cadastro provisório deve ser encaminhada até 2 dias úteis antes do certame.
[Página 5]
5. DO CADASTRAMENTO DA PROPOSTA NO SISTEMA E-COMPRAS.AM
5.4.1. Declaração de que atende aos requisitos de habilitação e os documentos são fiéis e verdadeiros.
5.4.2. Declaração de que cumpre as exigências de reserva de cargos para pessoa com deficiência.
5.4.3. Declaração de conhecimento do objeto da licitação e condições de habilitação.
5.4.4. Declaração de que os compromissos assumidos não comprometem a execução do objeto.
5.4.5. Declaração de que não utiliza empregados menores nas condições vedadas pelo art. 7º, XXXIII da Constituição.
5.4.6. Declaração de que não mantém vínculo impeditivo com dirigente do órgão ou agente público do CSC.
5.4.7. Declaração de integralidade dos custos para atendimento dos direitos trabalhistas.
5.4.8. Declaração de que não possui empregados em trabalho degradante ou forçado na cadeia produtiva.
5.4.9. Declaração de que inexistem fatos impeditivos para licitar ou contratar com a Administração Pública.
5.4.10. Declaração que desenvolvo o programa de integridade conforme orientações dos órgãos de controle.
5.4.11. Declaro que invisto em pesquisa e no desenvolvimento de tecnologia no País.
5.4.12. Declaro que pratico mitigação nos termos da Lei n.º 12.187/2009.
5.4.13. O fornecedor enquadrado como microempresa deverá declarar que cumpre os requisitos do artigo 3° da Lei Complementar nº 123, de 2006.
[Página 6]
5.4.14. Declaração de que os sócios não possuem decisão pelos crimes indicados, ficando a Certidão Negativa Criminal para o momento contratual.
[Página 7]
6. DA PROPOSTA DE PREÇOS REFORMULADA
6.5. Marca e modelo serão informados obrigatoriamente na proposta de preços encaminhada.
6.6. O prazo mínimo da validade da proposta será de 90 (noventa) dias.
[Página 8]
7. HABILITAÇÃO
7.1.1.1. Registro comercial em se tratando de empresário, conforme sua natureza jurídica.
7.1.1.2. Ato constitutivo, estatuto ou contrato social em vigor devidamente registrado.
7.1.1.3. Inscrição do ato constitutivo e prova da diretoria em exercício para sociedades simples.
7.1.1.4. Decreto de autorização para empresa estrangeira em funcionamento no país.
7.1.1.5. Os documentos indicados deverão estar acompanhados de todas as alterações ou consolidação.
7.1.2.1. Prova de inscrição no Cadastro Nacional de Pessoa Jurídica e Inscrição Estadual.
7.1.2.2. Prova de regularidade para com a Fazenda Federal e o INSS, através de certidão conjunta.
7.1.2.3. Prova de regularidade relativa ao Fundo de Garantia por Tempo de Serviço (FGTS).
7.1.2.4. Prova de regularidade para com a Fazenda Estadual e Municipal do domicílio da licitante.
7.1.2.5. Certidão Negativa de Débitos Trabalhistas emitida pelo Tribunal Superior do Trabalho.
[Página 9]
7.1.3.1. Cópia do Balanço Patrimonial e DRE dos 2 últimos exercícios sociais, na forma de ECD/SPED.
7.1.3.1.1. O MEI deverá apresentar Balanço Patrimonial e DRE com os índices Financeiros assinados.
7.1.3.1.2. A empresa em exceção à Instrução Normativa n° 2.003/2021-RFB deverá comprovar o arquivamento das demonstrações.
7.1.3.1.2.1. Índice de liquidez geral maior ou igual a 1,00 e capital mínimo ou patrimônio líquido igual ou superior a 10% do valor da proposta.
[Página 10]
7.1.3.1.3. Empresa constituída no exercício apresenta Balanço de Abertura e solvência geral maior ou igual a 1,00.
7.1.3.4. Certidões Negativas de Falência e Recuperação Judicial expedidas até 90 dias antes da sessão.
[Página 11]
7.1.4.1. Atestado de capacidade técnica por pessoa jurídica de direito público ou privado.
7.1.4.1.1. Comprovar que o licitante já forneceu pelo menos 10% das quantidades descritas na proposta.
7.1.5.2. O CRC substitui habilitação jurídica, fiscal, social e trabalhista, exceto econômico-financeira e técnica.
[Página 12]
8. SESSÃO DO PREGÃO
8.1. Os representantes deverão estar conectados ao sistema para participar da sessão de lances.
--- Termo de Referência PE 406/2026 ---
[Página 20]
20. DA HABILITAÇÃO JURÍDICA
20.6. Comprovante Bancário da empresa, para identificação de sua conta.
20.7. Documento de Identificação do Representante Legal da empresa: RG, CPF ou CNH.
20.8. Comprovante de Residência do Representante Legal da empresa dos últimos 3 meses.
[Página 21]
21. DA REGULARIDADE FISCAL, SOCIAL E TRABALHISTA
21.6. Prova de regularidade para com a CGU: certidão negativa correcional CEIS, em validade.
[Página 29]
32. DECLARAÇÃO DE NÃO PARENTESCO
A apresentação da declaração é regulamentada pela Nota Técnica nº 001/2024, modelo em anexo.
`;

test("preserva exigências dos dois documentos além do corte antigo e das listas limitadas", () => {
  assert.ok(edital.indexOf("7. HABILITAÇÃO") > 22000);
  const requisitos = extrairRequisitosOperacionais(edital);
  assert.ok(requisitos.documentosHabilitacao.length > 15);
  assert.ok(requisitos.declaracoesExigidas.length > 12);
  assert.match(requisitos.documentosHabilitacao.join("\n"), /Comprovante Bancário/);
  assert.match(requisitos.documentosHabilitacao.join("\n"), /correcional CEIS/);
  assert.match(requisitos.declaracoesExigidas.join("\n"), /DECLARAÇÃO DE NÃO PARENTESCO/);
  assert.match(requisitos.requisitosProposta.join("\n"), /90 \(noventa\) dias/);
});

test("mantém cláusula financeira completa e referência de documento e página", () => {
  const requisitos = extrairRequisitosOperacionais(edital);
  const liquidez = requisitos.documentosHabilitacao.find((item) => item.startsWith("7.1.3.1.2.1."));
  assert.match(liquidez, /1,00 e capital mínimo ou patrimônio líquido.*10%/);
  assert.match(liquidez, /\[Edital PE 406\/2026, página 9\]$/);
  const residencia = requisitos.documentosHabilitacao.find((item) => item.startsWith("20.8."));
  assert.match(residencia, /últimos 3 meses.*\[Termo de Referência PE 406\/2026, página 20\]$/);
  assert.ok(!requisitos.documentosHabilitacao.some((item) => item.includes("8.1. Os representantes")));
});

test("complementação restaura listas integrais sem depender da síntese curta da IA", () => {
  const estrutura = { documentosHabilitacao: ["Somente CNPJ"], declaracoesExigidas: [], identificacao: { numero: "406/2026" } };
  complementarRequisitos(estrutura, edital);
  assert.ok(estrutura.documentosHabilitacao.length > 15);
  assert.ok(estrutura.declaracoesExigidas.length > 12);
  assert.equal(estrutura.identificacao.numero, "406/2026");
  const contexto = selecionarContexto(edital);
  assert.ok(contexto.length <= 22000);
  for (const categoria of ["documentosHabilitacao", "documentosCredenciamento", "requisitosProposta", "declaracoesExigidas"]) assert.ok(contexto.includes(categoria));
});

test("preserva envio em três horas e assinatura eletrônica fora da seção de habilitação", () => {
  const requisitos = extrairRequisitosOperacionais(`--- Edital PE 406/2026 ---
[Página 18]
11. DO JULGAMENTO E DO PROCEDIMENTO DA ANÁLISE DA FICHA
TECNICA.
11.3. Concluído o procedimento previsto no item 9 deste Edital, o pregoeiro solicitará do licitante detentor da melhor oferta, o envio, no prazo de até 3 (três) horas, via Sistema e-Compras:
a) Licitantes Cadastrados: a proposta de preço reformulada na forma do item 6 deste Edital, e os documentos previstos nos itens 7.1.3, 7.1.4 e 7.1.5.2. deste Edital.
11.4. Os documentos exigidos neste Edital e Termo de Referência, quando confeccionados pelos licitantes, somente serão aceitos e analisados se contiverem assinatura eletrônica.
11.4.1.2. Serão desclassificados e/ou inabilitados os proponentes que apresentarem proposta ou documentação que contiverem assinaturas reprográficas, entendidas como aquelas reproduzidas eletronicamente (copiadas e coladas) de outros documentos, e/ou com assinatura de próprio punho e digitalizados.
`);
  const texto = Object.values(requisitos).flat().join("\n");
  assert.match(texto, /3 \(três\) horas/);
  assert.match(texto, /assinatura eletrônica/);
  assert.match(texto, /assinaturas reprográficas/);
});

test("horário de abertura não é substituído pelo limite de envio das propostas", () => {
  const { aplicarCamposOperacionaisDoTexto } = require("../lib/ia-edital").__test;
  const estrutura = { sessaoPublica: { horario: "09:15" } };
  aplicarCamposOperacionaisDoTexto(estrutura, "2.2. Limite para recebimento das propostas: dia 22/09/2026 às 09:15 horas.\n2.3. Início da sessão: dia 22/09/2026 às 09:30 horas.");
  assert.equal(estrutura.sessaoPublica.horario, "09:30");
  assert.equal(estrutura.sessaoPublica.data, "22/09/2026");
  assert.equal(estrutura.prazos.limiteEnvioPropostas, "22/09/2026 às 09:15");
});

test("leitura agrega edital e TR e sinaliza página com imagem em documento parcialmente legível", async () => {
  const caminhoPdf = require.resolve("pdf-parse");
  const cachePdf = require.cache[caminhoPdf];
  const fetchOriginal = global.fetch;
  const chamadas = [];
  require.cache[caminhoPdf] = { exports: async (buffer, opcoes) => {
    const principal = buffer.toString().endsWith("1");
    const paginas = principal ? ["Cláusula pesquisável do edital. ".repeat(25), "ANEXO II - imagem"] : ["Comprovante bancário exigido no TR. ".repeat(25)];
    const textos = [];
    for (const [pageIndex, texto] of paginas.entries()) textos.push(await opcoes.pagerender({
      pageIndex,
      getTextContent: async () => ({ items: [{ str: texto, transform: [1, 0, 0, 1, 0, 100] }] }),
    }));
    return { text: textos.join("\n"), numpages: paginas.length };
  } };
  global.fetch = async (url) => {
    chamadas.push(url);
    if (url.endsWith("/arquivos")) return { ok: true, json: async () => [
      { sequencialDocumento: 1, titulo: "Edital PE 406" },
      { sequencialDocumento: 2, titulo: "Termo de Referência PE 406" },
    ] };
    return { ok: true, arrayBuffer: async () => Buffer.from(`%PDF-${url.endsWith("/1") ? "1" : "2"}`) };
  };
  try {
    const { buscarTextoEdital } = require("../lib/ia-edital").__test;
    const fonte = await buscarTextoEdital("12345678000199-1-000406/2026");
    assert.equal(chamadas.length, 3);
    assert.equal(fonte.coberturaLeitura.documentosLidos.length, 2);
    assert.equal(fonte.coberturaLeitura.parcial, true);
    assert.match(fonte.texto, /Comprovante bancário exigido no TR/);
    assert.match(fonte.coberturaLeitura.documentosNaoLidos.join("\n"), /Edital PE 406.*páginas 2.*pouco texto/);
    assert.ok(!fonte.coberturaLeitura.documentosNaoLidos.some((item) => item.includes("Termo de Referência")));
  } finally {
    global.fetch = fetchOriginal;
    if (cachePdf) require.cache[caminhoPdf] = cachePdf;
    else delete require.cache[caminhoPdf];
  }
});

test("referências isoladas não cobrem credenciamento portal nem horário de Brasília", () => {
  const { catalogarRequisitos } = require("../_edital_operacional");
  const texto = "--- Edital (#2) ---\n[Página 1]\n2. LOCAL E DATA DO RECEBIMENTO DAS PROPOSTAS\n2.1. A inserção das propostas deverá ser feita no Portal e-compras.am.\n2.6. Será sempre considerado o horário de Brasília para todas as indicações de tempo.\n[Página 3]\n4. DO CREDENCIAMENTO\n4.3. O pré-cadastro e emissão do CRC serão realizados pelo sistema e-compras.am.\n";
  const catalogo = catalogarRequisitos(texto);
  assert.ok(catalogo.length >= 3);
  const estrutura = {};
  for (const fonte of catalogo) (estrutura[fonte.categoria] ||= []).push(`[${fonte.id}] Edital (#2), página ${fonte.texto.includes('4.3.') ? 3 : 1}, cláusulas ${fonte.texto.match(/^\d+(?:\.\d+)+/)?.[0]}`);
  complementarRequisitos(estrutura, texto);
  assert.equal(estrutura.coberturaSintese.requisitosSintetizados, 0);
  assert.match(estrutura.requisitosProposta.join(' '), /horário de Brasília/);
  assert.match(estrutura.documentosCredenciamento.join(' '), /emissão do CRC/);
});

test("sigla documental legítima continua aceita como síntese curta", () => {
  const { catalogarRequisitos } = require("../_edital_operacional");
  const texto = "--- Edital ---\n[Página 1]\n7. HABILITAÇÃO\n7.1. Apresentar CNDT.\n";
  const fonte = catalogarRequisitos(texto).find((item) => item.categoria === "documentosHabilitacao");
  assert.ok(fonte);
  const estrutura = { documentosHabilitacao: [`CNDT [${fonte.id}]`] };
  complementarRequisitos(estrutura, texto);
  assert.equal(estrutura.coberturaSintese.requisitosSintetizados, 1);
});

test("resposta Sim não substitui certidão de falência referenciada", () => {
  const { catalogarRequisitos } = require("../_edital_operacional");
  const texto = "--- Edital ---\n[Página 1]\n7. HABILITAÇÃO\n7.1. Apresentar certidão negativa de falência.\n";
  const fonte = catalogarRequisitos(texto).find((item) => item.categoria === "documentosHabilitacao");
  assert.ok(fonte);
  for (const resposta of ["Sim", "ok", "Não"]) {
    const estrutura = { documentosHabilitacao: [`${resposta} [${fonte.id}]`] };
    complementarRequisitos(estrutura, texto);
    assert.equal(estrutura.coberturaSintese.requisitosSintetizados, 0);
    assert.match(estrutura.documentosHabilitacao.join(" "), /certidão negativa de falência/);
  }
});

test("IDs inline seguem conteúdo documento página condições e equivalentes sem alterar fonte", () => {
  const { marcarRequisitosNaFonte, catalogarRequisitos } = require("../_edital_operacional");
  const texto = "--- Edital ---\n[Página 1]\n5. PROPOSTA\n5.1. Apresentar proposta comercial.\n5.1.1. Se houver modelo, identificá-lo na proposta.\n[Página 2]\n5.2. Declaração de veracidade dos documentos.\n--- Termo de referência ---\n[Página 1]\n8. PROPOSTA\n8.2. Apresentar proposta comercial.\n8.3. Apresentar amostra do produto.\nANEXO I DECLARAÇÃO\nDeclaro ciência das exigências para participação.\n";
  const catalogo = catalogarRequisitos(texto);
  const marcado = marcarRequisitosNaFonte(texto);
  assert.equal(marcado.replace(/^\[EXIGÊNCIA [^\]]+\]\n/gm, ""), texto);
  for (const requisito of catalogo) assert.ok(marcado.includes(requisito.id), requisito.id);
  const proposta = catalogo.find((item) => item.texto.startsWith("5.1."));
  assert.ok(proposta);
  assert.ok(marcado.includes(`[EXIGÊNCIA ${proposta.id} requisitosProposta]\n5.1.`));
  assert.ok(marcado.includes(`[EXIGÊNCIA ${proposta.id} requisitosProposta]\n5.1.1.`));
  assert.ok(marcado.includes(`[EXIGÊNCIA ${proposta.id} requisitosProposta]\n8.2.`));
  const declaracao = catalogo.find((item) => item.texto.startsWith("5.2."));
  assert.equal(declaracao.categoria, "declaracoesExigidas");
  assert.ok(marcado.includes(`[EXIGÊNCIA ${declaracao.id} declaracoesExigidas]\n5.2.`));
  assert.match(marcado, /\[EXIGÊNCIA R\d{4} declaracoesExigidas\]\nANEXO I DECLARAÇÃO/);
});

test("CRC não desaparece quando síntese atribui chave e senha ao ID do cadastro", () => {
  const { catalogarRequisitos } = require("../_edital_operacional");
  const texto = "--- Edital (#2) ---\n[Página 3]\n4. DO CREDENCIAMENTO\n4.3. O pré-cadastro de fornecedores, emissão, renovação e alteração do Certificado de Registro Cadastral – CRC, no CCF/AM, serão realizados por meio do sistema e-compras.am.\n";
  const fonte = catalogarRequisitos(texto).find((item) => item.categoria === "documentosCredenciamento");
  assert.ok(fonte);
  const estrutura = { documentosCredenciamento: [`Obter chave de identificação e senha de uso exclusivo para participação no e-compras.am [${fonte.id}]`] };
  complementarRequisitos(estrutura, texto);
  assert.equal(estrutura.coberturaSintese.requisitosSintetizados, 0);
  assert.match(estrutura.documentosCredenciamento.join(" "), /emissão, renovação e alteração.*CRC/);
});
