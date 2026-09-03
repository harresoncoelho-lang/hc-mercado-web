// Netlify Function: Resumo do Edital + Pergunte ao Edital (Fase 1 do roadmap de novas
// ferramentas, inspirado no ConLicitação).
//
// Usa a Groq API (modelos Llama, gratuita — sem cartão de crédito, sem cobrança por uso,
// limite generoso de 14.400 consultas/dia) pra explicar a licitação.
//
// v2: agora tenta ler o PDF de verdade do edital (via API pública do PNCP, sem token) e
// gerar um resumo ESTRUTURADO em seções (igual ao que o ConLicitação faz), em vez de só um
// parágrafo curto baseado nos campos que já tínhamos coletado. Se não der pra achar/baixar/
// ler o PDF (edital de outro portal que não o PNCP, arquivo não é PDF, demorou demais etc.),
// cai de volta pro resumo simples baseado só nos campos já coletados — sempre com aviso
// deixando claro se leu o PDF completo ou não.
//
// Uso: POST /.netlify/functions/ia-edital
// Body: { modo: "resumo"|"pergunta", edital: {...}, pergunta?, historico?, textoEdital? }
// Resposta: { resposta, estrutura: {...}|null, textoEdital: string|null, fonteLida: bool, erro }

// O Llama 3.1 8B foi aposentado para contas free/developer do Groq em 16/08/2026. O
// substituto oficial recomendado é o GPT-OSS 20B, que é mais capaz para extração de
// edital e continua compatível com o endpoint OpenAI e JSON Object Mode usados aqui.
// Mantemos GROQ_MODEL como override, mas nunca deixamos um valor antigo derrubar o robô:
// chamarGroq tenta automaticamente o modelo suportado se o override retornar "model not
// found". Isso evita uma nova indisponibilidade silenciosa numa próxima migração do provedor.
const MODELO_PADRAO = "openai/gpt-oss-20b";
const MODELO = process.env.GROQ_MODEL || MODELO_PADRAO;
const CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const PNCP_ARQUIVOS_URL = "https://pncp.gov.br/api/pncp/v1/orgaos";
const PNCP_ARQUIVO_URL = "https://pncp.gov.br/pncp-api/v1/orgaos";
// Um edital raramente cabe nos primeiros 8 mil caracteres: habilitação, multas,
// pagamento e anexos normalmente ficam no meio/fim do documento. O limite abaixo dá
// contexto suficiente para uma análise operacional sem estourar o tempo da Function.
const MAX_CARACTERES_TEXTO = 24000;
const VERSAO_RESUMO = 2;
const { cabecalhosPadrao, exigirUsuarioLogado, verificarLimiteDiario } = require("./_auth");

// Ver nota em pncp-proxy.js: alguns endpoints do PNCP resetam a conexão sem User-Agent de
// navegador. Manda em todo fetch pro PNCP por segurança.
const USER_AGENT_NAVEGADOR =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function montarFichaEdital(edital) {
  const campos = [
    ["Objeto", edital.objeto],
    ["Órgão", edital.orgao],
    ["Município/UF", [edital.municipio, edital.uf].filter(Boolean).join(" / ")],
    ["Fonte", edital.fonte || "PNCP"],
    ["Nº do processo / controle", edital.numeroControlePNCP || edital.numero],
    ["Publicado em", edital.publicacao],
    ["Prazo final de propostas", edital.encerramento],
    ["Valor estimado", edital.valor],
  ];
  return campos
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([rotulo, v]) => `${rotulo}: ${v}`)
    .join("\n");
}

// Extrai {cnpj, ano, sequencial} de um numeroControlePNCP no formato
// {cnpjOrgao}-{tipoInstrumento}-{sequencial}/{ano}
function partesNumeroControle(numeroControlePNCP) {
  if (!numeroControlePNCP) return null;
  try {
    const partes = numeroControlePNCP.split("-");
    if (partes.length < 3) return null;
    const cnpj = partes[0];
    const seqAno = partes.slice(2).join("-");
    const [seq, ano] = seqAno.split("/");
    if (!cnpj || !seq || !ano) return null;
    return { cnpj, ano: parseInt(ano, 10), sequencial: parseInt(seq, 10) };
  } catch (e) {
    return null;
  }
}

