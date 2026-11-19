// Caçador de exigências escondidas. Junta a leitura determinística (regras) com o
// dossiê da IA e prova cada item com documento, página e trecho literal da fonte.
// Nada some em silêncio: o que não se prova vai para "conferir", o que a IA não
// listou ganha selo, e documento não lido trava a etapa em "aguardando_leitura".
// O dono já perdeu uma licitação por uma declaração escondida num anexo.
const { createHash } = require("node:crypto");
const { catalogarRequisitos, paginasDaFonte, localizarReferencia } = require("./_edital_operacional");

const LIMITE_TRECHO = 600;
const GATILHO = /declar|sob pena|inabilita|desclassifica|amostra|vistoria|visita|garantia|atestado|registro no|anexo [^.]{0,80}modelo/i;
// Fortes valem por página: foi uma declaração numa página sem extração, num documento
// que já tinha outra exigência, que fez o dono perder uma licitação. "modelo de
// declaração" e "sob pena de inabilitação" já caem em declar/inabilita.
const GATILHO_FORTE = /declar|inabilita|desclassifica|amostra|vistoria|visita t|garantia de proposta|atestado|registro no/i;
// Fracos aparecem em quase toda página (sanções); continuam só por documento.
const GATILHO_FRACO = /sob pena|garantia|visita|anexo [^.]{0,80}modelo/i;
const MAX_ALERTAS_POR_DOCUMENTO = 8;
const AVISO_SO_REGRAS = "a IA não listou; confira";
const AVISO_SEM_TRECHO = "a IA citou, mas o trecho não foi localizado na fonte; confira";
const PARADAS = new Set(["para", "pela", "pelo", "como", "sendo", "sobre", "entre", "quando", "todos", "todas", "esta", "este", "essa", "esse",
  "seus", "suas", "qual", "onde", "desde", "ainda", "mesmo", "mais", "conforme", "deve", "devera", "deverao", "licitante", "licitantes",
  "apresentar", "apresentacao", "documento", "documentos", "referencia", "pagina", "item", "clausula", "sim"]);

const simples = (v) => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const normalizar = (v) => simples(v).replace(/[^a-z0-9%]+/g, " ").trim();
// shortcut: radical = 6 primeiras letras sem plural; trocar por stemmer se surgirem falsos pares.
const tokens = (texto) => new Set(normalizar(texto).split(" ")
  .filter((p) => (p.length >= 4 && !PARADAS.has(p)) || /^\d{2,}$/.test(p)).map((p) => p.replace(/s$/, "").slice(0, 6)));
const intersecao = (a, b) => [...a].filter((t) => b.has(t)).length;
const cobertura = (alvo, fonte) => (alvo.size ? intersecao(alvo, fonte) / alvo.size : 0);
const semelhanca = (a, b) => (Math.min(a.size, b.size) >= 2 ? intersecao(a, b) / Math.min(a.size, b.size) : 0);
const nucleo = (texto) => String(texto).split(" Condição: ")[0].replace(/\s*\[[^\]]+\]/g, "").replace(/^\d+(?:\.\d+)*\.\s+|^\d+(?:\.\d+)+\s+/, "").trim();
// Código estável: o mesmo texto da IA ganha o mesmo código em qualquer releitura (a resposta do usuário fica presa a ele).
const codigoEstavel = (prefixo, texto) => `${prefixo}-${createHash("sha256").update(String(texto).toLowerCase().trim().replace(/\s+/g, " ")).digest("hex").slice(0, 10)}`;
const referencias = (texto) => [...String(texto).matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);

