const test = require("node:test");
const assert = require("node:assert/strict");

const { requestParaEvent, resultadoParaResponse, executarHandler } = require("../_adaptador_cloudflare");

test("converte Request em event com cabeçalhos minúsculos, corpo e query string", async () => {
  const request = new Request("https://licitaplena.pages.dev/api/ia-edital?cnpj=123&x=1&x=2", {
    method: "POST",
    headers: { Authorization: "Bearer abc", Origin: "https://licitaplena.pages.dev", "X-Licitaplena-Dossies-Chave": "k" },
    body: JSON.stringify({ modo: "resumo" }),
  });
  const event = await requestParaEvent(request);
  assert.equal(event.httpMethod, "POST");
  assert.equal(event.headers.authorization, "Bearer abc");
  assert.equal(event.headers.origin, "https://licitaplena.pages.dev");
  assert.equal(event.headers["x-licitaplena-dossies-chave"], "k");
  assert.equal(event.body, '{"modo":"resumo"}');
  assert.deepEqual(event.queryStringParameters, { cnpj: "123", x: "2" });
  assert.deepEqual(event.multiValueQueryStringParameters.x, ["1", "2"]);
  assert.equal(event.path, "/api/ia-edital");
  assert.equal(event.rawUrl, "https://licitaplena.pages.dev/api/ia-edital?cnpj=123&x=1&x=2");
});

test("GET não leva corpo e query vazia vira objeto vazio", async () => {
  const event = await requestParaEvent(new Request("https://x.test/api/sancoes"));
  assert.equal(event.httpMethod, "GET");
  assert.equal(event.body, null);
  assert.deepEqual(event.queryStringParameters, {});
});

test("resultado base64 vira bytes binários e preserva status e cabeçalhos", async () => {
  const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0x80]);
  const resposta = resultadoParaResponse({
    statusCode: 200,
    headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="a.zip"' },
    body: bytes.toString("base64"),
    isBase64Encoded: true,
  });
  assert.equal(resposta.status, 200);
  assert.equal(resposta.headers.get("content-type"), "application/zip");
  assert.equal(resposta.headers.get("content-disposition"), 'attachment; filename="a.zip"');
  assert.deepEqual(Buffer.from(await resposta.arrayBuffer()), bytes);
});

test("204 de preflight não tem corpo e mantém os cabeçalhos CORS", async () => {
  const resposta = resultadoParaResponse({ statusCode: 204, headers: { "Access-Control-Allow-Origin": "https://licitaplena.com.br" } });
  assert.equal(resposta.status, 204);
  assert.equal(resposta.headers.get("access-control-allow-origin"), "https://licitaplena.com.br");
  assert.equal(await resposta.text(), "");
});

test("multiValueHeaders gera um cabeçalho por valor", () => {
  const resposta = resultadoParaResponse({ statusCode: 200, headers: { "Set-Cookie": "a=1" }, multiValueHeaders: { "Set-Cookie": ["a=1", "b=2"] }, body: "ok" });
  assert.deepEqual(resposta.headers.getSetCookie(), ["a=1", "b=2"]);
});

test("Cache-Control padrão só entra quando o handler não define o seu", () => {
  const padrao = "public, max-age=300, stale-while-revalidate=3600";
  assert.equal(resultadoParaResponse({ statusCode: 200, body: "{}" }, { cacheControlPadrao: padrao }).headers.get("cache-control"), padrao);
  const proprio = resultadoParaResponse({ statusCode: 200, headers: { "Cache-Control": "no-store" }, body: "{}" }, { cacheControlPadrao: padrao });
  assert.equal(proprio.headers.get("cache-control"), "no-store");
});

test("executarHandler entrega o event ao handler e devolve o corpo JSON", async () => {
  const resposta = await executarHandler(async (event) => ({ statusCode: 201, body: JSON.stringify({ metodo: event.httpMethod, cnpj: event.queryStringParameters.cnpj }) }),
    new Request("https://x.test/api/sancoes?cnpj=9"));
  assert.equal(resposta.status, 201);
  assert.deepEqual(await resposta.json(), { metodo: "GET", cnpj: "9" });
});

test("handler que lança exceção vira 500 JSON sem vazar detalhes", async () => {
  const resposta = await executarHandler(async () => { throw new Error("segredo interno"); }, new Request("https://x.test/api/x"));
  assert.equal(resposta.status, 500);
  const texto = await resposta.text();
  assert.ok(!texto.includes("segredo interno"));
  assert.ok(JSON.parse(texto).erro);
});
