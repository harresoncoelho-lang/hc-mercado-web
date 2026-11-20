const test = require("node:test");
const assert = require("node:assert/strict");
const { validarDiagnostico, handler } = require("../extensao-diagnostico");

const base = () => ({ versao: 1, fluxo: "acompanhar", motivo: "chat_vazio", extensao: "0.4.0",
  pagina: { host: "cnetmobile.estaleiro.serpro.gov.br", caminho: "/comprasnet-web/seguro/fornecedor/disputa", compra: "16013705000332026", titulo: "Compras", largura: 1366, carregando: false },
  seletores: { ".mensagens-texto": 0, "app-mensagens-chat-lista": 1 },
  nos: [{ t: "body", p: 0 }, { t: "div", p: 1, c: ["sala-chat"], a: { "data-test": "chat", value: "segredo" } }], cortado: false });

test("diagnóstico válido passa; chaves fora da allowlist (value) somem", () => {
  const v = validarDiagnostico(base());
  assert.equal(v.erro, undefined);
  assert.deepEqual(v.dados.estrutura.nos[1], { t: "div", p: 1, c: ["sala-chat"], a: { "data-test": "chat" } });
  assert.equal(v.dados.estrutura.pagina.compra, "16013705000332026");
  assert.deepEqual([v.dados.fluxo, v.dados.host, v.dados.versao_extensao], ["acompanhar", "cnetmobile.estaleiro.serpro.gov.br", "0.4.0"]);
});

test("barreira do servidor: CPF e sequências de dígitos são mascarados mesmo se a extensão falhar", () => {
  const d = base();
  d.nos.push({ t: "span", p: 2, tx: "Usuário 123.456.789-09 FULANA", id: "x12345678909", c: ["c-97048143215"], a: { title: "CNPJ 33.442.649/0001-11" }, valor: "11,87" });
  d.pagina.titulo = "CPF 12345678909";
  const v = validarDiagnostico(d);
  const json = JSON.stringify(v.dados);
  assert.doesNotMatch(json, /123\.456|12345678909|97048143215|33\.442|11,87|valor/);
});

test("recusa: fluxo, host fora do portal, sem nós, tag inválida, versão errada", () => {
  for (const [mudar, erro] of [
    [(d) => { d.fluxo = "lances"; }, /fluxo/],
    [(d) => { d.pagina.host = "evil.com"; }, /Compras\.gov/],
    [(d) => { d.pagina.caminho = "x"; }, /caminho/],
    [(d) => { d.nos = []; }, /nos/],
    [(d) => { d.nos = Array.from({ length: 4001 }, () => ({ t: "div" })); }, /nos/],
    [(d) => { d.nos[0].t = "<script>"; }, /tag/],
    [(d) => { d.versao = 2; }, /versao/],
  ]) {
    const d = base(); mudar(d);
    assert.match(validarDiagnostico(d).erro, erro);
  }
  assert.match(validarDiagnostico(null).erro, /inválido/);
});

test("handler: só POST e só logado", async () => {
  assert.equal((await handler({ httpMethod: "GET", headers: {} })).statusCode, 405);
  const r = await handler({ httpMethod: "POST", headers: {}, body: JSON.stringify(base()) });
  assert.equal(r.statusCode, 401);
});
