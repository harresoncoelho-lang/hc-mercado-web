/* global module */
(function (raiz) {
  "use strict";
  const normalizar = (v) => String(v || "").normalize("NFD").replace(/[\u0300-\u036f'’]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  function consultarCapag(base, edital = {}) {
    const ausente = (motivo) => ({ disponivel: false, motivo });
    if (!base?.municipios) return ausente("Base CAPAG indisponível no momento.");
    const orgao = normalizar(edital.orgao);
    if ((edital.esferaId && edital.esferaId !== "M") || !/^(?:municipio|prefeitura(?: municipal)?)\b/.test(orgao)) return ausente("CAPAG municipal não atribuída a este órgão. A nota do município não é a nota de órgãos federais, câmaras ou entidades independentes.");
    const municipio = normalizar(edital.municipio), uf = String(edital.uf || "").toUpperCase();
    if (!municipio || !/^[A-Z]{2}$/.test(uf) || !orgao.endsWith(municipio)) return ausente("Não foi possível confirmar o ente responsável por município e UF.");
    const linhas = base.municipios.filter((r) => normalizar(r.municipio) === municipio && r.uf === uf && (!edital.codigoMunicipioIbge || String(r.ibge) === String(edital.codigoMunicipioIbge)));
    if (linhas.length !== 1) return ausente("Município não localizado de forma inequívoca na base CAPAG.");
    const registro = linhas[0];
    if (!/^[ABCD]\+?$/.test(registro.nota)) return ausente(`Nota CAPAG não disponível para este ente na posição de ${base.posicao}.`);
    return { ...registro, disponivel: true, posicao: base.posicao, coletadoEm: base.coletadoEm, fonte: base.fonte, observacao: "Indicador de situação fiscal do ente; não mede histórico nem garante pontualidade no pagamento a fornecedores. Prévia calculada a partir de dados declarados ao Tesouro." };
  }
  const api = { consultarCapag };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.Capag = api;
})(globalThis);
