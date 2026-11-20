const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../kit-documentos-ui.js'), 'utf8');
const operation = source.slice(source.indexOf('    async function executar(acao)'), source.indexOf('    async function prepararCadastro()'));

for (const action of ['exportar', 'confirmarRevisao', 'preparar']) {
  test(`resposta de ${action} anterior à edição do item é descartada e libera ocupado`, async () => {
    let release;
    const response = new Promise(resolve => { release = resolve; });
    const calls = [];
    const ctx = {
      ocupado: false, dados: {}, itensPendentes: false, alterado: false, tentativa: null,
      peca: { id: 'qa', versao: 1 }, escopo: {}, estado: '',
      controle: { geracao: 1, hash: 'qa', podeExportar: () => true },
      vivo: () => true, atualizar: () => {}, aviso: () => {},
      enviar: () => response, baixar: () => calls.push('baixar'),
      validarDocumento: () => { calls.push('confirmar'); throw Error('Resposta não deveria ser usada'); },
      falhar: () => calls.push('falhar'), el: () => ({ focus() {} }),
    };
    vm.createContext(ctx);
    vm.runInContext(operation, ctx);
    const pending = ctx.executar(action);
    assert.equal(ctx.ocupado, true);
    ctx.itensPendentes = true;
    release({});
    await pending;
    assert.deepEqual(calls, []);
    assert.equal(ctx.ocupado, false);
  });
}
