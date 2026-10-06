/* global module, window */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (raiz) raiz.LicitaRelatorioOperacional = api;
})(typeof window !== "undefined" ? window : null, function () {
  const rotulos = {
    nao_apurado: "Não apurado", nao_participou: "Não participou", em_disputa: "Em disputa",
    sem_vitoria: "Participou sem vencer", vitoria_parcial: "Vitória parcial", vitoria_total: "Vitória total",
    vitoria_sem_detalhamento: "Ganhou — itens pendentes de detalhamento", revogado_anulado: "Revogado / anulado",
    pendente: "Pendente", ganho: "Ganho", perdido: "Perdido", desclassificado: "Desclassificado",
    inabilitado: "Inabilitado", nao_disputado: "Não disputado", cancelado: "Cancelado",
  };
  const esc = valor => String(valor ?? "").replace(/[&<>"']/g, caractere => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[caractere]);
  const rotulo = valor => rotulos[valor] || String(valor || "Não informado").replaceAll("_", " ");
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
  function tabela(cabecalhos, linhas) {
    return `<table><thead><tr>${cabecalhos.map(campo => `<th>${esc(campo)}</th>`).join("")}</tr></thead><tbody>${linhas.length ? linhas.map(linha => `<tr>${linha.map(campo => `<td>${campo}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${cabecalhos.length}" class="vazio">Nenhum registro.</td></tr>`}</tbody></table>`;
  }
  function campo(nome, valor) { return `<div class="campo"><span>${esc(nome)}</span><strong>${valor}</strong></div>`; }
  function secao(titulo, conteudo) { return `<section><h2>${esc(titulo)}</h2>${conteudo}</section>`; }

  function gerarHtml({ processo: p, empresa, itens = [], itensOficiais = null, ocorrencias = [], prazos = [], contratos = [], empenhos = [], anexos = [], resultado, emitidoEm = new Date() }) {
    if (!p || !resultado) throw new Error("Processo e resultado são obrigatórios.");
    const identificacao = `<div class="grid">${[
      campo("Empresa acompanhada", esc(empresa?.razao_social || "Não informada")),
      campo("CNPJ", esc(empresa?.cnpj || "Não informado")),
      campo("Número", esc(p.numero || "Não informado")),
      campo("Órgão comprador", esc(p.orgao || "Não informado")),
      campo("Modalidade", esc(p.modalidade || "Não informada")),
      campo("Portal / sistema", esc(p.sistema || "Não informado")),
      campo("UASG", esc(p.uasg || "Não informada")),
      campo("Publicação", esc(data(p.data_publicacao))),
      campo("Sessão", esc(data(p.data_sessao, true))),
      campo("Responsável", esc(p.responsavel || "Não definido")),
      campo("Decisão inicial", esc(rotulo(p.decisao))),
      campo("Estágio operacional", esc(rotulo(p.status))),
    ].join("")}</div><p><strong>Fonte do edital:</strong> ${fonte(p.url_origem)}</p>`;
    const valores = `<div class="grid">${[
      campo("Valor estimado", esc(dinheiro(p.valor_estimado))),
      campo("Custo direto", esc(dinheiro(p.custo_direto))),
      campo("Frete / despesas", esc(dinheiro(p.frete))),
      campo("Tributos", p.tributos_percentual == null ? "Não informado" : `${esc(p.tributos_percentual)}%`),
      campo("Garantia", p.garantia_percentual == null ? "Não informado" : `${esc(p.garantia_percentual)}%`),
      campo("Margem desejada", p.margem_percentual == null ? "Não informada" : `${esc(p.margem_percentual)}%`),
      campo("Preço mínimo calculado", esc(dinheiro(p.preco_minimo))),
      campo("Nossa proposta", esc(dinheiro(p.preco_proposta))),
      campo("Homologado à empresa", esc(dinheiro(resultado.valor))),
    ].join("")}</div>`;
    const situacao = `<div class="grid">${[
      campo("Participação / resultado apurado", esc(rotulo(resultado.situacao))),
      campo("Itens/lotes ganhos", esc(`${resultado.ganhos} de ${resultado.total}`)),
      campo("Data do resultado", esc(data(p.data_resultado))),
    ].join("")}</div><p><strong>Fonte do resultado:</strong> ${fonte(p.fonte_resultado)}</p><p><strong>Motivo / observação:</strong> ${esc(p.motivo_perda || "Não informado")}</p>${p.resultado ? `<p><strong>Registro anterior:</strong> ${esc(p.resultado)}</p>` : ""}`;
    const checklist = `<p class="nota">Origem: ${p.checklist_fonte === "resumo" ? "Resumo do Edital" : "registro da carteira"}. Confirme os requisitos na fonte oficial.</p>${tabela(["Nº", "Requisito de habilitação"], (p.documentos_exigidos || []).map((item, indice) => [String(indice + 1), esc(item)]))}`;
    const oficiais = itensOficiais === null ? '<p class="nota">Itens oficiais não consultados nesta emissão. Confira o edital de origem.</p>' : tabela(["Item", "Descrição", "Quantidade", "Unidade"], itensOficiais.map(item => [esc(item.numero), esc(item.descricao), esc(item.quantidade), esc(item.unidade)]));
    const resultados = tabela(["Item/lote", "Descrição", "Situação", "Quantidade", "Nossa proposta", "Homologado à empresa", "Observação / fonte"], itens.map(item => [
      esc(`${item.tipo} ${item.identificador}`), esc(item.descricao), esc(rotulo(item.situacao)), esc(item.quantidade), esc(dinheiro(item.valor_proposta)), esc(dinheiro(item.valor_homologado)), `${esc(item.motivo || "—")}<br>${fonte(item.fonte_oficial)}`,
    ]));
    const historico = tabela(["Data / hora", "Categoria", "Descrição", "Fonte"], ocorrencias.map(item => [esc(data(item.ocorrido_em, true)), esc(item.categoria), esc(item.descricao), fonte(item.fonte_oficial)]));
    const agenda = tabela(["Categoria", "Prazo", "Vencimento", "Responsável", "Situação", "Observações"], prazos.map(item => [esc(item.categoria), esc(item.titulo), esc(data(item.vencimento, true)), esc(item.responsavel), item.concluido_em ? `Concluído em ${esc(data(item.concluido_em, true))}` : "Pendente", esc(item.observacoes)]));
    const contratosHtml = tabela(["Contrato", "Situação", "Assinatura", "Vigência", "Valor", "Observações"], contratos.map(item => [esc(item.numero), esc(rotulo(item.situacao)), esc(data(item.assinado_em)), `${esc(data(item.vigencia_inicio))} a ${esc(data(item.vigencia_fim))}`, esc(dinheiro(item.valor)), esc(item.observacoes)]));
    const empenhosHtml = tabela(["Empenho", "Emissão", "Valor", "Saldo", "Entrega prevista", "Situação / observações"], empenhos.map(item => [esc(item.numero), esc(data(item.emitido_em)), esc(dinheiro(item.valor)), esc(dinheiro(item.saldo ?? item.valor)), esc(data(item.entrega_prevista)), `${esc(rotulo(item.status))}<br>${esc(item.observacoes)}`]));
    const anexosHtml = tabela(["Tipo", "Título", "Referência", "Arquivo", "Adicionado em"], anexos.map(item => [esc(item.tipo), esc(item.titulo), esc(item.referencia_numero), esc(item.arquivo_nome), esc(data(item.criado_em, true))]));
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório operacional - ${esc(p.numero || p.objeto)}</title><style>
      *{box-sizing:border-box}body{font:13px Arial,sans-serif;color:#172b45;max-width:1100px;margin:24px auto;padding:0 20px;line-height:1.45}
      header{border-bottom:4px solid #2478d9;padding:0 0 16px;margin-bottom:20px}header strong{color:#124788;font-size:25px}h1{font-size:23px;margin:12px 0 5px}h2{font-size:17px;color:#124788;border-bottom:1px solid #cad8e9;padding-bottom:5px;margin:25px 0 10px}section{break-inside:auto}
      .nota,.vazio{color:#5d6f85}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.campo{padding:9px;background:#eff5fc;border:1px solid #d9e5f2;break-inside:avoid}.campo span{display:block;font-size:10px;text-transform:uppercase;color:#596d84;margin-bottom:4px}.campo strong{font-size:12px}
      table{width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed}th,td{padding:7px;vertical-align:top;text-align:left;border-bottom:1px solid #d9e5f2;overflow-wrap:anywhere}th{background:#eaf2fb}tr{break-inside:avoid}a{color:#175cb2;overflow-wrap:anywhere}footer{border-top:1px solid #cad8e9;margin:26px 0;padding:10px 0;color:#5d6f85}
      @page{size:A4;margin:13mm}@media print{body{max-width:none;margin:0;padding:0}.campo,th{print-color-adjust:exact;-webkit-print-color-adjust:exact}.grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
    </style></head><body><header><strong>LicitaPlena</strong><div>Relatório de acompanhamento de licitação · emitido em ${esc(data(emitidoEm, true))}</div></header>
    <h1>${esc(p.objeto)}</h1>${secao("Identificação e decisão", identificacao)}${secao("Valores e proposta", valores)}${secao("Participação e resultado", situacao)}${secao("Checklist de habilitação", checklist)}${secao("Itens oficiais do edital", oficiais)}${secao("Resultado por item/lote", resultados)}${secao("Relatório cronológico", historico)}${secao("Prazos e sessão", agenda)}${secao("Contratos", contratosHtml)}${secao("Empenhos e execução", empenhosHtml)}${secao("Arquivos vinculados", anexosHtml)}${secao("Observações da decisão", `<p>${esc(p.observacoes || "Nenhuma observação registrada.")}</p>`)}
    <footer>Dados operacionais registrados na LicitaPlena. Confirme decisões, prazos e resultados nas fontes oficiais. Arquivos privados são relacionados pelo nome; não acompanham este PDF.</footer></body></html>`;
  }
  return { gerarHtml };
});
