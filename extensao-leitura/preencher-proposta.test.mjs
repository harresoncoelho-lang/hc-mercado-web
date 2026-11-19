import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { compraDaUrl, expirarArmazenamento, lerCsv, lerDiario, preencherPaginaCadastro, progresso, registrarDiario, resumirPreenchimento } from './preencher-proposta.mjs';

// ---- DOM mínimo (sem dependências): parser de HTML + seletores tag, .classe, [attr], [attr="v"], [attr*="v"], descendente ----
const VAZIOS = new Set(['input', 'br', 'img', 'meta', 'link']);
class No {
  constructor(tag, attrs = {}) { this.tag = tag; this.attrs = attrs; this.filhos = []; this.texto = ''; this._v = attrs.value ?? ''; this.eventos = []; }
  get value() { return this._v; }
  set value(v) { this._v = v; this.eventos.push('set'); } // o setter do protótipo faz o papel do setter nativo do HTMLInputElement
  get maxLength() { return this.attrs.maxlength ? Number(this.attrs.maxlength) : -1; }
  get textContent() { return this.texto + this.filhos.map(f => f.textContent).join(''); }
  getAttribute(n) { return this.attrs[n] ?? null; }
  getClientRects() { return [1]; }
  focus() {}
  dispatchEvent(e) { this.eventos.push(e.type); return true; }
  click() { this.doc.cliques.push(this); this.doc.aoClicar?.(this); }
  descendentes() { return this.filhos.flatMap(f => [f, ...f.descendentes()]); }
  casa(sel) {
    const m = /^([a-z-]*)((?:\.[\w-]+|\[[\w-]+(?:\*?="[^"]*")?\])*)$/.exec(sel);
    if (!m) throw new Error(`seletor não suportado: ${sel}`);
    if (m[1] && m[1] !== this.tag) return false;
    return [...m[2].matchAll(/\.([\w-]+)|\[([\w-]+)(?:(\*?)="([^"]*)")?\]/g)].every(([, c, a, parcial, v]) => (c
      ? (this.attrs.class || '').split(/\s+/).includes(c)
      : v === undefined ? a in this.attrs : parcial ? (this.attrs[a] || '').includes(v) : this.attrs[a] === v));
  }
  querySelectorAll(sel) {
    let atuais = [this];
    for (const p of sel.trim().split(/\s+/)) atuais = [...new Set(atuais.flatMap(n => n.descendentes().filter(d => d.casa(p))))];
    return atuais;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
function parse(html) {
  const raiz = new No('root'); const pilha = [raiz];
  for (const t of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)([a-z-]+)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*>|([^<]+)/g)) {
    if (t[4] !== undefined) { pilha.at(-1).texto += t[4]; continue; }
    if (t[1]) { if (!VAZIOS.has(t[2])) pilha.pop(); continue; }
    const attrs = Object.fromEntries([...t[3].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(a => [a[1], a[2] ?? '']));
    const n = new No(t[2], attrs); pilha.at(-1).filhos.push(n); if (!VAZIOS.has(t[2])) pilha.push(n);
  }
  return raiz;
}
const ligar = (no, raiz) => { no.doc = raiz; for (const n of no.descendentes()) n.doc = raiz; };

const FIXTURE = readFileSync(new URL('./fixtures/comprasgov-cadastro-propostas.html', import.meta.url), 'utf8');
const URL_OK = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/cadastro-propostas?compra=16013705000332026';
function pagina({ href = URL_OK, html = FIXTURE, aoClicar, mascara } = {}) {
  const raiz = parse(html); raiz.cliques = []; raiz.aoClicar = aoClicar; ligar(raiz, raiz);
  if (mascara) for (const n of raiz.descendentes().filter(d => d.attrs['data-test'] === 'input-valor-proposta')) {
    // A máscara do Angular vive no protótipo (como o setter nativo): o código sob teste chama o setter do protótipo do elemento.
    Object.setPrototypeOf(n, Object.create(No.prototype, { value: { get() { return this._v; }, set(v) { this._v = mascara(v); this.eventos.push('set'); } } }));
  }
  return { raiz, href };
}
const rodar = async (pg, lote) => JSON.parse(JSON.stringify(await vm.runInNewContext(`(${preencherPaginaCadastro})(entrada)`, {
  URL, setTimeout, Promise, Event: class { constructor(type) { this.type = type; } },
  location: { href: pg.href }, document: pg.raiz, entrada: { lote, espera: 300 },
})));
const L = (item, valorUnitario, o = {}) => ({ item, valorUnitario, quantidade: null, marca: null, modelo: null, fabricante: null, valorMinimo: null, ...o });
const campo = (pg, n, nome) => pg.raiz.querySelectorAll('div.cp-itens-card')[n - 1].querySelector(`input[data-test="${nome}"]`);

test('casa pelo número, preenche os 4 campos no formato do portal e dispara input/change/blur após o setter', async () => {
  const pg = pagina();
  const r = await rodar(pg, [L('1', '10.5', { quantidade: '50', marca: 'Santa Cruz', fabricante: 'Fazenda X', modelo: 'cabeça' }), L('2', '4')]);
  assert.equal(r.status, 'ok');
  assert.equal(r.itensNaPagina, 7);
  assert.deepEqual(r.preenchidos.map(p => [p.item, p.valor, p.marca, p.modelo]), [['1', '10,5000', 'Santa Cruz / Fazenda X', 'cabeça'], ['2', '4,0000', null, null]]);
  assert.equal(campo(pg, 1, 'input-valor-proposta').value, '10,5000');
  assert.equal(campo(pg, 1, 'input-quantidade-ofertada').value, '50');
  assert.equal(campo(pg, 1, 'input-marca-fabricante').value, 'Santa Cruz / Fazenda X');
  assert.equal(campo(pg, 1, 'input-modelo-versao').value, 'cabeça');
  assert.deepEqual(campo(pg, 1, 'input-valor-proposta').eventos, ['set', 'input', 'change', 'blur']);
  assert.equal(campo(pg, 2, 'input-quantidade-ofertada').value, '10', 'sem quantidade no lote, a do portal fica');
});

test('nunca clica Salvar, termo nem declarações; só a seta de expandir quando os campos estão fechados', async () => {
  const pg = pagina({ aoClicar: btn => { // abrir o cartão 3 revela o formulário, como o Angular
    const card = pg.raiz.querySelectorAll('div.cp-itens-card')[2];
    if (card.querySelector('[data-test="btn-expandir-proposta"]') !== btn) return;
    const form = parse('<form><input data-test="input-quantidade-ofertada" value="1"><input data-test="input-valor-proposta" value=""><input data-test="input-marca-fabricante" value=""><input data-test="input-modelo-versao" value=""></form>').filhos[0];
    ligar(form, pg.raiz); card.filhos.push(form);
  } });
  const r = await rodar(pg, [L('1', '10'), L('2', '4'), L('3', '7')]);
  assert.deepEqual(r.preenchidos.map(p => p.item), ['1', '2', '3']);
  assert.equal(pg.raiz.cliques.length, 1);
  assert.equal(pg.raiz.cliques[0].attrs['data-test'], 'btn-expandir-proposta');
  assert.ok(!pg.raiz.cliques.some(c => /salvar|aceitar|declarar|termo/i.test(`${c.attrs['data-test']}${c.textContent}`)));
});

test('termo/declarações pendentes: cartão não abre, item vai para camposFechados e nada é digitado', async () => {
  const r = await rodar(pagina(), [L('3', '7')]);
  assert.deepEqual(r.camposFechados, ['3']);
  assert.equal(r.preenchidos.length, 0);
  assert.match(resumirPreenchimento(r), /aceite você mesmo o termo/);
});

test('limites: marca/fabricante e modelo acima de 50, quantidade acima de 12 não são cortados nem preenchidos; 50 exatos passam', async () => {
  const pg = pagina();
  const r = await rodar(pg, [
    L('1', '10', { marca: 'M'.repeat(30), fabricante: 'F'.repeat(30) }), // 30 + " / " + 30 = 63
    L('2', '4', { modelo: 'x'.repeat(51) }),
    L('6', '2', { quantidade: '1234567890123' }),
    L('7', '3', { marca: 'M'.repeat(50), modelo: 'y'.repeat(50) }),
  ]);
  assert.deepEqual(r.alertas.map(a => [a.item, a.tipo]), [['1', 'limite'], ['2', 'limite'], ['6', 'limite']]);
  assert.match(r.alertas[0].mensagem, /63 caracteres \(máximo 50\)/);
  assert.equal(campo(pg, 1, 'input-valor-proposta').value, '');
  assert.deepEqual(r.preenchidos.map(p => p.item), ['7']);
  assert.equal(campo(pg, 7, 'input-marca-fabricante').value.length, 50);
});

test('marca igual ao fabricante entra uma vez só', async () => {
  const r = await rodar(pagina(), [L('1', '9', { marca: 'Acme', fabricante: 'ACME' })]);
  assert.equal(r.preenchidos[0].marca, 'Acme');
});

test('valor abaixo do mínimo do usuário ou acima do estimado: alerta e não preenche; igual ao estimado passa', async () => {
  const pg = pagina();
  const r = await rodar(pg, [L('1', '9', { valorMinimo: '10' }), L('2', '5.0001'), L('6', '3'), L('7', '0'), L('5', 'abc')]);
  assert.deepEqual(r.alertas.map(a => [a.item, a.tipo]), [['1', 'abaixo_do_minimo'], ['2', 'acima_do_estimado'], ['5', 'valor_invalido'], ['7', 'valor_invalido']]);
  assert.match(r.alertas[0].mensagem, /abaixo do seu mínimo R\$ 10,0000/);
  assert.match(r.alertas[1].mensagem, /acima do estimado do portal R\$ 5,0000/);
  assert.deepEqual(r.preenchidos.map(p => p.item), ['6']);
  assert.equal(campo(pg, 1, 'input-valor-proposta').value, '');
  assert.equal(campo(pg, 2, 'input-valor-proposta').value, '');
  assert.equal((await rodar(pagina(), [L('2', '5')])).preenchidos.length, 1);
});

test('valor com vários pontos e sem vírgula ("1.234.567") é inválido; "1.234,56" e "11.87" passam', async () => {
  const r = await rodar(pagina(), [L('6', '1.234.567'), L('1', '1.234,56'), L('2', '5')]);
  assert.deepEqual(r.alertas.filter(a => a.tipo === 'valor_invalido').map(a => a.item), ['6']);
});

test('armazenamento: lote/diário sem data ou com mais de 30 dias são apagados; recentes ficam', () => {
  const m = new Map([
    ['lp-preencher-lote:a', JSON.stringify({ em: '2026-11-18T00:00:00Z', itens: [] })],
    ['lp-preencher-lote:b', JSON.stringify({ em: '2026-09-01T00:00:00Z', itens: [] })],
    ['lp-preencher-lote:c', JSON.stringify([{ item: '1', valorMinimo: '9' }])],
    ['lp-preencher-diario:d', JSON.stringify({ 1: { estado: 'preenchido', em: '2026-09-01T00:00:00Z' } })],
    ['lp-preencher-diario:e', JSON.stringify({ 1: { estado: 'preenchido', em: '2026-11-17T00:00:00Z' } })],
    ['outra', 'x'],
  ]);
  const st = { get length() { return m.size; }, key: i => [...m.keys()][i], getItem: k => m.get(k) ?? null, removeItem: k => m.delete(k) };
  expirarArmazenamento(st, Date.parse('2026-11-19T00:00:00Z'));
  assert.deepEqual([...m.keys()].sort(), ['lp-preencher-diario:e', 'lp-preencher-lote:a', 'outra']);
});

test('classifica: já cadastrado no portal (não mexe), fora do lote, fora da página; texto de resumo', async () => {
  const pg = pagina();
  const r = await rodar(pg, [L('4', '15'), L('1', '10'), L('99', '1')]);
  assert.deepEqual(r.jaNoPortal, ['4']);
  assert.deepEqual(r.foraDoLote, ['2', '3', '5', '6', '7']);
  assert.deepEqual(r.foraDaPagina, ['99']);
  assert.equal(campo(pg, 5, 'input-valor-proposta').value, '', 'item fora do lote intocado');
  const texto = resumirPreenchimento(r, { feitos: 1, total: 3 });
  assert.match(texto, /^1 itens preenchidos nesta página — confira e clique Salvar em cada um; depois vá para a próxima página \(o portal pede captcha\)\./);
  assert.match(texto, /Já preenchidos: 1 de 3\./);
});

test('campo de valor com outro conteúdo não é sobrescrito; máscara que reformata o valor vira alerta', async () => {
  const html = FIXTURE.replace('data-test="input-valor-proposta" maxlength="18" value=""', 'data-test="input-valor-proposta" maxlength="18" value="3,0000"');
  const r = await rodar(pagina({ html }), [L('1', '10')]);
  assert.equal(r.alertas[0].tipo, 'campo_ja_preenchido');
  const m = await rodar(pagina({ mascara: v => `R$ ${v.replace(',', '')}` }), [L('6', '2')]);
  assert.equal(m.alertas[0].tipo, 'mascara');
  assert.equal(m.preenchidos.length, 0);
});

test('páginas não suportadas, captcha visível e página sem itens', async () => {
  assert.equal((await rodar(pagina({ href: 'https://example.com/x' }), [])).status, 'pagina_nao_suportada');
  assert.equal((await rodar(pagina({ href: 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/compras?compra=1' }), [])).status, 'pagina_nao_suportada');
  const cap = '<iframe src="https://newassets.hcaptcha.com/x" title="Desafio hCaptcha"></iframe>';
  assert.equal((await rodar(pagina({ html: cap + FIXTURE }), [L('1', '10')])).status, 'captcha_pendente');
  assert.equal((await rodar(pagina({ html: '<main></main>' }), [])).status, 'sem_itens');
});

test('CSV no padrão da planilha: vírgula decimal, aspas, BOM, zeros à esquerda; erros por linha', () => {
  const ok = lerCsv('﻿item;descricao;quantidade;unidade;valor_unitario;marca;modelo;fabricante;preco_minimo\r\n001;"Alho; branco";50;kg;10,5;Acme;"cab ""A""";Fab;9\r\n2;x;;;4;;;;\r\n');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.itens[0], { item: '1', quantidade: '50', valorUnitario: '10.5', valorMinimo: '9', marca: 'Acme', modelo: 'cab "A"', fabricante: 'Fab' });
  assert.equal(ok.itens[1].valorUnitario, '4');
  const ruim = lerCsv('item;valor_unitario\n1;1.234,56\n1;2\nx;3\n2;\n');
  assert.equal(ruim.ok, false);
  assert.equal(ruim.erros.length, 4);
  assert.equal(lerCsv('a;b\n1;2').ok, false);
});

test('diário: registra preenchido e salvo por compra, mostra "N de M" e resiste a armazenamento quebrado', () => {
  const m = new Map(); const st = { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  const compra = compraDaUrl(URL_OK);
  assert.equal(compra, '16013705000332026');
  registrarDiario(st, compra, { preenchidos: [{ item: '1' }, { item: '2' }], jaNoPortal: ['4'] }, 'agora');
  registrarDiario(st, compra, { preenchidos: [], jaNoPortal: ['1'] }, 'depois');
  const d = lerDiario(st, compra);
  assert.deepEqual([d['1'].estado, d['2'].estado, d['4'].estado], ['salvo', 'preenchido', 'salvo']);
  assert.deepEqual(progresso(d, [L('1', '1'), L('2', '1'), L('3', '1'), L('4', '1')]), { feitos: 3, total: 4 });
  assert.deepEqual(lerDiario({ getItem() { throw new Error('x'); } }, compra), {});
  assert.equal(compraDaUrl('https://outro.com/cadastro-propostas?compra=16013705000332026'), null);
});
