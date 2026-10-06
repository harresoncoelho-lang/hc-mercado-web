/* global module, window */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (raiz) raiz.LicitaOperacaoEdital = api;
})(typeof window !== "undefined" ? window : null, function () {
  function texto(valor) {
    if (valor && typeof valor === "object" && !Array.isArray(valor)) valor = valor.texto;
    return typeof valor === "string" ? valor.replace(/\s+/g, " ").trim() : "";
  }

  function requisitosDaEstrutura(estrutura) {
    if (!estrutura || estrutura.fonteLida !== true || estrutura.modoDegradado) return [];
    const vistos = new Set();
    const resultado = [];
    for (const chave of ["documentosHabilitacao", "declaracoesExigidas"]) {
      for (const valor of (Array.isArray(estrutura[chave]) ? estrutura[chave] : [])) {
        const requisito = texto(valor);
        const normalizado = requisito.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        if (!requisito || requisito.length > 1000 || /^(nao (informado|localizado)|nenhum)/.test(normalizado) || vistos.has(normalizado)) continue;
        vistos.add(normalizado);
        resultado.push(requisito);
      }
    }
    return resultado;
  }

  function idPncp(processo) {
    const candidatos = [processo?.origem_externa_id, processo?.numero];
    return candidatos.find(valor => typeof valor === "string" && /^\d{14}-\d+-\d+\/\d{4}$/.test(valor)) || null;
  }

  return { requisitosDaEstrutura, idPncp };
});
