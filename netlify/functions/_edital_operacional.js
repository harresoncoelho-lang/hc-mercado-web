// Conserva as cláusulas operacionais da fonte: a síntese da IA não pode apagar
// documentos ou condições de participação porque acabou seu orçamento de tokens.
function limparLinhas(texto) {
  const linhas = texto.split(/\r?\n/).map((linha) => linha.replace(/[ \t]+/g, " ").trim());
  const repeticoes = new Map();
  for (const linha of linhas) if (linha) repeticoes.set(linha, (repeticoes.get(linha) || 0) + 1);
  return linhas.filter((linha) => !/^(Folha:|Código verificador:|A autenticidade deste documento|https:\/\/edoc\.)/i.test(linha) &&
    !(repeticoes.get(linha) >= 4 && !/^\d+[.)]|^\[Página|^---/.test(linha)));
}

function categoriaSecao(titulo) {
  if (/habilita[cç][aã]o|regularidade fiscal|qualifica[cç][aã]o t[eé]cnica|econ[oô]mico.?financeira/i.test(titulo)) return "documentosHabilitacao";
  if (/credenciamento|representa[cç][aã]o do licitante/i.test(titulo)) return "documentosCredenciamento";
  if (/proposta|cadastramento|amostra|cat[aá]logo|an[aá]lise da ficha|ficha t[eé]cnica|apresenta[cç][aã]o.*document/i.test(titulo)) return "requisitosProposta";
  if (/declara[cç][oõ][eẽ]s|declara[cç][aã]o|formul[aá]rio/i.test(titulo)) return "declaracoesExigidas";
  return null;
}

function clausulasDaFonte(texto) {
  const clausulas = [];
  let documento = "Documento oficial", pagina = "", atual;
  for (const linha of limparLinhas(texto)) {
    const doc = linha.match(/^--- (.+) ---$/);
    if (doc) { documento = doc[1]; pagina = ""; atual = null; continue; }
    const pg = linha.match(/^\[Página (\d+)\]$/);
    if (pg) { pagina = pg[1]; continue; }
    const numero = linha.match(/^(\d+(?:\.\d+)*)(?:\.|\s*[-–])?\s+\D/);
    if (numero) {
      atual = { numero: numero[1], documento, pagina, texto: linha };
      clausulas.push(atual);
    } else if (atual && linha) atual.texto += ` ${linha}`;
  }
  return clausulas;
}

function aplicarPrazosDaFonte(estrutura, texto) {
  const clausulas = clausulasDaFonte(texto);
  const formatar = (item) => `${item.texto} [${item.documento}${item.pagina ? `, página ${item.pagina}` : ""}]`;
  const juntar = (itens) => [...new Set(itens.map(formatar))].join("\n") || "Não informado";
  const esclarecimentos = clausulas.filter((item) => /solicitar esclarecimentos|pedidos? de esclarecimento/i.test(item.texto) &&
    /\b(?:at[eé]|anteced[eê]ncia|antes)\b.*\b(?:dias?|abertura|sess[aã]o)|\b\d+\s*\([^)]*\)\s*dias?\b/i.test(item.texto) &&
    !/responder[aá]|resposta aos pedidos|desconsiderar[aá]/i.test(item.texto));
  estrutura.prazos = { ...estrutura.prazos, limiteEsclarecimentos: juntar(esclarecimentos) };
  // A entrega contratual tem objeto material/serviço explícito. Fichas, amostras
  // e propostas são etapas do certame, mesmo quando usam a palavra "entrega".
  const entregas = clausulas.filter((item) => /prazo de entrega (?:do objeto|dos materiais|dos bens|dos produtos)|(?:bens|materiais|produtos) (?:dever[aã]o ser|ser[aã]o) entregues|a entrega (?:do objeto|dos materiais|dos bens|dos produtos) (?:ser[aá]|dar-se-[aá])|execu[cç][aã]o dos servi[cç]os (?:ser[aá]|dever[aá])/i.test(item.texto) &&
    !/fichas? t[eé]cnicas?|amostras?|propostas?|infra[cç][oõ]es|retardamento/i.test(item.texto));
  const contexto = clausulas.filter((item) => entregas.some((origem) => item.documento === origem.documento &&
    (item === origem || item.numero.startsWith(`${origem.numero}.`))));
  const prazo = entregas.filter((item) => /prazo|\bdias?\b|\bmeses\b|assinatura|ordem de/i.test(item.texto));
  const local = contexto.filter((item) => /local de entrega|endere[cç]o|(?:Rua|Avenida|Av\.)\s/i.test(item.texto));
  estrutura.entregaExecucao = { prazo: juntar(prazo), local: juntar(local), condicoes: juntar(contexto) };
  estrutura.detalhes = { ...estrutura.detalhes, prazoEntrega: juntar(prazo) };
  return estrutura;
}

