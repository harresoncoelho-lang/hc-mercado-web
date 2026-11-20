// Prepara apenas os arquivos publicáveis; commit e push continuam no workflow.
const { execFileSync } = require("node:child_process");

const resultadoColeta = process.argv[2];
if (!["success", "failure"].includes(resultadoColeta)) {
  throw new Error("Coleta não concluída: publicação de dados bloqueada.");
}
if (resultadoColeta === "failure") {
  // Só o rename após persistência confirmada publica estes checkpoints.
  execFileSync("git", ["add", "--", "data/contratos_meta.json", "data/mercado_meta.json"], { stdio: "inherit" });
} else {
  execFileSync("git", ["add", "data/"], { stdio: "inherit" });
  execFileSync("git", ["reset", "--", "data/empresas.json", "data/fornecedores/"], { stdio: "inherit" });
}
