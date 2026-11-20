// Lógica pura do checklist da esteira (checklist-esteira-ui.js): rótulos de estado, alertas, ordenação, pendências e lote.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../checklist-esteira-ui.js');

test('rótulos de estado da etapa', () => {
  assert.deepEqual(C.rotuloEtapa('itens', undefined), { texto: 'Ainda não começou', tom: 'neutro' });
  assert.equal(C.rotuloEtapa('exigencias', { estado: 'executando' }).texto, 'Lendo o edital…');
  assert.equal(C.rotuloEtapa('itens', { estado: 'executando' }).texto, 'Buscando os itens…');
  assert.equal(C.rotuloEtapa('exigencias', { estado: 'pendente', detalhe: { situacao: 'aguardando_dossie' } }).texto, 'Esperando o edital ser lido…');
  assert.equal(C.rotuloEtapa('exigencias', { estado: 'pendente' }).texto, 'Na fila…');
  assert.equal(C.rotuloEtapa('exigencias', { estado: 'aguardando_leitura' }).tom, 'erro');
  const falhou = C.rotuloEtapa('itens', { estado: 'falhou', erro: 'HTTP 500 interno' });
  assert.deepEqual(falhou, { texto: 'Falhou', tom: 'erro', acao: 'tentar' }, 'erro técnico não vai para a tela; vira botão');
  assert.deepEqual(C.rotuloEtapa('itens', { estado: 'feito', detalhe: { total: 12 } }), { texto: 'Pronto: 12 itens', tom: 'ok' });
  assert.equal(C.rotuloEtapa('itens', { estado: 'feito', detalhe: { total: 1 } }).texto, 'Pronto: 1 item');
  assert.equal(C.rotuloEtapa('exigencias', { estado: 'feito', detalhe: {} }).texto, 'Pronto');
  assert.equal(C.rotuloEtapa('exigencias', { estado: 'desconhecido' }).tom, 'neutro');
});

test('documentos: falta gerar, [PREENCHER], revisar e pronto', () => {
  assert.equal(C.rotuloDocumentos(0, []).texto, 'Nenhuma declaração pedida');
  assert.equal(C.rotuloDocumentos(3, []).texto, 'Falta gerar 3 declarações');
  assert.equal(C.rotuloDocumentos(1, []).texto, 'Falta gerar 1 declaração');
  const docs = [{ versao: 2, revisao_versao: 2, texto: 'ok' }, { versao: 1, revisao_versao: null, texto: 'A [PREENCHER: cidade]' }, { versao: 1, texto: null }];
  assert.deepEqual(C.contarDeclaracoes(docs), { total: 3, comPreencher: 1, revisadas: 1 });
  assert.equal(C.rotuloDocumentos(3, docs).texto, '1 com campos a preencher');
  assert.equal(C.rotuloDocumentos(2, [{ versao: 2, revisao_versao: 1, texto: 'x' }]).texto, '1 para revisar');
  assert.deepEqual(C.rotuloDocumentos(1, [{ versao: 3, revisao_versao: 3, texto: 'x' }]), { texto: 'Pronto', tom: 'ok' });
});

test('alerta de leitura: um por anexo não lido; sem lista usa a mensagem do robô', () => {
  assert.deepEqual(C.alertasLeitura({ estado: 'feito' }), []);
  const a = C.alertasLeitura({ estado: 'aguardando_leitura', detalhe: { naoLidos: [{ documento: 'TR.rar', estado: 'nao_lido', motivo: 'volume ausente' }, { documento: 'Edital.pdf', estado: 'parcial', motivo: 'OCR' }] } });
  assert.deepEqual(a.map((x) => x.texto), ['Não consegui ler o anexo TR.rar.', 'Não consegui ler por completo o anexo Edital.pdf.']);
  assert.equal(a[0].motivo, 'volume ausente');
  assert.equal(C.alertasLeitura({ estado: 'aguardando_leitura', detalhe: { mensagem: 'Nenhum documento foi lido.' } })[0].texto, 'Nenhum documento foi lido.');
  assert.equal(C.alertasLeitura({ estado: 'aguardando_leitura' }).length, 1);
});

test('alerta de cobertura: capitaliza, fecha a frase e conta o que ficou fora do detalhe', () => {
  const r = C.alertasCobertura({ detalhe: { alertas: [{ mensagem: 'o TR cita declaração na pág. 14 e nenhuma exigência foi extraída' }, { mensagem: '  ' }], totalAlertas: 4 } });
  assert.deepEqual(r, ['O TR cita declaração na pág. 14 e nenhuma exigência foi extraída.', 'Mais 3 trechos para conferir.']);
  assert.deepEqual(C.alertasCobertura(undefined), []);
});

