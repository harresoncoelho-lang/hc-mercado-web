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

const MODELO = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const PNCP_ARQUIVOS_URL = "https://pncp.gov.br/api/pncp/v1/orgaos";
const PNCP_ARQUIVO_URL = "https://pncp.gov.br/pncp-api/v1/orgaos";
const MAX_CARACTERES_TEXTO = 9000;

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

async function buscarTextoEdital(numeroControlePNCP) {
  const partes = partesNumeroControle(numeroControlePNCP);
  if (!partes) return null;
  try {
    const ctrl1 = new AbortController();
    const t1 = setTimeout(() => ctrl1.abort(), 8000);
    const respLista = await fetch(`${PNCP_ARQUIVOS_URL}/${partes.cnpj}/compras/${partes.ano}/${partes.sequencial}/arquivos`, {
      headers: { Accept: "application/json" },
      signal: ctrl1.signal,
    });
    clearTimeout(t1);
    if (!respLista.ok) return null;
    const lista = await respLista.json();
    if (!Array.isArray(lista) || lista.length === 0) return null;

    // Prioriza documentos do tipo "Edital"; se não achar nenhum, tenta qualquer coisa com nome
    // terminando em .pdf. Pode haver mais de um documento chamado "Edital" (retificações etc.)
    // — tenta até 3 candidatos em ordem até um realmente abrir como PDF.
    const candidatos = [
      ...lista.filter((a) => /edital/i.test(a.tipoDocumentoNome || a.tipoDocumentoDescricao || "")),
      ...lista.filter((a) => /\.pdf$/i.test(a.titulo || "")),
    ].slice(0, 3);
    if (candidatos.length === 0) return null;

    const pdfParse = require("pdf-parse");
    for (const doc of candidatos) {
      try {
        const ctrl2 = new AbortController();
        const t2 = setTimeout(() => ctrl2.abort(), 12000);
        const respArquivo = await fetch(`${PNCP_ARQUIVO_URL}/${partes.cnpj}/compras/${partes.ano}/${partes.sequencial}/arquivos/${doc.sequencialDocumento}`, {
          signal: ctrl2.signal,
        });
        clearTimeout(t2);
        if (!respArquivo.ok) continue;
        const buffer = Buffer.from(await respArquivo.arrayBuffer());
        // O PNCP costuma devolver Content-Type genérico (application/octet-stream) e às vezes
        // sem extensão no nome do arquivo, mesmo quando é um PDF de verdade — então não dá pra
        // confiar no Content-Type/nome pra decidir se tenta ler. Em vez disso, checa a assinatura
        // binária do PDF (todo PDF de verdade começa com "%PDF-") antes de gastar tempo tentando
        // extrair texto de algo que pode ser um .docx/.rar/.xlsx disfarçado de "Edital".
        if (buffer.slice(0, 5).toString("latin1") !== "%PDF-") continue;
        const resultado = await pdfParse(buffer);
        const texto = (resultado.text || "").replace(/\s+/g, " ").trim();
        if (texto && texto.length >= 200) return texto.slice(0, MAX_CARACTERES_TEXTO);
      } catch (e) {
        // tenta o próximo candidato
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

const REGRAS_BASE = `Você é um assistente que ajuda pequenas e médias empresas brasileiras a entender oportunidades de licitação pública, dentro da ferramenta HC Licitações.
- Nunca invente exigência, documento, cláusula, penalidade, prazo ou valor que não esteja explicitamente nos dados fornecidos. Quando uma informação não estiver disponível, use exatamente o texto "Não informado".
- Responda sempre em português do Brasil, direto e em linguagem simples.`;

const SCHEMA_ESTRUTURA = `{
  "identificacao": {"objeto": "", "numero": "", "uasg": "", "contratacao": "", "modalidade": "", "portalRealizacao": "", "regulamentacao": ""},
  "sessaoPublica": {"data": "", "horario": "", "modoDisputa": "", "intervaloMinimo": ""},
  "orgao": {"nome": "", "email": "", "endereco": "", "telefone": ""},
  "detalhes": {"valorEstimado": "", "prazoEntrega": "", "margemPreferencia": "", "exigeVisitaTecnica": "", "exigeAmostra": "", "garantia": "", "criterioJulgamento": "", "preferenciaMeEpp": "", "restricoesRegionalidade": ""},
  "prazos": {"limiteEnvioPropostas": "", "prazoRecurso": "", "prazoContrarrazoes": "", "limiteEsclarecimentos": "", "limiteImpugnacao": "", "vigenciaContrato": ""},
  "itens": {"totalItens": "", "descricaoGeral": "", "categoriasPrincipais": ""},
  "documentosHabilitacao": ["lista de documentos exigidos, um por item"],
  "penalidades": "",
  "outrasInformacoesRelevantes": ["lista curta de pontos importantes que não se encaixam nos campos acima"],
  "resumoGeral": "resumo corrido de 4 a 6 frases, em linguagem simples, pra quem está decidindo se participa"
}`;

async function chamarGroq(apiKey, mensagens, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), (opts && opts.timeoutMs) || 20000);
  try {
    const body = { model: MODELO, max_tokens: (opts && opts.maxTokens) || 500, messages: mensagens };
    if (opts && opts.json) body.response_format = { type: "json_object" };
    const resp = await fetch(CHAT_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    clearTimeout(t);
    if (!resp.ok) return { ok: false, erro: `Falha ao consultar a IA (${resp.status}): ${(await resp.text()).slice(0, 200)}` };
    const dados = await resp.json();
    const texto = ((dados.choices || [])[0] && dados.choices[0].message && dados.choices[0].message.content || "").trim();
    return { ok: true, texto };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, erro: `Erro ao consultar a IA: ${String((e && e.message) || e)}` };
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
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ erro: "Use POST." }) };

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

  // Só tenta buscar o PDF na primeira chamada (resumo) — perguntas seguintes reaproveitam
  // o texto já extraído, que o frontend manda de volta em body.textoEdital.
  if (modo === "resumo" && !textoEdital && edital.numeroControlePNCP) {
    const texto = await buscarTextoEdital(edital.numeroControlePNCP);
    if (texto) {
      textoEdital = texto;
      fonteLida = true;
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
    return { statusCode: 200, headers, body: JSON.stringify({ resposta: r.texto, estrutura: null, textoEdital: textoEdital || null, fonteLida, erro: null }) };
  }

  // modo === "resumo"
  if (fonteLida) {
    const mensagens = [
      { role: "system", content: `${REGRAS_BASE}\nVocê recebeu o texto real extraído do PDF do edital. Extraia as informações pedidas e devolva SOMENTE um JSON válido (sem markdown, sem comentários) no formato exato:\n${SCHEMA_ESTRUTURA}` },
      { role: "user", content: `Dados já conhecidos:\n${ficha}\n\nTexto extraído do edital (pode estar truncado):\n${textoEdital}` },
    ];
    const r = await chamarGroq(apiKey, mensagens, { maxTokens: 1800, timeoutMs: 25000, json: true });
    if (r.ok) {
      try {
        const estrutura = JSON.parse(r.texto);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            resposta: formatarEstruturaComoTexto(estrutura) || "Resumo gerado.",
            estrutura,
            textoEdital,
            fonteLida: true,
            erro: null,
          }),
        };
      } catch (e) {
        // IA não devolveu JSON válido — segue pro resumo simples abaixo em vez de falhar.
      }
    }
  }

  // Sem PDF (ou falhou a extração estruturada): resumo simples baseado só nos campos coletados.
  const mensagens = [
    { role: "system", content: REGRAS_BASE + "\nVocê só tem os campos estruturados abaixo, não o PDF completo do edital — deixe isso claro se for relevante." },
    { role: "user", content: `Dados da oportunidade:\n${ficha}\n\nFaça um resumo curto (4 a 6 frases) explicando do que se trata essa licitação: o que está sendo comprado, quem compra, o prazo, e o porte aproximado pelo valor estimado (se houver).` },
  ];
  const r2 = await chamarGroq(apiKey, mensagens, { maxTokens: 500, timeoutMs: 20000 });
  if (!r2.ok) return { statusCode: 502, headers, body: JSON.stringify({ erro: r2.erro }) };
  return { statusCode: 200, headers, body: JSON.stringify({ resposta: r2.texto, estrutura: null, textoEdital: textoEdital || null, fonteLida, erro: null }) };
};
