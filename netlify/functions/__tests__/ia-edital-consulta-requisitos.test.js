const test = require("node:test");
const assert = require("node:assert/strict");
const { handler } = require("../lib/ia-edital");

const NUMERO = "01171012000141-1-000005/2026";
const dossieValido = { versao: 17, versaoValidacao: 17, fonteLida: true, geradoEm: "2026-11-01T00:00:00Z",
  estrutura: { documentosHabilitacao: ["Certidão negativa de débitos federais"], declaracoesExigidas: [], coberturaLeitura: { parcial: false } } };

// Simula o Supabase: a fila respeita on_conflict como o PostgREST, então um pedido repetido não duplica a linha.
async function consultar({ dossie = null, filaFalha = false, vezes = 1 } = {}) {
  const anterior = global.fetch, env = { ...process.env };
  process.env.SUPABASE_SERVICE_ROLE_KEY = "servico-teste";
  delete process.env.NETLIFY_BLOBS_CONTEXT;
  delete process.env.DOSSIES_EDITAIS_CHAVE;
  const fila = new Map(), pedidosFila = [], proibidas = [];
  global.fetch = async (url, opcoes = {}) => {
    if (url.includes("/rest/v1/clientes?")) return new Response(JSON.stringify([{ status: "aprovado" }]));
    if (url.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: "cliente" }));
    if (url.includes("/rest/v1/dossies_editais")) return new Response(JSON.stringify(dossie ? [{ dossie, versao: dossie.versao }] : []));
    if (url.includes("/rest/v1/fila_dossies")) {
      if (filaFalha) throw new TypeError("fetch failed");
      pedidosFila.push({ url, prefer: opcoes.headers.Prefer, linhas: JSON.parse(opcoes.body) });
      if (url.includes("on_conflict=numero_controle_pncp") && /merge-duplicates/.test(opcoes.headers.Prefer)) {
        for (const linha of JSON.parse(opcoes.body)) fila.set(linha.numero_controle_pncp, linha);
      }
      return new Response("", { status: 201 });
    }
    proibidas.push(url);
    return new Response("", { status: 500 });
  };
  const erroOriginal = console.error;
  console.error = () => {};
  try {
    const respostas = [];
    for (let i = 0; i < vezes; i++) {
      const r = await handler({ httpMethod: "POST", headers: { authorization: "Bearer cliente" },
        body: JSON.stringify({ modo: "consulta_requisitos", edital: { numeroControlePNCP: NUMERO } }) });
      respostas.push({ statusCode: r.statusCode, corpo: JSON.parse(r.body) });
    }
    return { respostas, fila, pedidosFila, proibidas };
  } finally {
    console.error = erroOriginal;
    global.fetch = anterior;
    process.env = env;
  }
}

test("consulta_requisitos sem dossiê enfileira o edital e avisa o painel", async () => {
  const r = await consultar();
  assert.equal(r.respostas[0].statusCode, 200);
  assert.deepEqual(r.respostas[0].corpo, { disponivel: false, enfileirado: true, requisitos: [] });
  assert.deepEqual(r.pedidosFila.map(p => p.linhas), [[{ numero_controle_pncp: NUMERO, concluido_em: null }]]);
  // Consulta barata: não baixa documento, não chama IA nem consome cota.
  assert.deepEqual(r.proibidas, []);
});

test("consulta_requisitos com dossiê pronto não enfileira", async () => {
  const r = await consultar({ dossie: dossieValido });
  assert.equal(r.respostas[0].statusCode, 200);
  assert.equal(r.respostas[0].corpo.disponivel, true);
  assert.equal(r.respostas[0].corpo.enfileirado, undefined);
  assert.equal(r.pedidosFila.length, 0);
});

test("consultas repetidas não duplicam o edital na fila", async () => {
  const r = await consultar({ vezes: 2 });
  assert.equal(r.respostas.every(x => x.corpo.enfileirado === true), true);
  // Um pedido por consulta, sempre com upsert na chave do edital: a fila fica com uma linha só.
  assert.equal(r.pedidosFila.length, 2);
  for (const p of r.pedidosFila) {
    assert.match(p.url, /on_conflict=numero_controle_pncp/);
    assert.match(p.prefer, /resolution=merge-duplicates/);
  }
  assert.equal(r.fila.size, 1);
});

test("falha ao enfileirar não derruba a consulta de requisitos", async () => {
  const r = await consultar({ filaFalha: true });
  assert.equal(r.respostas[0].statusCode, 200);
  assert.equal(r.respostas[0].corpo.disponivel, false);
  assert.deepEqual(r.respostas[0].corpo.requisitos, []);
});
