const test = require("node:test");
const assert = require("node:assert/strict");
globalThis.DefesaLicitante = require("../defesa-licitante");
const { renderizar, preencherIdentidadeLocal } = require("../defesa-ui");

test("identificação é preenchida localmente apenas nos marcadores previstos, sem inferir dados faltantes", () => {
  const entrada = 'Destinatário e identificação da interessada: [preencher e conferir]\nPrazo: [confirmar]';
  assert.equal(preencherIdentidadeLocal(entrada, { razaoSocial: 'Empresa Autorizada', cnpj: '12345678000190' }), 'Destinatário: [preencher e conferir]\nInteressada: Empresa Autorizada\nCNPJ: 12345678000190\nPrazo: [confirmar]');
  assert.equal(preencherIdentidadeLocal('[RAZAO_SOCIAL] / [CNPJ]', {}), '[preencher razão social] / [preencher CNPJ]');
  assert.equal(preencherIdentidadeLocal('Texto sem marcador', { razaoSocial: 'Outra empresa' }), 'Texto sem marcador');
});

function ambiente() {
  const doc = { defaultView: { confirm: () => true }, createElement(tag) {
    return { tag, ownerDocument: doc, children: [], style: {}, value: "", hidden: false, checked: false, disabled: false,
      append(...filhos) { this.children.push(...filhos); }, replaceChildren() { this.children = []; }, setAttribute(k, v) { this[k] = v; }, focus() { doc.foco = this; }, showModal() { this.open = true; }, close() { this.open = false; } };
  } };
  const host = doc.createElement("div"), registros = new Map();
  const contexto = { usuarioId: "usuarioA", empresaId: "empresaA", empresa: "Empresa Exemplo", edital: { numeroControlePNCP: "04285896000153-1-000061/2026", orgao: "Município" }, storage: { getItem: (k) => registros.get(k), setItem: (k, v) => registros.set(k, v) }, exportar: async () => {}, estrutura: { hashFonte: "hashA", questionamentosDocumentais: [{ titulo: "Conferir pagamento", evidencias: [{ documento: "TR.pdf", pagina: "14", texto: "Pagamento em 10 dias." }] }] } };
  const achar = (p) => { const busca = (e) => p(e) ? e : e.children?.map(busca).find(Boolean); return busca(host); };
  return { host, contexto, registros, achar };
}

test('Central bloqueia OCR não revisado e leitura parcial sem chamada e atualiza cobertura com o mesmo hash', async () => {
  const a = ambiente(); let chamadas = 0;
  a.contexto.analisar = async () => { chamadas++; };
  renderizar(a.host, a.contexto);
  assert.equal(a.achar(e => e.textContent === 'Analisar esclarecimento com IA').disabled, false);
  for (const coberturaLeitura of [{ parcial: true }, { parcial: false, documentosNaoLidos: ['ETP'] }, { parcial: false, ocrDocumentos: [{ revisadoVisualmente: false }] }]) {
    a.contexto.estrutura = { ...a.contexto.estrutura, coberturaLeitura };
    renderizar(a.host, a.contexto);
    const botao = a.achar(e => e.textContent === 'Analisar esclarecimento com IA');
    assert.equal(botao.disabled, true);
    assert.match(botao.title, /leitura|OCR/);
    await botao.onclick();
  }
  assert.equal(chamadas, 0);
});

test("ações de defesa têm identidade visual, instrução de bloqueio e editor associado", () => {
  const a = ambiente(); renderizar(a.host, a.contexto);
  const preparar = a.achar((e) => e.textContent === "Pedir esclarecimentos");
  assert.match(preparar.className, /defesa-botao/);
  assert.equal(preparar["aria-controls"], "defesa-dialogo");
  assert.match(a.achar((e) => e.textContent === "Impugnar").className, /defesa-botao-destaque/);
  preparar.onclick();
  assert.equal(a.achar((e) => e.id === "defesa-dialogo").open, true);
  assert.equal(a.achar((e) => e.id === "defesa-minuta-texto")["aria-describedby"], "defesa-editor-ajuda");
  const semProvas = ambiente(); semProvas.contexto.estrutura.questionamentosDocumentais[0].evidencias = [];
  renderizar(semProvas.host, semProvas.contexto);
  assert.equal(semProvas.achar((e) => e.textContent === "Pedir esclarecimentos").disabled, false);
});

