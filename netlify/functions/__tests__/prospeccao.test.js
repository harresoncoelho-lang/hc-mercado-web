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

test("handler: só cadastro aprovado lê a tabela (pendente 403), com o token do próprio usuário", async () => {
  const anterior = global.fetch;
  for (const [status, esperado] of [["pendente", 403], ["aprovado", 200]]) {
    const lidas = [];
    global.fetch = async (url, op = {}) => {
      const u = new URL(url);
      if (u.pathname === "/auth/v1/user") return Response.json({ id: "u1" });
      if (u.pathname === "/rest/v1/clientes") return Response.json([{ status }]);
      lidas.push(op.headers.Authorization);
      return Response.json([]);
    };
    try {
      const r = await handler({ httpMethod: "GET", headers: { authorization: "Bearer T" }, queryStringParameters: { tipo: "pca" } });
      assert.equal(r.statusCode, esperado);
      assert.deepEqual(lidas, esperado === 200 ? ["Bearer T"] : []);
    } finally { global.fetch = anterior; }
  }
});

test("montarConsulta com nível: início do nome, nome e só especificação (nunca AND solto entre termos)", () => {
  const f = validar({ tipo: "ata", palavras: "papel a4, cafe" });
  const p = (n) => new URL(montarConsulta(f, AGORA, n)).searchParams;
  assert.equal(p("inicio").get("or"), "(busca_nome.ilike.papel a4*,busca_nome.ilike.cafe*)");
  assert.equal(p("inicio").get("and"), null);
  assert.equal(p("nome").get("and"), "(or(busca_nome.ilike.*papel a4*,busca_nome.ilike.*cafe*),not.or(busca_nome.ilike.papel a4*,busca_nome.ilike.cafe*))");
  assert.equal(p("espec").get("and"), "(or(busca.ilike.*papel a4*,busca.ilike.*cafe*),not.or(busca_nome.ilike.*papel a4*,busca_nome.ilike.*cafe*))");
  assert.equal(new URL(montarConsulta(f, AGORA, "espec", 17)).searchParams.get("limit"), "17");
});

test("handler: com palavras consulta nome antes da especificação, marca so_especificacao e respeita o limite", async () => {
  const anterior = global.fetch;
  const consultas = [];
  global.fetch = async (url) => {
    const u = new URL(url);
    if (u.pathname === "/auth/v1/user") return Response.json({ id: "u1" });
    if (u.pathname === "/rest/v1/clientes") return Response.json([{ status: "aprovado" }]);
    const nivel = u.searchParams.get("or") ? "inicio" : /not\.or\(busca_nome\.ilike\.p/.test(u.searchParams.get("and")) ? "nome" : "espec";
    consultas.push(nivel);
    return Response.json([{ id: `${nivel}1`, coletado_em: "2026-11-19" }]);
  };
  try {
    const r = await handler({ httpMethod: "GET", headers: { authorization: "Bearer T" }, queryStringParameters: { tipo: "ata", palavras: "papel a4" } });
    assert.equal(r.statusCode, 200);
    assert.deepEqual(consultas, ["inicio", "nome", "espec"]);
    const { linhas } = JSON.parse(r.body);
    assert.deepEqual(linhas.map((l) => [l.id, !!l.so_especificacao]), [["inicio1", false], ["nome1", false], ["espec1", true]]);
  } finally { global.fetch = anterior; }
});
