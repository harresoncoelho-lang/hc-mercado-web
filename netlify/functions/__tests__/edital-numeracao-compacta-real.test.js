const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../_edital_operacional');
const fonte = fs.readFileSync(path.join(__dirname, '../../../docs/qa/editais-reais-novos/08928517000157-116/fonte-produto.txt'), 'utf8');

test('dispensa real Belém reconhece cláusulas compactas, referências e condicionais', () => {
  const clausulas = api.clausulasDaFonte(fonte);
  const pagamento = clausulas.find(c => c.numero === '10.1');
  assert.ok(pagamento, 'Cláusula real10.1 sem espaço deve ser reconhecida');
  assert.equal(pagamento.pagina, '3');
  assert.match(pagamento.secao, /PAGAMENTO/);
  assert.match(pagamento.texto, /trinta dias.*adimplemento/);
  assert.doesNotMatch(pagamento.texto, /11\.0/);
  const catalogo = api.catalogarRequisitos(fonte);
  assert.ok(catalogo.length > 0);
  assert.ok(catalogo.some(c => /11\.1\.Se necessária/.test(c.texto)));
  assert.ok(catalogo.some(c => /11\.2\..*poderá ser dispensada/.test(c.texto)));
  assert.match(api.marcarRequisitosNaFonte(fonte), /\[EXIGÊNCIA R\d{4} documentosHabilitacao\]/);
  assert.ok(api.localizarReferencia('Termo de Referencia (#2), página 3', api.paginasDaFonte(fonte)));
});

test('datas e valores não viram cláusulas; referências compactas sem página funcionam', () => {
  const texto = '--- Documento oficial ---\n22.10.2026 até12h\n57.382,60 reais\n11.0.DA HABILITAÇÃO\n11.1.Se necessária a qualificação, apresentar documentos.\n11.2.Poderá ser dispensada nas hipóteses legais.';
  assert.deepEqual(api.clausulasDaFonte(texto).map(c => c.numero), ['11.0', '11.1', '11.2']);
  assert.ok(api.localizarReferencia('Documento oficial, cláusula 11.1', api.paginasDaFonte(texto)));
});

test('TR real Belém conserva entrega cinco dias, marco do pedido e local indicado', () => {
  const { conferirFatosDocumentais } = require('../_resumo_documental');
  const estrutura = { entregaExecucao: { prazo: 'Não informado', local: 'Não informado', condicoes: 'Não informado' } };
  const r = conferirFatosDocumentais({ estrutura, textoEdital: fonte }).estrutura;
  assert.match(r.entregaExecucao.prazo, /Entrega: 5 \(cinco\) dias/);
  assert.match(r.entregaExecucao.prazo, /emissão do Pedido de Compra/);
  assert.match(r.entregaExecucao.prazo, /página 2/);
  assert.match(r.entregaExecucao.local, /sede do Contratante.*unidades administrativas.*indicada/);
  assert.match(r.detalhes.prazoEntrega, /Pedido de Compra/);
  assert.match(r.condicoesPagamento, /trinta dias.*adimplemento/);
});

test('entrega de proposta e amostra não se torna prazo contratual', () => {
  const { conferirFatosDocumentais } = require('../_resumo_documental');
  for (const termo of ['proposta', 'amostra', 'ficha técnica']) {
    const texto = `--- Edital ---\n[Página 1]\n8.0.DOS PRAZOS\n8.1.O prazo para entrega da ${termo} será contado da convocação.\n8.1.1.Entrega:5 dias.\n8.2.O local para a entrega será na sede do órgão.`;
    const estrutura = { entregaExecucao: { prazo: 'Não informado', local: 'Não informado' } };
    const r = conferirFatosDocumentais({ estrutura, textoEdital: texto }).estrutura;
    assert.equal(r.entregaExecucao.prazo, 'Não informado');
    assert.equal(r.entregaExecucao.local, 'Não informado');
  }
});
