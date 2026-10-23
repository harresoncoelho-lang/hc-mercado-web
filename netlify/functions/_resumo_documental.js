const { createHash } = require("node:crypto");
const { clausulasDaFonte, paginasDaFonte } = require("./_edital_operacional");

const referencia = (e) => `[${e.documento}${e.pagina ? `, página ${e.pagina}` : ""}${e.numero ? `, cláusula ${e.numero}` : ""}]`;
const citado = (e) => `${e.texto} ${referencia(e)}`;

function conferirFatosDocumentais(dossie) {
  const est = dossie.estrutura, fonte = dossie.textoEdital;
  dossie.hashFonte = createHash("sha256").update(fonte).digest("hex");
  est.hashFonte = dossie.hashFonte;
  const clausulas = clausulasDaFonte(fonte);
  const paginas = paginasDaFonte(fonte);
  const comCondicoes = (item) => {
    const partes = [citado(item)];
    let numero = item.numero;
    while (numero.includes(".")) {
      numero = numero.split(".").slice(0, -1).join(".");
      const pais = clausulas.filter((c) => c.documento === item.documento && c.numero === numero);
      if (pais.length === 1 && /\b(?:se|caso|quando|apenas|somente|vencedor|vencedora)\b|ME\s*\/\s*EPP/i.test(pais[0].texto)) partes.push(`Condição de aplicação: ${citado(pais[0])}`);
    }
    return partes.join("\n");
  };
  const textoItem = (item) => typeof item === "string" ? item : item?.texto || "";
  const juntarSemApagar = (atual, itens) => {
    const partes = atual && !/^n[aã]o informado$/i.test(atual.trim()) ? [atual] : [];
    for (const item of itens) if (!partes.some((parte) => parte.includes(item.texto))) partes.push(citado(item));
    return partes.join("\n");
  };
  // shortcut: recupera cláusulas numeradas e títulos de anexos; documentos sem essa estrutura ainda exigem revisão semântica.
  for (const [campo, titulo] of [
    ["documentosHabilitacao", /habilita[cç][aã]o|regularidade fiscal|qualifica[cç][aã]o t[eé]cnica|econ[oô]mico.?financeira/i],
    ["declaracoesExigidas", /declara[cç][oõ]es exigidas|declara[cç][oõ]es obrigat[oó]rias/i],
  ]) {
    const existentes = Array.isArray(est[campo]) ? est[campo] : [];
    for (const item of clausulas.filter((c) => c.numero.includes(".") && titulo.test(c.secao))) {
      const indice = existentes.findIndex((existente) => textoItem(existente).includes(item.texto));
      if (indice < 0) existentes.push(comCondicoes(item));
      else {
        const condicoes = comCondicoes(item).split("\n").slice(1).filter((condicao) => !textoItem(existentes[indice]).includes(condicao));
        if (condicoes.length) {
          const texto = [textoItem(existentes[indice]), ...condicoes].join("\n");
          existentes[indice] = typeof existentes[indice] === "string" ? texto : { ...existentes[indice], texto };
        }
      }
    }
    if (existentes.length) est[campo] = existentes;
  }
  const sancoes = clausulas.filter((c) => c.numero.includes(".") && /san[cç][oõ]es|penalidades|infra[cç][oõ]es/i.test(c.secao));
  if (sancoes.length) est.penalidades = juntarSemApagar(est.penalidades, sancoes);
  const anexos = paginas.flatMap((p) => p.texto.split(/\s+(?=ANEXO\s+[IVX\d]+\b)/i)
    .filter((linha) => /^ANEXO\s+[IVX\d]+\s*[-–:.]/i.test(linha.trim()))
    .map((linha) => ({ ...p, texto: linha.trim() })));
  if (anexos.length) est.anexosDeclaracoes = juntarSemApagar(est.anexosDeclaracoes, anexos);
  const cadastroReserva = paginas.filter((p) => /Cadastro Reserva/i.test(p.texto) && /CNPJ/i.test(p.texto) && /fornecedor/i.test(p.texto))
    .map((p) => ({ ...p, texto: `Folha de cadastro reserva: ${p.texto.trim()}` }));
  if (cadastroReserva.length) est.anexosDeclaracoes = juntarSemApagar(est.anexosDeclaracoes, cadastroReserva);
  const parcelamento = paginas.flatMap((p) => {
    const trecho = p.texto.match(/(?:^|\s)\d+\s*[-–—]\s*JUSTIFICATIVA PARA PARCELAMENTO\b[\s\S]*?(?=\s+\d+\s*[-–—]|$)/i)?.[0];
    return trecho ? [{ ...p, texto: `Contexto de planejamento — parcelamento: ${trecho.trim()}` }] : [];
  });
  est.outrasInformacoesRelevantes = [...new Set([...(est.outrasInformacoesRelevantes || []), ...parcelamento.map(citado)])];
  const eventos = [
    ["proposta", /(?:data e hora final das propostas|limite para (?:envio|recebimento) de propostas)\s*:\s*(\d{2}\/\d{2}\/\d{4})\s*(?:[àa]s)?\s*(\d{1,2}:\d{2})/i],
    ["sessao", /sess[aã]o p[uú]blica\s*:\s*(\d{2}\/\d{2}\/\d{4})\s*(?:[àa]s)?\s*(\d{1,2}:\d{2})/i],
  ];
  for (const [tipo, padrao] of eventos) {
    const evidencias = paginas.map((p) => ({ p, m: p.texto.match(padrao) })).filter((e) => e.m);
    const valores = new Set(evidencias.map(({ m }) => `${m[1]} às ${m[2]}`));
    if (valores.size !== 1) continue;
    const { p, m } = evidencias[0];
    if (tipo === "proposta") {
      const prazo = `${m[1]} às ${m[2]} ${referencia(p)}`;
      est.prazos = { ...est.prazos, limiteEnvioPropostas: prazo };
      est.prazosDocumentais = { ...est.prazosDocumentais, proposta: prazo };
    }
    else est.sessaoPublica = { ...est.sessaoPublica, data: m[1], horario: `${m[2]} (horário documental) ${referencia(p)}` };
  }
  const certidoes = [/certid[aã]o (?:negativa )?de insolv[eê]ncia civil/i, /certid[aã]o (?:negativa )?de fal[eê]ncia/i];
  if (Array.isArray(est.documentosHabilitacao)) est.documentosHabilitacao = est.documentosHabilitacao.map((item) => {
    const texto = typeof item === "string" ? item : item?.texto || "";
    const tema = certidoes.find((t) => t.test(texto));
    if (!tema) return item;
    const fontes = clausulas.filter((c) => tema.test(c.texto));
    if (!fontes.length) return item;
    const completo = [...new Set(fontes.map(comCondicoes))].join("\n");
    return typeof item === "string" ? completo : { ...item, texto: completo };
  });
  const pagamentos = clausulas.filter((c) => /pagamento|liquida[cç][aã]o/i.test(c.secao) || /pagamento ser[aá] efetuado|prazo de \d+(?:\s*\([^)]*\))? dias [uú]teis para (?:fins de )?liquida[cç][aã]o/i.test(c.texto));
  if (pagamentos.length) est.condicoesPagamento = juntarSemApagar(est.condicoesPagamento, pagamentos);
  const entregas = clausulas.flatMap((item) => {
    if (!/^\d+(?:\.\d+)+\.\s*Entrega\s*:\s*\d+/i.test(item.texto)) return [];
    const pai = item.numero.split('.').slice(0, -1).join('.');
    const pais = clausulas.filter(c => c.documento === item.documento && c.numero === pai && /prazo.*(?:execu[cç][aã]o|entrega).*(?:objeto|materiais|bens|produtos)/i.test(c.texto) && !/amostra|proposta|ficha t[eé]cnica/i.test(c.texto));
    return pais.length === 1 ? [{ item, pai: pais[0] }] : [];
  });
  if (entregas.length) {
    const prazosEntrega = entregas.flatMap(({ item, pai }) => [pai, item]);
    const locaisEntrega = clausulas.filter(c => entregas.some(({ pai }) => c.documento === pai.documento && c.numero.split('.')[0] === pai.numero.split('.')[0]) && /local (?:para (?:a )?|de )entrega/i.test(c.texto) && !/amostra|proposta|ficha t[eé]cnica/i.test(c.texto));
    est.entregaExecucao = { ...est.entregaExecucao, prazo: juntarSemApagar(est.entregaExecucao?.prazo, prazosEntrega), local: juntarSemApagar(est.entregaExecucao?.local, locaisEntrega) || 'Não informado', condicoes: juntarSemApagar(est.entregaExecucao?.condicoes, [...prazosEntrega, ...locaisEntrega]) };
    est.detalhes = { ...est.detalhes, prazoEntrega: est.entregaExecucao.prazo };
  }
  // Uma síntese curta não substitui condições operacionais expressas na fonte.
  const substantivas = clausulas.filter((c) => c.numero.includes(".") && !c.numero.endsWith(".0"));
  const recuperar = (campo, itens) => {
    if (!itens.length) return;
    const [pai, filho] = campo.split(".");
    if (filho) est[pai] = { ...est[pai], [filho]: itens.map(citado).join("\n") };
    else est[pai] = itens.map(citado).join("\n");
  };
  const preferencia = substantivas.filter((c) => /tratamento diferenciado|ME\s*\/\s*EPP/i.test(c.secao));
  recuperar("detalhes.preferenciaMeEpp", preferencia);
  recuperar("analiseCritica.previsaoReajuste", substantivas.filter((c) => /reajustamento|reajuste/i.test(c.secao)));
  recuperar("prazos.vigenciaContrato", substantivas.filter((c) => /vig[eê]ncia da (?:presente contrata[cç][aã]o|contrata[cç][aã]o|contrato)/i.test(c.texto)));
  const complementos = substantivas.filter((c) => /emitir nota fiscal|manter,? durante a vig[eê]ncia|compensa[cç][aã]o financeira/i.test(c.texto));
  const avisos = paginas.filter((p) => /aviso.*contrata[cç][aã]o|aviso.*dispensa/i.test(p.documento) && /propostas/i.test(p.texto));
  est.outrasInformacoesRelevantes = [...new Set([...(est.outrasInformacoesRelevantes || []), ...complementos.map(citado), ...avisos.map(citado)])];
  for (const p of avisos) {
    const dispensa = p.texto.match(/(DISPENSA DE LICITA[ÇC][ÃA]O)\s+N[º°o]\s*([A-Z\d./-]+)/i);
    if (dispensa) est.identificacao = { ...est.identificacao, modalidade: `${dispensa[1]} ${referencia(p)}`, numero: `${dispensa[2]} ${referencia(p)}` };
    const prazo = p.texto.match(/recebendo\s+(?:as\s+)?propostas[^;]+?(?:horas|h\b)/i)?.[0];
    if (prazo) est.prazos = { ...est.prazos, limiteEnvioPropostas: `${prazo} ${referencia(p)}` };
    const email = p.texto.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
    if (email) est.orgao = { ...est.orgao, email: `${email} (canal indicado no aviso; conferir finalidade no trecho) ${referencia(p)}` };
  }
  const tabelas = paginas.flatMap((p) => {
    const tabela = p.texto.match(/C[ÓO]DIGO\s+DESCRI[ÇC][ÃA]O[\s\S]*?(?=\s+\d+\.\d+\.\s*[A-ZÀ-Ý]|$)/i)?.[0];
    return tabela ? [{ ...p, texto: tabela.trim() }] : [];
  });
  recuperar("itens.observacoes", tabelas);
  const pontos = [];
  const regras = pagamentos.filter((c) => /pagamento ser[aá] efetuado/i.test(c.texto));
  const prazos = new Set(regras.map((c) => c.texto.match(/(?:at[eé]|prazo de)\s*(\d+)/i)?.[1]).filter(Boolean));
  if (prazos.size > 1) pontos.push({ id: "pagamento", tipo: "pagamento", titulo: "Conferir as regras de pagamento", descricao: "Há regras de pagamento com prazos ou marcos diferentes. Confirme o alcance de cada uma com o órgão.", pergunta: "Qual regra de pagamento deve prevalecer e qual é seu marco inicial, considerando os trechos citados?", evidencias: regras.slice(0, 6) });
  const objeto = clausulas.find((c) => /(?:aquisi[cç][aã]o|fornecimento).*(?:m[oó]veis|mobili[aá]rio|materiais permanentes|eletrodom[eé]sticos)/i.test(c.texto) && /objeto/i.test(c.secao));
  const alimentos = clausulas.filter((c) => /(?:experi[eê]ncia|capacidade t[eé]cnica).*ramo aliment[ií]cio|produtos perec[ií]veis carnes/i.test(c.texto));
  if (objeto && alimentos.length) pontos.push({ id: "objeto", tipo: "objeto", titulo: "Conferir exigências de alimentos no termo de referência", descricao: "O objeto trata de materiais permanentes, mas há exigências referentes a alimentos. Confirme se são aplicáveis ou erro de redação.", pergunta: "As exigências referentes a alimentos citadas abaixo se aplicam ao objeto desta compra? Em caso negativo, será publicada correção?", evidencias: [objeto, ...alimentos.slice(0, 3)] });
  const restricoes = avisos.filter((p) => /restrita\s+[àa]\s+participa[cç][aã]o/i.test(p.texto));
  if (restricoes.length) {
    recuperar("detalhes.preferenciaMeEpp", [...preferencia, ...restricoes]);
    if (preferencia.some((c) => /preferencialmente/i.test(c.texto))) pontos.push({ id: "participacao", tipo: "participacao", titulo: "Confirmar alcance da participação ME/EPP", descricao: "O aviso usa participação restrita e o TR usa preferencialmente. Confirme o alcance das duas redações com o órgão.", pergunta: "A participação é exclusiva para ME/EPP e equiparados diante de restrita no aviso e preferencialmente no TR?", evidencias: [...preferencia, ...restricoes] });
  }
  est.questionamentosDocumentais = pontos.map((p) => ({ ...p, estado: "precisa_conferir", evidencias: p.evidencias.map(({ documento, pagina, numero, texto }) => ({ documento, pagina, numero, texto })) }));
  return dossie;
}

module.exports = { conferirFatosDocumentais };
