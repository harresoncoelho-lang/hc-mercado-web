const test = require("node:test");
const assert = require("node:assert/strict");
const { listarNumerosItens, buscarFonteItem, urlItem } = require("../_pncp_item_fonte");

const CNPJ = "11222333000181";
const json = (corpo, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
const itens = (de, ate) => Array.from({ length: ate - de + 1 }, (_, i) => ({ numeroItem: de + i, descricao: "x" }));
function fetchFalso(paginas) {
  const urls = [];
  const fetch = async (url, opcoes) => {
    urls.push(url);
    assert.equal(typeof opcoes.signal?.aborted, "boolean");
    const p = Number(new URL(url).searchParams.get("pagina"));
    const r = paginas[p - 1];
    if (r instanceof Error) throw r;
    return r === undefined ? new Response(null, { status: 204 }) : json(r);
  };
  return { fetch, urls };
}

test("uma página devolve só os números dos itens", async () => {
  const f = fetchFalso([itens(1, 3)]);
  assert.deepEqual(await listarNumerosItens(CNPJ, "2026", "41", { fetch: f.fetch, pagina: 10 }), [1, 2, 3]);
  assert.equal(f.urls.length, 1);
  assert.equal(f.urls[0], `https://pncp.gov.br/api/pncp/v1/orgaos/${CNPJ}/compras/2026/41/itens?pagina=1&tamanhoPagina=10`);
});

test("várias páginas são percorridas até a página incompleta", async () => {
  const f = fetchFalso([itens(1, 2), itens(3, 4), itens(5, 5)]);
  assert.deepEqual(await listarNumerosItens(CNPJ, 2026, 41, { fetch: f.fetch, pagina: 2 }), [1, 2, 3, 4, 5]);
  assert.equal(f.urls.length, 3);
});

test("página cheia seguida de 204 encerra sem erro", async () => {
  const f = fetchFalso([itens(1, 2)]);
  assert.deepEqual(await listarNumerosItens(CNPJ, 2026, 41, { fetch: f.fetch, pagina: 2 }), [1, 2]);
  assert.equal(f.urls.length, 2);
});

test("lista vazia devolve array vazio (204 ou [])", async () => {
  assert.deepEqual(await listarNumerosItens(CNPJ, 2026, 41, { fetch: fetchFalso([]).fetch }), []);
  assert.deepEqual(await listarNumerosItens(CNPJ, 2026, 41, { fetch: fetchFalso([[]]).fetch }), []);
});

test("teto de páginas recusa lista truncada", async () => {
  const f = fetchFalso([itens(1, 2), itens(3, 4), itens(5, 6)]);
  await assert.rejects(listarNumerosItens(CNPJ, 2026, 41, { fetch: f.fetch, pagina: 2, maxPaginas: 2 }), { status: 502, message: /teto/ });
  assert.equal(f.urls.length, 2);
});

test("erro de rede, HTTP de erro e corpo inválido viram 502", async () => {
  await assert.rejects(listarNumerosItens(CNPJ, 2026, 41, { fetch: fetchFalso([new TypeError("fetch failed")]).fetch }), { status: 502, message: "Fonte PNCP indisponível." });
  await assert.rejects(listarNumerosItens(CNPJ, 2026, 41, { fetch: async () => json({}, 500) }), { status: 502 });
  await assert.rejects(listarNumerosItens(CNPJ, 2026, 41, { fetch: async () => json({ itens: [] }) }), { status: 502, message: "Resposta PNCP inválida." });
  await assert.rejects(listarNumerosItens(CNPJ, 2026, 41, { fetch: async () => json([{ numeroItem: "1" }]) }), { status: 502 });
});

test("timeout aborta a página pendente", async () => {
  const fetch = (_url, { signal }) => new Promise((_, rejeitar) => signal.addEventListener("abort", () => rejeitar(Object.assign(new Error("abort"), { name: "AbortError" }))));
  await assert.rejects(listarNumerosItens(CNPJ, 2026, 41, { fetch, timeoutMs: 5 }), { status: 502 });
});

test("referência inválida não chama o PNCP", async () => {
  let chamou = false;
  await assert.rejects(listarNumerosItens("123", 2026, 41, { fetch: async () => { chamou = true; } }), { status: 409 });
  assert.equal(chamou, false);
});

test("buscarFonteItem normaliza quantidade e produz hash estável", async () => {
  const ref = { cnpj: CNPJ, ano: "2026", seq: "41" };
  const fetchImpl = async () => new Response('{"numeroItem":7,"descricao":"Papel A4","quantidade":2.500,"unidadeMedida":"RESMA"}');
  const a = await buscarFonteItem(ref, 7, { fetchImpl }), b = await buscarFonteItem(ref, 7, { fetchImpl });
  assert.equal(a.url, urlItem(ref, 7));
  assert.equal(a.compra, `${CNPJ}-1-41/2026`);
  assert.deepEqual(a.item, { numero: 7, descricao: "Papel A4", quantidade: "2.5", unidade: "RESMA" });
  assert.match(a.hash, /^[a-f0-9]{64}$/);
  assert.equal(a.hash, b.hash);
  assert.equal(a.snapshot.textoOriginal.includes("2.500"), true);
});