function extrairRequisitosOperacionais(texto, identidadeLegada = false) {
  const resultado = { documentosHabilitacao: [], documentosCredenciamento: [], requisitosProposta: [], declaracoesExigidas: [] };
  let documento = "Documento oficial", pagina = "", categoria = null, raiz = "", bloco = null;
  const guardar = () => {
    if (!bloco) return;
    const conteudo = bloco.linhas.join(" ").replace(/\s+/g, " ").trim();
    if (!bloco.categoria && /dever[aá]|dever[aã]o|exigid|apresenta[cç][aã]o|obrigat/i.test(conteudo)) {
      if (/declara[cç][aã]o|declara[cç][oõ]es/i.test(conteudo)) bloco.categoria = "declaracoesExigidas";
      else if (/ficha t[eé]cnica|cat[aá]logo|amostra|proposta reformulada|documentos de habilita[cç][aã]o/i.test(conteudo)) bloco.categoria = "requisitosProposta";
      else if (!identidadeLegada && /dilig[eê]ncia/i.test(conteudo) && /dever[aá] ser atendida/i.test(conteudo)) bloco.categoria = "requisitosProposta";
    }
    if (!bloco.categoria) return;
    if (conteudo.length < 6) return;
    const item = `${conteudo} [${bloco.documento}${bloco.pagina ? `, página ${bloco.pagina}` : ""}]`;
    resultado[bloco.categoria].push(item);
    if (bloco.categoria !== "declaracoesExigidas" && /declara(?:ção|ções|r|m)|\bdeclaro\b/i.test(conteudo)) resultado.declaracoesExigidas.push(item);
  };
  for (const linha of limparLinhas(texto)) {
    const doc = linha.match(/^--- (.+) ---$/);
    if (doc) { guardar(); bloco = null; documento = doc[1]; categoria = null; raiz = ""; continue; }
    const pg = linha.match(/^\[Página (\d+)\]$/);
    if (pg) { pagina = pg[1]; continue; }
    const tituloSemNumero = identidadeLegada ? linha.length < 100 && /^(Habilita[cç][aã]o|Qualifica[cç][aã]o|Regularidade fiscal|Credenciamento|Documentos de habilita[cç][aã]o|Declara[cç][oõ]es exigidas)/i.test(linha) && !/[.;]$/.test(linha) : /^(?:Habilita[cç][aã]o(?:\s+(?:Jur[ií]dica|T[eé]cnica|Econ[oô]mico\s*[-–]?\s*Financeira))?|Qualifica[cç][aã]o(?:\s+(?:T[eé]cnica|Econ[oô]mico\s*[-–]?\s*Financeira))?|Regularidade fiscal(?:,\s*social)?(?:\s+e\s+trabalhista)?|Credenciamento|Documentos de habilita[cç][aã]o|Declara[cç][oõ]es exigidas)\s*:?$/i.test(linha);
    if (tituloSemNumero && categoriaSecao(linha)) {
      guardar(); bloco = null; categoria = categoriaSecao(linha); raiz = ""; continue;
    }
    const numero = linha.match(/^(\d+(?:\.\d+)*)(?:\.|\s*[-–])\s+(.+)/);
    const anexo = /^ANEXO\s+[IVX\d]+/i.test(linha);
    const cabecalho = numero && numero[2].length < 150 && numero[2] === numero[2].toUpperCase() && /[A-ZÀ-Ú]/.test(numero[2]);
    if (numero || anexo) {
      guardar(); bloco = null;
      if (anexo) { categoria = categoriaSecao(linha); raiz = ""; }
      else if ((cabecalho && categoriaSecao(numero[2])) || !numero[1].includes(".")) { categoria = categoriaSecao(numero[2]); raiz = numero[1].split(".")[0]; }
      else if (raiz && numero[1].split(".")[0] !== raiz) categoria = null;
      bloco = { categoria, documento, pagina, linhas: [linha] };
    } else if (bloco && linha) bloco.linhas.push(linha);
  }
  guardar();
  for (const chave of Object.keys(resultado)) resultado[chave] = [...new Set(resultado[chave])];
  return resultado;
}