// Palavras-chave dos documentos que realmente interessam pro resumo, cobrindo as
// modalidades mais comuns (pregão, concorrência, credenciamento, carta convite/carta-
// convite, dispensa, inexigibilidade, chamamento público, RDC etc.) — cada portal/órgão
// nomeia o documento principal de um jeito diferente, então a lista é ampla de propósito.
const PALAVRAS_DOCUMENTO_PRINCIPAL = /edital|aviso|instrumento convocat[oó]rio|termo de refer[eê]ncia|projeto b[aá]sico|carta[- ]convite|credenciamento|dispensa|inexigibilidade|chamamento|contrata[çc][ãa]o direta/i;

// Extrai {cnpj, ano, sequencial} de um numeroControlePNCP no formato
async function buscarTextoEdital(numeroControlePNCP) {
  const partes = partesNumeroControle(numeroControlePNCP);
  if (!partes) return { texto: null, escaneado: false };
  try {
    const ctrl1 = new AbortController();
    const t1 = setTimeout(() => ctrl1.abort(), 8000);
    const respLista = await fetch(`${PNCP_ARQUIVOS_URL}/${partes.cnpj}/compras/${partes.ano}/${partes.sequencial}/arquivos`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT_NAVEGADOR },
      signal: ctrl1.signal,
    });
    clearTimeout(t1);
    if (!respLista.ok) return { texto: null, escaneado: false };
    const lista = await respLista.json();
    if (!Array.isArray(lista) || lista.length === 0) return { texto: null, escaneado: false };

    // O documento principal nem sempre se chama "Edital" (pode ser "Aviso de Contratação
    // Direta", "Aviso de Dispensa", "Carta Convite", "Instrumento de Credenciamento" etc.
    // dependendo da modalidade), e o título do arquivo quase nunca termina em ".pdf" de
    // verdade (o PNCP costuma cortar a extensão). Então, em vez de tentar adivinhar pelo
    // nome, prioriza por palavra-chave conhecida (cobrindo todas as modalidades) e, na
    // falta dela, tenta os documentos na ordem em que aparecem — a validação real de "é um
    // PDF" acontece depois, olhando a assinatura binária do arquivo baixado.
    const prioritarios = lista.filter((a) => PALAVRAS_DOCUMENTO_PRINCIPAL.test(a.tipoDocumentoNome || a.tipoDocumentoDescricao || a.titulo || ""));
    const vistos = new Set();
    const candidatos = [...prioritarios, ...lista]
      .filter((a) => {
        if (vistos.has(a.sequencialDocumento)) return false;
        vistos.add(a.sequencialDocumento);
        return true;
      })
      .slice(0, 12);
    if (candidatos.length === 0) return { texto: null, escaneado: false };

    // Cada require isolado no seu próprio try/catch: se adm-zip ou mammoth falharem por
    // qualquer motivo (ex.: problema de empacotamento no Netlify), a leitura de PDF puro —
    // o caso mais comum, de longe — continua funcionando normalmente em vez de quebrar tudo.
    let pdfParse = null, AdmZip = null, mammoth = null;
    try { pdfParse = require("pdf-parse"); } catch (e) { /* sem isso não dá pra ler nada */ }
    try { AdmZip = require("adm-zip"); } catch (e) { /* sem isso só perde o suporte a .zip */ }
    try { mammoth = require("mammoth"); } catch (e) { /* sem isso só perde o suporte a .docx */ }
    if (!pdfParse) return { texto: null, escaneado: false };

    // Tenta extrair texto de um PDF já em memória (usado tanto pro arquivo baixado direto
    // quanto pra PDFs que estavam dentro de um .zip).
    let algumPdfPareceEscaneado = false;
    async function textoDePdf(buffer) {
      if (buffer.slice(0, 5).toString("latin1") !== "%PDF-") return null;
      const resultado = await pdfParse(buffer);
      const texto = (resultado.text || "").replace(/\s+/g, " ").trim();
      if (texto && texto.length >= 200) return texto;
      // PDF de verdade (assinatura confere e abriu sem erro), mas quase sem texto — é sinal
      // forte de que é um documento escaneado/fotografado (imagem das páginas), não texto
      // pesquisável. OCR resolveria, mas exige infraestrutura que não temos disponível hoje
      // (rasterização de PDF depende de programas de sistema que o Netlify não oferece).
      if (resultado.numpages && resultado.numpages > 0) algumPdfPareceEscaneado = true;
      return null;
    }

    // Tenta extrair texto de um .docx (Word moderno) já em memória. Muitos órgãos publicam
    // o edital em Word em vez de PDF — e como .docx é, por baixo dos panos, um .zip (formato
    // OOXML), ele também passa no teste de assinatura "PK\x03\x04" usado pra detectar zip.
    async function textoDeDocx(buffer) {
      if (!mammoth) return null;
      try {
        const resultado = await mammoth.extractRawText({ buffer });
        const texto = (resultado.value || "").replace(/\s+/g, " ").trim();
        return texto && texto.length >= 200 ? texto : null;
      } catch (e) {
        return null;
      }
    }

    // Devolve uma lista de textos extraídos de um arquivo baixado. Cobre 4 formatos comuns
    // nos portais de licitação: PDF puro, .docx puro (que também é um .zip por dentro, então
    // tem que ser checado ANTES do zip genérico), .zip compactando um ou mais PDFs/.docx
    // (comum no LICITANET e outros portais que "empacotam" o edital antes de subir no PNCP).
    async function textosDoArquivo(buffer) {
      const assinatura4 = buffer.slice(0, 4);
      const ehPdf = buffer.slice(0, 5).toString("latin1") === "%PDF-";
      const ehZip = assinatura4[0] === 0x50 && assinatura4[1] === 0x4b && (assinatura4[2] === 0x03 || assinatura4[2] === 0x05 || assinatura4[2] === 0x07);

      if (ehPdf) {
        const texto = await textoDePdf(buffer);
        return texto ? [texto] : [];
      }

      if (ehZip) {
        if (!AdmZip) return [];
        try {
          const zip = new AdmZip(buffer);
          const nomesEntradas = zip.getEntries().map((e) => e.entryName);
          // Um .docx é internamente um .zip com "word/document.xml" dentro — se achar essa
          // marca, o arquivo inteiro É o documento (não uma coleção de arquivos pra abrir).
          const ehDocxDisfarcadoDeZip = nomesEntradas.some((n) => n === "word/document.xml");
          if (ehDocxDisfarcadoDeZip) {
            const texto = await textoDeDocx(buffer);
            return texto ? [texto] : [];
          }

          const entradas = zip.getEntries().filter((e) => !e.isDirectory && /\.(pdf|docx)$/i.test(e.entryName));
          const prioritariasZip = entradas.filter((e) => PALAVRAS_DOCUMENTO_PRINCIPAL.test(e.entryName));
          const ordemZip = [...prioritariasZip, ...entradas.filter((e) => !prioritariasZip.includes(e))];
          const textos = [];
          for (const entrada of ordemZip.slice(0, 12)) {
            try {
              const conteudo = entrada.getData();
              const texto = /\.docx$/i.test(entrada.entryName) ? await textoDeDocx(conteudo) : await textoDePdf(conteudo);
              if (texto) textos.push(texto);
            } catch (eInterno) {
              // tenta o próximo arquivo dentro do zip
            }
          }
          return textos;
        } catch (eZip) {
          return []; // zip corrompido ou não suportado
        }
      }

      return []; // não é PDF, docx nem zip reconhecível (pode ser .doc antigo/.rar/.xlsx)
    }

    // Junta texto de vários documentos (edital + termo de referência, por exemplo) até
    // atingir o limite de caracteres, em vez de parar no primeiro PDF que der certo — assim
    // o resumo cobre informação que às vezes só está no Termo de Referência, e não no Edital
    // em si (ou vice-versa).
    const pedacos = [];
    let totalCaracteres = 0;
    for (const doc of candidatos) {
      if (totalCaracteres >= MAX_CARACTERES_TEXTO) break;
      try {
        const ctrl2 = new AbortController();
        const t2 = setTimeout(() => ctrl2.abort(), 15000);
        const respArquivo = await fetch(`${PNCP_ARQUIVO_URL}/${partes.cnpj}/compras/${partes.ano}/${partes.sequencial}/arquivos/${doc.sequencialDocumento}`, {
          headers: { "User-Agent": USER_AGENT_NAVEGADOR },
          signal: ctrl2.signal,
        });
        clearTimeout(t2);
        if (!respArquivo.ok) continue;
        const buffer = Buffer.from(await respArquivo.arrayBuffer());
        const textos = await textosDoArquivo(buffer);
        for (const texto of textos) {
          const rotulo = (doc.tipoDocumentoNome || doc.titulo || "Documento").toString();
          pedacos.push(`\n\n--- ${rotulo} ---\n${texto}`);
          totalCaracteres += texto.length;
        }
      } catch (e) {
        // tenta o próximo candidato
      }
    }

    if (pedacos.length === 0) return { texto: null, escaneado: algumPdfPareceEscaneado };
    return { texto: pedacos.join("").trim().slice(0, MAX_CARACTERES_TEXTO), escaneado: false };
  } catch (e) {
    return { texto: null, escaneado: false };
  }
}

