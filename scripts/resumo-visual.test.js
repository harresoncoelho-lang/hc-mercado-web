const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { montar, montarVisual } = require('../resumo-modelo');

test('síntese original fica no principal e expansões documentais ficam sob demanda sem truncamento', () => {
  const fonte = 'Cláusula documental completa. '.repeat(4000);
  const estrutura = { identificacao: { objeto: 'Compra pública' }, outrasInformacoesRelevantes: ['Síntese original', fonte], condicoesPagamento: 'Pagamento em 30 dias. Trechos integrais adicionais.', estruturaSintetica: { identificacao: { objeto: 'Compra pública' }, outrasInformacoesRelevantes: ['Síntese original'], condicoesPagamento: 'Pagamento em 30 dias.' } };
  const antes = JSON.stringify(estrutura), modelo = montarVisual(estrutura);
  assert.deepEqual(modelo.secoes.find(s => s.titulo === 'Outras informações relevantes').campos[0].valor, ['Síntese original']);
  assert.equal(modelo.secoes.find(s => s.titulo === 'Condições de pagamento').campos[0].valor, 'Pagamento em 30 dias.');
  const provas = modelo.secoes.find(s => s.titulo === 'Conferir complementos e evidências documentais');
  assert.equal(provas.recolhida, true); assert.ok(JSON.stringify(provas).includes(fonte.trim()));
  assert.equal(JSON.stringify(estrutura), antes);
  assert.ok(JSON.stringify(montar(estrutura)).includes(fonte.trim()), 'exportação mantém evidências integrais');
});

test('duzentos itens só aparecem na consulta recolhida e CAPAG fica fora do órgão', () => {
  const estrutura = { orgao: { nome: 'Município exemplo' }, capag: { disponivel: true, nota: 'B', posicao: '2026-09-01', coletadoEm: '2026-10-22', fonte: 'https://www.tesourotransparente.gov.br/base', indicadores: [{ nome: 'Liquidez', nota: 'B', valor: 0.2 }] }, itensPncp: Array.from({ length: 200 }, (_, i) => ({ numeroItem: i + 1, descricao: `Produto ${i + 1}` })) };
  const modelo = montarVisual(estrutura);
  assert.equal(modelo.secoes.find(s => s.titulo === 'Consultar itens da oportunidade').campos[0].valor.length, 200);
  assert.equal(modelo.secoes.find(s => s.titulo === 'Consultar itens da oportunidade').recolhida, true);
  assert.equal(modelo.secoes.find(s => s.titulo === 'Resumo dos Itens').campos.some(c => c.rotulo.startsWith('Itens da oportunidade')), false);
  assert.equal(modelo.secoes.find(s => s.titulo === 'Órgão Responsável').campos.some(c => /CAPAG/.test(c.rotulo)), false);
  assert.ok(modelo.secoes.find(s => s.titulo.startsWith('CAPAG')).campos.some(c => c.valor === 'B'));
  assert.equal(modelo.secoes.find(s => s.titulo === 'Entender a CAPAG e consultar indicadores').recolhida, true);
});

test('a apresentação preserva cobertura canônica parcial, e o painel não cria conteúdo recolhido antes de abrir', () => {
  const modelo = montarVisual({ estruturaSintetica: { coberturaLeitura: { parcial: false } }, coberturaLeitura: { parcial: true, documentosNaoLidos: ['ETP'] } });
  assert.match(JSON.stringify(modelo.secoes.find(s => s.titulo === 'Cobertura da análise')), /Extração parcial/);
  const painel = fs.readFileSync(require('node:path').join(__dirname, '../painel.html'), 'utf8');
  assert.match(painel, /ResumoModelo\.montarVisual\(iaEstruturaAtual/);
  assert.match(painel, /if \(def\.recolhida\) secao\.addEventListener\("toggle", \(\) => \{ if \(secao\.open\) preencher\(\); \}\)/);
});
