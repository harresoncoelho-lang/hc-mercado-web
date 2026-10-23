const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validarFatosDaFonte, complementarRequisitos } = require('../_edital_operacional');
const root = path.join(__dirname, '../../../docs/qa/editais-reais-novos/08928517000157-116');
const fonte = fs.readFileSync(path.join(root, 'fonte-produto.txt'), 'utf8');
const resultado = n => JSON.parse(JSON.parse(fs.readFileSync(path.join(root, `etapas-validadas/resultado-${n}.json`), 'utf8')).resultado.texto);

test('resposta real01 não atribui ficha PNCP a página que não contém número modalidade ou valor', () => {
  const r = validarFatosDaFonte(resultado('01'), fonte);
  assert.equal(r.detalhes.valorEstimado, 'Não informado');
  assert.equal(r.identificacao.numero, 'Não informado');
  assert.equal(r.identificacao.modalidade, 'Não informado');
  assert.match(r.identificacao.objeto, /TUBOS DE CONCRETO/);
  const validos = validarFatosDaFonte({ detalhes: { valorEstimado: '57.382,60 [Termo de Referencia (#2), página 2, item 5.5]' }, identificacao: { numero: 'DV00041/2026 [Aviso de Contratacao Direta (#1), página 1]', modalidade: 'Dispensa [Aviso de Contratacao Direta (#1), página 1]' } }, fonte);
  assert.match(validos.detalhes.valorEstimado, /57\.382,60/);
  assert.match(validos.identificacao.numero, /DV00041/);
  assert.match(validos.identificacao.modalidade, /Dispensa/);
  const semFormatacao = validarFatosDaFonte({ detalhes: { valorEstimado: '57382.6 [Termo de Referencia (#2), página 2, item 5.5]' } }, fonte);
  assert.match(semFormatacao.detalhes.valorEstimado, /57382\.6/);
});

test('resposta real03 rejeita sanção com página existente mas cláusula noutra página', () => {
  const r = validarFatosDaFonte(resultado('03'), fonte);
  assert.equal(r.penalidades, 'Não informado');
  assert.equal(r.multas, 'Não informado');
  const valido = validarFatosDaFonte({ penalidades: 'Mora de0,5% [Termo de Referencia (#2), página 3, cláusula 14.1]' }, fonte);
  assert.match(valido.penalidades, /0,5%/);
});

test('resposta real03 sem Se necessária conserva cláusula original após complementação', () => {
  const r = resultado('03');
  complementarRequisitos(r, fonte);
  const item = r.documentosHabilitacao.find(x => x.includes('11.1.'));
  assert.ok(item);
  assert.match(item, /Se necessária a verificação/);
  assert.match(item, /Termo de Referencia.*página 3/);
  assert.ok(!r.documentosHabilitacao.some(x => /^apresentar\. documentação essencial/i.test(x)));
});