test("análise inteligente usa pergunta e objetivo, mostra fundamentação e exige revisão", async () => {
  const a = ambiente(); let recebido;
  a.contexto.analisar = async (pedido) => { recebido = pedido; return {
    hashFonte: 'hashA', versaoBase: 'base-1', cobertura: { parcial: true },
    analise: { diagnostico: 'Conferir condições', fatos: [{ texto: 'Prazo documental', evidencias: [{ documento: 'TR.pdf', texto: 'Pagamento em 10 dias.' }] }],
      fundamentos: [{ id: 'lei', norma: 'Lei 14.133', dispositivo: 'Art. 164', url: 'https://www.planalto.gov.br/lei', aplicabilidade: 'Conferir regime' }],
      argumentoContrario: 'O órgão pode esclarecer', pedido: 'Esclarecer prazo', pendencias: ['Conferir o canal'], minutaTexto: 'Minuta personalizada após análise' },
  }; };
  renderizar(a.host, a.contexto);
  a.achar((e) => e.id === 'defesa-questionamento').value = 'Qual é o prazo de pagamento?';
  a.achar((e) => e.id === 'defesa-objetivo').value = 'Confirmar o marco inicial';
  await a.achar((e) => e.textContent === 'Analisar esclarecimento com IA').onclick();
  assert.deepEqual(recebido, { tipo: 'esclarecimento', questionamento: 'Qual é o prazo de pagamento?', objetivo: 'Confirmar o marco inicial', fase: 'questionamento', respostaOrgao: '', manifestacaoAnterior: '' });
  assert.ok(a.achar((e) => e.textContent === 'O órgão pode esclarecer'));
  assert.ok(a.achar((e) => e.textContent === 'Conferir o canal'));
  assert.equal(a.achar((e) => e.id === 'defesa-minuta-texto').value, 'Minuta personalizada após análise');
  assert.equal(a.achar((e) => e.textContent === 'Exportar minuta .docx').disabled, true);
  assert.equal([...a.registros.keys()].filter((k) => k.endsWith(':historico-v1')).length, 1);
  renderizar(a.host, { ...a.contexto, empresaId: 'empresaB' });
  assert.equal(a.achar((e) => e.textContent === 'Reutilizar contexto para nova análise'), undefined);
  renderizar(a.host, a.contexto);
  a.achar((e) => e.textContent === 'Reutilizar contexto para nova análise').onclick();
  assert.equal(a.achar((e) => e.id === 'defesa-questionamento').value, 'Qual é o prazo de pagamento?');
  assert.equal(a.achar((e) => e.id === 'defesa-minuta-texto').value, 'Minuta personalizada após análise');
});

test("resposta do órgão exige texto e é enviada como informação declarada pelo usuário", async () => {
  const a = ambiente(); const chamadas = [];
  a.contexto.analisar = async (pedido) => { chamadas.push(pedido); throw new Error('Teste isolado'); };
  renderizar(a.host, a.contexto);
  a.achar((e) => e.id === 'defesa-fase').value = 'resposta_orgao';
  a.achar((e) => e.id === 'defesa-fase').onchange();
  a.achar((e) => e.id === 'defesa-questionamento').value = 'Como interpretar a resposta?';
  a.achar((e) => e.id === 'defesa-objetivo').value = 'Preparar manifestação';
  const botao = a.achar((e) => e.textContent === 'Analisar esclarecimento com IA');
  await botao.onclick(); assert.equal(chamadas.length, 0);
  a.achar((e) => e.id === 'defesa-resposta-orgao').value = 'O órgão informou prazo diverso.';
  a.achar((e) => e.id === 'defesa-manifestacao-anterior').value = 'Perguntamos sobre pagamento.';
  await botao.onclick(); assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].fase, 'resposta_orgao');
  assert.equal(chamadas[0].respostaOrgao, 'O órgão informou prazo diverso.');
  assert.equal(chamadas[0].manifestacaoAnterior, 'Perguntamos sobre pagamento.');
});

