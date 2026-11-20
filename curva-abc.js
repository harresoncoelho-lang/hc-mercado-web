/* global module */
// Curva ABC dos itens do processo: total de cada item (quantidade × valor unitário, mesma conta do servidor),
// do maior para o menor, com a participação acumulada. A = acumulado até 80%, B = até 95%, C = o resto.
// O primeiro item é sempre A (sem isso, um item que sozinho passa de 80% deixaria a curva sem classe A).
// Tudo em BigInt (centavos e centésimos de ponto percentual): nada de float em dinheiro.
(function (global) {
  'use strict';
  const LIMITE = 999999999999999n;
  // Mesmas regras de itens-processo-ui.js (decimalPositivo/totalCentavos), repetidas para o módulo ficar puro.
  function decimal(texto, escala) {
    const t = String(texto ?? '').trim();
    if (!new RegExp(`^(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,${escala}})?$`).test(t)) return null;
    const [inteiro, fracao = ''] = t.split('.');
    const n = BigInt(inteiro + fracao.padEnd(escala, '0'));
    return n > 0n && n <= LIMITE ? n : null;
  }
  function totalCentavos(quantidade, valor) {
    const q = decimal(quantidade, 3), v = decimal(valor, 2);
    return q === null || v === null ? null : (q * v + 500n) / 1000n;
  }
  // Centésimos de ponto percentual (10000 = 100,00%), arredondado meio para cima.
  const parte = (v, total) => (v * 20000n + total) / (2n * total);
  const pct = (bp) => `${bp / 100n},${String(bp % 100n).padStart(2, '0')}%`;

  // itens: [{ id, identificador, descricao, quantidade, valorUnitario }]. Item sem valor fica fora da curva (semValor).
  function curvaABC(itens) {
    const com = [], semValor = [];
    for (const i of itens || []) {
      const t = totalCentavos(i.quantidade, i.valorUnitario);
      if (t === null) semValor.push(i); else com.push({ item: i, total: t });
    }
    com.sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : String(a.item.identificador ?? '').localeCompare(String(b.item.identificador ?? ''), 'pt-BR', { numeric: true })));
    const total = com.reduce((s, x) => s + x.total, 0n);
    let acumulado = 0n;
    const linhas = com.map((x, k) => {
      acumulado += x.total;
      const classe = k === 0 || acumulado * 100n <= total * 80n ? 'A' : acumulado * 100n <= total * 95n ? 'B' : 'C';
      return { item: x.item, total: x.total, participacao: parte(x.total, total), acumulado: parte(acumulado, total), classe };
    });
    const resumo = { A: { itens: 0, total: 0n }, B: { itens: 0, total: 0n }, C: { itens: 0, total: 0n } };
    for (const l of linhas) { resumo[l.classe].itens += 1; resumo[l.classe].total += l.total; }
    return { total, linhas, resumo, semValor };
  }

  const api = { curvaABC, pct };
  global.LicitaCurvaABC = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
