const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { prepararContexto, mensagensDefesa, schemaDefesa, validarAnalise, diagnosticarAnalise } = require('../_defesa_contexto');
const { executarDefesa, ajustarOrcamento } = require('../_defesa_handler');
const texto = '--- Aviso de dispensa ---\n[Página 1]\nLei 14.133/2021. Dispensa eletrônica. O pagamento ocorrerá em dez dias após o aceite da nota fiscal.';
const hash = createHash('sha256').update(texto).digest('hex');
const body = { edital: { numeroControlePNCP: '45279635000108-1-000923/2026' }, hashFonte: hash, tipo: 'esclarecimento', questionamento: 'Qual o prazo de pagamento?', objetivo: 'Confirmar a contagem.' };
const dossie = { versao: 17, fonteLida: true, textoEdital: texto, estrutura: { identificacao: { modalidade: 'Dispensa' } } };
function dados(ctx, tipo = 'especificar_cronograma') {
  return { pontos: [{ tipo, fontes: [ctx.fontes[0].id], fundamentos: [] }] };
}
function deps(overrides = {}) {
  return { sessao: { ok: true, userId: 'cliente' }, env: { DEFESA_IA_GRATUITA_CONFIRMADA: 'true', GROQ_API_KEY: 'teste' }, carregar: async () => dossie,
    autorizar: async () => ({ ok: true }), chamar: async (_key, mensagens) => {
      const contexto = JSON.parse(mensagens[1].content);
      const resposta = dados(contexto);
      if (contexto.fase !== 'questionamento') {
        const r1 = contexto.fontes.find(f => f.id === 'R1');
        resposta.resposta = { tipo: 'analisar_resposta_incompleta', fontes: [r1.id, contexto.fontes[0].id], fundamentos: [] };
      }
      return { ok: true, texto: JSON.stringify(resposta) };
    }, ...overrides };
}
test('defesa ignora fonte do navegador e devolve evidências canônicas', async () => {
  const r = await executarDefesa({ ...body, textoEdital: 'Pagar em99dias', edital: { ...body.edital, objeto: 'inventado' } }, deps());
  assert.equal(r.statusCode, 200);
  assert.equal(r.dados.hashFonte, hash);
  assert.ok(r.dados.analise.fatos[0].texto.includes('dez dias'));
  assert.ok(!r.dados.analise.minutaTexto.includes('99dias'));
  for (const campo of ['diagnostico', 'argumentoContrario', 'pedido', 'minutaTexto']) assert.equal(typeof r.dados.analise[campo], 'string');
});
test('schema mantém limites, IDs selecionados e duas evidências nas fases posteriores', async () => {
  const atual = { ...body, fase: 'resposta_orgao', respostaOrgao: 'Resposta SIMULADA: o pagamento depende do aceite.' };
  const ctx = prepararContexto(dossie, atual);
  const medido = ajustarOrcamento(ctx, atual, 'openai/gpt-oss-20b');
  assert.equal(medido.schema.properties.resposta.anyOf[0].properties.fontes.minItems, 2);
  assert.equal(medido.schema.properties.pontos.minItems, 1);
  assert.equal(schemaDefesa(ctx, body).properties.ancoras, undefined);
  assert.ok(medido.schema.properties.resposta.anyOf[0].properties.fontes.items.enum.includes('R1'));
  const resposta = dados(ctx);
  assert.equal(diagnosticarAnalise(JSON.stringify(resposta), ctx, atual).motivo, 'estrutura_ou_prosa_invalida');
  const r1 = ctx.fontes.find(f => f.id === 'R1');
  resposta.resposta = { tipo: 'analisar_resposta_incompleta', fontes: [r1.id, ctx.fontes[0].id], fundamentos: [] };
  assert.ok(validarAnalise(JSON.stringify(resposta), ctx, atual));
  let recebido;
  const padrao = deps();
  const resultado = await executarDefesa(atual, deps({ chamar: async (chave, mensagens, schema) => { recebido = schema; return padrao.chamar(chave, mensagens); } }));
  assert.equal(resultado.statusCode, 200);
  assert.deepEqual(recebido, medido.schema);
});
test('defesa bloqueia guard gratuito, ausência de usuário e robô sem chamada', async () => {
  let chamadas = 0;
  for (const extra of [{ env: {} }, { sessao: null }, { robo: true }]) {
    const r = await executarDefesa(body, deps({ ...extra, chamar: () => { chamadas++; } }));
    assert.ok([401, 403, 503].includes(r.statusCode));
  }
  assert.equal(chamadas, 0);
});
test('defesa bloqueia hash divergente e cota indisponível antes da IA', async () => {
  let chamadas = 0;
  const chamar = () => { chamadas++; };
  assert.equal((await executarDefesa({ ...body, hashFonte: 'a'.repeat(64) }, deps({ chamar }))).statusCode, 409);
  assert.equal((await executarDefesa(body, deps({ chamar, autorizar: async () => ({ ok: false, status: 503, erro: 'Cota indisponível' }) }))).statusCode, 503);
  assert.equal(chamadas, 0);
});
test('diagnóstico interno distingue rejeições sem expor conteúdo e mantém retorno público', () => {
  const ctx = prepararContexto(dossie, body);
  const resposta = dados(ctx);
  const casos = [[null, 'texto_invalido'], ['{"privado":"segredo"', 'json_invalido'],
    [JSON.stringify({ ...resposta, pedido: 'A exigência é ilegal.' }), 'estrutura_ou_prosa_invalida'],
    [JSON.stringify({ ...resposta, pontos: [{ ...resposta.pontos[0], fontes: ['F999'] }] }), 'fonte_ou_trecho_invalido'],
    [JSON.stringify({ ...resposta, fatos: [{ id: ctx.fontes[0].id, trecho: 'Trecho privado alterado.' }] }), 'estrutura_ou_prosa_invalida'],
    [JSON.stringify({ ...resposta, pontos: [{ ...resposta.pontos[0], fundamentos: ['norma_inventada'] }] }), 'fundamento_desconhecido']];
  for (const [entrada, motivo] of casos) {
    assert.deepEqual(diagnosticarAnalise(entrada, ctx, body), { analise: null, motivo });
    assert.equal(validarAnalise(entrada, ctx, body), null);
  }
  assert.deepEqual(diagnosticarAnalise(JSON.stringify(resposta), ctx, body).analise, validarAnalise(JSON.stringify(resposta), ctx, body));
});
test('prosa livre, referências normativas e conclusões não entram no transporte fechado', () => {
  const ctx = prepararContexto(dossie, body);
  for (const valor of ['Conferir art. 69.', 'Conferir Lei 123/06.', 'https://exemplo.test', 'É NULIDADE.', 'É tempestivo.', 'SÚMULA.', 'A obrigação normalmente vale para todos.']) {
    for (const campo of ['diagnostico', 'argumentoContrario', 'pedido', 'pendencias']) assert.equal(validarAnalise(JSON.stringify({ ...dados(ctx), [campo]: valor }), ctx, body), null);
  }
});
test('avisos fixos ficam no servidor e não são enviados à IA como prosa reutilizável', () => {
  const ctx = prepararContexto(dossie, body);
  const mensagens = mensagensDefesa(ctx, body);
  const payload = JSON.parse(mensagens[1].content);
  assert.equal(payload.pendencias, undefined);
  assert.ok(!mensagens[1].content.includes('Contratação direta: não foi aplicado automaticamente'));
  assert.deepEqual(payload.normas.map(n => n.id), ctx.normas.map(n => n.id));
  const r = validarAnalise(JSON.stringify(dados(ctx)), ctx, body);
  for (const aviso of ctx.pendencias) assert.equal(r.pendencias.filter(p => p === aviso).length, 1);
});
test('captura histórica de prosa não é reparada ou adaptada silenciosamente', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const raiz = path.resolve(__dirname, '../../../docs/qa/editais-reais-novos/08928517000157-116');
  const captura = JSON.parse(fs.readFileSync(path.join(raiz, 'reteste-defesa-resposta-schema-detalhe.json'), 'utf8'));
  const ctx = prepararContexto(dossie, body);
  assert.equal(diagnosticarAnalise(captura.chamadas[0].erroProvedor.failed_generation, ctx, body).motivo, 'estrutura_ou_prosa_invalida');
});
test('dispensa não recebe rito art164 como fundamento universal', () => {
  const ctx = prepararContexto(dossie, body);
  assert.ok(!ctx.normas.some(n => n.id === 'lei14133-art164'));
  assert.equal(validarAnalise(JSON.stringify({ ...dados(ctx), fundamentos: ['lei14133-art164'] }), ctx, body), null);
});
test('resposta extensa é declarada, explicitamente parcial e limitada ao fato integral selecionado', async () => {
  const r = await executarDefesa({ ...body, fase: 'resposta_orgao', respostaOrgao: 'Resposta do órgão. '.repeat(600) }, deps());
  assert.equal(r.statusCode, 200);
  assert.equal(r.dados.cobertura.parcial, true);
  assert.equal(r.dados.cobertura.declaracoesParciais, true);
  assert.ok(r.dados.analise.pendencias.some(p => /fornecida pelo usuário/i.test(p)));
  assert.equal((await executarDefesa({ ...body, fase: 'resposta_orgao' }, deps())).statusCode, 400);
});
test('resposta vazia ou inválida do provedor não aciona segunda chamada', async () => {
  for (const retorno of [{ ok: false }, { ok: true, texto: '{"diagnostico":"parecer livre"}' }]) {
    let chamadas = 0;
    const r = await executarDefesa(body, deps({ chamar: async () => { chamadas++; return retorno; } }));
    assert.equal(r.statusCode, 502);
    assert.equal(chamadas, 1);
  }
});
test('contexto sem tipo verificável ou orçamento grande bloqueia antes da cota e IA', async () => {
  let cotas = 0;
  const dependencias = deps({ autorizar: () => { cotas++; return { ok: true }; }, chamar: () => { throw Error('Não chamar'); } });
  assert.equal((await executarDefesa({ ...body, questionamento: '😀'.repeat(1500), objetivo: '🚀'.repeat(1500) }, dependencias)).statusCode, 422);
  const semTipo = { ...dossie, textoEdital: '--- Fonte ---\n[Página 1]\nLei 14.133/2021. Descrição do objeto disponível.' };
  assert.equal((await executarDefesa({ ...body, hashFonte: createHash('sha256').update(semTipo.textoEdital).digest('hex') }, { ...dependencias, carregar: async () => semTipo })).statusCode, 422);
  assert.equal(cotas, 0);
});
test('orçamento procura tipo no contexto completo sem exigir antecedente na primeira fonte', () => {
  const ctx = { fontes: [
    { id: 'F1', numero: '1.1', documento: 'Edital', pagina: '1', texto: '1.1. O objeto será organizado em lotes para aquisição.' },
    { id: 'F2', numero: '1.2', documento: 'Edital', pagina: '1', texto: '1.2. As entregas ocorrerão em dez dias após cada solicitação.' },
  ], normas: [], pendencias: [], cobertura: { fontesOmitidas: [] } };
  const medido = ajustarOrcamento(ctx, { ...body, questionamento: 'Qual o cronograma de entregas parceladas?' }, 'openai/gpt-oss-20b');
  assert.ok(medido);
  assert.deepEqual(medido.schema.properties.pontos.items.anyOf.map(r => r.properties.tipo.enum[0]), ['especificar_cronograma']);
});
test('normas temáticas de mérito são recuperadas sem universalizar dispensa documental', () => {
  const ctx = prepararContexto(dossie, { ...body, questionamento: 'Balanço e índices de habilitação com dispensa documental?' });
  assert.ok(ctx.normas.some(n => n.id === 'lei14133-art69'));
  assert.ok(ctx.normas.some(n => n.id === 'lei14133-art70-III'));
  assert.ok(!ctx.normas.some(n => n.id === 'lei14133-art164'));
});
test('fase da habilitação respeita modalidade e documentos genéricos não ativam dispensa documental', () => {
  const pregao = { ...dossie, estrutura: { identificacao: { modalidade: 'Pregão - Eletrônico' } } };
  const matriz = prepararContexto(pregao, { ...body, questionamento: 'Os documentos devem ser emitidos em nome da matriz ou filial?' });
  assert.ok(!matriz.normas.some(n => n.id === 'lei14133-art70-III'));
  assert.ok(!matriz.normas.some(n => n.id === 'lei14133-art63-II-III'));
  const pergunta = { ...body, questionamento: 'Em qual fase devem ser apresentados os documentos de habilitação pelas vencedoras e como tratar matriz e filial?' };
  const fase = prepararContexto(pregao, pergunta);
  const norma = fase.normas.find(n => n.id === 'lei14133-art63-II-III');
  assert.ok(norma);
  assert.ok(/anteceder.*julgamento/.test(norma.resumo));
  assert.ok(/fiscal.*posterior.*julgamento/.test(norma.resumo));
  assert.ok(/matriz.*filial/.test(norma.alerta));
  assert.ok(!fase.normas.some(n => n.id === 'lei14133-art70-III'));
  assert.ok(!prepararContexto(dossie, pergunta).normas.some(n => n.id === 'lei14133-art63-II-III'));
});
test('pregão com dispensa de vistoria preserva modalidade', () => {
  const pregao = { ...dossie, textoEdital: `${texto}\nO pregão dispensa a vistoria.`, estrutura: { identificacao: { modalidade: 'Pregão - Eletrônico' } } };
  const ctx = prepararContexto(pregao, body);
  assert.equal(ctx.dispensa, false);
  assert.ok(ctx.normas.some(n => n.id === 'lei14133-art164'));
});
test('central recusa recortar condição do caput ou inferir regime de citação comparativa', () => {
  const condicional = { ...dossie, textoEdital: '--- Termo ---\n[Página 1]\nLei14.133/2021.\n11.1.Se necessária a verificação da qualificação técnica e econômico-financeira do fornecedor, a documentação será restrita à definida no aviso.\n11.2.Outras condições.' };
  const pedido = { ...body, questionamento: 'Qualificação técnica?' };
  const ctx = prepararContexto(condicional, pedido);
  const fonte = ctx.fontes.find(f => f.texto.includes('Se necessária'));
  const resposta = { fatos: [{ id: fonte.id, trecho: 'a documentação será restrita à definida no aviso.' }], pontos: [{ tipo: 'especificar_documentos', fontes: [fonte.id], fundamentos: [] }] };
  assert.equal(validarAnalise(JSON.stringify(resposta), ctx, pedido), null);
  delete resposta.fatos;
  assert.ok(validarAnalise(JSON.stringify(resposta), ctx, pedido));
  const misto = { ...dossie, textoEdital: `${texto}\n${'Texto de contexto. '.repeat(800)}\n[Página 2]\nO regime aplicável é a Lei13.303/2016; a Lei14.133 é citada para comparação.` };
  const ambiguo = prepararContexto(misto, { ...body, questionamento: 'Balanço e habilitação?' });
  assert.deepEqual(ambiguo.normas, []);
  assert.ok(ambiguo.pendencias.some(p => /regime.*ambíguo/i.test(p)));
});
test('fonte canônica sem síntese aprovada exige cobertura explicitamente completa', async () => {
  const documental = { ...dossie, versaoValidacao: 17, modoDegradado: true, metodoResumo: 'extracao_documental_verificada', estrutura: { ...dossie.estrutura, coberturaLeitura: { parcial: false, documentosLidos: ['Aviso'], documentosNaoLidos: [] } } };
  const r = await executarDefesa(body, deps({ carregar: async () => documental }));
  assert.equal(r.statusCode, 200);
  assert.equal(r.dados.cobertura.sinteseIAPendente, true);
  assert.ok(r.dados.analise.pendencias.some(p => /sem síntese de IA aprovada/i.test(p)));
  for (const ruim of [{ ...documental, metodoResumo: 'ficha' }, { ...documental, estrutura: {} }, { ...documental, estrutura: { coberturaLeitura: { parcial: false, documentosLidos: [], documentosNaoLidos: [] } } }]) assert.equal((await executarDefesa(body, deps({ carregar: async () => ruim }))).statusCode, 409);
});

