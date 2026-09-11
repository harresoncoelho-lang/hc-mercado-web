const fs = require("node:fs");
const path = require("node:path");
const { __test } = require("../netlify/functions/gerar-checklist");

const saida = process.argv[2];
if (!saida) throw new Error("Informe o caminho do DOCX de teste.");

const arquivo = __test.montarDocx({
  numero: "413/2026",
  objeto: "Aquisição de Materiais Hospitalares",
  orgao: "Centro de Serviços Compartilhados",
  modalidade: "Pregão Eletrônico",
  encerramento: "23/09/2026 às 09:15",
}, {
  identificacao: { numero: "413/2026", objeto: "Aquisição de Materiais Hospitalares", modalidade: "Pregão Eletrônico" },
  sessaoPublica: { data: "23/09/2026", horario: "09:30" },
  detalhes: { criterioJulgamento: "Menor preço por item", prazoEntrega: "Conforme termo de referência" },
  orgao: { nome: "Centro de Serviços Compartilhados" },
  documentosHabilitacao: ["Certidão negativa de débitos federais", "Certidão negativa de débitos trabalhistas"],
  declaracoesExigidas: ["Declaração de habilitação", "Declaração de reserva de cargos"],
  pendenciasParaConferencia: ["Conferir todos os anexos do edital antes do envio da proposta"],
  resumoGeral: "Pregão eletrônico para aquisição de materiais hospitalares, com sessão pública em 23 de setembro de 2026.",
});
fs.mkdirSync(path.dirname(saida), { recursive: true });
fs.writeFileSync(saida, arquivo);
