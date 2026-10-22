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
const fs = require('node:fs');
const zlib = require('node:zlib');
const volumesFixture = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, 'fixtures/anexos-rar-volumes.json'), 'utf8'));
const volumes = Object.entries(volumesFixture.files).map(([nome, dados]) => ({ nome, buffer: zlib.inflateSync(Buffer.from(dados, 'base64')) }));

test('ponte reúne volumes RAR3 RAR5 e nomes antigos sem repetir o grupo', { skip: !process.env.IMAGEM_EXTRATOR_ANEXOS }, async () => {
  for (const primeiro of ['rar3-vols.part1.rar', 'rar5-vols.part1.rar', 'rar3-old.rar']) {
    const arquivo = volumes.find(a => a.nome === primeiro);
    const r = await extrairAnexoLocal(arquivo.buffer, arquivo.nome, { companheiros: volumes });
    assert.deepEqual(r.pendencias, []);
    assert.match(r.texto, /bigfile.txt/);
    assert.match(r.texto, /smallfile.txt/);
    assert.ok(r.texto.length > 205000);
  }
});

test('RAR com volume faltante não parece completo', { skip: !process.env.IMAGEM_EXTRATOR_ANEXOS }, async () => {
  const arquivo = volumes.find(a => a.nome === 'rar5-vols.part1.rar');
  const r = await extrairAnexoLocal(arquivo.buffer, arquivo.nome, { companheiros: volumes.filter(a => a.nome !== 'rar5-vols.part2.rar') });
  assert.ok(r.pendencias.length);
});
const arquivoInicial = volumes.find(a => a.nome === 'rar5-vols.part1.rar');
test('RAR rejeita parte corrompida, primeiro ausente e nomes ambíguos', { skip: !process.env.IMAGEM_EXTRATOR_ANEXOS }, async () => {
  const corruptos = volumes.map(a => a.nome === 'rar5-vols.part2.rar' ? { nome: a.nome, buffer: Buffer.from('corrompido') } : a);
  assert.ok((await extrairAnexoLocal(arquivoInicial.buffer, arquivoInicial.nome, { companheiros: corruptos })).pendencias.length);
  const segundo = volumes.find(a => a.nome === 'rar5-vols.part2.rar');
  assert.ok((await extrairAnexoLocal(segundo.buffer, segundo.nome, { companheiros: [segundo] })).pendencias.length);
  assert.ok((await extrairAnexoLocal(arquivoInicial.buffer, arquivoInicial.nome, { companheiros: [{ nome: arquivoInicial.nome, buffer: Buffer.from('outro conteúdo') }] })).pendencias.length);
  const ultimo = volumes.find(a => a.nome === 'rar5-vols.part3.rar');
  const r = await extrairAnexoLocal(ultimo.buffer, ultimo.nome, { companheiros: volumes });
  assert.equal(r.volumeDe, arquivoInicial.nome);
  assert.equal(r.texto, '');
});


test('RAR não confunde part1 com part01', async () => {
  const r = await extrairAnexoLocal(Buffer.from('variante'), 'edital.part01.rar', { companheiros: [{ nome: 'edital.part1.rar', buffer: Buffer.from('original') }] });
  assert.match(r.pendencias.join(' '), /duplicado/);
  assert.equal(r.volumeDe, undefined);
});