test('aviso diferencia seleção parcial do contexto, declarações parciais e cobertura não especificada', async () => {
  for (const [cobertura, esperado] of [
    [{ parcial: true, contextoParcial: true }, 'Contexto parcial selecionado para análise'],
    [{ parcial: true, declaracoesParciais: true }, 'Declarações informadas foram incluídas apenas parcialmente'],
    [{ parcial: true }, 'Cobertura da análise parcial'],
  ]) {
    const a = ambiente();
    a.contexto.estrutura.coberturaLeitura = { parcial: false, documentosNaoLidos: [] };
    a.contexto.analisar = async () => ({ hashFonte: 'hashA', versaoBase: 'base-1', cobertura,
      analise: { diagnostico: 'Diagnóstico documental', fatos: [{ texto: 'Pagamento em dez dias.', evidencias: [{ documento: 'TR', texto: 'Pagamento em dez dias.' }] }], fundamentos: [], argumentoContrario: 'Conferir a condição.', pedido: 'Esclarecer o marco.', pendencias: [], minutaTexto: 'Minuta para revisão.' } });
    renderizar(a.host, a.contexto);
    a.achar(e => e.id === 'defesa-questionamento').value = 'Qual o marco?';
    a.achar(e => e.id === 'defesa-objetivo').value = 'Conferir o pagamento';
    await a.achar(e => e.textContent === 'Analisar esclarecimento com IA').onclick();
    const aviso = a.achar(e => e.textContent?.startsWith('Base normativa:'))?.textContent;
    assert.ok(aviso?.includes(esperado));
    assert.doesNotMatch(aviso, /Leitura parcial|Leitura documental parcial/);
  }
});

test("falha, fonte divergente e resposta incompleta não substituem texto por falsa análise", async () => {
  for (const analisar of [async () => { throw new Error('Serviço indisponível. Tente depois.'); }, async () => ({ hashFonte: 'outra', analise: {} }), async () => ({ hashFonte: 'hashA', analise: { minutaTexto: 'Sem contexto' } })]) {
    const a = ambiente(); a.contexto.analisar = analisar; renderizar(a.host, a.contexto);
    a.achar((e) => e.id === 'defesa-questionamento').value = 'Qual é o prazo?';
    a.achar((e) => e.id === 'defesa-objetivo').value = 'Confirmar o prazo';
    await a.achar((e) => e.textContent === 'Analisar impugnação com IA').onclick();
    assert.equal(a.achar((e) => e.id === 'defesa-minuta-texto').value, '');
    assert.equal(a.achar((e) => e.textContent === 'Exportar minuta .docx').disabled, true);
  }
});

test("resposta atrasada de outra empresa não ocupa o editor atual", async () => {
  const a = ambiente(); let resolver;
  a.contexto.analisar = () => new Promise((r) => { resolver = r; });
  renderizar(a.host, a.contexto);
  a.achar((e) => e.id === 'defesa-questionamento').value = 'Prazo?';
  a.achar((e) => e.id === 'defesa-objetivo').value = 'Conferir';
  const pendente = a.achar((e) => e.textContent === 'Analisar esclarecimento com IA').onclick();
  for (const id of ['defesa-fase', 'defesa-questionamento', 'defesa-objetivo', 'defesa-resposta-orgao', 'defesa-manifestacao-anterior']) assert.equal(a.achar((e) => e.id === id).disabled, true);
  renderizar(a.host, { ...a.contexto, empresaId: 'empresaB' });
  resolver({ hashFonte: 'hashA', analise: { minutaTexto: 'Minuta da outra empresa' } });
  await pendente;
  assert.equal(a.achar((e) => e.id === 'defesa-minuta-texto').value, '');
});