const REGRAS_BASE = `Você é um analista de licitações experiente que ajuda pequenas e médias empresas brasileiras a entender oportunidades de licitação pública, dentro da ferramenta HC Licitações.
- Nunca invente exigência, documento, cláusula, penalidade, prazo ou valor que não esteja explicitamente nos dados fornecidos. Quando uma informação não estiver disponível, use exatamente o texto "Não informado".
- Responda sempre em português do Brasil, direto e em linguagem simples.
- Quando tiver o texto completo do edital, seja EXAUSTIVO: extraia o máximo de informação possível de cada campo, com detalhes concretos (números, prazos, valores, percentuais, nomes) em vez de generalidades. Não resuma demais — o usuário quer análise completa, não um resumo curto.`;

const SCHEMA_ESTRUTURA = `{
  "identificacao": {"objeto": "", "numero": "", "uasg": "", "contratacao": "", "modalidade": "", "portalRealizacao": "", "regulamentacao": ""},
  "sessaoPublica": {"data": "", "horario": "", "modoDisputa": "", "intervaloMinimo": ""},
  "orgao": {"nome": "", "email": "", "endereco": "", "telefone": ""},
  "detalhes": {"valorEstimado": "", "prazoEntrega": "", "margemPreferencia": "", "exigeVisitaTecnica": "", "exigeAmostra": "", "garantia": "", "criterioJulgamento": "", "preferenciaMeEpp": "", "restricoesRegionalidade": "", "provaConceito": ""},
  "garantias": {"proposta": "", "contrato": "", "adicional": "", "retomada": ""},
  "entregaExecucao": {"prazo": "", "local": "", "condicoes": ""},
  "prazos": {"limiteEnvioPropostas": "", "prazoDocumentoComplementar": "", "prazoDocumentoOriginal": "", "prazoRecurso": "", "prazoContrarrazoes": "", "limiteEsclarecimentos": "", "limiteImpugnacao": "", "vigenciaContrato": ""},
  "criteriosProposta": {"validadeProposta": "", "criteriosDesempate": "", "exigenciasPropostaComercial": "", "programaIntegridade": ""},
  "itens": {"totalItens": "", "descricaoGeral": "", "categoriasPrincipais": "", "observacoes": ""},
  "documentosHabilitacao": ["lista de documentos exigidos, um por item; incluir certidões, registros, balanços e atestados com a condição ou prazo quando houver"],
  "atestadoCapacidadeTecnica": "",
  "legislacao": "",
  "anexosDeclaracoes": "",
  "declaracoesExigidas": ["cada declaração ou formulário exigido, um por item"],
  "condicoesPagamento": "",
  "penalidades": "",
  "multas": "",
  "documentosConsultados": ["nomes dos documentos efetivamente lidos"],
  "pendenciasParaConferencia": ["itens que NÃO foram localizados no material lido e precisam ser conferidos no edital oficial; não use esta lista para repetir dados encontrados"],
  "questionamentosSugeridos": ["perguntas objetivas para esclarecimento/impugnação apenas quando houver ambiguidade, conflito ou ausência material relevante"],
  "possiveisQuestionamentos": ["cada item deve trazer: título — motivo concreto — referência ao trecho ou cláusula; só inclua se houver base no texto"],
  "outrasInformacoesRelevantes": ["lista de TODOS os pontos importantes do texto que não se encaixam nos campos acima — não limite a quantidade, inclua tudo que for relevante pra quem vai decidir participar"],
  "analiseCritica": {"conflitoObjetoMinuta": "", "conflitoPrazoVigenciaArp": "", "conflitoPrazosEntrega": "", "permiteSubcontratacao": "", "previsaoReajuste": "", "permiteRenovacao": "", "estabeleceCondicoesPagamento": ""},
  "resumoGeral": "resumo corrido e DETALHADO (8 a 14 frases), cobrindo objeto completo, órgão, valor, modalidade, datas/prazos, principais exigências de habilitação, forma de disputa e critério de julgamento — não é pra ser curto, é pra ser uma análise completa da oportunidade, como um analista de licitações faria pra um cliente"
}`;