function trechoNaPagina(pagina, alvo) {
  // Janela de até 600 caracteres copiada sem alteração do texto da página.
  // Começa no trecho que mais cobre o item e para assim que a cobertura máxima é
  // atingida, para não arrastar cláusulas vizinhas (que contaminariam "incomum").
  const texto = pagina.texto;
  const cortes = [0, ...[...texto.matchAll(/(?<=[.;])\s+|\s(?=\d+(?:\.\d+)+\.?\s)/g)].map((m) => m.index + m[0].length), texto.length];
  let melhor = 0, nota = -1;
  for (let i = 0; i < cortes.length - 1; i++) {
    const n = cobertura(alvo, tokens(texto.slice(cortes[i], cortes[i] + LIMITE_TRECHO))) + cobertura(alvo, tokens(texto.slice(cortes[i], cortes[i + 1]))) / 100;
    if (n > nota) { nota = n; melhor = i; }
  }
  const maximo = cobertura(alvo, tokens(texto.slice(cortes[melhor], cortes[melhor] + LIMITE_TRECHO)));
  let fim = melhor + 1;
  while (fim < cortes.length - 1 && cortes[fim] - cortes[melhor] < LIMITE_TRECHO && cobertura(alvo, tokens(texto.slice(cortes[melhor], cortes[fim]))) < maximo) fim++;
  return texto.slice(cortes[melhor], Math.min(cortes[fim], cortes[melhor] + LIMITE_TRECHO)).trim();
}

function localizar(texto, paginas) {
  const alvo = tokens(nucleo(texto));
  if (alvo.size < 2) return null;
  const notas = new Map(paginas.map((p) => [p, cobertura(alvo, p.chaves)]));
  const ocorrencias = paginas.filter((p) => notas.get(p) >= 0.75);
  let escolhida = referencias(texto).map((ref) => localizarReferencia(ref, paginas)).find((p) => p && notas.get(p) >= 0.5);
  if (!escolhida && ocorrencias.length) escolhida = ocorrencias.reduce((a, b) => (notas.get(b) > notas.get(a) ? b : a));
  if (!escolhida) return null;
  if (!ocorrencias.includes(escolhida)) ocorrencias.unshift(escolhida);
  return { documento: escolhida.documento, pagina: escolhida.pagina, trecho: trechoNaPagina(escolhida, alvo),
    ocorrencias: ocorrencias.map((p) => ({ documento: p.documento, pagina: p.pagina, minuta: Boolean(p.minuta) })) };
}

function itensDaIA(dossieIA, avisos) {
  const e = dossieIA?.estrutura || dossieIA;
  if (!e || typeof e !== "object") { avisos.push("Dossiê da IA ausente: só a leitura determinística foi usada; confira tudo."); return []; }
  const itens = [];
  for (const campo of ["documentosHabilitacao", "documentosCredenciamento", "requisitosProposta", "declaracoesExigidas"]) {
    for (const item of Array.isArray(e[campo]) ? e[campo] : []) {
      const texto = typeof item === "string" ? item : item?.texto;
      if (typeof texto !== "string" || !texto.trim()) { avisos.push(`Item da IA ignorado em ${campo}: formato inválido.`); continue; }
      itens.push({ texto: texto.trim(), categoriaFonte: campo, categoriaIA: item?.categoria });
    }
  }
  const campos = [["exigeAmostra", e.detalhes?.exigeAmostra], ["exigeVisitaTecnica", e.detalhes?.exigeVisitaTecnica],
    ["garantiaProposta", e.garantias?.proposta], ["prazoEntrega", e.entregaExecucao?.prazo]];
  for (const [campo, valor] of campos) {
    if (typeof valor === "string" && valor.trim() && !/^n[aã]o\b/i.test(valor.trim())) itens.push({ texto: valor.trim(), categoriaFonte: campo });
  }
  return itens;
}

function melhorPar(exigencias, chaves, local) {
  let par = null, nota = 0;
  for (const e of exigencias) {
    const n = semelhanca(chaves, e.chaves);
    const mesmaPagina = local && e.documento === local.documento && e.pagina === local.pagina;
    if ((n >= 0.7 || (mesmaPagina && n >= 0.5)) && n > nota) { par = e; nota = n; }
  }
  return par;
}

