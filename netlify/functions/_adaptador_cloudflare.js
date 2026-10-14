// Adaptador Cloudflare Pages Functions -> handlers no formato Netlify/Lambda.
//
// Por quê isso existe: a conta Netlify foi suspensa por falta de pagamento e o site passou a ser
// servido pelo Cloudflare Pages (plano gratuito). Os handlers em netlify/functions/ continuam sendo
// a fonte única da lógica (e continuam funcionando no Netlify); em vez de reescrevê-los, este
// módulo traduz Request -> `event` e `{ statusCode, headers, body }` -> Response. Fica fora de
// functions/ para poder ser testado com `node --test` (CommonJS, sem APIs exclusivas do Workers).

// Cabeçalhos que o Netlify entrega em minúsculas; os handlers leem `event.headers.origin`,
// `authorization` e `x-licitaplena-dossies-chave` assim.
function cabecalhosDoRequest(request) {
  const headers = {};
  request.headers.forEach((valor, nome) => { headers[nome.toLowerCase()] = valor; });
  return headers;
}

// O Netlify entrega só o último valor quando a chave se repete; os handlers esperam string.
function parametrosDaUrl(url) {
  const simples = {};
  const multiplos = {};
  for (const [chave, valor] of url.searchParams) {
    simples[chave] = valor;
    (multiplos[chave] ||= []).push(valor);
  }
  return { simples, multiplos };
}

async function requestParaEvent(request) {
  const url = new URL(request.url);
  const { simples, multiplos } = parametrosDaUrl(url);
  const temCorpo = !["GET", "HEAD"].includes(request.method.toUpperCase());
  return {
    httpMethod: request.method.toUpperCase(),
    headers: cabecalhosDoRequest(request),
    body: temCorpo ? await request.text() : null,
    isBase64Encoded: false,
    path: url.pathname,
    rawUrl: request.url,
    rawQuery: url.search.replace(/^\?/, ""),
    queryStringParameters: simples,
    multiValueQueryStringParameters: multiplos,
  };
}

// Status sem corpo: o construtor de Response lança erro se receber corpo nestes casos.
const STATUS_SEM_CORPO = new Set([101, 204, 205, 304]);

function bytesDeBase64(texto) {
  const binario = atob(texto);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

function resultadoParaResponse(resultado, opcoes = {}) {
  const r = resultado || {};
  const status = Number.isInteger(r.statusCode) ? r.statusCode : 200;
  const headers = new Headers();
  for (const [nome, valor] of Object.entries(r.headers || {})) {
    if (valor !== undefined && valor !== null) headers.set(nome, String(valor));
  }
  for (const [nome, valores] of Object.entries(r.multiValueHeaders || {})) {
    headers.delete(nome);
    for (const valor of valores || []) headers.append(nome, String(valor));
  }
  // Em /*, o netlify.toml põe `no-cache`, mas para convenios-publico a regra mais específica
  // libera cache curto; aqui o handler é a única fonte, então o padrão só entra se ele não definiu.
  if (opcoes.cacheControlPadrao && !headers.has("cache-control")) headers.set("cache-control", opcoes.cacheControlPadrao);

  if (STATUS_SEM_CORPO.has(status) || r.body === undefined || r.body === null || r.body === "") {
    return new Response(STATUS_SEM_CORPO.has(status) ? null : "", { status, headers });
  }
  const corpo = r.isBase64Encoded ? bytesDeBase64(String(r.body)) : (typeof r.body === "string" ? r.body : JSON.stringify(r.body));
  return new Response(corpo, { status, headers });
}

// Handlers retornam `{ ok, status, erro }`/statusCode em vez de lançar; se algo escapar mesmo
// assim, devolve 500 JSON em vez de deixar o Cloudflare responder com a página de erro padrão.
async function executarHandler(handler, request, opcoes = {}) {
  try {
    const event = await requestParaEvent(request);
    const resultado = await handler(event, {});
    return resultadoParaResponse(resultado, opcoes);
  } catch (e) {
    console.error("adaptador-cloudflare: falha no handler", e?.name || "erro");
    return new Response(JSON.stringify({ erro: "Erro interno ao processar a requisição." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

module.exports = { requestParaEvent, resultadoParaResponse, executarHandler };
