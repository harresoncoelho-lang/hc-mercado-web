/* global Buffer */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./catalogo-produtos');
const U = require('./catalogo-usar-ui');

const catalogo = [
  { id: 'a', nome: 'Caneta esferográfica azul', marca: 'Bic', modelo: 'Cristal', fabricante: 'Bic Brasil', custo_unitario: 1.2, ativo: true },
  { id: 'b', nome: 'Papel A4 75g', marca: 'Chamex', custo_unitario: '22.90', ativo: true },
  { id: 'c', nome: 'Caneta esferográfica preta', marca: 'Faber', custo_unitario: null, ativo: true },
  { id: 'd', nome: 'Caneta esferográfica azul', marca: 'Velha', ativo: false },
];

test('sugestão: casa pela descrição do item, ignora acento/plural/caixa, inativo fica de fora', () => {
  const s = C.sugerirProdutos('CANETAS ESFEROGRAFICAS cor AZUL, ponta média, marca referência Cristal', catalogo);
  assert.deepEqual(s.map((x) => x.produto.id), ['a', 'c']);
  assert.equal(s[0].pontuacao, 1);
  assert.ok(s[1].pontuacao < 1);
  assert.deepEqual(C.sugerirProdutos('Papel sulfite A4 75 g/m²', catalogo).map((x) => x.produto.id), ['b']);
});

test('sugestão: descrição vazia, catálogo vazio ou nada parecido devolve lista vazia', () => {
  assert.deepEqual(C.sugerirProdutos('', catalogo), []);
  assert.deepEqual(C.sugerirProdutos('Caneta azul', []), []);
  assert.deepEqual(C.sugerirProdutos('Serviço de limpeza predial', catalogo), []);
  assert.equal(C.sugerirProdutos('caneta esferografica', catalogo, 1).length, 1);
});

test('campos para o item: custo em texto canônico, só o que existe, custo 0 ou vazio não vira custo', () => {
  assert.deepEqual(C.camposParaItem(catalogo[0]), { custoUnitario: '1.20', marca: 'Bic', modelo: 'Cristal', fabricante: 'Bic Brasil' });
  assert.deepEqual(C.camposParaItem(catalogo[2]), { marca: 'Faber' });
  assert.deepEqual(C.camposParaItem({ custo_unitario: 0, marca: '' }), {});
});

test('planilha: exporta no padrão (BOM, ;, CRLF, vírgula, antifórmula) e lê de volta sem mudança', () => {
  const produtos = [{ id: '11111111-1111-4111-8111-111111111111', nome: '=Caneta; "azul"', custo_unitario: 1234.5, ativo: false, codigo_interno: 'C1' }];
  const csv = C.gerarCsv(produtos);
  assert.ok(csv.startsWith('FEFFid;codigo_interno;nome;'));
  assert.ok(csv.includes('"\'=Caneta; ""azul"""'));
  assert.ok(csv.includes(';1234,50;') && csv.endsWith(';nao\r\n'));
  const lido = C.lerCsv(csv);
  assert.equal(lido.ok, true);
  assert.equal(lido.linhas[0].valores.nome, '=Caneta; "azul"');
  const v = C.validarLinhas(lido.linhas, produtos);
  assert.deepEqual(v.resumo, { novo: 0, alterado: 0, sem_mudanca: 1, erro: 0 });
});

test('planilha: cabeçalho errado e colunas a mais são recusados', () => {
  assert.equal(C.lerCsv('nome;custo\r\nx;1\r\n').ok, false);
  const r = C.lerCsv(`${C.COLUNAS.join(';')}\r\n;;Caneta;;;;;;;;;;extra\r\n`);
  assert.equal(r.ok, false);
  assert.match(r.erros[0], /Linha 2: esperadas 12 colunas/);
});

