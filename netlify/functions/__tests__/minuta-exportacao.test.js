const test = require("node:test");
const assert = require("node:assert/strict");
const AdmZip = require("adm-zip");
const { handler } = require("../gerar-checklist");

async function exportar(minuta) {
  const anterior = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ id: "usuario-teste" }));
  try { return await handler({ httpMethod: "POST", headers: { authorization: "Bearer teste" }, body: JSON.stringify({ minuta }) }); }
  finally { global.fetch = anterior; }
}
test("minuta revisada exporta DOCX com XML escapado, sem chamada de geração", async () => {
  const r = await exportar({ tipo: "esclarecimento", revisado: true, texto: "Pedido de esclarecimento\nTR.pdf, página 14: A & B <script>alert(1)</script>" });
  assert.equal(r.statusCode, 200);
  const xml = new AdmZip(Buffer.from(r.body, "base64")).readAsText("word/document.xml");
  assert.match(xml, /TR.pdf, página 14/);
  assert.match(xml, /A &amp; B &lt;script&gt;/);
  assert.doesNotMatch(xml, /<script>/);
});
test("exportação recusa peça não revisada, tipo desconhecido e texto excessivo", async () => {
  for (const m of [{ tipo: "impugnacao", revisado: false, texto: "Texto da minuta" }, { tipo: "protocolo", revisado: true, texto: "Texto" }, { tipo: "esclarecimento", revisado: true, texto: "x".repeat(50001) }]) assert.equal((await exportar(m)).statusCode, 422);
});
test("exportação recusa caracteres inválidos no XML", async () => {
  for (const texto of ["Pedido\u0001Texto", "Pedido\uD800Texto"]) assert.equal((await exportar({ tipo: "esclarecimento", revisado: true, texto })).statusCode, 422);
  assert.equal((await exportar({ tipo: "esclarecimento", revisado: true, texto: "Pedido 📄\nTexto" })).statusCode, 200);
});
