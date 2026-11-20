const test = require('node:test');
const assert = require('node:assert/strict');
const { gerarIcs, linkGoogle, nomeArquivo, montarBotao, vencido, lerInicio, escapar, dobrar } = require('../agenda-ics');

const EA = '11111111-1111-4111-8111-111111111111';
const PA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AGORA = Date.UTC(2026, 10, 18, 12, 0, 0);
const linhas = (ics) => ics.replace(/\r\n /g, '').split('\r\n');
const campo = (ics, nome) => linhas(ics).find((l) => l.startsWith(nome));

test('data com hora sem fuso é Brasília (UTC-3) e vira UTC; com fuso é respeitada', () => {
  const ics = gerarIcs({ id: 'p1', titulo: 'Sessão', inicio: '2026-12-01T09:00' }, AGORA);
  assert.equal(campo(ics, 'DTSTART'), 'DTSTART:20261201T120000Z');
  assert.equal(campo(ics, 'DTEND'), 'DTEND:20261201T123000Z');
  assert.equal(campo(ics, 'DTSTAMP'), 'DTSTAMP:20261118T120000Z');
  // Virada de dia: 22h em Brasília é 01h UTC do dia seguinte.
  assert.equal(campo(gerarIcs({ titulo: 'x', inicio: '2026-12-31 22:00' }, AGORA), 'DTSTART'), 'DTSTART:20270101T010000Z');
  assert.equal(campo(gerarIcs({ titulo: 'x', inicio: '2026-12-01T13:00:00+00:00' }, AGORA), 'DTSTART'), 'DTSTART:20261201T130000Z');
  assert.equal(campo(gerarIcs({ titulo: 'x', inicio: '2026-12-01 13:00:00+00' }, AGORA), 'DTSTART'), 'DTSTART:20261201T130000Z');
});

test('só data usa VALUE=DATE com fim no dia seguinte; data inválida não gera nada', () => {
  const ics = gerarIcs({ titulo: 'Alvará', inicio: '2026-12-31' }, AGORA);
  assert.equal(campo(ics, 'DTSTART'), 'DTSTART;VALUE=DATE:20261231');
  assert.equal(campo(ics, 'DTEND'), 'DTEND;VALUE=DATE:20270101');
  for (const ruim of ['2026-02-30', 'amanhã', '', null, 123]) {
    assert.equal(gerarIcs({ titulo: 'x', inicio: ruim }), null);
    assert.equal(linkGoogle({ titulo: 'x', inicio: ruim }), null);
  }
  assert.equal(lerInicio('2026-02-30'), null);
});

