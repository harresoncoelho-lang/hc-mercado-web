import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { abrirDetalhesItem, enviarNaPagina, lerPaginaPregao } from './pregao-leitor.mjs';

const fixture = nome => readFileSync(new URL(`./fixtures/${nome}`, import.meta.url), 'utf8');
const BASE = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra';
const ITEM = `${BASE}/item/1?compra=19302805900082025`;
const ATA = 'http://comprasnet.gov.br/livre/pregao/AtaEletronico.asp?co_no_uasg=158142&numprp=232022&f_tpPregao=E&Seq=1';
// Igual à injeção real: só o corpo da função, sem closures do módulo.
const ler = (href, html, captcha = false) => JSON.parse(JSON.stringify(vm.runInNewContext(`(${lerPaginaPregao})(entrada)`, { URL, entrada: { href, html, captcha } })));
const semCpf = obj => assert.doesNotMatch(JSON.stringify(obj), /\d{3}\.\d{3}\.\d{3}-\d{2}|123456789/);

test('Compras.gov item (fixture real): participantes, marca/modelo, valores, chat e o que falta abrir', () => {
  const r = ler(ITEM, fixture('comprasgov-item-19302805900082025-1.html'));
  assert.equal(r.status, 'ok');
  assert.equal(r.compra, '19302805900082025');
  assert.equal(r.url, ITEM);
  assert.deepEqual(r.cabecalho, { uasg: '193028', orgao: 'SUPERINTENDENCIA DA ZONA FRANCA DE MANAUS/AM', numero: '90008', ano: 2025, modalidade: 'Pregão Eletrônico' });
  const [item] = r.itens;
  assert.deepEqual([item.numero, item.descricao, item.situacao, item.quantidade, item.valorEstimado, item.unidade], [1, 'Álcool etílico limpeza de ambientes', 'Homologado', 50, 11.87, 'Litro']);
  assert.equal(item.propostas.length, 3);
  const [max, raio, chikut] = item.propostas;
  assert.deepEqual([max.cnpj, max.uf, max.meEpp, max.situacao, max.valorOfertado, max.valorNegociado, max.valorProposta, max.valorTotal, max.quantidade, max.marca, max.modelo],
    ['33442649000111', 'AM', true, 'Adjudicada', 10, null, 10, 500, 50, 'santa cruz', 'liquido']);
  assert.deepEqual([raio.marca, raio.modelo, raio.valorTotal, raio.chatLido], ['São Caetano', 'litro', 550, true]);
  assert.deepEqual([chikut.valorOfertado, chikut.marca, chikut.chatLido, chikut.propostaLida], [11.85, null, false, false]);
  assert.equal(item.mensagens.length, 4);
  assert.deepEqual(item.mensagens[1], { fornecedor: '33442649000111', dataHora: '2026-01-07T09:44:00', autor: 'orgao',
    texto: item.mensagens[1].texto, tipo: 'convocacao', motivo: 'Envio do atestado de qualificação técnica exigido no subitem 9.25 do Termo de Referência.' });
  assert.deepEqual(r.pendentes, [{ item: 1, fornecedor: '26153737000138', nome: 'CHIKUT COMERCIO DE ALIMENTOS LTDA', falta: ['chat', 'proposta'] }]);
});

test('Compras.gov lista (fixture real): itens com situação e estimado, todos como "não lido"', () => {
  const r = ler(`${BASE}?compra=19302805900082025`, fixture('comprasgov-lista-19302805900082025.html'));
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.itens.map(i => [i.numero, i.descricao, i.quantidade, i.valorEstimado, i.propostasLidas]),
    [[1, 'Álcool etílico limpeza de ambientes', 50, 11.87, false], [6, 'Bandeira institucional', 20, 400.99, false]]);
  assert.deepEqual(r.pendentes.map(p => p.item), [1, 6]);
});