test("editor exige revisão, invalida revisão ao editar e não mistura rascunho de outra empresa", () => {
  const a = ambiente(); renderizar(a.host, a.contexto);
  a.achar((e) => e.textContent === "Pedir esclarecimentos").onclick();
  const texto = a.achar((e) => e.id === "defesa-minuta-texto"), revisar = a.achar((e) => e.type === "checkbox");
  const baixar = a.achar((e) => e.textContent === "Exportar minuta .docx");
  assert.equal(baixar.disabled, true);
  texto.value = "Minuta recuperada para revisão";
  revisar.checked = true; revisar.onchange(); assert.equal(baixar.disabled, false);
  texto.value += "\nMinha revisão"; texto.oninput(); assert.equal(baixar.disabled, true);
  a.achar((e) => e.textContent === "Salvar rascunho neste navegador").onclick();
  assert.equal(a.registros.size, 1);
  renderizar(a.host, { ...a.contexto, empresaId: "empresaB" });
  assert.equal(a.achar((e) => e.id === "defesa-minuta-texto").value, "");
});

test("mudança da fonte preserva texto não salvo e bloqueia exportação até nova minuta", () => {
  const a = ambiente(); renderizar(a.host, a.contexto);
  a.achar((e) => e.textContent === "Pedir esclarecimentos").onclick();
  a.achar((e) => e.id === "defesa-minuta-texto").value = "Revisão particular não salva";
  renderizar(a.host, { ...a.contexto, estrutura: { ...a.contexto.estrutura, hashFonte: "hashB" } });
  assert.equal(a.achar((e) => e.id === "defesa-minuta-texto").value, "Revisão particular não salva");
  assert.equal(a.achar((e) => e.type === "checkbox").disabled, true);
  assert.equal(a.achar((e) => e.textContent === "Exportar minuta .docx").disabled, true);
});

test("sugestão antiga sem provas abre a investigação sem criar peça", () => {
  const a = ambiente(); renderizar(a.host, { ...a.contexto, estrutura: { hashFonte: "hash", possiveisQuestionamentos: ["Pode haver uma restrição"], questionamentosDocumentais: [] } });
  assert.equal(a.achar((e) => e.textContent === "Impugnar").disabled, false);
  a.achar((e) => e.textContent === "Impugnar").onclick();
  assert.equal(a.achar(e => e.id === "defesa-dialogo").open, true);
  assert.equal(a.achar(e => e.id === "defesa-minuta-texto").value, "");
  assert.equal(a.achar(e => e.textContent === "Exportar minuta .docx").disabled, true);
});

test("evidência sem trecho permite abrir a Central, mas não fabrica minuta", () => {
  const a = ambiente();
  a.contexto.estrutura.questionamentosDocumentais[0].evidencias = [{ documento: "Aviso.pdf", pagina: "2" }];
  renderizar(a.host, a.contexto);
  assert.equal(a.achar((e) => e.textContent === "Pedir esclarecimentos").disabled, false);
  assert.equal(a.achar((e) => e.textContent === "Impugnar").disabled, false);
});

