const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { schemaDefesa, diagnosticarAnalise } = require('../_defesa_contexto');
const { executarDefesa } = require('../_defesa_handler');
const ponto = (tipo, ...fontes) => ({ tipo, fontes, fundamentos: [] });
function caso(extra = {}) {
  const ctx = { fontes: [
    { id: 'F1', numero: '11.1', documento: 'Termo', pagina: '3', texto: '11.1. Se necessária a verificação, serão apresentados os documentos de qualificação.' },
    { id: 'F2', numero: '11.2', documento: 'Termo', pagina: '3', texto: '11.2. A documentação poderá ser dispensada nas condições expressamente indicadas.' },
    { id: 'R1', declarada: true, documento: 'Resposta declarada não autenticada', pagina: '', texto: 'Resposta SIMULADA: confirmar os documentos conforme as condições do termo.' },
  ], normas: [], pendencias: [], dispensa: true };
  const body = { tipo: 'esclarecimento', fase: 'resposta_orgao', edital: { numeroControlePNCP: '45279635000108-1-000923/2026' }, questionamento: 'O item 11.1 condiciona os documentos e o item 11.2 admite dispensa documental. Como aplicar ambos?', objetivo: 'Comparar a resposta declarada e esclarecer as condições.', ...extra };
  const dados = { ancoras: { '11.1': ponto('especificar_documentos', 'F1'), '11.2': ponto('esclarecer_excecao', 'F2') }, pontos: [], resposta: ponto('analisar_resposta_incompleta', 'R1', 'F1', 'F2') };
  return { ctx, body, dados };
}
test('schema torna obrigatórias as duas cláusulas pedidas e associa fontes temáticas a cada âncora', () => {
  const c = caso();
  const schema = schemaDefesa(c.ctx, c.body);
  assert.deepEqual(schema.properties.ancoras.required, ['11.1', '11.2']);
  assert.deepEqual(schema.required, ['ancoras', 'pontos', 'resposta']);
  for (const branch of schema.properties.ancoras.properties['11.2'].anyOf) {
    assert.deepEqual(branch.properties.fontes.items.enum, ['F2']);
    assert.notEqual(branch.properties.tipo.enum[0], 'analisar_resposta_incompleta');
  }
  assert.equal(diagnosticarAnalise(JSON.stringify(c.dados), c.ctx, c.body).motivo, null);
});
test('omitir âncora ou usar só comparação não produz aprovação parcial silenciosa', () => {
  const c = caso();
  delete c.dados.ancoras['11.2'];
  assert.equal(diagnosticarAnalise(JSON.stringify(c.dados), c.ctx, c.body).motivo, 'ancoras_incompletas');
  c.dados.ancoras['11.2'] = ponto('analisar_resposta_incompleta', 'R1', 'F2');
  assert.equal(diagnosticarAnalise(JSON.stringify(c.dados), c.ctx, c.body).analise, null);
});
test('itens em lista, repetição e origens parentais preservam o escopo sem ler lei, data ou valor como cláusula', () => {
  const c = caso({ questionamento: 'Esclarecer os itens 11.1 e 11.2 e 11.1.', fase: 'questionamento' });
  assert.deepEqual(schemaDefesa(c.ctx, c.body).properties.ancoras.required, ['11.1', '11.2']);
  c.ctx.fontes[0].numero = '11.1.1';
  c.ctx.fontes[0].origens = [{ documento: 'Termo', pagina: '2', numero: '11.1', texto: '11.1. Se necessária a verificação.' }, { documento: 'Termo', pagina: '3', numero: '11.1.1', texto: '11.1.1. Documentos de qualificação.' }];
  assert.deepEqual(schemaDefesa(c.ctx, c.body).properties.ancoras.properties['11.1'].anyOf[0].properties.fontes.items.enum, ['F1']);
  const sem = schemaDefesa(c.ctx, { ...c.body, questionamento: 'Conferir Lei 14.133, art. 63, data 22/10/2026 e valor 11.2.' });
  assert.equal(sem.properties.ancoras, undefined);
  assert.equal(sem.properties.pontos.minItems, 1);
});
test('request final sem cláusulas explícitas não emite objeto estrito vazio de âncoras', () => {
  const { montarCorpoGroq } = require('../lib/ia-edital').__test;
  const c = caso({ questionamento: 'Quais documentos de habilitação precisam ser esclarecidos?', fase: 'questionamento' });
  const schema = schemaDefesa(c.ctx, c.body);
  const serializado = JSON.parse(JSON.stringify(montarCorpoGroq('openai/gpt-oss-20b', [], { maxTokens: 2500, reasoningEffort: 'low', schema })));
  assert.equal(serializado.response_format.json_schema.schema.properties.ancoras, undefined);
  assert.deepEqual(serializado.response_format.json_schema.schema.required, ['pontos']);
});
test('cláusula explicitamente solicitada fora do contexto bloqueia antes da cota e da IA', async () => {
  const textoEdital = '--- Termo ---\n[Página 1]\nLei 14.133/2021.\n11.1. Se necessária, será apresentada documentação de qualificação.';
  const body = { ...caso().body, fase: 'questionamento', questionamento: 'Esclarecer o item 99.99 e os documentos aplicáveis.', hashFonte: createHash('sha256').update(textoEdital).digest('hex') };
  let cotas = 0;
  let chamadas = 0;
  const r = await executarDefesa(body, { sessao: { ok: true, userId: 'teste' }, env: { DEFESA_IA_GRATUITA_CONFIRMADA: 'true', GROQ_API_KEY: 'teste' }, carregar: async () => ({ versao: 17, fonteLida: true, textoEdital, estrutura: { identificacao: { modalidade: 'Dispensa' } } }), autorizar: async () => { cotas++; return { ok: true }; }, chamar: async () => { chamadas++; } });
  assert.equal(r.statusCode, 409);
  assert.ok(r.dados.erro.includes('99.99'));
  assert.equal(cotas, 0);
  assert.equal(chamadas, 0);
});

test('âncoras delimitam o escopo: schema e servidor rejeitam pontos extras sem reparar o payload', () => {
  const c = caso();
  assert.equal(schemaDefesa(c.ctx, c.body).properties.pontos.maxItems, 0);
  assert.equal(diagnosticarAnalise(JSON.stringify(c.dados), c.ctx, c.body).motivo, null);
  c.dados.pontos.push(JSON.parse(JSON.stringify(c.dados.ancoras['11.1'])));
  assert.equal(diagnosticarAnalise(JSON.stringify(c.dados), c.ctx, c.body).motivo, 'pontos_fora_escopo_ancorado');
});
