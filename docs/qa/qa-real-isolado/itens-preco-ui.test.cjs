// Tela de preço por item e planilha (itens-processo-ui.js): cálculo exibido, selo do simulador, botão de mínimo,
// prévia da planilha e banco antigo. Funções puras da própria tela, com os módulos reais (precificacao-item.js e
// planilha-itens.js). Nenhum dado real.
const test = require('node:test');
const assert = require('node:assert/strict');
const ui = require('../../../itens-processo-ui.js');
const planilha = require('../../../planilha-itens.js');

const premissas = { tributos: '8.500', garantia: null, margem: '22', margemMinima: '8', frete: null };
const item = (extra = {}) => ({ id: 'i1', identificador: '1', descricao: 'Caneta fictícia', quantidade: '10.000', valorUnitario: '80.00', custoUnitario: '51.20', ...extra });

test('cálculo exibido: 51,20 com 8,5% e margens 22%/8% dá alvo 73,67 e limite 61,32', () => {
  const c = ui.calcularPrecos([item()], premissas).get('i1');
  assert.equal(c.alvo, 7367n);
  assert.equal(c.limite, 6132n);
  const sem = ui.calcularPrecos([item({ custoUnitario: null })], premissas).get('i1');
  assert.equal(sem.semCusto, true);
  assert.match(sem.aviso, /custo unitário/);
  const semMargem = ui.calcularPrecos([item()], { ...premissas, margemMinima: null }).get('i1');
  assert.equal(semMargem.limite, undefined);
  assert.match(semMargem.erroLimite, /margem mínima/);
});

test('frete total rateado entra na base por unidade, arredondado para cima', () => {
  // 2 itens de mesmo peso (custo × quantidade): R$ 10,00 de frete viram R$ 5,00 cada; por unidade 5,00 / 3 = 1,67.
  const itens = [item({ id: 'a', quantidade: '3.000', custoUnitario: '10.00' }), item({ id: 'b', quantidade: '3.000', custoUnitario: '10.00' })];
  const c = ui.calcularPrecos(itens, { ...premissas, frete: '10.00' });
  assert.equal(c.get('a').freteUnidade, 167n);
  assert.equal(c.get('a').base, 1167n);
  assert.ok(c.get('a').alvo > ui.calcularPrecos(itens, premissas).get('a').alvo);
});

test('selo do simulador: texto e cor nos limites exatos', () => {
  const c = ui.calcularPrecos([item()], premissas).get('i1');
  const s = (lance) => ui.simularLance(lance, c, '10.000');
  assert.deepEqual([s('73,67').cor, s('73,67').texto], ['verde', 'Boa margem']);
  assert.equal(s('73,67').margem, '22,00%');
  assert.equal(s('73,67').lucroUnidade, 'R$ 16,21');
  assert.equal(s('73,67').lucroTotal, 'R$ 162,08');
  assert.deepEqual([s('73,66').cor, s('73,66').texto], ['amarelo', 'Negociação']);
  assert.deepEqual([s('61,32').cor, s('61,32').texto], ['amarelo', 'Negociação']);
  assert.deepEqual([s('61,31').cor, s('61,31').texto], ['vermelho', 'Abaixo do limite']);
  // 51,20 / 0,915 = 55,956…: abaixo disso é prejuízo, e o texto diz isso (não só a cor).
  assert.deepEqual([s('55,95').cor, s('55,95').texto], ['vermelho', 'Prejuízo']);
  assert.match(s('55,95').lucroUnidade, /^-R\$/);
  for (const v of ['', 'abc', '1.234,56', '0']) assert.equal(s(v).ok, false, v);
  assert.equal(ui.simularLance('70', undefined, '1.000').ok, false);
});

test('botão "Usar limite como preço mínimo": grava o limite com o custo atual; limite acima do valor unitário é recusado', () => {
  const c = ui.calcularPrecos([item()], premissas).get('i1');
  assert.deepEqual(ui.corpoUsarLimite(item(), c), { ok: true, corpo: { itemId: 'i1', custoUnitario: '51.20', valorUnitarioMinimo: '61.32' } });
  const caro = ui.corpoUsarLimite(item({ valorUnitario: '60.00' }), c);
  assert.equal(caro.ok, false);
  assert.match(caro.erro, /R\$ 61,32.*R\$ 60,00/);
  assert.equal(ui.corpoUsarLimite(item(), ui.calcularPrecos([item({ custoUnitario: null })], premissas).get('i1')).ok, false);
});

test('premissas: campo pt-BR vira o texto do servidor e volta igual; erro diz o que fazer', () => {
  assert.deepEqual(ui.premissaDoCampo('tributos', '8,5'), { ok: true, valor: '8.500' });
  assert.deepEqual(ui.premissaDoCampo('frete', '1500,00'), { ok: true, valor: '1500.00' });
  assert.deepEqual(ui.premissaDoCampo('margem', ''), { ok: true, valor: null });
  for (const v of ['100', '-1', '8,5555', 'abc']) assert.equal(ui.premissaDoCampo('margem', v).ok, false, v);
  assert.match(ui.premissaDoCampo('frete', '1.500,00').erro, /sem ponto de milhar/);
  assert.equal(ui.premissaParaCampo('tributos', '8.500'), '8,5');
  assert.equal(ui.premissaParaCampo('margem', '22'), '22');
  assert.equal(ui.premissaParaCampo('frete', '150.00'), '150,00');
  assert.equal(ui.premissaParaCampo('garantia', null), '');
});

