const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { juntarExigencias, classificar, marcarIncomuns, coberturaPorDocumento, estadoDaEtapa,
  blocosParaSegundaPassada, validarSegundaPassada, separarPorDocumento } = require("../_exigencias");

const pasta = path.join(__dirname, "fixtures", "exigencias");
const dossies = require("./fixtures/exigencias/dossies.json");
function caso(nome) {
  const textoFonte = fs.readFileSync(path.join(pasta, `${nome}.txt`), "utf8").replace(/\r\n/g, "\n");
  const { dossieIA, coberturaLeitura, ufSede } = dossies[nome];
  const { exigencias, avisos } = juntarExigencias({ dossieIA, textoFonte });
  const textoPorDocumento = separarPorDocumento(textoFonte);
  const cobertura = coberturaPorDocumento({ documentos: coberturaLeitura, exigencias, textoPorDocumento });
  return { textoFonte, exigencias, avisos, ufSede, textoPorDocumento, cobertura, marcadas: marcarIncomuns(exigencias, { ufSede }) };
}
const achar = (lista, re) => lista.find((e) => re.test(e.texto));

test("declaração escondida no TR aparece mesmo quando a IA não a listou", () => {
  const { exigencias, textoFonte } = caso("pe-limpeza");
  const pegadinha = achar(exigencias, /sede ou filial na cidade de Manaus/);
  assert.ok(pegadinha, "a declaração do TR sumiu");
  assert.equal(pegadinha.origem, "leitura_deterministica");
  assert.equal(pegadinha.aviso, "a IA não listou; confira");
  assert.equal(pegadinha.documento, "Termo de Referencia (#2)");
  assert.equal(pegadinha.pagina, "14");
  assert.equal(pegadinha.categoria, "declaracao");
  assert.ok(textoFonte.includes(pegadinha.trecho), "trecho deve ser literal");
  assert.ok(pegadinha.trecho.length <= 600);
});

test("item nas duas fontes vira 'ambas' sem duplicar; item só da IA localizado herda página", () => {
  const { exigencias } = caso("pe-limpeza");
  const fgts = exigencias.filter((e) => /FGTS/.test(e.texto));
  assert.equal(fgts.length, 1, "FGTS da IA deve fundir com a regra");
  assert.equal(fgts[0].origem, "ambas");
  assert.equal(fgts[0].aviso, undefined);
  const visita = exigencias.find((e) => e.categoriaFonte === "exigeVisitaTecnica");
  assert.equal(visita.origem, "ia");
  assert.equal(visita.pagina, "14");
  assert.match(visita.trecho, /^A vistoria técnica ao local/);
  const amostra = exigencias.filter((e) => /amostra/i.test(e.texto));
  assert.equal(amostra.length, 1);
  assert.equal(amostra[0].origem, "ambas");
});

test("item inventado pela IA (sem trecho na fonte) vai para conferir", () => {
  const { exigencias } = caso("pe-limpeza");
  const iso = achar(exigencias, /ISO 9001/);
  assert.equal(iso.origem, "ia_sem_trecho");
  assert.equal(iso.estado, "conferir");
  assert.equal(iso.trecho, null);
  assert.match(iso.aviso, /não foi localizado/);
});

