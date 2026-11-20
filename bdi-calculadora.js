/* global document, window, localStorage, module, navigator, URL, Blob -- script de navegador (e funções puras testadas no Node) */
// Calculadora de BDI (bdi.html) para obras e serviços de engenharia.
// Fórmula do Acórdão TCU 2622/2013-Plenário (Anexo do voto; faixas no item 9.1 e 9.2.1 do acórdão):
//   BDI = [ ((1+AC+S+R+G) × (1+DF) × (1+L)) / (1−I) ] − 1,   I = ISS + PIS + COFINS (+ CPRB, quando houver desoneração).
// Aritmética exata: toda porcentagem é um inteiro em centésimos de ponto percentual (4,00% = 400; 100% = 10000),
// e a conta usa BigInt. O resultado é arredondado UMA vez, no fim, para centésimos de ponto percentual (meio para cima).
(function () {
  'use strict';

  const FONTE = 'Acórdão TCU 2622/2013-Plenário (TC 036.076/2011-2), itens 9.1 (BDI por tipo de obra), 9.2.1 (parcelas) e 9.3.2.3 (ISS entre 2% e 5%).';
  const TOLERANCIA_AMARELO = 50; // 0,50 ponto percentual fora da faixa ainda é "amarelo"; além disso, "vermelho".

  // Valores [1º quartil, médio, 3º quartil] em centésimos de ponto percentual, copiados do texto do acórdão.
  // sg = "seguro + garantia" (a tabela do TCU traz as duas juntas). O acórdão NÃO tabela tributos (I) por tipo de obra.
  const TIPOS = {
    edificios: { nome: 'Construção de edifícios', bdi: [2034, 2212, 2500], ac: [300, 400, 550], sg: [80, 80, 100], r: [97, 127, 127], df: [59, 123, 139], l: [616, 740, 896] },
    rodovias: { nome: 'Construção de rodovias e ferrovias', bdi: [1960, 2097, 2423], ac: [380, 401, 467], sg: [32, 40, 74], r: [50, 56, 97], df: [102, 111, 121], l: [664, 730, 869] },
    saneamento: { nome: 'Redes de abastecimento de água, coleta de esgoto e construções correlatas', bdi: [2076, 2418, 2644], ac: [343, 493, 671], sg: [28, 49, 75], r: [100, 139, 174], df: [94, 99, 117], l: [674, 804, 940] },
    energia: { nome: 'Construção e manutenção de estações e redes de distribuição de energia elétrica', bdi: [2400, 2584, 2786], ac: [529, 592, 793], sg: [25, 51, 56], r: [100, 148, 197], df: [101, 107, 111], l: [800, 831, 951] },
    portuarias: { nome: 'Obras portuárias, marítimas e fluviais', bdi: [2280, 2748, 3095], ac: [400, 552, 785], sg: [81, 122, 199], r: [146, 232, 316], df: [94, 102, 133], l: [714, 840, 1043] },
    fornecimento: { nome: 'Mero fornecimento de materiais e equipamentos (BDI diferenciado)', bdi: [1110, 1402, 1680], ac: [150, 345, 449], sg: [30, 48, 82], r: [56, 85, 89], df: [85, 85, 111], l: [350, 511, 622] },
  };
  // Faixas de tributos que o acórdão cita só em texto: ISS entre 2% e 5% (9.3.2.3). PIS+COFINS 3,65% = regime cumulativo.
  const ISS_FAIXA = [200, 500];
  const PIS_COFINS_CUMULATIVO = 365;
  const CPRB_MAXIMA = 450; // Lei 12.546/2011: alíquotas de 1% a 4,5% sobre a receita bruta.

  // "4,5" | "4.50" | "4,567" -> 450 | 450 | 457 (meio para cima). Texto inválido ou negativo -> null.
  function lerPct(texto) {
    const t = String(texto ?? '').trim().replace('%', '').replace(',', '.');
    const m = /^(\d{1,3})(?:\.(\d*))?$/.exec(t);
    if (!m) return null;
    const dec = (m[2] || '').padEnd(3, '0');
    let v = Number(m[1]) * 100 + Number(dec.slice(0, 2));
    if (Number(dec[2]) >= 5) v += 1;
    return v;
  }
  // 2850 -> "28,50%"
  function fmtPct(c) {
    if (c === null || c === undefined) return '—';
    const neg = c < 0; const a = Math.abs(c);
    return `${neg ? '-' : ''}${Math.floor(a / 100)},${String(a % 100).padStart(2, '0')}%`;
  }

  // Divisão inteira com arredondamento "meio para cima" (valores positivos).
  const divArred = (n, d) => (2n * n + d) / (2n * d);

  // Entradas em centésimos de ponto percentual (inteiros). Retorna { bdi, i } (ambos em centésimos) ou { erro }.
  function calcularBdi({ ac = 0, s = 0, r = 0, g = 0, df = 0, l = 0, i = 0 }) {
    for (const v of [ac, s, r, g, df, l, i]) if (!Number.isInteger(v) || v < 0) return { erro: 'Percentual inválido.' };
    if (i >= 10000) return { erro: 'Tributos (I) devem ser menores que 100%.' };
    const E = 10000n;
    const a = E + BigInt(ac + s + r + g); const b = E + BigInt(df); const c = E + BigInt(l); const d = E - BigInt(i);
    // BDI (escala 1e-4) = a·b·c / (d·1e4) − 1e4
    const bdi = divArred(a * b * c, d * E) - E;
    return { bdi: Number(bdi), i };
  }

  // verde = dentro de [1ºQ, 3ºQ]; amarelo = até 0,50 p.p. fora; vermelho = além.
  function classificar(valor, faixa) {
    const [min, , max] = faixa;
    if (valor < min) return { estado: valor >= min - TOLERANCIA_AMARELO ? 'amarelo' : 'vermelho', posicao: 'abaixo' };
    if (valor > max) return { estado: valor <= max + TOLERANCIA_AMARELO ? 'amarelo' : 'vermelho', posicao: 'acima' };
    return { estado: 'verde', posicao: 'dentro' };
  }

  // e: { tipo, regime, ac, s, g, r, df, l, issAliquota, issBase, pis, cofins, cprb } — tudo em centésimos (issBase: 10000 = 100%).
  function avaliar(e) {
    const tipo = TIPOS[e.tipo];
    if (!tipo) return { erro: 'Tipo de obra desconhecido.' };
    const issEfetivo = Math.round(((e.issAliquota || 0) * (e.issBase ?? 10000)) / 10000);
    const piscofins = (e.pis || 0) + (e.cofins || 0);
    const cprb = e.cprb || 0;
    const I = issEfetivo + piscofins + cprb;
    const calc = calcularBdi({ ac: e.ac, s: e.s, r: e.r, g: e.g, df: e.df, l: e.l, i: I });
    if (calc.erro) return calc;
    const linhas = [];
    const faixa = (rotulo, valor, f) => linhas.push({ rotulo, valor, faixa: f, ...classificar(valor, f) });
    faixa('Administração central (AC)', e.ac, tipo.ac);
    faixa('Seguro + garantia (S + G)', (e.s || 0) + (e.g || 0), tipo.sg);
    faixa('Risco (R)', e.r, tipo.r);
    faixa('Despesas financeiras (DF)', e.df, tipo.df);
    faixa('Lucro (L)', e.l, tipo.l);
    // Tributos: o acórdão só orienta ISS (2% a 5%). As demais linhas são referência, nunca "vermelho" por faixa do TCU.
    linhas.push({ rotulo: 'ISS (alíquota)', valor: e.issAliquota || 0, faixa: [ISS_FAIXA[0], null, ISS_FAIXA[1]], ...classificar(e.issAliquota || 0, [ISS_FAIXA[0], 0, ISS_FAIXA[1]]) });
    linhas.push({ rotulo: 'PIS + COFINS', valor: piscofins, faixa: [PIS_COFINS_CUMULATIVO, null, PIS_COFINS_CUMULATIVO], estado: piscofins === PIS_COFINS_CUMULATIVO ? 'verde' : 'amarelo', posicao: piscofins === PIS_COFINS_CUMULATIVO ? 'dentro' : (piscofins < PIS_COFINS_CUMULATIVO ? 'abaixo' : 'acima'), ref: 'referência: 3,65% (regime cumulativo)' });
    linhas.push({ rotulo: 'CPRB (desoneração)', valor: cprb, faixa: [0, null, CPRB_MAXIMA], ...classificar(cprb, [0, 0, CPRB_MAXIMA]), ref: 'até 4,50% (Lei 12.546/2011)' });
    const total = { rotulo: 'BDI', valor: calc.bdi, faixa: tipo.bdi, ...classificar(calc.bdi, tipo.bdi) };
    return { tipo: tipo.nome, i: I, issEfetivo, linhas, total, bdi: calc.bdi, avisos: avisos(e, issEfetivo, I) };
  }

  function avisos(e, issEfetivo, I) {
    const a = [];
    const iss = e.issAliquota || 0;
    if (iss < ISS_FAIXA[0] || iss > ISS_FAIXA[1]) a.push({ nivel: 'erro', texto: 'ISS fora de 2% a 5%: o TCU (item 9.3.2.3) manda adotar a alíquota da lei do município, sempre entre o mínimo de 2% (ADCT art. 88) e o máximo de 5% (LC 116/2003 art. 8º, II).' });
    if ((e.issBase ?? 10000) < 10000) a.push({ nivel: 'info', texto: `Base de cálculo do ISS reduzida (${fmtPct(e.issBase)} do preço): o BDI usa ISS efetivo de ${fmtPct(issEfetivo)}. Confirme na lei municipal e guarde o dispositivo.` });
    if (e.regime === 'simples') a.push({ nivel: 'atencao', texto: 'Simples Nacional: o TCU (9.3.2.5) exige ISS, PIS e COFINS compatíveis com o Anexo IV da LC 123/2006, e os encargos sociais sem as contribuições do Sistema S dispensadas. Confira com seu contador antes de usar o BDI.' });
    if (e.regime === 'real') a.push({ nivel: 'atencao', texto: 'Lucro Real (não cumulativo): o TCU (9.3.2.4) exige demonstrativo de apuração mostrando que PIS/COFINS no BDI são a média efetivamente recolhida, já com os créditos. Os valores sugeridos são só ponto de partida.' });
    if ((e.cprb || 0) > 0) a.push({ nivel: 'info', texto: 'Com CPRB, o INSS patronal sai da folha (encargos sociais sem os 20%) e entra aqui, sobre o preço. Não use CPRB se a planilha de encargos já inclui o INSS patronal.' });
    if (I >= 2500) a.push({ nivel: 'atencao', texto: `Tributos somam ${fmtPct(I)} do preço: confira as alíquotas, o valor parece alto.` });
    a.push({ nivel: 'info', texto: 'O acórdão não fixa faixa para o total de tributos (I): ele varia com município e regime. A comparação por faixa vale para AC, S+G, R, DF, L e para o BDI final.' });
    return a;
  }

  const ROTULO_ESTADO = { verde: 'Dentro da faixa', amarelo: 'Fora da faixa (até 0,50 p.p.)', vermelho: 'Fora da faixa' };
  const NOME_REGIME = { presumido: 'Lucro Presumido (cumulativo)', real: 'Lucro Real (não cumulativo)', simples: 'Simples Nacional' };
  function fmtFaixa(l) {
    if (l.ref) return l.ref;
    const [min, med, max] = l.faixa;
    return med === null ? `${fmtPct(min)} a ${fmtPct(max)}` : `${fmtPct(min)} / ${fmtPct(med)} / ${fmtPct(max)}`;
  }
  function textoSituacao(l) { return l.estado === 'verde' ? ROTULO_ESTADO.verde : `${ROTULO_ESTADO[l.estado]}: ${l.posicao}`; }

  // Matriz de linhas (texto) usada tanto no .xlsx quanto no texto copiado.
  function matrizDetalhe(r, ctx = {}) {
    const m = [['CÁLCULO DO BDI — ' + r.tipo], ['Fórmula', 'BDI = [((1+AC+S+R+G) × (1+DF) × (1+L)) / (1−I)] − 1'], ['Fonte das faixas', FONTE]];
    if (ctx.regime) m.push(['Regime tributário', NOME_REGIME[ctx.regime] || ctx.regime]);
    m.push([], ['Componente', 'Adotado', '1º quartil / médio / 3º quartil', 'Situação']);
    for (const l of r.linhas) m.push([l.rotulo, fmtPct(l.valor), fmtFaixa(l), textoSituacao(l)]);
    m.push(['Tributos (I) = ISS efetivo + PIS + COFINS + CPRB', fmtPct(r.i), 'sem faixa no acórdão', '']);
    m.push(['BDI FINAL', fmtPct(r.total.valor), fmtFaixa(r.total), textoSituacao(r.total)]);
    return m;
  }
  function textoProposta(r, ctx) { return matrizDetalhe(r, ctx).map((l) => l.join('\t')).join('\n'); }

  const api = { FONTE, TIPOS, lerPct, fmtPct, calcularBdi, classificar, avaliar, matrizDetalhe, textoProposta, TOLERANCIA_AMARELO };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  // ---------------- Navegador ----------------
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CAMPOS = ['ac', 's', 'g', 'r', 'df', 'l', 'issAliquota', 'issBase', 'pis', 'cofins', 'cprb'];
  const PADRAO_REGIME = { presumido: { pis: '0,65', cofins: '3,00', cprb: '0' }, real: { pis: '1,65', cofins: '7,60', cprb: '0' }, simples: { pis: '0', cofins: '0', cprb: '0' } };
  const ICONE = { verde: '●', amarelo: '▲', vermelho: '■' };
  let ultimo = null;

  function ler() {
    const e = { tipo: $('f-tipo').value, regime: $('f-regime').value };
    const invalidos = [];
    for (const k of CAMPOS) {
      const el = $('f-' + k);
      const v = lerPct(el.value || '0');
      el.setAttribute('aria-invalid', v === null ? 'true' : 'false');
      if (v === null) invalidos.push(k); else e[k] = v;
    }
    return { e, invalidos };
  }

  function desenhar() {
    const { e, invalidos } = ler();
    const aviso = $('aviso');
    if (invalidos.length) { ultimo = null; aviso.className = 'aviso erro'; aviso.textContent = 'Use só números, com vírgula ou ponto (ex.: 4,5). Confira os campos marcados.'; $('resultado').hidden = true; return; }
    const r = avaliar(e);
    if (r.erro) { ultimo = null; aviso.className = 'aviso erro'; aviso.textContent = r.erro; $('resultado').hidden = true; return; }
    aviso.className = 'aviso'; aviso.textContent = '';
    ultimo = { r, e };
    $('resultado').hidden = false;
    const t = r.total;
    $('bdi-final').innerHTML = `<span class="bdi-valor">${esc(fmtPct(t.valor))}</span><span class="chip ${t.estado}">${ICONE[t.estado]} ${esc(textoSituacao(t))}</span><small>Faixa do TCU para esse tipo: ${esc(fmtFaixa(t))} (1º quartil / médio / 3º quartil)</small>`;
    $('tabela-corpo').innerHTML = r.linhas.map((l) => `<tr><td data-rotulo="Componente">${esc(l.rotulo)}</td><td data-rotulo="Adotado"><b>${esc(fmtPct(l.valor))}</b></td><td data-rotulo="Faixa TCU">${esc(fmtFaixa(l))}</td><td data-rotulo="Situação"><span class="chip ${l.estado}">${ICONE[l.estado]} ${esc(textoSituacao(l))}</span></td></tr>`).join('')
      + `<tr><td data-rotulo="Componente">Tributos (I)</td><td data-rotulo="Adotado"><b>${esc(fmtPct(r.i))}</b></td><td data-rotulo="Faixa TCU" colspan="2">sem faixa no acórdão (ISS efetivo ${esc(fmtPct(r.issEfetivo))} + PIS + COFINS + CPRB)</td></tr>`;
    $('avisos').innerHTML = r.avisos.map((a) => `<p class="aviso-linha ${a.nivel}">${esc(a.texto)}</p>`).join('');
  }

  function aplicarRegime() {
    const p = PADRAO_REGIME[$('f-regime').value];
    for (const k of Object.keys(p)) $('f-' + k).value = p[k];
    desenhar();
  }
  function baixarXlsx() {
    if (!ultimo) return;
    const m = matrizDetalhe(ultimo.r, ultimo.e);
    if (window.XLSX) {
      const wb = window.XLSX.utils.book_new(); const ws = window.XLSX.utils.aoa_to_sheet(m);
      ws['!cols'] = [{ wch: 48 }, { wch: 12 }, { wch: 34 }, { wch: 34 }];
      window.XLSX.utils.book_append_sheet(wb, ws, 'BDI'); window.XLSX.writeFile(wb, 'bdi-detalhamento.xlsx');
    } else { // SheetJS do CDN não carregou: CSV com BOM e ";" abre direto no Excel em pt-BR.
      const csv = '﻿' + m.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = 'bdi-detalhamento.csv'; a.click();
    }
  }
  async function copiar() {
    if (!ultimo) return;
    const txt = textoProposta(ultimo.r, ultimo.e); const msg = $('copiado');
    try { await navigator.clipboard.writeText(txt); msg.textContent = 'Copiado. Cole na proposta ou numa planilha.'; } catch { msg.textContent = 'Não consegui copiar automaticamente; use "Baixar planilha".'; }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('f-tipo').innerHTML = Object.entries(TIPOS).map(([k, t]) => `<option value="${k}">${esc(t.nome)}</option>`).join('');
    $('fonte').textContent = FONTE;
    $('f-regime').addEventListener('change', aplicarRegime);
    $('f-tipo').addEventListener('change', desenhar);
    for (const k of CAMPOS) $('f-' + k).addEventListener('input', desenhar);
    $('btn-copiar').addEventListener('click', copiar);
    $('btn-xlsx').addEventListener('click', baixarXlsx);
    $('btn-tema').addEventListener('click', () => {
      const claro = document.documentElement.classList.toggle('tema-claro');
      document.documentElement.dataset.theme = claro ? 'light' : 'dark';
      try { localStorage.setItem('licitaplena_tema', claro ? 'claro' : 'escuro'); } catch { /* segue sem persistir */ }
    });
    aplicarRegime();
  });
})();
