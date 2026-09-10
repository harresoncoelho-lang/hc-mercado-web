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
const MAX_CARACTERES_TEXTO = 22000;
// A Function tem uma janela de execução menor que a soma de vários downloads de
// anexos + duas tentativas longas de modelo. Um timeout do provedor não pode virar
// uma resposta HTML/504 que o navegador interpreta como "não conectou".
const MAX_DOCUMENTOS_PARA_LEITURA = 3;
const TIMEOUT_LISTA_PNCP_MS = 4000;
const TIMEOUT_ARQUIVO_PNCP_MS = 3500;
const VERSAO_RESUMO = 6;
const DURACAO_CACHE_CONTINGENCIA_MS = 15 * 60 * 1000;
const SUPABASE_URL = "https://lsqjamqvmrcyrvowndiu.supabase.co";
const { cabecalhosPadrao, exigirUsuarioLogado, verificarLimiteDiario } = require("./_auth");

// Ver nota em pncp-proxy.js: alguns endpoints do PNCP resetam a conexão sem User-Agent de
// navegador. Manda em todo fetch pro PNCP por segurança.
const USER_AGENT_NAVEGADOR =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// O Blob mantém a leitura extremamente rápida; o Supabase é a fonte durável e
// consultável do dossiê (status, versão e conteúdo), inclusive para auditoria.
async function buscarDossiePersistido(numeroControlePNCP) {
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!chave || !numeroControlePNCP) return null;
  try {
    const url = `${SUPABASE_URL}/rest/v1/dossies_editais?numero_controle_pncp=eq.${encodeURIComponent(numeroControlePNCP)}&select=dossie,versao,expira_em`;
    const resposta = await fetch(url, { headers: { apikey: chave, Authorization: `Bearer ${chave}` } });
    if (!resposta.ok) return null;
    const linhas = await resposta.json();
    const linha = linhas[0];
    if (!linha || !linha.dossie || (linha.expira_em && new Date(linha.expira_em).getTime() <= Date.now())) return null;
    return { ...linha.dossie, versao: linha.versao || linha.dossie.versao };
  } catch (e) {
    return null;
  }
}

async function salvarDossiePersistido(numeroControlePNCP, dossie) {
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!chave || !numeroControlePNCP || !dossie) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/dossies_editais?on_conflict=numero_controle_pncp`, {
      method: "POST",
      headers: {
        apikey: chave,
        Authorization: `Bearer ${chave}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify([{
        numero_controle_pncp: numeroControlePNCP,
        versao: dossie.versao || VERSAO_RESUMO,
        status: dossie.modoDegradado ? "parcial" : "pronto",
        fonte_lida: Boolean(dossie.fonteLida),
        dossie,
        atualizado_em: new Date().toISOString(),
        gerado_em: dossie.geradoEm || new Date().toISOString(),
      }]),
    });
  } catch (e) {
    // O resumo atual continua válido mesmo se a camada de auditoria estiver indisponível.
  }
}

