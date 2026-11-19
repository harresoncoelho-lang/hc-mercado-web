const test = require("node:test");
const assert = require("node:assert/strict");
const UI = require("./prospeccao-ui.js");

const AGORA = Date.parse("2026-11-19T15:00:00Z");

test("diasAte conta dias corridos de hoje em Brasília", () => {
  assert.equal(UI.diasAte("2026-11-19", AGORA), 0);
  assert.equal(UI.diasAte("2027-02-17", AGORA), 90);
  assert.equal(UI.diasAte(null, AGORA), null);
});

test("linhaHtml escapa texto da fonte e só aceita link oficial", () => {
  const base = { tipo: "contrato", fonte: "pncp", orgao_nome: "<img src=x onerror=alert(1)>", objeto: "Limpeza", data_ref: "2026-12-01", valor_total: 1000, fornecedor_nome: "ACME", fornecedor_cnpj: "11222333000181" };
  const ok = UI.linhaHtml({ ...base, link: "https://pncp.gov.br/app/contratos/1/2026/1" }, AGORA);
  assert.ok(!ok.includes("<img"));
  assert.match(ok, /href="https:\/\/pncp\.gov\.br\/app\/contratos\/1\/2026\/1"/);
  assert.match(ok, /em 12 dias/);
  const mau = UI.linhaHtml({ ...base, link: "javascript:alert(1)" }, AGORA);
  assert.ok(!mau.includes("href="));
});

test("ata do Compras.gov mostra saldo e limite de adesão; colunas batem com o cabeçalho", () => {
  const l = { tipo: "ata", fonte: "comprasgov_arp", data_ref: "2027-06-18", quantidade: 3, saldo: 2, maximo_adesao: 6, valor_unitario: 742, link: "https://pncp.gov.br/app/atas/1/2025/1/1" };
  const html = UI.linhaHtml(l, AGORA);
  assert.match(html, /saldo 2 de 3 · adesão até 6/);
  const colunas = (s, tag) => (s.match(new RegExp(`<${tag}[ >]`, "g")) || []).length;
  for (const tipo of ["pca", "irp", "ata", "contrato"]) {
    assert.equal(colunas(UI.cabecalhoHtml(tipo), "th"), colunas(UI.linhaHtml({ ...l, tipo }, AGORA), "td"), tipo);
  }
});
