const test = require('node:test');
const assert = require('node:assert/strict');
const { extrairAnexoLocal } = require('./extrair_anexo_local');

test('ponte local lê texto sem serviços externos', async () => {
  const r = await extrairAnexoLocal(Buffer.from('Prazo de entrega: 10 dias.'), 'errata.txt', { python: process.env.PYTHON_EXTRATOR || 'python' });
  assert.match(r.texto, /10 dias/);
  assert.deepEqual(r.pendencias, []);
});

test('ponte local preserva diagnóstico de formato ilegível', async () => {
  const r = await extrairAnexoLocal(Buffer.from('MZfake'), 'anexo.exe', { python: process.env.PYTHON_EXTRATOR || 'python' });
  assert.equal(r.texto, '');
  assert.ok(r.pendencias.length);
});
