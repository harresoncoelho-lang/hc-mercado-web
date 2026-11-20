// proposta-lote: só leitura, com o token do usuário; acha o processo por UASG + número/ano; nunca devolve item de outra organização.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { handler } = require("../proposta-lote");

const U = "11111111-1111-4111-8111-111111111111";
const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const EMP = "aaaaaaaa-0000-4000-8000-000000000002";
const P1 = "aaaaaaaa-0000-4000-8000-000000000004";
const P2 = "aaaaaaaa-0000-4000-8000-000000000005";
const I1 = "aaaaaaaa-0000-4000-8000-0000000000a1";
const I2 = "aaaaaaaa-0000-4000-8000-0000000000a2";
const COMPRA = "16013705000332026"; // UASG 160137, pregão 05, número 33, ano 2026

const item = (id, identificador, valor) => ({ id, organizacao_id: ORG, processo_id: P1, identificador, quantidade: "10", valor_unitario_proposta: valor, marca: "Acme", modelo: null, fabricante: "Fab", valor_unitario_minimo: "9.00", numero_ordem: identificador });

function instalar({ processos, itens = [item(I1, "1", "10.00"), item(I2, "2", null)] }) {
  const chamadas = [];
  global.fetch = async (url, op = {}) => {
    const u = new URL(url), h = op.headers || {};
    chamadas.push({ caminho: u.pathname, busca: u.search, auth: h.Authorization, metodo: op.method || "GET" });
    if (u.pathname === "/auth/v1/user") return h.Authorization === "Bearer T" ? Response.json({ id: U }) : new Response("{}", { status: 401 });
    if (u.pathname === "/rest/v1/clientes") return Response.json([{ status: "aprovado" }]);
    if (u.pathname === "/rest/v1/operacao_processos") return Response.json(processos);
    if (u.pathname === "/rest/v1/operacao_itens_resultado") {
      const pid = u.searchParams.get("processo_id").slice(3); // a RLS devolve só linhas do processo pedido
      const linhas = itens.map((i) => ({ ...i, processo_id: pid }));
      return new Response(JSON.stringify(linhas), { headers: { "content-type": "application/json", "content-range": `0-${itens.length - 1}/${itens.length}`, "preference-applied": "count=exact" } });
    }
    return new Response("{}", { status: 404 });
  };
  return chamadas;
}
const ev = (q = { compra: COMPRA }, headers = { authorization: "Bearer T" }, httpMethod = "GET") => ({ httpMethod, headers, queryStringParameters: q });
async function comFetch(fn) { const a = global.fetch; try { return await fn(); } finally { global.fetch = a; } }
const proc = (id, numero) => ({ id, empresa_id: EMP, organizacao_id: ORG, numero, objeto: "Hortifruti" });

test("sem token, método errado ou compra inválida: recusa sem ler o banco de processos", () => comFetch(async () => {
  const c = instalar({ processos: [] });
  assert.equal((await handler(ev({ compra: COMPRA }, {}))).statusCode, 401);
  assert.equal((await handler(ev({ compra: COMPRA }, undefined, "POST"))).statusCode, 405);
  assert.equal((await handler(ev({ compra: "123" }))).statusCode, 400);
  assert.ok(!c.some((x) => x.caminho === "/rest/v1/operacao_processos"));
}));

test("processo único: devolve só os itens com valor, com o token do usuário e cabeçalho no-store", () => comFetch(async () => {
  const c = instalar({ processos: [proc(P1, "33/2026"), proc(P2, "34/2026")] });
  const r = await handler(ev());
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers["Cache-Control"], "no-store");
  const corpo = JSON.parse(r.body);
  assert.equal(corpo.processo.processoId, P1);
  assert.deepEqual(corpo.itens, [{ item: "1", quantidade: "10", valorUnitario: "10.00", marca: "Acme", modelo: null, fabricante: "Fab", valorMinimo: "9.00" }]);
  assert.ok(c.filter((x) => x.metodo !== "GET").length === 0);
  assert.match(c.find((x) => x.caminho === "/rest/v1/operacao_processos").busca, /uasg=eq\.160137/);
  for (const x of c.filter((y) => y.caminho.startsWith("/rest/"))) assert.equal(x.auth, "Bearer T");
}));

test("número com zeros à esquerda casa; ano ou número diferentes não; nenhum processo: processo null", () => comFetch(async () => {
  instalar({ processos: [proc(P1, "000033/2026")] });
  assert.equal(JSON.parse((await handler(ev())).body).processo.processoId, P1);
  instalar({ processos: [proc(P1, "33/2025"), proc(P2, "pregão 33")] });
  assert.deepEqual(JSON.parse((await handler(ev())).body), { ok: true, compra: COMPRA, processo: null });
}));

test("dois processos da mesma compra: pede escolha; com ?processo devolve o escolhido; processo alheio vira null", () => comFetch(async () => {
  instalar({ processos: [proc(P1, "33/2026"), proc(P2, "33/2026")] });
  assert.equal(JSON.parse((await handler(ev())).body).escolher.length, 2);
  assert.equal(JSON.parse((await handler(ev({ compra: COMPRA, processo: P2 }))).body).processo.processoId, P2);
  assert.equal(JSON.parse((await handler(ev({ compra: COMPRA, processo: "bbbbbbbb-0000-4000-8000-000000000004" }))).body).processo, null);
}));
