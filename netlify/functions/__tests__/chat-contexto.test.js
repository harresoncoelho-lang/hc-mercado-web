const test = require("node:test");
const assert = require("node:assert/strict");
const { handler } = require("../lib/ia-edital");

async function perguntar({ dossie, numero = "04285896000153-1-000061/2026", textoEdital = null, hashFonte = null, pergunta = "Qual o prazo de entrega?", conteudo, finalizacao = "stop" }) {
  const originalFetch = global.fetch;
  const anteriores = { ...process.env };
  process.env.SUPABASE_SERVICE_ROLE_KEY = "servico-teste";
  process.env.GROQ_API_KEY = "groq-teste";
  delete process.env.NETLIFY_BLOBS_CONTEXT;
  const chamadas = [];
  global.fetch = async (url, opcoes = {}) => {
    chamadas.push({ url, body: opcoes.body && JSON.parse(opcoes.body) });
    const resposta = (corpo) => new Response(JSON.stringify(corpo));
    if (url.includes("/auth/v1/user")) return resposta({ id: "usuario-teste" });
    if (url.includes("/rest/v1/dossies_editais")) return resposta(dossie ? [{ dossie, versao: 17 }] : []);
    if (url.includes("/rpc/incrementar_uso")) return resposta(1);
    if (url.includes("api.groq.com")) {
      let padrao = 'Entrega em 10 dias [Edital, página 2].';
      try { const f = JSON.parse(JSON.parse(opcoes.body).messages.at(-1).content).fontes[0]; padrao = JSON.stringify({ naoLocalizado: false, evidencias: [{ id: f.id, trecho: f.texto }] }); } catch (_) { /* Protocolo anterior, para comprovar regressão. */ }
      return resposta({ choices: [{ message: { content: conteudo === undefined ? padrao : conteudo }, finish_reason: finalizacao }] });
    }
    throw new Error(`Rede não prevista: ${url}`);
  };
  try {
    const resposta = await handler({ httpMethod: "POST", headers: { authorization: "Bearer usuario-teste" },
      body: JSON.stringify({ modo: "pergunta", edital: { numeroControlePNCP: numero, objeto: "OBJETO ADULTERADO" }, textoEdital, hashFonte, pergunta }) });
    return { resposta, corpo: JSON.parse(resposta.body), chamadas };
  } finally {
    global.fetch = originalFetch;
    for (const chave of Object.keys(process.env)) if (!Object.hasOwn(anteriores, chave)) delete process.env[chave];
    Object.assign(process.env, anteriores);
  }
}

const dossie = { versao: 17, fonteLida: true, textoEdital: "--- Edital ---\n[Página 2]\n7. Entrega em 10 dias após ordem de fornecimento.", estrutura: { identificacao: { objeto: "Materiais permanentes" } } };

test("pergunta após cache local recupera fonte canônica sem aceitar PDF ou ficha do navegador", async () => {
  const r = await perguntar({ dossie, textoEdital: "FONTE ADULTERADA: entrega em 99 dias." });
  assert.equal(r.resposta.statusCode, 200);
  const pedido = r.chamadas.find((c) => c.url.includes("api.groq.com"));
  assert.match(JSON.stringify(pedido.body), /Entrega em 10 dias/);
  assert.doesNotMatch(JSON.stringify(pedido.body), /ADULTERAD|99 dias/);
  assert.equal(r.corpo.fonteLida, true);
});

test('aviso de leitura parcial é acrescentado pela aplicação mesmo sem a IA repeti-lo', async () => {
  const r = await perguntar({ dossie: { ...dossie, estrutura: { ...dossie.estrutura, coberturaLeitura: { parcial: true } } } });
  assert.equal(r.resposta.statusCode, 200);
  assert.match(r.corpo.resposta, /leitura.*parcial/i);
});

