/* global module, window */
// Etapas 7 (resultado) e 8 (contrato e empenho) da esteira: regras puras, sem rede e sem DOM.
// Usado pelo robô (scripts/esteira_contratos.js), pela função contextos-operacao (aviso no Hoje) e por
// operacao-acompanhamento-ui.js (sugestão de resultado e quadro "Contrato"). Fontes: PNCP (integração e consulta)
// e Contratos.gov.br (/api/contrato/...), todas públicas e sem login.
(function (raiz) {
  const DIAS_PAGAMENTO_ATRASADO = 30; // liquidado e sem pagamento há mais de N dias
  const NIVEIS_VENCIMENTO = [30, 60, 90];
  const MS_DIA = 864e5;

  const cnpjLimpo = (v) => String(v ?? "").replace(/\D/g, "");
  // Contratos.gov devolve "1.078.599,60"; PNCP devolve número. Vazio/ilegível vira null, nunca 0.
  function numero(v) {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v !== "string" || !v.trim()) return null;
    const n = Number(v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v);
    return Number.isFinite(n) ? n : null;
  }
  const arredondar = (n) => (n == null ? null : Math.round(n * 100) / 100);
  const dia = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
  const diasEntre = (de, ate) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / MS_DIA);

  // ---- Etapa 7: resultado ------------------------------------------------------------------------------
  // resultados: lista de /itens/{n}/resultados (pode ser vazia); situacaoItem: situacaoCompraItemNome de /itens/{n}.
  // Devolve null quando ainda não há o que sugerir (item sem resultado e sem situação final).
  function classificarItem(resultados, cnpjEmpresa, situacaoItem) {
    const nosso = cnpjLimpo(cnpjEmpresa);
    const lista = (Array.isArray(resultados) ? resultados : []).map((r) => ({
      cnpj: cnpjLimpo(r.niFornecedor), nome: String(r.nomeRazaoSocialFornecedor || "").slice(0, 200) || null,
      unitario: arredondar(numero(r.valorUnitarioHomologado)), total: arredondar(numero(r.valorTotalHomologado)),
      quantidade: numero(r.quantidadeHomologada), ordem: Number.isInteger(r.ordemClassificacaoSrp) ? r.ordemClassificacaoSrp : null,
      cancelado: /cancel/i.test(String(r.situacaoCompraItemResultadoNome || "")) || Boolean(r.dataCancelamento),
      motivo: typeof r.motivoCancelamento === "string" ? r.motivoCancelamento.trim().slice(0, 300) : null,
    }));
    const ativos = lista.filter((r) => !r.cancelado).sort((a, b) => (a.ordem ?? 1) - (b.ordem ?? 1));
    const meuAtivo = ativos.find((r) => r.cnpj === nosso);
    const meuCancelado = lista.find((r) => r.cancelado && r.cnpj === nosso);
    const fornecedor = (r) => ({ cnpj: r.cnpj, nome: r.nome });
    if (meuAtivo && (meuAtivo.ordem ?? 1) === 1) {
      return { situacao: "ganho", quantidade: meuAtivo.quantidade, unitario: meuAtivo.unitario, total: meuAtivo.total, fornecedor: fornecedor(meuAtivo), motivo: null };
    }
    const vencedor = ativos[0];
    if (meuAtivo) {
      return { situacao: "perdido", quantidade: null, unitario: null, total: null, fornecedor: vencedor ? fornecedor(vencedor) : null,
        motivo: `Cadastro de reserva (ordem ${meuAtivo.ordem}); venceu ${vencedor?.nome || "outro fornecedor"}` };
    }
    if (meuCancelado) {
      return { situacao: "cancelado", quantidade: null, unitario: null, total: null, fornecedor: null,
        motivo: `Seu resultado foi cancelado no PNCP${meuCancelado.motivo ? `: ${meuCancelado.motivo}` : ""}`.slice(0, 400) };
    }
    if (vencedor) {
      return { situacao: "perdido", quantidade: null, unitario: vencedor.unitario, total: vencedor.total, fornecedor: fornecedor(vencedor),
        motivo: `Perdeu para ${vencedor.nome || vencedor.cnpj}` };
    }
    if (/fracassad|deserto|cancelad|anulad|revogad/i.test(String(situacaoItem || ""))) {
      return { situacao: "cancelado", quantidade: null, unitario: null, total: null, fornecedor: null, motivo: `Item ${String(situacaoItem).toLowerCase()} no PNCP` };
    }
    return null;
  }

  // Só itens que o CRM ainda tem como 'pendente' valem como sugestão: o que o usuário já decidiu nunca é sobrescrito.
  function itensAindaPendentes(sugestao, itensCrm) {
    const pendentes = new Set((itensCrm || []).filter((i) => i.tipo === "item" && i.situacao === "pendente").map((i) => String(i.identificador)));
    return (sugestao?.itens || []).filter((i) => pendentes.has(String(i.numero)));
  }

  // Dados que o botão "Confirmar" grava em operacao_itens_resultado (mesmas colunas e regras de salvarItem).
  function dadosDoItem(s, fonteUrl) {
    const ganho = s.situacao === "ganho";
    return { situacao: s.situacao, motivo: ganho ? null : (s.motivo || null), fonte_oficial: fonteUrl || null,
      valor_unitario_homologado: ganho ? s.unitario : null, valor_homologado: ganho ? s.total : null };
  }

  // Texto único do aviso: "Você ganhou os itens 1, 3 (R$ …) / perdeu o item 2 para FULANO (R$ …)".
  function textoSugestao(itens, dinheiro) {
    const din = dinheiro || ((v) => `R$ ${Number(v).toFixed(2)}`);
    const rotulo = (lista) => `${lista.length > 1 ? "os itens" : "o item"} ${lista.map((i) => i.numero).join(", ")}`;
    const partes = [];
    const ganhos = itens.filter((i) => i.situacao === "ganho");
    if (ganhos.length) {
      const total = ganhos.reduce((s, i) => s + (i.total || 0), 0);
      partes.push(`Você ganhou ${rotulo(ganhos)}${total ? ` (${din(total)})` : ""}`);
    }
    for (const i of itens.filter((x) => x.situacao === "perdido")) {
      partes.push(`perdeu o item ${i.numero}${i.fornecedor?.nome ? ` para ${i.fornecedor.nome}` : ""}${i.total ? ` (${din(i.total)})` : ""}`);
    }
    const outros = itens.filter((i) => i.situacao === "cancelado");
    if (outros.length) partes.push(`${rotulo(outros)} sem vencedor ou com resultado cancelado`);
    if (!partes.length) return "";
    const texto = partes.join(" / ");
    return texto.startsWith("Você") ? texto : texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  // ---- Etapa 8: contrato, empenho e pagamento ----------------------------------------------------------
  // Pago e liquidado vêm dos empenhos do Contratos.gov; a data da liquidação vem das faturas. Sem data de
  // pagamento publicada, o pago total quita as faturas liquidadas da mais antiga para a mais nova (FIFO): a
  // primeira fatura não coberta marca "liquidado e sem pagamento desde". Pago maior que o liquidado (que acontece
  // por estorno no Siafi) não gera alerta.
  function liquidadoSemPagamento(faturas, pago) {
    let resto = Math.max(0, pago || 0);
    const liquidadas = (Array.isArray(faturas) ? faturas : []).filter((f) => dia(f.data_liquidacao) && f.valor > 0 && !f.cancelada)
      .sort((a, b) => a.data_liquidacao.localeCompare(b.data_liquidacao));
    let desde = null, aPagar = 0;
    for (const f of liquidadas) {
      if (resto + 0.005 >= f.valor) { resto -= f.valor; continue; }
      desde = desde || dia(f.data_liquidacao);
      aPagar += f.valor - resto;
      resto = 0;
    }
    return { desde, aPagar: arredondar(aPagar) };
  }

  // Linha de operacao_contratos_publicos a partir do que as fontes devolveram. Ausente fica null (nunca 0).
  function montarLinha({ pncp, termos, empenhosPncp, gov }) {
    const contrato = gov?.contrato || null;
    const empenhosGov = gov?.empenhos || [];
    const tipoNome = String(pncp?.tipoContrato?.nome || "");
    const tipo = /empenho/i.test(tipoNome) ? "empenho" : /contrato/i.test(tipoNome) ? "contrato" : "outro";
    const aditivos = [
      ...(Array.isArray(termos) ? termos : []).map((t) => ({ fonte: "pncp", numero: t.numeroTermoContrato ?? null, tipo: t.tipoTermoContratoNome ?? null,
        assinatura: dia(t.dataAssinatura), vigencia_fim: dia(t.dataVigenciaFim) ?? null, valor_acrescido: numero(t.valorAcrescido), prazo_dias: Number.isInteger(t.prazoAditadoDias) ? t.prazoAditadoDias : null })),
      ...(gov?.historico || []).filter((h) => /aditivo|apostila|rescis/i.test(String(h.tipo || ""))).map((h) => ({ fonte: "contratos_gov", numero: h.numero ?? null, tipo: h.tipo,
        assinatura: dia(h.data_assinatura), vigencia_fim: dia(h.vigencia_fim), valor_global: numero(h.valor_global), novo_valor_global: numero(h.novo_valor_global) })),
    ].slice(0, 100);
    const empenhos = empenhosGov.length
      ? empenhosGov.map((e) => ({ numero: e.numero || null, emissao: dia(e.data_emissao), empenhado: numero(e.empenhado), liquidado: numero(e.liquidado), pago: numero(e.pago), fonte: "contratos_gov" }))
      : (Array.isArray(empenhosPncp) ? empenhosPncp : []).map((e) => ({ numero: e.numeroEmpenho || null, emissao: dia(e.dataEmissaoEmpenho), empenhado: numero(e.valorTotal), liquidado: null, pago: null, situacao: e.situacaoEmpenhoNome || null, fonte: "pncp" }));
    const soma = (campo) => (empenhos.some((e) => e[campo] != null) ? arredondar(empenhos.reduce((s, e) => s + (e[campo] || 0), 0)) : null);
    const pago = soma("pago");
    const faturas = (gov?.faturas || []).map((f) => ({ numero: String(f.numero ?? "").slice(0, 40), emissao: dia(f.emissao), vencimento: dia(f.vencimento),
      data_liquidacao: dia(f.data_liquidacao), valor: arredondar(numero(f.valorliquido) ?? numero(f.valor)), cancelada: /^s/i.test(String(f.nota_cancelada || "")) })).slice(0, 200);
    const pend = liquidadoSemPagamento(faturas, pago);
    // Sem fatura (ex.: empenho avulso) só dá para saber o valor liquidado e não pago, não desde quando.
    const liquidadoNaoPago = empenhosGov.length ? arredondar(empenhos.reduce((s, e) => s + Math.max(0, (e.liquidado || 0) - (e.pago || 0)), 0)) : null;
    const vigenciasFim = [dia(pncp?.dataVigenciaFim), dia(contrato?.vigencia_fim), ...aditivos.map((a) => a.vigencia_fim)].filter(Boolean).sort();
    return {
      chave: String(pncp?.numeroControlePNCP || (contrato?.id ? `cg:${contrato.id}` : "")).slice(0, 80), tipo,
      numero: String(contrato?.numero || pncp?.numeroContratoEmpenho || "").slice(0, 60) || null,
      objeto: String(contrato?.objeto || pncp?.objetoContrato || "").slice(0, 1000) || null,
      fornecedor_cnpj: /^\d{14}$/.test(cnpjLimpo(pncp?.niFornecedor || contrato?.fornecedor?.cnpj_cpf_idgener)) ? cnpjLimpo(pncp?.niFornecedor || contrato?.fornecedor?.cnpj_cpf_idgener) : null,
      fornecedor_nome: String(pncp?.nomeRazaoSocialFornecedor || contrato?.fornecedor?.nome || "").slice(0, 300) || null,
      assinatura: dia(contrato?.data_assinatura) || dia(pncp?.dataAssinatura), vigencia_inicio: dia(contrato?.vigencia_inicio) || dia(pncp?.dataVigenciaInicio),
      vigencia_fim: vigenciasFim.length ? vigenciasFim[vigenciasFim.length - 1] : null,
      valor_global: arredondar(numero(contrato?.valor_global) ?? numero(pncp?.valorGlobal)),
      valor_empenhado: soma("empenhado"), valor_liquidado: soma("liquidado"), valor_pago: pago,
      a_pagar: pend.aPagar > 0 ? pend.aPagar : liquidadoNaoPago > 0 ? liquidadoNaoPago : null,
      liquidado_sem_pagamento_desde: pend.aPagar > 0 ? pend.desde : null,
      aditivos, empenhos, faturas, contratos_gov_id: contrato?.id ?? null,
      fontes: { pncp: pncp?.numeroControlePNCP ? `https://pncp.gov.br/app/contratos/${pncp.numeroControlePNCP.replace(/^(\d{14})-2-0*(\d+)\/(\d{4})$/, "$1/$3/$2")}` : null,
        contratos_gov: contrato?.id ? `https://contratos.comprasnet.gov.br/api/contrato/id/${contrato.id}` : null },
    };
  }

  // Situação calculada na leitura (o vencimento muda com o tempo; o banco guarda só datas e valores).
  function situacaoContrato(c, hoje, opcoes = {}) {
    const limite = opcoes.diasPagamento ?? DIAS_PAGAMENTO_ATRASADO;
    const fim = dia(c?.vigencia_fim);
    const dias = fim ? diasEntre(hoje, fim) : null;
    const nivel = dias == null ? null : dias < 0 ? "vencida" : NIVEIS_VENCIMENTO.find((n) => dias <= n) ?? null;
    const global = numero(c?.valor_global), empenhado = numero(c?.valor_empenhado);
    const aPagar = numero(c?.a_pagar), desde = dia(c?.liquidado_sem_pagamento_desde);
    const diasSemPagar = aPagar > 0 && desde ? diasEntre(desde, hoje) : null;
    return {
      vigencia: { fim, dias, nivel },
      saldoSemEmpenho: global != null && empenhado != null ? arredondar(Math.max(0, global - empenhado)) : null,
      pagamento: aPagar > 0 ? { valor: aPagar, desde, dias: diasSemPagar, atrasado: diasSemPagar != null && diasSemPagar > limite } : null,
    };
  }

  function textoVigencia(v) {
    if (!v.fim) return "Vigência não informada";
    if (v.dias < 0) return `Vigência encerrada há ${-v.dias} ${v.dias === -1 ? "dia" : "dias"}`;
    return v.dias === 0 ? "Vence hoje" : `Vence em ${v.dias} ${v.dias === 1 ? "dia" : "dias"}`;
  }

  // Alertas do Hoje: só contrato (empenho não tem vigência de renovação) a até 90 dias de vencer; pagamento atrasado de qualquer tipo.
  function alertasDoContrato(c, hoje, opcoes) {
    const s = situacaoContrato(c, hoje, opcoes), saida = [];
    if (c.tipo === "contrato" && s.vigencia.dias != null && s.vigencia.dias >= 0 && s.vigencia.nivel) saida.push({ tipo: "vencimento", nivel: s.vigencia.nivel, dias: s.vigencia.dias, vencimento: s.vigencia.fim });
    if (s.pagamento?.atrasado) saida.push({ tipo: "pagamento", dias: s.pagamento.dias, valor: s.pagamento.valor, desde: s.pagamento.desde });
    return saida;
  }

  // HTML do quadro "Contrato" (esc/dinheiro/data vêm da página; todo texto externo passa por esc).
  function htmlQuadroContrato(contratos, hoje, { esc, dinheiro, data }) {
    if (!contratos.length) return '<p class="nota">Ainda não há contrato ou empenho publicado para este processo. O robô confere o PNCP e o Contratos.gov.br todo dia depois da vitória.</p>';
    const din = (v) => (v == null ? "Não informado" : dinheiro(v));
    return contratos.map((c) => {
      const s = situacaoContrato(c, hoje);
      const alertas = [];
      if (c.tipo === "contrato" && s.vigencia.nivel && s.vigencia.nivel !== "vencida") alertas.push(`<p class="aviso-dados" data-alerta="vencimento">Contrato vence em ${s.vigencia.dias} ${s.vigencia.dias === 1 ? "dia" : "dias"} (faixa de ${s.vigencia.nivel} dias).</p>`);
      if (s.pagamento?.atrasado) alertas.push(`<p class="aviso-dados" data-alerta="pagamento">Pagamento atrasado: ${din(s.pagamento.valor)} liquidados sem pagamento há ${s.pagamento.dias} dias.</p>`);
      else if (s.pagamento) alertas.push(`<p class="nota">Liquidado e ainda não pago: ${din(s.pagamento.valor)}${s.pagamento.desde ? ` (desde ${data(s.pagamento.desde)})` : " (data da liquidação não publicada)"}.</p>`);
      const links = Object.entries(c.fontes || {}).filter(([, u]) => typeof u === "string" && /^https:\/\//.test(u))
        .map(([k, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${k === "pncp" ? "PNCP" : "Contratos.gov.br"}</a>`).join(" · ");
      const aditivos = (c.aditivos || []).map((a) => `<small>${esc(a.tipo || "Aditivo")} ${esc(a.numero ?? "")}${a.assinatura ? ` · ${data(a.assinatura)}` : ""}${a.vigencia_fim ? ` · vigência até ${data(a.vigencia_fim)}` : ""}${a.novo_valor_global ? ` · novo valor ${din(a.novo_valor_global)}` : a.valor_acrescido ? ` · acréscimo ${din(a.valor_acrescido)}` : ""}</small>`).join("");
      const empenhos = (c.empenhos || []).map((e) => `<small>Empenho ${esc(e.numero || "—")}${e.emissao ? ` · ${data(e.emissao)}` : ""} · empenhado ${din(e.empenhado)} · liquidado ${din(e.liquidado)} · pago ${din(e.pago)}${e.situacao ? ` · ${esc(e.situacao)}` : ""}</small>`).join("");
      return `<div class="linha-registro" data-contrato-publico="${esc(c.chave)}"><strong>${c.tipo === "empenho" ? "Empenho" : "Contrato"} ${esc(c.numero || "sem número")}</strong>
        <small>${esc(c.objeto || "")}</small>
        <div class="dossie-grid"><div class="dado"><span>Vigência</span><b>${data(c.vigencia_inicio)} a ${data(c.vigencia_fim)}</b><small>${esc(textoVigencia(s.vigencia))}</small></div>
        <div class="dado"><span>Valor do contrato</span><b>${din(c.valor_global)}</b></div>
        <div class="dado"><span>Empenhado</span><b>${din(c.valor_empenhado)}</b><small>Saldo sem empenho: ${din(s.saldoSemEmpenho)}</small></div>
        <div class="dado"><span>Liquidado / pago</span><b>${din(c.valor_liquidado)} / ${din(c.valor_pago)}</b></div></div>
        ${alertas.join("")}${aditivos}${empenhos}
        <small>Conferido em ${data(c.consultado_em)} · ${links || "fonte oficial"}</small></div>`;
    }).join("");
  }

  const api = { DIAS_PAGAMENTO_ATRASADO, NIVEIS_VENCIMENTO, cnpjLimpo, numero, classificarItem, itensAindaPendentes, dadosDoItem, textoSugestao,
    liquidadoSemPagamento, montarLinha, situacaoContrato, textoVigencia, alertasDoContrato, htmlQuadroContrato };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.ContratoPublico = api;
})(typeof window !== "undefined" ? window : globalThis);
