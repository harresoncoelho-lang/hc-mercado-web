const test = require("node:test");
const assert = require("node:assert/strict");
const gateway = require("../_resumo_gateway");
const { schema } = require("../_resumo_gateway_contrato");

function memoria() {
  const dados = new Map(); let versao = 0;
  return {
    dados,
    async getWithMetadata(chave) { return globalThis.structuredClone(dados.get(chave) || null); },
    async setJSON(chave, data, opcoes = {}) {
      const atual = dados.get(chave);
      if ((opcoes.onlyIfNew && atual) || (opcoes.onlyIfMatch && atual?.etag !== opcoes.onlyIfMatch)) return { modified: false };
      const etag = String(++versao); dados.set(chave, { data: globalThis.structuredClone(data), etag }); return { modified: true, etag };
    },
  };
}
function preencher(s) {
  if (s.type === "string") return s.enum?.[0] || "Não informado";
  if (s.type === "array") return [];
  return Object.fromEntries(s.required.map(k => [k, preencher(s.properties[k])]));
}
async function preparar(store = memoria()) {
  const eventos = []; let chave;
  const parametros = { store, fonte: "Fonte oficial integral de teste.", ficha: { numeroControlePNCP: "00508903000188-1-001755/2026", objeto: "Objeto oficial" }, cobertura: { documentosLidos: ["Edital"] }, usuario: "dono", authorization: "Bearer ficticio",
    autorizar: async () => { eventos.push("cota"); return { ok: true }; },
    disparar: async (_url, opcoes) => { eventos.push("disparo"); chave = JSON.parse(opcoes.body).chave; return { status: 202 }; } };
  const resposta = await gateway.solicitarResumo(parametros);
  return { store, eventos, chave, parametros, resposta };
}

test("gateway reserva uma cota antes do despacho e polling não gera custo novo", async () => {
  const x = await preparar();
  assert.deepEqual(x.eventos, ["cota", "disparo"]);
  assert.equal(x.resposta.statusCode, 202);
  assert.deepEqual(x.resposta.body.progresso, { concluidas: 0, total: 1, aguardarSegundos: 5 });
  await gateway.solicitarResumo(x.parametros);
  assert.deepEqual(x.eventos, ["cota", "disparo"]);
  assert.doesNotMatch(JSON.stringify(x.resposta), /Bearer|dono|Fonte oficial integral|hashFonte/);
});

test("cota negada impede despacho e usuário estranho não executa o job", async () => {
  const x = await preparar(); let chamadas = 0;
  const negado = await gateway.solicitarResumo({ ...x.parametros, fonte: "Outra fonte", autorizar: async () => ({ ok: false, status: 429 }), disparar: async () => { chamadas++; } });
  assert.equal(negado.statusCode, 429);
  await gateway.executarResumo({ store: x.store, chave: x.chave, usuario: "outro", cliente: { responses: { create: async () => { chamadas++; } } } });
  assert.equal(chamadas, 0);
});

test("worker usa fonte reservada e CAS impede execução duplicada; cache final não cobra", async () => {
  const x = await preparar(); let chamadas = 0;
  const cliente = { responses: { create: async (request) => {
    chamadas++; assert.match(request.input[1].content, /Fonte oficial integral de teste/);
    return { status: "completed", output_text: JSON.stringify(preencher(schema)), usage: { total_tokens: 987 } };
  } } };
  await Promise.all([gateway.executarResumo({ store: x.store, chave: x.chave, usuario: "dono", cliente }), gateway.executarResumo({ store: x.store, chave: x.chave, usuario: "dono", cliente })]);
  assert.equal(chamadas, 1);
  const resposta = await gateway.solicitarResumo(x.parametros);
  assert.equal(resposta.statusCode, 200);
  assert.equal(resposta.body.metodoResumo, "sintese_gateway");
  assert.equal(require("../../../resumo-modelo").montar(resposta.body.estrutura).secoes.length, 18);
  assert.doesNotMatch(JSON.stringify(resposta), /usoPrivado|total_tokens|cotaAutorizada|Bearer/);
  assert.deepEqual(x.eventos, ["cota", "disparo"]);
});

test("schema incompleto, JSON malformado e resposta interrompida nunca viram resumo concluído", async () => {
  for (const resposta of [{ status: "completed", output_text: "{" }, { status: "completed", output_text: '{"estrutura":{}}' }, { status: "incomplete", output_text: JSON.stringify(preencher(schema)) }]) {
    const x = await preparar();
    await gateway.executarResumo({ store: x.store, chave: x.chave, usuario: "dono", cliente: { responses: { create: async () => resposta } } });
    const publico = await gateway.solicitarResumo(x.parametros);
    assert.equal(publico.statusCode, 503);
    assert.equal(publico.body.estrutura, null);
    assert.doesNotMatch(JSON.stringify(publico), /erroPrivado|schema_invalido|falha_provedor/);
  }
  const estranho = preencher(schema); estranho.estrutura.inventado = "campo";
  assert.equal(gateway.estruturaValida(estranho), false);
});

