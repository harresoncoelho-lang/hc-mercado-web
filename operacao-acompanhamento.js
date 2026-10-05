/* global module, window */
(function (raiz) {
  function apurarItens(itens) {
    if (!itens.length) return null;
    const ganhos = itens.filter(item => item.situacao === "ganho");
    const pendentes = itens.filter(item => item.situacao === "pendente");
    const resolvidos = itens.filter(item => item.situacao !== "pendente");
    const situacao = pendentes.length ? "em_disputa"
      : ganhos.length === itens.length ? "vitoria_total"
      : ganhos.length ? "vitoria_parcial"
      : resolvidos.every(item => item.situacao === "nao_disputado") ? "nao_participou"
      : resolvidos.every(item => item.situacao === "cancelado") ? "revogado_anulado"
      : "sem_vitoria";
    const valorCompleto = ganhos.every(item => item.valor_homologado !== null && item.valor_homologado !== undefined);
    const valor = ganhos.length && valorCompleto
      ? Number(ganhos.reduce((soma, item) => soma + Number(item.valor_homologado), 0).toFixed(2))
      : null;
    return { situacao, valor, ganhos: ganhos.length, total: itens.length, valorCompleto };
  }

  function resultadoEfetivo(processo, itens) {
    const apurado = apurarItens(itens);
    return apurado || {
      situacao: processo.situacao_resultado || "nao_apurado",
      valor: processo.valor_homologado == null ? null : Number(processo.valor_homologado),
      ganhos: 0,
      total: 0,
      valorCompleto: processo.valor_homologado != null,
    };
  }

  const api = { apurarItens, resultadoEfetivo };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.LicitaAcompanhamento = api;
})(typeof window !== "undefined" ? window : globalThis);
