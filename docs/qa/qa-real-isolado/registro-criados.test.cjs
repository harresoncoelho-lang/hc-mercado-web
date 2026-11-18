// Registro durável de IDs QA: falha fechada quando corrompido, sem filtrar entradas inválidas em silêncio.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarRegistro } = require('./registro-criados.cjs');

const U = '258eddfe-d761-4ec9-ae63-ee5e5b8db408', E = 'a1000000-0000-4000-8000-000000000002', P = 'a1000000-0000-4000-8000-000000000003';

function arquivo(conteudo) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'registro-qa-'));
  const f = path.join(dir, 'criados.json');
  if (conteudo !== undefined) fs.writeFileSync(f, conteudo);
  return { f, limpar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('registro íntegro carrega e lista só os pares do usuário', () => {
  const a = arquivo(JSON.stringify([{ userId: U, empresaId: E, processoId: P }]));
  try {
    const r = criarRegistro(a.f);
    assert.deepEqual(r.listar(U), [{ empresaId: E, processoId: P }]);
    assert.deepEqual(r.listar('358eddfe-d761-4ec9-ae63-ee5e5b8db409'), []);
  } finally { a.limpar(); }
});

test('uma entrada inválida no meio invalida o arquivo inteiro: nenhuma entrada válida é aproveitada', () => {
  const a = arquivo(JSON.stringify([{ userId: U, empresaId: E, processoId: P }, { userId: U, empresaId: 'nao-uuid', processoId: P }]));
  try { assert.throws(() => criarRegistro(a.f), /corrompido/); } finally { a.limpar(); }
});

test('entrada que não é objeto, JSON quebrado ou raiz que não é lista: falha fechada', () => {
  for (const conteudo of ['[null]', '[42]', '{"userId":"x"}', '[{"userId":"' + U + '"', '"texto"']) {
    const a = arquivo(conteudo);
    try { assert.throws(() => criarRegistro(a.f), /corrompido/, conteudo); } finally { a.limpar(); }
  }
});

test('registro novo é criado vazio e gravado só com ids', () => {
  const a = arquivo();
  try {
    const r = criarRegistro(a.f);
    r.registrar(U, E, P);
    const bruto = fs.readFileSync(a.f, 'utf8');
    assert.deepEqual(JSON.parse(bruto), [{ userId: U, empresaId: E, processoId: P }]);
    assert.doesNotMatch(bruto, /token|senha|objeto/i);
    assert.equal(r.podeRegistrar(U), true);
  } finally { a.limpar(); }
});

test('falha de gravação não entra na memória; retry após liberar a escrita grava uma única vez', () => {
  const a = arquivo();
  try {
    const r = criarRegistro(a.f);
    // Bloqueio determinístico da escrita: um diretório no lugar do temporário faz writeFileSync falhar (EISDIR), inclusive como root.
    const tmp = a.f + '.' + process.pid + '.tmp';
    fs.mkdirSync(tmp);
    assert.throws(() => r.registrar(U, E, P));
    assert.deepEqual(r.listar(U), [], 'par não retido em memória após falha');
    assert.equal(r.contar(U), 0);
    assert.equal(r.podeRegistrar(U), true);
    assert.equal(fs.existsSync(a.f), false, 'arquivo final não foi criado');
    // Retry com a escrita liberada: grava, lista e persiste uma só vez.
    fs.rmdirSync(tmp);
    r.registrar(U, E, P);
    r.registrar(U, E, P);
    assert.deepEqual(r.listar(U), [{ empresaId: E, processoId: P }]);
    assert.deepEqual(JSON.parse(fs.readFileSync(a.f, 'utf8')), [{ userId: U, empresaId: E, processoId: P }]);
    assert.deepEqual(criarRegistro(a.f).listar(U), [{ empresaId: E, processoId: P }], 'relido do disco');
  } finally { a.limpar(); }
});

test('falha de gravação com registro já existente preserva o conteúdo anterior em memória e em disco', () => {
  const P2 = 'a1000000-0000-4000-8000-000000000009';
  const a = arquivo(JSON.stringify([{ userId: U, empresaId: E, processoId: P }]));
  try {
    const r = criarRegistro(a.f);
    const antes = fs.readFileSync(a.f, 'utf8');
    const tmp = a.f + '.' + process.pid + '.tmp';
    fs.mkdirSync(tmp);
    assert.throws(() => r.registrar(U, E, P2));
    assert.deepEqual(r.listar(U), [{ empresaId: E, processoId: P }]);
    assert.equal(fs.readFileSync(a.f, 'utf8'), antes);
    fs.rmdirSync(tmp);
    r.registrar(U, E, P2);
    assert.equal(r.contar(U), 2);
  } finally { a.limpar(); }
});