test('ordenação: incomum no topo, depois falta > vence > conferir > vigente, depois documento/página/código', () => {
  const lista = [
    { codigo: 'R5', situacao: 'vigente', documento: 'A', pagina: 1 },
    { codigo: 'R4', situacao: 'falta', documento: 'B', pagina: 2 },
    { codigo: 'R3', situacao: 'vigente', incomum: true, documento: 'A', pagina: 9 },
    { codigo: 'R2', situacao: 'falta', documento: 'B', pagina: 1 },
    { codigo: 'R1', situacao: 'conferir', documento: null },
    { codigo: 'R0', situacao: 'vence_antes_da_sessao', documento: 'Z' },
  ];
  assert.deepEqual(C.ordenarExigencias(lista).map((e) => e.codigo), ['R3', 'R2', 'R4', 'R0', 'R1', 'R5']);
  assert.equal(lista[0].codigo, 'R5', 'não altera a lista original');
  assert.deepEqual(C.ordenarExigencias(null), []);
});

test('pendências: "não se aplica" sai da conta; "atendo" tira a falta de documento', () => {
  const p = C.contarPendencias([
    { resposta: 'pendente', situacao: 'falta', incomum: true },
    { resposta: 'atendo', situacao: 'falta' },
    { resposta: 'vou_providenciar', situacao: 'vence_antes_da_sessao' },
    { resposta: 'nao_se_aplica', situacao: 'falta', incomum: true },
    { situacao: 'vigente' },
  ]);
  assert.deepEqual(p, { total: 4, semResposta: 2, providenciar: 1, falta: 1, venceAntes: 1, incomuns: 1 });
  assert.equal(C.contarPendencias([]).total, 0);
});

test('lote de declarações: biblioteca sem repetir, livre com marcador, ignora "não se aplica" e outras categorias', () => {
  const lote = C.loteDeclaracoes([
    { codigo: 'R1', categoria: 'declaracao', texto: 'Declaração de que não emprega menor de 18 anos em trabalho noturno, perigoso ou insalubre' },
    { codigo: 'R2', categoria: 'declaracao', texto: 'Declaração de não emprego de menor', modelo_declaracao: 'TRAB_MENOR' },
    { codigo: 'R3', categoria: 'declaracao', texto: 'Declaração de visita ao almoxarifado municipal', documento: 'TR.pdf', pagina: 14, trecho: 'declarar que visitou' },
    { codigo: 'R4', categoria: 'declaracao', texto: 'Declaração de fato impeditivo', resposta: 'nao_se_aplica' },
    { codigo: 'R5', categoria: 'fiscal', texto: 'CND federal' },
  ]);
  assert.deepEqual(lote[0], { modeloCodigo: 'TRAB_MENOR' });
  assert.equal(lote.length, 2);
  assert.equal(lote[1].modeloCodigo, 'livre');
  assert.ok(lote[1].texto.startsWith('[PREENCHER:'), 'sem modelo: marcador bloqueia revisão até redigir');
  assert.ok(lote[1].texto.includes('"declarar que visitou"'));
  assert.equal(lote[1].fonte, 'Exigência do edital: TR.pdf, pág. 14');
  const muitos = Array.from({ length: 40 }, (_, n) => ({ codigo: 'X' + n, categoria: 'declaracao', texto: 'Declaração especial número ' + n }));
  assert.equal(C.loteDeclaracoes(muitos).length, 30, 'mesmo teto do servidor');
});

test('tabela ausente: 42P01, PGRST205 ou 404; outros erros não escondem', () => {
  assert.equal(C.tabelaAusente({ code: '42P01' }), true);
  assert.equal(C.tabelaAusente({ code: 'PGRST205' }), true);
  assert.equal(C.tabelaAusente({ status: 404 }), true);
  assert.equal(C.tabelaAusente({ code: '42501' }), false);
  assert.equal(C.tabelaAusente(null), false);
});

