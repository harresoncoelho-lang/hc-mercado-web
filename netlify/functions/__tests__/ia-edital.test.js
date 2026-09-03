const test = require("node:test");
const assert = require("node:assert/strict");

function carregarComModelo(modelo) {
  const caminho = require.resolve("../ia-edital");
  const anterior = process.env.GROQ_MODEL;
  if (modelo) process.env.GROQ_MODEL = modelo;
  else delete process.env.GROQ_MODEL;
  delete require.cache[caminho];
  const modulo = require("../ia-edital");
  if (anterior === undefined) delete process.env.GROQ_MODEL;
  else process.env.GROQ_MODEL = anterior;
  return modulo;
}

test("ia-edital usa GPT-OSS 20B como modelo padrão suportado", async () => {
  const fetchOriginal = global.fetch;
  const modelos = [];
  global.fetch = async (_url, opcoes) => {
    modelos.push(JSON.parse(opcoes.body).model);
    return { ok: true, json: async () => ({ choices: [{ message: { content: "Resumo pronto" } }] }) };
  };
  try {
    const { __test } = carregarComModelo(null);
    const resposta = await __test.chamarGroq("chave-teste", [{ role: "user", content: "teste" }]);
    assert.equal(resposta.ok, true);
    assert.deepEqual(modelos, ["openai/gpt-oss-20b"]);
  } finally {
    global.fetch = fetchOriginal;
  }
});

test("ia-edital troca automaticamente um modelo aposentado pelo modelo suportado", async () => {
  const fetchOriginal = global.fetch;
  const modelos = [];
  global.fetch = async (_url, opcoes) => {
    const modelo = JSON.parse(opcoes.body).model;
    modelos.push(modelo);
    if (modelo === "modelo-aposentado") {
      return { ok: false, status: 404, text: async () => '{"error":{"code":"model_not_found"}}' };
    }
    return { ok: true, json: async () => ({ choices: [{ message: { content: "Resumo pronto" } }] }) };
  };
  try {
    const { __test } = carregarComModelo("modelo-aposentado");
    const resposta = await __test.chamarGroq("chave-teste", [{ role: "user", content: "teste" }]);
    assert.equal(resposta.ok, true);
    assert.deepEqual(modelos, ["modelo-aposentado", "openai/gpt-oss-20b"]);
  } finally {
    global.fetch = fetchOriginal;
  }
});