test('importação: id > código interno > novo; vazio não altera; erros apontam a linha; tudo ou nada', () => {
  const atuais = [{ id: '22222222-2222-4222-8222-222222222222', nome: 'Caneta', codigo_interno: 'C1', custo_unitario: 1, marca: 'Bic', ativo: true }];
  const csv = [C.COLUNAS.join(';'),
    ';C1;;;;;;;1,50;;;', // pelo código: muda só o custo
    ';;Lápis;;;;;;0,80;;;', // novo
    ';;;;;;;;;;;', // vazia: ignorada
  ].join('\r\n');
  const v = C.validarLinhas(C.lerCsv(csv).linhas, atuais);
  assert.equal(v.ok, true);
  assert.deepEqual(v.resumo, { novo: 1, alterado: 1, sem_mudanca: 0, erro: 0 });
  assert.equal(v.linhas[0].dados.id, atuais[0].id);
  assert.equal(v.linhas[0].dados.custo_unitario, '1.50');
  assert.equal(v.linhas[0].dados.marca, 'Bic');
  assert.equal(v.linhas[1].dados.nome, 'Lápis');

  const ruim = [C.COLUNAS.join(';'), ';;;;;;;;1,0;;;', ';;X;;;;;;1.234,56;;;', '33333333-3333-4333-8333-333333333333;;Y;;;;;;;;;', 'abc;;Z;;;;;;;;;', ';C1;;;;;;;;;;', ';C1;;;;;;;;;;', ';;W;;;;;;;;;talvez'].join('\r\n');
  const e = C.validarLinhas(C.lerCsv(ruim).linhas, atuais);
  assert.equal(e.ok, false);
  assert.equal(e.resumo.erro, 6);
  assert.match(e.erros.join('\n'), /Linha 2: Informe o nome/);
  assert.match(e.erros.join('\n'), /Linha 3: Custo "1\.234,56"/);
  assert.match(e.erros.join('\n'), /Linha 4: produto não encontrado/);
  assert.match(e.erros.join('\n'), /Linha 5: o id não é deste sistema/);
  assert.match(e.erros.join('\n'), /Linha 7: produto repetido/);
  assert.match(e.erros.join('\n'), /Linha 8: Ativo/);
});

test('produto: limites do SQL e caracteres de controle', () => {
  assert.deepEqual(C.validarProduto({ nome: 'x'.repeat(301) }).erros.length, 1);
  assert.equal(C.validarProduto({ nome: 'ok', marca: 'a\u0007b' }).erros.length, 1);
  assert.equal(C.validarProduto({ nome: 'ok', descricao: 'linha 1\nlinha 2' }).erros.length, 0);
  assert.equal(C.validarProduto({ nome: 'ok', unidade: 'a\nb' }).erros.length, 1);
  assert.equal(C.validarProduto({ nome: 'ok', custo_unitario: '007,5' }).dados.custo_unitario, '7.50');
});

test('foto: PNG/JPEG até 1 MB e 2000 px, caminho na pasta catalogo/ com o hash', () => {
  const png = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  png.writeUInt32BE(13, 8); png.write('IHDR', 12, 'latin1'); png.writeUInt32BE(800, 16); png.writeUInt32BE(600, 20);
  assert.equal(C.validarFoto(new Uint8Array(png)).ext, 'png');
  png.writeUInt32BE(2001, 16);
  assert.match(C.validarFoto(new Uint8Array(png)).erro, /2000 px/);
  assert.match(C.validarFoto(new Uint8Array(Buffer.from('GIF89a'))).erro, /PNG ou JPEG/);
  assert.match(C.validarFoto(new Uint8Array(1024 * 1024 + 1)).erro, /1 MB/);
  assert.equal(C.caminhoFoto('o', 'e', 'f'.repeat(64), 'jpg'), `o/e/catalogo/${'f'.repeat(64)}.jpg`);
});

