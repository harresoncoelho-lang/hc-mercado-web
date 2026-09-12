const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

test("adaptador preserva preflight 204 sem corpo e cabeçalhos CORS", async () => {
  const modulo = await import(pathToFileURL(require.resolve("../ia-edital.mjs")).href);
  const resposta = await modulo.default(new globalThis.Request("https://licitaplena.com.br/.netlify/functions/ia-edital", {
    method: "OPTIONS", headers: { origin: "https://licitaplena.com.br" },
  }), { requestId: "qa-preflight" });
  assert.equal(resposta.status, 204);
  assert.equal(await resposta.text(), "");
  assert.equal(resposta.headers.get("access-control-allow-origin"), "https://licitaplena.com.br");
  assert.match(resposta.headers.get("access-control-allow-methods"), /POST/);
});

test("endpoint entrega dossiê documental imediato sem IA mesmo com armazenamento indisponível", async () => {
  const originalFetch = global.fetch;
  const variaveis = ["GROQ_API_KEY", "DOSSIES_EDITAIS_CHAVE", "NETLIFY_BLOBS_CONTEXT", "SUPABASE_SERVICE_ROLE_KEY"];
  const anteriores = Object.fromEntries(variaveis.map((chave) => [chave, process.env[chave]]));
  const caminhoPdf = require.resolve("pdf-parse"), pdfOriginal = require.cache[caminhoPdf];
  const texto = process.env.QA_FONTE_REAL ? JSON.parse(fs.readFileSync(process.env.QA_FONTE_REAL, "utf8")).texto
    : Array.from({ length: 8 }, (_, i) => `[Página ${i + 1}]\n7. HABILITAÇÃO\n7.1. ${"Apresentar os documentos com condições expressas. ".repeat(180)}\n`).join("");
  require.cache[caminhoPdf] = { exports: async () => ({ text: texto, numpages: 8 }) };
  process.env.GROQ_API_KEY = "chave-teste";
  process.env.DOSSIES_EDITAIS_CHAVE = "robo-teste";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NETLIFY_BLOBS_CONTEXT;
  const blobs = new Map(), chamadasIA = [], rotasBlob = [];
  let versao = 0, usarFonteSalva = false;
  const responder = (corpo, status = 200, headers = {}) => new globalThis.Response(typeof corpo === "string" ? corpo : JSON.stringify(corpo), { status, headers });
  global.fetch = async (url, opcoes = {}) => {
    if (/^https:\/\/blobs-(?:forte-)?teste\.invalid/.test(url)) {
      rotasBlob.push({ url, metodo: opcoes.method });
      const caminho = new globalThis.URL(url).pathname;
      const registro = blobs.get(caminho);
      if (usarFonteSalva && decodeURIComponent(caminho).includes("progresso:v14:schema120b1:")) return responder({ texto, coberturaLeitura: { parcial: true }, expiraEm: Date.now() + 60000, resultados: [{ detalhes: { valorEstimado: "INVENTADO" } }], proximaEtapaEm: Date.now() + 60000 });
      if (opcoes.method === "put") {
        if ((opcoes.headers["if-none-match"] && registro) || (opcoes.headers["if-match"] && opcoes.headers["if-match"] !== registro?.etag)) return responder("", 412);
        const etag = String(++versao); blobs.set(caminho, { dado: JSON.parse(opcoes.body), etag });
        return responder("", 200, { etag });
      }
      return registro ? responder(registro.dado, 200, { etag: registro.etag }) : responder("", 404);
    }
    if (url.includes("/auth/v1/user")) return responder({ id: "usuario-teste" });
    if (url.includes("incrementar_uso")) throw new Error("Resumo documental não deve cobrar quota IA");
    if (url.includes("api.groq.com")) {
      const corpo = JSON.parse(opcoes.body); chamadasIA.push(corpo);
      const ids = new Map([...corpo.messages.at(-1).content.matchAll(/(R\d{4}) (documentosHabilitacao|documentosCredenciamento|requisitosProposta|declaracoesExigidas)/g)].map((item) => [item[1], item[2]]));
      const requisitos = [...ids].map(([id, categoria]) => ({ acao: "Apresentar", documento: "Documentos exigidos", condicoes: "", prazo: "", ids: [id], categoria }));
      return responder({ choices: [{ message: { content: JSON.stringify({ requisitos, fatos: [{ campo: "resumoGeral", valor: "Documentos analisados", referencia: "Edital oficial" }] }) } }] });
    }
    if (url.includes("/api/consulta/")) return responder({ objetoCompra: "Objeto oficial" });
    if (url.endsWith("/arquivos")) return responder([{ sequencialDocumento: 1, titulo: "Edital" }]);
    return responder("%PDF-fonte");
  };
  try {
    const modulo = await import(pathToFileURL(require.resolve("../ia-edital.mjs")).href);
    const solicitar = () => modulo.default(new globalThis.Request("https://licitaplena.com.br/.netlify/functions/ia-edital", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer usuario-teste" },
      body: JSON.stringify({ modo: "resumo", edital: { numeroControlePNCP: "01171012000141-1-000005/2026" } }),
    }), { requestId: "qa-runtime" });
    const primeira = await solicitar();
    assert.equal(primeira.status, 200);
    const dossie = await primeira.json();
    assert.ok(dossie.estrutura.documentosHabilitacao.length);
    assert.equal(dossie.metodoResumo, "documentos");
    assert.equal(chamadasIA.length, 0);
    process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ siteID: "site-teste", token: "token-escopo-blobs", edgeURL: "https://blobs-teste.invalid/", uncachedEdgeURL: "https://blobs-forte-teste.invalid/" })).toString("base64");
    usarFonteSalva = true;
    const comFonteSalva = await solicitar();
    assert.equal(comFonteSalva.status, 200);
    const salva = await comFonteSalva.json();
    assert.equal(salva.estrutura.coberturaLeitura.parcial, true);
    assert.doesNotMatch(JSON.stringify(salva.estrutura), /INVENTADO/);
    assert.ok([...blobs.values()].some(item => item.dado.versao === 15));
    assert.equal(chamadasIA.length, 0);
    assert.ok(rotasBlob.filter(rota => rota.metodo === "get").every(rota => rota.url.startsWith("https://blobs-forte-teste.invalid/")));
  } finally {
    global.fetch = originalFetch;
    if (pdfOriginal) require.cache[caminhoPdf] = pdfOriginal; else delete require.cache[caminhoPdf];
    for (const chave of variaveis) { if (anteriores[chave] === undefined) delete process.env[chave]; else process.env[chave] = anteriores[chave]; }
  }
});
