const test = require('node:test');
const assert = require('node:assert/strict');
const { Tiktoken } = require('js-tiktoken/lite');
const { ajustarOrcamento } = require('../_defesa_handler');
const { ancorasSolicitadas } = require('../_defesa_pontos');
function caso() {
  const fontes = [
    { id: 'F1', documento: 'anexo.pdf', pagina: '17', numero: '14.4', escopoDocumento: 'Edital', texto: '14.4. A multa será recolhida no prazo máximo de 30 dias úteis, a contar da comunicação oficial.' },
    { id: 'F2', documento: 'anexo.pdf', pagina: '25', numero: '7.7', escopoDocumento: 'Termo de Referência', texto: '7.7. A multa poderá ser recolhida administrativamente no prazo máximo de 05 dias, a contar da data do recebimento da comunicação enviada.' },
  ];
  const extras = Array.from({ length: 30 }, (_, i) => ({ id: `F${i + 3}`, documento: 'anexo.pdf', pagina: '1', numero: `99.${i + 1}`, texto: 'Informações complementares públicas. '.repeat(90) }));
  return { ctx: { fontes: [...fontes, ...extras], clausulasCanonicas: [...fontes, ...extras], normas: [], pendencias: [], cobertura: { parcial: false, fontesOmitidas: [] }, regimeConfirmado: true, dispensa: false }, body: { tipo: 'esclarecimento', questionamento: 'Conferir recolhimento de multas no subitem 14.4 do Edital e no subitem 7.7 do TR.', objetivo: 'Esclarecer o alcance da regra e suas condições com base nos documentos do edital.' } };
}
test('orçamento ancorado mede uma vez só os IDs permitidos e conserva catálogo canônico e cobertura honesta', () => {
  const { ctx, body } = caso(), catalogo = ctx.clausulasCanonicas, ancoras = ancorasSolicitadas(ctx, body);
  const encode = Tiktoken.prototype.encode; let codificacoes = 0;
  Tiktoken.prototype.encode = function (...args) { codificacoes++; return encode.apply(this, args); };
  let medida;
  try { medida = ajustarOrcamento(ctx, body, 'openai/gpt-oss-20b'); } finally { Tiktoken.prototype.encode = encode; }
  assert.ok(medida); assert.equal(codificacoes, 1);
  assert.deepEqual(ctx.fontes.map(f => f.id), ['F1', 'F2']);
  assert.equal(ctx.clausulasCanonicas, catalogo); assert.equal(catalogo.length, 32);
  assert.deepEqual(ancorasSolicitadas(ctx, body), ancoras);
  assert.equal(ctx.cobertura.parcial, true); assert.equal(ctx.cobertura.contextoParcial, true); assert.equal(ctx.cobertura.fontesOmitidas.length, 30);
  assert.ok(medida.tokens <= 7200 && medida.bytes <= 48000);
});
test('R1/M1 de fase posterior permanecem e âncoras acima do orçamento não são podadas', () => {
  const { ctx, body } = caso();
  ctx.fontes.push({ id: 'R1', declarada: true, documento: 'Resposta declarada', texto: 'O órgão informa que os prazos devem ser conferidos.' }, { id: 'M1', declarada: true, documento: 'Manifestação anterior', texto: 'Foi solicitado esclarecer os marcos dos prazos.' });
  body.fase = 'resposta_orgao';
  const medida = ajustarOrcamento(ctx, body, 'openai/gpt-oss-20b');
  assert.ok(medida); assert.deepEqual(ctx.fontes.map(f => f.id), ['F1', 'F2', 'R1', 'M1']);
  const enorme = caso(); enorme.body.objetivo = '龘'.repeat(3000);
  assert.equal(ajustarOrcamento(enorme.ctx, enorme.body, 'openai/gpt-oss-20b'), null);
  assert.deepEqual(enorme.ctx.fontes.map(f => f.id), ['F1', 'F2']);
  assert.deepEqual(ancorasSolicitadas(enorme.ctx, enorme.body).flatMap(a => a.fontesPermitidas), ['F1', 'F2']);
});