test('ComprasNet ata (fixture sintética): propostas com marca/fabricante/modelo, lances, recusa e desclassificação com motivo', () => {
  const r = ler(ATA, fixture('comprasnet-ata-sintetica.html'));
  assert.equal(r.status, 'ok');
  assert.equal(r.compra, '15814205000232022');
  assert.equal(r.url, 'http://comprasnet.gov.br/livre/pregao/AtaEletronico.asp');
  assert.equal(r.cabecalho.orgao, 'INSTITUTO FEDERAL DE EDUCAÇÃO, CIÊNCIA E TECNOLOGIA DO AMAZONAS');
  const [i1, i2] = r.itens;
  assert.deepEqual([i1.descricao, i1.quantidade, i1.valorEstimado, i1.unidade, i1.situacao], ['Álcool etílico hidratado 70%', 100, 12, 'Litro', 'Adjudicado']);
  const [alfa, beta, pf] = i1.propostas;
  assert.deepEqual([alfa.marca, alfa.fabricante, alfa.modelo, alfa.valorProposta, alfa.valorTotal, alfa.meEpp, alfa.situacao], ['Alfa Clean', 'Alfa Industria', '70 INPM 1L', 11, 1100, true, 'Habilitada']);
  assert.deepEqual(beta.lances.map(l => [l.valor, l.excluido]), [[1, true], [9.8, false]]);
  assert.equal(beta.situacao, 'Recusada');
  const recusa = i1.mensagens.find(m => m.tipo === 'recusa');
  assert.deepEqual([recusa.fornecedor, recusa.motivo], ['22333444000181', 'produto ofertado é álcool em gel, diverso do especificado no Termo de Referência.']);
  assert.equal(i2.mensagens[0].tipo, 'desclassificacao');
  assert.equal(i2.propostas[0].situacao, 'Desclassificada');
  assert.equal(r.mensagens.length, 3);
  // Pessoa física: sem documento e sem nome; os lances dela continuam ligados à mesma chave.
  assert.deepEqual([pf.chave, pf.cnpj, pf.nome, pf.marca, pf.lances.length], ['pf:1', null, 'Pessoa física', 'Gama', 1]);
  semCpf(r);
  assert.doesNotMatch(JSON.stringify(r), /NOME DE PESSOA FISICA/);
});

test('só lê páginas públicas suportadas; captcha visível ou página vazia não viram leitura', () => {
  const html = fixture('comprasgov-item-19302805900082025-1.html');
  for (const href of ['https://example.test/x?compra=19302805900082025', `${BASE.replace('https:', 'http:')}/item/1?compra=19302805900082025`,
    `${BASE.replace('/public/', '/seguro/')}/item/1?compra=19302805900082025`, `${BASE}/item/1?compra=123`, `${ITEM}&compra=19302805900082025`,
    'https://comprasnet.gov.br/livre/pregao/ata2.asp?co_no_uasg=158142', 'nao-e-url']) {
    assert.equal(ler(href, html).status, 'pagina_nao_suportada', href);
  }
  assert.deepEqual({ ...ler(ITEM, html, true) }, { status: 'captcha_pendente' });
  assert.equal(ler(ITEM, '<main><p>Carregando…</p></main>').status, 'sem_dados');
  assert.equal(ler(ATA, '<form>Digite os caracteres da imagem</form>').status, 'sem_dados');
});

test('CPF em participante do Compras.gov ou em mensagem é descartado/mascarado', () => {
  const html = fixture('comprasgov-item-19302805900082025-1.html')
    .replace(' 33.561.486/0001-96 ', ' 123.456.789-09 ').replace(' RAIO DE LUZ COMERCIAL DE TINTAS E SERVICOS DE CONSTRUCAO LTDA', ' FULANO DE TAL')
    .replace('Envio do atestado', 'Contato CPF 123.456.789-09, 123 456 789 09 e 123.456.789/09. Envio do atestado');
  const r = ler(ITEM, html);
  const pf = r.itens[0].propostas[1];
  assert.deepEqual([pf.chave, pf.cnpj, pf.nome, pf.marca], ['pf:1', null, 'Pessoa física', 'São Caetano']);
  semCpf(r);
  assert.doesNotMatch(JSON.stringify(r), /FULANO|123 456 789|789\/09/);
});

test('envio na aba do LicitaPlena usa a sessão da página, sem expor token na resposta', async () => {
  const chamadas = [];
  const armazenamento = { 'sb-lsqjamqvmrcyrvowndiu-auth-token': JSON.stringify({ access_token: 'token-teste', expires_at: Date.now() / 1000 + 600 }) };
  const ctx = {
    localStorage: { get length() { return Object.keys(armazenamento).length; }, key: i => Object.keys(armazenamento)[i], getItem: k => armazenamento[k] },
    fetch: async (url, op) => { chamadas.push({ url, op }); return { ok: true, status: 200, json: async () => ({ ok: true, propostas: 3, mensagens_novas: 4 }) }; },
    Date, JSON,
  };
  const enviar = pregao => vm.runInNewContext(`(${enviarNaPagina})(pregao)`, { ...ctx, pregao });
  const r = await enviar({ compra: '19302805900082025' });
  assert.deepEqual({ ...r }, { ok: true, propostas: 3, mensagens_novas: 4, status: 200 });
  assert.equal(chamadas[0].url, '/api/pregao-gravado');
  assert.equal(chamadas[0].op.headers.Authorization, 'Bearer token-teste');
  assert.doesNotMatch(JSON.stringify(r), /token-teste/);
  armazenamento['sb-lsqjamqvmrcyrvowndiu-auth-token'] = JSON.stringify({ access_token: 'x', expires_at: 1 });
  assert.equal((await enviar({})).status, 401);
  delete armazenamento['sb-lsqjamqvmrcyrvowndiu-auth-token'];
  assert.equal((await enviar({})).status, 401);
  assert.equal(chamadas.length, 1);
});

