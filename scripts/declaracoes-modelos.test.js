const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../declaracoes-modelos.js');

const DADOS = {
  razao_social: 'Alfa Comércio Ltda', cnpj: '12.345.678/0001-90', endereco: 'Rua A, 10, Manaus/AM', representante: 'Maria Souza',
  cpf_representante: '123.456.789-00', cargo: 'Sócia-administradora', numero_edital: '90012/2026', orgao: 'Prefeitura de Manaus',
  objeto: 'aquisição de material de expediente', cidade: 'Manaus', data: '18 de novembro de 2026', porte: 'microempresa', nome_fantasia: 'Alfa',
};

test('todo modelo tem os campos obrigatórios, revisão pendente e só variáveis permitidas', () => {
  for (const m of D.listarModelos()) {
    assert.match(m.codigo, /^[A-Z0-9_]+$/);
    assert.ok(Number.isInteger(m.versao) && m.versao >= 1, m.codigo);
    for (const c of ['titulo', 'baseLegal', 'categoria', 'texto']) assert.ok(typeof m[c] === 'string' && m[c].trim(), `${m.codigo}.${c}`);
    assert.ok(m.padroes.length > 0 && m.padroes.every((p) => p instanceof RegExp), m.codigo);
    assert.equal(m.revisaoJuridica, 'pendente');
    for (const [, nome] of m.texto.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)) assert.ok(D.VARIAVEIS.includes(nome), `${m.codigo}: ${nome}`);
  }
  assert.ok(D.listarModelos().length >= 18);
});

test('códigos são únicos e obterModelo acha cada um', () => {
  const codigos = D.listarModelos().map((m) => m.codigo);
  assert.equal(new Set(codigos).size, codigos.length);
  for (const c of codigos) assert.equal(D.obterModelo(c).codigo, c);
  assert.equal(D.obterModelo('NAO_EXISTE'), null);
});

