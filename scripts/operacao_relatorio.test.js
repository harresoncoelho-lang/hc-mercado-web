const test = require("node:test");
const assert = require("node:assert/strict");
const { gerarHtml } = require("../operacao-relatorio");

test("relatório reúne identificação, checklist, itens, prazos, execução e anexos", () => {
  const html = gerarHtml({
    processo: { objeto: "Aquisição de material", numero: "12/2026", orgao: "Prefeitura", decisao: "participar", status: "triagem", documentos_exigidos: ["Certidão fiscal"], checklist_fonte: "resumo", data_sessao: "2026-10-15T12:00:00Z", preco_proposta: 90 },
    empresa: { razao_social: "Empresa de teste", cnpj: "12345678000199" },
    resultado: { situacao: "em_disputa", ganhos: 0, total: 1, valor: null },
    itens: [{ tipo: "item", identificador: "1", descricao: "Caneta", situacao: "pendente", quantidade: 10 }],
    itensOficiais: [{ numero: 1, descricao: "Caneta azul", quantidade: 10, unidade: "UN" }],
    ocorrencias: [{ categoria: "chat", descricao: "Lance informado", ocorrido_em: "2026-10-15T13:00:00Z" }],
    prazos: [{ categoria: "proposta", titulo: "Enviar proposta", vencimento: "2026-10-14T12:00:00Z" }],
    contratos: [{ numero: "C-1", situacao: "vigente", valor: 100 }],
    empenhos: [{ numero: "E-1", valor: 100, saldo: 40 }],
    anexos: [{ tipo: "contrato", titulo: "Contrato assinado", arquivo_nome: "contrato.pdf" }],
    emitidoEm: "2026-10-06T12:00:00Z",
  });
  for (const texto of ["Empresa de teste", "Certidão fiscal", "Caneta azul", "Em disputa", "Lance informado", "Enviar proposta", "C-1", "E-1", "contrato.pdf"]) assert.match(html, new RegExp(texto));
  assert.match(html, /@page\{size:A4/);
  assert.doesNotMatch(html, /Vitória total/);
});

test("relatório escapa informações digitadas por usuários e informa fonte não consultada", () => {
  const html = gerarHtml({ processo: { objeto: '<script>alert("x")</script>', documentos_exigidos: ["<img src=x>"] }, resultado: { situacao: "nao_apurado", ganhos: 0, total: 0, valor: null } });
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Itens oficiais não consultados nesta emissão/);
});
