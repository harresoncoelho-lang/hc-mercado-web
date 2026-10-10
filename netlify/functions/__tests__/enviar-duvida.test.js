const test = require("node:test");
const assert = require("node:assert/strict");

const { handler } = require("../enviar-duvida");

const SUPABASE = "https://lsqjamqvmrcyrvowndiu.supabase.co";
const evento = (corpo, extra = {}) => ({ httpMethod: "POST", headers: { authorization: "Bearer tok", origin: "https://licitaplena.pages.dev" }, body: JSON.stringify(corpo), ...extra });
const valido = { nome: "Maria", email: "maria@empresa.com.br", mensagem: "Como cadastro minha certidão?" };

// Simula sessão válida (Supabase), cota livre (sem service key) e o ZeptoMail; devolve as chamadas ao e-mail.
async function comFetch(fn, { logado = true, zepto = { ok: true, status: 200, text: async () => "" } } = {}) {
  const original = global.fetch;
  const envAntes = { ...process.env };
  const emails = [];
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.ZEPTOMAIL_TOKEN = "chave-teste";
  delete process.env.EMAIL_DUVIDAS;
  global.fetch = async (url, opcoes) => {
    if (String(url).startsWith(SUPABASE)) return logado ? { ok: true, status: 200, json: async () => ({ id: "u1", email: "x@y.z" }) } : { ok: false, status: 401, json: async () => ({}) };
    emails.push({ url, corpo: JSON.parse(opcoes.body) });
    return zepto;
  };
  try { return await fn(emails); } finally { global.fetch = original; process.env = envAntes; }
}

test("sem sessão válida recusa com 401 e não envia e-mail", async () => {
  await comFetch(async (emails) => {
    const r = await handler(evento(valido, { headers: {} }));
    assert.equal(r.statusCode, 401);
    assert.equal(emails.length, 0);
  });
  await comFetch(async (emails) => {
    const r = await handler(evento(valido));
    assert.equal(r.statusCode, 401);
    assert.equal(emails.length, 0);
  }, { logado: false });
});

test("só aceita POST e responde preflight", async () => {
  assert.equal((await handler({ httpMethod: "GET", headers: {} })).statusCode, 405);
  const opcoes = await handler({ httpMethod: "OPTIONS", headers: { origin: "https://licitaplena.pages.dev" } });
  assert.equal(opcoes.statusCode, 204);
  assert.equal(opcoes.headers["Access-Control-Allow-Origin"], "https://licitaplena.pages.dev");
});

test("valida nome, e-mail e mensagem", async () => {
  await comFetch(async (emails) => {
    for (const ruim of [{ ...valido, nome: "  " }, { ...valido, email: "sem-arroba" }, { ...valido, mensagem: "" }]) {
      assert.equal((await handler(evento(ruim))).statusCode, 400);
    }
    assert.equal((await handler({ ...evento(valido), body: "{quebrado" })).statusCode, 400);
    assert.equal(emails.length, 0);
  });
});

test("honeypot preenchido responde sucesso sem enviar", async () => {
  await comFetch(async (emails) => {
    const r = await handler(evento({ ...valido, "duvida-empresa": "Robo SA" }));
    assert.equal(r.statusCode, 200);
    assert.equal(emails.length, 0);
  });
});

test("envia ao destino padrão, com reply_to do cliente, limitando tamanho e removendo quebras do nome", async () => {
  await comFetch(async (emails) => {
    const r = await handler(evento({ ...valido, nome: "Maria\r\nBcc: x", mensagem: "a".repeat(9000) }));
    assert.equal(r.statusCode, 200);
    assert.equal(emails.length, 1);
    const { corpo } = emails[0];
    assert.equal(corpo.to[0].email_address.address, "licitaplena@licitaplena.com.br");
    assert.equal(corpo.reply_to[0].address, "maria@empresa.com.br");
    assert.ok(!/[\r\n]/.test(corpo.subject));
    assert.ok(corpo.textbody.length < 5300);
  });
});

test("EMAIL_DUVIDAS define o destino; sem token de e-mail devolve 503", async () => {
  await comFetch(async (emails) => {
    process.env.EMAIL_DUVIDAS = "suporte@exemplo.com";
    assert.equal((await handler(evento(valido))).statusCode, 200);
    assert.equal(emails[0].corpo.to[0].email_address.address, "suporte@exemplo.com");
    process.env.ZEPTOMAIL_TOKEN = "";
    assert.equal((await handler(evento(valido))).statusCode, 503);
  });
});

test("falha do provedor de e-mail vira 502", async () => {
  await comFetch(async () => {
    const r = await handler(evento(valido));
    assert.equal(r.statusCode, 502);
  }, { zepto: { ok: false, status: 500, text: async () => "{}" } });
});