test('leitura parcial ou OCR não revisado bloqueiam antes de cota mesmo com síntese aparentemente aprovada', async () => {
  const coberturas = [
    { parcial: true, documentosNaoLidos: [] },
    { parcial: false, documentosNaoLidos: ['Página não lida'] },
    { parcial: false, documentosNaoLidos: [], ocrDocumentos: [{ revisadoVisualmente: false }] },
    { parcial: false, documentosNaoLidos: [], ocrDocumentos: [{}] },
  ];
  for (const [coberturaLeitura, modoDegradado] of coberturas.flatMap(c => [[c, false], [c, undefined]])) {
    let cotas = 0, chamadas = 0;
    const parcial = { ...dossie, modoDegradado, qualidadeResumo: { aprovado: true }, estrutura: { ...dossie.estrutura, coberturaLeitura } };
    const r = await executarDefesa(body, deps({ carregar: async () => parcial, autorizar: async () => { cotas++; return { ok: true }; }, chamar: async () => { chamadas++; return { ok: false }; } }));
    assert.equal(r.statusCode, 409);
    assert.equal(cotas, 0);
    assert.equal(chamadas, 0);
  }
});

test('fonte nativa completa e OCR histórico revisado conservam elegibilidade documental sem certificar transcrição', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { fonteDocumentalVerificada } = require('../_defesa_contexto');
  for (const arquivo of ['08928517000157-116/dossie-documental-local.json', '88124961000159-125/dossie-documental-ocr-local.json']) {
    const envelope = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../docs/qa/editais-reais-novos', arquivo), 'utf8'));
    const fonte = envelope.dossie || envelope;
    assert.equal(fonteDocumentalVerificada(fonte), true);
    const antes = JSON.stringify(fonte);
    assert.equal(fonteDocumentalVerificada({ ...fonte, estrutura: { ...fonte.estrutura, coberturaLeitura: { ...fonte.estrutura.coberturaLeitura, parcial: true } } }), false);
    assert.equal(JSON.stringify(fonte), antes);
  }
});
test('fonte real Belém preserva cláusulas inteiras, resposta declarada, orçamento e IDs contíguos', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const raiz = path.resolve(__dirname, '../../../docs/qa/editais-reais-novos/08928517000157-116');
  const fonte = JSON.parse(fs.readFileSync(path.join(raiz, 'dossie-documental-local.json'), 'utf8'));
  const pedido = JSON.parse(fs.readFileSync(path.join(raiz, 'pedido-defesa-local.json'), 'utf8'));
  for (const atual of [pedido, { ...pedido, fase: 'resposta_orgao', respostaOrgao: 'O órgão informa que os documentos de qualificação serão solicitados apenas se necessários à verificação do fornecedor.' }]) {
    const ctx = prepararContexto(fonte, atual);
    const antes = ctx.fontes.filter(f => !f.declarada);
    assert.deepEqual(antes.map(f => f.id), antes.map((_, i) => `F${i + 1}`));
    const medido = ajustarOrcamento(ctx, atual, 'openai/gpt-oss-20b');
    assert.ok(medido);
    assert.ok(medido.tokens <= 7200 && medido.bytes <= 48000);
    assert.ok(ctx.fontes.some(f => f.numero === '11.1' && /Se necessária/.test(f.texto)));
    assert.ok(ctx.fontes.some(f => f.numero === '11.2'));
    const depois = ctx.fontes.filter(f => !f.declarada);
    assert.ok(depois.length < antes.length);
    assert.deepEqual(depois.map(f => f.id), depois.map((_, i) => `F${i + 1}`));
    assert.equal(depois[0].texto, antes[0].texto);
    assert.equal(ctx.hashFonte, pedido.hashFonte);
    if (atual.fase === 'resposta_orgao') assert.ok(ctx.fontes.some(f => f.id === 'R1'));
    if (ctx.cobertura.fontesOmitidas.length) assert.equal(ctx.cobertura.parcial, true);
  }
});
