const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { Tiktoken } = require('js-tiktoken/lite');

test('contexto recusado não instancia codificador; aceitos contam exatamente e reutilizam a instância', () => {
  const arquivo = path.join(__dirname, '../_defesa_handler.js'), requerer = createRequire(arquivo);
  let construcoes = 0, codificacoes = 0, ultimoPayload;
  class Instrumentado extends Tiktoken {
    constructor(...args) { super(...args); construcoes++; }
    encode(...args) { codificacoes++; ultimoPayload = args[0]; return super.encode(...args); }
  }
  const modulo = { exports: {} };
  vm.runInNewContext(fs.readFileSync(arquivo, 'utf8'), { module: modulo, exports: modulo.exports, Buffer, require: id => id === 'js-tiktoken/lite' ? { Tiktoken: Instrumentado } : requerer(id) }, { filename: arquivo });
  assert.equal(construcoes, 0, 'importar o handler não deve construir o BPE');
  const contexto = () => ({ fontes: [{ id: 'F1', numero: '1.1', documento: 'Edital', escopoDocumento: 'Edital', texto: '1.1. A multa será recolhida em cinco dias, a contar da comunicação oficial.' }], normas: [], pendencias: [], cobertura: { parcial: false, fontesOmitidas: [] }, regimeConfirmado: true });
  const body = { tipo: 'esclarecimento', questionamento: 'Esclarecer o recolhimento da multa no item 1.1 do Edital.', objetivo: 'Confirmar o evento inicial e o prazo.' };
  const ajustar = objetivo => modulo.exports.ajustarOrcamento(contexto(), { ...body, objetivo }, 'openai/gpt-oss-20b');
  assert.equal(ajustar('龘'.repeat(3000)), null);
  assert.equal(ajustar('Confirmar '.repeat(6000)), null, 'payload acima de 48000 bytes também não constrói BPE');
  assert.equal(construcoes, 0); assert.equal(codificacoes, 0);
  const medida = ajustar(body.objetivo);
  assert.ok(medida); assert.equal(construcoes, 1); assert.equal(codificacoes, 1);
  const referencia = new Tiktoken(requerer('js-tiktoken/ranks/o200k_base'));
  assert.equal(medida.tokens, referencia.encode(ultimoPayload).length + 256 + 2500);
  assert.equal(medida.bytes, Buffer.byteLength(ultimoPayload));
  assert.ok(ajustar(body.objetivo));
  assert.equal(construcoes, 1, 'a inicialização síncrona é reutilizada no mesmo isolate');
  assert.equal(codificacoes, 2);
});
