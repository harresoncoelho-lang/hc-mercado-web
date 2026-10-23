const test = require('node:test');
const assert = require('node:assert/strict');
const { schemaDefesa, mensagensDefesa, diagnosticarAnalise } = require('../_defesa_contexto');
const { prepararTransporte, traduzirTransporte } = require('../_defesa_transporte');
const ctx = { fontes: [{ id: 'F1', numero: '10.1', documento: 'TR', pagina: '3', texto: '10.1. O pagamento ocorrerá em trinta dias contados do adimplemento.' }], normas: [], pendencias: [], dispensa: true };
const body = { tipo: 'esclarecimento', edital: { numeroControlePNCP: '08928517000157-1-000116/2026' }, questionamento: 'Esclarecer o prazo do item 10.1.', objetivo: 'Confirmar o pagamento.' };
const ponto = { tipo: 'especificar_cronograma', fontes: ['F1'], fundamentos: [] };
const montar = () => prepararTransporte(mensagensDefesa(ctx, body), schemaDefesa(ctx, body));

test('transporte usa chaves estáveis e preserva integralmente os ramos e a obrigatoriedade da âncora', () => {
  const interno = schemaDefesa(ctx, body);
  const t = montar();
  assert.deepEqual(t.schema.required, ['ancoras']);
  assert.deepEqual(t.schema.properties.ancoras.required, ['A1']);
  assert.deepEqual(t.schema.properties.ancoras.properties.A1, interno.properties.ancoras.properties['10.1']);
  assert.equal(t.schema.properties.pontos, undefined);
  assert.deepEqual(JSON.parse(t.mensagens[1].content).ancorasObrigatorias[0], { numero: '10.1', fontesPermitidas: ['F1'], chave: 'A1' });
  const recebido = traduzirTransporte(JSON.stringify({ ancoras: { A1: ponto } }), interno);
  assert.deepEqual(JSON.parse(recebido), { ancoras: { '10.1': ponto }, pontos: [] });
  assert.equal(diagnosticarAnalise(recebido, ctx, body).motivo, null);
});

test('JSON inválido, chave decimal, âncora ausente, extra e pontos fora do escopo não são reparados', () => {
  const schema = schemaDefesa(ctx, body);
  for (const dados of ['{"ancoras":{"A1":{},"":"":""}}', '{}', '{"ancoras":[]}', JSON.stringify({ ancoras: { '10.1': ponto } }), JSON.stringify({ ancoras: {} }), JSON.stringify({ ancoras: { A1: ponto, A2: ponto } }), JSON.stringify({ ancoras: { A1: ponto }, pontos: [] })]) {
    assert.equal(traduzirTransporte(dados, schema), null);
  }
  const fonteErrada = traduzirTransporte(JSON.stringify({ ancoras: { A1: { ...ponto, fontes: ['F99'] } } }), schema);
  assert.equal(diagnosticarAnalise(fonteErrada, ctx, body).analise, null);
});

test('sem âncoras não muda payload, schema nem validação; fase posterior conserva resposta obrigatória', () => {
  const b = { ...body, questionamento: 'Qual o prazo de pagamento?' };
  const mensagens = mensagensDefesa(ctx, b), schema = schemaDefesa(ctx, b);
  assert.deepEqual(prepararTransporte(mensagens, schema), { mensagens, schema });
  assert.equal(traduzirTransporte('{"pontos":[]}', schema), '{"pontos":[]}');
  const posterior = schemaDefesa(ctx, { ...body, fase: 'resposta_orgao' });
  const t = prepararTransporte(mensagensDefesa(ctx, body), posterior);
  assert.deepEqual(t.schema.required, ['ancoras', 'resposta']);
  assert.equal(traduzirTransporte(JSON.stringify({ ancoras: { A1: ponto } }), posterior), null);
});

test('duas âncoras e fase posterior traduzem sem mudar associações e rejeitam omissão ou troca de fontes', () => {
  const c = { ...ctx, fontes: [...ctx.fontes, { id: 'F2', numero: '11.1', documento: 'TR', pagina: '3', texto: '11.1. Se necessária, será apresentada documentação de qualificação.' }, { id: 'R1', declarada: true, documento: 'Resposta declarada', texto: 'Resposta declarada: os documentos e prazos serão confirmados.' }] };
  const b = { ...body, questionamento: 'Esclarecer os itens 10.1 e 11.1.', fase: 'resposta_orgao' };
  const schema = schemaDefesa(c, b);
  const t = prepararTransporte(mensagensDefesa(c, b), schema);
  assert.deepEqual(t.schema.properties.ancoras.required, ['A1', 'A2']);
  const dados = { ancoras: { A1: ponto, A2: { tipo: 'especificar_documentos', fontes: ['F2'], fundamentos: [] } }, resposta: { tipo: 'analisar_resposta_incompleta', fontes: ['R1', 'F1', 'F2'], fundamentos: [] } };
  const interno = { ancoras: { '10.1': dados.ancoras.A1, '11.1': dados.ancoras.A2 }, pontos: [], resposta: dados.resposta };
  assert.equal(diagnosticarAnalise(traduzirTransporte(JSON.stringify(dados), schema), c, b).motivo, diagnosticarAnalise(JSON.stringify(interno), c, b).motivo);
  delete dados.ancoras.A2;
  assert.equal(traduzirTransporte(JSON.stringify(dados), schema), null);
  dados.ancoras.A2 = { tipo: 'especificar_documentos', fontes: ['F1'], fundamentos: [] };
  assert.equal(diagnosticarAnalise(traduzirTransporte(JSON.stringify(dados), schema), c, b).analise, null);
});

test('handler transporta âncora de pagamento e continua bloqueando geração histórica malformada sem retry', async () => {
  const { executarDefesa } = require('../_defesa_handler');
  const { createHash } = require('node:crypto');
  const textoEdital = `--- TR ---\n[Página 3]\nLei 14.133/2021.\n${ctx.fontes[0].texto}`;
  const pedido = { ...body, hashFonte: createHash('sha256').update(textoEdital).digest('hex') };
  let chamadas = 0;
  const deps = { sessao: { ok: true, userId: 'qa' }, env: { DEFESA_IA_GRATUITA_CONFIRMADA: 'true', GROQ_API_KEY: 'fixture' }, carregar: async () => ({ versao: 17, fonteLida: true, textoEdital, estrutura: { identificacao: { modalidade: 'Dispensa' } } }), autorizar: async () => ({ ok: true }), chamar: async (_, mensagens, schema) => {
    chamadas++;
    assert.deepEqual(schema.properties.ancoras.required, ['A1']);
    assert.equal(schema.properties.pontos, undefined);
    const fonte = JSON.parse(mensagens[1].content).ancorasObrigatorias[0].fontesPermitidas[0];
    return { ok: true, texto: JSON.stringify({ ancoras: { A1: { ...ponto, fontes: [fonte] } } }) };
  } };
  assert.equal((await executarDefesa(pedido, deps)).statusCode, 200);
  assert.equal(chamadas, 1);
  const historico = require('../../../docs/qa/pacote-ia-positivos-20261023/caso-2-real-9883427e-e49d-4795-bed2-1e20c0ca832c.json');
  const bruto = historico.chamadas[0].erroProvedor.failed_generation;
  assert.throws(() => JSON.parse(bruto), SyntaxError);
  const resultado = await executarDefesa(pedido, { ...deps, chamar: async () => { chamadas++; return { ok: true, texto: bruto }; } });
  assert.equal(resultado.statusCode, 502);
  assert.equal(chamadas, 2);
});
