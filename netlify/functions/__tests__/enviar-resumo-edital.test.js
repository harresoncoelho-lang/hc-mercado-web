const test = require("node:test");
const assert = require("node:assert/strict");
const { __test } = require("../enviar-resumo-edital");

test("explica domínio não verificado sem expor a resposta do provedor", () => {
  const erro = __test.mensagemErroZepto(400, JSON.stringify({
    error: { details: [{ code: "SM_111", message: "Sender address domain is not verified" }] },
  }));
  assert.match(erro, /domínio remetente/i);
  assert.doesNotMatch(erro, /Sender address domain/i);
});

test("identifica token inválido do ZeptoMail", () => {
  const erro = __test.mensagemErroZepto(401, JSON.stringify({
    error: { details: [{ code: "SERR_157" }] },
  }));
  assert.match(erro, /chave de envio/i);
});
