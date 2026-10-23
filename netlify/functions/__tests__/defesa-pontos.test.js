const test = require('node:test');
const assert = require('node:assert/strict');
const { schemaDefesa, diagnosticarAnalise } = require('../_defesa_contexto');

const matriz = '11.4. Se a licitante for a matriz, todos os documentos deverão estar em nome da matriz, e se a licitante for a filial, todos os documentos deverão estar em nome da filial, exceto aqueles documentos que, pela própria natureza, comprovadamente, forem emitidos somente em nome da matriz.';
const fase = '4.1. A fase de habilitação sucederá as fases de apresentação de propostas e lances e de julgamento.';
const cronograma = '5.1. O prazo para assinatura será de 5 dias úteis a partir da convocação.';
const fonte = (id, texto, numero = '') => ({ id, texto, numero, documento: 'Edital', pagina: '3' });
function caso(fontes = [fonte('F1', matriz, '11.4')], extra = {}) {
  return { ctx: { fontes, normas: [], pendencias: ['Revisão jurídica pendente.'] }, body: { tipo: 'esclarecimento', fase: 'questionamento', edital: { numeroControlePNCP: '88124961000159-1-000125/2026' }, questionamento: 'Quais documentos, fases, exceções e prazos se aplicam à matriz e à filial?', ...extra } };
}
function resposta(ctx, tipo, ids = [ctx.fontes[0].id]) {
  return { pontos: [{ tipo, fontes: ids, fundamentos: [] }] };
}
const conferir = (dados, c) => diagnosticarAnalise(JSON.stringify(dados), c.ctx, c.body);