test('custos × vendas: soma em centavos, lucro e margem só com custo; sem custo nunca vira lucro', () => {
  const p1 = { id: 'p1', numero: 'PE 1/2026' }, p2 = { id: 'p2', numero: 'PE 2/2026' }, p3 = { id: 'p3', objeto: 'Material' };
  const itens = [
    { processo_id: 'p1', situacao: 'ganho', quantidade: 3, valor_homologado: '30.30', custo_unitario: '6.10', operacao_processos: p1 },
    { processo_id: 'p1', situacao: 'ganho', quantidade: '0.5', valor_homologado: null, valor_unitario_homologado: 10.01, custo_unitario: 4, operacao_processos: p1 },
    { processo_id: 'p2', situacao: 'ganho', quantidade: 10, valor_homologado: 100, custo_unitario: null, operacao_processos: p2 },
    { processo_id: 'p3', situacao: 'ganho', quantidade: 1, valor_homologado: null, valor_unitario_homologado: null, custo_unitario: 1, operacao_processos: p3 },
    { processo_id: 'p1', situacao: 'perdido', quantidade: 1, valor_homologado: null, custo_unitario: 1, operacao_processos: p1 },
  ];
  const r = C.resumoCustosVendas(itens, [{ id: 'p1' }, { id: 'p4', numero: 'PE 4/2026' }]);
  const [a, b, c, d] = r.processos;
  // p1: vendido 30,30 + 5,01 (10,01 × 0,5 = 5,005 → 5,01); custo 18,30 + 2,00.
  assert.deepEqual(a, { id: 'p1', rotulo: 'PE 1/2026', situacao: 'completo', vendido: 3531, custo: 2030, lucro: 1501, margem: 42.5 });
  assert.deepEqual(b, { id: 'p2', rotulo: 'PE 2/2026', situacao: 'sem_custo', vendido: 10000, custo: null, lucro: null, margem: null });
  assert.equal(c.situacao, 'sem_valor');
  assert.equal(c.rotulo, 'Material');
  assert.equal(d.situacao, 'sem_itens');
  assert.deepEqual(r.totais, { vendido: 13531, vendidoComCusto: 3531, custo: 2030, lucro: 1501, margem: 42.5, completos: 1, semCusto: 1, vendidoSemCusto: 10000, semValor: 1, semItens: 1 });
});

test('custos × vendas: nenhum processo com custo = custo, lucro e margem ausentes (não zero)', () => {
  const r = C.resumoCustosVendas([{ processo_id: 'p', situacao: 'ganho', quantidade: 1, valor_homologado: 50, custo_unitario: null }]);
  assert.equal(r.totais.vendido, 5000);
  assert.equal(r.totais.lucro, null);
  assert.equal(r.totais.custo, null);
  assert.equal(r.totais.margem, null);
  assert.deepEqual(C.resumoCustosVendas([], []).processos, []);
});

test('usar do catálogo: botão lista sugestões e devolve os campos ao escolher', () => {
  // DOM mínimo: só o que montarBotao usa.
  const no = (tag) => ({ tag, filhos: [], atributos: {}, ouvintes: {}, hidden: false, textContent: '',
    append(...f) { this.filhos.push(...f); }, replaceChildren() { this.filhos = []; },
    setAttribute(k, v) { this.atributos[k] = v; }, addEventListener(t, f) { this.ouvintes[t] = f; } });
  const doc = { createElement: no };
  let escolhido;
  const caixa = U.montarBotao({ doc, descricao: () => 'Caneta esferográfica azul', catalogo: () => catalogo, aoEscolher: (campos) => { escolhido = campos; } });
  const [botao, lista] = caixa.filhos;
  assert.equal(lista.hidden, true);
  botao.ouvintes.click();
  assert.equal(lista.hidden, false);
  assert.equal(lista.filhos.length, 2);
  assert.match(lista.filhos[0].filhos[0].textContent, /^Caneta esferográfica azul · Bic Cristal · R\$ 1,20 · 100% parecido$/);
  lista.filhos[0].filhos[2].ouvintes.click();
  assert.deepEqual(escolhido, { custoUnitario: '1.20', marca: 'Bic', modelo: 'Cristal', fabricante: 'Bic Brasil' });
  assert.equal(lista.hidden, true);
});
