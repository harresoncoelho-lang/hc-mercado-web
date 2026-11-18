const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const { handler } = require("../portal-cliente-links");

const USUARIO = "f4000000-0000-4000-8000-000000000001";
const EMPRESA = "f4000000-0000-4000-8000-00000000001a";
const PROCESSO = "f4000000-0000-4000-8000-00000000002a";
const LINK = "f4000000-0000-4000-8000-000000000041";

const evento = (corpo, { origin = "https://licitaplena.pages.dev", auth = "Bearer sessao-teste" } = {}) => ({
  httpMethod: "POST",
  headers: { origin, ...(auth ? { authorization: auth } : {}) },
  body: JSON.stringify(corpo),
});

// Simula Supabase: /auth/v1/user valida a sessão, /rest/v1/rpc/* e /rest/v1/<tabela> respondem conforme o mapa.
async function comSupabase(fn, { rpc = { status: 200, dados: { id: LINK, expira_em: "2026-12-18T00:00:00Z" } }, status = "aprovado" } = {}) {
  const original = global.fetch;
  const envAntes = { ...process.env };
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-teste";
  const chamadas = [];
  global.fetch = async (url, opcoes = {}) => {
    const u = String(url);
    chamadas.push({ url: u, opcoes, corpo: opcoes.body ? JSON.parse(opcoes.body) : null });
    if (u.includes("/auth/v1/user")) return { ok: true, status: 200, json: async () => ({ id: USUARIO }) };
    if (u.includes("/rest/v1/rpc/")) return { ok: rpc.status < 400, status: rpc.status, json: async () => rpc.dados };
    if (u.includes("/rest/v1/clientes?")) return { ok: true, status: 200, json: async () => (status ? [{ status }] : []) };
    return { ok: true, status: 200, json: async () => [] };
  };
  try { return await fn(chamadas); } finally { global.fetch = original; process.env = envAntes; }
}

const criar = (extra = {}) => ({ acao: "criar", empresaId: EMPRESA, processoId: PROCESSO, rotulo: "Cliente QA", dias: 30, mostrarMinimo: false, ...extra });

test("sem sessão responde 401 sem chamar o banco", async () => {
  await comSupabase(async (chamadas) => {
    const r = await handler(evento(criar(), { auth: null }));
    assert.equal(r.statusCode, 401);
    assert.equal(chamadas.length, 0);
  });
});

test("criar: token base64url de 43 caracteres, só o sha256 vai à RPC, link uma vez", async () => {
  await comSupabase(async (chamadas) => {
    const r = await handler(evento(criar()));
    assert.equal(r.statusCode, 200);
    const corpo = JSON.parse(r.body);
    const m = corpo.link.match(/^https:\/\/licitaplena\.com\.br\/cliente#t=([A-Za-z0-9_-]+)$/);
    assert.ok(m, corpo.link);
    const token = m[1];
    assert.equal(token.length, 43);
    assert.equal(corpo.expiraEm, "2026-12-18T00:00:00Z");
    const chamada = chamadas.find((c) => c.url.endsWith("/rest/v1/rpc/criar_link_cliente"));
    assert.equal(chamada.corpo.p_token_hash, createHash("sha256").update(token).digest("hex"));
    assert.ok(!chamada.opcoes.body.includes(token));
    assert.deepEqual(chamada.corpo, { p_usuario: USUARIO, p_empresa: EMPRESA, p_processo: PROCESSO, p_token_hash: chamada.corpo.p_token_hash, p_rotulo: "Cliente QA", p_dias: 30, p_mostrar_minimo: false });
    const outro = JSON.parse((await handler(evento(criar()))).body).link;
    assert.notEqual(outro, corpo.link);
  });
});

test("o link usa só origem da allowlist", async () => {
  await comSupabase(async () => {
    const r = await handler(evento(criar(), { origin: "https://site-malicioso.example" }));
    assert.match(JSON.parse(r.body).link, /^https:\/\/licitaplena\.com\.br\/cliente#t=/);
    assert.equal(r.headers["Access-Control-Allow-Origin"], "https://licitaplena.com.br");
    assert.equal(r.headers["Cache-Control"], "no-store");
  });
});

test("uuid inválido ou dados fora do contrato respondem 400 sem RPC", async () => {
  await comSupabase(async (chamadas) => {
    for (const corpo of [
      criar({ empresaId: "x" }), criar({ processoId: "1; drop" }), criar({ dias: 0 }), criar({ dias: 61 }),
      criar({ rotulo: " a " }), criar({ mostrarMinimo: "sim" }),
      { acao: "listar", processoId: "nao-uuid" }, { acao: "revogar", linkId: "" }, { acao: "apagar" },
    ]) assert.equal((await handler(evento(corpo))).statusCode, 400, JSON.stringify(corpo));
    assert.ok(!chamadas.some((c) => c.url.includes("/rest/v1/")));
  });
});

test("erros da RPC: PT403, PT409 e falha genérica", async () => {
  for (const [code, status, esperado] of [["PT403", 403, 403], ["PT409", 409, 409], ["PT400", 400, 400], ["XX000", 500, 503]]) {
    await comSupabase(async () => {
      assert.equal((await handler(evento(criar()))).statusCode, esperado, code);
    }, { rpc: { status, dados: { code } } });
  }
});

test("revogar chama a RPC com usuário e link", async () => {
  await comSupabase(async (chamadas) => {
    const r = await handler(evento({ acao: "revogar", linkId: LINK }));
    assert.equal(r.statusCode, 200);
    const c = chamadas.find((x) => x.url.endsWith("/rest/v1/rpc/revogar_link_cliente"));
    assert.deepEqual(c.corpo, { p_usuario: USUARIO, p_link: LINK });
  }, { rpc: { status: 200, dados: { id: LINK, revogado_em: "2026-11-18T12:00:00Z" } } });
});

test("listar lê com o token do usuário e nunca pede colunas de hash", async () => {
  await comSupabase(async (chamadas) => {
    const r = await handler(evento({ acao: "listar", processoId: PROCESSO }));
    assert.equal(r.statusCode, 200);
    assert.deepEqual(JSON.parse(r.body), { links: [], aceites: [], auditoria: [] });
    const leituras = chamadas.filter((c) => c.url.includes("/rest/v1/") && !c.url.includes("/rpc/") && !c.url.includes("/clientes?"));
    assert.equal(leituras.length, 3);
    for (const c of leituras) {
      assert.equal(c.opcoes.headers.Authorization, "Bearer sessao-teste");
      assert.ok(!c.opcoes.headers.apikey.includes("chave-teste"));
      assert.ok(!/token_hash|ip_hash/.test(c.url), c.url);
      assert.ok(c.url.includes(`processo_id=eq.${PROCESSO}`));
    }
  });
});

test("o link usa a origem canônica mesmo vindo de outra origem da allowlist (ex.: netlify.app antigo)", async () => {
  await comSupabase(async () => {
    const r = await handler(evento(criar(), { origin: "https://hc-mercado-web.netlify.app" }));
    assert.match(JSON.parse(r.body).link, /^https:\/\/licitaplena\.com\.br\/cliente#t=/);
  });
});

test("listar: cadastro não aprovado (suspenso com JWT válido) recebe 403 sem ler links nem aceites", async () => {
  for (const status of ["suspenso", "pendente", null]) {
    await comSupabase(async (chamadas) => {
      const r = await handler(evento({ acao: "listar", processoId: PROCESSO }));
      assert.equal(r.statusCode, 403);
      assert.ok(!chamadas.some((c) => /operacao_(links_cliente|aceites_item|portal_auditoria)/.test(c.url)));
    }, { status });
  }
});
