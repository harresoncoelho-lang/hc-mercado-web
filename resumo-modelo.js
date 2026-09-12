/* global module */
(function (raiz) {
  "use strict";
const CAMPOS = {
    dadosOficiais: { titulo: "Dados Oficiais do PNCP", campos: { publicacao: "Publicado em", inicioRecebimento: "Início do recebimento de propostas", prazoFinal: "Prazo final de propostas", modalidade: "Modalidade", modoDisputa: "Modo de disputa", criterioJulgamento: "Critério de julgamento", regimeExecucao: "Regime de execução" } },
    identificacao: { titulo: "Identificação da Licitação", campos: { numero: "Número", uasg: "UASG", contratacao: "Contratação", modalidade: "Modalidade", portalRealizacao: "Portal de realização", regulamentacao: "Regulamentação" } },
    sessaoPublica: { titulo: "Sessão Pública", campos: { data: "Data", horario: "Horário", modoDisputa: "Modo de disputa", intervaloMinimo: "Intervalo mínimo" } },
    orgao: { titulo: "Órgão Responsável", campos: { nome: "Órgão", email: "E-mail", endereco: "Endereço", telefone: "Telefone" } },
    detalhes: { titulo: "Detalhes da Licitação", campos: { valorEstimado: "Valor estimado", prazoEntrega: "Prazo de entrega", margemPreferencia: "Margem de preferência", exigeVisitaTecnica: "Exige visita técnica", exigeAmostra: "Exige amostra", garantia: "Garantia", criterioJulgamento: "Critério de julgamento", tipoAnalise: "Tipo de análise", regimeExecucao: "Regime de execução", preferenciaMeEpp: "Preferência ME/EPP", restricoesRegionalidade: "Restrições de regionalidade", provaConceito: "Exigência de prova de conceito" } },
    garantias: { titulo: "Seguro e Garantias", campos: { proposta: "Garantia de proposta", contrato: "Garantia de contrato", adicional: "Garantia adicional", retomada: "Garantia de retomada" } },
    entregaExecucao: { titulo: "Entrega e Execução", campos: { prazo: "Prazo", local: "Local de entrega/execução", condicoes: "Condições de execução" } },
    prazos: { titulo: "Prazos Importantes", campos: { limiteEnvioPropostas: "Limite p/ envio de propostas", prazoDocumentoComplementar: "Documento complementar", prazoDocumentoOriginal: "Documento original", prazoRecurso: "Prazo p/ recurso", prazoContrarrazoes: "Prazo p/ contrarrazões", limiteEsclarecimentos: "Limite p/ esclarecimentos", limiteImpugnacao: "Limite p/ impugnação", vigenciaContrato: "Vigência do contrato" } },
    criteriosProposta: { titulo: "Critérios da Proposta e Julgamento", campos: { validadeProposta: "Validade da proposta", criteriosDesempate: "Critérios de desempate", exigenciasPropostaComercial: "Exigências da proposta comercial", propostasLancesPor: "Propostas/lances por", programaIntegridade: "Programa de integridade" } },
    itens: { titulo: "Resumo dos Itens", campos: { totalItens: "Total de itens", descricaoGeral: "Descrição geral", categoriasPrincipais: "Categorias principais", observacoes: "Observações" } },
    analiseCritica: { titulo: "Análise Crítica", campos: { conflitoObjetoMinuta: "Conflito objeto/minuta", conflitoPrazoVigenciaArp: "Conflito prazo vigência/ARP", conflitoPrazosEntrega: "Conflito prazos de entrega", permiteSubcontratacao: "Permite subcontratação", previsaoReajuste: "Previsão de reajuste/repactuação", permiteRenovacao: "Permite renovação de contrato", estabeleceCondicoesPagamento: "Estabelece condições de pagamento" } },
  };
  function texto(valor) {
    if (valor == null) return "";
    if (typeof valor !== "object") return String(valor).trim();
    return texto(valor.texto || valor.titulo || valor.pergunta || valor.descricao || valor.item || valor.conteudo || valor.motivo);
  }
  function util(valor) {
    const t = texto(valor);
    return /^(?:n[ãa]o (?:informado|localizado)|nenhum(?:a)? (?:documento|declara[cç][ãa]o|pend[êe]ncia|questionamento|outro ponto))/i.test(t) ? "" : t;
  }
  function data(valor) {
    return util(valor).replace(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2})?)?$/, (_, a, m, d, h) => `${d}/${m}/${a}${h ? ` às ${h}` : ""}`);
  }
  function montar(resumo = {}, edital = {}, consideracoes = "") {
    const est = {
      ...resumo,
      identificacao: { ...resumo.identificacao, numero: util(resumo.identificacao?.numero) || util(edital.numero) || util(edital.numeroControlePNCP), objeto: util(resumo.identificacao?.objeto) || util(edital.objeto), modalidade: util(resumo.identificacao?.modalidade) || util(edital.modalidade) },
      orgao: { ...resumo.orgao, nome: util(resumo.orgao?.nome) || util(edital.orgao) },
      dadosOficiais: { ...resumo.dadosOficiais, publicacao: util(resumo.dadosOficiais?.publicacao) || util(edital.publicacao), inicioRecebimento: util(resumo.dadosOficiais?.inicioRecebimento) || util(edital.inicioRecebimento), prazoFinal: util(resumo.dadosOficiais?.prazoFinal) || util(edital.encerramento) },
    };
    const campos = chave => Object.entries(CAMPOS[chave]?.campos || {}).map(([k, rotulo]) => ({rotulo, valor: data(est[chave]?.[k])})).filter(c => c.valor);
    const livre = (rotulo, valor) => util(valor) ? [{rotulo, valor: util(valor)}] : [];
    const lista = (rotulo, valores) => {
      const itens = Array.isArray(valores) ? valores.map(util).filter(Boolean) : [];
      return itens.length ? [{rotulo, valor: [...new Set(itens)]}] : [];
    };
    const documentos = new Map();
    for (const item of Array.isArray(est.documentosHabilitacao) ? est.documentosHabilitacao : []) {
      const categoria = util(item?.categoria) || "Documentos exigidos";
      if (!documentos.has(categoria)) documentos.set(categoria, []);
      documentos.get(categoria).push(item);
    }
    const itens = Array.isArray(est.itensPncp) ? est.itensPncp : [];
    const secoes = [
      ["Identificação da licitação", [...livre("Objeto", est.identificacao.objeto), ...campos("identificacao"), ...campos("dadosOficiais")]],
      ["Sessão pública", campos("sessaoPublica")],
      ["Órgão responsável", campos("orgao")],
      ["Detalhes da licitação", campos("detalhes")],
      ["Seguro e garantias", campos("garantias")],
      ["Entrega e execução", campos("entregaExecucao")],
      ["Prazos importantes", campos("prazos")],
      ["Critérios da proposta", [...campos("criteriosProposta"), ...lista("Preparação e envio da proposta", est.requisitosProposta)]],
      ["Resumo dos itens", [...campos("itens"), ...lista(`Itens da oportunidade (${itens.length})`, itens.map((item, i) => `${item.numeroItem || i + 1}. ${texto(item.descricao).replace(/<[^>]*>/g, " ")} — ${[item.quantidade, item.unidade].filter(v => v != null && v !== "").join(" ")}`))]],
      ["Documentos de habilitação", [...lista("Credenciamento e participação", est.documentosCredenciamento), ...[...documentos].flatMap(([categoria, valores]) => lista(categoria, valores))]],
      ["Atestado de capacidade técnica", livre("Exigência", est.atestadoCapacidadeTecnica)],
      ["Legislação", livre("Base legal", est.legislacao)],
      ["Anexos e declarações", [...lista("Declarações e formulários", est.declaracoesExigidas), ...livre("Anexos e modelos citados", est.anexosDeclaracoes)]],
      ["Outras informações relevantes", lista("Informações complementares", est.outrasInformacoesRelevantes)],
      ["Condições de pagamento", livre("Pagamento", est.condicoesPagamento)],
      ["Penalidades e multas", [...livre("Penalidades", est.penalidades), ...livre("Multas", est.multas)]],
      ["Análise crítica", [...campos("analiseCritica"), ...lista("Pendências para conferência", est.pendenciasParaConferencia), ...lista("Possíveis questionamentos", est.possiveisQuestionamentos), ...lista("Perguntas sugeridas ao órgão", est.questionamentosSugeridos)]],
      ["Considerações", livre("Considerações do licitante", consideracoes)],
    ].map(([titulo, valores]) => ({titulo, campos: valores}));
    return { numero: est.identificacao.numero, objeto: est.identificacao.objeto,
      cards: [["Valor estimado", util(est.detalhes?.valorEstimado) || util(edital.valor) || "Não informado"], ["Modalidade", est.identificacao.modalidade || "Não informado"], ["Data da sessão", data(est.sessaoPublica?.data) || "Não informado"]], secoes };
  }
  const api = { montar, texto, util };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.ResumoModelo = api;
})(globalThis);
