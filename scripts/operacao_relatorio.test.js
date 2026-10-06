const test = require("node:test");
const assert = require("node:assert/strict");
const { gerarHtml } = require("../operacao-relatorio");

test("relatório resume a oportunidade e mostra somente itens ganhos", () => {
  const html = gerarHtml({
    processo: { objeto: "Aquisição de material", numero: "12/2026", orgao: "Prefeitura", status: "homologado", documentos_exigidos: ["Certidão fiscal"], data_sessao: "2026-10-15T12:00:00Z" },
    empresa: { razao_social: "Empresa de teste" },
    resultado: { situacao: "vitoria_parcial", ganhos: 1, total: 2, valor: 100 },
    itens: [
      { tipo: "item", identificador: "1", descricao: "Caneta azul", marca: "Marca A", modelo: "Modelo B", quantidade: 2, valor_unitario_homologado: 50, situacao: "ganho", valor_homologado: 100 },
      { tipo: "item", identificador: "2", descricao: "Lápis preto", situacao: "perdido" },
    ],
  });
  for (const texto of ["Empresa de teste", "Prefeitura", "15/10/2026", "Caneta azul", "Marca A / Modelo B", "Unitário homologado", "Total homologado à empresa nestes itens"]) assert.match(html, new RegExp(texto));
  assert.match(html, /Itens\/lotes ganhos \(1\)/);
  for (const texto of ["Certidão fiscal", "Lápis preto", "Checklist de habilitação", "Relatório cronológico"]) assert.doesNotMatch(html, new RegExp(texto));
  assert.match(html, /@page\{size:A4/);
});

test("relatório sem ganhos não sugere vitória e escapa dados", () => {
  const html = gerarHtml({
    processo: { objeto: '<script>alert("x")</script>', numero: "9/2026" },
    resultado: { situacao: "nao_apurado", ganhos: 0, total: 0, valor: null },
    itens: [{ descricao: "Teste", situacao: "pendente" }],
  });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Nenhum item\/lote ganho registrado/);
  assert.doesNotMatch(html, /<td>Teste<\/td>/);
});

test("vitória geral sem itens detalhados fica explicitamente pendente", () => {
  const html = gerarHtml({ processo: { objeto: "Compra" }, resultado: { situacao: "vitoria_total", valor: null } });
  assert.match(html, /Vitória informada, mas os itens\/lotes ganhos ainda não foram detalhados/);
});
