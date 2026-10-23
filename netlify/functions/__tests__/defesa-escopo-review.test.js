const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { executarDefesa } = require('../_defesa_handler');

test('caso público28 atravessa contexto real e contrato estrito com as duas multas, sem lance ou aditivo', async () => {
  // O fixture preserva o texto público; o invólucro representa o transporte documental, não a paginação auditada.
  const textoEdital = '--- anexo-publico.pdf ---\n[Página 1]\n' + fs.readFileSync(path.join(__dirname, 'fixtures/ux28-fonte-publica.txt'), 'utf8');
  const body = { tipo: 'esclarecimento', questionamento: require('./fixtures/ux28-pontos-publicos.json')[0], objetivo: 'Confirmar os prazos e marcos de recolhimento das multas.', edital: { numeroControlePNCP: '00394452000103-1-022237/2026' }, hashFonte: createHash('sha256').update(textoEdital).digest('hex') };
  let chamadas = 0, cotas = 0;
  const resultado = await executarDefesa(body, { sessao: { ok: true, userId: 'qa-review' }, env: { GROQ_API_KEY: 'fixture-sem-rede', DEFESA_IA_GRATUITA_CONFIRMADA: 'true' }, carregar: async () => ({ versao: 17, fonteLida: true, textoEdital, estrutura: { identificacao: { modalidade: 'Pregão' } } }), autorizar: async () => { cotas++; return { ok: true }; }, chamar: async (_, mensagens, schema) => {
    chamadas++;
    const contexto = JSON.parse(mensagens[1].content), resposta = {};
    assert.equal(contexto.ancorasObrigatorias.length, 2);
    for (const numero of ['14.4', '7.7']) {
      const ancora = contexto.ancorasObrigatorias.find(a => a.numero === numero);
      const ramos = schema.properties.ancoras.properties[ancora.chave].anyOf;
      assert.deepEqual(ramos.map(r => r.properties.tipo.enum[0]), ['esclarecer_recolhimento_multa']);
      const permitidas = ramos[0].properties.fontes.items.enum;
      assert.equal(permitidas.length, 1, `${numero}: não oferecer fontes homônimas`);
      const fonte = contexto.fontes.find(f => f.id === permitidas[0]);
      assert.match(fonte.texto, /multa/i);
      assert.doesNotMatch(fonte.texto, /termo aditivo|licitante somente poderá oferecer lance/i);
      resposta[ancora.chave] = { tipo: 'esclarecer_recolhimento_multa', fontes: permitidas, fundamentos: [] };
    }
    return { ok: true, texto: JSON.stringify({ ancoras: resposta }) };
  } });
  assert.equal(resultado.statusCode, 200);
  assert.equal(cotas, 1); assert.equal(chamadas, 1);
  assert.equal(resultado.dados.analise.fatos.length, 2);
  assert.match(resultado.dados.analise.minutaTexto, /trinta/);
  assert.match(resultado.dados.analise.minutaTexto, /cinco/);
});
