const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararContexto, diagnosticarAnalise } = require('../_defesa_contexto');
const { pontosDisponiveis } = require('../_defesa_pontos');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '../../../docs/qa/editais-reais-novos/88124961000159-125/revisao-visual-20261022');
const body = JSON.parse(fs.readFileSync(path.join(dir, 'pedido-central-entrega-revisada.json')));
const dossie = JSON.parse(fs.readFileSync(path.join(dir, 'dossie-documental-revisado.json'))).dossie;
test('recuperação real inclui minuta de entregas antes do orçamento e exclui recursos/sanções do catálogo de entregas', () => {
 const ctx = prepararContexto(dossie, body);
 assert.ok(ctx.fontes.some(f => /15\s*\(quinze\)\s*dias/i.test(f.texto) && /ordem de fornecimento/i.test(f.texto)));
 const pontos = pontosDisponiveis(ctx, body);
 assert.ok(pontos.some(p => p.tipo === 'esclarecer_fornecimento'));
 assert.ok(!pontos.some(p => p.tipo === 'esclarecer_organizacao_objeto'));
 assert.ok(!pontos.flatMap(p => p.fontesPermitidas).some(id => ctx.fontes.find(f => f.id === id).numero === '20.1.3'));
 const permitidas = pontos.filter(p => p.tipo === 'especificar_cronograma').flatMap(p => p.fontesPermitidas);
 for (const id of permitidas) assert.ok(!/caber[aá] recurso|intima[cç][aã]o|defesa.*san[cç]/i.test(ctx.fontes.find(f => f.id === id).texto));
});
test('prazo de recurso que menciona recebimento não é prazo de entrega e é recusado no servidor', () => {
 const ctx = { fontes: [{ id:'F1', texto:'12.4. O recurso será apresentado em 3 dias úteis do recebimento da intimação.', documento:'Edital' }], normas:[], pendencias:[] };
 assert.equal(diagnosticarAnalise(JSON.stringify({pontos:[{tipo:'especificar_cronograma',fontes:['F1'],fundamentos:[]}]}),ctx,body).motivo,'ponto_sem_antecedente');
});


const ponto = (tipo, fontes) => ({ pontos: [{ tipo, fontes, fundamentos: [] }] });
const cenario = (texto, questionamento, tipo = 'esclarecimento') => ({
 ctx: { fontes: [{ id: 'F1', documento: 'Documento sintético de teste', texto }], normas: [], pendencias: [] },
 body: { tipo, fase: 'questionamento', questionamento, edital: body.edital },
});
const analisar = (c, tipo) => diagnosticarAnalise(JSON.stringify(ponto(tipo, ['F1'])), c.ctx, c.body);

test('regra financeira adjacente real não vira requisição só por citar empenho e entrega', () => {
 const real = require('../_edital_operacional').clausulasDaFonte(dossie.textoEdital).find(f => f.numero === '8.5');
 assert.ok(real);
 const f = { ...real, id: 'F1' };
 const ctx = { fontes: [f], normas: [], pendencias: [] };
 const recuperado = prepararContexto(dossie, body);
 assert.ok(!pontosDisponiveis(recuperado, body).flatMap(p => p.fontesPermitidas).some(id => recuperado.fontes.find(f => f.id === id).numero === '8.5'));
 for (const tipo of ['esclarecimento', 'impugnacao']) {
  const b = { ...body, tipo };
  assert.equal(diagnosticarAnalise(JSON.stringify(ponto('esclarecer_fornecimento', [f.id])), ctx, b).motivo, 'ponto_sem_antecedente');
 }
});

test('prazo financeiro com entrega como marco não é prazo operativo de entrega', () => {
 const c = cenario('Os preços permanecerão fixos por 30 dias desde a ordem de fornecimento até a entrega dos produtos.', 'Qual o prazo de entrega de cada ordem de fornecimento?');
 for (const tipo of ['esclarecer_fornecimento', 'especificar_cronograma']) assert.equal(analisar(c, tipo).motivo, 'ponto_sem_antecedente');
});

test('comando integrado de entrega com preços fixos e condição de pagamento conserva texto integral', () => {
 const texto = 'Os produtos deverão ser entregues em 15 dias da ordem de fornecimento; os preços permanecerão fixos e o pagamento será em 30 dias após o recebimento.';
 for (const questao of ['Como será a entrega dos produtos?', 'Quais os prazos de entrega e pagamento?']) {
  for (const tipo of ['esclarecimento', 'impugnacao']) {
   const c = cenario(texto, questao, tipo);
   const r = analisar(c, 'especificar_cronograma');
   assert.equal(r.motivo, null);
   assert.equal(r.analise.fatos[0].texto, texto);
  }
 }
});