async function chamarGroq(apiKey, mensagens, opts) {
  const modelos = [...new Set([MODELO, MODELO_PADRAO])];
  for (let indice = 0; indice < modelos.length; indice += 1) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), (opts && opts.timeoutMs) || 20000);
    try {
      const body = { model: modelos[indice], max_tokens: (opts && opts.maxTokens) || 500, messages: mensagens };
      if (opts && opts.json) body.response_format = { type: "json_object" };
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        const dados = await resp.json();
        const texto = ((dados.choices || [])[0] && dados.choices[0].message && dados.choices[0].message.content || "").trim();
        return { ok: true, texto, modelo: modelos[indice] };
      }
      const corpoErro = await resp.text();
      if (resp.status === 429) {
        return { ok: false, erro: "O robô de IA atingiu o limite de uso disponível agora. Tente novamente mais tarde; os dados básicos da licitação continuam acessíveis." };
      }
      const modeloIndisponivel = resp.status === 404 && /model_not_found|does not exist|not available/i.test(corpoErro);
      if (modeloIndisponivel && indice < modelos.length - 1) continue;
      return { ok: false, erro: `Falha ao consultar a IA (${resp.status}): ${corpoErro.slice(0, 200)}` };
    } catch (e) {
      return { ok: false, erro: `Erro ao consultar a IA: ${String((e && e.message) || e)}` };
    } finally {
      clearTimeout(t);
    }
  }
  return { ok: false, erro: "Não há um modelo de IA disponível para gerar o resumo agora." };
}