function juntarExigencias({ fonteRegras, dossieIA, textoFonte, documentos } = {}) {
  const avisos = [];
  const texto = typeof textoFonte === "string" ? textoFonte : "";
  if (!texto.trim()) avisos.push("Texto da fonte ausente: nenhum item pôde ser localizado; tudo vai para conferência.");
  const nomesNaFonte = Object.keys(separarPorDocumento(texto));
  for (const nome of Array.isArray(documentos) ? documentos : []) {
    if (!nomesNaFonte.includes(nome)) avisos.push(`Documento ${nome} não aparece no texto lido; exigências dele não foram procuradas.`);
  }
  const paginas = paginasDaFonte(texto).map((p) => ({ ...p, chaves: tokens(p.texto) }));
  const regras = Array.isArray(fonteRegras) ? fonteRegras : texto ? catalogarRequisitos(texto) : [];
  const exigencias = regras.map((r) => {
    const local = localizar(r.texto, paginas);
    const [, documento = null, pagina = ""] = referencias(r.texto)[0]?.match(/^(.*?)(?:, página (\d+))?$/) || [];
    return { id: r.id, idRegra: r.id, texto: nucleo(r.texto), textoRegra: r.texto, categoriaFonte: r.categoria, chaves: tokens(r.texto),
      origem: "leitura_deterministica", estado: "encontrado", aviso: AVISO_SO_REGRAS,
      ...(local || { documento, pagina, trecho: nucleo(r.texto).slice(0, LIMITE_TRECHO), ocorrencias: documento ? [{ documento, pagina, minuta: false }] : [] }) };
  });
  const codigos = new Set();
  for (const item of itensDaIA(dossieIA, avisos)) {
    const local = localizar(item.texto, paginas);
    const chaves = tokens(nucleo(item.texto));
    const par = melhorPar(exigencias, chaves, local);
    if (par) {
      if (par.origem === "leitura_deterministica") { par.origem = "ambas"; delete par.aviso; }
      par.textoIA = par.textoIA || item.texto;
      par.categoriaIA = par.categoriaIA || item.categoriaIA;
      continue;
    }
    const id = codigoEstavel("IA", item.texto);
    // Texto repetido pela IA é o mesmo item: duas linhas com o mesmo código quebrariam o upsert.
    if (codigos.has(id)) continue;
    codigos.add(id);
    exigencias.push({ id, texto: nucleo(item.texto), textoIA: item.texto,
      categoriaFonte: item.categoriaFonte, categoriaIA: item.categoriaIA, chaves,
      ...(local ? { origem: "ia", estado: "encontrado", ...local }
        : { origem: "ia_sem_trecho", estado: "conferir", aviso: AVISO_SEM_TRECHO, documento: null, pagina: null, trecho: null, ocorrencias: [] }) });
  }
  return { exigencias: exigencias.map(({ chaves: _chaves, ...e }) => ({ ...e, categoria: classificar(e) })), avisos };
}

const REGRAS_CATEGORIA = [
  ["amostra", /amostra|prova de conceito/],
  ["visita", /visita|vistoria/],
  ["garantia", /garantia (?:de|da) (?:proposta|participacao|contrat|execucao)|caucao|seguro.?garantia|garantia contratual/],
  ["declaracao", /declara/],
  ["credenciamento", /credenciamento|procuracao|representante legal/],
  ["economica", /balanco|indice|liquidez|solvencia|endividamento|patrimonio liquido|capital social|falencia|recuperacao judicial/],
  ["fiscal", /regularidade fiscal|fgts|cndt|debitos (?:trabalhistas|estaduais|municipais|federais)|certidao (?:negativa|conjunta)|fazenda|receita federal|divida ativa|cnpj|inscricao (?:estadual|municipal)/],
  ["tecnica", /atestado|capacidade tecnica|registro (?:no|em|junto ao|perante o) (?:conselho|crea|cau|cr[a-z]{1,3})|conselho regional|acervo tecnico|responsavel tecnico|certificad/],
  ["juridica", /contrato social|ato constitutivo|estatuto|registro comercial|junta comercial|empresario individual|\bmei\b/],
  ["proposta", /proposta|ficha tecnica|catalogo|planilha|preco/],
  ["execucao", /entreg|execucao|contratada|prazo/],
];
const POR_CAMPO = { exigeAmostra: "amostra", exigeVisitaTecnica: "visita", garantiaProposta: "garantia", prazoEntrega: "execucao",
  declaracoesExigidas: "declaracao", documentosCredenciamento: "credenciamento", requisitosProposta: "proposta", documentosHabilitacao: "juridica" };
