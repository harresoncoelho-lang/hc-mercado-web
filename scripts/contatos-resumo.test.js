const test = require('node:test');
const assert = require('node:assert/strict');
const { criarAgenda } = require('../contatos-resumo');
const memoria = () => { const dados = new Map(); return { getItem: k => dados.get(k), setItem: (k,v) => dados.set(k,v) }; };
test('persiste, busca nome acentuado e e-mail, isola contas e remove', () => {
  const storage = memoria(), agenda = criarAgenda(storage);
  assert.equal(agenda.salvar('a','BARBARA@example.com','Bárbara'), true);
  assert.equal(criarAgenda(storage).buscar('a','barbara')[0].nome,'Bárbara');
  assert.equal(agenda.buscar('a','example')[0].email,'barbara@example.com');
  assert.deepEqual(agenda.buscar('b',''),[]);
  agenda.remover('a','barbara@example.com');
  assert.deepEqual(agenda.buscar('a',''),[]);
});
test('deduplica sem apagar nome e não atribui nome de uma pessoa a vários destinatários', () => {
  const agenda = criarAgenda(memoria());
  agenda.salvar('a','lady@example.com','Lady');
  agenda.salvar('a','LADY@example.com; dede@example.com','Grupo');
  assert.equal(agenda.buscar('a','').length,2);
  assert.equal(agenda.buscar('a','lady')[0].nome,'Lady');
  assert.equal(agenda.buscar('a','dede')[0].nome,'');
  assert.equal(agenda.salvar('','x@example.com',''),false);
  assert.equal(agenda.salvar('a','invalido',''),false);
});
test('armazenamento indisponível ou adulterado não interrompe o envio', () => {
  const agenda = criarAgenda({ getItem(){ throw Error('bloqueado'); }, setItem(){ throw Error('quota'); } });
  assert.deepEqual(agenda.buscar('a',''),[]);
  assert.equal(agenda.salvar('a','x@example.com','X'),false);
  const corrompida = criarAgenda({getItem:()=>'{',setItem() {}});
  assert.deepEqual(corrompida.buscar('a',''),[]);
});
