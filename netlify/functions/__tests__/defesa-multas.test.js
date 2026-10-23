const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { clausulasSolicitadas, pontosDisponiveis, fundamentoApoiado, redigirPontos } = require('../_defesa_pontos');
const { schemaDefesa } = require('../_defesa_contexto');
const { executarDefesa } = require('../_defesa_handler');
const body = { tipo: 'esclarecimento', edital: { numeroControlePNCP: '00394452000103-1-022237/2026' }, questionamento: 'Conferir prazo de recolhimento de multas no subitem 14.4 do Edital e no subitem 7.7 do Termo de Referência.' };
const fontes = [
  { id: 'F1', numero: '14.4', documento: 'Edital', escopoDocumento: 'Edital', pagina: '17', texto: '14.4. A multa será recolhida no prazo máximo de (trinta) dias úteis, a contar da comunicação oficial.30' },
  { id: 'F2', numero: '7.7', documento: 'Termo de Referência', escopoDocumento: 'Termo de Referência', pagina: '25', texto: '7.7. A multa poderá ser recolhida administrativamente no prazo máximo de 05 (cinco) dias, a contar da data do recebimento da comunicação enviada pela autoridade competente.' },
];
const ctx = { fontes, normas: [], regimeConfirmado: true, dispensa: false };
test('subitem/subitens viram âncoras sem confundir normas, datas e valores', () => {
  assert.deepEqual(clausulasSolicitadas(body), ['14.4', '7.7']);
  assert.deepEqual(clausulasSolicitadas({ questionamento: 'Conferir subitens 14.4 e 7.7, artigo 164 da Lei 14.133, R$ 7.7 e data 23/10/2026.' }), ['14.4', '7.7']);
  assert.deepEqual(clausulasSolicitadas({ questionamento: 'Subitem 7.7 da Lei 14.133 e cláusula 5 do decreto; valor 14.4.' }), []);
});
test('recolhimento de multa exige assunto, evento, prazo e marco e conserva as duas âncoras', () => {
  const tipo = pontosDisponiveis(ctx, body).find(p => p.tipo === 'esclarecer_recolhimento_multa');
  assert.deepEqual(tipo.fontesPermitidas, ['F1', 'F2']);
  assert.equal(pontosDisponiveis(ctx, body).some(p => p.tipo === 'especificar_cronograma'), false);
  const schema = schemaDefesa(ctx, body);
  for (const n of ['14.4', '7.7']) assert.ok(schema.properties.ancoras.properties[n].anyOf.some(r => r.properties.tipo.enum[0] === tipo.tipo));
  const adversarios = ['A entrega ocorrerá em 5 dias a contar do recebimento da ordem.', 'O pagamento de faturas ocorrerá em 30 dias após o recebimento.', 'A multa será recolhida em prazo a definir a contar da comunicação.', 'A multa será recolhida em 5 dias.', 'A multa de mora incide após cinco dias do recebimento da ordem.'];
  const c = { ...ctx, fontes: adversarios.map((texto, i) => ({ id: `F${i}`, texto })) };
  assert.equal(pontosDisponiveis(c, body).some(p => p.tipo === tipo.tipo), false);
  assert.equal(pontosDisponiveis(ctx, { ...body, questionamento: 'Qual o prazo de entrega?' }).some(p => p.tipo === tipo.tipo), false);
  assert.equal(pontosDisponiveis(ctx, { ...body, questionamento: 'Qual o percentual da multa?' }).some(p => p.tipo === tipo.tipo), false);
  assert.equal(pontosDisponiveis(ctx, { ...body, questionamento: 'Qual o recolhimento da garantia no subitem 14.4?' }).some(p => p.tipo === tipo.tipo), false);
});
test('sugestão pública28 cobre exatamente as duas cláusulas de multa, sem lance ou aditivo homônimos', () => {
  const fs = require('node:fs'), path = require('node:path');
  const { clausulasComEscopo } = require('../_referencias_documentais');
  const fonte = fs.readFileSync(path.join(__dirname, 'fixtures/ux28-fonte-publica.txt'), 'utf8');
  const questionamento = require('./fixtures/ux28-pontos-publicos.json')[0];
  const clausulasCanonicas = clausulasComEscopo(fonte);
  const fontes = clausulasCanonicas.filter(c => ['14.4', '7.7'].includes(c.numero)).map((f, i) => ({ ...f, id: `F${i + 1}` }));
  assert.equal(fontes.length, 4);
  const contexto = { ...ctx, fontes, clausulasCanonicas };
  const pedido = { ...body, questionamento };
  const pontos = pontosDisponiveis(contexto, pedido);
  assert.deepEqual(pontos.map(p => p.tipo), ['esclarecer_recolhimento_multa']);
  const corretas = fontes.filter(f => /multa/i.test(f.texto));
  assert.deepEqual(pontos[0].fontesPermitidas, corretas.map(f => f.id));
  const schema = schemaDefesa(contexto, pedido);
  for (const numero of ['14.4', '7.7']) {
    assert.deepEqual(schema.properties.ancoras.properties[numero].anyOf.map(r => r.properties.tipo.enum[0]), ['esclarecer_recolhimento_multa']);
    assert.deepEqual(schema.properties.ancoras.properties[numero].anyOf[0].properties.fontes.items.enum, corretas.filter(f => f.numero === numero).map(f => f.id));
  }
});
test('fundamento geral não decide mérito e exige regime comprovado e licitação', () => {
  const pontos = [{ tipo: 'esclarecer_recolhimento_multa', fontes: ['F1', 'F2'] }];
  assert.equal(fundamentoApoiado('lei14133-art164', pontos, ctx), true);
  assert.equal(fundamentoApoiado('lei14133-art164', pontos, { ...ctx, regimeConfirmado: undefined }), false);
  assert.equal(fundamentoApoiado('lei14133-art164', pontos, { ...ctx, dispensa: true }), false);
  assert.equal(fundamentoApoiado('lei14133-art92-V-VII', pontos, ctx), false);
  const r = redigirPontos(pontos, ctx, body);
  assert.match(r.argumentoContrario, /não.*ilegalidade|não.*conflito/i);
  assert.match(r.pedido, /marcos|contagem/);
});
test('marco ausente em uma âncora bloqueia422 antes da cota e da IA', async () => {
  const textoEdital = '--- Edital ---\n[Página 1]\nLei 14.133/2021.\n14.4. A multa será recolhida em 30 dias.\n--- TR ---\n[Página 2]\n' + fontes[1].texto;
  let cota = 0, ia = 0;
  const pedido = { ...body, hashFonte: createHash('sha256').update(textoEdital).digest('hex') };
  const r = await executarDefesa(pedido, { sessao: { ok: true, userId: 'qa' }, env: { GROQ_API_KEY: 'fixture', DEFESA_IA_GRATUITA_CONFIRMADA: 'true' }, carregar: async () => ({ versao: 17, fonteLida: true, textoEdital, estrutura: { identificacao: { modalidade: 'Pregão' } } }), autorizar: async () => { cota++; return { ok: true }; }, chamar: async () => { ia++; return { ok: false }; } });
  assert.equal(r.statusCode, 422); assert.equal(cota, 0); assert.equal(ia, 0);
});
