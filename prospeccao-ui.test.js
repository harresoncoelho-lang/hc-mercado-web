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
  assert.match(html, /saldo 2 de 3/); assert.match(html, /limite de adesão 6 · adesões ainda não consultadas/);
  const colunas = (s, tag) => (s.match(new RegExp(`<${tag}[ >]`, "g")) || []).length;
  for (const tipo of ["pca", "irp", "ata", "contrato"]) {
    assert.equal(colunas(UI.cabecalhoHtml(tipo), "th"), colunas(UI.linhaHtml({ ...l, tipo }, AGORA), "td"), tipo);
  }
});

test("adesão: limite / já aderido / disponível; esgotada marcada; item do PNCP diz que não há saldo", () => {
  const l = { tipo: "ata", fonte: "comprasgov_arp", data_ref: "2027-06-18", quantidade: 10, saldo: 8, maximo_adesao: 6, adesoes_usadas: 4, adesoes_em: "2026-11-19T10:00:00Z", valor_unitario: 5, link: "https://pncp.gov.br/app/atas/1/2025/1/1" };
  assert.match(UI.linhaHtml(l, AGORA), /limite de adesão 6 · já aderido 4 · <b>disponível 2<\/b>/);
  assert.match(UI.linhaHtml({ ...l, adesoes_usadas: 9 }, AGORA), /class="adesao esgotada"[^>]*>.*disponível 0/);
  const pncp = UI.linhaHtml({ ...l, fonte: "pncp", maximo_adesao: null, saldo: null, adesoes_usadas: null, adesoes_em: null, quantidade: 2, fornecedor_nome: "ACME", fornecedor_cnpj: "11222333000181" }, AGORA);
  assert.match(pncp, /2 homologados · saldo e adesões não divulgados no PNCP/);
  assert.doesNotMatch(pncp, /limite de adesão/);
});

test("corpoHtml: nome primeiro, 'só na especificação' recolhido (hidden) atrás de um botão", () => {
  const base = { tipo: "ata", fonte: "pncp", data_ref: "2027-06-18", link: "https://pncp.gov.br/app/atas/1/2025/1/1" };
  const html = UI.corpoHtml([{ ...base, descricao: "PAPEL A4 75G" }, { ...base, descricao: "IMPRESSORA LASER", so_especificacao: true }], AGORA);
  assert.ok(html.indexOf("PAPEL A4") < html.indexOf("btn-espec") && html.indexOf("btn-espec") < html.indexOf("IMPRESSORA"));
  assert.match(html, /<tr class="so-espec" hidden>/);
  assert.match(html, /Mostrar 1 resultado que só cita o termo na especificação/);
  assert.doesNotMatch(UI.corpoHtml([{ ...base, descricao: "PAPEL A4" }], AGORA), /btn-espec|hidden/);
});