test('pagamento mantém regras por fonte mesmo diante da resposta real que trocou TR e minuta', async () => {
  const fonte = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../../docs/qa/fonte-jutai-selecionada.txt'), 'utf8');
  const real = require('../../../docs/qa/groq-real-resultados.json').resultados.find((r) => r.caso === 'pagamento').resposta;
  const r = await perguntar({ dossie: { ...dossie, textoEdital: fonte }, pergunta: 'Compare os prazos de pagamento e liquidação.', conteudo: real });
  assert.equal(r.resposta.statusCode, 200);
  assert.match(r.corpo.resposta.replace(/\n/g, ' '), /30 \(trinta\) dias[^[]+\[Minuta.pdf, página 30, cláusula 7.3.1\]/);
  assert.match(r.corpo.resposta.replace(/\n/g, ' '), /10 \(dez\) dias úteis[^[]+\[TR.pdf, página 14, cláusula 7.17\]/);
  assert.match(r.corpo.resposta, /regularidade fiscal/);
  assert.doesNotMatch(r.corpo.resposta, /O Termo de Referência prevê um prazo de pagamento de 30 dias/);
  assert.equal(r.chamadas.filter((c) => c.url.includes('api.groq.com')).length, 0);
});

test('citação inventada e texto livre da IA não viram resposta documental', async () => {
  for (const conteudo of [JSON.stringify({ naoLocalizado: false, evidencias: [{ id: 'F1', trecho: 'Entrega em 99 dias' }] }),
    JSON.stringify({ naoLocalizado: false, evidencias: [{ id: 'F99', trecho: 'Entrega em 10 dias' }] }), 'Entrega em 99 dias [Minuta, página 999].']) {
    const r = await perguntar({ dossie, conteudo });
    assert.equal(r.resposta.statusCode, 502);
    assert.match(r.corpo.erro, /validar|conferir/i);
    assert.equal(r.chamadas.filter((c) => c.url.includes('api.groq.com')).length, 1);
  }
});

test('saída vazia ou truncada nunca é exibida como resposta bem sucedida', async () => {
  for (const entrada of [{ conteudo: '' }, { conteudo: '   ' }, { conteudo: 'Texto incompleto', finalizacao: 'length' }]) {
    const r = await perguntar({ dossie, ...entrada });
    assert.equal(r.resposta.statusCode, 502);
    assert.ok(r.corpo.erro?.trim());
    assert.equal(r.chamadas.filter((c) => c.url.includes('api.groq.com')).length, 1);
  }
});

test('transporte da Groq marca conteúdo vazio como falha, mesmo quando há raciocínio', async () => {
  const anterior = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '', reasoning: 'somente raciocínio' }, finish_reason: 'stop' }] }));
  try {
    const r = await require('../lib/ia-edital').__test.chamarGroq('teste', [], { maxTokens: 100 });
    assert.equal(r.ok, false); assert.match(r.erro, /resposta|conteúdo/i);
  } finally { global.fetch = anterior; }
});

test('retornos reais do novo protocolo atravessam o handler com fonte e aviso verificados', async () => {
  const fs = require('node:fs'), path = require('node:path');
  const fonte = fs.readFileSync(path.join(__dirname, '../../../docs/qa/fonte-jutai-selecionada.txt'), 'utf8');
  for (const nome of ['groq-corrigido-01.json', 'groq-corrigido-02.json']) {
    const real = require(path.join(__dirname, '../../../docs/qa', nome));
    const pedido = require('../../../docs/qa/perguntas-corrigidas-prompts.json').pedidos[real.pedido];
    const pergunta = JSON.parse(pedido.messages.at(-1).content).pergunta;
    const r = await perguntar({ dossie: { ...dossie, textoEdital: fonte, estrutura: { ...dossie.estrutura, coberturaLeitura: { parcial: true } } }, pergunta, conteudo: real.retorno });
    assert.equal(r.resposta.statusCode, 200);
    assert.match(r.corpo.resposta, /leitura.*parcial/i);
    if (real.caso === 'horarios') { assert.match(r.corpo.resposta, /08:00/); assert.match(r.corpo.resposta, /9:00/); assert.match(r.corpo.resposta, /\[Edital.pdf, página 3\]/); }
    else assert.match(r.corpo.resposta, /Não localizei.*não comprova que ela inexista/);
  }
});
test("fonte alterada desde o resumo exige atualização sem consumir cota", async () => {
  const r = await perguntar({ dossie, hashFonte: "fonte-antiga" });
  assert.equal(r.resposta.statusCode, 409);
  assert.equal(r.chamadas.some((c) => /api.groq.com|incrementar_uso/.test(c.url)), false);
});

test("sem fonte canônica não chama IA nem consome cota para responder só com metadados", async () => {
  const r = await perguntar({ textoEdital: "Fonte enviada pelo cliente" });
  assert.equal(r.resposta.statusCode, 409);
  assert.match(r.corpo.erro, /documentos|fonte/i);
  assert.equal(r.chamadas.some((c) => /api.groq.com|incrementar_uso|fila_dossies/.test(c.url)), false);
});

test("identificador inválido e pergunta vazia são recusados antes de consultar IA ou cota", async () => {
  for (const entrada of [{ numero: "invalido" }, { pergunta: "  " }]) {
    const r = await perguntar({ dossie, ...entrada });
    assert.equal(r.resposta.statusCode, 400);
    assert.equal(r.chamadas.some((c) => /api.groq.com|incrementar_uso/.test(c.url)), false);
  }
});
