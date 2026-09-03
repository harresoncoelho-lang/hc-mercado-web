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

test("identifica domínio não verificado quando o código vem no erro principal", () => {
  const erro = __test.mensagemErroZepto(400, JSON.stringify({
    error: { code: "SM_111", message: "Sender domain is not verified" },
  }));
  assert.match(erro, /domínio remetente/i);
  assert.doesNotMatch(erro, /Sender domain/i);
});

test("aceita chave copiada junto com o prefixo do cabeçalho", () => {
  assert.equal(__test.normalizarTokenZepto(' Zoho-enczapikey "chave-do-agent" '), "chave-do-agent");
});

test("identifica mensagem textual de credencial recusada", () => {
  const erro = __test.mensagemErroZepto(400, JSON.stringify({
    error: { code: "TM_4001", message: "Invalid API key" },
  }));
  assert.match(erro, /Send API key/i);
  assert.doesNotMatch(erro, /Invalid API key/i);
});

test("inclui o atalho no e-mail somente para link oficial do PNCP", () => {
  const oficial = "https://pncp.gov.br/app/editais/04191078000191/2026/110";
  assert.equal(__test.linkPncpValido(oficial), true);
  assert.equal(__test.linkPncpValido("https://exemplo.com/edital"), false);
  assert.match(__test.montarHtml("Resumo", oficial), /Abrir licitação no PNCP/);
  assert.doesNotMatch(__test.montarHtml("Resumo", "https://exemplo.com"), /Abrir licitação no PNCP/);
});