function selecionarAcoesChecklist(requisitos) {
  const saida = Object.fromEntries(Object.keys(requisitos).map((chave) => [chave, []]));
  const vistos = new Map();
  const normalizar = (texto) => texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const chave of ["declaracoesExigidas", "documentosCredenciamento", "documentosHabilitacao", "requisitosProposta"]) {
    for (const item of requisitos[chave] || []) {
      const semReferencia = item.replace(/\s*\[[^\]]+\]$/, "");
      const corpo = semReferencia.replace(/^\d+(?:\.\d+)*\.\s*/, "");
      // Títulos, consequências e atos do órgão não são tarefas a marcar como
      // documentos preparados pelo licitante. Continuam acessíveis no edital.
      const documentoConcreto = /licen[cç]a|alvar[aá]|certid[aã]o|atestado|inscri[cç][aã]o|comprovante|certificado|dever|exigid/i.test(corpo);
      if ((corpo === corpo.toUpperCase() && categoriaSecao(corpo) && !documentoConcreto) || /^(Regularidade Fiscal|Habilitação Econômico|Disposições Gerais)/i.test(corpo)) continue;
      if (/declaração ou documentação falsa|informações inverídicas|comportamento inidôneo|A não.regularização|A ausência de apresentação|A não observância|DA JUSTIFICATIVA|PLANO DE CONTRATAÇÃO/i.test(corpo)) continue;
      if (/^(A aceitação|Após análise|Caberá ao pregoeiro|O CSC|A Comissão|Considera-se|Recebida a Proposta|Durante a análise|Examinada a proposta|No final da sessão|As fichas técnicas aprovadas|Serão considerados|Para efeito de avaliação|A indicação do lance|O desatendimento|Informações complementares|Qualquer dúvida|O credenciamento junto|O credenciamento é o nível básico|O licitante responsabiliza)/i.test(corpo)) continue;
      if (/^(?:A análise de que|Havendo necessidade de avaliação|As fichas técnicas poderão ser abertas|Será classificada|Caso as fichas técnicas não sejam aprovadas|Constatada a existência|O licitante que não encaminhar|Se a documentação de habilitação|Quando ocorrer o fracassado|Havendo licitantes inabilitados|Após a análise da aceitabilidade|Caso a proposta de preços reformulada|O erro no preço total)/i.test(corpo)) continue;
      if (/^(?:O descumprimento|Havendo necessidade de analisar|Será inabilitado|Constatado o atendimento|Na hipótese de o fornecedor não atender|Em qualquer caso, concluída|A consulta (?:aos|no)|Para fins de análise da proposta|Se a proposta ou lance|Encerrada a análise quanto|Havendo necessidade, a sessão|Será desclassificada a proposta|contiver vícios|apresentar preços inexequíveis)/i.test(corpo)) continue;
      if (/(?:gestor|pregoeiro) (?:verificará|examinará)|o órgão diligenciará/i.test(corpo) && !/envio|prazo de|apresenta[cç][aã]o/.test(corpo)) continue;
      if (chave === "requisitosProposta" && /^(Tempo de disputa|Término diário|Para o julgamento e classificação|Os critérios objetivos que ensejarão|Serão desclassificadas|A inexequibilidade|Cadastro Nacional de Empresas|Apresentar fichas técnicas em desconformidade|Apresentar fichas técnicas que reproduzam|Ofertar produto com|Deixar de apresentar|Ofertar a ficha técnica|Não se considerará qualquer oferta)/i.test(corpo)) continue;
      if (/às seguintes declarações\s*:/i.test(corpo)) continue;
      const identidade = normalizar(corpo);
      // Iguais nas duas fontes ou repetidos em categorias aparecem uma vez,
      // acumulando referências. Não fundimos requisitos apenas semelhantes.
      if (vistos.has(identidade)) {
        const anterior = vistos.get(identidade);
        const referencia = item.match(/\[[^\]]+\]$/)?.[0];
        if (referencia && !saida[anterior.chave][anterior.indice].includes(referencia)) saida[anterior.chave][anterior.indice] += ` ${referencia}`;
        continue;
      }
      vistos.set(identidade, { chave, indice: saida[chave].length });
      saida[chave].push(item);
    }
  }
  // Subitens que apenas detalham o mesmo requisito ficam junto dele. Evita
  // transformar cada condição de um atestado ou assinatura em documento novo.
  for (const [chave, itens] of Object.entries(saida)) {
    const agrupados = [];
    for (const item of itens) {
      const numero = item.match(/^(\d+(?:\.\d+)+)\./)?.[1];
      const documento = item.match(/\[([^,\]]+)/)?.[1];
      const pai = numero && agrupados.findLast((anterior) => {
        const numeroPai = anterior.match(/^(\d+(?:\.\d+)+)\./)?.[1];
        const profundidade = chave === "documentosHabilitacao" ? 4 : 2;
        return numeroPai && numeroPai.split(".").length >= profundidade && numero.startsWith(`${numeroPai}.`) &&
          anterior.includes(`[${documento},`) && anterior.length + item.length < 1800;
      });
      if (pai) agrupados[agrupados.indexOf(pai)] += ` Condição: ${item}`;
      else agrupados.push(item);
    }
    saida[chave] = agrupados;
  }
  return saida;
}