const POR_CATEGORIA_IA = { "Jurídica": "juridica", "Fiscal, social e trabalhista": "fiscal", "Econômico-financeira": "economica", "Técnica": "tecnica" };

function classificar(exigencia) {
  const campo = exigencia?.categoriaFonte;
  if (["exigeAmostra", "exigeVisitaTecnica", "garantiaProposta", "prazoEntrega"].includes(campo)) return POR_CAMPO[campo];
  const texto = simples(exigencia?.texto);
  return REGRAS_CATEGORIA.find(([, re]) => re.test(texto))?.[0] || POR_CATEGORIA_IA[exigencia?.categoriaIA] || POR_CAMPO[campo] || "execucao";
}

// Exigência → operacao_documentos.tipo (nomes fixos do select de operacao.html). A view
// operacao_exigencias_situacao cruza por esse nome; tipo errado mostraria "vigente" falso,
// então na dúvida devolve null e a exigência fica em "conferir".
const TIPOS_DOCUMENTO = [
  ["CNDT", /\bcndt\b|debitos trabalhistas|justica do trabalho|regularidade trabalhista/],
  ["FGTS", /\bfgts\b|\bcrf\b|fundo de garantia/],
  ["Certidão Federal", /receita federal|tributos federais|debitos federais|divida ativa da uniao|fazenda (?:publica )?(?:nacional|federal)|\bpgfn\b|certidao conjunta|(?:certidao|cnd|regularidade)[^.;]{0,40}\bfederal\b/],
  ["Certidão Estadual", /tributos estaduais|debitos estaduais|fazenda (?:publica )?estadual|(?:certidao|cnd|regularidade)[^.;]{0,40}\bestadual\b/],
  ["Certidão Municipal", /tributos municipais|debitos municipais|fazenda (?:publica )?municipal|(?:certidao|cnd|regularidade)[^.;]{0,40}\bmunicipal\b/],
  ["Balanço patrimonial", /balanco patrimonial/],
  ["Contrato social", /contrato social|ato constitutivo|estatuto social/],
  ["Atestado de capacidade técnica", /atestados? de capacidade tecnica|atestados?[^.;]{0,80}(?:aptidao|qualificacao tecnica|capacidade tecnica)|(?:aptidao|capacidade tecnica)[^.;]{0,80}atestado/],
];
// Certidão de falência só quando o texto pede a certidão; "declaração ... falência" continua sem tipo.
const CERTIDAO_FALENCIA = /certidao[^.;]{0,60}(?:falencia|recuperacao judicial|concordata)/;
// Sem tipo fixo correspondente ou não é documento da empresa.
const SEM_TIPO = /declara|falencia|recuperacao judicial|concordata|visita|vistoria|dispensad/;
const CATEGORIAS_SEM_TIPO = new Set(["declaracao", "proposta", "amostra", "visita", "garantia", "credenciamento"]);

function tipoDocumentoDaExigencia(texto, categoria) {
  if (CATEGORIAS_SEM_TIPO.has(categoria)) return null;
  // Órgãos com "federal/estadual" no nome não indicam a esfera da certidão.
  const t = simples(texto).replace(/caixa economica federal|lei federal|governo federal|justica (?:federal|estadual)|distrito federal/g, " ");
  if (t && CERTIDAO_FALENCIA.test(t) && !/declara|dispensad/.test(t)) return "Certidão de falência";
  if (!t || SEM_TIPO.test(t)) return null;
  const tipos = TIPOS_DOCUMENTO.filter(([, re]) => re.test(t)).map(([tipo]) => tipo);
  // Mais de um tipo numa frase ("Fazenda Federal, Estadual e Municipal"): não dá para cruzar um só.
  return tipos.length === 1 ? tipos[0] : null;
}