test('preencher com dados completos não deixa lacuna', () => {
  const r = D.preencher(D.obterModelo('ME_EPP_ENQUADRAMENTO'), DADOS);
  assert.deepEqual(r.faltando, []);
  assert.doesNotMatch(r.texto, /\{\{|(^|[^_])____([^_]|$)/); // a linha de assinatura (sublinhado longo) não conta
  assert.match(r.texto, /^Alfa Comércio Ltda, inscrita no CNPJ sob o nº 12\.345\.678\/0001-90/);
  assert.match(r.texto, /condição de microempresa/);
});

test('preencher com dados faltando marca ____ e lista cada variável uma vez', () => {
  const r = D.preencher(D.obterModelo('TRAB_MENOR'), { ...DADOS, cpf_representante: '', data: null, representante: '   ' });
  assert.deepEqual(r.faltando.sort(), ['cpf_representante', 'data', 'representante']);
  assert.match(r.texto, /neste ato representada por ____, Sócia/);
});

test('preencher trata dados como texto puro: sem reinjeção de variável, sem $ especial, sem controle', () => {
  const modelo = { texto: '{{razao_social}} / {{cnpj}} / {{desconhecida}}' };
  const r = D.preencher(modelo, { razao_social: '<b>{{cnpj}}</b> $& $1', cnpj: 'a\u0000b\nc' });
  assert.equal(r.texto, '<b>{{cnpj}}</b> $& $1 / a b c / {{desconhecida}}');
  assert.deepEqual(r.faltando, []);
});

const FRASES = [
  ['Declaração de que atende aos requisitos de habilitação, conforme art. 63, I, da Lei nº 14.133/2021', 'HAB_ART63_I'],
  ['Declaração de inexistência de fato superveniente impeditivo da habilitação', 'HAB_FATO_IMPEDITIVO'],
  ['Declaração de que não emprega menor de 18 anos em trabalho noturno, perigoso ou insalubre e menor de 16 anos, salvo na condição de aprendiz (art. 7º, XXXIII, da CF)', 'TRAB_MENOR'],
  ['DECLARAÇÃO DE ELABORAÇÃO INDEPENDENTE DE PROPOSTA', 'PROP_INDEPENDENTE'],
  ['Declaração de que a licitante se enquadra como microempresa ou empresa de pequeno porte, nos termos da Lei Complementar nº 123/2006', 'ME_EPP_ENQUADRAMENTO'],
  ['Declaração de que cumpre as exigências de reserva de cargos para pessoa com deficiência e para reabilitado da Previdência Social', 'HAB_RESERVA_PCD'],
  ['Declaração de que suas propostas econômicas compreendem a integralidade dos custos para atendimento dos direitos trabalhistas, das normas infralegais e das convenções coletivas', 'PROP_CUSTOS_TRABALHISTAS'],
  ['Declaração de que não possui, em sua cadeia produtiva, empregados executando trabalho degradante ou forçado', 'TRAB_DEGRADANTE'],
  ['Declaração de que conhece as condições locais para a execução do objeto, abrindo mão da vistoria', 'EXEC_VISTORIA_DISPENSA'],
  ['Declaração de inexistência de vínculo de parentesco até o terceiro grau com servidores do órgão licitante', 'IMP_PARENTESCO'],
  ['Declaração de que observa a Lei nº 12.846/2013 (Lei Anticorrupção) e não pratica atos lesivos à Administração', 'INT_ANTICORRUPCAO'],
  ['Declaração de regularidade fiscal e trabalhista', 'HAB_REGULARIDADE'],
  ['Atestado de vistoria: declaração de que vistoriou o local da obra', 'EXEC_VISTORIA_REALIZADA'],
  ['Declaração de que não possui em seu quadro societário servidor público da ativa', 'IMP_SERVIDOR'],
  ['Declaração de ações de equidade entre homens e mulheres no ambiente de trabalho', 'DESEMP_EQUIDADE'],
  ['Declaração de que possui programa de integridade, para fins de desempate', 'DESEMP_INTEGRIDADE'],
  ['Declaração de compromisso com a sustentabilidade e a proteção do meio ambiente', 'AMB_SUSTENTABILIDADE'],
  ['Declaração de que tomou conhecimento de todas as informações e das condições locais para o cumprimento das obrigações', 'EXEC_CIENCIA_CONDICOES'],
  ['Declaração de responsabilidade pelo fiel cumprimento do contrato', 'EXEC_RESPONSABILIDADE'],
  ['Declaração de desenquadramento da condição de ME/EPP (exclusão do Simples Nacional)', 'ME_EPP_DESENQUADRAMENTO'],
];
for (const [frase, codigo] of FRASES) {
  test(`escolherModelo: ${codigo}`, () => assert.equal(D.escolherModelo(frase)?.codigo, codigo));
}

test('escolherModelo sem acerto devolve null', () => {
  for (const f of ['Balanço patrimonial do último exercício social', 'Atestado de capacidade técnica compatível com o objeto', 'Prova de inscrição no cadastro de contribuintes municipal', '', null]) {
    assert.equal(D.escolherModelo(f), null, String(f));
  }
});

test('escolherModelo: mais padrões acertados vence; empate exato fica com a ordem da biblioteca', () => {
  // "ME/EPP" bate nos dois modelos de porte; "desenquadramento" + "Simples Nacional" tornam o outro mais específico.
  assert.equal(D.escolherModelo('enquadramento ME/EPP LC 123').codigo, 'ME_EPP_ENQUADRAMENTO');
  assert.equal(D.escolherModelo('desenquadramento ME/EPP Simples Nacional').codigo, 'ME_EPP_DESENQUADRAMENTO');
  // um padrão de cada lado: vale quem vem primeiro na lista.
  const ordem = D.listarModelos().map((m) => m.codigo);
  assert.ok(ordem.indexOf('IMP_PARENTESCO') < ordem.indexOf('IMP_SERVIDOR'));
  assert.equal(D.escolherModelo('parente de servidor').codigo, 'IMP_PARENTESCO');
});

test('detectarModeloDoEdital devolve todos os anexos de modelo e separa declarações numeradas, texto literal', () => {
  const edital = [
    'ANEXO I – TERMO DE REFERÊNCIA',
    'Objeto: aquisição de papel. Ver Anexo III deste edital.',
    'ANEXO III',
    'MODELO DE DECLARAÇÃO DE INEXISTÊNCIA DE FATO IMPEDITIVO',
    'A empresa ____, CNPJ ____, declara que não há fato impeditivo.',
    'Local e data.',
    'ANEXO IV – MODELO DE DECLARAÇÃO DE ELABORAÇÃO INDEPENDENTE DE PROPOSTA',
    'Declaro que a proposta foi elaborada de maneira independente.',
    '  ANEXO V - MINUTA DO CONTRATO',
    'Cláusula primeira...',
    'ANEXO VI',
    'MODELO DE DECLARAÇÃO – VISTORIA',
    'Declaro que vistoriei o local da obra.',
    'ANEXO VII – MODELOS DE DECLARAÇÕES',
    'Apresentar em papel timbrado.',
    'DECLARAÇÃO I – NÃO EMPREGO DE MENOR',
    'Declaro que não emprego menor.',
    'DECLARAÇÃO II – RESERVA DE CARGOS',
    'Declaro que cumpro a reserva de cargos.',
    '3) Declaro que inexiste parentesco com servidor do órgão.',
    'IV - Declaro que observo a Lei nº 12.846/2013.',
    '   Local e data.',
  ].join('\r\n');
  const r = D.detectarModeloDoEdital(edital);
  assert.deepEqual(r.map((x) => x.titulo), [
    'ANEXO III',
    'ANEXO IV – MODELO DE DECLARAÇÃO DE ELABORAÇÃO INDEPENDENTE DE PROPOSTA',
    'ANEXO VI',
    'DECLARAÇÃO I – NÃO EMPREGO DE MENOR',
    'DECLARAÇÃO II – RESERVA DE CARGOS',
    '3) Declaro que inexiste parentesco com servidor do órgão.',
    'IV - Declaro que observo a Lei nº 12.846/2013.',
  ]);
  for (const x of r) {
    assert.equal(x.origem, 'edital');
    assert.equal(edital.slice(x.posicao, x.posicao + x.texto.length), x.texto); // literal e localizável no original
  }
  assert.equal(r[0].texto, 'ANEXO III\r\nMODELO DE DECLARAÇÃO DE INEXISTÊNCIA DE FATO IMPEDITIVO\r\nA empresa ____, CNPJ ____, declara que não há fato impeditivo.\r\nLocal e data.');
  assert.equal(r[3].texto, 'DECLARAÇÃO I – NÃO EMPREGO DE MENOR\r\nDeclaro que não emprego menor.');
  assert.equal(r[6].texto, 'IV - Declaro que observo a Lei nº 12.846/2013.\r\n   Local e data.');
  assert.ok(!r.some((x) => /MINUTA|Cláusula|papel timbrado/.test(x.texto)));
  assert.deepEqual(D.detectarModeloDoEdital('ANEXO II - PLANILHA DE PREÇOS\nItem 1'), []);
  assert.deepEqual(D.detectarModeloDoEdital(''), []);
});

test('detectarModeloDoEdital: anexo com uma só declaração numerada não é fatiado', () => {
  const r = D.detectarModeloDoEdital('ANEXO II – MODELO DE DECLARAÇÃO\n1) Declaro que cumpro os requisitos de habilitação.\nLocal e data.');
  assert.equal(r.length, 1);
  assert.equal(r[0].titulo, 'ANEXO II – MODELO DE DECLARAÇÃO');
  assert.equal(r[0].posicao, 0);
});
