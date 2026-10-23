const normalizar = (texto) => String(texto || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const LISTAS = ["documentosCredenciamento", "documentosHabilitacao", "requisitosProposta", "declaracoesExigidas"];
const TEMAS = [/certificado(?:s)? digital(?:is)?/, /falencia/, /recuperacao judicial/];
const { conferirFatosDocumentais } = require("./_resumo_documental");
const { validarFatosDaFonte, completarDossieDaFonte } = require("./_edital_operacional");
const { clausulasComEscopo, escopoDaReferencia } = require("./_referencias_documentais");

function associarEvidenciasQuestionamentos(estrutura, fonte) {
  const clausulas = clausulasComEscopo(fonte);
  const sugestoes = [...new Set([...(estrutura.possiveisQuestionamentos || []), ...(estrutura.questionamentosSugeridos || [])].filter((v) => typeof v === "string"))];
  return sugestoes.map((texto) => {
    const referencias = [];
    for (const m of texto.matchAll(/\b(?:item|itens|subitem|subitens|cl[aá]usulas?)\s+(\d+(?:\.\d+)*(?:\s*(?:,|;|e|ou)\s*\d+(?:\.\d+)*)*)/gi)) {
      if (/^\s+a\s+\d/.test(texto.slice(m.index + m[0].length))) continue;
      const escopo = escopoDaReferencia(texto, m.index, m.index + m[0].length);
      for (const numero of m[1].match(/\d+(?:\.\d+)*/g)) referencias.push({ numero, escopo });
    }
    const evidencias = [], pendentes = [];
    for (const { numero, escopo } of referencias) {
      const candidatos = clausulas.filter((c) => c.numero === numero && (!escopo || c.escopoDocumento === escopo));
      if (candidatos.length === 1) {
        const { documento, pagina, texto: trecho, escopoDocumento } = candidatos[0];
        if (!evidencias.some(e => e.documento === documento && e.pagina === pagina && e.numero === numero && e.escopoDocumento === escopoDocumento)) evidencias.push({ documento, pagina, numero, texto: trecho, ...(escopoDocumento ? { escopoDocumento } : {}) });
      } else pendentes.push(numero);
    }
    return { texto, evidencias, ...(pendentes.length || !referencias.length ? { motivo: pendentes.length ? `Referência não localizada de forma inequívoca na fonte: ${pendentes.join(", ")}. Confira o documento oficial.` : "A sugestão não indica item, subitem ou cláusula verificável; nenhuma prova foi atribuída automaticamente." } : {}) };
  });
}

// shortcut: bloqueia os temas sem suporte encontrados na auditoria; não substitui revisão semântica de todas as cláusulas.
function conferirEvidenciasDoResumo(dossie) {
  if (!dossie?.textoEdital || !dossie?.estrutura) return dossie;
  const resultado = globalThis.structuredClone(dossie);
  const estrutura = resultado.estrutura;
  const anterior = estrutura.estruturaSintetica;
  const sintetica = globalThis.structuredClone(anterior && typeof anterior === "object" && !Array.isArray(anterior) ? anterior : estrutura);
  delete sintetica.estruturaSintetica;
  const fonte = normalizar(resultado.textoEdital);
  const fonteSemMarcadores = normalizar(resultado.textoEdital.replace(/\[[^\]]+\]/g, ""));
  const compativel = ["mistral", "openrouter", "cloudflare"].includes(resultado.provedorIA);
  const enviados = compativel ? Math.min(resultado.textoEdital.length, 200000) : resultado.textoEdital.length;
  if (resultado.provedorIA) estrutura.coberturaSintese = { ...estrutura.coberturaSintese, parcial: enviados < resultado.textoEdital.length, caracteresFonte: resultado.textoEdital.length, caracteresEnviados: enviados };
  const removidas = resultado.validacaoExigencias?.removidas || [];
  for (const alvo of [estrutura, sintetica]) for (const campo of LISTAS) {
    if (!Array.isArray(alvo[campo])) continue;
    alvo[campo] = alvo[campo].filter((item) => {
      const texto = typeof item === "string" ? item : item?.texto;
      const semFonte = TEMAS.filter((tema) => tema.test(normalizar(texto)) && !tema.test(fonte));
      if (!semFonte.length) return true;
      if (alvo === estrutura) removidas.push({ campo, texto, motivo: "Tema da exigência não localizado no texto oficial lido" });
      return false;
    });
  }
  if (removidas.length) resultado.validacaoExigencias = { metodo: "temas_sem_suporte_na_fonte", removidas };
  const observacoes = [estrutura.resumoGeral, ...(estrutura.pendenciasParaConferencia || [])].map(normalizar);
  if (observacoes.some((texto) => /(?:apenas|somente|so) (?:o |um |os )?(?:extrato\/?aviso|extrato|aviso)\b/.test(texto))) {
    estrutura.coberturaLeitura = { ...estrutura.coberturaLeitura, parcial: true, editalIntegralAusente: true };
  }
  // Transcrições recuperáveis continuam no dossiê integral, sem fingir uma nova síntese de IA.
  if (Array.isArray(sintetica.outrasInformacoesRelevantes)) sintetica.outrasInformacoesRelevantes = sintetica.outrasInformacoesRelevantes.filter((item) => {
    if (typeof item === "string") {
      const numero = item.match(/^(\d+(?:\.\d+)*)(?:\.\s*|\s+)[A-Za-zÀ-ÿ]/)?.[1];
      const referencias = [...item.matchAll(/,\s*cl[aá]usula\s+(\d+(?:\.\d+)*)\]/gi)].map((m) => m[1]);
      if (numero && referencias.includes(numero)) return false;
    }
    const texto = normalizar(typeof item === "string" ? item.replace(/\[[^\]]+\]/g, "").replace(/^Minuta contratual:\s*/i, "") : item?.texto);
    return texto.length < 40 || !fonteSemMarcadores.includes(texto);
  });
  sintetica.avisoSintese = "Campos recebidos antes da complementação documental; a síntese não foi regenerada por IA. Transcrições identificáveis permanecem nas evidências integrais; dossiês antigos podem não conservar a redação original.";
  validarFatosDaFonte(sintetica, resultado.textoEdital, { campos: ["identificacao.modalidade", "identificacao.numero", "detalhes.valorEstimado"] });
  completarDossieDaFonte(estrutura, resultado.textoEdital);
  const conferido = conferirFatosDocumentais(resultado);
  validarFatosDaFonte(conferido.estrutura, conferido.textoEdital, { campos: ["identificacao.modalidade", "identificacao.numero", "detalhes.valorEstimado"] });
  // Condições corrigidas na conferência prevalecem sobre a redação anterior da IA.
  for (const campo of ["condicoesPagamento", "penalidades", "multas", "prazos", "sessaoPublica", "entregaExecucao", "garantias", "detalhes", "documentosHabilitacao", "declaracoesExigidas", "documentosCredenciamento", "requisitosProposta", "atestadoCapacidadeTecnica"]) {
    if (conferido.estrutura[campo] !== undefined) sintetica[campo] = globalThis.structuredClone(conferido.estrutura[campo]);
  }
  if (conferido.estrutura.condicoesPagamento) {
    const documental = conferirFatosDocumentais({ textoEdital: conferido.textoEdital, estrutura: {} }).estrutura;
    sintetica.condicoesPagamento = documental.condicoesPagamento || "Condições de pagamento não confirmadas nesta apresentação; consulte as evidências integrais.";
  }
  for (const campo of ["hashFonte", "coberturaLeitura", "coberturaSintese", "documentosConsultados"]) {
    if (conferido.estrutura[campo] !== undefined) sintetica[campo] = globalThis.structuredClone(conferido.estrutura[campo]);
  }
  conferido.estrutura.estruturaSintetica = sintetica;
  conferido.estrutura.evidenciasQuestionamentos = associarEvidenciasQuestionamentos(conferido.estrutura, conferido.textoEdital);
  conferido.estrutura.versaoReferenciasQuestionamentos = 2;
  return conferido;
}

module.exports = { conferirEvidenciasDoResumo };

