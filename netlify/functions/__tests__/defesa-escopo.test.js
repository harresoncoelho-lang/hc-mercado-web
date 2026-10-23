const test = require('node:test');
const assert = require('node:assert/strict');
const { ancorasSolicitadas } = require('../_defesa_pontos');
const { prepararContexto, schemaDefesa, diagnosticarAnalise } = require('../_defesa_contexto');
const { ajustarOrcamento, executarDefesa } = require('../_defesa_handler');
const { clausulasComEscopo } = require('../_referencias_documentais');
const fonte = '--- anexo.pdf ---\n[Página 1]\nModelo de Edital - Lei nº 14.133, de 2021.\n1. SANÇÕES\n1.1. A multa será recolhida em trinta dias, a contar da comunicação oficial.\n[Página 2]\nModelo de Termo de Referência – Aquisições\n1. SANÇÕES\n1.1. A multa será recolhida em cinco dias, a contar da comunicação oficial.';
const pedido = questionamento => ({ tipo: 'esclarecimento', edital: { numeroControlePNCP: '00394452000103-1-022237/2026' }, questionamento, objetivo: 'Confirmar o prazo e seu marco.' });
const ctx = () => { const clausulasCanonicas = clausulasComEscopo(fonte); return { clausulasCanonicas, fontes: clausulasCanonicas.filter(c => c.numero === '1.1').map((f, i) => ({ ...f, id: `F${i + 1}` })), normas: [], pendencias: [], regimeConfirmado: true, dispensa: false }; };
test('TR explícito usa somente o TR; não aceita a fonte homônima do Edital', () => {
  const c = ctx(), body = pedido('Esclarecer o recolhimento da multa no item 1.1 do TR.');
  assert.deepEqual(ancorasSolicitadas(c, body), [{ numero: '1.1', fontesPermitidas: ['F2'] }]);
  const schema = schemaDefesa(c, body);
  for (const ramo of schema.properties.ancoras.properties['1.1'].anyOf) assert.deepEqual(ramo.properties.fontes.items.enum, ['F2']);
  const dados = { ancoras: { '1.1': { tipo: 'esclarecer_recolhimento_multa', fontes: ['F1'], fundamentos: [] } }, pontos: [] };
  assert.equal(diagnosticarAnalise(JSON.stringify(dados), c, body).motivo, 'ancora_sem_ponto_tematico');
});
test('sem documento, documento ausente, duplicata no mesmo escopo e dois escopos pedidos abstêm', () => {
  for (const questionamento of ['Esclarecer o recolhimento da multa no item 1.1.', 'Esclarecer o recolhimento da multa no item 1.1 do Contrato.', 'Esclarecer o recolhimento da multa no item 1.1 do Edital e item 1.1 do TR.']) assert.deepEqual(ancorasSolicitadas(ctx(), pedido(questionamento))[0].fontesPermitidas, []);
  const c = ctx(), tr = c.clausulasCanonicas.find(f => f.escopoDocumento === 'Termo de Referência' && f.numero === '1.1');
  c.clausulasCanonicas.push({ ...tr, pagina: '3', texto: '1.1. Outra multa será recolhida em dez dias, a contar da comunicação.' });
  assert.deepEqual(ancorasSolicitadas(c, pedido('Esclarecer o recolhimento da multa no item 1.1 do TR.'))[0].fontesPermitidas, []);
  const identica = ctx(); identica.clausulasCanonicas.push({ ...identica.clausulasCanonicas.find(f => f.escopoDocumento === 'Termo de Referência' && f.numero === '1.1') });
  assert.deepEqual(ancorasSolicitadas(identica, pedido('Esclarecer o recolhimento da multa no item 1.1 do TR.'))[0].fontesPermitidas, []);
  const semTR = ctx(); semTR.fontes = [semTR.fontes[0]];
  assert.deepEqual(ancorasSolicitadas(semTR, pedido('Esclarecer o recolhimento da multa no item 1.1 do TR.'))[0].fontesPermitidas, []);
});
test('orçamento não transforma duplicata canônica omitida em referência única', () => {
  const c = ctx(); c.fontes = [c.fontes[1]];
  assert.deepEqual(ancorasSolicitadas(c, pedido('Esclarecer o recolhimento da multa no item 1.1.'))[0].fontesPermitidas, []);
});
test('preparação real preserva escopo e o schema transportado restringe a fonte correta', () => {
  const body = pedido('Esclarecer o recolhimento da multa no item 1.1 do TR.');
  const c = prepararContexto({ textoEdital: fonte, estrutura: { identificacao: { modalidade: 'Pregão' } } }, body);
  const ancora = ancorasSolicitadas(c, body)[0];
  assert.equal(ancora.fontesPermitidas.length, 1);
  assert.equal(c.fontes.find(f => f.id === ancora.fontesPermitidas[0]).escopoDocumento, 'Termo de Referência');
  const medida = ajustarOrcamento(c, body, 'openai/gpt-oss-20b');
  assert.ok(medida);
  for (const ramo of medida.schemaTransporte.properties.ancoras.properties.A1.anyOf) assert.deepEqual(ramo.properties.fontes.items.enum, ancora.fontesPermitidas);
});
test('handler bloqueia ambiguidades, escopo ausente e referência dupla antes de cota ou IA', async () => {
  let cotas = 0, chamadas = 0;
  for (const questionamento of ['Esclarecer o recolhimento da multa no item 1.1.', 'Esclarecer o recolhimento da multa no item 1.1 do Contrato.', 'Esclarecer o recolhimento da multa no item 1.1 do Edital e item 1.1 do TR.']) {
    const body = { ...pedido(questionamento), hashFonte: require('node:crypto').createHash('sha256').update(fonte).digest('hex') };
    const r = await executarDefesa(body, { sessao: { ok: true, userId: 'qa' }, env: { GROQ_API_KEY: 'fixture', DEFESA_IA_GRATUITA_CONFIRMADA: 'true' }, carregar: async () => ({ versao: 17, fonteLida: true, textoEdital: fonte, estrutura: { identificacao: { modalidade: 'Pregão' } } }), autorizar: async () => { cotas++; return { ok: true }; }, chamar: async () => { chamadas++; return { ok: false }; } });
    assert.equal(r.statusCode, 409);
  }
  assert.equal(cotas, 0); assert.equal(chamadas, 0);
});