// Lista padrão da Lei 14.133: declarações do art. 63, certidões, balanço, atos constitutivos e atestado.
// Termos do art. 63 sem exigir "declara" antes: no edital eles vêm em alíneas soltas ("declarará que: a) não emprega
// menor…") ou com "declarar" depois ("microempresa… deverá declarar").
const PADRAO_14133 = [
  /menor de (?:18|dezoito|16|dezesseis)|trabalho (?:noturno|infantil|forcado|degradante)|xxxiii|reserva de cargos|deficiencia|reabilitado|requisitos de habilitacao|veracidade|direitos trabalhistas|microempresa|pequeno porte|cooperativa|fato impeditivo|elaboracao independente|integralidade dos custos|ciente e concorda|\bsicaf\b|campo proprio do sistema/,
  /fgts|cndt|debitos (?:trabalhistas|estaduais|municipais|federais)|receita federal|divida ativa da uniao|tributos federais|fazenda (?:estadual|municipal)|regularidade fiscal|cnpj|inscricao (?:estadual|municipal)/,
  /balanco patrimonial|demonstracoes contabeis|falencia|recuperacao judicial|liquidez (?:geral|corrente)|solvencia geral/,
  /contrato social|ato constitutivo|estatuto|registro comercial|empresario individual|junta comercial/,
  /atestado|capacidade tecnica/,
  /proposta (?:de precos|comercial|ajustada|readequada)|validade da proposta|planilha de (?:custos|precos)|credenciamento|procuracao/,
];
// Verbo de pedido (não o substantivo "apresentação das propostas"); condição, faculdade e sanção não são exigência.
const PEDIDO = /apresentar|apresente|apresentem|apresentara|comprovar|comprove|declarar|declaracao de que|certidao|certificado|licenca|alvara|registro (?:no|na|em|junto)|laudo|atestado|anexar/;
const FACULDADE = /\bpoder(?:a|ao)\b|facultad|\bcaso\b|na hipotese|quando permitid|reconsideracao|recurso|sancao|penalidade/;
const UFS = { AC: "acre", AL: "alagoas", AP: "amapa", AM: "amazonas", BA: "bahia", CE: "ceara", DF: "distrito federal", ES: "espirito santo",
  GO: "goias", MA: "maranhao", MT: "mato grosso", MS: "mato grosso do sul", MG: "minas gerais", PA: "para", PB: "paraiba", PR: "parana",
  PE: "pernambuco", PI: "piaui", RJ: "rio de janeiro", RN: "rio grande do norte", RS: "rio grande do sul", RO: "rondonia", RR: "roraima",
  SC: "santa catarina", SP: "sao paulo", SE: "sergipe", TO: "tocantins" };
const ehTROuMinuta = (o) => o.minuta || /termo.?de.?refer|\btr\b|minuta|contrato/i.test(o.documento || "");