for (const [modalidade, orgao, numero] of [
  ["Dispensa", "Município de Exemplo Sul", "11111111000111-1-000101/2026"],
  ["Pregão", "Instituto de Exemplo Norte", "22222222000122-1-000202/2026"],
  ["Concorrência", "Universidade de Exemplo Leste", "33333333000133-1-000303/2026"],
]) test(`${modalidade}: abre sem gerar documento, analisa mediante clique e exporta só após revisão`, async () => {
  const a = ambiente(), exportados = [];
  let chamadas = 0;
  a.contexto.edital = { modalidade, orgao, numeroControlePNCP: numero };
  a.contexto.exportar = async (minuta) => exportados.push(minuta);
  a.contexto.estrutura.questionamentosDocumentais = [{
    titulo: "Conferir momento da declaração", pergunta: "Em qual fase deve ser apresentada a declaração?",
    evidencias: [{ documento: "Aviso.pdf", pagina: "2", numero: "4.1", texto: "A declaração deverá acompanhar a proposta." }],
  }];
  a.contexto.analisar = async () => { chamadas++; return { hashFonte: "hashA", versaoBase: "base-1", cobertura: { parcial: false }, analise: { diagnostico: "Conferir a fase", fatos: [{ texto: "Declaração", evidencias: a.contexto.estrutura.questionamentosDocumentais[0].evidencias }], fundamentos: [], argumentoContrario: "Conferir o procedimento", pedido: "Esclarecer a fase", pendencias: ["Revisão pendente"], minutaTexto: `${orgao}\n${numero}\nAviso.pdf, página 2, cláusula 4.1\nEm qual fase deve ser apresentada a declaração?` } }; };
  renderizar(a.host, a.contexto);
  for (const [acao, tipo] of [["Pedir esclarecimentos", "esclarecimento"], ["Impugnar", "impugnacao"]]) {
    const preparar = a.achar((e) => e.textContent === acao);
    assert.equal(preparar.disabled, false);
    preparar.onclick();
    const antes = chamadas;
    assert.equal(a.achar(e => e.id === "defesa-dialogo").open, true);
    assert.equal(chamadas, antes);
    await a.achar(e => e.textContent === (tipo === "impugnacao" ? "Analisar impugnação com IA" : "Analisar esclarecimento com IA")).onclick();
    const texto = a.achar((e) => e.id === "defesa-minuta-texto"), revisar = a.achar((e) => e.type === "checkbox");
    const baixar = a.achar((e) => e.textContent === "Exportar minuta .docx");
    assert.ok(texto.value.includes(orgao)); assert.ok(texto.value.includes(numero));
    assert.match(texto.value, /Aviso.pdf, página 2, cláusula 4.1/);
    assert.match(texto.value, /Em qual fase deve ser apresentada a declaração/);
    assert.doesNotMatch(texto.value, /Jutaí|04285896000153/);
    assert.equal(baixar.disabled, true);
    revisar.checked = true; revisar.onchange();
    assert.equal(baixar.disabled, false);
    await baixar.onclick();
    assert.deepEqual(exportados.at(-1), { tipo, texto: texto.value, revisado: true });
  }
  assert.equal(exportados.length, 2);
});

test("sugestões das duas listas de IA ficam visíveis sem inventar provas nem liberar minutas", () => {
  const a = ambiente();
  a.contexto.estrutura = { hashFonte: "fonte", questionamentosSugeridos: ["Conferir prazo da proposta"], possiveisQuestionamentos: ["Conferir abrangência do atestado"] };
  renderizar(a.host, a.contexto);
  assert.ok(a.achar((e) => e.textContent === "Conferir prazo da proposta"));
  assert.ok(a.achar((e) => e.textContent === "Conferir abrangência do atestado"));
  assert.equal(a.achar((e) => e.textContent === "Pedir esclarecimentos").disabled, false);
  assert.equal(a.achar((e) => e.textContent === "Impugnar").disabled, false);
});

test("nova análise da mesma fonte atualiza questionamentos sem perder a minuta em edição", () => {
  const a = ambiente(); renderizar(a.host, a.contexto);
  a.achar((e) => e.textContent === "Pedir esclarecimentos").onclick();
  a.achar((e) => e.id === "defesa-minuta-texto").value = "Revisão do usuário preservada";
  renderizar(a.host, { ...a.contexto, estrutura: { ...a.contexto.estrutura, questionamentosSugeridos: ["Conferir prazo de entrega"] } });
  assert.ok(a.achar((e) => e.textContent === "Conferir prazo de entrega"));
  assert.equal(a.achar((e) => e.id === "defesa-minuta-texto").value, "Revisão do usuário preservada");
  assert.equal(a.achar((e) => e.textContent === "Exportar minuta .docx").disabled, true);
});

