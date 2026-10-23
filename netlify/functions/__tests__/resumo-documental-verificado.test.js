const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { handler } = require('../lib/ia-edital');
const fonte = '--- Aviso ---\n[Página 1]\nLei14.133/2021. Dispensa eletrônica. Pagamento em dez dias após aceite fiscal.';
const dossie = { versao: 17, versaoValidacao: 17, modoDegradado: true, fonteLida: true, metodoResumo: 'extracao_documental_verificada', textoEdital: fonte,
  estrutura: { identificacao: { modalidade: 'Dispensa' }, coberturaLeitura: { parcial: false, documentosLidos: ['Aviso'], documentosNaoLidos: [] } } };

test('HTTP resumo devolve fonte verificada com hash, sem aprovar síntese nem alterar fluxo do robô', async () => {
  const anterior = global.fetch;
  const env = { ...process.env };
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'teste';
  process.env.DOSSIES_EDITAIS_CHAVE = 'robo-teste';
  delete process.env.NETLIFY_BLOBS_CONTEXT;
  const chamadas = [];
  global.fetch = async (url, opcoes = {}) => {
    chamadas.push({ url, method: opcoes.method || 'GET' });
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'cliente' }));
    if (url.includes('/dossies_editais')) return new Response(JSON.stringify([{ dossie, versao: 17 }]));
    if (url.includes('pncp.gov.br')) return new Response('{}', { status: 503 });
    throw Error(`Chamada indevida: ${url}`);
  };
  try {
    const evento = { httpMethod: 'POST', headers: { authorization: 'Bearer teste' }, body: JSON.stringify({ modo: 'resumo', edital: { numeroControlePNCP: '08928517000157-1-000116/2026' }, textoEdital: 'FONTE ADULTERADA' }) };
    const humano = await handler(evento);
    const dados = JSON.parse(humano.body);
    assert.equal(humano.statusCode, 200);
    assert.equal(dados.textoEdital, fonte);
    assert.equal(dados.hashFonte, createHash('sha256').update(fonte).digest('hex'));
    assert.equal(dados.modoDegradado, true);
    assert.equal(dados.metodoResumo, 'extracao_documental_verificada');
    assert.match(dados.aviso, /Síntese de IA pendente/);
    assert.equal(chamadas.some(c => /groq|incrementar_uso|fila_dossies/.test(c.url)), false);
    const robo = await handler({ ...evento, headers: { 'x-licitaplena-dossies-chave': 'robo-teste' } });
    const dadosRobo = JSON.parse(robo.body);
    assert.equal(dadosRobo.dossieEmPreparacao, true);
    assert.equal(dadosRobo.textoEdital, null);
    assert.equal(dadosRobo.hashFonte, undefined);
  } finally {
    global.fetch = anterior;
    for (const chave of Object.keys(process.env)) if (!Object.hasOwn(env, chave)) delete process.env[chave];
    Object.assign(process.env, env);
  }
});