test("sem dossiê da IA ou sem fonte, avisa em vez de falhar calado", () => {
  const sem = juntarExigencias({ textoFonte: "", dossieIA: null });
  assert.deepEqual(sem.exigencias, []);
  assert.equal(sem.avisos.length, 2);
  const { textoFonte } = caso("pe-limpeza");
  const faltando = juntarExigencias({ textoFonte, dossieIA: {}, documentos: ["Anexo X (#9)"] });
  assert.ok(faltando.avisos.some((a) => /Anexo X \(#9\) não aparece/.test(a)));
  const invalido = juntarExigencias({ textoFonte, dossieIA: { declaracoesExigidas: [42] } });
  assert.ok(invalido.avisos.some((a) => /formato inválido/.test(a)));
});

test("anexo ilegível deixa a etapa em aguardando_leitura com lista explícita", () => {
  const { cobertura } = caso("pe-material");
  const anexo = cobertura.documentos.find((d) => d.documento === "Anexo IV - Planilha de Precos (#4)");
  assert.equal(anexo.estado, "nao_lido");
  assert.equal(anexo.motivo, "não foi possível ler");
  const etapa = estadoDaEtapa(cobertura);
  assert.equal(etapa.estado, "aguardando_leitura");
  assert.deepEqual(etapa.lidos, ["Edital PE 30-2026 (#1)", "Termo de Referencia (#2)"]);
  assert.deepEqual(etapa.naoLidos.map((d) => d.documento), ["Anexo IV - Planilha de Precos (#4)"]);
  assert.match(etapa.mensagem, /Não consegui ler o anexo Anexo IV/);
  assert.doesNotMatch(etapa.mensagem, /não informado/i);
});

test("leitura parcial, pendência geral e cobertura ausente também bloqueiam", () => {
  const textoPorDocumento = { "Edital (#1)": "[Página 1]\nTexto do edital." };
  const parcial = coberturaPorDocumento({ textoPorDocumento,
    documentos: { documentosLidos: ["Edital (#1)"], documentosNaoLidos: ["Edital (#1), páginas 3: pouco texto extraível; conferir imagens e tabelas"] } });
  assert.equal(parcial.documentos[0].estado, "parcial");
  assert.equal(estadoDaEtapa(parcial).estado, "aguardando_leitura");
  const geral = coberturaPorDocumento({ textoPorDocumento,
    documentos: { documentosLidos: ["Edital (#1)"], documentosNaoLidos: ["Texto excedeu o limite de leitura; conteúdo final não analisado"] } });
  assert.deepEqual(geral.pendenciasGerais, ["Texto excedeu o limite de leitura; conteúdo final não analisado"]);
  assert.equal(estadoDaEtapa(geral).estado, "aguardando_leitura");
  assert.equal(estadoDaEtapa(coberturaPorDocumento({ textoPorDocumento })).estado, "aguardando_leitura");
  assert.equal(estadoDaEtapa(null).estado, "aguardando_leitura");
  const semTexto = coberturaPorDocumento({ documentos: { documentosLidos: ["Edital (#1)"], documentosNaoLidos: [] } });
  assert.equal(semTexto.documentos[0].estado, "nao_lido");
});

test("tudo lido fica pronto", () => {
  const etapa = estadoDaEtapa(caso("pe-limpeza").cobertura);
  assert.equal(etapa.estado, "pronto");
  assert.equal(etapa.lidos.length, 3);
  assert.deepEqual(etapa.alertas, []);
});

test("alerta de cobertura dispara para TR lido com gatilho e zero exigências", () => {
  const { cobertura, exigencias } = caso("cc-reforma");
  assert.ok(!exigencias.some((e) => /responsabilidade ambiental/.test(e.texto)), "pré-condição: nenhuma fonte extraiu");
  assert.equal(cobertura.alertas.length, 1);
  const [alerta] = cobertura.alertas;
  assert.equal(alerta.documento, "Termo de Referencia (#2)");
  assert.equal(alerta.pagina, "14");
  assert.equal(alerta.mensagem, 'o Termo de Referencia (#2) cita "declar" na pág. 14, nenhuma exigência extraída');
  assert.match(alerta.trecho, /declaração de responsabilidade ambiental/);
});

test("alerta por página: declaração escondida na pág. 14 de TR que já tem exigência na pág. 3", () => {
  const textoFonte = fs.readFileSync(path.join(pasta, "pe-tr-pagina.txt"), "utf8").replace(/\r\n/g, "\n");
  const { exigencias } = juntarExigencias({ dossieIA: {}, textoFonte });
  const extraida = achar(exigencias, /equipe técnica para montagem/);
  assert.equal(extraida.documento, "Termo de Referencia (#2)");
  assert.equal(extraida.pagina, "3", "pré-condição: o TR já tem exigência extraída");
  assert.ok(!exigencias.some((e) => /procedência da madeira/.test(e.texto)), "pré-condição: a declaração escondida não foi extraída");
  const { alertas } = coberturaPorDocumento({ exigencias, textoPorDocumento: separarPorDocumento(textoFonte),
    documentos: { documentosLidos: ["Edital PE 44-2026 (#1)", "Termo de Referencia (#2)"], documentosNaoLidos: [] } });
  assert.equal(alertas.length, 1);
  assert.equal(alertas[0].documento, "Termo de Referencia (#2)");
  assert.equal(alertas[0].pagina, "14");
  assert.equal(alertas[0].forca, "forte");
  assert.equal(alertas[0].mensagem, 'o Termo de Referencia (#2) cita "declar" na pág. 14, nenhuma exigência extraída');
  assert.match(alertas[0].trecho, /declaração de procedência da madeira/);
});

test("mais de 8 páginas com gatilho forte viram um alerta agrupado; gatilho fraco fica por documento", () => {
  const paginas = Array.from({ length: 10 }, (_, i) => `[Página ${i + 1}]\nO licitante apresentará atestado da etapa ${i + 1}.`).join("\n");
  const muitos = coberturaPorDocumento({ textoPorDocumento: { "TR (#2)": paginas }, documentos: { documentosLidos: ["TR (#2)"], documentosNaoLidos: [] } });
  assert.equal(muitos.alertas.length, 1);
  assert.deepEqual(muitos.alertas[0].paginasComGatilho, ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
  assert.match(muitos.alertas[0].mensagem, /10 páginas com gatilho forte.*págs\. 1, 2, 3/);
  const fraco = "[Página 1]\nA proposta segue o cronograma.\n[Página 2]\nO atraso sujeita a contratada às sanções, sob pena de multa.";
  const comExigencia = [{ documento: "Minuta (#3)", pagina: "1", ocorrencias: [] }];
  const docs = { documentosLidos: ["Minuta (#3)"], documentosNaoLidos: [] };
  assert.deepEqual(coberturaPorDocumento({ textoPorDocumento: { "Minuta (#3)": fraco }, exigencias: comExigencia, documentos: docs }).alertas, []);
  const semExigencia = coberturaPorDocumento({ textoPorDocumento: { "Minuta (#3)": fraco }, documentos: docs }).alertas;
  assert.equal(semExigencia.length, 1);
  assert.equal(semExigencia[0].forca, "fraco");
  assert.equal(semExigencia[0].pagina, "2");
});

test("classificação cobre as categorias", () => {
  const casos = [
    ["Contrato social registrado na Junta Comercial", "juridica"], ["Certificado de regularidade do FGTS", "fiscal"],
    ["Atestado de capacidade técnica", "tecnica"], ["Balanço patrimonial com índices", "economica"],
    ["Declaração de que não emprega menor", "declaracao"], ["Proposta de preços com planilha", "proposta"],
    ["Amostra do produto em 3 dias", "amostra"], ["Vistoria ao local", "visita"], ["Garantia de proposta de 1%", "garantia"],
    ["Procuração do representante legal", "credenciamento"], ["A contratada fará a entrega no almoxarifado", "execucao"],
  ];
  for (const [texto, esperado] of casos) assert.equal(classificar({ texto }), esperado, texto);
  assert.equal(classificar({ texto: "Sim", categoriaFonte: "exigeAmostra" }), "amostra");
  assert.equal(classificar({ texto: "Outro documento", categoriaIA: "Técnica" }), "tecnica");
});

test("marcação de incomuns: pegadinhas sobem, padrão da 14.133 não", () => {
  const limpeza = caso("pe-limpeza").marcadas;
  const primeiraComum = limpeza.findIndex((e) => !e.incomum);
  assert.ok(limpeza.slice(primeiraComum).every((e) => !e.incomum), "incomuns devem vir no topo");
  const por = (re) => achar(limpeza, re);
  assert.match(por(/sede ou filial/).motivoIncomum, /fora da lista padrão.*só aparece em Termo de Referencia/);
  assert.match(por(/amostra/).motivoIncomum, /exige amostra.*só aparece em Minuta/);
  assert.match(limpeza.find((e) => e.categoriaFonte === "exigeVisitaTecnica").motivoIncomum, /visita técnica obrigatória/);
  assert.match(por(/Entrega dos materiais/).motivoIncomum, /prazo de entrega curto \(2 dias\)/);
  for (const re of [/FGTS/, /balanço patrimonial/, /atestado de capacidade/, /contrato social/, /não emprega menor/]) assert.equal(por(re).incomum, false, String(re));

  const material = caso("pe-material").marcadas;
  const m = (re) => achar(material, re).motivoIncomum;
  assert.match(m(/Estado do Pará/), /certidão de UF diferente da sede \(PA; sede AM\)/);
  assert.match(m(/Liquidez Corrente/), /índice financeiro diferente de LG\/SG\/LC ≥ 1 \(1\.5\)/);
  assert.match(m(/Conselho Regional de Química/), /registro em conselho/);
  assert.match(m(/70%/), /atestado com percentual acima de 50% \(70%\)/);
  assert.match(m(/garantia de proposta/), /garantia de proposta/);
  assert.equal(marcarIncomuns([{ texto: "Certidão da Fazenda do Estado do Pará" }])[0].motivoIncomum.includes("UF da sede não informada"), true);
});

test("segunda passada só envia blocos com gatilho, com documento e página, e limita tamanho", () => {
  const { textoPorDocumento } = caso("cc-reforma");
  const { blocos, omitidos } = blocosParaSegundaPassada(textoPorDocumento, { tamanhoBloco: 300 });
  assert.ok(blocos.length >= 1);
  assert.ok(blocos.every((b) => b.texto.length <= 300 && b.documento && b.gatilhos.length));
  assert.ok(blocos.some((b) => b.documento === "Termo de Referencia (#2)" && b.pagina === "14"));
  assert.ok(!blocos.some((b) => b.pagina === "13"), "página sem gatilho não vai para a IA");
  assert.deepEqual(omitidos, []);
  const apertado = blocosParaSegundaPassada(textoPorDocumento, { tamanhoBloco: 300, limiteTotal: 10 });
  assert.equal(apertado.blocos.length, 0);
  assert.ok(apertado.omitidos.length >= 1, "bloco cortado pelo orçamento fica registrado");
});

test("segunda passada descarta trecho que não existe na fonte e registra", () => {
  const { textoFonte } = caso("cc-reforma");
  const { aceitas, descartadas } = validarSegundaPassada({ exigencias: [
    { texto: "Declaração ambiental", documento: "Termo de Referencia (#2)", pagina: "14", trechoLiteral: "a falta da declaração de   responsabilidade ambiental pelo descarte de entulho" },
    { texto: "Seguro-garantia", documento: "Termo de Referencia (#2)", pagina: "14", trechoLiteral: "apresentar seguro-garantia de 5% do valor do contrato" },
    { texto: "Trecho de outro documento", documento: "Edital CC 5-2026 (#1)", trechoLiteral: "a falta da declaração de responsabilidade ambiental" },
    { texto: "Sem trecho" },
  ] }, textoFonte);
  assert.deepEqual(aceitas.map((a) => a.texto), ["Declaração ambiental"]);
  assert.equal(aceitas[0].origem, "segunda_passada");
  assert.deepEqual(descartadas.map((d) => d.motivo), ["trecho literal não existe na fonte", "trecho existe na fonte, mas não no documento citado", "trecho literal ausente ou curto demais para conferir"]);
  assert.equal(validarSegundaPassada("lixo", textoFonte).descartadas.length, 1);
});