test('abrir detalhes para no captcha e só clica no que está fechado', async () => {
  const cliques = [];
  const botao = (nome, aberto) => ({ textContent: nome, nextElementSibling: aberto ? {} : null, getAttribute: () => String(aberto), scrollIntoView() {}, click() { cliques.push(nome); } });
  const card = { querySelector: () => botao('expandir', false), querySelectorAll: () => [botao('Chat', false), botao('Proposta', true)] };
  let captcha = false;
  const ctx = { document: { querySelectorAll: s => s === 'iframe' ? (captcha ? [{ src: 'https://newassets.hcaptcha.com/x', getBoundingClientRect: () => ({ width: 300, height: 400, top: 10, bottom: 410 }), checkVisibility: () => true }] : []) : [card] },
    innerHeight: 800, setTimeout: (f) => setTimeout(f, 0), Math, Promise };
  const abrir = () => vm.runInNewContext(`(${abrirDetalhesItem})(0, 0)`, ctx);
  assert.deepEqual({ ...await abrir() }, { status: 'ok', abertos: 2 });
  assert.deepEqual(cliques, ['expandir', 'Chat']);
  captcha = true;
  assert.deepEqual({ ...await abrir() }, { status: 'captcha_pendente', abertos: 0 });
});

test('popup: só lê e grava (sem clicar/navegar) e lista o que falta abrir; manifesto sem site local nem Compras.gov', async () => {
  const manifesto = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifesto.optional_host_permissions, ['https://licitaplena.com.br/*', 'https://www.licitaplena.com.br/*', 'https://licitaplena.pages.dev/*']);
  assert.doesNotMatch(readFileSync(new URL('./popup.html', import.meta.url), 'utf8'), /gravarAbrir|gravarPercorrer/);
  const { MODO_AUTOMATICO } = await import('./pregao-leitor.mjs');
  assert.equal(MODO_AUTOMATICO, false);

  const el = { gravarLer: { disabled: false, handlers: {}, addEventListener(t, h) { this.handlers[t] = h; } }, gravarStatus: { textContent: '' } };
  const injetadas = [];
  const leitura = ler(ITEM, fixture('comprasgov-item-19302805900082025-1.html'));
  globalThis.document = { getElementById: id => el[id] };
  globalThis.chrome = {
    runtime: { getManifest: () => manifesto },
    permissions: { request: async ({ origins }) => { assert.deepEqual(origins, manifesto.optional_host_permissions); return true; } },
    tabs: {
      query: async q => q.active ? [{ id: 1, url: ITEM }] : [{ id: 2, url: 'https://licitaplena.com.br/sistema' }],
      update: () => assert.fail('o popup não navega a aba do usuário'),
    },
    scripting: { executeScript: async ({ target, func, args }) => {
      injetadas.push([target.tabId, func.name, args]);
      return [{ result: func.name === 'lerPaginaPregao' ? leitura : { ok: true, status: 200, propostas: 3, mensagens_novas: 4 } }];
    } },
  };
  try {
    const { oQueFaltaAbrir } = await import('./gravar.mjs');
    assert.deepEqual(oQueFaltaAbrir([{ item: 3, fornecedor: '33442649000111', nome: 'MAX LTDA', falta: ['chat'] }, { item: 4, fornecedor: null, falta: ['propostas'] }]),
      ['Abra o item 3 → fornecedor MAX LTDA (33442649000111) → Chat', 'Abra o item 4 ("Visualizar propostas") → em cada fornecedor, Chat e Proposta']);
    el.gravarLer.handlers.click();
    for (let i = 0; i < 40 && !el.gravarStatus.textContent.includes('Gravado'); i++) await new Promise(r => setTimeout(r, 5));
    assert.deepEqual(injetadas.map(([aba, nome]) => [aba, nome]), [[1, 'lerPaginaPregao'], [2, 'enviarNaPagina']]);
    assert.equal('pendentes' in injetadas[1][2][0], false);
    assert.match(el.gravarStatus.textContent, /Falta abrir \(1\)[\s\S]*Abra o item 1 → fornecedor CHIKUT COMERCIO DE ALIMENTOS LTDA \(26153737000138\) → Chat e Proposta/);
    assert.match(el.gravarStatus.textContent, /Gravado no LicitaPlena \(3 propostas, 4 mensagens novas\)/);
  } finally { delete globalThis.document; delete globalThis.chrome; }
});

test('URL da ata montada pelo LicitaPlena (www, https, uasg+numprp+codigoModalidade) é lida como a ata completa', () => {
  const url = 'https://www.comprasnet.gov.br/livre/pregao/AtaEletronico.asp?co_no_uasg=158142&uasg=158142&numprp=232022&codigoModalidade=5&Seq=1';
  const r = ler(url, fixture('comprasnet-ata-sintetica.html'));
  assert.equal(r.status, 'ok');
  assert.equal(r.compra, '15814205000232022');
});
