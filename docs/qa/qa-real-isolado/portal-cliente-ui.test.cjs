// Cartão "Portal do cliente" (portal-cliente-ui.js): mensagem pronta (WhatsApp e e-mail), situação do link, resumo
// e "valores mudaram" a partir dos aceites, rótulos da auditoria e 503 escondendo as ações. Nenhum dado real.
const test = require('node:test');
const assert = require('node:assert/strict');
const ui = require('../../../portal-cliente-ui.js');

const LINK = 'https://licitaplena.pages.dev/cliente#t=abc_DEF-123';
const dados = { contato: 'Maria & Cia', numero: '12/2026', link: LINK, expiraEm: '2026-12-03T15:00:00Z' };

test('mensagem do WhatsApp e mailto: texto pronto, codificado, sem enviar nada', () => {
  const msg = 'Olá, Maria & Cia! Confira e aprove os itens da proposta do processo 12/2026: ' + LINK + ' (válido até 03/12/2026)';
  assert.equal(ui.mensagemCliente(dados), msg);
  assert.equal(ui.urlWhatsApp(dados), 'https://wa.me/?text=' + encodeURIComponent(msg));
  assert.match(ui.urlWhatsApp(dados), /%26%20Cia/); // "&" não quebra o parâmetro
  assert.ok(!ui.urlWhatsApp(dados).includes('#'), 'o # do token vai codificado');
  const mail = new URL(ui.urlEmail(dados));
  assert.equal(mail.protocol, 'mailto:');
  assert.equal(mail.searchParams.get('subject'), 'Proposta do processo 12/2026 para sua aprovação');
  assert.equal(mail.searchParams.get('body'), msg);
  assert.equal(ui.mensagemCliente({ ...dados, numero: '' }), 'Olá, Maria & Cia! Confira e aprove os itens da proposta: ' + LINK + ' (válido até 03/12/2026)');
  // Data em Brasília: 02h UTC do dia 4 ainda é dia 3.
  assert.match(ui.mensagemCliente({ ...dados, expiraEm: '2026-12-04T02:00:00Z' }), /válido até 03\/12\/2026/);
});

test('link do servidor só entra na tela se for https', () => {
  assert.equal(ui.linkSeguro(LINK), LINK);
  for (const v of ['http://x.dev/cliente#t=a', 'javascript:alert(1)', '', null, 'cliente#t=a']) assert.equal(ui.linkSeguro(v), null, String(v));
  assert.equal(ui.linkSeguro('http://127.0.0.1:8788/cliente#t=a'), 'http://127.0.0.1:8788/cliente#t=a'); // B9: ambiente de teste local
  assert.equal(ui.linkSeguro('http://127.0.0.1.x.dev/cliente#t=a'), null);
});

test('situação do link: revogado vence; expirado no instante exato', () => {
  const agora = Date.parse('2026-11-18T12:00:00Z');
  assert.equal(ui.situacaoLink({ expira_em: '2026-11-19T00:00:00Z' }, agora), 'Ativo');
  assert.equal(ui.situacaoLink({ expira_em: '2026-11-18T12:00:00Z' }, agora), 'Expirado');
  assert.equal(ui.situacaoLink({ expira_em: '2026-11-01T00:00:00Z' }, agora), 'Expirado');
  assert.equal(ui.situacaoLink({ expira_em: '2026-12-01T00:00:00Z', revogado_em: '2026-11-10T00:00:00Z' }, agora), 'Revogado');
  assert.equal(ui.situacaoLink({ expira_em: null }, agora), 'Expirado');
});

const item = (id, extra = {}) => ({ id, identificador: id, descricao: 'Caneta (exemplo)', quantidade: '10.000', unidade: 'Unidade', valorUnitario: '80.00', marca: null, modelo: null, fabricante: null, valorUnitarioMinimo: '61.32', ...extra });
const visto = (extra = {}) => ({ identificador: 'i1', descricao: 'Caneta (exemplo)', quantidade: 10, unidade: 'Unidade', valor_unitario_proposta: 80, marca: null, modelo: null, fabricante: null, ...extra });

