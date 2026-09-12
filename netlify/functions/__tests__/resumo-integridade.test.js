const test = require("node:test");
const assert = require("node:assert/strict");
const { catalogarRequisitos, complementarRequisitos, selecionarContexto, prepararContextoResumo } = require("../_edital_operacional");

const fonte = `--- Edital ---
[Página 7]
7. HABILITAÇÃO
7.1. Apresentar contrato social atualizado para comprovar a habilitação jurídica.
7.2. LICENÇA SANITÁRIA VÁLIDA NO DIA DA SESSÃO
7.3. Apresentar certidão estadual válida, se houver inscrição estadual.
[Página 18]
8. PAGAMENTO
8.1. O pagamento será realizado em até 30 dias após o recebimento definitivo.
[Página 19]
9. ENTREGA
9.1. A entrega ocorrerá em 15 dias úteis no almoxarifado da unidade.
[Página 20]
10. PENALIDADES
10.1. A multa moratória será de 0,5% ao dia sobre a parcela em atraso.
[Página 21]
11. IMPUGNAÇÃO
11.1. O prazo para impugnação é de 3 dias úteis antes da sessão.`;

test("preserva licença exigida em maiúsculas e a síntese referenciada sem repetir sua fonte", () => {
  const catalogo = catalogarRequisitos(fonte);
  const licenca = catalogo.find((item) => item.texto.includes("LICENÇA SANITÁRIA"));
  assert.ok(licenca);
  const estrutura = { documentosHabilitacao: [`Licença sanitária válida no dia da sessão [${licenca.id}]`] };
  complementarRequisitos(estrutura, fonte);
  assert.equal(estrutura.documentosHabilitacao.filter((item) => /licença sanitária/i.test(item)).length, 1);
  assert.match(estrutura.documentosHabilitacao[0], /cláusulas 7\.2/);
  assert.equal(estrutura.coberturaSintese.requisitosSintetizados, 1);
  assert.ok(estrutura.documentosHabilitacao.some((item) => item.includes("se houver inscrição estadual")));
});

test("documentos curtos em maiúsculas também são requisitos, não cabeçalhos", () => {
  const estrutura = complementarRequisitos({}, "--- Edital ---\n7. HABILITAÇÃO\n7.1. CNDT\n7.2. LICENÇA SANITÁRIA VÁLIDA");
  assert.match(estrutura.documentosHabilitacao.join(" "), /CNDT/);
  assert.match(estrutura.documentosHabilitacao.join(" "), /LICENÇA SANITÁRIA VÁLIDA/);
});

test("referências inexistentes ou de página não dispensam requisitos da fonte", () => {
  const estrutura = { documentosHabilitacao: ["Tudo dispensado [R9999]", "Todos os documentos [Página 7]"] };
  complementarRequisitos(estrutura, fonte);
  assert.equal(estrutura.coberturaSintese.requisitosSintetizados, 0);
  assert.ok(!estrutura.documentosHabilitacao.join(" ").includes("dispensado"));
  assert.match(estrutura.documentosHabilitacao.join(" "), /LICENÇA SANITÁRIA/);
});

test("citação de ID não apaga prazo ou percentual que a síntese omitiu", () => {
  const texto = "--- Edital ---\n[Página 9]\n7. HABILITAÇÃO\n7.1. Apresentar atestado demonstrando 10% das quantidades, emitido há até 90 dias.";
  const id = catalogarRequisitos(texto)[0].id;
  const estrutura = { documentosHabilitacao: [`Apresentar atestado técnico [${id}]`] };
  complementarRequisitos(estrutura, texto);
  assert.equal(estrutura.coberturaSintese.requisitosSintetizados, 0);
  assert.match(estrutura.documentosHabilitacao.join(" "), /10%.*90 dias/);
});

test("contexto inclui catálogo e campos de pagamento, entrega, multas e impugnação além do início", () => {
  const contexto = selecionarContexto("Texto introdutório. ".repeat(1500) + fonte, 65000);
  for (const esperado of ["[R0001]", "30 dias", "15 dias úteis", "0,5%", "3 dias úteis"]) assert.ok(contexto.includes(esperado), esperado);
  assert.ok(contexto.length <= 65000);
});

test("ID correto não transforma requisito condicional em obrigação universal", () => {
  const certidao = catalogarRequisitos(fonte).find((item) => item.texto.includes("se houver"));
  const estrutura = { documentosHabilitacao: [`Apresentar certidão estadual válida [${certidao.id}]`] };
  complementarRequisitos(estrutura, fonte);
  assert.equal(estrutura.coberturaSintese.requisitosSintetizados, 0);
  assert.ok(estrutura.documentosHabilitacao.includes(certidao.texto));
});