function ufsCitadas(original, t) {
  const porNome = Object.entries(UFS).filter(([uf, nome]) => new RegExp(`(?:estado|governo) d[eoa] ${nome}\\b${uf === "MT" ? "(?! do sul)" : ""}`).test(t)).map(([uf]) => uf);
  const porSigla = [...String(original).matchAll(/(?:[-/]\s?|\()([A-Z]{2})\b/g)].map((m) => m[1]).filter((uf) => UFS[uf]);
  return [...new Set([...porNome, ...porSigla])];
}

function motivosIncomuns(e, ufSede) {
  const t = simples(e.trecho && !simples(e.trecho).includes(simples(e.texto)) ? `${e.texto} ${e.trecho}` : e.trecho || e.texto);
  const motivos = [];
  // "Fora da lista" só conta quando a cláusula pede algo à empresa; regra de sessão, lance ou faculdade ("poderá") não é exigência incomum.
  if (!PADRAO_14133.some((re) => re.test(t)) && PEDIDO.test(t) && !FACULDADE.test(t)) motivos.push("fora da lista padrão da Lei 14.133");
  if (/amostra/.test(t)) motivos.push("exige amostra");
  if (/visita|vistoria/.test(t) && /obrigat/.test(t) && !/facultativ/.test(t)) motivos.push("visita técnica obrigatória");
  if (/garantia (?:de|da) (?:proposta|participacao)/.test(t)) motivos.push("garantia de proposta");
  if (/atestado|capacidade tecnica/.test(t)) {
    const acima = [...t.matchAll(/(\d+(?:,\d+)?)\s*%/g)].map((m) => Number(m[1].replace(",", "."))).filter((v) => v > 50);
    if (acima.length) motivos.push(`atestado com percentual acima de 50% (${acima.join("%, ")}%)`);
  }
  if (/indice|liquidez|solvencia|endividamento/.test(t)) {
    const valores = [...t.matchAll(/(?:>=|≥|>|<=|≤|<|(?:superior|inferior|maior|menor)(?:es)? (?:a|que))\s*(\d+(?:,\d+)?)/g)].map((m) => Number(m[1].replace(",", ".")));
    if (/endividamento|liquidez imediata|liquidez seca|capital circulante|rentabilidade/.test(t) || valores.some((v) => v !== 1)) {
      motivos.push(`índice financeiro diferente de LG/SG/LC ≥ 1${valores.some((v) => v !== 1) ? ` (${valores.join("; ")})` : ""}`);
    }
  }
  if (/registro (?:no|em|junto ao|perante o|na entidade) (?:conselho|crea|cau|crq|crf|crm|crmv|cra|crn|crc|cro|coren)|conselho (?:regional|federal)/.test(t)) motivos.push("registro em conselho profissional");
  if (/certid|regularidade|inscricao|debitos/.test(t)) {
    const outras = ufsCitadas(t === simples(e.trecho) ? e.trecho : `${e.texto} ${e.trecho || ""}`, t).filter((uf) => uf !== ufSede);
    if (outras.length) motivos.push(ufSede ? `certidão de UF diferente da sede (${outras.join(", ")}; sede ${ufSede})` : `certidão cita UF ${outras.join(", ")}; UF da sede não informada para comparar`);
  }
  if (/entreg/.test(t)) {
    const prazos = [...t.matchAll(/(?:prazo|em ate|no maximo|dentro de)[^.;]{0,60}?(\d+)\s*(?:\([^)]*\)\s*)?(dias|horas)/g)]
      .filter((m) => (m[2] === "horas" ? Number(m[1]) <= 120 : Number(m[1]) <= 5));
    if (prazos.length) motivos.push(`prazo de entrega curto (${prazos[0][1]} ${prazos[0][2]})`);
  }
  if (e.ocorrencias?.length && e.ocorrencias.every(ehTROuMinuta)) motivos.push(`só aparece em ${[...new Set(e.ocorrencias.map((o) => o.documento))].join(", ")} (minuta/TR)`);
  return motivos;
}

function marcarIncomuns(exigencias, { ufSede } = {}) {
  const uf = typeof ufSede === "string" ? ufSede.trim().toUpperCase() : "";
  const marcadas = (Array.isArray(exigencias) ? exigencias : []).map((e) => {
    const motivos = motivosIncomuns(e, uf);
    return { ...e, incomum: motivos.length > 0, motivoIncomum: motivos.length ? motivos.join("; ") : null };
  });
  // Incomum sobe ao topo; sort estável preserva a ordem da fonte dentro de cada grupo.
  return marcadas.sort((a, b) => Number(b.incomum) - Number(a.incomum));
}

function separarPorDocumento(textoFonte) {
  const saida = {};
  for (const parte of String(textoFonte || "").split(/^(?=--- .+ ---$)/m)) {
    const nome = parte.match(/^--- (.+) ---$/m)?.[1] || (parte.trim() ? "Documento oficial" : null);
    if (nome) saida[nome] = (saida[nome] || "") + parte.replace(/^--- .+ ---$/m, "");
  }
  return saida;
}

function paginasDoDocumento(texto) {
  const partes = String(texto || "").split(/^\[Página (\d+)\]\s*$/m);
  const paginas = partes[0].trim() ? [{ pagina: "", texto: partes[0] }] : [];
  for (let i = 1; i < partes.length; i += 2) paginas.push({ pagina: partes[i], texto: partes[i + 1] || "" });
  return paginas;
}