function catalogarRequisitos(texto) {
  const requisitos = selecionarAcoesChecklist(extrairRequisitosOperacionais(texto));
  // Jobs já anotados usam a numeração anterior. O parser legado fornece somente
  // identidades: seu conteúdo truncado nunca volta ao checklist. IDs removidos
  // ficam reservados; uma origem ambígua recebe um ID novo, sem herdar sínteses.
  const legado = Object.values(selecionarAcoesChecklist(extrairRequisitosOperacionais(texto, true))).flat();
  const origem = (item) => JSON.stringify([
    item.match(/\[[^\]]+\]/)?.[0] || "",
    item.match(/^(\d+(?:\.\d+)*)(?:\.|\s*[-–])\s/)?.[1] || item,
  ]);
  const anteriores = new Map();
  legado.forEach((item, indice) => {
    const chave = origem(item);
    anteriores.set(chave, anteriores.has(chave) ? null : indice + 1);
  });
  const atuais = Object.entries(requisitos).flatMap(([categoria, itens]) => itens.map((textoItem) => ({ categoria, texto: textoItem })));
  const contagens = new Map();
  for (const item of atuais) contagens.set(origem(item.texto), (contagens.get(origem(item.texto)) || 0) + 1);
  let sequencia = legado.length;
  return atuais.map((item) => {
    const chave = origem(item.texto);
    const numero = contagens.get(chave) === 1 && anteriores.get(chave) || ++sequencia;
    return { id: `R${String(numero).padStart(4, "0")}`, ...item };
  });
}