test("provas nulas e malformadas não quebram interface nem habilitam preparação", () => {
  for (const evidencias of [null, "fonte", {}, [], [null], ["trecho"], [{ documento: "Aviso.pdf", texto: "  " }], [{ documento: " ", texto: "Trecho" }]]) {
    const a = ambiente();
    a.contexto.estrutura.questionamentosDocumentais[0].evidencias = evidencias;
    assert.doesNotThrow(() => renderizar(a.host, a.contexto));
    assert.equal(a.achar((e) => e.textContent === "Pedir esclarecimentos").disabled, false);
    assert.equal(a.achar((e) => e.textContent === "Impugnar").disabled, false);
  }
});

test("listas de questionamentos malformadas não quebram o resumo", () => {
  const a = ambiente();
  a.contexto.estrutura = { hashFonte: "hash", questionamentosDocumentais: [null], questionamentosSugeridos: {}, possiveisQuestionamentos: null };
  assert.doesNotThrow(() => renderizar(a.host, a.contexto));
  assert.equal(a.achar((e) => e.textContent === "Pedir esclarecimentos"), undefined);
});

test("dialog interno abre sem IA, preenche o ponto e Escape devolve foco ao botão", () => {
  const a = ambiente(); let chamadas = 0;
  a.contexto.analisar = async () => { chamadas++; };
  renderizar(a.host, a.contexto);
  const dialogo = a.achar(e => e.id === "defesa-dialogo");
  assert.equal(Boolean(dialogo.open), false);
  const abrir = a.achar(e => e.textContent === "Pedir esclarecimentos"); abrir.onclick();
  assert.equal(dialogo.open, true);
  assert.equal(a.achar(e => e.id === "defesa-questionamento").value, "Conferir pagamento");
  assert.ok(a.achar(e => e.id === "defesa-objetivo").value);
  assert.equal(chamadas, 0);
  let cancelado = false; dialogo.oncancel({ preventDefault() { cancelado = true; } });
  assert.equal(cancelado, true); assert.equal(dialogo.open, false); assert.equal(a.host.ownerDocument.foco, abrir);
});

test("sem fonte, conta ou OCR revisado pode abrir, mas análise continua bloqueada", () => {
  for (const modificacao of [{ usuarioId: null }, { estrutura: { questionamentosSugeridos: ["Conferir prazo"] } }, { estrutura: { hashFonte: "h", coberturaLeitura: { parcial: true }, questionamentosSugeridos: ["Conferir prazo"] } }]) {
    const a = ambiente(); renderizar(a.host, { ...a.contexto, ...modificacao, analisar: async () => {} });
    a.achar(e => e.textContent === "Abrir Central de Defesa").onclick();
    assert.equal(a.achar(e => e.id === "defesa-dialogo").open, true);
    assert.equal(a.achar(e => e.textContent === "Analisar esclarecimento com IA").disabled, true);
    assert.ok(a.achar(e => e.textContent === "Analisar esclarecimento com IA").title);
  }
});

test("atualização preserva formulário e janela; fechar contexto salva rascunho privado", () => {
  const a = ambiente(); renderizar(a.host, a.contexto);
  a.achar(e => e.textContent === "Abrir Central de Defesa").onclick();
  a.achar(e => e.id === "defesa-questionamento").value = "Pergunta em edição";
  renderizar(a.host, { ...a.contexto, estrutura: { ...a.contexto.estrutura, questionamentosSugeridos: ["Novo ponto"] } });
  assert.equal(a.achar(e => e.id === "defesa-dialogo").open, true);
  assert.equal(a.achar(e => e.id === "defesa-questionamento").value, "Pergunta em edição");
  a.host._defesa.fechar();
  const salvo = JSON.parse(a.registros.get(globalThis.DefesaLicitante.chaveRascunho("usuarioA", "empresaA", a.contexto.edital.numeroControlePNCP)));
  assert.equal(salvo.questionamento, "Pergunta em edição");
  assert.equal(a.achar(e => e.id === "defesa-dialogo").open, false);
});

