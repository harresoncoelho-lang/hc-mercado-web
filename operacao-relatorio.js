/* global module, window */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (raiz) raiz.LicitaRelatorioOperacional = api;
})(typeof window !== "undefined" ? window : null, function () {
  const esc = valor => String(valor ?? "").replace(/[&<>"']/g, caractere => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[caractere]);
  const dinheiro = valor => valor == null ? "Não informado" : Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  function data(valor, horario = false) {
    if (!valor) return "Não informado";
    const instante = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(valor)) ? `${valor}T12:00:00` : valor);
    if (Number.isNaN(instante.getTime())) return "Não informado";
    return horario ? instante.toLocaleString("pt-BR") : instante.toLocaleDateString("pt-BR");
  }
  function fonte(valor) {
    if (!/^https?:\/\//i.test(String(valor || ""))) return "Não vinculada";
    return `<a href="${esc(valor)}">${esc(valor)}</a>`;
  }
  function campo(nome, valor) { return `<div class="campo"><span>${esc(nome)}</span><strong>${valor}</strong></div>`; }
  function gerarHtml({ processo: p, empresa, itens = [], resultado, emitidoEm = new Date() }) {
    if (!p || !resultado) throw new Error("Processo e resultado são obrigatórios.");
    const ganhos = itens.filter(item => item.situacao === "ganho");
    const ganhosHtml = ganhos.length
      ? `<table><thead><tr><th>Item/lote</th><th>Descrição</th><th>Marca / modelo</th><th>Quantidade</th><th>Valor homologado à empresa</th><th>Fonte oficial</th></tr></thead><tbody>${ganhos.map(item => `<tr><td>${esc(`${item.tipo || "Item"} ${item.identificador || ""}`)}</td><td>${esc(item.descricao || "Não informada")}</td><td>${esc([item.marca, item.modelo].filter(Boolean).join(" / ") || "Não informado")}</td><td>${esc(item.quantidade ?? "Não informada")}</td><td>${esc(dinheiro(item.valor_homologado))}</td><td>${fonte(item.fonte_oficial)}</td></tr>`).join("")}</tbody></table>`
      : `<p class="nota">${["vitoria_total", "vitoria_parcial", "vitoria_sem_detalhamento"].includes(resultado.situacao) ? "Vitória informada, mas os itens/lotes ganhos ainda não foram detalhados." : "Nenhum item/lote ganho registrado até esta emissão."}</p>`;
    const identificacao = [
      campo("Empresa", esc(empresa?.razao_social || "Não informada")),
      campo("Número / processo", esc(p.numero || "Não informado")),
      campo("Órgão", esc(p.orgao || "Não informado")),
      campo("Modalidade", esc(p.modalidade || "Não informada")),
      campo("Portal / sistema", esc(p.sistema || "Não informado")),
      campo("Publicação", esc(data(p.data_publicacao))),
      campo("Sessão / abertura", esc(data(p.data_sessao, true))),
      campo("Estágio", esc(String(p.status || "Não informado").replaceAll("_", " "))),
      campo("Valor homologado à empresa", esc(dinheiro(resultado.valor))),
    ].join("");
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório operacional - ${esc(p.numero || p.objeto)}</title><style>
      *{box-sizing:border-box}body{font:13px Arial,sans-serif;color:#172b45;max-width:1100px;margin:24px auto;padding:0 20px;line-height:1.45}
      header{border-bottom:4px solid #2478d9;padding-bottom:16px;margin-bottom:20px}header strong{color:#124788;font-size:25px}h1{font-size:23px;margin:12px 0 5px}h2{font-size:17px;color:#124788;border-bottom:1px solid #cad8e9;padding-bottom:5px;margin:25px 0 10px}
      .nota{color:#5d6f85}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.campo{padding:9px;background:#eff5fc;border:1px solid #d9e5f2;break-inside:avoid}.campo span{display:block;font-size:10px;text-transform:uppercase;color:#596d84;margin-bottom:4px}.campo strong{font-size:12px}
      table{width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed}th,td{padding:7px;vertical-align:top;text-align:left;border-bottom:1px solid #d9e5f2;overflow-wrap:anywhere}th{background:#eaf2fb}tr{break-inside:avoid}a{color:#175cb2;overflow-wrap:anywhere}footer{border-top:1px solid #cad8e9;margin:26px 0;padding:10px 0;color:#5d6f85}
      @page{size:A4;margin:13mm}@media print{body{max-width:none;margin:0;padding:0}.campo,th{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
    </style></head><body><header><strong>LicitaPlena</strong><div>Acompanhamento de licitação · emitido em ${esc(data(emitidoEm, true))}</div></header>
    <h1>${esc(p.objeto || "Processo sem objeto")}</h1><div class="grid">${identificacao}</div><p><strong>Fonte do edital:</strong> ${fonte(p.url_origem)}</p>
    <section><h2>Itens/lotes ganhos (${ganhos.length})</h2>${ganhosHtml}</section>
    <footer>Somente os ganhos registrados aparecem neste relatório. Confirme homologação, valores e datas na fonte oficial.</footer></body></html>`;
  }
  return { gerarHtml };
});