function marcarRequisitosNaFonte(texto) {
  const identidade = (valor) => valor.replace(/\[[^\]]+\]/g, "").replace(/^\d+(?:\.\d+)*\.\s*/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const catalogo = catalogarRequisitos(texto);
  const porConteudo = new Map();
  for (const requisito of catalogo) {
    for (const parte of requisito.texto.split(" Condição: ")) {
      const chave = identidade(parte);
      if (!porConteudo.has(chave)) porConteudo.set(chave, []);
      porConteudo.get(chave).push(`${requisito.id} ${requisito.categoria}`);
    }
  }
  const candidatos = new Map();
  for (const item of Object.values(extrairRequisitosOperacionais(texto)).flat()) {
    const marcadores = porConteudo.get(identidade(item));
    if (!marcadores) continue;
    const referencia = item.match(/\[([^\]]+)\]$/)?.[1];
    if (!candidatos.has(referencia)) candidatos.set(referencia, []);
    candidatos.get(referencia).push({ corpo: item.replace(/\s*\[[^\]]+\]$/, "").replace(/\s+/g, " "), marcadores });
  }
  let documento = "Documento oficial", pagina = "";
  // Insere metadados antes da cláusula, sem reescrever sequer um caractere
  // da fonte. O mesmo ID acompanha equivalentes e condições em outras páginas.
  return texto.split(/(?<=\n)/).map((linha) => {
    const limpa = linha.trim().replace(/\s+/g, " ");
    const doc = limpa.match(/^--- (.+) ---$/);
    if (doc) documento = doc[1];
    const pg = limpa.match(/^\[Página (\d+)\]$/);
    if (pg) pagina = pg[1];
    if (!/^\d+(?:\.\d+)*(?:\.|\s*[-–])\s+|^ANEXO\s+[IVX\d]+/i.test(limpa)) return linha;
    const referencia = `${documento}${pagina ? `, página ${pagina}` : ""}`;
    const correspondentes = (candidatos.get(referencia) || []).filter((item) => item.corpo.startsWith(limpa));
    const marcadores = [...new Set(correspondentes.flatMap((item) => item.marcadores))];
    return marcadores.length ? `[EXIGÊNCIA ${marcadores.join("; ")}]\n${linha}` : linha;
  }).join("");
}

function preservarCondicoesQuantificadas(fontes, resumo) {
  const normalizar = (valor) => valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ");
  const destino = normalizar(resumo);
  for (const fonte of fontes) {
    const origem = normalizar(fonte.texto.replace(/\[[^\]]+\]/g, ""));
    const limites = origem.match(/\b\d{2}\/\d{2}\/\d{4}\b|\b\d+(?:[.,]\d+)?\s*%|\b\d+\s+(?:dias?|horas?|meses|anos?|exercicios?)\b|\b(?:fgts|cndt|inss|cnpj|crc|mei|matriz|filial)\b/g) || [];
    if (limites.some((limite) => !destino.includes(limite))) return false;
    // Uma referência correta não prova que a IA conservou a aplicabilidade.
    // Sem equivalência semântica verificável, conservamos literalmente a oração
    // condicional (ou a cláusula inteira quando oferece alternativas).
    const literal = (valor) => valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
    const corpo = literal(fonte.texto.replace(/\[[^\]]+\]/g, "").replace(/^\d+(?:\.\d+)*\.\s*/, ""));
    const condicao = corpo.match(/\b(?:se|salvo|exceto|caso|quando|desde que|em se tratando|na hipotese|somente|apenas)\b[\s\S]*/)?.[0];
    const alternativa = /\b(?:ou|alternativamente)\b/.test(corpo);
    const exigenciaLiteral = alternativa ? corpo : condicao;
    if (exigenciaLiteral && !literal(resumo).includes(exigenciaLiteral.replace(/[.;\s]+$/, ""))) return false;
  }
  return true;
}

