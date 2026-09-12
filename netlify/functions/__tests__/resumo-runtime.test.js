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

test("endpoint moderno usa SDK Blobs real para persistir etapa, retomar e concluir sem reenviar fonte inteira", async () => {
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
  let versao = 0;
  const responder = (corpo, status = 200, headers = {}) => new globalThis.Response(typeof corpo === "string" ? corpo : JSON.stringify(corpo), { status, headers });
  global.fetch = async (url, opcoes = {}) => {
    if (/^https:\/\/blobs-(?:forte-)?teste\.invalid/.test(url)) {
      rotasBlob.push({ url, metodo: opcoes.method });
      const caminho = new globalThis.URL(url).pathname;
      const registro = blobs.get(caminho);
      if (opcoes.method === "put") {
        if ((opcoes.headers["if-none-match"] && registro) || (opcoes.headers["if-match"] && opcoes.headers["if-match"] !== registro?.etag)) return responder("", 412);
        const etag = String(++versao); blobs.set(caminho, { dado: JSON.parse(opcoes.body), etag });
        return responder("", 200, { etag });
      }
      return registro ? responder(registro.dado, 200, { etag: registro.etag }) : responder("", 404);
    }
    if (url.includes("api.groq.com")) {
      const corpo = JSON.parse(opcoes.body); chamadasIA.push(corpo);
      return responder({ choices: [{ message: { content: chamadasIA.length === 1 ? '{"ok":true}' : '{"resumoGeral":"Documentos analisados","documentosHabilitacao":["Apresentar documentos [R0001]"]}' } }] });
    }
    if (url.includes("/api/consulta/")) return responder({ objetoCompra: "Objeto oficial" });
    if (url.endsWith("/arquivos")) return responder([{ sequencialDocumento: 1, titulo: "Edital" }]);
    return responder("%PDF-fonte");
  };
  try {
    const modulo = await import(pathToFileURL(require.resolve("../ia-edital.mjs")).href);
    const solicitar = () => modulo.default(new globalThis.Request("https://licitaplena.com.br/.netlify/functions/ia-edital", {
      method: "POST", headers: { "content-type": "application/json", "x-licitaplena-dossies-chave": "robo-teste" },
      body: JSON.stringify({ modo: "resumo", edital: { numeroControlePNCP: "01171012000141-1-000005/2026" } }),
    }), { requestId: "qa-runtime" });
    // Ausência de contexto nunca deve desviar para chamada de documento integral.
    assert.equal((await solicitar()).status, 503);
    assert.equal(chamadasIA.length, 0);
    process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ siteID: "site-teste", token: "token-escopo-blobs", edgeURL: "https://blobs-teste.invalid/", uncachedEdgeURL: "https://blobs-forte-teste.invalid/" })).toString("base64");
    const primeira = await solicitar();
    assert.equal(primeira.status, 202);
    const progresso = await primeira.json();
    assert.equal(progresso.progresso.concluidas, 1);
    assert.ok(progresso.progresso.total > 1);
    const chave = [...blobs.keys()].find((item) => item.includes("progresso"));
    assert.ok(chave);
    const chamadasAntes = chamadasIA.length;
    assert.equal((await solicitar()).status, 202);
    assert.equal(chamadasIA.length, chamadasAntes);
    let final;
    for (let i = 1; i < progresso.progresso.total; i++) {
      blobs.get(chave).dado.proximaEtapaEm = 0;
      final = await solicitar();
    }
    assert.equal(final.status, 200);
    assert.ok((await final.json()).estrutura);
    assert.equal(blobs.get(chave).dado.resultados.length, progresso.progresso.total);
    assert.ok(rotasBlob.filter((rota) => rota.metodo === "get").every((rota) => rota.url.startsWith("https://blobs-forte-teste.invalid/")));
    assert.ok(chamadasIA.slice(1).every((chamada) => !chamada.messages.some((mensagem) => mensagem.content.includes(texto))));
    if (process.env.QA_FONTE_REAL) console.log(JSON.stringify({ fonteRealCaracteres: texto.length, blocos: progresso.progresso.total, etapasConcluidas: blobs.get(chave).dado.resultados.length, respostaFinal: final.status }));
  } finally {
    global.fetch = originalFetch;
    if (pdfOriginal) require.cache[caminhoPdf] = pdfOriginal; else delete require.cache[caminhoPdf];
    for (const chave of variaveis) { if (anteriores[chave] === undefined) delete process.env[chave]; else process.env[chave] = anteriores[chave]; }
  }
});
