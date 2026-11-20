const test = require('node:test');
const assert = require('node:assert/strict');
const PL = require('../planilha-itens.js');

const CAB = PL.COLUNAS.join(';');
const atuais = () => [
  { identificador: '1', descricao: 'Caneta azul; ponta "fina"', quantidade: '10.000', unidade: 'Unidade', valorUnitario: '2.50', marca: 'BIC', modelo: null, fabricante: null, valorUnitarioMinimo: null, origemPncp: true },
  { identificador: '2', descricao: '=SOMA(A1:A9)', quantidade: '2.500', unidade: 'Caixa 50 UN', valorUnitario: '31.33', marca: null, modelo: 'X', fabricante: 'Fab', valorUnitarioMinimo: '28.00', origemPncp: false },
];
const csv = (...linhas) => `\uFEFF${[CAB, ...linhas].join('\r\n')}\r\n`;
const validar = (texto, itens = atuais()) => PL.validarLinhas(PL.lerCsv(texto).linhas, itens);

test('ida e volta: planilha gerada sem edição volta sem mudança', () => {
  const lida = PL.lerCsv(PL.gerarCsv(atuais()));
  assert.equal(lida.ok, true);
  assert.equal(lida.linhas[1].valores.descricao, '=SOMA(A1:A9)');
  const v = PL.validarLinhas(lida.linhas, atuais());
  assert.equal(v.ok, true);
  assert.deepEqual(v.resumo, { novo: 0, alterado: 0, sem_mudanca: 2, erro: 0 });
});

test('BOM, CRLF, ";" e aspas no padrão RFC 4180', () => {
  const t = PL.gerarCsv(atuais());
  assert.equal(t.codePointAt(0), 0xfeff);
  assert.ok(t.startsWith('\uFEFF' + CAB + '\r\n'));
  assert.ok(t.endsWith('\r\n'));
  assert.equal(t.replace(/\r\n/g, '').includes('\n'), false);
  assert.ok(t.includes('"Caneta azul; ponta ""fina"""'));
  assert.ok(t.includes(';10,000;Unidade;2,50;'));
  const comQuebra = PL.lerCsv(csv('3;"linha 1\r\nlinha 2";1;UN;1,00;;;;'));
  assert.equal(comQuebra.linhas[0].valores.descricao, 'linha 1\r\nlinha 2');
  assert.equal(PL.lerCsv(csv('3;"aberta;1;UN;1;;;;')).ok, false);
  assert.equal(PL.lerCsv(`${CAB}\n3;Lápis;1;UN;1;;;;\n`).ok, true); // LF também aceito
});

test('antifórmula: apóstrofo na saída, removido na entrada', () => {
  const t = PL.gerarCsv([{ identificador: '9', descricao: '=HYPERLINK("x")', quantidade: '1', valorUnitario: '1.00', marca: '+1', modelo: '-2', fabricante: '@A' }]);
  assert.ok(t.includes(`'=HYPERLINK`));
  assert.ok(t.includes(";'+1;'-2;'@A;"));
  const v = PL.lerCsv(t).linhas[0].valores;
  assert.deepEqual([v.descricao, v.marca, v.modelo, v.fabricante], ['=HYPERLINK("x")', '+1', '-2', '@A']);
  assert.equal(PL.lerCsv(csv("9;'Dona Maria;1;UN;1;;;;")).linhas[0].valores.descricao, "'Dona Maria");
});

test('erro identifica linha e item', () => {
  const v = validar(csv('1;;;;2,60;;;;', '2;;abc;;;;;;', '7;Novo item;;;;;;;'));
  assert.equal(v.ok, false);
  assert.equal(v.linhas[0].estado, 'alterado');
  assert.ok(v.erros.some((e) => e.startsWith('Linha 3 (item 2): Quantidade "abc"')));
  assert.ok(v.erros.includes('Linha 4 (item 7): item novo: informe a quantidade.'));
  assert.ok(v.erros.includes('Linha 4 (item 7): item novo: informe o valor unitário.'));
  assert.ok(validar(csv(';x;1;UN;1;;;;')).erros[0].startsWith('Linha 2: informe o item'));
  assert.ok(validar(csv('5;a;1;UN;1;;;;', '5;b;1;UN;1;;;;')).erros[0].includes('Linha 3 (item 5): item repetido'));
  assert.ok(validar(csv('2;;;;27,00;;;;')).erros[0].includes('preço mínimo não pode ser maior'));
  assert.ok(validar(csv('2;;;;0,00;;;;')).erros[0].includes('Valor unitário'));
});

