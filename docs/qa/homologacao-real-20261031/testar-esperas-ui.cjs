// Somente Promises locais: não inicia navegador, Auth, HTTP ou banco.
const assert = require('node:assert/strict');
const { esperarAcao } = require('./verificar-ui-real.cjs');
const atraso = (ms, erro) => new Promise((_, reject) => setTimeout(() => reject(new Error(erro)), ms));
async function main() {
  let limpezas = 0;
  async function caso(espera, executar, mensagem) {
    await assert.rejects(async () => {
      try { await esperarAcao(espera, executar); }
      finally { limpezas++; }
    }, new RegExp(mensagem));
  }
  await caso(Promise.reject(new Error('timeout da espera')), () => atraso(5, 'acao tardia'), 'timeout da espera');
  await caso(atraso(5, 'espera tardia'), () => { throw new Error('falha da acao'); }, 'falha da acao');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(limpezas, 2);
  assert.equal(await esperarAcao(Promise.resolve('resposta'), async () => {}), 'resposta');
  console.log('3 casos offline aprovados: timeout e falha da ação propagam ao finally; rejeições tardias tratadas; sucesso preservado.');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
