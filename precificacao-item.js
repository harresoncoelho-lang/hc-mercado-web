/* global module */
// Precificação por item (preço-alvo, preço-limite, frete rateado e simulador de lance). Funções puras, só BigInt:
// dinheiro em centavos, percentuais em milésimos de ponto (8,5% = 8500n; 100% = 100000n), lance com 4 casas
// (73,6700 = 736700n). Nenhuma conversão binária: o mesmo resultado no navegador e no servidor.
(function (global) {
  'use strict';
  const LIMITE = 999999999999999n; // mesmo limite de escala do kit (numeric(15,2) em centavos)
  const CEM_POR_CENTO = 100000n;
  const ehBig = (v) => typeof v === 'bigint';

  // Rateio do frete pelo peso custo×quantidade, meio para cima, com o resto no último item.
  // itens: [{ custoCentavos, quantidade }] (quantidade em qualquer escala fixa, ex.: milésimos). Devolve centavos por item.
  function freteRateado(itens, freteCentavos) {
    if (!Array.isArray(itens) || !itens.length || !ehBig(freteCentavos) || freteCentavos < 0n) return { ok: false, erro: 'Informe os itens e um frete válido.' };
    if (itens.some((i) => !i || !ehBig(i.custoCentavos) || !ehBig(i.quantidade) || i.custoCentavos < 0n || i.quantidade < 0n)) return { ok: false, erro: 'Custo e quantidade de cada item devem ser números válidos.' };
    const pesos = itens.map((i) => i.custoCentavos * i.quantidade);
    const total = pesos.reduce((a, b) => a + b, 0n);
    if (total === 0n) return { ok: false, erro: 'Informe o custo dos itens antes de ratear o frete.' };
    const ratear = (arredondar) => {
      const valores = pesos.slice(0, -1).map((p) => arredondar(freteCentavos * p));
      valores.push(freteCentavos - valores.reduce((a, b) => a + b, 0n));
      return valores;
    };
    let valores = ratear((n) => (2n * n + total) / (2n * total));
    // Vários itens arredondados para cima podem passar do frete e deixar o último negativo; aí arredonda para baixo.
    if (valores[valores.length - 1] < 0n) valores = ratear((n) => n / total);
    return { ok: true, valores };
  }

  // preço = ceil(base×100000 ÷ (100000 − pct)). pct = soma dos percentuais sobre o preço (tributos, garantia, margem).
  function precoComMargem(baseCentavos, pctMilesimos) {
    if (!ehBig(baseCentavos) || !ehBig(pctMilesimos) || baseCentavos < 0n || pctMilesimos < 0n) return { ok: false, erro: 'Custo e percentuais devem ser números válidos.' };
    if (pctMilesimos >= CEM_POR_CENTO) return { ok: false, erro: 'A soma dos percentuais (tributos, garantia e margem) precisa ser menor que 100%.' };
    const divisor = CEM_POR_CENTO - pctMilesimos;
    const centavos = (baseCentavos * CEM_POR_CENTO + divisor - 1n) / divisor;
    if (centavos > LIMITE) return { ok: false, erro: 'O preço calculado excede o limite. Confira custo e percentuais.' };
    return { ok: true, centavos };
  }

  // Lucro do lance em 4 casas: lance − percentuais sobre o lance − base. Arredonda para baixo, então o sinal é
  // exato: qualquer prejuízo, por menor que seja, sai negativo.
  function lucro(lanceEscala4, baseCentavos, pctSemMargem) {
    const n = lanceEscala4 * (CEM_POR_CENTO - pctSemMargem) - baseCentavos * 100n * CEM_POR_CENTO;
    const q = n / CEM_POR_CENTO;
    return n < 0n && q * CEM_POR_CENTO !== n ? q - 1n : q;
  }

  // Selo do simulador. Lance em 4 casas; limite e alvo em centavos; lucro (opcional, de lucro()) em 4 casas.
  function classificarLance(lanceEscala4, limiteCentavos, alvoCentavos, lucroEscala4) {
    const prejuizo = ehBig(lucroEscala4) && lucroEscala4 < 0n;
    if (lanceEscala4 < limiteCentavos * 100n) return { cor: 'vermelho', prejuizo, texto: prejuizo ? 'Abaixo do limite: prejuízo' : 'Abaixo do limite' };
    if (lanceEscala4 < alvoCentavos * 100n) return { cor: 'amarelo', prejuizo, texto: prejuizo ? 'Negociação: prejuízo' : 'Negociação' };
    return { cor: 'verde', prejuizo, texto: prejuizo ? 'No alvo, mas com prejuízo' : 'No alvo ou acima' };
  }

  // Leitura pt-BR: vírgula ou ponto como separador decimal, sem milhar. Devolve BigInt escalado ou null.
  function lerDecimal(texto, casas) {
    const t = typeof texto === 'string' ? texto.trim() : '';
    const m = new RegExp(`^(\\d{1,18})(?:[.,](\\d{1,${casas}}))?$`).exec(t);
    if (!m) return null;
    const n = BigInt(m[1] + (m[2] || '').padEnd(casas, '0'));
    return n <= LIMITE * 10n ** BigInt(Math.max(casas - 2, 0)) ? n : null;
  }
  const lerDinheiro = (t) => lerDecimal(t, 2);
  const lerLance = (t) => lerDecimal(t, 4);
  const lerPercentual = (t) => lerDecimal(t, 3); // "8,5" → 8500n (milésimos de ponto)

  // Escrita pt-BR sem milhar (volta igual pela leitura). Aceita negativo (lucro).
  function formatarDecimal(n, casas) {
    const neg = n < 0n, a = neg ? -n : n, base = 10n ** BigInt(casas);
    const frac = casas ? `,${String(a % base).padStart(casas, '0')}` : '';
    return `${neg ? '-' : ''}${a / base}${frac}`;
  }
  // Para exibir: R$ com milhar.
  function formatarReais(centavos) {
    const s = formatarDecimal(centavos, 2), neg = s.startsWith('-'), [i, f] = (neg ? s.slice(1) : s).split(',');
    return `${neg ? '-' : ''}R$ ${i.replace(/\B(?=(\d{3})+$)/g, '.')},${f}`;
  }
  const formatarLance = (n) => formatarDecimal(n, 4);
  const formatarPercentual = (m) => `${formatarDecimal(m, 3).replace(/,?0+$/, '')}%`;

  const api = { LIMITE, freteRateado, precoComMargem, lucro, classificarLance, lerDecimal, lerDinheiro, lerLance, lerPercentual, formatarDecimal, formatarReais, formatarLance, formatarPercentual };
  global.LicitaPrecificacao = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
