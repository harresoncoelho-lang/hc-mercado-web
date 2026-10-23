const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararContexto, diagnosticarAnalise, schemaDefesa } = require('../_defesa_contexto');
const { pontosDisponiveis } = require('../_defesa_pontos');
function contexto(trecho, pergunta, modalidade = 'Pregão', lei = 'Lei 14.133/2021') {
  const body = { questionamento: pergunta, objetivo: 'Esclarecer a aplicação ao caso.', tipo: 'esclarecimento', edital: { numeroControlePNCP: 'teste' } };
  const dossie = { textoEdital: `--- Edital ---\n[Página 1]\n${lei}. Aquisição de bens.\n2.1. ${trecho}`, estrutura: { identificacao: { modalidade } } };
  return { ctx: prepararContexto(dossie, body), body };
}
function permitido(c, tipo, norma) {
  return pontosDisponiveis(c.ctx, c.body).find(p => p.tipo === tipo)?.fundamentosPermitidos.some(n => n.id === norma) || false;
}
test('base04 liga normas novas a documentos, cronograma, organização do objeto e critérios comprovados', () => {
  const casos = [
    ['A documentação de habilitação será exigida na fase indicada.', 'Quais documentos de habilitação serão pedidos?', 'especificar_documentos', 'lei14133-art62'],
    ['A habilitação fiscal e trabalhista exige documentos de regularidade do fornecedor.', 'Quais documentos de habilitação fiscal serão pedidos?', 'especificar_documentos', 'lei14133-art68'],
    ['O pagamento será efetuado em dez dias após a liquidação.', 'Qual prazo de pagamento e liquidação?', 'especificar_cronograma', 'lei14133-art92-V-VII'],
    ['Os produtos serão recebidos provisoriamente em dois dias e definitivamente em dez dias.', 'Quais prazos de recebimento definitivo dos produtos?', 'especificar_cronograma', 'lei14133-art140-II'],
    ['A aquisição será dividida em lotes para adjudicação separada.', 'Qual a justificativa do parcelamento do objeto em lotes?', 'esclarecer_organizacao_objeto', 'lei14133-art40-parcelamento'],
    ['Será admitida a marca Alfa como referência, com produtos equivalentes.', 'Como funciona a indicação de marca de referência?', 'esclarecer_organizacao_objeto', 'lei14133-art41-I'],
    ['O modelo comercial Alfa do equipamento foi indicado como referência de compatibilidade.', 'Como justificar a indicação do modelo comercial?', 'esclarecer_organizacao_objeto', 'lei14133-art41-I'],
    ['A exequibilidade da proposta será verificada mediante diligência.', 'Qual o critério de exequibilidade das propostas?', 'esclarecer_criterio_proposta', 'lei14133-art59-II-IV'],
  ];
  const { ajustarOrcamento } = require('../_defesa_handler');
  for (const [fonte, pergunta, tipo, norma] of casos) {
    const c = contexto(fonte, pergunta);
    assert.ok(permitido(c, tipo, norma), norma);
    const orcamento = ajustarOrcamento(c.ctx, c.body, 'openai/gpt-oss-20b');
    assert.ok(orcamento && orcamento.tokens <= 7200 && orcamento.bytes <= 48000, norma);
  }
});
test('normas novas falham fechadas sem regime, em regime especial e nos ritos não comprovados', () => {
  for (const lei of ['Sem regime indicado', 'Lei 13.303/2016 e referência comparativa à Lei 14.133/2021', 'Esta contratação é regida pela Lei 8.666/1993. A Lei 14.133/2021 é citada apenas para comparação', 'Não se aplica a Lei 14.133/2021 a este certame']) {
    const c = contexto('A exequibilidade da proposta será verificada mediante diligência.', 'Qual o critério de exequibilidade?', 'Pregão', lei);
    assert.deepEqual(c.ctx.normas, []);
  }
  for (const modalidade of ['Dispensa', 'Modalidade indefinida']) assert.equal(permitido(contexto('A exequibilidade da proposta será verificada mediante diligência.', 'Qual o critério de exequibilidade?', modalidade), 'esclarecer_criterio_proposta', 'lei14133-art59-II-IV'), false);
});
test('entregas parceladas e referências genéricas não provam lotes, marca ou exequibilidade', () => {
  assert.equal(permitido(contexto('As entregas serão parceladas em dez dias.', 'Qual o cronograma de entregas parceladas?'), 'esclarecer_organizacao_objeto', 'lei14133-art40-parcelamento'), false);
  assert.equal(permitido(contexto('A embalagem deverá conter marcação de segurança e selo INMETRO.', 'Como confirmar a marcação do produto?'), 'esclarecer_organizacao_objeto', 'lei14133-art41-I'), false);
  assert.equal(permitido(contexto('A proposta deve ser assinada pelo representante.', 'Qual o critério de exequibilidade da proposta?'), 'esclarecer_criterio_proposta', 'lei14133-art59-II-IV'), false);
  for (const fonte of ['O modelo de gestão do contrato será indicado no termo de referência.', 'O modelo de execução consiste em entregas sob demanda.']) {
    assert.equal(permitido(contexto(fonte, 'Qual modelo será utilizado?'), 'esclarecer_organizacao_objeto', 'lei14133-art41-I'), false);
  }
});
test('servidor recusa norma fora do ponto e não inventa percentual ou ilegalidade na marca', () => {
  const c = contexto('Será admitida a marca Alfa como referência, com produtos equivalentes.', 'Como funciona a indicação de marca de referência?');
  const id = pontosDisponiveis(c.ctx, c.body).find(p => p.tipo === 'esclarecer_organizacao_objeto').fontesPermitidas[0];
  const payload = { pontos: [{ tipo: 'esclarecer_organizacao_objeto', fontes: [id], fundamentos: ['lei14133-art41-I'] }] };
  const r = diagnosticarAnalise(JSON.stringify(payload), c.ctx, c.body);
  assert.equal(r.motivo, null);
  assert.ok(!/ilegal|75%|85%/.test(r.analise.pedido));
  payload.pontos[0].fundamentos = ['lei14133-art59-II-IV'];
  assert.equal(diagnosticarAnalise(JSON.stringify(payload), c.ctx, c.body).analise, null);
  const schema = schemaDefesa(c.ctx, c.body);
  assert.ok(!schema.properties.pontos.items.anyOf.flatMap(p => p.properties.fundamentos.items.enum || []).includes('lei14133-art59-II-IV'));
});