test('separador de milhar recusado com mensagem clara; vírgula, ponto e zeros extras aceitos', () => {
  for (const n of ['1.234,56', '1.234.567', '1,234.56']) {
    const v = validar(csv(`2;;;;${n};;;;`));
    assert.match(v.erros[0], /não use separador de milhar/);
  }
  const ok = validar(csv('2;;;;31,3300;;;;', '1;;10;;2.6;;;;'));
  assert.equal(ok.ok, true);
  assert.equal(ok.linhas[0].estado, 'sem_mudanca');
  assert.equal(ok.linhas[1].mudancas.valorUnitario, '2.6');
  assert.match(validar(csv('2;;;;31,333;;;;')).erros[0], /no máximo 2 casas/);
  assert.match(validar(csv('2;;1,23456;;;;;;')).erros[0], /use só números/);
});

test('limites de 1000 linhas e 2 MB', () => {
  const muitas = Array.from({ length: 1001 }, (_, k) => `${k + 1};Item;1;UN;1,00;;;;`);
  const r = PL.lerCsv(csv(...muitas));
  assert.equal(r.ok, false); assert.match(r.erros[0], /limite é 1000/);
  assert.equal(PL.lerCsv(csv(...muitas.slice(0, 1000))).ok, true);
  assert.match(PL.lerCsv(CAB + '\r\n' + 'x'.repeat(2 * 1024 * 1024)).erros[0], /2 MB/);
  assert.match(PL.lerCsv('item;descricao\r\n1;x').erros[0], /cabeçalho/);
});

test('item do PNCP: descrição, quantidade e unidade protegidas', () => {
  for (const linha of ['1;Outra;;;;;;;', '1;;11;;;;;;', '1;;;Caixa;;;;;']) {
    const v = validar(csv(linha));
    assert.equal(v.ok, false); assert.match(v.erros[0], /^Linha 2 \(item 1\): item importado do PNCP/);
  }
  // mesmos valores (com vírgula) e campos livres continuam editáveis
  const v = validar(csv('1;Caneta azul; ponta "fina";10,0;Unidade;2,40;Faber;M1;F1;2,00'.replace('Caneta azul; ponta "fina"', '"Caneta azul; ponta ""fina"""')));
  assert.equal(v.ok, true);
  assert.deepEqual(v.linhas[0].mudancas, { valorUnitario: '2.4', marca: 'Faber', modelo: 'M1', fabricante: 'F1', valorUnitarioMinimo: '2' });
});

test('célula vazia não altera nada; item novo completo entra como novo', () => {
  const v = validar(csv('2;;;;;;;;', '8;Papel A4;5;Resma;25,90;Chamex;;;22,10'));
  assert.equal(v.ok, true);
  assert.equal(v.linhas[0].estado, 'sem_mudanca');
  assert.equal(v.linhas[0].dados.modelo, 'X');
  assert.equal(v.linhas[1].estado, 'novo');
  assert.deepEqual(v.linhas[1].dados, { identificador: '8', descricao: 'Papel A4', quantidade: '5', unidade: 'Resma', valorUnitario: '25.9', marca: 'Chamex', valorUnitarioMinimo: '22.1' });
});

test('contrato: linha lida vira lote aceito por validarLote e preço mínimo vira floor de createMotor', async () => {
  const { validarLote } = await import('../extensao-leitura/prevalidacao-lote.mjs');
  const { createMotor } = await import('../motor-lances/motor.mjs');
  const v = validar(csv('8;Papel A4;5;Resma;25,90;Chamex;;Suzano;22,10'));
  const d = v.linhas[0].dados;
  const linhaLote = { id: '1', quantidade: PL.quatroCasas(d.quantidade), unitario: PL.quatroCasas(d.valorUnitario), marca: d.marca, fabricante: d.fabricante };
  assert.deepEqual([linhaLote.quantidade, linhaLote.unitario], ['5.0000', '25.9000']);
  const lote = validarLote([{ id: '1', quantidade: '5.0000', grupo: null, exigidos: ['marca', 'fabricante'] }], [linhaLote]);
  assert.equal(lote.valido, true, lote.erros.join(' '));
  assert.equal(lote.totalExato, '129.50000000');
  const floor = PL.quatroCasas(d.valorUnitarioMinimo);
  assert.equal(floor, '22.1000');
  const motor = createMotor({ id: 'p1', version: 1, cnpj: '12345678000195', purchaseId: '78882005000412026', itemId: '1', criterion: 'menor_preco_unitario', mode: 'simulado', floor, decrement: '0.0100' }, { source: 'fixture', maxSnapshotAgeMs: 1000 });
  assert.equal(typeof motor.policyKey, 'string');
});
