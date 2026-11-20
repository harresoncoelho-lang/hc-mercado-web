const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("./coletar_sinapi");

const EM = "2026-11-19T12:00:00.000Z";
// Recorte do layout real (SINAPI_Referência_2026_10.xlsx): UF na linha 4, dados a partir da 11.
const COMPARTILHADOS = ["AC", "AM", "MATERIAL", "AREIA MÉDIA &amp; LAVADA", "M3", "CR", "Alvenaria", "ALVENARIA DE VEDAÇÃO", "M2"];
const sst = `<sst>${COMPARTILHADOS.map((t, i) => (i === 3 ? `<si><r><t>AREIA MÉDIA </t></r><r><t>&amp; LAVADA</t></r></si>` : `<si><t>${t}</t></si>`)).join("")}</sst>`;
const insumos = `<sheetData>
<row r="4"><c r="F4" t="s"><v>0</v></c><c r="G4" t="s"><v>1</v></c></row>
<row r="10"><c r="B10" t="inlineStr"><is><t>Código</t></is></c></row>
<row r="11"><c r="A11" t="s"><v>2</v></c><c r="B11"><v>370</v></c><c r="C11" t="s"><v>3</v></c><c r="D11" t="s"><v>4</v></c><c r="E11" t="s"><v>5</v></c><c r="F11"><v>99.5</v></c><c r="G11"><v>72.84999999999999</v></c></row>
<row r="12"><c r="A12" t="s"><v>2</v></c><c r="B12"><v>371</v></c><c r="C12" t="s"><v>3</v></c><c r="F12"><v>10</v></c></row>
</sheetData>`;
const composicoes = `<sheetData>
<row r="4"><c r="E4" t="s"><v>0</v></c><c r="G4" t="s"><v>1</v></c></row>
<row r="11"><c r="A11" t="s"><v>6</v></c><c r="B11" s="18"><f>HYPERLINK("#"&amp;CELL("address",OFFSET(Analítico!$B$1,MATCH(104658,Analítico!$B:$B,0)-1,3)),104658)</f><v>0</v></c><c r="C11" t="s"><v>7</v></c><c r="D11" t="s"><v>8</v></c><c r="E11"><v>1</v></c><c r="G11"><v>269.08</v></c><c r="H11"><v>0</v></c></row>
</sheetData>`;

test("textosCompartilhados junta rich text e decodifica entidades", () => {
  const t = S.textosCompartilhados(sst);
  assert.equal(t[3], "AREIA MÉDIA & LAVADA");
  assert.equal(t[1], "AM");
});

test("linhasParaUf (insumo): coluna da UF pela linha 4, preço arredondado a centavo, sem preço na UF fica fora", () => {
  const l = S.linhasParaUf(insumos, S.textosCompartilhados(sst), "ISD", "AM", "2026-10", EM);
  assert.deepEqual(l, [{ uf: "AM", tipo: "insumo", desonerado: false, codigo: "370", descricao: "AREIA MÉDIA & LAVADA", unidade: "M3", grupo: "MATERIAL", origem: "CR",
    preco: "72.85", referencia: "2026-10-01", busca: "areia media & lavada", coletado_em: EM }]);
  assert.equal(S.linhasParaUf(insumos, S.textosCompartilhados(sst), "ICD", "AC", "2026-10", EM).length, 2);
});

test("linhasParaUf (composição): código sai da fórmula HYPERLINK (valor em cache 0)", () => {
  const [c] = S.linhasParaUf(composicoes, S.textosCompartilhados(sst), "CCD", "AM", "2026-10", EM);
  assert.equal(c.codigo, "104658");
  assert.equal(c.tipo, "composicao");
  assert.equal(c.desonerado, true);
  assert.equal(c.preco, "269.08");
  assert.equal(c.origem, null);
  assert.equal(c.grupo, "Alvenaria");
});

test("linhasParaUf recusa layout sem a UF no cabeçalho (não grava lixo)", () => {
  assert.throws(() => S.linhasParaUf(insumos, S.textosCompartilhados(sst), "ISD", "SP", "2026-10", EM), /coluna da UF SP/);
});

test("mapaAbas liga nome da aba ao XML pelo rels", () => {
  const wb = '<sheets><sheet name="Menu" sheetId="1" r:id="rId1"/><sheet name="ISD" sheetId="3" r:id="rId3"/></sheets>';
  const rels = '<Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/><Relationship Id="rId3" Type="x" Target="/xl/worksheets/sheet3.xml"/>';
  assert.deepEqual(S.mapaAbas(wb, rels), { Menu: "xl/worksheets/sheet1.xml", ISD: "xl/worksheets/sheet3.xml" });
});

test("mesesParaTras e nomesDoMes: mês atual primeiro, virada de ano, retificação antes da original", () => {
  assert.deepEqual(S.mesesParaTras(Date.parse("2026-01-10T00:00:00Z"), 3), ["2026-01", "2025-12", "2025-11"]);
  const n = S.nomesDoMes("2026-02");
  assert.equal(n[0], "SINAPI-2026-02-formato-xlsx_Retificacao03.zip");
  assert.equal(n[n.length - 1], "SINAPI-2026-02-formato-xlsx.zip");
});
