const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("./busca-avancada.js");
const base = require("./data/municipios-centroides.json");
const indice = B.criarIndice(base);

test("haversine: Manaus a Belém ~1290 km, mesmo ponto = 0", () => {
  const manaus = B.coordenada(indice, "Manaus", "AM"), belem = B.coordenada(indice, "BELÉM", "pa");
  assert.ok(manaus && belem, "centroides existem e casam sem acento/caixa");
  const d = B.distanciaKm(manaus, belem);
  assert.ok(d > 1250 && d < 1330, String(d));
  assert.equal(B.distanciaKm(manaus, manaus), 0);
});
test("base cobre os 27 estados e ~5570 municípios", () => {
  assert.ok(base.m.length >= 5570);
  assert.equal(new Set(base.m.map((l) => l[1])).size, 27);
});
test("origem do texto 'Cidade - UF' e sugestões sem acento", () => {
  assert.equal(B.origemDoTexto(indice, "Manaus - AM").uf, "AM");
  assert.equal(B.origemDoTexto(indice, "Cidade Que Nao Existe - AM"), null);
  assert.equal(B.origemDoTexto(indice, "Manaus").uf, "AM");
  assert.equal(B.origemDoTexto(indice, "Bom Jesus"), null, "nome repetido em vários estados exige a UF");
  assert.ok(B.sugerirCidades(indice, "sao pau").includes("São Paulo - SP"));
  assert.deepEqual(B.sugerirCidades(indice, "m"), []);
});
test("raio: 100 km de Manaus fica no AM; 600 km de São Paulo inclui RJ e MG", () => {
  assert.deepEqual(B.ufsNoRaio(indice, B.origemDoTexto(indice, "Manaus - AM"), 100), ["AM"]);
  const sp = B.ufsNoRaio(indice, B.origemDoTexto(indice, "São Paulo - SP"), 600);
  for (const u of ["SP", "RJ", "MG", "PR"]) assert.ok(sp.includes(u), u);
  assert.ok(!sp.includes("AM"));
});
test("dentroDoRaio: perto true, longe false, município desconhecido null", () => {
  const o = B.origemDoTexto(indice, "Campinas - SP");
  assert.equal(B.dentroDoRaio(indice, o, 50, "SÃO PAULO", "SP"), false);
  assert.equal(B.dentroDoRaio(indice, o, 120, "SÃO PAULO", "SP"), true);
  assert.equal(B.dentroDoRaio(indice, o, 50, "Manaus", "AM"), false);
  assert.equal(B.dentroDoRaio(indice, o, 50, "", "SP"), null);
});
test("regiões: 27 UFs sem repetição", () => {
  const todas = Object.values(B.REGIOES).flat();
  assert.equal(todas.length, 27);
  assert.equal(new Set(todas).size, 27);
});
test("exclusões: ignora acento e caixa, lista vazia não exclui", () => {
  assert.equal(B.textoExcluido("Aquisição de Veículos LEVES", "veiculo, obra"), true);
  assert.equal(B.textoExcluido("Material de limpeza", "veiculo, obra"), false);
  assert.equal(B.textoExcluido("qualquer", ""), false);
});
test("limparFiltro: só campos permitidos, limites e UF/raio inválidos descartados", () => {
  const f = B.limparFiltro({ palavrasRaw: " limpeza ", ufs: ["am", "xx1", "AM"], regiao: "Atlantida", raio: { municipio: "Manaus", uf: "am", km: 99999 }, cpf: "123", municipio: "Manaus" });
  assert.deepEqual(f, { palavrasRaw: "limpeza", ufs: ["AM"], municipio: "Manaus" });
  const g = B.limparFiltro({ palavrasRaw: "a", regiao: "Sul", raio: { municipio: "Manaus", uf: "am", km: 150.4 }, excluir: "obra" });
  assert.deepEqual(g.raio, { municipio: "Manaus", uf: "AM", km: 150 });
  assert.equal(g.regiao, "Sul");
  assert.equal(B.limparFiltro(null).palavrasRaw, "");
});
test("nome do filtro: espaços normalizados, vazio e longo recusados", () => {
  assert.equal(B.nomeValido("  Limpeza   AM "), "Limpeza AM");
  assert.equal(B.nomeValido("   "), null);
  assert.equal(B.nomeValido("x".repeat(61)), null);
});
test("descrição para a IA perde e-mail, telefone, CPF/CNPJ e links", () => {
  const t = B.limparDescricao("vendo limpeza, falar com joao@x.com ou (92) 99999-1234, CNPJ 11.222.333/0001-81 CPF 123.456.789-09 https://site.com/x www.site.com");
  assert.ok(!/@|\d{3}|http|www/.test(t), t);
  assert.ok(t.startsWith("vendo limpeza"));
  assert.equal(B.limparDescricao("a".repeat(500)).length, 300);
});
test("sugestão da IA: limpa, sem repetição, sem dado pessoal, com tetos", () => {
  const s = B.sanitizarSugestao({ palavras: ["Limpeza", "limpeza", "ab", "x@y.com", "detergente, extra", 5, null], variacoes: ["Limpezas", "LIMPEZA", "cnpj 12345678"], exclusoes: Array.from({ length: 20 }, (_, i) => `termo ${i}ab`) });
  assert.deepEqual(s.palavras, ["limpeza", "detergente extra"]);
  assert.deepEqual(s.variacoes, ["limpezas"]);
  assert.equal(s.exclusoes.length, 8);
  assert.deepEqual(B.sanitizarSugestao("lixo"), { palavras: [], variacoes: [], exclusoes: [] });
});
test("extrairJson aceita cerca de texto e recusa lixo", () => {
  assert.deepEqual(B.extrairJson('```json\n{"palavras":["a"]}\n```'), { palavras: ["a"] });
  assert.equal(B.extrairJson("sem json"), null);
  assert.equal(B.extrairJson("{quebrado"), null);
});
test("momento do aviso: hora de Brasília e antecedência em dias", () => {
  // prazo 20/11 17:00 BRT = 20:00Z; aviso 2 dias antes às 07h BRT = 18/11 10:00Z
  assert.equal(new Date(B.momentoDoAviso("2026-11-20T20:00:00Z", 2, 7)).toISOString(), "2026-11-18T10:00:00.000Z");
  assert.equal(new Date(B.momentoDoAviso("2026-11-20T20:00:00Z", 0, 8)).toISOString(), "2026-11-20T11:00:00.000Z");
  // prazo 01:00Z de 21/11 ainda é 20/11 em Brasília
  assert.equal(new Date(B.momentoDoAviso("2026-11-21T01:00:00Z", 1, 8)).toISOString(), "2026-11-19T11:00:00.000Z");
  assert.equal(B.momentoDoAviso("lixo", 1, 8), null);
});