// Exposto somente para os testes unitários locais; a Netlify continua chamando handler.
exports.__test = { chamarGroq };

// Modelos menores (como o 8b gratuito que usamos) às vezes ignoram a instrução de "só
// JSON" e embrulham a resposta em ```json ... ``` ou colocam uma frase antes/depois. Em vez
// de falhar direto no JSON.parse, limpa esses wrappers comuns e, se ainda assim não der,
// tenta pegar só o trecho entre a primeira "{" e a última "}" da resposta.
function extrairJson(texto) {
  if (!texto) return null;
  let limpo = texto.trim();
  limpo = limpo.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(limpo);
  } catch (e) {
    const inicio = limpo.indexOf("{");
    const fim = limpo.lastIndexOf("}");
    if (inicio !== -1 && fim !== -1 && fim > inicio) {
      try {
        return JSON.parse(limpo.slice(inicio, fim + 1));
      } catch (e2) {
        return null;
      }
    }
    return null;
  }
}

function formatarEstruturaComoTexto(est) {
  const linha = (rotulo, v) => (v ? `${rotulo}: ${v}\n` : "");
  let txt = "";
  if (est.resumoGeral) txt += est.resumoGeral + "\n\n";
  if (est.detalhes) {
    txt += linha("Valor estimado", est.detalhes.valorEstimado);
    txt += linha("Prazo de entrega", est.detalhes.prazoEntrega);
    txt += linha("Critério de julgamento", est.detalhes.criterioJulgamento);
    txt += linha("Garantia exigida", est.detalhes.garantia);
  }
  return txt.trim();
}

