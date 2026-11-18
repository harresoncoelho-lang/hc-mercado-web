// Executa os harnesses existentes sem sobrescrever evidências anteriores.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
async function verificar() {
  for (const [arquivo, antigo, novo] of [
    ['verificar-kit-documentos.cjs', "const evidencias = path.join(__dirname, 'kit-persistente-20261030');", "const evidencias = path.join(__dirname, 'jornada-cadastro-20261031/t1-kit-regressao');"],
    ['verificar-kit-processos.cjs', 'const arquivos=new Set([', "const arquivos=new Set(['operacao-identificacao.js',"]
  ]) {
    const absoluto = path.resolve(__dirname, '..', arquivo), fonte = fs.readFileSync(absoluto, 'utf8');
    if (!fonte.includes(antigo)) throw new Error('Adaptação do harness não encontrada.');
    const compilado = new Module(absoluto, module); compilado.filename = absoluto; compilado.paths = Module._nodeModulePaths(path.dirname(absoluto));
    compilado._compile(fonte.replace(antigo, novo), absoluto);
    await compilado.exports.verificar(); console.log(`REGRESSÃO OK ${arquivo}`);
  }
}
if (require.main === module) verificar().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { verificar };
