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
  function moeda(valor) {
    const t = util(valor);
    if (!t || !/^\d+(?:\.\d+)?$/.test(t)) return t;
    const numero = Number(t);
    return Number.isFinite(numero) ? new Intl.NumberFormat("pt-BR", {style:"currency", currency:"BRL"}).format(numero) : t;
  }
  function numeroLicitacao(resumo, edital) {
    const numero = util(resumo.identificacao?.numero);
    const oficial = util(edital.numeroCompra) && util(edital.anoCompra) ? `${edital.numeroCompra}/${edital.anoCompra}` : util(edital.numero);
    return numero && !/^\d{14}-\d-\d+\/\d{4}$/.test(numero) ? numero : oficial || numero || util(edital.numeroControlePNCP);
  }
  // Conta quantos itens compartilham cada valor de um campo do PNCP, ignorando os
  // valores que não acrescentam informação (ex.: "Não se aplica").
  function contarPorValor(itens, campo, ignorar) {
    const contagem = new Map();
    for (const item of itens) {
      const valor = texto(item?.[campo]);
      if (valor && !(ignorar && ignorar.test(valor))) contagem.set(valor, (contagem.get(valor) || 0) + 1);
    }
    return contagem;
  }
  function descreverContagem(contagem, total) {
    return [...contagem].map(([valor, n]) => total > 1 ? `${valor} em ${n} de ${total} itens` : valor).join("; ");
  }
  // Campos que o PNCP publica prontos (benefício ME/EPP, sigilo, margem, conteúdo
  // nacional, links da disputa). Entram na ficha mesmo antes da leitura do edital
  // pela IA, porque mudam a decisão de participar e não dependem do PDF.
  function oficiaisPncp(edital, itens) {
    const total = itens.length;
    const SEM_BENEFICIO = /sem benef|n[ãa]o se aplica/i;
    const beneficios = contarPorValor(itens, "beneficio", SEM_BENEFICIO);
    const comBeneficioInformado = itens.filter(i => texto(i?.beneficio)).length;
    const criterios = contarPorValor(itens, "criterioJulgamento");
    const margens = contarPorValor(itens, "margemPreferencia");
    const conteudoNacional = itens.filter(i => i?.exigenciaConteudoNacional === true).length;
    const itensSigilosos = itens.filter(i => i?.orcamentoSigiloso === true).length;
    const sigilo = util(edital.orcamentoSigiloso) || (itensSigilosos ? `Orçamento sigiloso em ${itensSigilosos} de ${total} itens` : "");
    const presencial = util(edital.justificativaPresencial) || (/presencial/i.test(texto(edital.modalidadeNome || edital.modalidade)) ? "Modalidade presencial" : "");
    const preferenciaMeEpp = beneficios.size ? descreverContagem(beneficios, total)
      : total && comBeneficioInformado === total ? "Sem benefício para ME/EPP nos itens" : "";
    const atencao = [];
    if (sigilo) atencao.push(`${sigilo}: o valor estimado só é divulgado depois da disputa.`);
    for (const [valor, n] of beneficios) atencao.push(`${valor}: ${n} de ${total} ${total > 1 ? "itens" : "item"}.`);
    for (const [valor, n] of margens) atencao.push(`${valor} para produto nacional: ${n} de ${total} ${total > 1 ? "itens" : "item"}.`);
    if (conteudoNacional) atencao.push(`Exigência de conteúdo nacional: ${conteudoNacional} de ${total} ${total > 1 ? "itens" : "item"}.`);
    if (presencial) atencao.push(`Disputa presencial: ${presencial}.`);
    return {
      identificacao: [
        ["Unidade compradora", edital.nomeUnidade], ["Plataforma da disputa", edital.plataforma],
        ["Link da disputa", edital.linkSistemaOrigem], ["Processo administrativo", edital.processo],
        ["Processo eletrônico", edital.linkProcessoEletronico], ["Órgão sub-rogado", edital.orgaoSubRogado],
      ].filter(([, v]) => util(v)).map(([rotulo, valor]) => ({rotulo, valor: util(valor)})),
      sigilo, preferenciaMeEpp,
      margemPreferencia: descreverContagem(margens, total),
      conteudoNacional: conteudoNacional ? `Exigida em ${conteudoNacional} de ${total} ${total > 1 ? "itens" : "item"}` : "",
      criterioPorItem: criterios.size > 1 ? descreverContagem(criterios, total) : "",
      criterioUnico: criterios.size === 1 ? [...criterios.keys()][0] : "",
      informacaoComplementar: util(edital.informacaoComplementar),
      atencao,
    };
  }
  function valorEstimado(valor, sigilo) {
    const t = util(valor);
    return sigilo && (!t || Number(t) === 0) ? "Sigiloso" : moeda(t);
  }
  function linhaItem(item, i) {
    const quantidade = [item.quantidade, item.unidade].filter(v => v != null && v !== "").join(" ");
    const unitario = !item.orcamentoSigiloso && Number(item.valorUnitarioEstimado) > 0 ? `${moeda(String(item.valorUnitarioEstimado))} un.` : "";
    const beneficio = /sem benef|n[ãa]o se aplica/i.test(texto(item.beneficio)) ? "" : texto(item.beneficio);
    const extras = [quantidade, unitario, beneficio].filter(Boolean).join(" · ");
    return `${item.numeroItem || item.numero || i + 1}. ${texto(item.descricao).replace(/<[^>]*>/g, " ")}${extras ? ` — ${extras}` : ""}`;
  }
  function pendentesLeitura(cobertura = {}) {
    const avisosOCR = new Set(cobertura.avisosOCR || []);
    return (cobertura.documentosNaoLidos || []).filter((v) => !avisosOCR.has(v));
  }
  // Motivo em linguagem do cliente, só para causas conhecidas; erro técnico (HTTP, exceção) fica só o nome.
  const MOTIVOS_LEITURA = [
    [/download indisponível/, "o PNCP não entregou o arquivo; vale tentar ler de novo"],
    [/ilegível|sem texto/, "arquivo sem texto legível (pode ser imagem ou formato não suportado); confira o original"],
    [/limite de documentos/, "não lido: o edital tem mais anexos que o limite de leitura"],
    [/^: limite de texto$/, "não lido: o limite de texto da leitura acabou antes deste arquivo"],
    [/limite de texto|excedeu o limite/, "lido até o limite de texto; o final não foi analisado"],
    [/OCR não concluído|imagem sem texto/, "páginas digitalizadas sem leitura automática concluída; confira o original"],
    [/pouco texto extraível/, "páginas com imagem ou tabela sem texto extraível; confira o original"],
    [/limite de tempo/, "leitura interrompida pelo tempo da rodada; vale tentar ler de novo"],
  ];
  function pendenciaLegivel(v) {
    const textoPendencia = String(v);
    const nome = textoPendencia.split(":")[0];
    const motivo = MOTIVOS_LEITURA.find(([padrao]) => padrao.test(textoPendencia.slice(nome.length)));
    return motivo ? `${nome}: ${motivo[1]}` : nome;
  }
  function montar(resumo = {}, edital = {}, consideracoes = "") {
    const { est, itens, pncp } = preparar(resumo, edital);
    const campos = chave => Object.entries(CAMPOS[chave]?.campos || {}).map(([k, rotulo]) => ({rotulo, valor: k === "valorEstimado" ? valorEstimado(est[chave]?.[k], pncp.sigilo) : data(est[chave]?.[k])})).filter(c => c.valor);
    const livre = (rotulo, valor) => util(valor) ? [{rotulo, valor: util(valor)}] : [];
    const lista = (rotulo, valores) => {
      const itens = Array.isArray(valores) ? valores.map(util).filter(Boolean) : [];
      return itens.length ? [{rotulo, valor: [...new Set(itens)]}] : [];
    };
    const documentos = agruparDocumentos(est);
    const secoes = [
      ["Identificação da Licitação", [...livre("Objeto", est.identificacao.objeto), ...campos("identificacao"), ...pncp.identificacao, ...campos("dadosOficiais").filter(c => c.rotulo !== "Modalidade" || c.valor !== est.identificacao.modalidade)]],
      ["Informações da Sessão Pública", campos("sessaoPublica")],
      ["Órgão Responsável", campos("orgao")],
      ["CAPAG — situação fiscal do ente", camposCapag(est)],
      ["Detalhes da Licitação", [...campos("detalhes"), ...livre("Critério por item", pncp.criterioPorItem), ...livre("Conteúdo nacional", pncp.conteudoNacional)]],
      ["Seguro Garantia", campos("garantias")],
      ["Informações sobre entrega e execução", campos("entregaExecucao")],
      ["Prazos importantes", campos("prazos")],
      ["Critérios da Proposta e Julgamento", [...campos("criteriosProposta"), ...lista("Preparação e envio da proposta", est.requisitosProposta)]],
      ["Resumo dos Itens", [...campos("itens"), ...lista(`Itens da oportunidade (${itens.length})`, itens.map(linhaItem))]],
      ["Documentos de habilitação exigidos", [...lista("Credenciamento e participação", est.documentosCredenciamento), ...[...documentos].flatMap(([categoria, valores]) => lista(categoria, valores))]],
      ["Atestado de capacidade técnica", livre("Exigência", est.atestadoCapacidadeTecnica)],
      ["Legislação", livre("Base legal", est.legislacao)],
      ["Anexos e declarações", [...lista("Declarações e formulários", est.declaracoesExigidas), ...livre("Anexos e modelos citados", est.anexosDeclaracoes)]],
      ["Outras informações relevantes", [...livre("Informação complementar do órgão (PNCP)", pncp.informacaoComplementar), ...lista("Informações complementares", est.outrasInformacoesRelevantes)]],
      ["Condições de pagamento", livre("Pagamento", est.condicoesPagamento)],
      ["Penalidades e multas", [...livre("Penalidades", est.penalidades), ...livre("Multas", est.multas)]],
      ["Análise crítica", [...lista("Pontos de atenção (dados oficiais do PNCP)", pncp.atencao), ...campos("analiseCritica"), ...lista("Pendências para conferência", est.pendenciasParaConferencia), ...lista("Possíveis questionamentos", est.possiveisQuestionamentos), ...lista("Perguntas sugeridas ao órgão", est.questionamentosSugeridos)]],
      ...(est.coberturaSintese || est.coberturaLeitura ? [["Cobertura da análise", camposCobertura(est)]] : []),
      ["Análise e Considerações do Licitante", livre("Considerações do licitante", consideracoes)],
    ].map(([titulo, valores]) => ({titulo, campos: valores}));
    return { numero: est.identificacao.numero, objeto: est.identificacao.objeto,
      cards: [["Valor estimado", est.detalhes.valorEstimado || "Não informado"], ["Modalidade", est.identificacao.modalidade || "Não informado"], ["Data da sessão", data(est.sessaoPublica?.data) || "Não informado"]], secoes };
  }
  function agruparDocumentos(est) {
    const documentos = new Map();
    for (const item of Array.isArray(est.documentosHabilitacao) ? est.documentosHabilitacao : []) {
      const categoria = util(item?.categoria) || "Documentos exigidos";
      if (!documentos.has(categoria)) documentos.set(categoria, []);
      documentos.get(categoria).push(item);
    }
    return documentos;
  }
  function camposCapag(est) {
    if (!est.capag) return [{ rotulo: "CAPAG", valor: "Consulta do ente responsável pendente." }];
    if (!est.capag.disponivel) return [{ rotulo: "CAPAG", valor: est.capag.motivo }];
    return [
      { rotulo: "Nota CAPAG", valor: est.capag.nota },
      ...(est.capag.indicadores || []).map((i) => ({ rotulo: `CAPAG — ${i.nome}`, valor: `${i.nota}${typeof i.valor === "number" ? ` · ${new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 2 }).format(i.valor)}` : " · valor não disponível"}` })),
      { rotulo: "Posição da CAPAG", valor: `${est.capag.posicao} · coletada em ${est.capag.coletadoEm}` },
      { rotulo: "Origem da nota", valor: est.capag.origemNota || "Prévia da CAPAG" },
      { rotulo: "Sobre a CAPAG", valor: est.capag.observacao },
      { rotulo: "Fonte CAPAG", valor: est.capag.fonte },
    ];
  }
  function camposCobertura(est) {
    const lista = (rotulo, valores) => {
      const itens = valores.map(util).filter(Boolean);
      return itens.length ? [{ rotulo, valor: [...new Set(itens)] }] : [];
    };
    return [
      // O motivo fica visível (antes só o nome): "download indisponível" pede nova leitura, "ilegível" pede o original.
      // O aviso de OCR já tem a própria lista; repeti-lo aqui contava o documento lido como não lido.
      ...(est.coberturaLeitura ? [{ rotulo: "Extração dos documentos", valor: `${est.coberturaLeitura.parcial !== false ? "Extração parcial" : "Documentos selecionados extraídos"}. ${est.coberturaLeitura.documentosLidos?.length || 0} documento(s) lido(s); ${pendentesLeitura(est.coberturaLeitura).length} não lido(s).` },
        ...lista("Documentos não lidos", pendentesLeitura(est.coberturaLeitura).map(pendenciaLegivel)),
        ...lista("Conferência do OCR automático", est.coberturaLeitura.avisosOCR || []),
        ...lista("Páginas pendentes do OCR", (est.coberturaLeitura.ocrDocumentos || []).flatMap((d) => (d.pendencias || []).map((p) => `${d.documento}: ${p}`)))] : []),
      ...(est.coberturaSintese ? [{ rotulo: "Síntese dos documentos", valor: Number.isFinite(est.coberturaSintese.caracteresEnviados) && Number.isFinite(est.coberturaSintese.caracteresFonte) ? `${est.coberturaSintese.parcial ? "Síntese parcial" : "Fonte extraída integral enviada à síntese"}: ${est.coberturaSintese.caracteresEnviados} de ${est.coberturaSintese.caracteresFonte} caracteres. Isso não equivale à auditoria de todas as cláusulas.` : "Cobertura da síntese por IA não confirmada. A extração documental não comprova uma síntese integral nem a auditoria de todas as cláusulas." }] : []),
      { rotulo: "Atualidade", valor: "Análise da versão armazenada. Confira retificações e novos anexos na fonte oficial antes de participar." },
    ];
  }
  function preparar(resumo, edital) {
    const est = {
      ...resumo,
      identificacao: { ...resumo.identificacao, numero: numeroLicitacao(resumo, edital), objeto: util(resumo.identificacao?.objeto) || util(edital.objeto), modalidade: util(resumo.identificacao?.modalidade) || util(edital.modalidade) },
      orgao: { ...resumo.orgao, nome: util(resumo.orgao?.nome) || util(edital.orgao) },
      dadosOficiais: { ...resumo.dadosOficiais, publicacao: util(resumo.dadosOficiais?.publicacao) || util(edital.publicacao), inicioRecebimento: util(resumo.dadosOficiais?.inicioRecebimento) || util(edital.inicioRecebimento), prazoFinal: util(resumo.dadosOficiais?.prazoFinal) || util(edital.encerramento) },
    };
    const itens = Array.isArray(est.itensPncp) ? est.itensPncp : [];
    const pncp = oficiaisPncp(edital, itens);
    // A leitura do edital pela IA costuma trazer mais detalhe (ex.: percentual da cota),
    // então o dado do PNCP só preenche o que ela deixou vazio.
    est.detalhes = { ...est.detalhes,
      valorEstimado: valorEstimado(util(est.detalhes?.valorEstimado) || util(edital.valor), pncp.sigilo),
      preferenciaMeEpp: util(est.detalhes?.preferenciaMeEpp) || pncp.preferenciaMeEpp,
      margemPreferencia: util(est.detalhes?.margemPreferencia) || pncp.margemPreferencia,
      criterioJulgamento: util(est.detalhes?.criterioJulgamento) || pncp.criterioUnico,
    };
    return { est, itens, pncp };
  }
  const NAO_INFORMADO = "Não informado";
  // Garantia: o título da caixa diz se o edital exige ou não; sem texto, não se presume nada.
  function situacaoGarantia(valor) {
    const t = util(valor);
    if (!t) return "";
    return /^(?:n[ãa]o\b|sem\b|dispensad|inexig)|n[ãa]o (?:ser[áa] |é |h[áa] )?(?:exigid|exig[êe]ncia|necess|prevista)|dispensad/i.test(t) ? "Não exige" : "Exige";
  }
  // Dias corridos entre hoje e a primeira data dd/mm/aaaa do texto (negativo = já passou).
  function diasAte(texto, hoje = new Date()) {
    const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(texto || "");
    if (!m) return null;
    const alvo = Date.UTC(+m[3], +m[2] - 1, +m[1]);
    const base = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    return Math.round((alvo - base) / 86400000);
  }
  function textoDias(dias) {
    if (dias == null) return "";
    if (dias === 0) return "Hoje";
    if (dias > 0) return dias === 1 ? "Amanhã" : `Em ${dias} dias`;
    return dias === -1 ? "Ontem" : `Há ${-dias} dias`;
  }
  // Texto corrido com vários itens ("a; b" ou um por linha) vira lista, como na referência.
  function partes(valor) {
    if (Array.isArray(valor)) return valor.flatMap(partes);
    const t = util(valor);
    return t ? t.split(/\s*(?:\n|;\s+)\s*/).map(s => s.replace(/^[-•]\s*/, "").trim()).filter(Boolean) : [];
  }
  const textos = valor => Array.isArray(valor) ? valor.map(texto) : valor;
  // Ficha na estrutura do ConLicitação (19 seções, mesma ordem). Campos da referência sempre
  // aparecem ("Não informado" quando vazios); campos nossos a mais só quando preenchidos.
  // Usada na gaveta do painel e no checklist .docx; e-mail e impressão continuam em montar().
  function montarFicha(resumo = {}, edital = {}, consideracoes = "", hoje = new Date()) {
    const { est, itens, pncp } = preparar(resumo, edital);
    const r = (rotulo, valor, extra) => ({ rotulo, valor: data(valor) || NAO_INFORMADO, ...extra });
    const o = (rotulo, valor) => data(valor) ? [{ rotulo, valor: data(valor) }] : [];
    const l = (rotulo, valores, sempre, extra) => {
      const lista = [...new Set(partes(textos(valores)))];
      return lista.length ? [{ rotulo, valor: lista, ...extra }] : sempre ? [{ rotulo, valor: NAO_INFORMADO, ...extra }] : [];
    };
    const sem = { semRotulo: true };
    const id = est.identificacao, sessao = est.sessaoPublica || {}, orgao = est.orgao || {}, det = est.detalhes;
    const ent = est.entregaExecucao || {}, pz = est.prazos || {}, crit = est.criteriosProposta || {}, it = est.itens || {}, ac = est.analiseCritica || {};
    const oficiais = est.dadosOficiais || {};
    const dataSessao = data(sessao.data) || data(oficiais.prazoFinal);
    const horario = data(sessao.horario) || (/às (\d{2}:\d{2})/.exec(dataSessao) || [])[1];
    const modoDisputa = util(sessao.modoDisputa) || util(oficiais.modoDisputa) || util(edital.modoDisputa);
    const local = [util(edital.municipio), util(edital.uf)].filter(Boolean).join("/");
    const nomeOrgao = util(orgao.nome) && local && !util(orgao.nome).includes(util(edital.municipio) || local) ? `${util(orgao.nome)} — ${local}` : util(orgao.nome);
    const linkPortal = [util(edital.linkSistemaOrigem), util(id.portalRealizacao), util(edital.link)].find(v => /^https?:\/\//i.test(v)) || "";
    const portal = util(id.portalRealizacao) && !/^https?:\/\//i.test(util(id.portalRealizacao)) ? util(id.portalRealizacao) : util(edital.plataforma) || linkPortal;
    const recursos = [data(pz.prazoRecurso), data(pz.prazoContrarrazoes)].filter(Boolean);
    const recursosTexto = recursos.length === 2 && recursos[0] !== recursos[1] ? `Recurso: ${recursos[0]}\nContrarrazões: ${recursos[1]}` : recursos[0];
    const garantia = (chave, nome) => {
      const situacao = situacaoGarantia(est.garantias?.[chave]);
      return r(situacao ? `${situacao} ${nome}` : nome, est.garantias?.[chave], { situacao });
    };
    const habilitacao = [...l("Credenciamento e participação", est.documentosCredenciamento), ...[...agruparDocumentos(est)].flatMap(([categoria, valores]) => l(categoria, valores))];
    const questionamentos = [...l("Possíveis questionamentos", est.possiveisQuestionamentos), ...l("Perguntas sugeridas ao órgão", est.questionamentosSugeridos)];
    const secoes = [
      ["identificacao", "Identificação da Licitação", "file-text", [r("Objeto", id.objeto, { longo: true }), r("Número da licitação", id.numero), r("Modalidade", id.modalidade), r("UASG", id.uasg || edital.uasg),
        r("Portal de realização", portal, linkPortal ? { link: linkPortal } : {}), r("Contratação", id.contratacao), r("Regulamentação", id.regulamentacao || edital.amparoLegal),
        ...pncp.identificacao.filter(c => !["Plataforma da disputa", "Link da disputa"].includes(c.rotulo)),
        ...o("Publicado em", oficiais.publicacao), ...o("Início do recebimento de propostas", oficiais.inicioRecebimento), ...o("Regime de execução", oficiais.regimeExecucao)]],
      ["sessao", "Informações da Sessão Pública", "calendar", [r("Data", dataSessao), r("Modo de Disputa", modoDisputa), r("Horário", horario), r("Intervalo mínimo", sessao.intervaloMinimo)]],
      ["orgao", "Órgão Responsável", "buildings", [r("Órgão", nomeOrgao), r("Endereço", orgao.endereco), r("E-mail", partes(orgao.email).join("\n").replace(/\s*,\s*/g, "\n")), r("Telefone", orgao.telefone)]],
      ["detalhes", "Detalhes da Licitação", "clipboard-text", [r("Valor estimado / orçamento", det.valorEstimado), r("Critério de julgamento", det.criterioJulgamento), r("Prazo de entrega", det.prazoEntrega || ent.prazo),
        r("Preferência ME/EPP", det.preferenciaMeEpp), r("Margem de preferência", det.margemPreferencia), r("Restrições de regionalidade", det.restricoesRegionalidade),
        r("Exigência de visita técnica", det.exigeVisitaTecnica), r("Exigência de prova de conceito", det.provaConceito), r("Exigência de amostra", det.exigeAmostra),
        ...o("Garantia", det.garantia), ...o("Tipo de análise", det.tipoAnalise), ...o("Regime de execução", det.regimeExecucao), ...o("Critério por item", pncp.criterioPorItem), ...o("Conteúdo nacional", pncp.conteudoNacional)]],
      ["garantias", "Seguro Garantia", "shield-check", [garantia("proposta", "Garantia de Proposta"), garantia("contrato", "Garantia de Contrato"), garantia("adicional", "Garantia Adicional"), garantia("retomada", "Garantia de Retomada")]],
      ["entrega", "Informações sobre entrega e execução", "calendar", [r("Data", ent.prazo || det.prazoEntrega), r("Local de entrega ou da execução", ent.local), ...o("Condições de execução", ent.condicoes)]],
      ["prazos", "Prazos importantes", "calendar", [r("Tipo de fornecimento", pz.tipoFornecimento), r("Prazo para manifestação de recurso", pz.prazoManifestacaoRecurso), r("Prazo para envio de documentação complementar", pz.prazoDocumentoComplementar),
        r("Prazo para recursos e contrarrazões", recursosTexto), r("Prazo para envio de documento original", pz.prazoDocumentoOriginal), r("Esclarecimentos", pz.limiteEsclarecimentos),
        r("Prazo contratual ou ARP", pz.prazoContratualArp), r("Limite para impugnação", pz.limiteImpugnacao), r("Limite para envio de propostas", pz.limiteEnvioPropostas || oficiais.prazoFinal),
        r("Prazo de vigência do contrato ou ata", pz.vigenciaContrato)]],
      ["criterios", "Critérios da Proposta e Julgamento", "scales", [r("Validade da proposta", crit.validadeProposta), r("Critérios de desempate", crit.criteriosDesempate), r("Exigências da proposta comercial", crit.exigenciasPropostaComercial),
        r("Programa de Integridade", crit.programaIntegridade, { acao: "integridade" }), ...o("Propostas/lances por", crit.propostasLancesPor), ...l("Preparação e envio da proposta", est.requisitosProposta)]],
      ["itens", "Resumo dos Itens", "package", [r("Total de Itens", it.totalItens || (itens.length ? String(itens.length) : "")), r("Descrição Geral", it.descricaoGeral), r("Categorias principais", it.categoriasPrincipais), r("Observações", it.observacoes),
        ...(itens.length ? [{ rotulo: `Itens da oportunidade (${itens.length})`, valor: itens.map(linhaItem) }] : [])]],
      ["habilitacao", "Documentos de habilitação exigidos", "files", habilitacao.length ? habilitacao : [r("Documentos exigidos", "", sem)]],
      ["atestado", "Atestado de capacidade técnica", "seal-check", [r("Exigência", est.atestadoCapacidadeTecnica, sem)]],
      ["legislacao", "Legislação", "gavel", l("Base legal", est.legislacao, true, sem)],
      ["anexos", "Anexos e declarações", "paperclip", l("Anexos e declarações", [...partes(textos(est.declaracoesExigidas)), ...partes(est.anexosDeclaracoes)], true, sem)],
      ["outras", "Outras informações relevantes", "info", [...o("Informação complementar do órgão (PNCP)", pncp.informacaoComplementar), ...l("Informações complementares", est.outrasInformacoesRelevantes, !pncp.informacaoComplementar, sem)]],
      ["pagamento", "Condições de pagamento", "coins", [r("Pagamento", est.condicoesPagamento, sem)]],
      ["penalidades", "Penalidades e multas", "x-circle", l("Penalidades e multas", [...partes(est.penalidades), ...partes(est.multas)], true, sem)],
      ["questionamentos", "Possíveis questionamentos", "warning", questionamentos.length ? questionamentos : [r("Possíveis questionamentos", "Nenhum ponto identificado nesta análise. Isso não confirma ausência de problemas.", sem)], { destaque: true }],
      ["critica", "Análise crítica", "warning", [r("Conflito objeto / minuta", ac.conflitoObjetoMinuta), r("Conflito prazo de vigência / ARP", ac.conflitoPrazoVigenciaArp), r("Conflito prazos de entrega", ac.conflitoPrazosEntrega),
        r("Permite subcontratação", ac.permiteSubcontratacao), r("Previsão de reajuste / repactuação", ac.previsaoReajuste), r("Permite renovação de contrato", ac.permiteRenovacao),
        r("Estabelece condições de pagamento", ac.estabeleceCondicoesPagamento), ...l("Pontos de atenção (dados oficiais do PNCP)", pncp.atencao), ...l("Pendências para conferência", est.pendenciasParaConferencia)], { destaque: true }],
      ["consideracoes", "Análise e Considerações do Licitante", "star", [r("Considerações do licitante", consideracoes, sem)]],
      // Apoio (fora das 19): CAPAG e cobertura da leitura ficam discretos no fim.
      ["capag", "CAPAG — situação fiscal do ente", "bank", camposCapag(est), { apoio: true }],
      ...(est.coberturaSintese || est.coberturaLeitura ? [["cobertura", "Cobertura da análise", "info", camposCobertura(est), { apoio: true }]] : []),
    ].map(([chave, titulo, icone, campos, extra]) => ({ id: chave, titulo, icone, campos, ...extra }));
    const dias = diasAte(dataSessao, hoje);
    return {
      numero: id.numero, objeto: id.objeto, controlePncp: util(edital.numeroControlePNCP),
      cartoes: {
        valor: det.valorEstimado || "Valor global não informado no edital",
        modalidade: id.modalidade || NAO_INFORMADO, modoDisputa,
        data: dataSessao ? dataSessao.replace(/ às .*/, "") : NAO_INFORMADO, dias: textoDias(dias),
      },
      secoes,
    };
  }
  // Gaveta do painel: a ficha das 19 seções; o que é consulta longa (itens, indicadores da
  // CAPAG, trechos integrais, complementos da leitura integral) vai recolhido para o fim.
  function montarVisual(resumo = {}, edital = {}, consideracoes = "", hoje = new Date()) {
    const integral = montarFicha(resumo, edital, consideracoes, hoje);
    const sintetica = resumo.estruturaSintetica;
    const modelo = sintetica && typeof sintetica === "object" && !Array.isArray(sintetica)
      ? montarFicha({ ...sintetica, capag: resumo.capag, itensPncp: resumo.itensPncp, coberturaLeitura: resumo.coberturaLeitura, coberturaSintese: resumo.coberturaSintese }, edital, consideracoes, hoje)
      : integral;
    const recolhidas = [];
    const recolher = (titulo, campos) => { if (campos.length) recolhidas.push({ titulo, campos, recolhida: true, apoio: true }); };
    modelo.secoes = modelo.secoes.map(secao => {
      if (secao.id === "capag") {
        const principais = secao.campos.filter(c => ["Nota CAPAG", "CAPAG", "Posição da CAPAG", "Fonte CAPAG"].includes(c.rotulo));
        recolher("Entender a CAPAG e consultar indicadores", secao.campos.filter(c => !principais.includes(c)));
        return { ...secao, campos: principais };
      }
      if (secao.id === "itens") {
        recolher("Consultar itens da oportunidade", secao.campos.filter(c => c.rotulo.startsWith("Itens da oportunidade")));
        return { ...secao, campos: secao.campos.filter(c => !c.rotulo.startsWith("Itens da oportunidade")) };
      }
      const extensos = secao.campos.filter(c => JSON.stringify(c.valor).length > 1800);
      if (!extensos.length) return secao;
      recolher(`Conferir trechos integrais — ${secao.titulo}`, extensos);
      return { ...secao, campos: secao.campos.map(c => extensos.includes(c) ? { ...c, valor: "Conteúdo documental extenso: consulte os trechos integrais na seção de conferência abaixo antes de decidir." } : c) };
    });
    if (modelo !== integral) {
      recolher("Conferir complementos e evidências documentais", integral.secoes.flatMap(secao => {
        const principais = modelo.secoes.find(s => s.titulo === secao.titulo)?.campos || [];
        return secao.campos.filter(c => c.valor !== NAO_INFORMADO && !principais.some(p => p.rotulo === c.rotulo && JSON.stringify(p.valor) === JSON.stringify(c.valor)))
          .filter(c => !c.rotulo.startsWith("Itens da oportunidade") && secao.id !== "capag" && secao.id !== "consideracoes")
          .map(c => ({ rotulo: `${secao.titulo} — ${c.rotulo}`, valor: c.valor }));
      }));
    }
    modelo.secoes.push(...recolhidas);
    return modelo;
  }
  const api = { montar, montarFicha, montarVisual, situacaoGarantia, diasAte, texto, util, pendentesLeitura };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.ResumoModelo = api;
})(globalThis);