test('referência Compras.gov: unidade do PNCP vira sigla pela tabela do T5; sem sigla, sem busca automática', () => {
  assert.deepEqual(ui.unidadeCompras('Unidade    '), { sigla: 'UN' });
  assert.deepEqual(ui.unidadeCompras('Metro Cúbico'), { sigla: 'M3' });
  assert.deepEqual(ui.unidadeCompras('Caixa 50 UN'), { sigla: 'CX', capacidade: '50', medida: 'UN' });
  assert.deepEqual(ui.unidadeCompras('Frasco 250.0 ML'), { sigla: 'FR', capacidade: '250', medida: 'ML' });
  for (const u of ['Caixa UN', 'Caixa', 'Fardo', '', null]) assert.equal(ui.unidadeCompras(u), null, String(u));
  assert.deepEqual(ui.referenciaDeResposta({ ok: true, dados: { estatisticas: { mediana: 7.7, quantidadePrecos: 50 } } }), { preco: '7.7', quantidade: 50 });
  assert.equal(ui.referenciaDeResposta({ ok: true, dados: { estatisticas: { mediana: null } } }), null);
  assert.equal(ui.referenciaDeResposta({ ok: false }), null);
});

const csv = (linhas) => '﻿' + [planilha.COLUNAS.join(';'), ...linhas].join('\r\n') + '\r\n';
const atuais = [{ id: 'i1', identificador: '1', descricao: 'Material', quantidade: '2', valorUnitario: '1.25', origemPncp: true }, { id: 'i2', identificador: '2', descricao: 'Outro', quantidade: '1', valorUnitario: '3', origemPncp: false }];

test('prévia da planilha: linha com erro desativa o Aplicar; item do PNCP vem marcado como dado do edital', () => {
  const comErro = ui.previaPlanilha(csv(['1;Outra descrição;;;;;;;', '2;;;;4,00;;;;', '3;Novo;abc;;2,00;;;;']), atuais);
  assert.equal(comErro.podeAplicar, false);
  assert.deepEqual(comErro.linhas.map((l) => [l.item, l.estado, l.origemPncp]), [['1', 'erro', true], ['2', 'alterado', false], ['3', 'erro', false]]);
  assert.ok(comErro.linhas[0].mensagens[0].startsWith('Linha 2 (item 1):'));
  const ok = ui.previaPlanilha(csv(['1;;;;;;;;1,00', '2;;;;4,00;;;;', '3;Novo;5;un;2,00;;;;']), atuais);
  assert.deepEqual([ok.podeAplicar, ok.alteracoes], [true, 3]);
  const nada = ui.previaPlanilha(csv(['2;;;;;;;;']), atuais);
  assert.deepEqual([nada.podeAplicar, nada.alteracoes], [false, 0]);
  const cabecalho = ui.previaPlanilha('item;descricao\r\n1;x\r\n', atuais);
  assert.equal(cabecalho.podeAplicar, false);
  assert.match(cabecalho.erros[0], /cabeçalho/);
  assert.equal(ui.previaPlanilha(csv([]), atuais).podeAplicar, false);
});

test('planilha salva no Excel em ANSI (windows-1252) é lida sem caractere de substituição', () => {
  const texto = csv(['3;Caneta esferográfica ação;5;un;2,00;;;;']);
  const ansi = Buffer.from(texto.replace('﻿', ''), 'latin1');
  assert.equal(ui.decodificarPlanilha(ansi), texto.replace('﻿', ''));
  assert.equal(ui.decodificarPlanilha(Buffer.from(texto, 'utf8')), texto.replace('﻿', ''), 'UTF-8 com BOM: o BOM sai na leitura');
  assert.equal(ui.previaPlanilha(ui.decodificarPlanilha(ansi), atuais).linhas[0].estado, 'novo');
});

test('banco antigo (precoDisponivel false): esconde premissas, preços e importação; mantém só Baixar planilha', () => {
  assert.deepEqual(ui.recursosPreco(false), { premissas: false, precos: false, importarPlanilha: false, baixarPlanilha: true });
  assert.deepEqual(ui.recursosPreco(undefined), ui.recursosPreco(false));
  assert.deepEqual(ui.recursosPreco(true), { premissas: true, precos: true, importarPlanilha: true, baixarPlanilha: true });
  // Itens do banco antigo não têm unidade, fabricante nem mínimo: a planilha sai com essas colunas vazias.
  const linha = planilha.gerarCsv([{ identificador: '1', descricao: 'Material', quantidade: '2.000', valorUnitario: '1.25', marca: null, modelo: null }]).split('\r\n')[1];
  assert.equal(linha, '1;Material;2,000;;1,25;;;;');
});
