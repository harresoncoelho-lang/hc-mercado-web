const { test } = require("node:test");
const assert = require("node:assert/strict");
const { origemPermitida } = require("../_auth");
const { verificarLimiteDiario } = require("../_auth");

test('IA bloqueia cota indisponível, configuração ausente ou contagem inválida sem revelar erro privado', async () => {
  const fetchAnterior = global.fetch, chaveAnterior = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'teste-local';
    const respostas = [
      async () => new Response('{}', { status: 503 }),
      async () => { throw new Error('segredo-rede'); },
      async () => { throw new globalThis.DOMException('tempo-esgotado', 'TimeoutError'); },
      async () => new Response('JSON inválido'),
      ...[null, {}, '1', -1, 1.5, 0].map((valor) => async () => new Response(JSON.stringify(valor))),
    ];
    for (const resposta of respostas) {
      global.fetch = resposta;
      const r = await verificarLimiteDiario('usuario', 'ia-edital', 40);
      assert.equal(r.ok, false); assert.equal(r.status, 503);
      assert.match(r.erro, /tente novamente/i); assert.doesNotMatch(r.erro, /segredo|tempo-esgotado|JSON/);
    }
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    global.fetch = () => { throw new Error('Não deve consultar sem configuração'); };
    assert.equal((await verificarLimiteDiario('usuario', 'ia-edital', 40)).status, 503);
  } finally {
    global.fetch = fetchAnterior;
    if (chaveAnterior === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = chaveAnterior;
  }
});

test('IA mantém limite 40 e prazo de consulta; indisponibilidade de outras funções preserva comportamento', async () => {
  const fetchAnterior = global.fetch, chaveAnterior = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'teste-local';
    for (const n of [1, 40, 41]) {
      global.fetch = async (_, opcoes) => { assert(opcoes.signal instanceof globalThis.AbortSignal); return new Response(JSON.stringify(n)); };
      const r = await verificarLimiteDiario('usuario', 'ia-edital', 40);
      assert.equal(r.ok, n <= 40); if (n === 41) assert.equal(r.status, 429);
    }
    global.fetch = async () => new Response('{}', { status: 503 });
    for (const nome of ['enviar_resumo_edital', 'enviar_duvida', 'sancoes', 'despesas-fornecedor']) assert.equal((await verificarLimiteDiario('usuario', nome, 20)).ok, true);
  } finally {
    global.fetch = fetchAnterior;
    if (chaveAnterior === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = chaveAnterior;
  }
});

test("origemPermitida retorna a própria origem quando está na allowlist", () => {
  const event = { headers: { origin: "https://licitaplena.com.br" } };
  assert.equal(origemPermitida(event), "https://licitaplena.com.br");
});

test("origemPermitida cai para a primeira origem permitida quando a origem não está na allowlist", () => {
  const event = { headers: { origin: "https://site-malicioso.com" } };
  assert.equal(origemPermitida(event), "https://licitaplena.com.br");
});

test("origemPermitida cai para a primeira origem permitida quando não há header de origin", () => {
  const event = { headers: {} };
  assert.equal(origemPermitida(event), "https://licitaplena.com.br");
});

test('auth diferencia sessão inválida de indisponibilidade sem liberar acesso', async () => {
  const { exigirUsuarioLogado } = require('../_auth');
  const anterior = global.fetch;
  try {
    for (const status of [401, 403, 429, 500, 503]) {
      global.fetch = async () => ({ ok: false, status });
      const resultado = await exigirUsuarioLogado({ headers: { authorization: 'Bearer teste' } });
      assert.equal(resultado.ok, false);
      assert.equal(resultado.status, status === 401 || status === 403 ? 401 : 503);
    }
    global.fetch = async () => { throw new Error('rede-segredo'); };
    const resultado = await exigirUsuarioLogado({ headers: { authorization: 'Bearer teste' } });
    assert.equal(resultado.status, 503); assert.doesNotMatch(resultado.erro, /rede-segredo/);
  } finally { global.fetch = anterior; }
});

test('monte-busca-ia falha fechado como ia-edital (sem chave, RPC fora, contagem inválida)', async () => {
  const fetchAnterior = global.fetch, chaveAnterior = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'teste-local';
    for (const resp of [async () => new Response('{}', { status: 503 }), async () => { throw new Error('x'); }, async () => new Response('"1"')]) {
      global.fetch = resp;
      assert.equal((await verificarLimiteDiario('usuario', 'monte-busca-ia', 30)).status, 503);
    }
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.equal((await verificarLimiteDiario('usuario', 'monte-busca-ia', 30)).status, 503);
  } finally {
    global.fetch = fetchAnterior;
    if (chaveAnterior === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = chaveAnterior;
  }
});

// Teste de ataque 19/11 (M5): proxies públicos com teto diário por IP.
test('limitarPorIp: só IP da plataforma conta, banco recebe HMAC (nunca o IP), 429 acima do teto e fail-open', async () => {
  const { limitarPorIp } = require("../_auth");
  const fetchAnterior = global.fetch, chaveAnterior = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const chamadas = [];
  try {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'teste-local';
    let contagem = 1;
    global.fetch = async (url, op) => { chamadas.push({ url, corpo: JSON.parse(op.body) }); return new Response(JSON.stringify(contagem)); };
    const evento = ip => ({ headers: { "x-nf-client-connection-ip": ip, "cf-connecting-ip": "10.9.9.9" } });
    assert.deepEqual(await limitarPorIp(evento('203.0.113.7'), 'pncp-proxy', 2), { ok: true });
    assert.match(chamadas[0].url, /\/rpc\/incrementar_uso_ip$/);
    assert.match(chamadas[0].corpo.p_chave, /^[0-9a-f]{64}$/); assert.equal(chamadas[0].corpo.p_funcao, 'pncp-proxy');
    assert.doesNotMatch(JSON.stringify(chamadas), /203\.0\.113\.7/);
    await limitarPorIp(evento('203.0.113.8'), 'pncp-proxy', 2);
    assert.notEqual(chamadas[1].corpo.p_chave, chamadas[0].corpo.p_chave);
    contagem = 3;
    const r = await limitarPorIp(evento('203.0.113.7'), 'pncp-proxy', 2);
    assert.equal(r.ok, false); assert.equal(r.status, 429);
    // Sem IP confiável (cf-connecting-ip fora do Workers não vale) ou sem chave: não consulta.
    const antes = chamadas.length;
    assert.equal((await limitarPorIp({ headers: { "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "1.2.3.4" } }, 'pncp-proxy', 2)).ok, true);
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.equal((await limitarPorIp(evento('203.0.113.7'), 'pncp-proxy', 2)).ok, true);
    assert.equal(chamadas.length, antes);
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'teste-local';
    global.fetch = async () => { throw new Error('rede'); };
    assert.equal((await limitarPorIp(evento('203.0.113.7'), 'pncp-proxy', 2)).ok, true);
  } finally {
    global.fetch = fetchAnterior;
    if (chaveAnterior === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = chaveAnterior;
  }
});

test('B2: origem antiga do Netlify não é mais confiável', () => {
  assert.equal(origemPermitida({ headers: { origin: 'https://hc-mercado-web.netlify.app' } }), 'https://licitaplena.com.br');
});
