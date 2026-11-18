const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const { handler } = require("../portal-cliente");

const TOKEN = "A".repeat(42) + "b";
const HEX64 = /^[0-9a-f]{64}$/;
let ipSeq = 0;
// Cada teste usa um IP próprio para não somar no limitador em memória dos outros. Em Node (fora do Workers)
// o único cabeçalho de IP confiável é o do Netlify.
const evento = (corpo, { ip = `10.0.0.${++ipSeq}`, metodo = "POST", headers = {} } = {}) => ({
  httpMethod: metodo,
  headers: { origin: "https://licitaplena.pages.dev", ...(ip ? { "x-nf-client-connection-ip": ip } : {}), ...headers },
  body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
});
const ITEM = "f4000000-0000-4000-8000-000000000031";
const VALIDA = { item_id: ITEM, decisao: "aprovado", versao: "a".repeat(32) };

async function comoCloudflare(fn) {
  const antes = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Cloudflare-Workers" }, configurable: true, writable: true });
  try { return await fn(); } finally {
    if (antes) Object.defineProperty(globalThis, "navigator", antes); else delete globalThis.navigator;
  }
}

async function comAmbiente(fn, { env = {}, respostaRpc = { status: 200, dados: null } } = {}) {
  const original = global.fetch;
  const envAntes = { ...process.env };
  Object.assign(process.env, { PORTAL_CLIENTE_LIGADO: "1", PORTAL_IP_SALT: "sal-teste", SUPABASE_SERVICE_ROLE_KEY: "chave-teste" });
  for (const [k, v] of Object.entries(env)) if (v === null) delete process.env[k]; else process.env[k] = v;
  const chamadas = [];
  global.fetch = async (url, opcoes) => {
    chamadas.push({ url: String(url), opcoes, corpo: JSON.parse(opcoes.body) });
    const r = typeof respostaRpc === "function" ? respostaRpc() : respostaRpc;
    return { ok: r.status < 400, status: r.status, json: async () => r.dados };
  };
  try { return await fn(chamadas); } finally { global.fetch = original; process.env = envAntes; }
}

test("só POST: outros métodos respondem 405", async () => {
  await comAmbiente(async (chamadas) => {
    for (const metodo of ["GET", "PUT", "DELETE"]) assert.equal((await handler(evento({}, { metodo }))).statusCode, 405);
    assert.equal(chamadas.length, 0);
  });
});

test("desligado ou sem salt responde 503 sem chamar o banco", async () => {
  for (const env of [{ PORTAL_CLIENTE_LIGADO: null }, { PORTAL_CLIENTE_LIGADO: "0" }, { PORTAL_IP_SALT: null }, { SUPABASE_SERVICE_ROLE_KEY: null }]) {
    await comAmbiente(async (chamadas) => {
      assert.equal((await handler(evento({ token: TOKEN, acao: "ler" }))).statusCode, 503);
      assert.equal(chamadas.length, 0);
    }, { env });
  }
});

test("token malformado responde 404 sem chamar o banco, com o mesmo texto", async () => {
  await comAmbiente(async (chamadas) => {
    for (const token of [undefined, "", "A".repeat(42), "A".repeat(44), "A".repeat(42) + "=", "A".repeat(42) + "/", 123]) {
      const r = await handler(evento({ token, acao: "ler" }));
      assert.equal(r.statusCode, 404);
      assert.equal(JSON.parse(r.body).erro, "Link inválido ou expirado.");
    }
    assert.equal(chamadas.length, 0);
  });
});

test("RPC null (expirado, revogado ou inexistente) responde o mesmo 404", async () => {
  await comAmbiente(async (chamadas) => {
    const r = await handler(evento({ token: TOKEN, acao: "ler" }));
    assert.equal(r.statusCode, 404);
    assert.equal(JSON.parse(r.body).erro, "Link inválido ou expirado.");
    assert.equal(r.headers["Cache-Control"], "no-store");
    assert.equal(r.headers["X-Robots-Tag"], "noindex");
    assert.equal(r.headers["Access-Control-Allow-Origin"], "https://licitaplena.pages.dev");
    assert.equal(chamadas.length, 1);
  });
});

test("limite do banco vira 429 com Retry-After", async () => {
  await comAmbiente(async () => {
    const r = await handler(evento({ token: TOKEN, acao: "ler" }));
    assert.equal(r.statusCode, 429);
    assert.equal(r.headers["Retry-After"], "60");
  }, { respostaRpc: { status: 200, dados: { limite: true } } });
});

test("versão divergente vira 409 com a lista", async () => {
  const id = "f4000000-0000-4000-8000-000000000031";
  await comAmbiente(async () => {
    const r = await handler(evento({ token: TOKEN, acao: "responder", respostas: [{ item_id: id, decisao: "aprovado", versao: "a".repeat(32) }] }));
    assert.equal(r.statusCode, 409);
    assert.deepEqual(JSON.parse(r.body).divergentes, [id]);
  }, { respostaRpc: { status: 200, dados: { ok: false, divergentes: [id] } } });
});

