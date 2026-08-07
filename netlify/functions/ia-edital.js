// Netlify Function: Resumo do Edital + Pergunte ao Edital (Fase 1 do roadmap de novas
// ferramentas, inspirado no ConLicitação).
//
// Usa a Anthropic API (Claude) pra explicar em linguagem simples uma oportunidade de
// licitação, a partir dos dados públicos que o robô já coletou (objeto, órgão, valor
// estimado, prazos, modalidade etc.) — a mesma ficha que já aparece no card do Boletim.
//
// IMPORTANTE sobre o que a IA sabe: nesta primeira versão ela não lê o PDF completo do
// edital (não temos ainda um jeito confiável de baixar e extrair o texto de cada portal de
// origem) — ela trabalha só com os campos estruturados que já coletamos. Por isso o prompt
// deixa isso claro e a IA é instruída a nunca inventar exigência, prazo ou cláusula que não
// esteja nos dados fornecidos, sempre recomendando conferir o PDF oficial pra detalhes finos.
//
// Uso: POST /.netlify/functions/ia-edital
// Body: { modo: "resumo" | "pergunta", edital: {...campos...}, pergunta?: string, historico?: [...] }
//
// Resposta: { resposta: string, erro: string|null }

const MODELO = "claude-haiku-4-5-20251001";

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

const SYSTEM_PROMPT = `Você é um assistente que ajuda pequenas e médias empresas brasileiras a entender oportunidades de licitação pública (PNCP e fontes correlatas), dentro da ferramenta HC Licitações.

Regras importantes:
- Você recebe só os campos estruturados já coletados sobre a oportunidade (objeto, órgão, valor, prazos etc.) — você NÃO tem acesso ao PDF completo do edital.
- Nunca invente exigência, documento, cláusula, penalidade ou detalhe técnico que não esteja explicitamente nos dados fornecidos. Se a pergunta pedir algo que não está nos dados (ex: "quais documentos de habilitação são exigidos?", "qual a garantia contratual?"), diga claramente que essa informação não está nos dados coletados e oriente a pessoa a abrir o PDF oficial do edital (o link é mostrado na tela) pra conferir.
- Responda em português do Brasil, direto e em linguagem simples — o público não é jurídico especializado.
- Seja objetivo: parágrafos curtos, sem enrolação, sem markdown pesado (pode usar frases curtas, não precisa de títulos).`;

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ erro: "Use POST." }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ erro: "ANTHROPIC_API_KEY não configurado no Netlify." }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ erro: "Corpo inválido." }) };
  }

  const { modo, edital, pergunta, historico } = body;
  if (!edital || typeof edital !== "object") {
    return { statusCode: 400, headers, body: JSON.stringify({ erro: "Informe os dados do edital." }) };
  }

  const ficha = montarFichaEdital(edital);

  let userContent;
  if (modo === "pergunta") {
    if (!pergunta || !pergunta.trim()) {
      return { statusCode: 400, headers, body: JSON.stringify({ erro: "Informe a pergunta." }) };
    }
    userContent = `Dados da oportunidade:\n${ficha}\n\nPergunta do usuário: ${pergunta.trim()}`;
  } else {
    userContent = `Dados da oportunidade:\n${ficha}\n\nFaça um resumo curto (4 a 6 frases) explicando do que se trata essa licitação, pra alguém que está decidindo se vale a pena participar: o que está sendo comprado, quem compra, o prazo, e o porte aproximado do negócio pelo valor estimado (se houver). Não invente nada além do que está nos dados.`;
  }

  const mensagens = [];
  if (Array.isArray(historico)) {
    for (const h of historico.slice(-6)) {
      if (h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string") {
        mensagens.push({ role: h.role, content: h.content });
      }
    }
  }
  mensagens.push({ role: "user", content: userContent });

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000);
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: mensagens,
      }),
    });
    clearTimeout(t);

    if (!resp.ok) {
      const textoErro = await resp.text();
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ erro: `Falha ao consultar a IA (${resp.status}): ${textoErro.slice(0, 200)}` }),
      };
    }

    const dados = await resp.json();
    const resposta = (dados.content || []).map((b) => b.text || "").join("").trim();
    return { statusCode: 200, headers, body: JSON.stringify({ resposta, erro: null }) };
  } catch (e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ erro: `Erro ao consultar a IA: ${String((e && e.message) || e)}` }),
    };
  }
};
