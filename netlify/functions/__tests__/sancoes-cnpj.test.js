// /api/sancoes-cnpj: só logado com cadastro aprovado, lê com o token do próprio usuário, CNPJ validado, falha fechado.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { handler } = require("../sancoes-cnpj");

const U = "11111111-1111-4111-8111-111111111111";
const LINHAS = [
  { cadastro: "CEIS", codigo_sancao: "1", cnpj: "11222333000181", data_fim: "2099-01-01", fora_da_lista: false, data_carga: "2026-11-19" },
  { cadastro: "CNEP", codigo_sancao: "2", cnpj: "11222333000181", data_fim: "2020-01-01", fora_da_lista: false, data_carga: "2026-11-18" },
];

let statusCadastro = "aprovado";
async function comFetch(responder, fn) {
  const anterior = global.fetch, chamadas = [];
  global.fetch = async (url, op = {}) => {
    const u = new URL(url);
    chamadas.push({ url: u, auth: op.headers?.Authorization });
    if (u.pathname === "/auth/v1/user") return op.headers.Authorization === "Bearer TOKEN-U" ? Response.json({ id: U }) : new Response("{}", { status: 401 });
    if (u.pathname === "/rest/v1/clientes") return Response.json(u.searchParams.get("id") === `eq.${U}` ? [{ status: statusCadastro }] : []);
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
  assert.equal((await handler(evento("11222333000181", { authorization: "Bearer TOKEN-U" }, "PUT"))).statusCode, 405);
  assert.ok(!chamadas.some((c) => c.url.pathname === "/rest/v1/sancoes_empresas"));
}));

test("cadastro pendente ou suspenso: 403 sem ler a tabela; falha ao conferir: 503", async () => {
  for (const [status, esperado] of [["pendente", 403], ["suspenso", 403]]) {
    statusCadastro = status;
    await comFetch(() => Response.json(LINHAS), async (chamadas) => {
      assert.equal((await handler(evento("11222333000181"))).statusCode, esperado);
      assert.ok(!chamadas.some((c) => c.url.pathname === "/rest/v1/sancoes_empresas"));
    });
  }
  statusCadastro = "aprovado";
  const anterior = global.fetch;
  global.fetch = async (url) => (new URL(url).pathname === "/auth/v1/user" ? Response.json({ id: U }) : new Response("{}", { status: 500 }));
  try { assert.equal((await handler(evento("11222333000181"))).statusCode, 503); } finally { global.fetch = anterior; }
});

test("falha da tabela ou lista no teto: 503 sem cache (nunca 'sem sanção' errado)", async () => {
  for (const responder of [() => new Response("{}", { status: 500 }), () => Response.json(Array.from({ length: 500 }, () => LINHAS[0]))]) {
    await comFetch(responder, async () => {
      const r = await handler(evento("11222333000181"));
      assert.equal(r.statusCode, 503);
      assert.equal(r.headers["Cache-Control"], "no-store");
    });
  }
});

// ---------- consulta em lote (POST {cnpjs}) ----------
const lote = (cnpjs, headers = { authorization: "Bearer TOKEN-U" }) => ({ httpMethod: "POST", headers, body: JSON.stringify({ cnpjs }) });
const B = "11222333000181", C2 = "04252011000110";

test("lote: uma leitura para vários CNPJs, token do usuário, resultado por CNPJ (inclusive sem sanção), sem fundamentação", () => comFetch(() => Response.json(LINHAS), async (chamadas) => {
  statusCadastro = "aprovado";
  const r = await handler(lote(["11.222.333/0001-81", C2, B]));
  assert.equal(r.statusCode, 200);
  const b = JSON.parse(r.body);
  assert.deepEqual(Object.keys(b.resultados).sort(), [C2, B].sort(), "CNPJ repetido entra uma vez");
  assert.deepEqual(b.resultados[B].vigentes.map((s) => s.codigo_sancao), ["1"]);
  assert.deepEqual(b.resultados[B].expiradas.map((s) => s.codigo_sancao), ["2"]);
  assert.deepEqual(b.resultados[C2], { vigentes: [], expiradas: [] });
  assert.match(b.hoje, /^\d{4}-\d{2}-\d{2}$/);
  const leituras = chamadas.filter((c) => c.url.pathname === "/rest/v1/sancoes_empresas");
  assert.equal(leituras.length, 1);
  assert.equal(leituras[0].auth, "Bearer TOKEN-U");
  assert.equal(leituras[0].url.searchParams.get("cnpj"), `in.(${B},${C2})`);
  assert.doesNotMatch(leituras[0].url.searchParams.get("select"), /fundamentacao/);
}));

test("lote: sem login 401, cadastro pendente 403, mais de 200 CNPJs ou CNPJ torto 400 — nada lido", () => comFetch(() => Response.json(LINHAS), async (chamadas) => {
  statusCadastro = "aprovado";
  assert.equal((await handler(lote([B], {}))).statusCode, 401);
  const muitos = Array.from({ length: 201 }, (_, i) => String(10000000000000 + i));
  assert.equal((await handler(lote(muitos))).statusCode, 400);
  assert.equal((await handler(lote([B, "123"]))).statusCode, 400);
  assert.equal((await handler(lote([]))).statusCode, 400);
  assert.equal((await handler({ httpMethod: "POST", headers: { authorization: "Bearer TOKEN-U" }, body: "{" })).statusCode, 400);
  assert.equal((await handler({ httpMethod: "POST", headers: { authorization: "Bearer TOKEN-U" }, body: JSON.stringify({ cnpjs: B }) })).statusCode, 400);
  statusCadastro = "pendente";
  assert.equal((await handler(lote([B]))).statusCode, 403);
  statusCadastro = "aprovado";
  assert.ok(!chamadas.some((c) => c.url.pathname === "/rest/v1/sancoes_empresas"));
}));

test("lote: exatamente 200 CNPJs passa; resposta no teto de linhas falha fechado (503)", async () => {
  statusCadastro = "aprovado";
  const duzentos = Array.from({ length: 200 }, (_, i) => String(10000000000000 + i));
  await comFetch(() => Response.json([]), async () => { assert.equal((await handler(lote(duzentos))).statusCode, 200); });
  const cheia = Array.from({ length: 5000 }, () => LINHAS[0]);
  await comFetch(() => Response.json(cheia), async () => { assert.equal((await handler(lote([B]))).statusCode, 503); });
});