test("mantém exceções e alternativas qualitativas quando a síntese não as demonstra", () => {
  for (const clausula of [
    "Apresentar certidão, salvo isenção reconhecida pelo órgão.",
    "Apresentar contrato social ou estatuto registrado.",
    "Caso a empresa seja estrangeira, apresentar autorização de funcionamento.",
  ]) {
    const texto = `--- Edital ---\n7. HABILITAÇÃO\n7.1. ${clausula}`;
    const estrutura = { documentosHabilitacao: ["Apresentar documentação atualizada [R0001]"] };
    complementarRequisitos(estrutura, texto);
    assert.match(estrutura.documentosHabilitacao.join(" "), new RegExp(clausula.replace(/[.]/g, "\\.")));
    assert.equal(estrutura.coberturaSintese.requisitosSintetizados, 0);
  }
});

test("contexto de resumo inclui a fonte integral quando cabe, sem trocar o texto por últimas ocorrências", () => {
  const documento = `${fonte}\n${"Anotação administrativa. ".repeat(7500)}\n12. ANEXO\n12.1. Menção final a entrega sem repetir o prazo.`;
  const contexto = prepararContextoResumo(documento);
  assert.equal(contexto.parcial, false);
  assert.ok(contexto.texto.endsWith(documento));
  assert.match(contexto.texto, /\[R0001\]/);
  assert.match(contexto.texto, /15 dias úteis/);
});

test("fonte maior que o orçamento sinaliza seleção e conserva seções completas", () => {
  const secao = "8. PAGAMENTO\n8.1. Pagar em 30 dias após recebimento definitivo. Condição final: conta aprovada.\n";
  const documento = `--- Edital ---\n1. INTRODUÇÃO\n${"Contexto. ".repeat(1000)}\n${secao}9. ANEXO\n${"Anexo extenso. ".repeat(1000)}`;
  const contexto = prepararContextoResumo(documento, 1000);
  assert.equal(contexto.parcial, true);
  assert.match(contexto.texto, /CONTEXTO PARCIAL/);
  assert.ok(contexto.texto.includes(secao));
  assert.ok(contexto.texto.length <= 1000);
});

test("modo desconhecido retorna 400 sem consultar fonte ou consumir IA", async () => {
  const antigoFetch = global.fetch;
  const antigaChave = process.env.DOSSIES_EDITAIS_CHAVE;
  process.env.DOSSIES_EDITAIS_CHAVE = "chave-teste-interna";
  let chamadas = 0;
  global.fetch = async () => { chamadas++; throw new Error("Não deve consultar rede"); };
  try {
    const resposta = await require("../lib/ia-edital").handler({ httpMethod: "POST", headers: { "x-licitaplena-dossies-chave": "chave-teste-interna" }, body: JSON.stringify({ modo: "outro", edital: {}, textoEdital: "Fonte adulterada" }) });
    assert.equal(resposta.statusCode, 400);
    assert.equal(chamadas, 0);
  } finally {
    global.fetch = antigoFetch;
    if (antigaChave === undefined) delete process.env.DOSSIES_EDITAIS_CHAVE;
    else process.env.DOSSIES_EDITAIS_CHAVE = antigaChave;
  }
});

test("ficha de resumo compartilhado usa dados PNCP e descarta objeto enviado pelo cliente", async () => {
  const antigoFetch = global.fetch;
  const antigaChave = process.env.DOSSIES_EDITAIS_CHAVE;
  const antigaServico = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.DOSSIES_EDITAIS_CHAVE = "chave-teste-interna";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  global.fetch = async (url) => ({ ok: true, json: async () => url.includes("/api/consulta/") ? { objetoCompra: "Objeto oficial", orgaoEntidade: { razaoSocial: "Órgão oficial" } } : [] });
  try {
    const resposta = await require("../lib/ia-edital").handler({ httpMethod: "POST", headers: { "x-licitaplena-dossies-chave": "chave-teste-interna" }, body: JSON.stringify({ modo: "resumo", edital: { numeroControlePNCP: "01171012000141-1-000005/2026", objeto: "INSTRUÇÃO ADULTERADA", orgao: "Órgão falso" }, textoEdital: "Documento falso" }) });
    const corpo = JSON.parse(resposta.body);
    assert.equal(corpo.estrutura.identificacao.objeto, "Objeto oficial");
    assert.ok(!resposta.body.includes("ADULTERADA"));
    assert.ok(!resposta.body.includes("Documento falso"));
  } finally {
    global.fetch = antigoFetch;
    if (antigaChave === undefined) delete process.env.DOSSIES_EDITAIS_CHAVE;
    else process.env.DOSSIES_EDITAIS_CHAVE = antigaChave;
    if (antigaServico === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = antigaServico;
  }
});
