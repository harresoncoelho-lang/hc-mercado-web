const { test } = require("node:test");
const assert = require("node:assert/strict");
const { handler } = require("../admin-excluir-cliente");

const adminId = "11111111-1111-4111-8111-111111111111";
const clienteId = "22222222-2222-4222-8222-222222222222";
const token = `a.${Buffer.from(JSON.stringify({ aal: "aal2" })).toString("base64url")}.c`;
const event = (acao, confirmarEmail) => ({
  httpMethod: "POST",
  headers: { authorization: `Bearer ${token}`, origin: "https://licitaplena.com.br" },
  body: JSON.stringify({ id: clienteId, acao, confirmarEmail }),
});
const resposta = (data, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => data, text: async () => data == null ? "" : JSON.stringify(data),
});

function mockServico({ membro = false } = {}) {
  const chamadas = [];
  global.fetch = async (url, options = {}) => {
    chamadas.push({ url, method: options.method || "GET" });
    if (url.endsWith("/auth/v1/user")) return resposta({ id: adminId, email: "dono@exemplo.com" });
    if (url.includes("/rest/v1/admins?")) return resposta(url.includes("dono%40exemplo.com") ? [{ email: "dono@exemplo.com", role: "owner" }] : []);
    if (url.includes("/rest/v1/clientes?") && options.method !== "DELETE") return resposta([{ id: clienteId, email: "cliente@exemplo.com", nome: "Cliente" }]);
    if (url.includes("/rest/v1/operacao_organizacoes?")) return resposta([]);
    if (url.includes("/rest/v1/operacao_membros?")) return resposta(membro ? [{ id: clienteId }] : []);
    if (url.includes("/auth/v1/admin/users/") && options.method === "DELETE") return resposta(null, 204);
    if (url.includes("/rest/v1/clientes?") && options.method === "DELETE") return resposta(null, 204);
    throw new Error(`Chamada inesperada: ${url}`);
  };
  return chamadas;
}

test("exclusão recusa ambiente sem chave administrativa", async () => {
  const antiga = process.env.SUPABASE_SERVICE_ROLE_KEY, antigoFetch = global.fetch;
  mockServico();
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const result = await handler(event("excluir", "cliente@exemplo.com"));
    assert.equal(result.statusCode, 503);
  } finally {
    global.fetch = antigoFetch;
    if (antiga === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = antiga;
  }
});

test("prévia bloqueia conta com vínculo operacional sem chamar exclusão", async () => {
  const antigaChave = process.env.SUPABASE_SERVICE_ROLE_KEY, antigoFetch = global.fetch;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-teste";
  const chamadas = mockServico({ membro: true });
  try {
    const result = await handler(event("verificar"));
    assert.equal(result.statusCode, 200);
    assert.equal(JSON.parse(result.body).podeExcluir, false);
    assert.equal(chamadas.some(c => c.url.includes("/auth/v1/admin/users/") && c.method === "DELETE"), false);
  } finally {
    global.fetch = antigoFetch;
    if (antigaChave === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = antigaChave;
  }
});

test("exclusão exige confirmação exata do e-mail", async () => {
  const antigaChave = process.env.SUPABASE_SERVICE_ROLE_KEY, antigoFetch = global.fetch;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-teste";
  const chamadas = mockServico();
  try {
    const result = await handler(event("excluir", "outro@exemplo.com"));
    assert.equal(result.statusCode, 400);
    assert.equal(chamadas.some(c => c.url.includes("/auth/v1/admin/users/") && c.method === "DELETE"), false);
  } finally {
    global.fetch = antigoFetch;
    if (antigaChave === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = antigaChave;
  }
});

test("exclusão de cadastro sem vínculos remove a conta de login", async () => {
  const antigaChave = process.env.SUPABASE_SERVICE_ROLE_KEY, antigoFetch = global.fetch;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-teste";
  const chamadas = mockServico();
  try {
    const result = await handler(event("excluir", "cliente@exemplo.com"));
    assert.equal(result.statusCode, 200);
    assert.equal(JSON.parse(result.body).ok, true);
    assert.equal(chamadas.filter(c => c.url.includes("/auth/v1/admin/users/") && c.method === "DELETE").length, 1);
  } finally {
    global.fetch = antigoFetch;
    if (antigaChave === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = antigaChave;
  }
});
