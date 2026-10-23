const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { Tiktoken } = require('js-tiktoken/lite');
const { executarDefesa } = require('../_defesa_handler');
const textoEdital = '--- Edital ---\n[Página 1]\nLei 14.133/2021.\n14.4. A multa será recolhida em trinta dias úteis, a contar da comunicação oficial.';
const body = { tipo: 'esclarecimento', edital: { numeroControlePNCP: '00394452000103-1-022237/2026' }, hashFonte: createHash('sha256').update(textoEdital).digest('hex'), questionamento: 'Esclarecer o recolhimento da multa no subitem 14.4 do Edital.' };
async function executar(objetivo, fonte = textoEdital, questionamento = body.questionamento) {
  let codificacoes = 0, cotas = 0, chamadas = 0, bytesCodificados = 0, tokensExatos = 0;
  const encode = Tiktoken.prototype.encode;
  Tiktoken.prototype.encode = function (...args) { codificacoes++; bytesCodificados = Buffer.byteLength(args[0]); const tokens = encode.apply(this, args); tokensExatos = tokens.length + 256 + 2500; return tokens; };
  let resultado;
  try {
    resultado = await executarDefesa({ ...body, questionamento, objetivo, hashFonte: createHash('sha256').update(fonte).digest('hex') }, { sessao: { ok: true, userId: 'qa' }, env: { GROQ_API_KEY: 'fixture', DEFESA_IA_GRATUITA_CONFIRMADA: 'true' }, carregar: async () => ({ versao: 17, fonteLida: true, textoEdital: fonte, estrutura: { identificacao: { modalidade: 'Pregão' } } }), autorizar: async () => { cotas++; return { ok: true }; }, chamar: async (_, mensagens, schema) => {
      chamadas++;
      const ramo = schema.properties.ancoras.properties.A1.anyOf.find(r => r.properties.tipo.enum[0] === 'esclarecer_recolhimento_multa');
      return { ok: true, texto: JSON.stringify({ ancoras: { A1: { tipo: 'esclarecer_recolhimento_multa', fontes: ramo.properties.fontes.items.enum, fundamentos: [] } } }) };
    } });
  } finally { Tiktoken.prototype.encode = encode; }
  return { resultado, codificacoes, cotas, chamadas, bytesCodificados, tokensExatos };
}
test('fragmentos extremos Unicode, combining, emoji e ASCII são recusados antes da codificação e da cota', async () => {
  for (const objetivo of ['龘'.repeat(3000), 'a\u0301'.repeat(1500), '\u0301'.repeat(3000), '😀'.repeat(1500), 'x'.repeat(3000)]) {
    const r = await executar(objetivo);
    assert.equal(r.resultado.statusCode, 422);
    assert.equal(r.codificacoes, 0); assert.equal(r.cotas, 0); assert.equal(r.chamadas, 0);
  }
});
test('guarda cobre também a fonte e não corta nem modifica evidências para caber', async () => {
  const fonte = textoEdital + ' Código de referência: ' + '龘'.repeat(600);
  const r = await executar('Confirmar os marcos e as unidades do prazo.', fonte);
  assert.equal(r.resultado.statusCode, 422);
  assert.equal(r.codificacoes, 0); assert.equal(r.cotas, 0); assert.equal(r.chamadas, 0);
});
test('português extenso, acentos combinados, emojis, URLs longas e e-mail usam contagem exata', async () => {
  const url = 'https://pncp.gov.br/app/editais/' + 'documento/'.repeat(120) + '?id=00394452000103';
  const email = 'contato.' + 'x'.repeat(50) + '@' + 'a'.repeat(60) + '.gov.br';
  for (const objetivo of ['Confirmar a contagem, a comunicação oficial e a ciência do destinatário. '.repeat(25), 'Conferir comunicac\u0327a\u0303o oficial e condic\u0327o\u0303es. ✅ 📄 ⚖️', `Consultar ${url} e ${email}, preservando o prazo.`, '龘'.repeat(80), '😀'.repeat(20)]) {
    const r = await executar(objetivo);
    assert.equal(r.resultado.statusCode, 200);
    assert.equal(r.codificacoes, 1); assert.equal(r.cotas, 1); assert.equal(r.chamadas, 1);
    assert.ok(r.tokensExatos <= 7200 && r.bytesCodificados <= 48000);
    assert.equal(r.resultado.dados.analise.fatos[0].texto.includes('trinta dias úteis'), true);
  }
});
test('agregado de fragmentos Unicode curtos dentro de 48KB conserva orçamento exato e bloqueia antes da cota', async () => {
  const fragmento = '龘'.repeat(83);
  assert.equal(Buffer.byteLength(fragmento), 249);
  const fonte = '--- Edital ---\n[Página 1]\nLei 14.133/2021.\n' + Array.from({ length: 4 }, (_, i) => `${i + 1}.1. A multa será recolhida em 5 dias após a comunicação oficial. ${Array(40).fill(fragmento).join(' ')}`).join('\n');
  const r = await executar('Confirmar os marcos de contagem.', fonte, 'Esclarecer o recolhimento da multa nos itens 1.1, 2.1, 3.1 e 4.1 do Edital.');
  assert.equal(r.resultado.statusCode, 422);
  assert.equal(r.codificacoes, 1); assert.ok(r.bytesCodificados > 45000 && r.bytesCodificados <= 48000);
  assert.ok(r.tokensExatos > 7200); assert.equal(r.cotas, 0); assert.equal(r.chamadas, 0);
});
