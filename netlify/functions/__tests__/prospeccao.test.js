const test = require("node:test");
const assert = require("node:assert/strict");
const { validar, montarConsulta, handler } = require("../prospeccao");

const AGORA = Date.parse("2026-11-19T15:00:00Z"); // 12h em Brasília

test("validar: tipo obrigatório, UF e período fechados, CATMAT só dígitos", () => {
  assert.match(validar({}).erro, /tipo/);
  assert.match(validar({ tipo: "edital" }).erro, /tipo/);
  assert.match(validar({ tipo: "pca", uf: "XX" }).erro, /UF/);
  assert.match(validar({ tipo: "pca", dias: "999" }).erro, /Período/);
  assert.match(validar({ tipo: "pca", catmat: "12a" }).erro, /dígitos/);
  assert.deepEqual(validar({ tipo: "ata", uf: "am", catmat: "269941", dias: "90" }), { tipo: "ata", uf: "AM", palavras: [], catmat: "269941", dias: 90 });
});

test("validar: palavras sem acento e sem sintaxe do PostgREST; curtas e repetidas caem", () => {
  const f = validar({ tipo: "contrato", palavras: "Café, CAFE, ab, limpeza),or=(id.eq.1, papel A4*" });
  assert.deepEqual(f.palavras, ["cafe", "limpeza", "or id eq 1", "papel a4"]);
});

test("montarConsulta: janela hoje..hoje+dias por data_ref, filtros e limite+1", () => {
  const u = new URL(montarConsulta(validar({ tipo: "contrato", uf: "AM", palavras: "limpeza, papel a4", dias: "180" }), AGORA));
  assert.equal(u.searchParams.get("tipo"), "eq.contrato");
  assert.equal(u.searchParams.get("uf"), "eq.AM");
  assert.deepEqual(u.searchParams.getAll("data_ref"), ["gte.2026-11-19", "lte.2027-05-18"]);
  assert.equal(u.searchParams.get("or"), "(busca.ilike.*limpeza*,busca.ilike.*papel a4*)");
  assert.equal(u.searchParams.get("limit"), "201");
});

test("montarConsulta: ata vigente por mais 30 dias, sem teto; sem UF não filtra UF", () => {
  const u = new URL(montarConsulta(validar({ tipo: "ata", catmat: "269941" }), AGORA));
  assert.deepEqual(u.searchParams.getAll("data_ref"), ["gte.2026-12-19"]);
  assert.equal(u.searchParams.get("uf"), null);
  assert.equal(u.searchParams.get("catmat"), "eq.269941");
});

test("handler: sem sessão responde 401 sem tocar a tabela; método errado 405", async () => {
  const sem = await handler({ httpMethod: "GET", headers: {}, queryStringParameters: { tipo: "pca" } });
  assert.equal(sem.statusCode, 401);
  const post = await handler({ httpMethod: "POST", headers: {} });
  assert.equal(post.statusCode, 405);
});
