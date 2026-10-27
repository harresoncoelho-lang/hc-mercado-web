const test = require('node:test');
const assert = require('node:assert/strict');
const { tokenValido, hashToken, blocoDecisao } = require('../_decisao_oportunidade');
test('token opaco com 256 bits e hash estável; recusa entradas malformadas', () => {
  assert.equal(tokenValido('a'.repeat(64)),true);
  assert.equal(tokenValido('../segredo'),false);
  assert.equal(hashToken('a'.repeat(64)).length,64);
  assert.notEqual(hashToken('a'.repeat(64)),'a'.repeat(64));
});
test('botões apontam à confirmação, com token no fragmento e sem marcar decisão via GET', () => {
  const html = blocoDecisao('a'.repeat(64));
  assert.match(html,/Quero participar/); assert.match(html,/Não quero participar/);
  assert.match(html,/responder-oportunidade.html#token=/);
  assert.doesNotMatch(html,/api\/.*token=|<script/);
  assert.equal(blocoDecisao(''), '');
});
test('sem extensão o HTML do e-mail permanece idêntico à versão anterior', () => {
  const { createHash } = require('node:crypto');
  const atual = require('../enviar-resumo-edital').__test;
  for (const caso of require('./fixtures/email-anterior-hashes.json')) {
    assert.equal(createHash('sha256').update(atual.montarHtml(...caso.args)).digest('hex'),caso.sha256);
  }
});