function complementarRequisitos(estrutura, texto) {
  const catalogo = catalogarRequisitos(texto);
  const requisitos = selecionarAcoesChecklist(extrairRequisitosOperacionais(texto));
  let sintetizados = 0;
  for (const [chave, itens] of Object.entries(requisitos)) {
    const fontes = catalogo.filter((fonte) => fonte.categoria === chave);
    const cobertos = new Set();
    const sinteticos = [];
    for (const item of Array.isArray(estrutura[chave]) ? estrutura[chave] : []) {
      if (typeof item !== "string") continue;
      const ids = [...new Set(item.match(/\bR\d{4}\b/g) || [])];
      if (!ids.length || ids.some((id) => !fontes.some((fonte) => fonte.id === id))) continue;
      const citadas = fontes.filter((fonte) => ids.includes(fonte.id));
      if (/^divulgar\s+(?:o\s+)?resultado/i.test(item) && citadas.some((fonte) => /sess[aã]o[\s\S]*para divulgar o resultado/i.test(fonte.texto))) continue;
      const referencias = citadas.map((fonte) => {
        const clausulas = [...fonte.texto.matchAll(/(?:^|Condição: )(\d+(?:\.\d+)+)\./g)].map((m) => m[1]);
        const documentos = [...new Set(fonte.texto.match(/\[[^\]]+\]/g) || [])].join("; ");
        return `${documentos}${clausulas.length ? `, cláusulas ${clausulas.join(", ")}` : ""}`;
      });
      const resumo = item.replace(/\[?R\d{4}(?:\s*[,;]\s*R\d{4})*\]?/g, "").trim();
      let conteudo = resumo.replace(/\[[^\]]+\]/g, "");
      for (const fonte of citadas) {
        for (const referencia of fonte.texto.match(/\[[^\]]+\]/g) || []) {
          const documento = referencia.slice(1, -1).replace(/, página \d+$/, "");
          conteudo = conteudo.split(documento).join("");
        }
      }
      conteudo = conteudo.replace(/(?:páginas?|cláusulas?)\s*[\d.,\s]+/gi, "").replace(/[\s\d.,;:()—-]/g, "");
      // IDs e referências localizam a prova, mas não substituem a exigência.
      // Siglas documentais curtas (CNDT, FGTS) continuam sendo conteúdo útil.
      const siglaDocumental = /^(?:CNDT|FGTS|CPF|CNPJ|CRC)$/i.test(conteudo) && citadas.every((fonte) => new RegExp(`\\b${conteudo}\\b`, "i").test(fonte.texto));
      if ((conteudo.length < 15 && !siglaDocumental) || !preservarCondicoesQuantificadas(citadas, resumo)) continue;
      sinteticos.push(`${resumo} — ${referencias.join("; ")}`);
      for (const id of ids) cobertos.add(id);
    }
    sintetizados += cobertos.size;
    if (itens.length) estrutura[chave] = [...sinteticos, ...fontes.filter((fonte) => !cobertos.has(fonte.id)).map((fonte) => fonte.texto)];
    else estrutura[chave] = [];
  }
  estrutura.coberturaSintese = { requisitosIdentificados: catalogo.length, requisitosSintetizados: sintetizados, requisitosComplementados: catalogo.length - sintetizados };
  const quantitativos = catalogo.filter((item) => item.categoria === "documentosHabilitacao" && /forneceu|fornecido/i.test(item.texto))
    .flatMap((item) => [...item.texto.matchAll(/(\d+(?:[.,]\d+)?)\s*%\s+das\s+quantidades/gi)].map((m) => ({ percentual: m[1], fonte: item.texto })));
  if (new Set(quantitativos.map((item) => item.percentual)).size > 1) {
    const referencias = quantitativos.map((item) => `${item.percentual}% — ${item.fonte.match(/\[[^\]]+\]/)?.[0] || "fonte extraída"}, cláusula ${item.fonte.match(/^\d+(?:\.\d+)*/)?.[0] || "sem número"}`);
    estrutura.pendenciasParaConferencia = [...(estrutura.pendenciasParaConferencia || []),
      `Possível divergência nos quantitativos de fornecimento anterior para habilitação: ${referencias.join("; ")}. Conferir o alcance das cláusulas e esclarecer com o órgão antes de adotar um percentual. Ambos os requisitos foram preservados.`];
  }
  const faltantes = Object.keys(requisitos).filter((chave) => !requisitos[chave].length);
  if (faltantes.length) {
    estrutura.pendenciasParaConferencia = [...(estrutura.pendenciasParaConferencia || []),
      `A extração de cláusulas não identificou todas as etapas (${faltantes.join(", ")}). A ausência de uma lista não confirma dispensa de requisitos.`];
  }
  return estrutura;
}

