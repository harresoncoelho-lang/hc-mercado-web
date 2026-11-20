/* global module */
// CBS e IBS da Reforma Tributária do consumo (EC 132/2023, LC 214/2025) sobre um valor. Funções puras, só BigInt:
// dinheiro em centavos, alíquotas em milésimos de ponto (0,9% = 900n), igual a precificacao-item.js.
// É estimativa para preço de licitação, não apuração: CBS/IBS são "por fora" (não entram na própria base) e,
// no regime regular, geram crédito. A conferência com a calculadora oficial fica em netlify/functions/conferir-cbs-ibs.js.
(function (global) {
  'use strict';
  // ÚNICO lugar das alíquotas por ano. Quando o Senado publicar a resolução, troque os números e "provisoria".
  // 2026: alíquotas de teste fixadas na LC 214/2025 (confirmadas na calculadora oficial em 19/11/2026: CBS 0,9; IBS UF 0,1; IBS município 0).
  // 2027-2028: CBS = referência − 0,1 ponto; IBS 0,1 (0,05 UF + 0,05 município). Referência da CBS: 11,3% calculada
  //   pelo TCU em 28/10/2026; o Senado tem até 15/12/2026 para fixar (sem resolução, vale o número do TCU).
  // 2029-2032: IBS sobe 10%, 20%, 30%, 40% da referência; 2033: integral. Referência do IBS ainda sem definição:
  //   usa a estimativa 17,7% (8,85 UF + 8,85 município, a do exemplo da própria API oficial). CBS mantida em 11,3%.
  const ALIQUOTAS = {
    2026: { cbs: 900n, ibsUf: 100n, ibsMun: 0n, provisoria: false, teste: true },
    2027: { cbs: 11200n, ibsUf: 50n, ibsMun: 50n, provisoria: true },
    2028: { cbs: 11200n, ibsUf: 50n, ibsMun: 50n, provisoria: true },
    2029: { cbs: 11300n, ibsUf: 885n, ibsMun: 885n, provisoria: true },
    2030: { cbs: 11300n, ibsUf: 1770n, ibsMun: 1770n, provisoria: true },
    2031: { cbs: 11300n, ibsUf: 2655n, ibsMun: 2655n, provisoria: true },
    2032: { cbs: 11300n, ibsUf: 3540n, ibsMun: 3540n, provisoria: true },
    2033: { cbs: 11300n, ibsUf: 8850n, ibsMun: 8850n, provisoria: true },
  };
  const ANOS = Object.keys(ALIQUOTAS).map(Number);
  // Redução de alíquota dos anexos da LC 214/2025 (ex.: 60% saúde/educação/alimentos, 30% profissões regulamentadas).
  const REDUCOES = [0, 30, 60];
  // Regimes do perfil da empresa (perfil-empresa.js). Simples e MEI ficam no DAS até optarem pelo regime regular.
  const FORA_DO_REGULAR = new Set(['simples', 'mei']);
  const LIMITE = 999999999999999n;
  const AVISO_PROVISORIA = 'Alíquotas de 2027 em diante são provisórias até o Senado definir.';
  const AVISO_TESTE = 'Em 2026 é ano de teste: o valor destacado é compensado com PIS/Cofins, não é custo a mais.';

  // valor × alíquota × (100 − redução) ÷ (100000 × 100), meio para cima, em centavos.
  function parcela(valor, aliquota, reducao) {
    const d = 100000n * 100n, n = valor * aliquota * BigInt(100 - reducao);
    return (2n * n + d) / (2n * d);
  }

  // e: { valorCentavos: BigInt, ano: número, regime: texto do perfil, reducao: 0|30|60 }.
  function calcularCbsIbs(e) {
    const { valorCentavos, ano, regime = '', reducao = 0 } = e || {};
    if (typeof valorCentavos !== 'bigint' || valorCentavos < 0n || valorCentavos > LIMITE) return { ok: false, erro: 'Informe um valor válido em reais.' };
    const a = ALIQUOTAS[ano];
    if (!a) return { ok: false, erro: `Ano fora da transição da Reforma (${ANOS[0]} a ${ANOS[ANOS.length - 1]}).` };
    if (!REDUCOES.includes(reducao)) return { ok: false, erro: 'Redução de alíquota inválida. Use 0%, 30% ou 60%.' };
    if (FORA_DO_REGULAR.has(regime)) {
      return { ok: true, aplica: false, ano, aviso: ano === 2026 ? 'Simples Nacional e MEI não participam do teste de 2026.' : 'No Simples Nacional e no MEI, CBS e IBS vão dentro do DAS, salvo opção pelo regime regular. Use a alíquota efetiva atual.' };
    }
    const cbs = parcela(valorCentavos, a.cbs, reducao);
    const ibsUf = parcela(valorCentavos, a.ibsUf, reducao), ibsMun = parcela(valorCentavos, a.ibsMun, reducao);
    const fator = BigInt(100 - reducao);
    return {
      ok: true, aplica: true, ano, reducao, provisoria: a.provisoria,
      cbs, ibs: ibsUf + ibsMun, ibsUf, ibsMun, total: cbs + ibsUf + ibsMun,
      // Alíquota efetiva (já com a redução), em milésimos de ponto arredondados para baixo: só para exibir.
      aliquotaCbs: (a.cbs * fator) / 100n, aliquotaIbs: ((a.ibsUf + a.ibsMun) * fator) / 100n,
      aviso: a.teste ? AVISO_TESTE : a.provisoria ? AVISO_PROVISORIA : '',
    };
  }

  const api = { ALIQUOTAS, ANOS, REDUCOES, AVISO_PROVISORIA, calcularCbsIbs };
  global.LicitaReformaTributaria = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