test('resumo de aceites: última decisão por item; item sem aceite conta como sem resposta', () => {
  const aceites = [
    { item_id: 'i1', link_id: 'L1', decisao: 'recusado', criado_em: '2026-11-10T10:00:00Z', visto: visto() },
    { item_id: 'i1', link_id: 'L1', decisao: 'aprovado', criado_em: '2026-11-11T10:00:00Z', visto: visto() },
    { item_id: 'i2', link_id: 'L1', decisao: 'recusado', criado_em: '2026-11-11T09:00:00Z', visto: visto({ identificador: 'i2' }) },
  ];
  const linhas = ui.respostasPorItem([item('i1'), item('i2'), item('i3')], aceites);
  assert.deepEqual(linhas.map((l) => l.aceite?.decisao ?? null), ['aprovado', 'recusado', null]);
  const r = ui.resumoAceites(linhas);
  assert.deepEqual([r.aprovado, r.recusado, r.sem], [1, 1, 1]);
  assert.equal(r.texto, '1 aprovado · 1 recusado · 1 sem resposta');
  assert.equal(ui.resumoAceites(ui.respostasPorItem([item('a'), item('b')], [])).texto, '0 aprovados · 0 recusados · 2 sem resposta');
  // Item respondido que não está na lista atual (outra página ou removido) aparece no fim.
  const fora = ui.respostasPorItem([item('i1')], [{ item_id: 'x9', decisao: 'aprovado', criado_em: '2026-11-11T10:00:00Z', visto: visto() }]);
  assert.deepEqual(fora.map((l) => [l.itemId, l.item === null]), [['i1', false], ['x9', true]]);
  assert.equal(fora[1].mudou, false);
});

test('"valores mudaram": compara o visto com o item atual; número por valor, mínimo só se foi mostrado', () => {
  assert.equal(ui.valoresMudaram(visto(), item('i1')), false);
  assert.equal(ui.valoresMudaram(visto({ quantidade: '10.000' }), item('i1')), false);
  assert.equal(ui.valoresMudaram(visto(), item('i1', { valorUnitario: '79.99' })), true);
  assert.equal(ui.valoresMudaram(visto(), item('i1', { marca: 'Marca Nova' })), true);
  assert.equal(ui.valoresMudaram(visto(), item('i1', { descricao: 'Caneta azul (exemplo)' })), true);
  // Sem mínimo no visto (link sem mínimo): mudar o mínimo não acusa.
  assert.equal(ui.valoresMudaram(visto(), item('i1', { valorUnitarioMinimo: '70.00' })), false);
  assert.equal(ui.valoresMudaram(visto({ valor_unitario_minimo: 61.32 }), item('i1')), false);
  assert.equal(ui.valoresMudaram(visto({ valor_unitario_minimo: 61.32 }), item('i1', { valorUnitarioMinimo: null })), true);
  assert.equal(ui.valoresMudaram(visto(), null), null);
  const [l] = ui.respostasPorItem([item('i1', { valorUnitario: '90.00' })], [{ item_id: 'i1', decisao: 'aprovado', criado_em: '2026-11-11T10:00:00Z', visto: visto() }]);
  assert.equal(l.mudou, true);
});

test('histórico: rótulos em português, mais recente primeiro, com o contato do link', () => {
  const evs = ['link_criado', 'link_revogado', 'acesso', 'resposta', 'negado', 'limite'].map((evento, i) => ({ evento, link_id: i < 4 ? 'L1' : null, criado_em: `2026-11-1${i}T12:00:00Z` }));
  const h = ui.historico(evs, [{ id: 'L1', rotulo: 'Maria' }]);
  assert.deepEqual(h.map((e) => e.rotulo), ['Limite atingido', 'Tentativa negada', 'Resposta enviada', 'Acesso do cliente', 'Link revogado', 'Link criado']);
  assert.deepEqual(h.map((e) => e.contato), ['', '', 'Maria', 'Maria', 'Maria', 'Maria']);
  assert.equal(ui.historico([{ evento: 'desconhecido', criado_em: null }], []).at(0).rotulo, 'Outro evento');
});

test('erros: 503 esconde as ações; 403 esconde só o gerar; 409 explica o limite', () => {
  assert.deepEqual(ui.estadoErro(503), { texto: 'Portal do cliente ainda não está disponível', esconderAcoes: true });
  assert.deepEqual(ui.estadoErro(403), { texto: 'Seu papel não permite gerar links', esconderGerar: true });
  assert.equal(ui.estadoErro(409).texto, 'Este processo já tem 5 links ativos. Revogue um antes.');
  assert.equal(ui.estadoErro(0).esconderAcoes, undefined, 'falha de rede não esconde: dá para tentar de novo');
});

test('nome do contato: 2 a 120 caracteres depois de aparar', () => {
  assert.equal(ui.validarContato('  Jo '), 'Jo');
  for (const v of ['', ' a ', 'x'.repeat(121), null]) assert.equal(ui.validarContato(v), null, String(v));
  assert.equal(ui.validarContato('x'.repeat(120)).length, 120);
});
