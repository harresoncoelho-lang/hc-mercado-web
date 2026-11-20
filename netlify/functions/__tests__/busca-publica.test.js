const test = require("node:test");
const assert = require("node:assert/strict");

const { handler } = require("../busca-publica");

const evento = (q, extra = {}) => ({ httpMethod: "GET", headers: { origin: "https://licitaplena.pages.dev" }, queryStringParameters: q, ...extra });

// Linha como o PostgREST devolve para o select da função (sem a coluna "dado" inteira).
const linha = (n) => ({
  numero_controle_pncp: `04477782000105-1-0000${n}/2026`,
  objeto: `Aquisição de uniformes ${n}`,
  uf: "AM",
  publicacao: "2026-11-10",
  encerramento: "2026-12-01",
  orgao: "Prefeitura Exemplo",
  municipio: "Manaus",
  modalidade: "Pregão - Eletrônico",
  valor: "184320.5",
  ...(n === 1 ? { usuario_nome: "BLL Compras", link_sistema_origem: "https://bllcompras.com/Process/ProcessView?param1=1" } : {}),
});

async function comFetch(fn, { chave = "chave-teste", resposta } = {}) {
  const original = global.fetch;
  const envAntes = { ...process.env };
  const chamadas = [];
  if (chave) process.env.SUPABASE_SERVICE_ROLE_KEY = chave; else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  global.fetch = async (url, opcoes) => {
    chamadas.push({ url: String(url), opcoes });
    return resposta || { ok: true, status: 200, json: async () => Array.from({ length: 9 }, (_, i) => ({ ...linha(i + 1), email: "x@y.z", dado: { segredo: 1 } })) };
  };
  try { return await fn(chamadas); } finally { global.fetch = original; process.env = envAntes; }
}

test("termo inválido responde 400 sem consultar o banco", async () => {
  await comFetch(async (chamadas) => {
    for (const termo of [undefined, "", "a", "%%", "x".repeat(61), "  ,() "]) {
      assert.equal((await handler(evento({ termo }))).statusCode, 400, `termo ${termo}`);
    }
    assert.equal(chamadas.length, 0);
  });
});

test("UF fora das 27 siglas responde 400; vazia é aceita", async () => {
  await comFetch(async (chamadas) => {
    for (const uf of ["XX", "AMM", "1", "SP,RJ"]) assert.equal((await handler(evento({ termo: "uniformes", uf }))).statusCode, 400);
    assert.equal(chamadas.length, 0);
    assert.equal((await handler(evento({ termo: "uniformes", uf: "" }))).statusCode, 200);
    const r = await handler(evento({ termo: "uniformes", uf: "am" }));
    assert.equal(JSON.parse(r.body).uf, "AM");
    assert.ok(new URL(chamadas[1].url).searchParams.get("uf") === "eq.AM");
  });
});

test("sem chave de serviço responde 503 amigável", async () => {
  await comFetch(async (chamadas) => {
    const r = await handler(evento({ termo: "uniformes" }));
    assert.equal(r.statusCode, 503);
    assert.match(JSON.parse(r.body).erro, /indisponível/);
    assert.equal(r.headers["Cache-Control"], "no-store");
    assert.equal(chamadas.length, 0);
  }, { chave: null });
});

test("devolve no máximo 6 resultados só com colunas públicas e link do PNCP", async () => {
  await comFetch(async (chamadas) => {
    const r = await handler(evento({ termo: "uniformes" }));
    assert.equal(r.statusCode, 200);
    assert.equal(r.headers["Cache-Control"], "public, max-age=300");
    assert.equal(r.headers["Access-Control-Allow-Origin"], "https://licitaplena.pages.dev");
    const { resultados } = JSON.parse(r.body);
    assert.equal(resultados.length, 6);
    assert.deepEqual(Object.keys(resultados[0]).sort(), ["encerramento", "link", "linkDisputa", "modalidade", "municipio", "objeto", "orgao", "portal", "publicacao", "uf", "valorEstimado"]);
    assert.equal(resultados[0].portal, "BLL");
    assert.equal(resultados[0].linkDisputa, "https://bllcompras.com/Process/ProcessView?param1=1");
    assert.equal(resultados[1].portal, null); // registro gravado antes do campo: nada a mostrar
    assert.equal(resultados[1].linkDisputa, null);
    assert.equal(resultados[0].valorEstimado, 184320.5);
    assert.equal(resultados[0].link, "https://pncp.gov.br/app/editais/04477782000105/2026/1");
    const url = new URL(chamadas[0].url);
    assert.equal(url.searchParams.get("limit"), "6");
    assert.ok(!url.searchParams.get("select").split(",").includes("dado"));
  });
});

test("filtro vai parametrizado: curingas e separadores do termo são removidos", async () => {
  await comFetch(async (chamadas) => {
    await handler(evento({ termo: "material%_de,limpeza)*" }));
    const and = new URL(chamadas[0].url).searchParams.get("and");
    assert.equal(and, "(objeto.ilike.*material*,objeto.ilike.*limpeza*)");
  });
});

test("CORS restrito, só GET, falha do banco vira 502 sem cache", async () => {
  assert.equal((await handler(evento({}, { httpMethod: "POST" }))).statusCode, 405);
  const pre = await handler(evento({}, { httpMethod: "OPTIONS", headers: { origin: "https://site-malicioso.example" } }));
  assert.equal(pre.statusCode, 204);
  assert.equal(pre.headers["Access-Control-Allow-Origin"], "https://licitaplena.com.br");
  await comFetch(async () => {
    const r = await handler(evento({ termo: "uniformes" }));
    assert.equal(r.statusCode, 502);
    assert.equal(r.headers["Cache-Control"], "no-store");
  }, { resposta: { ok: false, status: 500, json: async () => ({}) } });
});