function nomeDoRegistro(registro, conhecidos) {
  const texto = String(registro);
  return texto.match(/^(.*?\(#\d+\))/)?.[1].trim() || conhecidos.find((nome) => texto.startsWith(nome)) || null;
}

function alertaDaPagina(documento, { pagina, texto: t, achado }, forca) {
  const local = pagina ? `na pág. ${pagina}` : "no texto (sem marcação de página)";
  return { documento, pagina, gatilho: achado[0], forca, trecho: t.slice(Math.max(0, achado.index - 150), achado.index + 250).trim(),
    mensagem: `o ${documento} cita "${achado[0]}" ${local}, nenhuma exigência extraída` };
}

function alertasDeGatilho(documento, texto, associadas) {
  const paginas = paginasDoDocumento(texto);
  const temExigencia = (pagina) => associadas.some((e) => (e.documento === documento && e.pagina === pagina) ||
    e.ocorrencias?.some((o) => o.documento === documento && o.pagina === pagina));
  const fortes = paginas.map((p) => ({ ...p, achado: p.texto.match(GATILHO_FORTE) })).filter((p) => p.achado && !temExigencia(p.pagina));
  if (fortes.length > MAX_ALERTAS_POR_DOCUMENTO) {
    // Agrupa para não inundar o painel, sem esconder nenhuma página.
    const primeiro = alertaDaPagina(documento, fortes[0], "forte");
    const lista = fortes.map((p) => p.pagina).join(", ");
    return [{ ...primeiro, paginasComGatilho: fortes.map((p) => p.pagina),
      mensagem: `o ${documento} tem ${fortes.length} páginas com gatilho forte e nenhuma exigência extraída (págs. ${lista})` }];
  }
  if (fortes.length) return fortes.map((p) => ({ ...alertaDaPagina(documento, p, "forte"), paginasComGatilho: [p.pagina] }));
  if (associadas.length) return [];
  const fracas = paginas.map((p) => ({ ...p, achado: p.texto.match(GATILHO_FRACO) })).filter((p) => p.achado);
  return fracas.length ? [{ ...alertaDaPagina(documento, fracas[0], "fraco"), paginasComGatilho: fracas.map((p) => p.pagina) }] : [];
}

function coberturaPorDocumento({ documentos, exigencias = [], textoPorDocumento = {} } = {}) {
  const lidos = Array.isArray(documentos?.documentosLidos) ? documentos.documentosLidos : [];
  const naoLidos = Array.isArray(documentos?.documentosNaoLidos) ? documentos.documentosNaoLidos : [];
  const pendenciasGerais = documentos ? [] : ["Cobertura de leitura não informada: não dá para afirmar que todos os anexos foram lidos."];
  const textos = textoPorDocumento && typeof textoPorDocumento === "object" ? textoPorDocumento : {};
  const registros = new Map();
  const registro = (nome) => registros.get(nome) || registros.set(nome, { lido: false, pendencias: [] }).get(nome);
  for (const r of lidos) registro(String(r).match(/^(.*?\(#\d+\))/)?.[1].trim() || String(r).split(/:\s/)[0].trim()).lido = true;
  for (const nome of Object.keys(textos)) registro(nome);
  const conhecidos = [...registros.keys()].sort((a, b) => b.length - a.length);
  for (const r of naoLidos) {
    const nome = nomeDoRegistro(r, conhecidos);
    if (nome) registro(nome).pendencias.push(String(r).slice(nome.length).replace(/^[:,]\s*/, "") || String(r));
    else pendenciasGerais.push(String(r));
  }
  const alertas = [];
  const lista = [...registros].map(([documento, { lido, pendencias }]) => {
    const texto = textos[documento];
    if (typeof texto !== "string" || !texto.trim()) {
      return { documento, estado: "nao_lido", motivo: pendencias.join("; ") || (lido ? "listado como lido, mas sem texto disponível para conferência" : "sem texto extraído") };
    }
    const associadas = exigencias.filter((e) => e.documento === documento || e.ocorrencias?.some((o) => o.documento === documento));
    alertas.push(...alertasDeGatilho(documento, texto, associadas));
    const paginas = paginasDoDocumento(texto).length;
    return pendencias.length ? { documento, estado: "parcial", motivo: pendencias.join("; "), exigencias: associadas.length }
      : { documento, estado: "lido", motivo: `texto extraído (${paginas} página(s))`, exigencias: associadas.length };
  });
  return { documentos: lista, alertas, pendenciasGerais };
}

function estadoDaEtapa(cobertura) {
  const docs = Array.isArray(cobertura?.documentos) ? cobertura.documentos : [];
  const lidos = docs.filter((d) => d.estado === "lido").map((d) => d.documento);
  const naoLidos = docs.filter((d) => d.estado !== "lido").map(({ documento, estado, motivo }) => ({ documento, estado, motivo }));
  const pendenciasGerais = Array.isArray(cobertura?.pendenciasGerais) ? cobertura.pendenciasGerais : [];
  const bloqueios = [...naoLidos.map((d) => `Não consegui ler${d.estado === "parcial" ? " por completo" : ""} o anexo ${d.documento}: ${d.motivo}.`), ...pendenciasGerais];
  if (!docs.length) bloqueios.push("Nenhum documento foi lido.");
  return { estado: bloqueios.length ? "aguardando_leitura" : "pronto", lidos, naoLidos, pendenciasGerais,
    alertas: Array.isArray(cobertura?.alertas) ? cobertura.alertas : [],
    mensagem: bloqueios.length ? bloqueios.join(" ") : `Todos os ${lidos.length} documento(s) foram lidos: ${lidos.join(", ")}.` };
}

function blocosParaSegundaPassada(textoPorDocumento, { tamanhoBloco = 1200, limiteTotal = 60000 } = {}) {
  const blocos = [], omitidos = [];
  let total = 0;
  for (const [documento, texto] of Object.entries(textoPorDocumento || {})) {
    for (const { pagina, texto: t } of paginasDoDocumento(texto)) {
      let fimAnterior = -1;
      for (const m of t.matchAll(new RegExp(GATILHO.source, "gi"))) {
        if (m.index < fimAnterior) { blocos.at(-1)?.gatilhos.push(m[0]); continue; }
        const inicio = Math.max(0, m.index - tamanhoBloco / 2);
        const trecho = t.slice(inicio, inicio + tamanhoBloco).trim();
        fimAnterior = inicio + tamanhoBloco;
        // Bloco que não cabe no orçamento é registrado, nunca descartado em silêncio.
        if (total + trecho.length > limiteTotal) { omitidos.push({ documento, pagina, gatilho: m[0] }); fimAnterior = -1; continue; }
        total += trecho.length;
        blocos.push({ documento, pagina, gatilhos: [m[0]], texto: trecho });
      }
    }
  }
  return { blocos, omitidos };
}

function validarSegundaPassada(resposta, textoFonte) {
  const itens = Array.isArray(resposta) ? resposta : Array.isArray(resposta?.exigencias) ? resposta.exigencias : null;
  if (!itens) return { aceitas: [], descartadas: [{ item: resposta, motivo: "resposta da segunda passada sem lista de exigências" }] };
  const semMarcadores = (t) => normalizar(String(t || "").replace(/^\[Página \d+\]$|^--- .+ ---$/gm, " "));
  const fonte = semMarcadores(textoFonte);
  const porDocumento = separarPorDocumento(textoFonte);
  const aceitas = [], descartadas = [];
  for (const item of itens) {
    const trecho = normalizar(item?.trechoLiteral);
    let motivo = null;
    if (trecho.length < 20) motivo = "trecho literal ausente ou curto demais para conferir";
    else if (!fonte.includes(trecho)) motivo = "trecho literal não existe na fonte";
    else if (item.documento && porDocumento[item.documento] && !semMarcadores(porDocumento[item.documento]).includes(trecho)) motivo = "trecho existe na fonte, mas não no documento citado";
    if (motivo) descartadas.push({ item, motivo });
    else aceitas.push({ ...item, origem: "segunda_passada", estado: "encontrado" });
  }
  return { aceitas, descartadas };
}

module.exports = { codigoEstavel, juntarExigencias, classificar, marcarIncomuns, coberturaPorDocumento, estadoDaEtapa,
  blocosParaSegundaPassada, validarSegundaPassada, separarPorDocumento, tipoDocumentoDaExigencia };
