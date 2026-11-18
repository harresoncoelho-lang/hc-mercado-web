const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PUBLICOS = ["capag-municipios.json", "convenios.json", "sistema_s_am.json", "mercado_meta.json", "contratos_meta.json"];

function comFixture(verificar) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "licitaplena-publico-dados-"));
  assert.equal(path.dirname(raiz), path.resolve(os.tmpdir()));
  const destino = path.resolve(raiz, "publico");
  assert.equal(path.dirname(destino), raiz);
  const escrever = (nome, conteudo) => {
    fs.mkdirSync(path.dirname(path.join(raiz, nome)), { recursive: true });
    fs.writeFileSync(path.join(raiz, nome), conteudo);
  };
  let modulo;
  try {
    escrever("scripts/montar_publico.js", fs.readFileSync(path.join(__dirname, "montar_publico.js")));
    escrever("index.html", "Página fictícia");
    escrever("_headers", "/*\n  X-Content-Type-Options: nosniff\n");
    for (const nome of PUBLICOS) escrever(`data/${nome}`, JSON.stringify({ publico: nome }));
    escrever("data/editais_vistos.json", '{"destinatario@example.invalid":["edital-ficticio"]}');
    escrever("data/futuro-privado.json", '{"segredoFicticio":true}');
    escrever("data/privado/anexo.json", '{"privadoFicticio":true}');
    escrever("publico/data/editais_vistos.json", "resíduo fictício anterior");
    modulo = require.resolve(path.join(raiz, "scripts/montar_publico.js"));
    verificar({ raiz, destino, builder: require(modulo) });
  } finally {
    if (modulo) delete require.cache[modulo];
    assert.equal(path.dirname(raiz), path.resolve(os.tmpdir()));
    assert.ok(path.basename(raiz).startsWith("licitaplena-publico-dados-"));
    fs.rmSync(raiz, { recursive: true, force: true });
  }
}

test("build publica somente os cinco dados aprovados e preserva o histórico de origem", () => comFixture(({ raiz, destino, builder }) => {
  const historico = fs.readFileSync(path.join(raiz, "data/editais_vistos.json"));
  const copiados = builder.montarPublico();
  assert.deepEqual(fs.readdirSync(path.join(destino, "data")).sort(), [...PUBLICOS].sort());
  for (const nome of PUBLICOS) {
    assert.deepEqual(fs.readFileSync(path.join(destino, "data", nome)), fs.readFileSync(path.join(raiz, "data", nome)));
  }
  assert.deepEqual(fs.readFileSync(path.join(raiz, "data/editais_vistos.json")), historico);
  assert.ok(fs.existsSync(path.join(raiz, "data/futuro-privado.json")));
  assert.ok(fs.existsSync(path.join(raiz, "data/privado/anexo.json")));
  assert.ok(copiados.includes("index.html") && copiados.includes("_headers"));
  assert.deepEqual(builder.arquivosDeDados(), PUBLICOS);
}));

test("build interrompe quando falta dado público obrigatório, sem copiar dados desconhecidos", () => comFixture(({ raiz, destino, builder }) => {
  fs.unlinkSync(path.join(raiz, "data/capag-municipios.json"));
  assert.throws(() => builder.montarPublico(), { code: "ENOENT" });
  assert.equal(fs.existsSync(path.join(destino, "data/editais_vistos.json")), false);
  assert.equal(fs.existsSync(path.join(destino, "data/futuro-privado.json")), false);
  assert.ok(fs.existsSync(path.join(raiz, "data/editais_vistos.json")));
}));