test('tentar de novo: chama a RPC com processo e etapa e traduz cada recusa do banco', async () => {
  const chamadas = [];
  const cliente = (error) => ({ rpc: async (nome, args) => { chamadas.push([nome, args]); return { data: null, error }; } });
  assert.deepEqual(await C.tentarDeNovo(cliente(null), 'p1', 'itens'), { ok: true, mensagem: 'Pedido feito. A etapa voltou para a fila.' });
  assert.deepEqual(chamadas[0], ['esteira_tentar_de_novo', { p_processo: 'p1', p_etapa: 'itens' }]);
  assert.match((await C.tentarDeNovo(cliente({ code: '42501', message: 'x' }), 'p1', 'itens')).mensagem, /Seu acesso não permite/);
  const teto = await C.tentarDeNovo(cliente({ code: 'P0001', message: 'Esta etapa já foi tentada de novo 3 vezes hoje. Tente amanhã ou fale com o suporte' }), 'p1', 'itens');
  assert.deepEqual(teto, { ok: false, mensagem: 'Esta etapa já foi tentada de novo 3 vezes hoje. Tente amanhã ou fale com o suporte.' });
  assert.match((await C.tentarDeNovo(cliente({ code: 'PGRST202' }), 'p1', 'itens')).mensagem, /Fale com o suporte/);
  const tecnico = await C.tentarDeNovo(cliente({ code: '500', message: 'HTTP 500 interno' }), 'p1', 'itens');
  assert.equal(tecnico.ok, false);
  assert.ok(!tecnico.mensagem.includes('HTTP'), 'erro técnico não vai para a tela');
  assert.equal((await C.tentarDeNovo({ rpc: async () => { throw new Error('rede'); } }, 'p1', 'itens')).ok, false);
});

test('lote de declarações: modelo do edital > biblioteca > livre; o mesmo modelo do edital vai uma vez', () => {
  const modelo = 'ANEXO III - MODELO DE DECLARAÇÃO\nDeclaro que não emprego menor.';
  const lote = C.loteDeclaracoes([
    { codigo: 'R1', categoria: 'declaracao', texto: 'Declaração de que não emprega menor de 18 anos em trabalho noturno', modelo_declaracao: 'TRAB_MENOR',
      modelo_texto: modelo, modelo_fonte: { documento: 'Edital (#1)', pagina: 30 } },
    { codigo: 'R2', categoria: 'declaracao', texto: 'Declaração de não emprego de menor (repetida)', modelo_texto: modelo, modelo_fonte: { documento: 'Edital (#1)', pagina: 30 } },
    { codigo: 'R3', categoria: 'declaracao', texto: 'Declaração de que não emprega menor de 18 anos', modelo_texto: '   ' },
    { codigo: 'R4', categoria: 'declaracao', texto: 'Declaração de visita ao almoxarifado municipal' },
    { codigo: 'R5', categoria: 'declaracao', texto: 'Declaração com modelo, mas não se aplica', modelo_texto: 'outro', resposta: 'nao_se_aplica' },
  ]);
  assert.deepEqual(lote[0], { modeloCodigo: 'edital', titulo: 'Declaração de que não emprega menor de 18 anos em trabalho noturno', texto: modelo,
    fonte: 'Modelo do próprio edital (texto literal): Edital (#1), pág. 30. Confira com o original.' });
  assert.deepEqual(lote.map((p) => p.modeloCodigo), ['edital', 'TRAB_MENOR', 'livre'], 'modelo vazio cai na biblioteca; sem nada, livre');
  assert.equal(C.loteDeclaracoes([{ categoria: 'declaracao', texto: 'x', modelo_texto: 'Modelo' }])[0].fonte, 'Modelo do próprio edital (texto literal). Confira com o original.');
});
test('B3: título curto da declaração e cláusula de sanção fora do lote', () => {
  const t = C.tituloDeclaracao;
  assert.equal(t('No cadastramento da proposta inicial, o licitante declarará, em campo próprio do sistema, que:', 12), 'Declaração exigida pelo edital (pág. 12)');
  assert.equal(t('O licitante organizado em cooperativa deverá declarar, ainda, em campo próprio do sistema eletrônico, que cumpre os requisitos estabelecidos no artigo 16 da Lei nº 14.133, de 2021'),
    'Declaração de que cumpre os requisitos estabelecidos no artigo 16 da Lei nº 14.133, de…');
  assert.equal(t('O licitante deverá apresentar, sob pena de desclassificação, declaração de que suas propostas econômicas compreendem a integralidade dos custos para atendimento dos direitos trabalhistas'),
    'Declaração de que suas propostas econômicas compreendem a integralidade dos custos para…');
  assert.equal(t('Declaração de visita ao almoxarifado municipal'), 'Declaração de visita ao almoxarifado municipal');
  assert.ok(t('x'.repeat(500)).length <= 90);
  const lote = C.loteDeclaracoes([
    { codigo: 'S1', categoria: 'declaracao', texto: 'Caberá a apresentação de pedido de reconsideração da aplicação da sanção de declaração de inidoneidade para licitar' },
    { codigo: 'S2', categoria: 'declaracao', texto: 'No cadastramento da proposta inicial, o licitante declarará, em campo próprio do sistema, que:', pagina: 12 },
  ]);
  assert.deepEqual(lote.map((p) => p.titulo), ['Declaração exigida pelo edital (pág. 12)']);
});