test("apenas falha transitória tem uma repetição; erro permanente encerra imediatamente", async () => {
  for (const status of [503, 400, 401, 403]) {
    const x = await preparar(); let chamadas = 0;
    await gateway.executarResumo({ store: x.store, chave: x.chave, usuario: "dono", cliente: { responses: { create: async () => { chamadas++; throw Object.assign(new Error("SEGREDO PROVEDOR"), { status }); } } } });
    assert.equal(chamadas, status === 503 ? 2 : 1);
    const publico = await gateway.solicitarResumo(x.parametros);
    assert.equal(publico.statusCode, 503);
    assert.doesNotMatch(JSON.stringify(publico), /SEGREDO/);
  }
});

test("fonte acima do contexto é rejeitada antes de cota ou despacho", async () => {
  let chamadas = 0;
  const resposta = await gateway.solicitarResumo({ store: memoria(), fonte: " a".repeat(210000), ficha: { numeroControlePNCP: "00508903000188-1-001755/2026" }, usuario: "dono", autorizar: async () => { chamadas++; }, disparar: async () => { chamadas++; } });
  assert.equal(resposta.statusCode, 422);
  assert.equal(chamadas, 0);
});

test("worker sem bearer não lê corpo nem acessa provedor", async () => {
  const worker = await import(require("node:url").pathToFileURL(require.resolve("../ia-resumo-background.mjs")).href);
  let leitura = 0;
  await worker.default({ method: "POST", headers: new globalThis.Headers(), json: async () => { leitura++; return { chave: "inválida" }; } });
  assert.equal(leitura, 0);
});

test("job acima de oito minutos não chama provedor e termina com mensagem genérica", async () => {
  const x = await preparar(); let chamadas = 0;
  const agora = Date.now() + 8 * 60 * 1000 + 1;
  await gateway.executarResumo({ store: x.store, chave: x.chave, usuario: "dono", agora, cliente: { responses: { create: async () => { chamadas++; } } } });
  assert.equal(chamadas, 0);
  assert.equal((await gateway.solicitarResumo({ ...x.parametros, agora })).statusCode, 503);
});

test("retomada explícita cobra nova cota somente para dono de job interrompido", async () => {
  for (const status of ["falhou", "processando"]) {
    const x = await preparar();
    const registro = await x.store.getWithMetadata(x.chave);
    await x.store.setJSON(x.chave, { ...registro.data, status, criadoEm: Date.now() - 9 * 60000 });
    assert.equal((await gateway.solicitarResumo(x.parametros)).statusCode, 503);
    assert.equal((await gateway.solicitarResumo({ ...x.parametros, usuario: "outro", retomar: true })).statusCode, 503);
    assert.deepEqual(x.eventos, ["cota", "disparo"]);
    assert.equal((await gateway.solicitarResumo({ ...x.parametros, retomar: true })).statusCode, 202);
    assert.deepEqual(x.eventos, ["cota", "disparo", "cota", "disparo"]);
    await gateway.solicitarResumo({ ...x.parametros, retomar: true });
    assert.equal(x.eventos.length, 4);
  }
});

test("worker que perde CAS na conclusão não publica cache canônico", async () => {
  const x = await preparar();
  const cliente = { responses: { create: async () => {
    const atual = await x.store.getWithMetadata(x.chave);
    await x.store.setJSON(x.chave, { ...atual.data, status: "pendente", criadoEm: Date.now() });
    return { status: "completed", output_text: JSON.stringify(preencher(schema)) };
  } } };
  await gateway.executarResumo({ store: x.store, chave: x.chave, usuario: "dono", cliente });
  assert.equal(await x.store.getWithMetadata(x.parametros.ficha.numeroControlePNCP), null);
  assert.equal((await x.store.getWithMetadata(x.chave)).data.status, "pendente");
});

test("cota recusada expirada não bloqueia outro usuário autorizado", async () => {
  const x = await preparar();
  const parametros = { ...x.parametros, fonte: "Fonte nova sem cota", usuario: "sem-cota", autorizar: async () => ({ ok: false, status: 429 }), agora: Date.now() };
  assert.equal((await gateway.solicitarResumo(parametros)).statusCode, 429);
  const resposta = await gateway.solicitarResumo({ ...parametros, usuario: "autorizado", agora: parametros.agora + 1, autorizar: async () => ({ ok: true }) });
  assert.equal(resposta.statusCode, 202);
  assert.equal(x.eventos.filter(e => e === "disparo").length, 2);
});
