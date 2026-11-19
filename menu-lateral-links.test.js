'use strict';
// Todas as páginas com menu lateral precisam trazer os links de Prospecção e da Calculadora de BDI.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const paginas = ['painel', 'sistema', 'operacao', 'processos', 'prospeccao', 'bdi'];

for (const p of paginas) {
  test(`menu lateral de ${p}.html tem Prospecção e Calculadora de BDI`, () => {
    const html = fs.readFileSync(`${p}.html`, 'utf8');
    const nav = html.match(/<nav id="menu-principal"[\s\S]*?<\/nav>/)[0];
    assert.match(nav, /<a href="prospeccao\.html"[^>]*>[\s\S]*?Prospecção/);
    assert.match(nav, /<a href="bdi\.html"[^>]*>[\s\S]*?Calculadora de BDI/);
    assert.ok(nav.indexOf('Inteligência de Mercado') < nav.indexOf('Prospecção'), 'Prospecção logo após Inteligência de Mercado');
    const ativos = { prospeccao: 'prospeccao.html', bdi: 'bdi.html' };
    if (ativos[p]) assert.match(nav, new RegExp(`<a href="${ativos[p]}" class="ativo"`));
    else assert.doesNotMatch(nav, /href="(prospeccao|bdi)\.html" class="ativo"/);
  });
}
