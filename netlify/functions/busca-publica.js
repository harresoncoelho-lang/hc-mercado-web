// Netlify Function: busca pública (sem login) da primeira tela da landing (index.html).
// O visitante digita o que a empresa vende (e, se quiser, a UF) e recebe até 6 licitações
// abertas da tabela public.oportunidades_abertas — a mesma que o robô scripts/atualizar_dados.js
// sincroniza do PNCP e que painel.html lê autenticado.
//
// Por quê uma function e não SELECT público (RLS): a tabela só libera leitura para usuários
// autenticados, e a coluna "dado" guarda o registro inteiro do PNCP. Lendo aqui com a Service
// Role Key, só saem as colunas públicas escolhidas abaixo, com no máximo 6 linhas por chamada.
// Como é endpoint público com custo de banco, o termo é limitado (2 a 60 caracteres, só letras,
// números, espaço e hífen), a UF precisa ser uma das 27 siglas e a resposta fica 5 min no CDN.
// O filtro vai como parâmetro da API REST do Supabase (PostgREST), nunca como SQL concatenado.
//
// Uso: GET /api/busca-publica?termo=uniformes&uf=AM
const { cabecalhosPadrao } = require("./_auth");
const { nomePortal, linkDisputa } = require("../../portal-origem.js");

const SUPABASE_URL = "https://lsqjamqvmrcyrvowndiu.supabase.co";
const LIMITE_RESULTADOS = 6;
const MAX_PALAVRAS = 4;
const TIMEOUT_MS = 8000;
// Sem data de encerramento, só conta como aberta se foi publicada há pouco tempo.
const DIAS_SEM_ENCERRAMENTO = 30;
const UFS = new Set(["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"]);

// Só letras (com acento), números, espaço e hífen: tira de saída os curingas do ILIKE (% _ *)
// e os separadores da sintaxe and()/or() do PostgREST (vírgula, parênteses, ponto).
function normalizarTermo(bruto) {
  const termo = String(bruto || "").normalize("NFC").replace(/[^\p{L}\p{N} -]+/gu, " ").replace(/\s+/g, " ").trim();
  return termo.length >= 2 && termo.length <= 60 ? termo : null;
}

function normalizarUf(bruta) {
  if (bruta === undefined || bruta === null || String(bruta).trim() === "") return { ok: true, uf: null };
  const uf = String(bruta).trim().toUpperCase();
  return UFS.has(uf) ? { ok: true, uf } : { ok: false };
}

// Cada palavra com 3+ letras precisa aparecer no objeto (E), para "material de limpeza" achar
// "limpeza e material..." também. Termo só com palavras curtas vira uma busca pela frase.
function filtroObjeto(termo) {
  const palavras = termo.split(" ").filter((p) => p.length >= 3).slice(0, MAX_PALAVRAS);
  const partes = (palavras.length ? palavras : [termo]).map((p) => `objeto.ilike.*${p}*`);
  return `(${partes.join(",")})`;
}

function dataIso(deslocamentoDias = 0) {
  // Dia de Brasília (UTC-3, sem horário de verão).
  return new Date(Date.now() - 3 * 3600 * 1000 + deslocamentoDias * 86400 * 1000).toISOString().slice(0, 10);
}

function montarUrl(termo, uf) {
  const p = new URLSearchParams();
  p.set("select", "numero_controle_pncp,objeto,uf,publicacao,encerramento,orgao:dado->>orgao,municipio:dado->>municipio,modalidade:dado->>modalidadeNome,valor:dado->>valorTotalEstimado,usuario_nome:dado->>usuarioNome,link_sistema_origem:dado->>linkSistemaOrigem");
  p.set("and", filtroObjeto(termo));
  p.set("or", `(encerramento.gte.${dataIso()},and(encerramento.is.null,publicacao.gte.${dataIso(-DIAS_SEM_ENCERRAMENTO)}))`);
  if (uf) p.set("uf", `eq.${uf}`);
  p.set("order", "publicacao.desc.nullslast");
  p.set("limit", String(LIMITE_RESULTADOS));
  return `${SUPABASE_URL}/rest/v1/oportunidades_abertas?${p.toString()}`;
}

// Mesmo formato de painel.html (linkPncp): "CNPJ-1-SEQ/ANO" -> página do edital no PNCP.
function linkPncp(numero) {
  const m = /^(\d{14})-\d+-(\d+)\/(\d{4})$/.exec(String(numero || ""));
  return m ? `https://pncp.gov.br/app/editais/${m[1]}/${m[3]}/${parseInt(m[2], 10)}` : null;
}

function paraPublico(linha) {
  return {
    objeto: String(linha.objeto || "").slice(0, 400),
    orgao: linha.orgao || "Órgão não informado",
    uf: linha.uf || "",
    municipio: linha.municipio || "",
    modalidade: linha.modalidade || "",
    valorEstimado: Number(linha.valor) > 0 ? Number(linha.valor) : null,
    publicacao: linha.publicacao || null,
    encerramento: linha.encerramento || null,
    link: linkPncp(linha.numero_controle_pncp),
    // Portal da disputa já normalizado e com link só http(s): a página pública não reprocessa.
    portal: nomePortal(linha.usuario_nome),
    linkDisputa: linkDisputa(linha.link_sistema_origem),
  };
}

const responder = (statusCode, headers, corpo) => ({ statusCode, headers, body: JSON.stringify(corpo) });

exports.handler = async (event) => {
  const headers = { ...cabecalhosPadrao(event), "Access-Control-Allow-Methods": "GET, OPTIONS", "Cache-Control": "public, max-age=300" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "GET") return responder(405, headers, { erro: "Use GET." });

  const q = event.queryStringParameters || {};
  const termo = normalizarTermo(q.termo);
  if (!termo) return responder(400, headers, { erro: "Digite de 2 a 60 letras ou números, por exemplo: uniformes, material de limpeza." });
  const uf = normalizarUf(q.uf);
  if (!uf.ok) return responder(400, headers, { erro: "UF inválida. Use a sigla do estado, por exemplo: AM, SP." });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return responder(503, { ...headers, "Cache-Control": "no-store" }, { erro: "A busca está indisponível no momento. Tente de novo mais tarde ou crie sua conta para receber o boletim." });
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(montarUrl(termo, uf.uf), {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      console.warn(`busca-publica: Supabase HTTP ${resp.status}`);
      return responder(502, { ...headers, "Cache-Control": "no-store" }, { erro: "Não conseguimos consultar as licitações agora. Tente de novo em instantes." });
    }
    const linhas = await resp.json();
    const resultados = (Array.isArray(linhas) ? linhas : []).slice(0, LIMITE_RESULTADOS).map(paraPublico);
    return responder(200, headers, { termo, uf: uf.uf, fonte: "PNCP", resultados });
  } catch (e) {
    console.warn(`busca-publica: falha na consulta (${e.name})`);
    return responder(502, { ...headers, "Cache-Control": "no-store" }, { erro: "A consulta demorou demais. Tente de novo em instantes." });
  } finally {
    clearTimeout(t);
  }
};
