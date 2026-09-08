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

test("mantém uma faixa institucional azul compatível no cabeçalho", () => {
  const html = __test.montarHtml("Resumo", "");
  assert.match(html, /bgcolor="#082243"/);
  assert.match(html, /width="960"/);
  assert.match(html, /background-image:linear-gradient\(#082243,#082243\)/);
  assert.match(html, /name="color-scheme" content="light"/);
  assert.match(html, /logo\.png\?v=20260908/);
  assert.match(html, /LicitaPlena/);
});

test("organiza o e-mail por seções quando recebe o resumo estruturado", () => {
  const html = __test.montarHtml("Resumo simples", "", {
    resumoGeral: "Visão completa da oportunidade.",
    identificacao: { numero: "406/2026", modalidade: "Pregão Eletrônico" },
    sessaoPublica: { data: "22/09/2026", horario: "09:30" },
    orgao: { nome: "Órgão teste" },
    documentosHabilitacao: ["Certidão negativa"],
    itensPncp: [{ descricao: "Papel A4", quantidade: 10, unidade: "caixas" }],
  }, { objeto: "Materiais", modalidade: "Pregão Eletrônico", publicacao: "2026-09-08T10:36:00" });
  assert.match(html, /Identificação da licitação/);
  assert.match(html, /Documentos de habilitação/);
  assert.match(html, /Itens da oportunidade \(1\)/);
  assert.match(html, /Papel A4/);
  assert.match(html, /Pregão Eletrônico/);
  assert.match(html, /Dados oficiais da publicação/);
  assert.match(html, /08\/09\/2026 às 10:36/);
  assert.doesNotMatch(html, />Resumo simples</);
});

test("formata datas ISO em dia/mês/ano sem deslocar o fuso", () => {
  assert.equal(__test.formatarDataHoraBR("2026-09-22"), "22/09/2026");
  assert.equal(__test.formatarDataHoraBR("2026-09-22T09:15"), "22/09/2026 às 09:15");
  assert.equal(__test.formatarDataHoraBR("22/09/2026"), "22/09/2026");
});

test("normaliza destinatários separados por vírgula ou ponto e vírgula sem repetir", () => {
  assert.deepEqual(
    __test.normalizarDestinatarios(" Cliente@Empresa.com;outro@empresa.com, cliente@empresa.com "),
    ["cliente@empresa.com", "outro@empresa.com"],
  );
});
