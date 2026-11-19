import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lerSala, IMPLEMENTADO } from './sala-disputa.mjs';

test('leitor da sala ainda não implementado: nunca devolve leitura inventada', () => {
  assert.equal(IMPLEMENTADO, false);
  const r = lerSala({});
  assert.equal(r.ok, false);
  assert.match(r.motivo, /precisa da sala real/);
});

test('leitor da sala não clica, não preenche e não navega', () => {
  const fonte = readFileSync(new URL('./sala-disputa.mjs', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  for (const proibido of [/\.click\s*\(/, /dispatchEvent/, /\.submit\s*\(/, /\.value\s*=/, /location\s*=|location\.(assign|replace|href)/]) {
    assert.doesNotMatch(fonte, proibido);
  }
});