test("PT400 vira 400 e PT403 vira 403 genérico", async () => {
  await comAmbiente(async () => {
    const r = await handler(evento({ token: TOKEN, acao: "responder", respostas: [VALIDA] }));
    assert.equal(r.statusCode, 400);
  }, { respostaRpc: { status: 400, dados: { code: "PT400", message: "Resposta inválida" } } });
  await comAmbiente(async () => {
    const r = await handler(evento({ token: TOKEN, acao: "responder", respostas: [VALIDA] }));
    assert.equal(r.statusCode, 403);
    assert.equal(JSON.parse(r.body).erro, "Acesso não autorizado.");
  }, { respostaRpc: { status: 403, dados: { code: "PT403", message: "Item fora do processo do link" } } });
  await comAmbiente(async () => {
    assert.equal((await handler(evento({ token: TOKEN, acao: "ler" }))).statusCode, 503);
  }, { respostaRpc: { status: 500, dados: { code: "XX000" } } });
});

test("corpo grande, JSON inválido, ação ou campos fora do contrato e mais de 200 respostas respondem 400", async () => {
  await comAmbiente(async (chamadas) => {
    const muitas = Array.from({ length: 201 }, () => ({}));
    for (const corpo of [
      JSON.stringify({ token: TOKEN, acao: "responder", respostas: [{ observacao: "a".repeat(33 * 1024) }] }),
      "{", "[]", "null",
      { token: TOKEN, acao: "apagar" },
      { token: TOKEN, acao: "ler", extra: 1 },
      { token: TOKEN, acao: "ler", pagina: 0 },
      { token: TOKEN, acao: "ler", pagina: 1.5 },
      { token: TOKEN, acao: "responder", respostas: [] },
      { token: TOKEN, acao: "responder", respostas: muitas },
    ]) assert.equal((await handler(evento(corpo))).statusCode, 400, String(corpo).slice(0, 40));
    assert.equal(chamadas.length, 0);
  });
});

test("a RPC recebe só hashes hex de 64, nunca o token nem o IP puro", async () => {
  const ip = "203.0.113.77";
  await comAmbiente(async (chamadas) => {
    await handler(evento({ token: TOKEN, acao: "ler", pagina: 2 }, { ip }));
    await handler(evento({ token: TOKEN, acao: "responder", respostas: [VALIDA] }, { ip }));
    assert.equal(chamadas.length, 2);
    assert.match(chamadas[0].url, /\/rest\/v1\/rpc\/portal_ler$/);
    assert.match(chamadas[1].url, /\/rest\/v1\/rpc\/portal_responder$/);
    assert.equal(chamadas[0].opcoes.headers.Authorization, "Bearer chave-teste");
    for (const c of chamadas) {
      assert.match(c.corpo.p_token_hash, HEX64);
      assert.match(c.corpo.p_ip_hash, HEX64);
      assert.equal(c.corpo.p_token_hash, createHash("sha256").update(TOKEN).digest("hex"));
      assert.ok(!c.opcoes.body.includes(TOKEN) && !c.opcoes.body.includes(ip));
    }
    assert.equal(chamadas[0].corpo.p_pagina, 2);
    assert.equal(chamadas[0].corpo.p_ip_hash, chamadas[1].corpo.p_ip_hash);
  });
});

test("a resposta nunca leva cnpj, organizacao_id nem token_hash", async () => {
  const dados = {
    empresa: { razao_social: "Empresa QA", cnpj: "11222333000181" },
    organizacao_id: "f4000000-0000-4000-8000-00000000000a",
    processo: { numero: "QA-1", token_hash: "a".repeat(64) },
    itens: [{ id: "i1", descricao: "Item", organizacao_id: "x", ip_hash: "b".repeat(64) }],
  };
  await comAmbiente(async () => {
    const r = await handler(evento({ token: TOKEN, acao: "ler" }));
    assert.equal(r.statusCode, 200);
    assert.ok(!/cnpj|organizacao_id|token_hash|ip_hash/.test(r.body));
    assert.equal(JSON.parse(r.body).empresa.razao_social, "Empresa QA");
  }, { respostaRpc: { status: 200, dados } });
});

test("limitador em memória corta na 31ª requisição do mesmo IP no minuto, sem chamar o banco", async () => {
  const ip = "198.51.100.9";
  await comAmbiente(async (chamadas) => {
    for (let k = 1; k <= 30; k++) assert.equal((await handler(evento({ token: TOKEN, acao: "ler" }, { ip }))).statusCode, 404);
    const r = await handler(evento({ token: TOKEN, acao: "ler" }, { ip }));
    assert.equal(r.statusCode, 429);
    assert.equal(r.headers["Retry-After"], "60");
    assert.equal(chamadas.length, 30);
    assert.equal((await handler(evento({ token: TOKEN, acao: "ler" }))).statusCode, 404, "outro IP segue livre");
  });
});