test('IN67 exige âmbito afirmativo comprovado na mesma fonte do intervalo, não apenas citação federal', () => {
  const intervalo = 'A abertura para envio de lances observará três dias úteis após a divulgação do aviso, conforme IN SEGES/ME 67/2021.';
  for (const prefixo of ['', 'Esta instrução rege a Administração Pública Federal direta. ', 'O órgão contratante não integra a Administração Pública Federal direta. ']) {
    assert.equal(permitido(contexto(prefixo + intervalo, 'Qual prazo de abertura para lances?', 'Dispensa'), 'especificar_cronograma', 'in67-2021-escopo-abertura'), false);
  }
  const federal = contexto('O órgão contratante integra a Administração Pública Federal direta. ' + intervalo, 'Qual prazo de abertura para lances?', 'Dispensa');
  assert.equal(permitido(federal, 'especificar_cronograma', 'in67-2021-escopo-abertura'), true);
  const transferencia = contexto('Esta contratação utiliza recursos da União decorrentes de transferências voluntárias. ' + intervalo, 'Qual prazo de abertura para lances?', 'Dispensa');
  assert.equal(permitido(transferencia, 'especificar_cronograma', 'in67-2021-escopo-abertura'), true);
});

test('fase invertida mantém exceção e novas referências não decidem prova de matriz ou filial', () => {
  const c = contexto('A habilitação antecederá o julgamento e somente a vencedora apresentará documentação fiscal, nos termos da ressalva do edital.', 'Qual a fase de habilitação e a apresentação pela vencedora?');
  const norma = c.ctx.normas.find(n => n.id === 'lei14133-art63-II-III');
  assert.match(norma.resumo, /ressalvada.*habilitação anteceder o julgamento/);
  assert.match(norma.resumo, /fiscal.*posterior ao julgamento/);
  assert.equal(permitido(c, 'confirmar_fase', 'lei14133-art63-II-III'), true);
  const direta = contexto('A habilitação será apresentada pela vencedora na fase posterior ao julgamento.', 'Qual a fase de habilitação da vencedora?', 'Dispensa');
  assert.equal(permitido(direta, 'confirmar_fase', 'lei14133-art63-II-III'), false);
  const modelo = contexto('Será utilizado o modelo de documento anexo para declarar a proposta.', 'Como usar o modelo de documento?');
  assert.equal(permitido(modelo, 'esclarecer_organizacao_objeto', 'lei14133-art41-I'), false);
});

