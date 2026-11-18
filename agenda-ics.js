/* global module */
// "Adicionar à agenda" dos prazos e compromissos do CRM (sistema.html, operacao.html, processos.html).
// Gera no navegador um .ics (RFC 5545) e um link do Google Agenda. Sem OAuth e sem conta: nada sai do navegador
// até o usuário abrir o arquivo ou o link. Evento: { id, titulo, inicio, processo, empresa, empresaId, processoId }.
(function (global) {
  'use strict';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const DIA = /^\d{4}-\d{2}-\d{2}$/;
  const DURACAO_MS = 30 * 60 * 1000; // prazo vira um bloco de 30 min; DTEND precisa ser depois do DTSTART.
  // eslint-disable-next-line no-control-regex -- remove controles que quebrariam o .ics (mantém \t, \n, \r).
  const CONTROLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
  const texto = (v, max) => (typeof v === 'string' ? v.replace(CONTROLE, '').trim().slice(0, max) : '');
  const dois = (n) => String(n).padStart(2, '0');

  // 'AAAA-MM-DD' é só data; data e hora sem fuso é horário de Brasília (UTC-3 fixo, sem horário de verão desde 2019).
  function lerInicio(v) {
    if (typeof v !== 'string') return null;
    const s = v.trim();
    if (DIA.test(s)) {
      const [a, m, d] = s.split('-').map(Number);
      const t = Date.UTC(a, m - 1, d);
      return new Date(t).getUTCDate() === d ? { diaInteiro: true, t } : null;
    }
    const comFuso = /(Z|[+-]\d{2}(:?\d{2})?)$/i.test(s);
    const t = Date.parse(comFuso || !/T|\s\d/.test(s) ? s : s.replace(' ', 'T') + '-03:00');
    return Number.isNaN(t) ? null : { diaInteiro: false, t };
  }
  const data = (t) => { const d = new Date(t); return d.getUTCFullYear() + dois(d.getUTCMonth() + 1) + dois(d.getUTCDate()); };
  const utc = (t) => { const d = new Date(t); return data(t) + 'T' + dois(d.getUTCHours()) + dois(d.getUTCMinutes()) + dois(d.getUTCSeconds()) + 'Z'; };

  function linkSistema(ev) {
    return UUID.test(ev.empresaId || '') && UUID.test(ev.processoId || '')
      ? 'https://licitaplena.com.br/sistema?empresa=' + encodeURIComponent(ev.empresaId) + '&processo=' + encodeURIComponent(ev.processoId)
      : '';
  }
  function descricao(ev) {
    const p = texto(ev.processo, 300), e = texto(ev.empresa, 200);
    return [p && 'Processo: ' + p, e && 'Empresa: ' + e, linkSistema(ev)].filter(Boolean).join('\n');
  }
  // FNV-1a: UID estável quando o dado não tem id (ex.: prazos do Hoje).
  function hash(s) { let h = 0x811c9dc5; for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); }
  function uid(ev) {
    const id = String(ev.id ?? '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 100);
    return (id || 'lp-' + hash(texto(ev.titulo, 200) + '|' + String(ev.inicio))) + '@licitaplena.com.br';
  }

  // TEXT da RFC 5545 (3.3.11): escapa \ ; , e quebra de linha.
  const escapar = (s) => String(s).replace(/[\\;,]/g, (c) => '\\' + c).replace(/\r\n|\r|\n/g, '\\n');
  // Dobra em 75 octetos UTF-8 sem partir caractere; a continuação começa com espaço (que conta no limite).
  function dobrar(linha) {
    let saida = '', n = 0;
    for (const c of linha) {
      const cp = c.codePointAt(0), b = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
      if (n + b > 75) { saida += '\r\n '; n = 1; }
      saida += c; n += b;
    }
    return saida;
  }

  function gerarIcs(ev, agora = Date.now()) {
    const ini = lerInicio(ev?.inicio);
    if (!ini) return null;
    const titulo = texto(ev.titulo, 200) || 'Prazo LicitaPlena';
    const quando = ini.diaInteiro
      ? ['DTSTART;VALUE=DATE:' + data(ini.t), 'DTEND;VALUE=DATE:' + data(ini.t + 864e5)]
      : ['DTSTART:' + utc(ini.t), 'DTEND:' + utc(ini.t + DURACAO_MS)];
    const desc = descricao(ev);
    const linhas = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LicitaPlena//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT', 'UID:' + uid(ev), 'DTSTAMP:' + utc(agora), ...quando, 'SUMMARY:' + escapar(titulo),
      ...(desc ? ['DESCRIPTION:' + escapar(desc)] : []),
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-P1D', 'DESCRIPTION:' + escapar(titulo), 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'];
    return linhas.map(dobrar).join('\r\n') + '\r\n';
  }

  function linkGoogle(ev) {
    const ini = lerInicio(ev?.inicio);
    if (!ini) return null;
    const datas = ini.diaInteiro ? data(ini.t) + '/' + data(ini.t + 864e5) : utc(ini.t) + '/' + utc(ini.t + DURACAO_MS);
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(texto(ev.titulo, 200) || 'Prazo LicitaPlena')
      + '&dates=' + datas + '&details=' + encodeURIComponent(descricao(ev));
  }

  // Só a-z, 0-9 e hífen (acento vira letra simples).
  function nomeArquivo(titulo) {
    const base = texto(titulo, 200).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
    return (base || 'compromisso') + '.ics';
  }

  // Já passou, no relógio de Brasília? Com hora: o instante já chegou. Só data: o dia é anterior a hoje em Brasília.
  function vencido(inicio, agora = Date.now()) {
    const ini = lerInicio(inicio);
    if (!ini) return false;
    return ini.diaInteiro ? data(ini.t) < data(agora - 3 * 36e5) : ini.t <= agora;
  }

  // <details> "Adicionar à agenda" com os dois caminhos. Texto do banco só por textContent/atributo.
  // null se a data não serve ou se já venceu (lembrete de 1 dia antes não faria sentido); a lista segue mostrando o item.
  function montarBotao(doc, ev, agora = Date.now()) {
    const ics = gerarIcs(ev, agora), google = linkGoogle(ev);
    if (!ics || !google || vencido(ev.inicio, agora)) return null;
    const titulo = texto(ev.titulo, 200) || 'Prazo';
    const caixa = doc.createElement('details');
    caixa.className = 'agenda-add';
    const resumo = doc.createElement('summary');
    resumo.textContent = 'Adicionar à agenda';
    resumo.setAttribute('aria-label', 'Adicionar à agenda: ' + titulo);
    const opcoes = doc.createElement('div');
    opcoes.className = 'agenda-add-opcoes';
    const baixar = doc.createElement('button');
    baixar.type = 'button';
    baixar.textContent = 'Baixar arquivo .ics';
    baixar.title = 'Abre no Outlook, no Google Agenda (importar) e na agenda do celular';
    baixar.addEventListener('click', () => {
      const url = global.URL.createObjectURL(new global.Blob([ics], { type: 'text/calendar;charset=utf-8' }));
      const a = doc.createElement('a');
      a.href = url;
      a.download = nomeArquivo(ev.titulo);
      doc.body.append(a);
      a.click();
      a.remove();
      global.setTimeout(() => global.URL.revokeObjectURL(url), 1000);
    });
    const g = doc.createElement('a');
    g.href = google;
    g.target = '_blank';
    g.rel = 'noopener noreferrer';
    g.textContent = 'Abrir no Google Agenda';
    opcoes.append(baixar, g);
    caixa.append(resumo, opcoes);
    return caixa;
  }

  const api = { gerarIcs, linkGoogle, nomeArquivo, montarBotao, vencido, lerInicio, escapar, dobrar };
  global.AgendaIcs = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