test("fechar durante análise não permite trocar de ponto sob uma resposta pendente", async () => {
  const a = ambiente(); let resolver;
  a.contexto.estrutura.questionamentosSugeridos = ["Conferir uma segunda cláusula"];
  a.contexto.analisar = () => new Promise(resolve => { resolver = resolve; });
  renderizar(a.host, a.contexto);
  a.achar(e => e.textContent === "Pedir esclarecimentos").onclick();
  const pendente = a.achar(e => e.textContent === "Analisar esclarecimento com IA").onclick();
  const pergunta = a.achar(e => e.id === "defesa-questionamento");
  a.achar(e => e.textContent === "Voltar ao resumo").onclick();
  a.achar(e => e.textContent === "Abrir Central de Defesa").onclick();
  assert.equal(a.achar(e => e.id === "defesa-dialogo").open, false);
  assert.equal(pergunta.value, "Conferir pagamento");
  resolver({}); await pendente;
  assert.equal(a.achar(e => e.id === "defesa-minuta-texto").value, "");
});

test("sugestões usam vínculo canônico exato e preservam evidências estruturadas sem adivinhar trechos", () => {
  const a = ambiente();
  const evidencia = { documento: "Edital público", pagina: "4", numero: "7.1", texto: "A entrega ocorrerá em dez dias após a ordem de fornecimento." };
  a.contexto.estrutura = { hashFonte: "hashA", possiveisQuestionamentos: ["Conferir o item 7.1", { titulo: "Ponto estruturado", evidencias: [evidencia] }, "Sem vínculo"], evidenciasQuestionamentos: [{ texto: "Conferir o item 7.1", evidencias: [evidencia] }, { texto: "Outro título", evidencias: [evidencia] }] };
  renderizar(a.host, a.contexto);
  const busca = (el, p) => [el, ...(el.children || []).flatMap(f => busca(f, p))].filter(p);
  const trechos = busca(a.host, e => typeof e.textContent === "string" && e.textContent.includes(evidencia.texto));
  assert.equal(trechos.length, 2);
  assert.ok(a.achar(e => /Trecho ainda não identificado/.test(e.textContent || "")));
  a.contexto.estrutura.evidenciasQuestionamentos.push({ texto: "Sem vínculo", evidencias: [], motivo: "Referência ambígua; confira o documento." });
  renderizar(a.host, a.contexto);
  assert.ok(a.achar(e => e.textContent === "Referência ambígua; confira o documento."));
});

test("referência parcialmente localizada mantém motivo visível mesmo com evidência válida", () => {
  const a = ambiente();
  const evidencia = { documento: "Edital público", pagina: "4", numero: "4.4", texto: "O prazo de entrega será contado após a ordem de fornecimento." };
  a.contexto.estrutura = { hashFonte: "hashA", possiveisQuestionamentos: ["Conferir itens 4.4 e 3.6"], evidenciasQuestionamentos: [{ texto: "Conferir itens 4.4 e 3.6", evidencias: [evidencia], motivo: "Item 3.6 não localizado; confira o documento integral." }] };
  renderizar(a.host, a.contexto);
  const aviso = a.achar(e => e.textContent === "Item 3.6 não localizado; confira o documento integral.");
  assert.ok(aviso);
  const card = a.achar(e => e.tag === "article" && e.children?.includes(aviso));
  assert.ok(card, "aviso deve estar diretamente no card, visível sem abrir os trechos");
  assert.ok(a.achar(e => typeof e.textContent === "string" && e.textContent.includes(evidencia.texto)));
});