function montarFichaEdital(edital) {
  const campos = [
    ["Objeto", edital.objeto],
    ["Órgão", edital.orgao],
    ["Município/UF", [edital.municipio, edital.uf].filter(Boolean).join(" / ")],
    ["Fonte", edital.fonte || "PNCP"],
    ["Nº do processo / controle", edital.numeroControlePNCP || edital.numero],
  ["Modalidade oficial", edital.modalidade],
  ["Modo de disputa oficial", edital.modoDisputa],
  ["Critério de julgamento oficial", edital.criterioJulgamento],
  ["Regime de execução oficial", edital.regimeExecucao],
    ["Publicado em", edital.publicacao],
    ["Início do recebimento de propostas", edital.inicioRecebimento],
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
    const t1 = setTimeout(() => ctrl1.abort(), TIMEOUT_LISTA_PNCP_MS);
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
      .slice(0, MAX_DOCUMENTOS_PARA_LEITURA);
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
        const t2 = setTimeout(() => ctrl2.abort(), TIMEOUT_ARQUIVO_PNCP_MS);
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
- Os campos marcados como oficiais nos dados conhecidos têm precedência sobre qualquer frase do PDF. Não chame critério de julgamento, tipo de análise, regime de execução ou forma de preço de "modalidade". Preserve a modalidade oficial exatamente como recebida.
- Critério de julgamento, tipo de análise, regime de execução e propostas/lances são conceitos distintos. Só preencha "criterioJulgamento" quando o material disser expressamente o critério ou "menor preço". Registre "Tipo de análise" e "Propostas/lances por" em seus campos próprios, sem deduzir um a partir do outro.
- Responda sempre em português do Brasil, direto e em linguagem simples.
- Quando tiver o texto completo do edital, seja EXAUSTIVO: extraia o máximo de informação possível de cada campo, com detalhes concretos (números, prazos, valores, percentuais, nomes) em vez de generalidades. Não resuma demais — o usuário quer análise completa, não um resumo curto.`;

const SCHEMA_ESTRUTURA = `{
  "identificacao": {"objeto": "", "numero": "", "uasg": "", "contratacao": "", "modalidade": "", "portalRealizacao": "", "regulamentacao": ""},
  "sessaoPublica": {"data": "", "horario": "", "modoDisputa": "", "intervaloMinimo": ""},
  "orgao": {"nome": "", "email": "", "endereco": "", "telefone": ""},
  "detalhes": {"valorEstimado": "", "prazoEntrega": "", "margemPreferencia": "", "exigeVisitaTecnica": "", "exigeAmostra": "", "garantia": "", "criterioJulgamento": "", "tipoAnalise": "", "regimeExecucao": "", "preferenciaMeEpp": "", "restricoesRegionalidade": "", "provaConceito": ""},
  "garantias": {"proposta": "", "contrato": "", "adicional": "", "retomada": ""},
  "entregaExecucao": {"prazo": "", "local": "", "condicoes": ""},
  "prazos": {"limiteEnvioPropostas": "", "prazoDocumentoComplementar": "", "prazoDocumentoOriginal": "", "prazoRecurso": "", "prazoContrarrazoes": "", "limiteEsclarecimentos": "", "limiteImpugnacao": "", "vigenciaContrato": ""},
  "criteriosProposta": {"validadeProposta": "", "criteriosDesempate": "", "exigenciasPropostaComercial": "", "propostasLancesPor": "", "programaIntegridade": ""},
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
      if (opts && opts.reasoningEffort) body.reasoning_effort = opts.reasoningEffort;
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
    txt += linha("Tipo de análise", est.detalhes.tipoAnalise);
    txt += linha("Regime de execução", est.detalhes.regimeExecucao);
    txt += linha("Propostas/lances por", est.criteriosProposta && est.criteriosProposta.propostasLancesPor);
    txt += linha("Garantia exigida", est.detalhes.garantia);
  }
  return txt.trim();
}

// Alguns portais estaduais trazem dados operacionais com rótulos próprios. Esses
// valores têm precedência sobre uma interpretação da IA: "preço global" no
// regime de execução, por exemplo, não é automaticamente critério de julgamento.
function valorRotuladoDoTexto(texto, rotulo) {
  if (!texto) return "";
  const escapar = String(rotulo).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const achado = String(texto).match(new RegExp(`${escapar}\\s*[-–—:]\\s*([^\\r\\n]+)`, "i"));
  return achado && achado[1] ? achado[1].replace(/\s+/g, " ").trim().slice(0, 300) : "";
}

function aplicarCamposOperacionaisDoTexto(estrutura, textoEdital) {
  if (!estrutura || !textoEdital) return estrutura;
  const propostasLancesPor = valorRotuladoDoTexto(textoEdital, "Propostas / Lances por");
  const tipoAnalise = valorRotuladoDoTexto(textoEdital, "Tipo de Análise");
  const regimeExecucao = valorRotuladoDoTexto(textoEdital, "Regime de Execução");
  const criterioJulgamento = valorRotuladoDoTexto(textoEdital, "Critério de Julgamento");
  const temCamposOperacionais = propostasLancesPor || tipoAnalise || regimeExecucao;

  estrutura.detalhes = estrutura.detalhes && typeof estrutura.detalhes === "object" ? estrutura.detalhes : {};
  estrutura.criteriosProposta = estrutura.criteriosProposta && typeof estrutura.criteriosProposta === "object" ? estrutura.criteriosProposta : {};
  if (tipoAnalise) estrutura.detalhes.tipoAnalise = tipoAnalise;
  if (regimeExecucao) estrutura.detalhes.regimeExecucao = regimeExecucao;
  if (propostasLancesPor) estrutura.criteriosProposta.propostasLancesPor = propostasLancesPor;
  if (criterioJulgamento) estrutura.detalhes.criterioJulgamento = criterioJulgamento;
  // Quando a origem já separa os campos, não aceitamos que "preço global" do
  // regime seja exibido como um critério que ela não informou expressamente.
  if (temCamposOperacionais && !criterioJulgamento) delete estrutura.detalhes.criterioJulgamento;
  return estrutura;
}

// O resumo não pode desaparecer quando o provedor de IA estiver temporariamente limitado.
// Esta ficha vem somente de dados já recebidos do PNCP, sem inferir cláusulas do edital.
function montarEstruturaBasica(edital, motivoFonteNaoLida) {
  const naoInformado = "Não informado";
  const local = [edital.municipio, edital.uf].filter(Boolean).join(" / ") || naoInformado;
  const prazo = edital.encerramento || naoInformado;
  return {
    identificacao: {
      objeto: edital.objeto || naoInformado,
      numero: edital.numeroControlePNCP || edital.numero || naoInformado,
      uasg: edital.uasg || naoInformado,
      contratacao: edital.tipo || naoInformado,
      modalidade: edital.modalidade || naoInformado,
      portalRealizacao: edital.link || naoInformado,
      regulamentacao: edital.amparoLegal || naoInformado,
    },
    sessaoPublica: { data: prazo, horario: naoInformado, modoDisputa: edital.modoDisputa || naoInformado, intervaloMinimo: naoInformado },
    orgao: { nome: edital.orgao || naoInformado, email: naoInformado, endereco: local, telefone: naoInformado },
    detalhes: { valorEstimado: edital.valor || naoInformado, prazoEntrega: naoInformado, margemPreferencia: naoInformado, exigeVisitaTecnica: naoInformado, exigeAmostra: naoInformado, garantia: naoInformado, criterioJulgamento: edital.criterioJulgamento || naoInformado, tipoAnalise: naoInformado, regimeExecucao: edital.regimeExecucao || naoInformado, preferenciaMeEpp: naoInformado, restricoesRegionalidade: naoInformado, provaConceito: naoInformado },
    garantias: { proposta: naoInformado, contrato: naoInformado, adicional: naoInformado, retomada: naoInformado },
    entregaExecucao: { prazo: naoInformado, local: naoInformado, condicoes: naoInformado },
    prazos: { limiteEnvioPropostas: prazo, prazoDocumentoComplementar: naoInformado, prazoDocumentoOriginal: naoInformado, prazoRecurso: naoInformado, prazoContrarrazoes: naoInformado, limiteEsclarecimentos: naoInformado, limiteImpugnacao: naoInformado, vigenciaContrato: naoInformado },
    criteriosProposta: { validadeProposta: naoInformado, criteriosDesempate: naoInformado, exigenciasPropostaComercial: naoInformado, propostasLancesPor: naoInformado, programaIntegridade: naoInformado },
    itens: { totalItens: naoInformado, descricaoGeral: edital.objeto || naoInformado, categoriasPrincipais: naoInformado, observacoes: naoInformado },
    documentosHabilitacao: [],
    atestadoCapacidadeTecnica: naoInformado,
    legislacao: edital.amparoLegal || naoInformado,
    anexosDeclaracoes: naoInformado,
    declaracoesExigidas: [],
    condicoesPagamento: naoInformado,
    penalidades: naoInformado,
    multas: naoInformado,
    documentosConsultados: [],
    pendenciasParaConferencia: [motivoFonteNaoLida === "escaneado" ? "O documento publicado é escaneado e não pôde ser lido automaticamente. Abra o edital oficial para conferir habilitação, pagamentos, penalidades e anexos." : "A análise completa do documento oficial está temporariamente indisponível. Os campos abaixo mostram apenas dados públicos já recebidos do PNCP."],
    questionamentosSugeridos: [],
    possiveisQuestionamentos: [],
    outrasInformacoesRelevantes: [],
    analiseCritica: { conflitoObjetoMinuta: naoInformado, conflitoPrazoVigenciaArp: naoInformado, conflitoPrazosEntrega: naoInformado, permiteSubcontratacao: naoInformado, previsaoReajuste: naoInformado, permiteRenovacao: naoInformado, estabeleceCondicoesPagamento: naoInformado },
    resumoGeral: `Ficha inicial da oportunidade: ${edital.objeto || "objeto não informado"}. Órgão: ${edital.orgao || naoInformado}. Prazo divulgado: ${prazo}. Para requisitos de participação, consulte o edital oficial.`,
  };
}

function respostaDeContingencia(edital, motivoFonteNaoLida, aviso) {
  const estrutura = montarEstruturaBasica(edital, motivoFonteNaoLida);
  return {
    statusCode: 200,
    headers: null,
    body: {
      resposta: formatarEstruturaComoTexto(estrutura),
      estrutura,
      textoEdital: null,
      fonteLida: false,
      motivoFonteNaoLida,
      modoDegradado: true,
      aviso: aviso || "A análise automática está indisponível agora.",
      erro: null,
    },
  };
}

// Uma falha temporária ao baixar o arquivo não pode fazer cada abertura repetir toda a
// cadeia PNCP + IA. Guardamos a ficha oficial por pouco tempo: a reabertura é imediata e
// sem nova cota, mas o sistema volta a tentar a leitura completa automaticamente depois.
async function salvarContingenciaNoCache(store, edital, corpo) {
  if (!store || !edital.numeroControlePNCP) return;
  try {
    await store.setJSON(edital.numeroControlePNCP, {
      estrutura: corpo.estrutura,
      resposta: corpo.resposta,
      textoEdital: corpo.textoEdital || null,
      fonteLida: false,
      motivoFonteNaoLida: corpo.motivoFonteNaoLida || "indisponivel",
      modoDegradado: true,
      aviso: corpo.aviso || "A análise detalhada será tentada novamente em alguns minutos.",
      expiraEm: new Date(Date.now() + DURACAO_CACHE_CONTINGENCIA_MS).toISOString(),
      versao: VERSAO_RESUMO,
      geradoEm: new Date().toISOString(),
    });
  } catch (e) {
    // Cache é uma otimização; a resposta atual não pode depender dele.
  }
}

exports.handler = async (event) => {
  const headers = cabecalhosPadrao(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ erro: "Use POST." }) };

  // O coletor agendado usa a mesma análise que o cliente, mas não possui uma sessão
  // de navegador. A chave só é aceita se estiver configurada no ambiente; portanto,
  // a ausência da variável jamais transforma esta rota autenticada em pública.
  const chaveRobo = process.env.DOSSIES_EDITAIS_CHAVE;
  const cabecalhosRecebidos = event.headers || {};
  const ehRoboInterno = Boolean(chaveRobo && cabecalhosRecebidos["x-licitaplena-dossies-chave"] === chaveRobo);
  const sessao = ehRoboInterno ? { ok: true, userId: "robo-dossies-editais" } : await exigirUsuarioLogado(event);
  if (!sessao.ok) return { statusCode: sessao.status, headers, body: JSON.stringify({ erro: sessao.erro }) };
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ erro: "Corpo inválido." }) };
  }

  const { modo, edital, pergunta, historico, reprocessarEstrutura } = body;
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

  if (modo === "resumo" && edital.numeroControlePNCP) {
    try {
      let cache = storeResumos ? await storeResumos.get(edital.numeroControlePNCP, { type: "json" }) : null;
      if (!cache) cache = await buscarDossiePersistido(edital.numeroControlePNCP);
      // Aceita tanto o cache do resumo ESTRUTURADO (JSON, caminho ideal) quanto do resumo
      // em TEXTO CORRIDO (fallback, quando a extração em JSON não deu certo) — os dois têm
      // custo de IA pra gerar, então os dois precisam ficar em cache. Sem isso, todo edital
      // que cai no fallback reprocessava do zero A CADA vez que alguém abria o resumo de
      // novo, gastando cota da IA repetidamente à toa.
      // Resumos antigos eram texto corrido e não traziam o checklist completo. Só usa
      // cache da versão atual; assim uma evolução do dossiê chega para todos sem exigir
      // que cada pessoa descubra como limpar dados do navegador.
      const cacheAindaValido = !cache || !cache.expiraEm || new Date(cache.expiraEm).getTime() > Date.now();
      // Um resumo antigo em texto corrido é útil como contingência, mas não deve
      // impedir que outro navegador recupere o dossiê estruturado. Quando o
      // cliente pede a atualização, reaproveitamos apenas uma estrutura completa;
      // caso contrário, lemos a fonte novamente e substituímos o cache incompleto.
      const cachePodeResponder = cache && cacheAindaValido && cache.versao === VERSAO_RESUMO &&
        (cache.estrutura || (cache.resposta && !reprocessarEstrutura));
      if (cachePodeResponder) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            resposta: cache.resposta || "Resumo gerado.",
            estrutura: cache.estrutura || null,
            textoEdital: cache.textoEdital || null,
            fonteLida: cache.fonteLida !== undefined ? cache.fonteLida : true,
            motivoFonteNaoLida: cache.motivoFonteNaoLida || null,
            modoDegradado: Boolean(cache.modoDegradado),
            aviso: cache.aviso || null,
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

  // Sem texto de fonte primária, não há base para a IA completar ou "interpretar"
  // exigências. Entregamos a ficha oficial estruturada imediatamente — sem gastar cota
  // com uma frase genérica e sem deixar espaço em branco no modal.
  if (modo === "resumo" && !fonteLida) {
    const contingencia = respostaDeContingencia(edital, motivoFonteNaoLida || "indisponivel", "O documento oficial não pôde ser lido automaticamente agora. A ficha abaixo mostra os dados públicos oficiais já coletados, sem inferir requisitos do edital.");
    await salvarContingenciaNoCache(storeResumos, edital, contingencia.body);
    contingencia.headers = headers;
    contingencia.body = JSON.stringify(contingencia.body);
    return contingencia;
  }

  // Só usa a cota de IA quando de fato há uma análise a executar. Antes desta
  // ordem, uma oportunidade sem arquivo acessível ainda gastava a cota com um
  // resumo genérico baseado nos mesmos campos que já estão na tela.
  // O orçamento do robô é controlado pelo próprio job (quantidade máxima por execução).
  // Não mistura esse processamento de base com a cota diária individual dos clientes.
  const limite = ehRoboInterno ? { ok: true } : await verificarLimiteDiario(sessao.userId, "ia-edital", 40);
  if (!limite.ok && modo === "resumo") {
    const contingencia = respostaDeContingencia(edital, "indisponivel", limite.erro);
    contingencia.headers = headers;
    contingencia.body = JSON.stringify(contingencia.body);
    return contingencia;
  }
  if (!limite.ok) return { statusCode: limite.status, headers, body: JSON.stringify({ erro: limite.erro }) };

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    if (modo === "resumo") {
      const contingencia = respostaDeContingencia(edital, "indisponivel", "A configuração da análise automática está indisponível agora.");
      contingencia.headers = headers;
      contingencia.body = JSON.stringify(contingencia.body);
      return contingencia;
    }
    return { statusCode: 500, headers, body: JSON.stringify({ erro: "GROQ_API_KEY não configurado no Netlify." }) };
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
    // Uma única chamada com orçamento de tempo compatível com a Function. Antes eram
    // duas tentativas de 28 s e, em caso de lentidão, o servidor morria antes de chegar
    // ao fallback. A ficha oficial abaixo é preferível a um modal vazio.
    const r = await chamarGroq(apiKey, mensagensEstrutura, { maxTokens: 1800, timeoutMs: 10500, json: true, reasoningEffort: "low" });
    if (r.ok) {
      const estrutura = extrairJson(r.texto);
      if (estrutura) {
        aplicarCamposOperacionaisDoTexto(estrutura, textoEdital);
        const resposta = formatarEstruturaComoTexto(estrutura) || "Resumo gerado.";
        // Salva no cache pra próxima vez (por qualquer pessoa) abrir instantâneo, sem
        // reprocessar. Se o cache não estiver disponível ou der erro, não trava o resumo —
        // o usuário atual já recebe a resposta normalmente de qualquer forma.
        if (edital.numeroControlePNCP) {
          const dossiePronto = {
            estrutura,
            resposta,
            textoEdital,
            fonteLida: true,
            motivoFonteNaoLida: null,
            versao: VERSAO_RESUMO,
            geradoEm: new Date().toISOString(),
          };
          try {
            if (storeResumos) {
              await storeResumos.setJSON(edital.numeroControlePNCP, dossiePronto);
            }
          } catch (e) {
            // não crítico — só significa que não vai ficar em cache dessa vez
          }
          await salvarDossiePersistido(edital.numeroControlePNCP, dossiePronto);
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
    }

    // Já consumimos o orçamento de tempo da Function tentando a análise rica. Não
    // fazemos uma segunda chamada longa em seguida: em hospedagem serverless isso era
    // justamente o que encerrava a execução sem JSON e deixava o cliente com a tela
    // vazia. A ficha abaixo preserva os dados públicos e permite uma nova tentativa.
    const estrutura = montarEstruturaBasica(edital, motivoFonteNaoLida);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        resposta: formatarEstruturaComoTexto(estrutura),
        estrutura,
        textoEdital: null,
        fonteLida: false,
        motivoFonteNaoLida,
        modoDegradado: true,
        aviso: "A leitura detalhada do documento não pôde ser concluída agora.",
        erro: null,
      }),
    };
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
  const r2 = await chamarGroq(apiKey, mensagens, { maxTokens: fonteLida ? 700 : 400, timeoutMs: 7500 });
  if (!r2.ok) {
    const estrutura = montarEstruturaBasica(edital, motivoFonteNaoLida);
    // Contingência não entra no cache: quando o serviço voltar, a pessoa deve poder
    // obter a análise completa, em vez de ficar presa a uma ficha reduzida.
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        resposta: formatarEstruturaComoTexto(estrutura),
        estrutura,
        textoEdital: textoEdital || null,
        fonteLida,
        motivoFonteNaoLida,
        modoDegradado: true,
        erro: null,
      }),
    };
  }
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