test("erro devolvido pela RPC como {erro, codigo}: invalido vira 400 e proibido vira 403", async () => {
  await comAmbiente(async () => {
    assert.equal((await handler(evento({ token: TOKEN, acao: "responder", respostas: [VALIDA] }))).statusCode, 400);
  }, { respostaRpc: { status: 200, dados: { erro: "Resposta inválida", codigo: "invalido" } } });
  await comAmbiente(async () => {
    const r = await handler(evento({ token: TOKEN, acao: "responder", respostas: [VALIDA] }));
    assert.equal(r.statusCode, 403);
    assert.equal(JSON.parse(r.body).erro, "Acesso não autorizado.");
  }, { respostaRpc: { status: 200, dados: { erro: "Item fora do processo do link", codigo: "proibido" } } });
});

test("cada resposta é validada antes do banco: uuid, decisão, versão de 32 hex, observação até 1000", async () => {
  await comAmbiente(async (chamadas) => {
    for (const ruim of [
      { ...VALIDA, item_id: "-".repeat(36) },
      { ...VALIDA, item_id: ITEM + "0" },
      { ...VALIDA, decisao: "talvez" },
      { ...VALIDA, versao: "A".repeat(32) },
      { ...VALIDA, versao: "a".repeat(31) },
      { ...VALIDA, observacao: "a".repeat(1001) },
      { ...VALIDA, observacao: 12 },
      { ...VALIDA, extra: 1 },
      null, "texto", [VALIDA],
    ]) assert.equal((await handler(evento({ token: TOKEN, acao: "responder", respostas: [VALIDA, ruim] }))).statusCode, 400, JSON.stringify(ruim));
    assert.equal(chamadas.length, 0);
    const ok = await handler(evento({ token: TOKEN, acao: "responder", respostas: [{ ...VALIDA, observacao: "😀".repeat(1000) }, { ...VALIDA, item_id: ITEM.replace("31", "32"), observacao: null }] }));
    assert.equal(ok.statusCode, 200);
    assert.equal(chamadas.length, 1);
  }, { respostaRpc: { status: 200, dados: { ok: true, gravados: 2, repetidos: 0 } } });
});

test("cf-connecting-ip falso fora do Cloudflare é ignorado: vale só o IP do Netlify", async () => {
  await comAmbiente(async (chamadas) => {
    for (let k = 1; k <= 30; k++) {
      const r = await handler(evento({ token: TOKEN, acao: "ler" }, { ip: "192.0.2.50", headers: { "cf-connecting-ip": `10.9.9.${k}`, "x-forwarded-for": `10.8.8.${k}` } }));
      assert.equal(r.statusCode, 404);
    }
    assert.equal(new Set(chamadas.map((c) => c.corpo.p_ip_hash)).size, 1, "IP trocado no cabeçalho mudou o hash");
    const r = await handler(evento({ token: TOKEN, acao: "ler" }, { ip: "192.0.2.50", headers: { "cf-connecting-ip": "10.9.9.99" } }));
    assert.equal(r.statusCode, 429);
  });
});

test("no Cloudflare vale cf-connecting-ip e o cabeçalho do Netlify é ignorado", async () => {
  await comoCloudflare(() => comAmbiente(async (chamadas) => {
    await handler(evento({ token: TOKEN, acao: "ler" }, { ip: "10.1.1.1", headers: { "cf-connecting-ip": "203.0.113.5" } }));
    await handler(evento({ token: TOKEN, acao: "ler" }, { ip: "10.1.1.2", headers: { "cf-connecting-ip": "203.0.113.5" } }));
    await handler(evento({ token: TOKEN, acao: "ler" }, { ip: "10.1.1.1", headers: { "cf-connecting-ip": "203.0.113.6" } }));
    const [a, b, c] = chamadas.map((x) => x.corpo.p_ip_hash);
    assert.equal(a, b);
    assert.notEqual(a, c);
  }));
});

test("sem IP confiável o limite em memória passa a ser por token e mais estrito (10/min)", async () => {
  const outro = "B".repeat(42) + "c";
  await comAmbiente(async (chamadas) => {
    for (let k = 1; k <= 10; k++) assert.equal((await handler(evento({ token: outro, acao: "ler" }, { ip: null }))).statusCode, 404);
    assert.equal((await handler(evento({ token: outro, acao: "ler" }, { ip: null }))).statusCode, 429);
    assert.equal(chamadas.length, 10);
    assert.equal(new Set(chamadas.map((c) => c.corpo.p_ip_hash)).size, 1);
    assert.equal((await handler(evento({ token: "C".repeat(42) + "d", acao: "ler" }, { ip: null }))).statusCode, 404, "outro token segue livre");
  });
});