test('estrutura: VCALENDAR, PRODID, VEVENT, VALARM de 1 dia antes e CRLF', () => {
  const ics = gerarIcs({ id: 'p1', titulo: 'Prazo', inicio: '2026-12-01T09:00' }, AGORA);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//LicitaPlena//PT-BR\r\n'));
  assert.ok(ics.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n'));
  assert.doesNotMatch(ics.replace(/\r\n/g, ''), /[\r\n]/);
  const l = linhas(ics);
  const alarme = l.slice(l.indexOf('BEGIN:VALARM'), l.indexOf('END:VALARM') + 1);
  assert.deepEqual(alarme, ['BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-P1D', 'DESCRIPTION:Prazo', 'END:VALARM']);
});

test('UID estável: usa o id do banco; sem id, deriva do título e da data', () => {
  assert.equal(campo(gerarIcs({ id: PA, titulo: 'x', inicio: '2026-12-01' }), 'UID'), 'UID:' + PA + '@licitaplena.com.br');
  assert.equal(campo(gerarIcs({ id: 'a<b>;c', titulo: 'x', inicio: '2026-12-01' }), 'UID'), 'UID:abc@licitaplena.com.br');
  const a = campo(gerarIcs({ titulo: 'Prazo', inicio: '2026-12-01' }, 1), 'UID');
  const b = campo(gerarIcs({ titulo: 'Prazo', inicio: '2026-12-01' }, 2), 'UID');
  const c = campo(gerarIcs({ titulo: 'Outro', inicio: '2026-12-01' }, 1), 'UID');
  assert.match(a, /^UID:lp-[0-9a-f]+@licitaplena\.com\.br$/);
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('escape de vírgula, ponto e vírgula, barra invertida e quebra de linha', () => {
  assert.equal(escapar('a,b;c\\d\ne\r\nf'), 'a\\,b\\;c\\\\d\\ne\\nf');
  const ics = gerarIcs({ titulo: 'Proposta, lote 1; item\\2\nfim\u0007', inicio: '2026-12-01' });
  assert.equal(campo(ics, 'SUMMARY'), 'SUMMARY:Proposta\\, lote 1\\; item\\\\2\\nfim');
});

test('descrição com processo, empresa e link do sistema só quando os dois ids são uuid', () => {
  const ev = { titulo: 'x', inicio: '2026-12-01', processo: '12/2026 · Papel', empresa: 'Construtora Exemplo', empresaId: EA, processoId: PA };
  assert.equal(campo(gerarIcs(ev), 'DESCRIPTION'),
    'DESCRIPTION:Processo: 12/2026 · Papel\\nEmpresa: Construtora Exemplo\\nhttps://licitaplena.com.br/sistema?empresa=' + EA + '&processo=' + PA);
  assert.doesNotMatch(gerarIcs({ ...ev, processoId: null }), /licitaplena\.com\.br\/sistema/);
  assert.doesNotMatch(gerarIcs({ ...ev, empresaId: 'x&y' }), /licitaplena\.com\.br\/sistema/);
});

test('dobra em 75 octetos UTF-8 sem partir caractere', () => {
  const longo = 'SUMMARY:' + 'ação '.repeat(40);
  const dobrada = dobrar(longo);
  for (const parte of dobrada.split('\r\n')) assert.ok(Buffer.byteLength(parte, 'utf8') <= 75, parte);
  assert.equal(dobrada.replace(/\r\n /g, ''), longo);
  assert.ok(dobrada.split('\r\n').slice(1).every((p) => p.startsWith(' ')));
  assert.equal(dobrar('curta'), 'curta');
  const ics = gerarIcs({ titulo: 'é'.repeat(150), inicio: '2026-12-01' });
  for (const l of ics.split('\r\n')) assert.ok(Buffer.byteLength(l, 'utf8') <= 75);
});

test('link do Google com parâmetros codificados', () => {
  const url = new URL(linkGoogle({ titulo: 'Sessão & lance #1?', inicio: '2026-12-01T09:00', empresa: 'A&B', empresaId: EA, processoId: PA }));
  assert.equal(url.origin + url.pathname, 'https://calendar.google.com/calendar/render');
  assert.equal(url.searchParams.get('action'), 'TEMPLATE');
  assert.equal(url.searchParams.get('text'), 'Sessão & lance #1?');
  assert.equal(url.searchParams.get('dates'), '20261201T120000Z/20261201T123000Z');
  assert.equal(url.searchParams.get('details'), 'Empresa: A&B\nhttps://licitaplena.com.br/sistema?empresa=' + EA + '&processo=' + PA);
  assert.equal(new URL(linkGoogle({ titulo: 'x', inicio: '2026-12-31' })).searchParams.get('dates'), '20261231/20270101');
  assert.ok(!linkGoogle({ titulo: 'a b&c=d', inicio: '2026-12-01' }).includes('a b&c=d'));
});

test('nome de arquivo seguro', () => {
  assert.equal(nomeArquivo('Prazo de Propostas: Pregão 12/2026 (exemplo)'), 'prazo-de-propostas-pregao-12-2026-exemplo.ics');
  assert.equal(nomeArquivo('../../<script>'), 'script.ics');
  assert.equal(nomeArquivo('***'), 'compromisso.ics');
  assert.equal(nomeArquivo(undefined), 'compromisso.ics');
  assert.match(nomeArquivo('a'.repeat(300)), /^a{60}\.ics$/);
});

test('montarBotao escreve o título como texto e devolve null sem data válida', () => {
  const doc = { createElement: (tag) => ({ tag, children: [], attrs: {}, append(...n) { this.children.push(...n); }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {} }) };
  const caixa = montarBotao(doc, { titulo: '<img src=x onerror=alert(1)>', inicio: '2026-12-01' }, AGORA);
  assert.equal(caixa.tag, 'details');
  const [resumo, opcoes] = caixa.children;
  assert.equal(resumo.textContent, 'Adicionar à agenda');
  assert.equal(resumo.attrs['aria-label'], 'Adicionar à agenda: <img src=x onerror=alert(1)>');
  assert.equal(opcoes.children[0].textContent, 'Baixar arquivo .ics');
  assert.equal(opcoes.children[1].rel, 'noopener noreferrer');
  assert.ok(opcoes.children[1].href.includes(encodeURIComponent('<img src=x onerror=alert(1)>')));
  assert.equal(caixa.innerHTML, undefined);
  assert.equal(montarBotao(doc, { titulo: 'x', inicio: 'ontem' }), null);
  assert.equal(montarBotao(doc, { titulo: 'x', inicio: '2026-11-18T08:59' }, AGORA), null, 'vencido não ganha botão');
  assert.ok(montarBotao(doc, { titulo: 'x', inicio: '2026-11-18' }, AGORA), 'vence hoje ainda ganha botão');
});

test('vencido compara com o agora em Brasília', () => {
  // AGORA = 18/11/2026 12:00 UTC = 09:00 em Brasília.
  assert.equal(vencido('2026-11-18T08:59', AGORA), true);
  assert.equal(vencido('2026-11-18T09:00', AGORA), true);
  assert.equal(vencido('2026-11-18T09:01', AGORA), false);
  assert.equal(vencido('2026-11-18T11:59:00Z', AGORA), true);
  assert.equal(vencido('2026-11-18', AGORA), false, 'o dia de hoje ainda não venceu');
  assert.equal(vencido('2026-11-17', AGORA), true);
  // 01h UTC de 19/11 ainda é 18/11 em Brasília: prazo só-data de 18/11 não venceu.
  assert.equal(vencido('2026-11-18', Date.UTC(2026, 10, 19, 1, 0)), false);
  assert.equal(vencido('2026-11-18', Date.UTC(2026, 10, 19, 3, 0)), true);
  assert.equal(vencido('lixo', AGORA), false);
});
