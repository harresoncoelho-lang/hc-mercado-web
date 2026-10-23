const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { conciliarEstruturas } = require("../_resumo_progressivo");
const { complementarRequisitos } = require("../_edital_operacional");
const { conferirEvidenciasDoResumo } = require("../_resumo_evidencias");
const t = require("../lib/ia-edital").__test;
const pasta = path.resolve(__dirname, "../../../docs/qa/editais-reais-novos/88124961000159-125");
const fonte = fs.readFileSync(path.join(pasta, "fonte-com-ocr.txt"), "utf8");

test("caminho final real recupera obrigações omitidas nas nove etapas sem trocar recursos por entrega", () => {
  const estruturas = Array.from({ length: 9 }, (_, i) => JSON.parse(JSON.parse(fs.readFileSync(path.join(pasta, `reteste-ids-integral/resultados-batch/etapa-${String(i + 1).padStart(2, "0")}.json`), "utf8")).resultado.texto));
  const estrutura = conciliarEstruturas(estruturas);
  t.sanitizarListasDoDossie(estrutura);
  complementarRequisitos(estrutura, fonte);
  t.aplicarCamposOperacionaisDoTexto(estrutura, fonte);
  const resultado = conferirEvidenciasDoResumo({ estrutura, textoEdital: fonte });
  const est = resultado.estrutura;
  const outras = est.outrasInformacoesRelevantes.join("\n");
  assert.equal(est.sessaoPublica.modoDisputa, "ABERTO");
  assert.match(outras, /1\.1\..*04 de novembro de 2026.*09:01/);
  assert.match(outras, /1\.2\..*09:00 horas do mesmo dia/);
  assert.match(outras, /12\.1\..*30 \(trinta\) minutos/);
  assert.match(outras, /19\.1\..*5 \(cinco\) dias úteis/);
  assert.match(outras, /7\.2\..*Provisoriamente.*Definitivamente/);
  assert.match(est.analiseCritica.permiteSubcontratacao, /3\.1\..*Não será admitida/);
  assert.match(outras, /1\.2\s+As quantidades constantes.*não se obrigando.*aquisição total/);
  assert.match(outras, /1\.3\s+Não será admitida a adesão/);
  assert.match(outras, /1\.4\s+É vedado efetuar acréscimos nos quantitativos/);
  assert.match(est.anexosDeclaracoes, /Folha de cadastro reserva.*Cadastro Reserva.*página 17/);
  assert.match(outras, /JUSTIFICATIVA PARA PARCELAMENTO.*Nao se aplica a esse processo.*ETP oficial.*página 5/);
  assert.doesNotMatch(JSON.stringify(est.questionamentosDocumentais), /parcelamento.*(?:ilegal|conflito)/i);
  assert.doesNotMatch(est.entregaExecucao.condicoes, /lances|sessão pública|7\.8\.1\./i);
  assert.match(est.documentosHabilitacao.join("\n"), /11\.7\..*consularizados ou registrados no Cartório/);
  assert.doesNotMatch(est.condicoesPagamento, /30 dias|trinta dias|dez dias|10 dias/);
  assert.deepEqual(conferirEvidenciasDoResumo(resultado), resultado);
});

test("releitura da guarda final não duplica pendência documental de prazo vazio", () => {
  const entrada = { textoEdital: "--- Edital.pdf ---\n[Página 1]\n1. O prazo de entrega será XX/XX/2026, a conferir.", estrutura: {} };
  const primeira = conferirEvidenciasDoResumo(entrada);
  const segunda = conferirEvidenciasDoResumo(primeira);
  assert.equal(primeira.estrutura.pendenciasParaConferencia.length, 1);
  assert.deepEqual(segunda, primeira);
});


test("guarda não inventa folha ou seção de parcelamento sem evidência na fonte", () => {
  const r = conferirEvidenciasDoResumo({ textoEdital: "--- Aviso.pdf ---\n[Página 1]\n1. O produto será entregue de forma parcelada.", estrutura: {} }).estrutura;
  assert.doesNotMatch(JSON.stringify(r), /Folha de cadastro reserva|JUSTIFICATIVA PARA PARCELAMENTO|seção de planejamento/i);
});
