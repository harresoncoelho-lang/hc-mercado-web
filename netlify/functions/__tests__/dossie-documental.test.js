const test = require("node:test");
const assert = require("node:assert/strict");
const { montarDossieDaFonte } = require("../lib/ia-edital").__test;

test("dossiê documental preserva condições da contratação, pagamento, reposição e alertas", () => {
  const texto = `--- Edital ---
[Página 25]
14. CONTRATAÇÃO
14.4. A empresa vencedora que se enquadrar nos limites da Lei 4.730/2018 deverá possuir Programa de Integridade.
14.4.1. A empresa que possuir o Programa de Integridade implantado deverá apresentar, no momento da contratação, declaração, emitida por empresa legalmente habilitada, informando a sua existência, e a apresentação do checklist devidamente preenchido.
14.4.2. Se não possuir o programa, implantar em seis meses.
17. RECEBIMENTO
17.2. Se os materiais não corresponderem ao exigido, fazer a substituição dentro de 48 horas do chamamento.
5. DECLARAÇÕES
5.4.10. Declarar programa de integridade.
7. HABILITAÇÃO
7.1.5.4.1. A declaração do subitem 5.4.10 somente deverá ser assinalada para benefício ME/EPP.
--- Termo de Referência ---
[Página 13]
16. FICHAS TÉCNICAS
16.1. Enviar fichas até XX/XX/XXXX, até o terceiro dia útil.
[Página 25]
28. PAGAMENTO
28.1. O pagamento será efetuado em 30 dias após fatura aceita.
`;
  const estrutura = montarDossieDaFonte({ objeto: "Materiais", valor: 0 }, texto, { parcial: true });
  const todos = JSON.stringify(estrutura);
  assert.match(todos, /48 horas/);
  assert.match(estrutura.condicoesPagamento, /30 dias após fatura aceita/);
  assert.match(todos, /Condição de aplicação: 14.4/);
  assert.match(estrutura.pendenciasParaConferencia.join(" "), /prazo sem preenchimento/);
  assert.match(estrutura.pendenciasParaConferencia.join(" "), /Remissão divergente/);
  assert.equal(estrutura.detalhes.valorEstimado, "Não informado");
  assert.equal(estrutura.coberturaLeitura.parcial, true);
});

test("pagamento da dispensa preserva liquidação e condições específicas sem adotar prazo de outro edital", () => {
  const texto = `--- TR.pdf ---
[Página 18]
9. CRITÉRIOS DE MEDIÇÃO E PAGAMENTO
9.20. O pagamento será efetuado no prazo de até 10 dias úteis contados da finalização da liquidação da despesa.
9.21. No atraso por culpa do Contratante, corrigir pelo IPCA.
9.26. O pagamento ao optante Simples fica condicionado à comprovação oficial.
10. SELEÇÃO
10.1. Habilitação.
`;
  const estrutura = montarDossieDaFonte({ objeto: "Informática" }, texto, { parcial: false });
  assert.match(estrutura.condicoesPagamento, /10 dias úteis contados da finalização da liquidação/);
  assert.match(estrutura.condicoesPagamento, /condicionado à comprovação oficial/);
  assert.doesNotMatch(estrutura.condicoesPagamento, /30 dias|10.1/);
});

test("justificativas não repetem doutrina, mas conservam decisão e condições; garantia do produto não vira caução", () => {
  const texto = `--- TR.pdf ---
[Página 8]
4. REQUISITOS DA CONTRATAÇÃO
4.7. O prazo de garantia contratual dos bens é de 12 meses, ou o prazo do fabricante se superior.
4.32. Não haverá exigência de garantia da contratação.
18. PARTICIPAÇÃO DE CONSÓRCIO
Sobre o tema, o doutrinador comenta a história da lei. A vedação quanto à participação de consórcio no presente procedimento licitatório aplica-se, salvo autorização expressa no edital.
19. SUBCONTRATAÇÃO
De acordo com o art. 122 a lei admite subcontratar. Diante disso, para esse procedimento licitatório fica vedada a subcontratação, exceto a assistência previamente autorizada.
`;
  const estrutura = montarDossieDaFonte({}, texto, {});
  assert.match(estrutura.garantias.contrato, /Não haverá exigência/);
  assert.doesNotMatch(estrutura.garantias.contrato, /12 meses/);
  assert.match(estrutura.outrasInformacoesRelevantes.join(" "), /12 meses, ou o prazo do fabricante se superior/);
  assert.match(estrutura.outrasInformacoesRelevantes.join(" "), /salvo autorização expressa/);
  assert.doesNotMatch(estrutura.outrasInformacoesRelevantes.join(" "), /história da lei/);
  assert.match(estrutura.analiseCritica.permiteSubcontratacao, /exceto a assistência previamente autorizada/);
  assert.doesNotMatch(estrutura.analiseCritica.permiteSubcontratacao, /a lei admite subcontratar/);
});
