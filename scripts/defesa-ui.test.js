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
      append(...filhos) { this.children.push(...filhos); }, replaceChildren() { this.children = []; }, setAttribute(k, v) { this[k] = v; }, focus() { doc.foco = this; } };
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
  const preparar = a.achar((e) => e.textContent === "Preparar esclarecimento");
  assert.match(preparar.className, /defesa-botao/);
  assert.equal(preparar["aria-controls"], "defesa-editor");
  assert.match(a.achar((e) => e.textContent === "Preparar impugnação").className, /defesa-botao-destaque/);
  preparar.onclick();
  assert.equal(a.achar((e) => e.id === "defesa-editor").hidden, false);
  assert.equal(a.achar((e) => e.id === "defesa-minuta-texto")["aria-describedby"], "defesa-editor-ajuda");
  const semProvas = ambiente(); semProvas.contexto.estrutura.questionamentosDocumentais[0].evidencias = [];
  renderizar(semProvas.host, semProvas.contexto);
  assert.match(semProvas.achar((e) => e.textContent === "Preparar esclarecimento").title, /evidência documental/);
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
  assert.equal(a.achar((e) => e.id === 'defesa-minuta-texto').value, '');
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
  a.achar((e) => e.textContent === "Preparar esclarecimento").onclick();
  const texto = a.achar((e) => e.id === "defesa-minuta-texto"), revisar = a.achar((e) => e.type === "checkbox");
  const baixar = a.achar((e) => e.textContent === "Exportar minuta .docx");
  assert.equal(baixar.disabled, true);
  revisar.checked = true; revisar.onchange(); assert.equal(baixar.disabled, false);
  texto.value += "\nMinha revisão"; texto.oninput(); assert.equal(baixar.disabled, true);
  a.achar((e) => e.textContent === "Salvar rascunho neste navegador").onclick();
  assert.equal(a.registros.size, 1);
  renderizar(a.host, { ...a.contexto, empresaId: "empresaB" });
  assert.equal(a.achar((e) => e.id === "defesa-minuta-texto").value, "");
});

test("mudança da fonte preserva texto não salvo e bloqueia exportação até nova minuta", () => {
  const a = ambiente(); renderizar(a.host, a.contexto);
  a.achar((e) => e.textContent === "Preparar esclarecimento").onclick();
  a.achar((e) => e.id === "defesa-minuta-texto").value = "Revisão particular não salva";
  renderizar(a.host, { ...a.contexto, estrutura: { ...a.contexto.estrutura, hashFonte: "hashB" } });
  assert.equal(a.achar((e) => e.id === "defesa-minuta-texto").value, "Revisão particular não salva");
  assert.equal(a.achar((e) => e.type === "checkbox").disabled, true);
  assert.equal(a.achar((e) => e.textContent === "Exportar minuta .docx").disabled, true);
});

test("sugestão antiga sem provas não libera criação de peça", () => {
  const a = ambiente(); renderizar(a.host, { ...a.contexto, estrutura: { hashFonte: "hash", possiveisQuestionamentos: ["Pode haver uma restrição"], questionamentosDocumentais: [] } });
  assert.equal(a.achar((e) => e.textContent === "Preparar impugnação").disabled, true);
});

test("evidência sem trecho mantém a preparação bloqueada em vez de falhar no clique", () => {
  const a = ambiente();
  a.contexto.estrutura.questionamentosDocumentais[0].evidencias = [{ documento: "Aviso.pdf", pagina: "2" }];
  renderizar(a.host, a.contexto);
  assert.equal(a.achar((e) => e.textContent === "Preparar esclarecimento").disabled, true);
  assert.equal(a.achar((e) => e.textContent === "Preparar impugnação").disabled, true);
});

for (const [modalidade, orgao, numero] of [
  ["Dispensa", "Município de Exemplo Sul", "11111111000111-1-000101/2026"],
  ["Pregão", "Instituto de Exemplo Norte", "22222222000122-1-000202/2026"],
  ["Concorrência", "Universidade de Exemplo Leste", "33333333000133-1-000303/2026"],
]) test(`${modalidade}: prepara as duas minutas, exige revisão e exporta só o conteúdo confirmado`, async () => {
  const a = ambiente(), exportados = [];
  a.contexto.edital = { modalidade, orgao, numeroControlePNCP: numero };
  a.contexto.exportar = async (minuta) => exportados.push(minuta);
  a.contexto.estrutura.questionamentosDocumentais = [{
    titulo: "Conferir momento da declaração", pergunta: "Em qual fase deve ser apresentada a declaração?",
    evidencias: [{ documento: "Aviso.pdf", pagina: "2", numero: "4.1", texto: "A declaração deverá acompanhar a proposta." }],
  }];
  renderizar(a.host, a.contexto);
  for (const [acao, tipo] of [["Preparar esclarecimento", "esclarecimento"], ["Preparar impugnação", "impugnacao"]]) {
    const preparar = a.achar((e) => e.textContent === acao);
    assert.equal(preparar.disabled, false);
    preparar.onclick();
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
  assert.equal(a.achar((e) => e.textContent === "Preparar esclarecimento").disabled, true);
  assert.equal(a.achar((e) => e.textContent === "Preparar impugnação").disabled, true);
});

test("nova análise da mesma fonte atualiza questionamentos sem perder a minuta em edição", () => {
  const a = ambiente(); renderizar(a.host, a.contexto);
  a.achar((e) => e.textContent === "Preparar esclarecimento").onclick();
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
    assert.equal(a.achar((e) => e.textContent === "Preparar esclarecimento").disabled, true);
    assert.equal(a.achar((e) => e.textContent === "Preparar impugnação").disabled, true);
  }
});

test("listas de questionamentos malformadas não quebram o resumo", () => {
  const a = ambiente();
  a.contexto.estrutura = { hashFonte: "hash", questionamentosDocumentais: [null], questionamentosSugeridos: {}, possiveisQuestionamentos: null };
  assert.doesNotThrow(() => renderizar(a.host, a.contexto));
  assert.equal(a.achar((e) => e.textContent === "Preparar esclarecimento"), undefined);
});
