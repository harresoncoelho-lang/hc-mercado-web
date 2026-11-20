const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("./bdi-calculadora.js");

const base = { tipo: "edificios", regime: "presumido", ac: 400, s: 80, g: 0, r: 97, df: 105, l: 1000, issAliquota: 500, issBase: 10000, pis: 65, cofins: 300, cprb: 0 };

test("lerPct aceita vírgula, ponto e arredonda o 3º decimal para cima, sem float", () => {
  assert.equal(B.lerPct("4,5"), 450);
  assert.equal(B.lerPct("3.65"), 365);
  assert.equal(B.lerPct("1,005"), 101);
  assert.equal(B.lerPct("0,994"), 99);
  assert.equal(B.lerPct("-1"), null);
  assert.equal(B.lerPct("abc"), null);
  assert.equal(B.fmtPct(2870), "28,70%");
  assert.equal(B.fmtPct(5), "0,05%");
});

test("fórmula do TCU: exemplo conferido à mão (AC 4, S 0,8, R 0,97, DF 1,05, L 10, I 8,65 = 28,70%)", () => {
  assert.equal(B.calcularBdi({ ac: 400, s: 80, r: 97, df: 105, l: 1000, i: 865 }).bdi, 2870);
});

test("sem nenhum percentual, BDI é zero; só tributos: 1/(1-I)-1", () => {
  assert.equal(B.calcularBdi({}).bdi, 0);
  assert.equal(B.calcularBdi({ i: 1000 }).bdi, 1111); // 1/0,9 - 1 = 11,111...%
  assert.equal(B.calcularBdi({ i: 5000 }).bdi, 10000);
});

test("arredonda meio para cima uma única vez, no fim", () => {
  // (1,0001)/(1-0,0001) - 1 = 0,00020002 -> 2 centésimos... conferido: 0,02%
  assert.equal(B.calcularBdi({ ac: 1, i: 1 }).bdi, 2);
});

test("G (garantia) entra na soma junto com AC, S e R", () => {
  const a = B.calcularBdi({ ac: 400, s: 50, g: 30, r: 97, df: 105, l: 1000, i: 865 }).bdi;
  assert.equal(a, B.calcularBdi({ ac: 400, s: 80, r: 97, df: 105, l: 1000, i: 865 }).bdi);
});

test("entradas inválidas e tributos >= 100% não calculam", () => {
  assert.ok(B.calcularBdi({ i: 10000 }).erro);
  assert.ok(B.calcularBdi({ ac: -1 }).erro);
  assert.ok(B.calcularBdi({ ac: 1.5 }).erro);
});

test("faixas copiadas do acórdão: 1º quartil <= médio <= 3º quartil, e valores-chave", () => {
  for (const t of Object.values(B.TIPOS)) for (const k of ["bdi", "ac", "sg", "r", "df", "l"]) {
    assert.ok(t[k][0] <= t[k][1] && t[k][1] <= t[k][2], `${t.nome} ${k}`);
  }
  assert.deepEqual(B.TIPOS.edificios.bdi, [2034, 2212, 2500]);
  assert.deepEqual(B.TIPOS.edificios.l, [616, 740, 896]);
  assert.deepEqual(B.TIPOS.portuarias.bdi, [2280, 2748, 3095]);
  assert.deepEqual(B.TIPOS.fornecimento.bdi, [1110, 1402, 1680]);
  assert.deepEqual(B.TIPOS.fornecimento.l, [350, 511, 622]);
  assert.deepEqual(B.TIPOS.energia.ac, [529, 592, 793]);
});

test("semáforo: verde dentro, amarelo até 0,50 p.p., vermelho além", () => {
  const f = [616, 740, 896];
  assert.equal(B.classificar(616, f).estado, "verde");
  assert.equal(B.classificar(896, f).estado, "verde");
  assert.equal(B.classificar(946, f).estado, "amarelo");
  assert.equal(B.classificar(1000, f).estado, "vermelho");
  assert.equal(B.classificar(1000, f).posicao, "acima");
  assert.equal(B.classificar(500, f).estado, "vermelho");
  assert.equal(B.classificar(500, f).posicao, "abaixo");
});

test("avaliar: lucro de 10% em edifícios sai vermelho; BDI final fora da faixa tem posição", () => {
  const r = B.avaliar(base);
  assert.equal(r.bdi, 2870);
  assert.equal(r.i, 865);
  assert.equal(r.linhas.find((l) => l.rotulo.startsWith("Lucro")).estado, "vermelho");
  assert.equal(r.linhas.find((l) => l.rotulo.startsWith("Administração")).estado, "verde");
  assert.equal(r.total.estado, "vermelho");
  assert.equal(r.total.posicao, "acima");
});

test("avaliar: parcelas do TCU para edifícios dão BDI dentro da faixa do tipo", () => {
  const r = B.avaliar({ ...base, ac: 400, s: 80, r: 127, df: 123, l: 740, pis: 65, cofins: 300, issAliquota: 300 });
  assert.equal(r.bdi, 2354); // 1,0607 × 1,0123 × 1,074 / (1 − 0,0665) − 1 = 23,54%
  assert.equal(r.total.estado, "verde");
});

test("S+G compara a soma de S e G com a faixa única do TCU", () => {
  const r = B.avaliar({ ...base, s: 80, g: 50 });
  assert.equal(r.linhas[1].valor, 130);
  assert.equal(r.linhas[1].estado, "amarelo"); // 1,30% vs máx. 1,00%: 0,30 p.p. fora
});

test("ISS: base reduzida muda o ISS efetivo e o BDI; fora de 2% a 5% gera erro", () => {
  const cheio = B.avaliar(base);
  const reduzido = B.avaliar({ ...base, issBase: 5000 }); // 5% sobre 50% da base = 2,50%
  assert.equal(reduzido.issEfetivo, 250);
  assert.ok(reduzido.bdi < cheio.bdi);
  assert.ok(reduzido.avisos.some((a) => /Base de cálculo do ISS/.test(a.texto)));
  assert.ok(B.avaliar({ ...base, issAliquota: 600 }).avisos.some((a) => a.nivel === "erro"));
  assert.ok(!cheio.avisos.some((a) => a.nivel === "erro"));
});

test("regime e CPRB geram avisos; CPRB soma em I", () => {
  const simples = B.avaliar({ ...base, regime: "simples" });
  assert.ok(simples.avisos.some((a) => /Simples Nacional/.test(a.texto)));
  assert.ok(B.avaliar({ ...base, regime: "real" }).avisos.some((a) => /não cumulativo/.test(a.texto)));
  const com = B.avaliar({ ...base, cprb: 450 });
  assert.equal(com.i, 865 + 450);
  assert.ok(com.bdi > B.avaliar(base).bdi);
  assert.ok(com.avisos.some((a) => /CPRB/.test(a.texto)));
});

test("texto para a proposta traz fórmula, fonte, componentes e BDI final", () => {
  const t = B.textoProposta(B.avaliar(base), { regime: "presumido" });
  assert.match(t, /Acórdão TCU 2622\/2013/);
  assert.match(t, /Lucro \(L\)\t10,00%\t6,16% \/ 7,40% \/ 8,96%\tFora da faixa: acima/);
  assert.match(t, /BDI FINAL\t28,70%\t20,34% \/ 22,12% \/ 25,00%/);
});