exports.handler = async (event) => {
  const headers = cabecalhosPadrao(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ erro: "Use POST." }) };

  const sessao = await exigirUsuarioLogado(event);
  if (!sessao.ok) return { statusCode: sessao.status, headers, body: JSON.stringify({ erro: sessao.erro }) };
  const limite = await verificarLimiteDiario(sessao.userId, "ia-edital", 40);
  if (!limite.ok) return { statusCode: limite.status, headers, body: JSON.stringify({ erro: limite.erro }) };

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ erro: "GROQ_API_KEY não configurado no Netlify." }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ erro: "Corpo inválido." }) };
  }

  const { modo, edital, pergunta, historico } = body;
  let { textoEdital } = body;
  if (!edital || typeof edital !== "object") {
    return { statusCode: 400, headers, body: JSON.stringify({ erro: "Informe os dados do edital." }) };
  }

  const ficha = montarFichaEdital(edital);
  let fonteLida = false;
  let motivoFonteNaoLida = null; // "escaneado" | "indisponivel" | null

  // Cache: uma vez que a gente já leu e estruturou um edital, salva o resultado — assim,
  // igual o ConLicitação faz, abrir o resumo de novo (por qualquer pessoa, não só quem
  // pediu na primeira vez) é instantâneo, sem reler PDF nem gastar cota da IA de novo. Só
  // funciona pra editais do PNCP (que têm numeroControlePNCP como chave estável).
  let storeResumos = null;
  try {
    const { getStore } = require("@netlify/blobs");
    storeResumos = getStore("resumos-editais");
  } catch (e) {
    storeResumos = null; // sem cache disponível — segue funcionando normalmente, só mais devagar
  }

  if (modo === "resumo" && storeResumos && edital.numeroControlePNCP) {
    try {
      const cache = await storeResumos.get(edital.numeroControlePNCP, { type: "json" });
      // Aceita tanto o cache do resumo ESTRUTURADO (JSON, caminho ideal) quanto do resumo
      // em TEXTO CORRIDO (fallback, quando a extração em JSON não deu certo) — os dois têm
      // custo de IA pra gerar, então os dois precisam ficar em cache. Sem isso, todo edital
      // que cai no fallback reprocessava do zero A CADA vez que alguém abria o resumo de
      // novo, gastando cota da IA repetidamente à toa.
      // Resumos antigos eram texto corrido e não traziam o checklist completo. Só usa
      // cache da versão atual; assim uma evolução do dossiê chega para todos sem exigir
      // que cada pessoa descubra como limpar dados do navegador.
      if (cache && cache.versao === VERSAO_RESUMO && (cache.estrutura || cache.resposta)) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            resposta: cache.resposta || "Resumo gerado.",
            estrutura: cache.estrutura || null,
            textoEdital: cache.textoEdital || null,
            fonteLida: cache.fonteLida !== undefined ? cache.fonteLida : true,
            motivoFonteNaoLida: cache.motivoFonteNaoLida || null,
            doCache: true,
            erro: null,
          }),
        };
      }
    } catch (e) {
      // cache indisponível ou corrompido — segue pro fluxo normal (lê/analisa de novo)
    }
  }

  // Só tenta buscar o PDF na primeira chamada (resumo) — perguntas seguintes reaproveitam
  // o texto já extraído, que o frontend manda de volta em body.textoEdital.
  if (modo === "resumo" && !textoEdital && edital.numeroControlePNCP) {
    const resultadoBusca = await buscarTextoEdital(edital.numeroControlePNCP);
    if (resultadoBusca.texto) {
      textoEdital = resultadoBusca.texto;
      fonteLida = true;
    } else {
      motivoFonteNaoLida = resultadoBusca.escaneado ? "escaneado" : "indisponivel";
    }
  } else if (textoEdital) {
    fonteLida = true;
  }

  if (modo === "pergunta") {
    if (!pergunta || !pergunta.trim()) {
      return { statusCode: 400, headers, body: JSON.stringify({ erro: "Informe a pergunta." }) };
    }
    const contextoTexto = textoEdital
      ? `Trecho do texto do edital (fonte oficial, PNCP):\n${textoEdital}\n\n`
      : "Você NÃO tem o texto completo do edital, só os campos abaixo.\n\n";
    const mensagens = [{ role: "system", content: REGRAS_BASE }];
    if (Array.isArray(historico)) {
      for (const h of historico.slice(-6)) {
        if (h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string") {
          mensagens.push({ role: h.role, content: h.content });
        }
      }
    }
    mensagens.push({ role: "user", content: `${contextoTexto}Dados da oportunidade:\n${ficha}\n\nPergunta: ${pergunta.trim()}` });
    const r = await chamarGroq(apiKey, mensagens, { maxTokens: 600, timeoutMs: 20000 });
    if (!r.ok) return { statusCode: 502, headers, body: JSON.stringify({ erro: r.erro }) };
    return { statusCode: 200, headers, body: JSON.stringify({ resposta: r.texto, estrutura: null, textoEdital: textoEdital || null, fonteLida, motivoFonteNaoLida, erro: null }) };
  }

  // modo === "resumo"
  if (fonteLida) {
    const mensagensEstrutura = [
      { role: "system", content: `${REGRAS_BASE}\nVocê recebeu texto real extraído de documentos oficiais (edital, termo de referência e anexos). Produza um DOSSIÊ OPERACIONAL, não um parágrafo genérico. Leia o material inteiro e extraia os fatos ponto a ponto: datas, entrega, habilitação, declarações, legislação, julgamento, pagamento, garantias, penalidades/multas, anexos, riscos e prazos.\n\nRegra de evidência: só inclua um fato se ele estiver no texto fornecido. Se um campo não aparecer, escreva "Não informado". Use "pendenciasParaConferencia" para o que precisa de conferência; não invente cláusulas comuns de licitação. Em "questionamentosSugeridos", inclua apenas perguntas que tenham motivo explícito no texto (ambiguidade, contradição ou ausência relevante).\n\nDevolva SOMENTE um JSON válido (sem markdown, sem comentários, sem texto antes ou depois) no formato exato:\n${SCHEMA_ESTRUTURA}` },
      { role: "user", content: `Dados já conhecidos:\n${ficha}\n\nTexto extraído do edital (pode estar truncado):\n${textoEdital}` },
    ];
    // O modelo gratuito (8b) é mais fraco pra devolver JSON grande e válido de primeira —
    // tenta duas vezes antes de desistir e cair pro resumo em texto corrido.
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const r = await chamarGroq(apiKey, mensagensEstrutura, { maxTokens: 6500, timeoutMs: 28000, json: true });
      if (!r.ok) break; // erro de API (ex.: limite atingido) — não adianta tentar de novo
      const estrutura = extrairJson(r.texto);
      if (estrutura) {
        const resposta = formatarEstruturaComoTexto(estrutura) || "Resumo gerado.";
        // Salva no cache pra próxima vez (por qualquer pessoa) abrir instantâneo, sem
        // reprocessar. Se o cache não estiver disponível ou der erro, não trava o resumo —
        // o usuário atual já recebe a resposta normalmente de qualquer forma.
        if (storeResumos && edital.numeroControlePNCP) {
          try {
            await storeResumos.setJSON(edital.numeroControlePNCP, {
              estrutura,
              resposta,
              textoEdital,
              fonteLida: true,
              motivoFonteNaoLida: null,
              versao: VERSAO_RESUMO,
              geradoEm: new Date().toISOString(),
            });
          } catch (e) {
            // não crítico — só significa que não vai ficar em cache dessa vez
          }
        }
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            resposta,
            estrutura,
            textoEdital,
            fonteLida: true,
            motivoFonteNaoLida: null,
            erro: null,
          }),
        };
      }
      // IA não devolveu JSON válido nessa tentativa — tenta mais uma vez (ou desiste e
      // segue pro resumo em texto corrido abaixo, que ainda usa o texto real do edital).
    }
  }

  // Chegou aqui em dois cenários bem diferentes, e o texto importa:
  // 1) fonteLida=true: CONSEGUIMOS ler o PDF/docx, só a extração estruturada em JSON que
  //    falhou (formato inválido devolvido pela IA, ou limite de uso do Groq no momento).
  //    Não faz sentido jogar fora o texto real já lido — tenta de novo, agora pedindo um
  //    resumo em texto corrido (mais tolerante que JSON) usando o texto de verdade.
  // 2) fonteLida=false: nunca conseguimos o texto do documento — resumo baseado só nos
  //    campos estruturados que já tínhamos, deixando isso claro.
  const mensagens = fonteLida
    ? [
        { role: "system", content: REGRAS_BASE },
        { role: "user", content: `Dados já conhecidos:\n${ficha}\n\nTexto extraído do edital (pode estar truncado):\n${textoEdital}\n\nFaça um resumo DETALHADO (8 a 12 frases) dessa licitação, cobrindo objeto, órgão, valor, modalidade, prazos e principais exigências que aparecerem no texto.` },
      ]
    : [
        { role: "system", content: REGRAS_BASE + "\nVocê só tem os campos estruturados abaixo, não o PDF completo do edital — deixe isso claro se for relevante." },
        { role: "user", content: `Dados da oportunidade:\n${ficha}\n\nFaça um resumo curto (4 a 6 frases) explicando do que se trata essa licitação: o que está sendo comprado, quem compra, o prazo, e o porte aproximado pelo valor estimado (se houver).` },
      ];
  const r2 = await chamarGroq(apiKey, mensagens, { maxTokens: fonteLida ? 900 : 500, timeoutMs: 20000 });
  if (!r2.ok) return { statusCode: 502, headers, body: JSON.stringify({ erro: r2.erro }) };
  // Cacheia também o resumo em texto corrido (fallback) — sem isso, um edital que sempre
  // cai no fallback (ex.: modelo gratuito não consegue estruturar aquele texto em JSON)
  // reprocessava do zero toda vez que alguém abria o resumo de novo, gastando cota da IA
  // à toa. Só se aplica ao modo "resumo" (perguntas não têm cache, são sempre dinâmicas).
  if (modo === "resumo" && storeResumos && edital.numeroControlePNCP) {
    try {
      await storeResumos.setJSON(edital.numeroControlePNCP, {
        estrutura: null,
        resposta: r2.texto,
        textoEdital: textoEdital || null,
        fonteLida,
        motivoFonteNaoLida,
        versao: VERSAO_RESUMO,
        geradoEm: new Date().toISOString(),
      });
    } catch (e) {
      // não crítico — só significa que não vai ficar em cache dessa vez
    }
  }
  return { statusCode: 200, headers, body: JSON.stringify({ resposta: r2.texto, estrutura: null, textoEdital: textoEdital || null, fonteLida, motivoFonteNaoLida, erro: null }) };
};