test('recorte de exequibilidade não generaliza percentuais de engenharia e recebimento de compras não migra para obras', () => {
  for (const objeto of ['aquisição de bens', 'obra de engenharia']) {
    const c = contexto(`O objeto é ${objeto}. A exequibilidade da proposta será verificada por diligência.`, 'Qual o critério de exequibilidade da proposta?');
    const norma = c.ctx.normas.find(n => n.id === 'lei14133-art59-II-IV');
    assert.ok(norma);
    assert.doesNotMatch(norma.resumo + norma.alerta, /75%|85%|setenta e cinco|oitenta e cinco/);
  }
  const obra = contexto('O objeto é obra de engenharia. O recebimento definitivo ocorrerá em dez dias.', 'Qual o prazo de recebimento definitivo?');
  assert.equal(permitido(obra, 'especificar_cronograma', 'lei14133-art140-II'), false);
});

test('proveniência é oficial, curadoria íntegra e revisão profissional permanece pendente', () => {
  const { createHash } = require('node:crypto');
  const base = require('../knowledge-defesa.json');
  assert.match(base.versao, /^0\.4-/);
  assert.match(base.integridadeCuradoria.objeto, /não é hash do HTML/);
  assert.equal(base.coberturaCompleta, false);
  for (const n of base.fontes) {
    assert.ok(n.url.startsWith('https://www.planalto.gov.br/') || n.url.startsWith('https://www.gov.br/compras/'));
    assert.equal(n.proveniencia.revisaoProfissional, 'pendente');
    assert.equal(n.revisaoJuridica, 'pendente');
    assert.equal(n.consultadoEm, '2026-10-22');
    assert.ok(n.condicoes.length >= 2);
    const conteudo = Object.fromEntries(['id', 'norma', 'dispositivo', 'url', 'escopo', 'resumo', 'alerta', 'condicoes', 'consultadoEm'].map(k => [k, n[k]]));
    assert.equal(n.hashCuradoriaSha256, createHash('sha256').update(JSON.stringify(conteudo), 'utf8').digest('hex'));
  }
});

test('fixtures reais Belém e Santana conservam âncoras e cabem no corpo final sem enviar auditoria à IA', t => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { ajustarOrcamento } = require('../_defesa_handler');
  const { montarCorpoGroq } = require('../lib/ia-edital').__test;
  const raiz = path.resolve(__dirname, '../../../docs/qa/editais-reais-novos');
  const ler = (pasta, nome) => JSON.parse(fs.readFileSync(path.join(raiz, pasta, nome), 'utf8'));
  const casos = [
    ['08928517000157-116', 'dossie-documental-local.json', 'pedido-defesa-local.json'],
    ['08928517000157-116', 'dossie-documental-local.json', 'pedido-defesa-resposta-orgao-simulada-local.json'],
    ['88124961000159-125', 'dossie-documental-ocr-local.json', 'pedido-central-ocr-habilitacao-condicional.json'],
    ['88124961000159-125', 'dossie-documental-ocr-local.json', 'pedido-central-ocr-entrega-parcelada.json'],
  ];
  for (const [pasta, documento, pedido] of casos) {
    const envelope = ler(pasta, documento);
    const body = ler(pasta, pedido);
    const ctx = prepararContexto(envelope.dossie || envelope, body);
    const medido = ajustarOrcamento(ctx, body, 'openai/gpt-oss-20b');
    assert.ok(medido, pedido);
    assert.ok(medido.tokens <= 7200 && medido.bytes <= 48000);
    const corpo = montarCorpoGroq('openai/gpt-oss-20b', medido.mensagens, { maxTokens: 2500, reasoningEffort: 'low', schema: medido.schemaTransporte });
    assert.equal(Buffer.byteLength(JSON.stringify(corpo)), medido.bytes);
    assert.doesNotMatch(JSON.stringify(corpo.messages), /hashCuradoriaSha256|revisaoProfissional|integridadeCuradoria/);
    if (pasta.startsWith('089')) assert.deepEqual(medido.schema.properties.ancoras.required, ['11.1', '11.2']);
    t.diagnostic(JSON.stringify({ pedido, tokens: medido.tokens, bytes: medido.bytes, normas: ctx.normas.map(n => n.id), fontes: ctx.fontes.length, parcial: ctx.cobertura.parcial }));
  }
});