test('transporte de defesa é fechado em fatos, fundamentos e pontos vinculados', () => {
  const c = caso();
  const schema = schemaDefesa(c.ctx, c.body);
  assert.deepEqual(schema.required, ['pontos']);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.diagnostico, undefined);
  assert.equal(schema.properties.fatos, undefined);
  assert.equal(schema.properties.ancoras, undefined);
  assert.ok(schema.properties.pontos.items.anyOf.some(r => r.properties.tipo.enum.includes('esclarecer_excecao')));
  assert.ok(!schema.properties.pontos.items.anyOf.some(r => r.properties.tipo.enum.includes('especificar_cronograma')));
  const dados = resposta(c.ctx, 'esclarecer_excecao');
  assert.equal(conferir({ ...dados, diagnostico: 'A exceção normalmente permite certidão de filial.' }, c).analise, null);
  assert.ok(conferir(dados, c).analise);
});
test('exceção literal permanece inteira e o servidor não inventa comprovante nem reformula exclusividade', () => {
  const c = caso();
  const r = conferir(resposta(c.ctx, 'esclarecer_excecao'), c);
  assert.equal(r.motivo, null);
  assert.equal(r.analise.fatos[0].texto, matriz);
  assert.ok(r.analise.minutaTexto.includes(matriz));
  assert.ok(/qual comprovação será aceita/.test(r.analise.pedido));
  assert.ok(!/certidão de filial|registro de filial|normalmente|a matriz pode enviar/.test(r.analise.minutaTexto));
});
test('ID válido com tipo sem antecedente literal é recusado', () => {
  for (const tipo of ['confirmar_fase', 'especificar_cronograma']) {
    const c = caso();
    assert.equal(conferir(resposta(c.ctx, tipo), c).motivo, 'ponto_sem_antecedente');
  }
  const c = caso([fonte('F1', cronograma)]);
  assert.equal(conferir(resposta(c.ctx, 'especificar_documentos'), c).motivo, 'ponto_sem_antecedente');
});
test('fonte apropriada ao tipo mas fora do assunto solicitado não recebe classificação automática', () => {
  const c = caso([fonte('F1', matriz)], { questionamento: 'Qual é o prazo de pagamento?' });
  assert.equal(conferir(resposta(c.ctx, 'especificar_documentos'), c).motivo, 'ponto_sem_antecedente');
});
test('antecedente condicional de pagamento não comprova exceção documental de matriz ou filial', () => {
  const c = caso([fonte('F1', '2.1. O pagamento será efetuado quando houver recebimento definitivo, em dez dias.', '2.1')], { questionamento: 'Como comprovar a exceção para documentos da filial emitidos somente em nome da matriz?' });
  assert.equal(conferir(resposta(c.ctx, 'esclarecer_excecao'), c).motivo, 'ponto_sem_antecedente');
  const docFiscal = caso([fonte('F1', '2.1. O documento fiscal será pago quando recebido definitivamente, em dez dias.', '2.1')], c.body);
  assert.equal(conferir(resposta(docFiscal.ctx, 'esclarecer_excecao'), docFiscal).motivo, 'ponto_sem_antecedente');
});
test('cronograma selecionado precisa tratar do evento solicitado e fase precisa ser procedimental', () => {
  const c = caso([fonte('F1', '2.1. O pagamento ocorrerá em dez dias após o aceite da nota fiscal.', '2.1')], { questionamento: 'Qual o cronograma de entregas parceladas?' });
  assert.equal(conferir(resposta(c.ctx, 'especificar_cronograma'), c).motivo, 'ponto_sem_antecedente');
  const construcao = caso([fonte('F1', '2.1. A fase de pintura ocorrerá após a fase de acabamento.', '2.1')], { questionamento: 'Em qual fase se apresentam os documentos de habilitação das vencedoras?' });
  assert.equal(conferir(resposta(construcao.ctx, 'confirmar_fase'), construcao).motivo, 'ponto_sem_antecedente');
});
test('tipo desconhecido, ponto extra, fonte inexistente ou não citada não são reparados', () => {
  const c = caso([fonte('F1', matriz), fonte('F2', fase)]);
  const base = resposta(c.ctx, 'esclarecer_excecao');
  for (const ponto of [{ tipo: 'declarar_ilegal', fontes: ['F1'] }, { tipo: 'esclarecer_excecao', fontes: ['F999'] }, { tipo: 'confirmar_fase', fontes: ['F2'] }, { tipo: 'esclarecer_excecao', fontes: ['F1'], conclusao: 'Dispensar prova.' }]) assert.equal(conferir({ ...base, pontos: [ponto] }, c).analise, null);
  assert.equal(conferir({ ...base, pontos: [base.pontos[0], base.pontos[0]] }, c).analise, null);
});
test('objeto antigo com trecho, ID falso, duplicação e fundamento desconhecido permanecem recusados', () => {
  const c = caso();
  const base = resposta(c.ctx, 'esclarecer_excecao');
  assert.equal(conferir({ ...base, fatos: [{ id: 'F1', trecho: matriz }] }, c).motivo, 'estrutura_ou_prosa_invalida');
  assert.equal(conferir({ ...base, pontos: [{ ...base.pontos[0], fontes: ['F999'] }] }, c).motivo, 'fonte_ou_trecho_invalido');
  assert.equal(conferir({ ...base, pontos: [{ ...base.pontos[0], fontes: ['F1', 'F1'] }] }, c).analise, null);
  assert.equal(conferir({ ...base, pontos: [{ ...base.pontos[0], fundamentos: ['lei_inventada'] }] }, c).motivo, 'fundamento_desconhecido');
});
test('fase preserva o julgamento no texto literal e não cria ordem ou condição pela prosa da IA', () => {
  const c = caso([fonte('F1', fase, '4.1')]);
  const r = conferir(resposta(c.ctx, 'confirmar_fase'), c);
  assert.equal(r.motivo, null);
  assert.ok(r.analise.minutaTexto.includes(fase));
  assert.ok(/sequência/.test(r.analise.pedido));
  assert.ok(!/somente depois de propostas e lances/.test(r.analise.diagnostico));
});
test('cronograma exige evento e unidade e preserva prazo contratual sem equiparar prazos ou parcelamento', () => {
  const c = caso([fonte('F1', cronograma, '5.1')]);
  const r = conferir(resposta(c.ctx, 'especificar_cronograma'), c);
  assert.equal(r.motivo, null);
  assert.ok(r.analise.minutaTexto.includes(cronograma));
  assert.ok(!/contradição comprovada|prazo de impugnação é de 5/.test(r.analise.minutaTexto));
  const semUnidade = caso([fonte('F1', '5.1. A entrega será parcelada em lotes.')]);
  assert.equal(conferir(resposta(semUnidade.ctx, 'especificar_cronograma'), semUnidade).motivo, 'ponto_sem_antecedente');
});
test('resposta declarada exige R1 e fonte canônica integrais mais pontos temáticos e comparativos', () => {
  const r1 = { ...fonte('R1', 'Resposta SIMULADA: a Administração afirma ter esclarecido os documentos.'), declarada: true };
  const c = caso([fonte('F1', matriz), r1], { fase: 'resposta_orgao' });
  const base = resposta(c.ctx, 'esclarecer_excecao', ['F1', 'R1']);
  base.pontos = [{ tipo: 'esclarecer_excecao', fontes: ['F1'], fundamentos: [] }];
  base.resposta = { tipo: 'analisar_resposta_incompleta', fontes: ['R1', 'F1'], fundamentos: [] };
  const r = conferir(base, c);
  assert.equal(r.motivo, null);
  assert.ok(r.analise.minutaTexto.includes(r1.texto));
  assert.ok(!/a resposta não apresentou|permanece sem resposta concreta/.test(r.analise.diagnostico));
  assert.equal(conferir({ ...base, pontos: [] }, c).motivo, 'resposta_orgao_nao_analisada');
  assert.equal(conferir({ ...base, resposta: { ...base.resposta, fontes: ['R1'] } }, c).analise, null);
  assert.equal(conferir({ ...base, pontos: [], resposta: { ...base.resposta, fontes: ['R1'] } }, c).motivo, 'evidencia_canonica_ausente');
});
test('schema e validador compartilham as associações permitidas entre tipo e fonte', () => {
  const f8 = fonte('F8', '11.3. Os documentos deverão estar em nome da licitante e, preferencialmente, com CNPJ e endereço.', '11.3');
  const c = caso([fonte('F1', matriz, '11.4'), f8]);
  const schema = schemaDefesa(c.ctx, c.body);
  const excecao = schema.properties.pontos.items.anyOf.find(r => r.properties.tipo.enum[0] === 'esclarecer_excecao');
  const documentos = schema.properties.pontos.items.anyOf.find(r => r.properties.tipo.enum[0] === 'especificar_documentos');
  assert.deepEqual(excecao.properties.fontes.items.enum, ['F1']);
  assert.deepEqual(documentos.properties.fontes.items.enum, ['F1', 'F8']);
  const dados = { pontos: [{ tipo: 'esclarecer_excecao', fontes: ['F1', 'F8'], fundamentos: [] }] };
  assert.equal(conferir(dados, c).motivo, 'ponto_sem_antecedente');
  dados.pontos = [{ tipo: 'esclarecer_excecao', fontes: ['F1'], fundamentos: [] }, { tipo: 'especificar_documentos', fontes: ['F8'], fundamentos: [] }];
  assert.ok(conferir(dados, c).analise);
});
test('ID de item subordinado recupera sempre caput com vencedoras e condições da fonte canônica', () => {
  const { prepararContexto } = require('../_defesa_contexto');
  const dossie = { textoEdital: '--- Edital ---\n[Página 1]\nLei 14.133/2021.\n11.1. A habilitação das licitantes vencedoras será verificada mediante os documentos abaixo.\n11.1.1. Habilitação jurídica com registro comercial e inscrição cadastral.', estrutura: { identificacao: { modalidade: 'Pregão' } } };
  const c = caso(undefined, { questionamento: 'Quais documentos de habilitação são apresentados pelas licitantes vencedoras?' });
  c.ctx = prepararContexto(dossie, c.body);
  const subordinada = c.ctx.fontes.find(f => f.numero === '11.1.1');
  assert.ok(subordinada.texto.startsWith('11.1. A habilitação das licitantes vencedoras'));
  const dados = resposta(c.ctx, 'especificar_documentos', [subordinada.id]);
  const r = conferir(dados, c);
  assert.equal(r.motivo, null);
  assert.equal(r.analise.fatos[0].texto, subordinada.texto);
  assert.ok(r.analise.minutaTexto.includes('licitantes vencedoras'));
});
test('caput repetido usa somente o ancestral precedente mais próximo no mesmo caminho', () => {
  const { prepararContexto } = require('../_defesa_contexto');
  const dossie = { textoEdital: '--- Edital.pdf ---\n[Página 1]\nLei 14.133/2021.\n11 - HABILITAÇÃO\n11.1. Somente as vencedoras apresentarão os documentos de habilitação.\n11.1.1. Registro comercial obrigatório.\n[Página 2]\n11 - HABILITAÇÃO\n11.1. Quando solicitadas, as participantes apresentarão os documentos de habilitação.\n11.1.1. Inscrição cadastral obrigatória.', estrutura: { identificacao: { modalidade: 'Pregão' } } };
  const c = caso(undefined, { questionamento: 'Quais documentos de habilitação se aplicam às participantes quando solicitados?' });
  c.ctx = prepararContexto(dossie, c.body);
  const subordinada = c.ctx.fontes.find(f => f.numero === '11.1.1' && f.pagina === '2');
  assert.ok(subordinada);
  assert.ok(subordinada.texto.includes('Quando solicitadas'));
  assert.ok(!subordinada.texto.includes('Somente as vencedoras'));
  assert.ok(conferir(resposta(c.ctx, 'especificar_documentos', [subordinada.id]), c).analise);
});
test('caput de página anterior conserva referência própria na evidência, na minuta e no pedido', () => {
  const { prepararContexto } = require('../_defesa_contexto');
  const dossie = { textoEdital: '--- Edital.pdf ---\n[Página 1]\nLei 14.133/2021.\n11 - HABILITAÇÃO\n11.1. Somente as vencedoras apresentarão os documentos de habilitação.\n[Página 2]\n11 - HABILITAÇÃO\n11.1.1. Inscrição cadastral obrigatória.', estrutura: { identificacao: { modalidade: 'Pregão' } } };
  const c = caso(undefined, { questionamento: 'Quais documentos de habilitação devem ser apresentados pelas vencedoras?' });
  c.ctx = prepararContexto(dossie, c.body);
  const subordinada = c.ctx.fontes.find(f => f.numero === '11.1.1' && f.pagina === '2');
  const r = conferir(resposta(c.ctx, 'especificar_documentos', [subordinada.id]), c);
  assert.equal(r.motivo, null);
  assert.equal(r.analise.fatos[0].evidencias.length, 2);
  assert.equal(r.analise.fatos[0].evidencias[0].pagina, '1');
  assert.ok(r.analise.fatos[0].evidencias[0].texto.includes('Somente as vencedoras'));
  assert.equal(r.analise.fatos[0].evidencias[1].pagina, '2');
  assert.equal(r.analise.fatos[0].evidencias[1].texto, '11.1.1. Inscrição cadastral obrigatória.');
  assert.ok(r.analise.minutaTexto.includes('página 1'));
  assert.ok(r.analise.minutaTexto.includes('página 2'));
  assert.ok(r.analise.pedido.includes('página 1'));
});
test('declaração do usuário não sustenta sozinha ponto documental ou fase canônica', () => {
  const c = caso([{ ...fonte('R1', matriz), declarada: true }]);
  assert.equal(conferir(resposta(c.ctx, 'esclarecer_excecao'), c).motivo, 'evidencia_canonica_ausente');
});
test('fundamento temático sem ponto aplicável é recusado em vez de conferir mérito artificial', () => {
  const c = caso();
  c.ctx.normas = [{ id: 'lei14133-art63-II-III', norma: 'Lei 14.133/2021', dispositivo: 'art.63', url: 'https://www.planalto.gov.br/', escopo: 'fase de habilitação', alerta: 'Conferir inversão.' }];
  const base = resposta(c.ctx, 'esclarecer_excecao');
  assert.equal(conferir({ ...base, pontos: [{ ...base.pontos[0], fundamentos: ['lei14133-art63-II-III'] }] }, c).motivo, 'fundamento_sem_antecedente');
});
test('dispensa documental pode ter condições longas no mesmo trecho integral sem perder aplicabilidade', () => {
  const texto = `11.2. A documentação relacionada para demonstrar capacidade do fornecedor ${'com todas as condições previstas no termo '.repeat(8)}poderá ser dispensada, total ou parcialmente, nas hipóteses previstas.`;
  const c = caso([fonte('F1', texto, '11.2')], { questionamento: 'Como aplicar a dispensa documental e suas condições?' });
  c.ctx.normas = [{ id: 'lei14133-art70-III', norma: 'Lei 14.133/2021', dispositivo: 'art.70', url: 'https://www.planalto.gov.br/', escopo: 'dispensa documental condicionada', alerta: 'Não automática.' }];
  const base = resposta(c.ctx, 'esclarecer_excecao');
  assert.equal(conferir({ ...base, pontos: [{ ...base.pontos[0], fundamentos: ['lei14133-art70-III'] }] }, c).motivo, null);
});
test('schema expõe dependência da norma de fase no próprio ponto e servidor rejeita norma deslocada', () => {
  const c = caso([fonte('F1', matriz), fonte('F2', fase)]);
  c.ctx.dispensa = false;
  c.ctx.normas = [{ id: 'lei14133-art63-II-III', norma: 'Lei 14.133/2021', dispositivo: 'art.63', url: 'https://www.planalto.gov.br/', escopo: 'fase de habilitação', alerta: 'Conferir inversão.' }];
  const schema = schemaDefesa(c.ctx, c.body);
  const faseSchema = schema.properties.pontos.items.anyOf.find(r => r.properties.tipo.enum[0] === 'confirmar_fase');
  const documentosSchema = schema.properties.pontos.items.anyOf.find(r => r.properties.tipo.enum[0] === 'especificar_documentos');
  assert.deepEqual(faseSchema.properties.fundamentos.items.enum, ['lei14133-art63-II-III']);
  assert.equal(documentosSchema.properties.fundamentos.maxItems, 0);
  const r = resposta(c.ctx, 'confirmar_fase', ['F2']);
  r.pontos[0].fundamentos = ['lei14133-art63-II-III'];
  assert.equal(conferir(r, c).motivo, null);
  r.pontos[0].tipo = 'especificar_documentos';
  assert.equal(conferir(r, c).motivo, 'fundamento_sem_antecedente');
});
test('captura real não permite norma de fase em ponto documental nem aceita transporte antigo', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const base = require('../knowledge-defesa.json');
  const raiz = path.resolve(__dirname, '../../../docs/qa/editais-reais-novos/88124961000159-125');
  const captura = JSON.parse(fs.readFileSync(path.join(raiz, 'defesa-ids-habilitacao-real.json'), 'utf8'));
  const body = JSON.parse(fs.readFileSync(path.join(raiz, 'pedido-central-ocr-habilitacao-condicional.json'), 'utf8'));
  const publico = captura.chamadas[0].contextoPublico;
  const c = { body, ctx: { fontes: publico.fontes, normas: base.fontes.filter(n => publico.normas.some(p => p.id === n.id)), dispensa: false, pendencias: [] } };
  const historica = JSON.parse(captura.chamadas[0].content);
  assert.equal(conferir(historica, c).motivo, 'estrutura_ou_prosa_invalida');
  const adversarial = { pontos: historica.pontos.map((p, i) => ({ ...p, fundamentos: i === 0 ? historica.fundamentos : [] })) };
  assert.equal(conferir(adversarial, c).motivo, 'fundamento_sem_antecedente');
  adversarial.pontos[0].fundamentos = [];
  adversarial.pontos.push({ tipo: 'confirmar_fase', fontes: ['F1'], fundamentos: historica.fundamentos });
  assert.equal(conferir(adversarial, c).motivo, null);
});
test('impugnação permanece em abstenção sem pedido de mérito automático', () => {
  const c = caso(undefined, { tipo: 'impugnacao' });
  const r = conferir(resposta(c.ctx, 'esclarecer_excecao'), c);
  assert.equal(r.motivo, null);
  assert.ok(/Não foi formulado pedido de impugnação/.test(r.analise.pedido));
  assert.ok(!r.analise.minutaTexto.startsWith('Rascunho de impugnação'));
});
