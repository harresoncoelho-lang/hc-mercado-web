const test = require("node:test");
const assert = require("node:assert/strict");
const { apurarItens, resultadoEfetivo } = require("../operacao-acompanhamento");

test("não inventa vitória nem valor sem itens ou resultado explícito", () => {
  assert.equal(apurarItens([]), null);
  assert.deepEqual(resultadoEfetivo({}, []), {
    situacao: "nao_apurado", valor: null, ganhos: 0, total: 0, valorCompleto: false,
  });
});

test("vitória parcial soma somente itens ganhos com valor homologado", () => {
  assert.deepEqual(apurarItens([
    { situacao: "ganho", valor_homologado: 120.50 },
    { situacao: "perdido", valor_homologado: null },
  ]), { situacao: "vitoria_parcial", valor: 120.5, ganhos: 1, total: 2, valorCompleto: true });
});

test("valor ausente em item ganho permanece desconhecido", () => {
  const resultado = apurarItens([{ situacao: "ganho", valor_homologado: null }]);
  assert.equal(resultado.situacao, "vitoria_total");
  assert.equal(resultado.valor, null);
  assert.equal(resultado.valorCompleto, false);
});

test("itens pendentes não viram derrota ou homologação total", () => {
  assert.equal(apurarItens([{ situacao: "ganho", valor_homologado: 10 }, { situacao: "pendente" }]).situacao, "em_disputa");
});

test("itens não disputados não viram participação sem vitória", () => {
  assert.equal(apurarItens([{ situacao: "nao_disputado" }, { situacao: "nao_disputado" }]).situacao, "nao_participou");
});