function prepararContextoResumo(texto, limite = 260000) {
  const fontes = catalogarRequisitos(texto);
  const catalogo = fontes.map((fonte) => `[${fonte.id}] ${fonte.categoria}: ${fonte.texto}`);
  const cabecalho = "CATÁLOGO DE REQUISITOS: cite os IDs entre colchetes nas listas de síntese; preserve condições, alternativas e prazos.\n";
  // O índice aponta para as cláusulas da fonte abaixo, sem reenviar cada uma
  // duas vezes. Requisitos sem número conservam seu texto para identificação.
  const indice = fontes.map((fonte) => {
    const clausulas = [...fonte.texto.matchAll(/(?:^|Condição: )(\d+(?:\.\d+)+)\./g)].map((m) => m[1]);
    const documentos = [...new Set(fonte.texto.match(/\[[^\]]+\]/g) || [])];
    const referencia = clausulas.length ? `${documentos.join("; ")}, cláusulas ${clausulas.join(", ")}` : fonte.texto;
    return `[${fonte.id}] ${fonte.categoria}: ${referencia}`;
  });
  const integral = `${cabecalho}ÍNDICE: leia o conteúdo de cada cláusula na fonte integral; as referências não substituem a leitura.\n${indice.join("\n")}\nFONTE INTEGRAL EXTRAÍDA:\n${texto}`;
  if (integral.length <= limite) return { texto: integral, parcial: false };

  const partes = ["CONTEXTO PARCIAL: nem todas as seções da fonte couberam. Não deduza ausência de exigências; registre esta limitação nas pendências.", cabecalho];
  let ocupado = partes.join("\n").length;
  const adicionar = (parte) => {
    if (ocupado + parte.length + 1 > limite) return;
    partes.push(parte); ocupado += parte.length + 1;
  };
  for (const item of catalogo) adicionar(item);
  // Para fontes acima do orçamento, seleciona seções inteiras. Não corta uma
  // cláusula no último caractere nem escolhe apenas a última menção de um tema.
  const secoes = texto.split(/(?=^--- .+ ---$|^\d+\.\s+[A-ZÀ-Ú][A-ZÀ-Ú /,-]{2,}\s*$|^ANEXO\s+[IVX\d]+)/m);
  const temas = /pagamento|liquida[cç][aã]o|entrega|execu[cç][aã]o|penalidade|san[cç][oõ]es|multa|impugna[cç][aã]o|recurso|garantia|subcontrata[cç][aã]o/i;
  let documento = "";
  const ordenadas = secoes.map((secao, indice) => {
    const marcador = secao.match(/^--- .+ ---$/m)?.[0];
    if (marcador) documento = marcador;
    return { secao: marcador ? secao : `${documento}\n${secao}`, indice, prioridade: Number(temas.test(secao.slice(0, 250))) };
  });
  ordenadas.sort((a, b) => b.prioridade - a.prioridade || a.indice - b.indice);
  for (const { secao } of ordenadas) adicionar(secao);
  return { texto: partes.join("\n"), parcial: true };
}

function selecionarContexto(texto, limite = 22000, pergunta = "") {
  if (texto.length <= limite && pergunta) return texto;
  if (pergunta) {
    const normalizar = (valor) => valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const termos = normalizar(pergunta).match(/[a-z]{4,}/g)?.filter((termo) => !/^(qual|quais|como|para|esse|este|edital|preciso|sobre)$/.test(termo)) || [];
    const trechos = Array.from({ length: Math.ceil(texto.length / 3000) }, (_, indice) => {
      const trecho = texto.slice(Math.max(0, indice * 3000 - 300), (indice + 1) * 3000);
      return { trecho, indice, pontos: termos.reduce((soma, termo) => soma + Number(normalizar(trecho).includes(termo)), 0) };
    });
    return trechos.sort((a, b) => b.pontos - a.pontos || a.indice - b.indice).slice(0, 6).sort((a, b) => a.indice - b.indice).map((parte) => parte.trecho).join("\n[Trecho selecionado]\n").slice(0, limite);
  }
  return prepararContextoResumo(texto, limite).texto;
}

module.exports = { extrairRequisitosOperacionais, complementarRequisitos, selecionarContexto, selecionarAcoesChecklist, catalogarRequisitos, prepararContextoResumo, marcarRequisitosNaFonte, aplicarPrazosDaFonte };
