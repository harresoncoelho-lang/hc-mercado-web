const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararFontesPergunta, formatarRespostaDocumental, avisarCobertura } = require('../_pergunta_documental');
const fonte = '--- Edital.pdf ---\n[Página 3]\nPrazo para propostas: 06/11/2026 às 08:00.\n--- TR.pdf ---\n[Página 14]\nEntrega em 10 dias após ordem de fornecimento.';
test('seleção conserva documento e página mesmo quando prioriza o fim da fonte', () => {
  const { fontes, selecaoParcial } = prepararFontesPergunta(fonte, 'Entrega e fornecimento', 200);
  const tr = fontes.find((f) => f.documento === 'TR.pdf');
  assert.equal(tr.pagina, '14'); assert.equal(selecaoParcial, true);
  const r = formatarRespostaDocumental(JSON.stringify({ naoLocalizado: false, evidencias: [{ id: tr.id, trecho: tr.texto }] }), fontes);
  assert.match(r, /Entrega em 10 dias.*\n\[TR.pdf, página 14\]/);
});
test('recusa trocar fonte de trecho existente e não exibe narrativa adicional da IA', () => {
  const { fontes } = prepararFontesPergunta(fonte, 'Entrega');
  const entrada = { naoLocalizado: false, evidencias: [{ id: 'F1', trecho: fontes[1].texto }], resposta: 'Texto inventado' };
  assert.equal(formatarRespostaDocumental(JSON.stringify(entrada), fontes), null);
  entrada.evidencias[0].id = 'F2';
  assert.doesNotMatch(formatarRespostaDocumental(JSON.stringify(entrada), fontes), /inventado/);
});
test('ausência de informação é delimitada e resposta inválida não é sucesso', () => {
  const { fontes } = prepararFontesPergunta(fonte, 'Banco');
  assert.match(formatarRespostaDocumental('{"naoLocalizado":true,"evidencias":[]}', fontes), /não comprova que ela inexista/);
  for (const valor of ['', 'null', '{}', '{"naoLocalizado":false,"evidencias":[]}', '{"naoLocalizado":true,"evidencias":[{}]}']) assert.equal(formatarRespostaDocumental(valor, fontes), null);
});
test('aviso de seleção e de leitura parcial não depende do modelo', () => {
  assert.match(avisarCobertura('Trecho validado', true, true), /leitura.*parcial[\s\S]*seleção[\s\S]*Trecho validado/i);
});
test('documento sem paginação nem cláusulas continua verificável, sem página inventada', () => {
  const { fontes } = prepararFontesPergunta('--- Aviso.txt ---\nEntrega em dez dias após ordem de compra.', 'Entrega');
  assert.equal(fontes.length, 1); assert.equal(fontes[0].documento, 'Aviso.txt');
  const r = formatarRespostaDocumental(JSON.stringify({ naoLocalizado: false, evidencias: [{ id: fontes[0].id, trecho: fontes[0].texto }] }), fontes);
  assert.match(r, /\[Aviso.txt\]/); assert.doesNotMatch(r, /página/);
});