test('pagamento permanece elegível e entrega não substitui prazo de pagamento', () => {
 const pagamento = cenario('O pagamento será efetuado em 30 dias após o recebimento definitivo da ordem de fornecimento.', 'Qual o prazo de pagamento?');
 assert.equal(analisar(pagamento, 'especificar_cronograma').motivo, null);
 const entrega = cenario('Os produtos deverão ser entregues em 15 dias da ordem de fornecimento.', 'Qual o prazo de pagamento?');
 assert.equal(analisar(entrega, 'especificar_cronograma').motivo, 'ponto_sem_antecedente');
});

test('documentos condicionais continuam literais em esclarecimento e impugnação; tema fora do escopo falha fechado', () => {
 const texto = 'Se necessária a verificação, serão solicitados documentos de habilitação; a documentação poderá ser dispensada nas condições indicadas.';
 for (const tipo of ['esclarecimento', 'impugnacao']) {
  const c = cenario(texto, 'Como se aplicam as condições de documentos de habilitação?', tipo);
  const r = analisar(c, 'esclarecer_excecao');
  assert.equal(r.motivo, null);
  assert.equal(r.analise.fatos[0].texto, texto);
  assert.ok(!r.analise.minutaTexto.includes('é ilegal'));
 }
 const fora = cenario('O pagamento será em 30 dias do recebimento definitivo.', 'Como pedir indenização por danos morais?');
 assert.equal(pontosDisponiveis(fora.ctx, fora.body).length, 0);
 assert.equal(analisar(fora, 'especificar_cronograma').motivo, 'ponto_sem_antecedente');
});


test('evento explícito da pergunta prevalece sobre execução genérica no objetivo, sem apagar questão mista', () => {
 const texto = 'O pagamento será efetuado em 10 dias após a execução contratual.';
 const c = cenario(texto, 'Qual é o prazo de entrega dos produtos?');
 c.body.objetivo = 'Confirmar a execução contratual.';
 assert.equal(analisar(c, 'especificar_cronograma').motivo, 'ponto_sem_antecedente');
 c.body.questionamento = 'Quais são os prazos de entrega e pagamento?';
 assert.equal(analisar(c, 'especificar_cronograma').motivo, null);
});

test('filtro de adjacência de entrega não apaga condição financeira integrada a assinatura', () => {
 const c = cenario('A assinatura será realizada em 5 dias da convocação; os preços permanecerão fixos.', 'Qual o prazo de assinatura?');
 assert.equal(analisar(c, 'especificar_cronograma').motivo, null);
});

test('pergunta financeira não transforma marco de preços em comando de requisição', () => {
 const c = cenario('Os preços permanecerão fixos desde a ordem de fornecimento até a entrega dos produtos.', 'Como se aplicam os preços fixos até a entrega?');
 assert.equal(analisar(c, 'esclarecer_fornecimento').motivo, 'ponto_sem_antecedente');
 assert.equal(pontosDisponiveis(c.ctx, c.body).length, 0);
});

test('verbo de pagamento próximo ao nome entrega não é comando de entregar', () => {
 for (const texto of ['O pagamento será efetuado em 30 dias após a entrega dos produtos.', 'O prazo de pagamento será de 30 dias após a entrega dos produtos.', 'O prazo de pagamento será de 30 dias após a data de entrega dos produtos.']) {
  const c = cenario(texto, body.questionamento);
  c.body.objetivo = body.objetivo;
  assert.equal(analisar(c, 'especificar_cronograma').motivo, 'ponto_sem_antecedente');
 }
});


test('produtos entregues como objeto do pagamento não são ordem de entregar', () => {
 const c = cenario('O pagamento será feito pelos produtos entregues em 10 dias após cada entrega.', 'Qual o prazo de entrega?');
 assert.equal(analisar(c, 'especificar_cronograma').motivo, 'ponto_sem_antecedente');
 for (const texto of ['Os produtos deverão ser entregues em 15 dias da ordem de fornecimento; os preços permanecerão fixos.', 'Os produtos serão entregues em 15 dias da ordem de fornecimento; o pagamento será posterior.']) {
  const positivo = cenario(texto, 'Qual o prazo de entrega?');
  assert.equal(analisar(positivo, 'especificar_cronograma').motivo, null);
 }
});

