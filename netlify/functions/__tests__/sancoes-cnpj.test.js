// /api/sancoes-cnpj: só logado, lê com o token do próprio usuário, CNPJ validado, falha fechado.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { handler } = require("../sancoes-cnpj");

const U = "11111111-1111-4111-8111-111111111111";
const LINHAS = [
  { cadastro: "CEIS", codigo_sancao: "1", cnpj: "11222333000181", data_fim: "2099-01-01", fora_da_lista: false, data_carga: "2026-11-19" },
  { cadastro: "CNEP", codigo_sancao: "2", cnpj: "11222333000181", data_fim: "2020-01-01", fora_da_lista: false, data_carga: "2026-11-18" },
];

async function comFetch(responder, fn) {
  const anterior = global.fetch, chamadas = [];
  global.fetch = async (url, op = {}) => {
    const u = new URL(url);
    chamadas.push({ url: u, auth: op.headers?.Authorization });
    if (u.pathname === "/auth/v1/user") return op.headers.Authorization === "Bearer TOKEN-U" ? Response.json({ id: U }) : new Response("{}", { status: 401 });
    return responder(u);
  };
  try { return await fn(chamadas); } finally { global.fetch = anterior; }
}
const evento = (cnpj, headers = { authorization: "Bearer TOKEN-U" }, httpMethod = "GET") => ({ httpMethod, headers, queryStringParameters: cnpj === undefined ? {} : { cnpj } });

test("devolve vigentes e expiradas do CNPJ com o token do usuário e cache privado curto", () => comFetch(() => Response.json(LINHAS), async (chamadas) => {
  const r = await handler(evento("11.222.333/0001-81"));
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers["Cache-Control"], "private, max-age=300");
  const b = JSON.parse(r.body);
  assert.equal(b.cnpj, "11222333000181");
  assert.deepEqual(b.vigentes.map((s) => s.codigo_sancao), ["1"]);
  assert.deepEqual(b.expiradas.map((s) => s.codigo_sancao), ["2"]);
  assert.equal(b.cargaEm, "2026-11-19");
  const rest = chamadas.find((c) => c.url.pathname === "/rest/v1/sancoes_empresas");
  assert.equal(rest.auth, "Bearer TOKEN-U");
  assert.equal(rest.url.searchParams.get("cnpj"), "eq.11222333000181");
}));

test("sem login, CNPJ inválido ou método errado: recusa sem ler a tabela", () => comFetch(() => Response.json(LINHAS), async (chamadas) => {
  assert.equal((await handler(evento("11222333000181", {}))).statusCode, 401);
  assert.equal((await handler(evento("123"))).statusCode, 400);
  assert.equal((await handler(evento(undefined))).statusCode, 400);
  assert.equal((await handler(evento("11222333000181", { authorization: "Bearer TOKEN-U" }, "POST"))).statusCode, 405);
  assert.ok(!chamadas.some((c) => c.url.pathname.startsWith("/rest/")));
}));

test("falha da tabela ou lista no teto: 503 sem cache (nunca 'sem sanção' errado)", async () => {
  for (const responder of [() => new Response("{}", { status: 500 }), () => Response.json(Array.from({ length: 500 }, () => LINHAS[0]))]) {
    await comFetch(responder, async () => {
      const r = await handler(evento("11222333000181"));
      assert.equal(r.statusCode, 503);
      assert.equal(r.headers["Cache-Control"], "no-store");
    });
  }
});
