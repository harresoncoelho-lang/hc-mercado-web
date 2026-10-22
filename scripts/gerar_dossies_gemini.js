/* global AbortSignal */
// Gera os dossiês (resumo completo) dos editais com IA, fora da Netlify, por uma CADEIA de
// provedores com troca automática: se um está sem cota, sobrecarregado ou falhando, o próximo assume.
// Uso: node scripts/gerar_dossies_gemini.js
// Env obrigatória: SUPABASE_SERVICE_ROLE_KEY e a chave de ao menos um provedor. Ordem da cadeia
// (cada provedor só entra se a chave existir; sem chave ele é ignorado):
//   1. Gemini     GEMINI_API_KEY      modelos GEMINI_MODELO (gemini-3.8-flash) e gemini-3.7-flash
//   2. Mistral    MISTRAL_API_KEY     modelos MISTRAL_MODELOS (mistral-medium-latest,mistral-small-latest)
//   3. OpenRouter OPENROUTER_API_KEY  modelos OPENROUTER_MODELOS (sem padrão: sem lista, não é usado)
//   4. Cloudflare Workers AI  CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN (ambos obrigatórios)
//                                     modelos CLOUDFLARE_AI_MODELOS (@cf/openai/gpt-oss-120b)
//      Último recurso: o plano gratuito dá 10.000 neurons/dia (~300 mil tokens de entrada do
//      gpt-oss-120b, ou seja, só alguns editais), mas cobre a rodada quando as cotas do Gemini e
//      do OpenRouter acabaram. Groq não entra aqui: o plano gratuito limita 8 mil tokens/minuto,
//      menos que um edital completo.
// Env opcionais: MAX_DOSSIES_POR_EXECUCAO (10),
// MAX_DOSSIES_DIA (60), MAX_TENTATIVAS_DOSSIE (2), DIAS_BOLETIM_DOSSIE (30),
// LIMITE_MINUTOS_DOSSIES (20), ESPERAS_SOBRECARGA (3), ESPERA_SOBRECARGA_SEGUNDOS (60).
//
// Por que a cadeia: em 09/10/2026 a rodada gerou 0 dossiês porque a cota diária gratuita
// (GenerateRequestsPerDayPerProjectPerModel-FreeTier) dos dois modelos do Gemini acabou, e o
// produto dependia só dele. A cota gratuita de cada provedor pode mudar a qualquer momento;
// a proteção é a cadeia, não o limite de um deles. Regras da cadeia:
//   - 429 (ou 401/403 nos provedores OpenAI-compatíveis, chave inválida): o modelo é dado como
//     esgotado até o fim da rodada e os editais seguintes nem o chamam;
//   - 404 (modelo inexistente) ou 5xx/timeout: passa ao próximo modelo/provedor;
//   - só quando todos os modelos de todos os provedores estão esgotados ou sobrecarregados a
//     rodada para sem gastar a tentativa do edital (CotaEsgotada / GeminiSobrecarregado).
// Mistral e OpenRouter usam a API compatível com OpenAI; o schema do contrato não pode ser
// imposto nativamente, então vai no texto da instrução e o resultado passa pelo mesmo
// ajustarAoSchema do Gemini. O provedor e o modelo usados ficam no dossiê (provedorIA, modeloIA).
//
// Até 08/10/2026 o dossiê era gerado pelo GPT-5.1 no AI Gateway da Netlify (~40
// créditos por edital) e o robô resumia toda a base nova, não só o que os clientes
// veem; a conta da Netlify foi suspensa por isso. Agora só entram na fila os editais
// enviados nos boletins (histórico editais_vistos) e os que um cliente abriu sem
// dossiê pronto (tabela fila_dossies). O resultado é gravado em dossies_editais, de onde o painel lê.

const contrato = require("../netlify/functions/_resumo_gateway_contrato");
const { ancorasPrazos } = require("../netlify/functions/_resumo_gateway");
const { salvarDossiePersistido } = require("../netlify/functions/_dossies_persistidos");
const { conferirEvidenciasDoResumo } = require("../netlify/functions/_resumo_evidencias");
const { __test: iaEdital } = require("../netlify/functions/lib/ia-edital");
const { restFetch, buscarBlob } = require("./supabase_dados");
// A mesma VERSAO_RESUMO que a Function grava e exige no cache.
const { VERSAO_DOSSIE } = require("./preparar_dossies_editais");

// Desde 09/10/2026 o Google responde 404 ao gemini-2.5-flash para chaves novas. Na cota
// gratuita, cada modelo tem o próprio limite diário de pedidos.
const MODELOS = [...new Set([process.env.GEMINI_MODELO || "gemini-3.8-flash", "gemini-3.7-flash"])];
const MAX_POR_EXECUCAO = Math.max(1, Number(process.env.MAX_DOSSIES_POR_EXECUCAO || 10));
const MAX_DIA = Math.max(1, Number(process.env.MAX_DOSSIES_DIA || 60));
const MAX_TENTATIVAS = Math.max(1, Number(process.env.MAX_TENTATIVAS_DOSSIE || 2));
const DIAS_BOLETIM = Math.max(1, Number(process.env.DIAS_BOLETIM_DOSSIE || 30));
const LIMITE_MS = Math.max(1, Number(process.env.LIMITE_MINUTOS_DOSSIES || 20)) * 60 * 1000;
const ESPERAS_SOBRECARGA = Math.max(0, Number(process.env.ESPERAS_SOBRECARGA ?? 3));
const ESPERA_SOBRECARGA_MS = Math.max(0, Number(process.env.ESPERA_SOBRECARGA_SEGUNDOS ?? 60)) * 1000;
const URL_MISTRAL = "https://api.mistral.ai/v1/chat/completions";
const URL_OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";
// Aliases estáveis documentados pela Mistral; o plano gratuito "Experiment" dá ~1 bilhão de tokens/mês.
const MODELOS_MISTRAL_PADRAO = "mistral-medium-latest,mistral-small-latest";
// Sem padrão: a lista de modelos :free do OpenRouter muda toda semana e não foi possível conferi-la
// ao escrever isto. Defina OPENROUTER_MODELOS (vírgulas) com modelos ":free" de contexto >= 128k.
const MODELOS_OPENROUTER_PADRAO = "";
const MODELOS_CLOUDFLARE_PADRAO = "@cf/openai/gpt-oss-120b";
const NAO_INFORMADO = "Não informado";
const URL_GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_CHAMADA_MS = 300000;
// Mistral e OpenRouter têm contexto de 128k tokens; precisa caber fonte + instrução + schema + até
// 32768 tokens de saída. 200 mil caracteres de edital em português são ~60-70 mil tokens. Os editais
// reais chegam a ~100 mil caracteres; o corte só protege contra os maiores. O Gemini (1M) não corta.
const MAX_CARACTERES_FONTE_COMPAT = 200000;
const MAX_TOKENS_SAIDA = 32768;
const lista = (valor, padrao = "") => String(valor || padrao).split(",").map((m) => m.trim()).filter(Boolean);

class CotaEsgotada extends Error {}
// Sobrecarga do Google costuma passar em um ou dois minutos; a cota esgotada (429) não.
class GeminiSobrecarregado extends CotaEsgotada {}
// Provedor sem nenhum modelo utilizável (todos 404): não é culpa do edital; a cadeia segue para o próximo.
class ProvedorIndisponivel extends Error {}

// O modelo às vezes devolve campos a mais, a menos ou fora do tipo. Em vez de
// descartar o dossiê inteiro (o que antes gerava nova cobrança no dia seguinte),
// ajusta ao contrato: só chaves conhecidas, texto ausente vira "Não informado".
function ajustarAoSchema(valor, schema) {
  if (schema.type === "string") {
    const texto = typeof valor === "string" ? valor : valor == null ? "" : String(valor);
    if (schema.enum) return schema.enum.includes(texto) ? texto : schema.enum[schema.enum.length - 1];
    return texto.trim() ? texto : NAO_INFORMADO;
  }
  if (schema.type === "array") return Array.isArray(valor) ? valor.map((item) => ajustarAoSchema(item, schema.items)) : [];
  const origem = valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
  return Object.fromEntries(Object.entries(schema.properties).map(([chave, sub]) => [chave, ajustarAoSchema(origem[chave], sub)]));
}

// O Gemini aceita JSON Schema, mas não as marcações de "strict" da OpenAI.
function schemaParaGemini(schema) {
  if (Array.isArray(schema)) return schema.map(schemaParaGemini);
  if (!schema || typeof schema !== "object") return schema;
  return Object.fromEntries(Object.entries(schema).filter(([chave]) => chave !== "additionalProperties" && chave !== "strict")
    .map(([chave, valor]) => [chave, schemaParaGemini(valor)]));
}

// Na comparação de 08/10/2026 com o GPT-5.1, o Gemini acertou datas, valor e itens,
// mas deixou prazos e garantias como "Não informado" e agrupou documentos de habilitação.
const REFORCO_GEMINI = [
  "Antes de usar \"Não informado\", procure o dado no texto integral, inclusive Termo de Referência, minuta do contrato e anexos.",
  "Prazos de esclarecimento, impugnação, recurso e contrarrazões costumam estar em capítulos próprios do edital: transcreva-os com a referência do item.",
  "Liste cada documento de habilitação em uma entrada própria, sem agrupar exigências distintas.",
  "Não acrescente certificado digital, certidão de falência ou recuperação judicial só porque são usuais: exija trecho explícito da fonte para cada condição. Referência a SICAF não comprova essas exigências específicas.",
  "Se os anexos contiverem somente aviso/extrato de publicação, declare isso em pendenciasParaConferencia; aviso lido não é edital completo. Não use datas e exigências de outras licitações na mesma página de diário oficial.",
  "A data da sessão pública é a abertura da disputa; não a confunda com o início ou o fim do envio de propostas.",
].join(" ");

function corpoGemini(ficha, fonte, comSchema = true) {
  return {
    systemInstruction: { parts: [{ text: `${contrato.prompt}\n\n${REFORCO_GEMINI}` }] },
    contents: [{ role: "user", parts: [{ text: `DADOS OFICIAIS: ${JSON.stringify(ficha)}\nFONTE OFICIAL INTEGRAL:\n${fonte}` }] }],
    generationConfig: { responseMimeType: "application/json", maxOutputTokens: MAX_TOKENS_SAIDA, ...(comSchema ? { responseJsonSchema: schemaParaGemini(contrato.schema) } : {}) },
  };
}

function lerSaida(dados) {
  const candidato = dados.candidates?.[0];
  if (candidato?.finishReason !== "STOP") throw new Error(`resposta_incompleta_${candidato?.finishReason || "vazia"}`);
  return JSON.parse((candidato.content?.parts || []).map((parte) => parte.text || "").join(""));
}

// Status e mensagem do Google no log: sem eles não dá para separar sobrecarga, cota por
// minuto e cota diária, e as primeiras rodadas pararam sem dizer qual foi.
async function registrarRecusa(rotulo, resposta) {
  const texto = await resposta.text().catch(() => "");
  let detalhes = [];
  try { detalhes = JSON.parse(texto).error?.details || []; } catch (_) { /* corpo não-JSON: vai o texto */ }
  // O 429 só diz qual cota acabou (por minuto ou por dia) e quando volta nestes campos.
  const cotas = detalhes.flatMap((d) => d.violations || []).map((v) => v.quotaId).filter(Boolean);
  const espera = detalhes.find((d) => d.retryDelay)?.retryDelay;
  const resumo = cotas.length ? `cota ${[...new Set(cotas)].join(", ")}${espera ? `, volta em ${espera}` : ""}` : texto.replace(/\s+/g, " ").slice(0, 300);
  console.log(`[dossiês] ${rotulo}: HTTP ${resposta.status} ${resumo}`);
}

// Falha de rede ou timeout vira "sem resposta" (null): conta como sobrecarga, não como erro do edital.
async function tentarFetch(rotulo, fetchFn, url, opcoes) {
  try {
    return await fetchFn(url, { ...opcoes, signal: AbortSignal.timeout(TIMEOUT_CHAMADA_MS) });
  } catch (erro) {
    console.log(`[dossiês] ${rotulo}: sem resposta (${erro.name}: ${String(erro.message).slice(0, 100)})`);
    return null;
  }
}

async function chamarGemini(ficha, fonte, { apiKey, fetchFn = fetch, modelos = MODELOS, esgotados = new Set() } = {}) {
  let comSchema = true, sobrecarga = false, cotaEsgotada = false;
  for (let indice = 0; indice < modelos.length;) {
    const rotulo = `gemini/${modelos[indice]}`;
    if (esgotados.has(rotulo)) { cotaEsgotada = true; indice += 1; continue; }
    const resposta = await tentarFetch(rotulo, fetchFn, `${URL_GEMINI}/${modelos[indice]}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(corpoGemini(ficha, fonte, comSchema)),
    });
    if (resposta?.status === 404) { await registrarRecusa(rotulo, resposta); indice += 1; continue; }
    // Na cota gratuita cada modelo tem a própria cota: um 429 no primeiro modelo não
    // impede o segundo de responder. Fica esgotado até o fim da rodada.
    if (resposta?.status === 429) {
      await registrarRecusa(rotulo, resposta);
      esgotados.add(rotulo);
      cotaEsgotada = true; indice += 1; continue;
    }
    // 500/503 = modelo sobrecarregado no Google (comum na cota gratuita): tenta o próximo
    // modelo e, se todos estiverem assim, para a rodada sem gastar tentativa do edital.
    if (!resposta || resposta.status >= 500) {
      if (resposta) await registrarRecusa(rotulo, resposta);
      sobrecarga = true; indice += 1; continue;
    }
    const dados = await resposta.json().catch(() => ({}));
    // Schema recusado pela API: repete uma vez pedindo só JSON; o ajuste local garante o formato.
    if (resposta.status === 400 && comSchema && /schema/i.test(dados.error?.message || "")) { comSchema = false; continue; }
    if (!resposta.ok) throw new Error(`gemini_http_${resposta.status}`);
    return { saida: lerSaida(dados), modelo: modelos[indice], uso: dados.usageMetadata || null };
  }
  if (sobrecarga) throw new GeminiSobrecarregado("Gemini sobrecarregado em todos os modelos");
  if (cotaEsgotada) throw new CotaEsgotada("cota do Gemini esgotada em todos os modelos");
  throw new ProvedorIndisponivel("nenhum_modelo_gemini_disponivel");
}

// Mistral e OpenRouter: mesma instrução e mesmo conteúdo do Gemini, no formato OpenAI. O schema
// vai no texto porque response_format json_object só garante JSON válido, não o formato.
function corpoCompat(ficha, fonte, modelo, comFormato = true) {
  const instrucao = `${contrato.prompt}\n\n${REFORCO_GEMINI}\n\nResponda somente com um objeto JSON, sem texto fora dele, que siga exatamente este JSON Schema:\n${JSON.stringify(schemaParaGemini(contrato.schema))}`;
  return {
    model: modelo, max_tokens: MAX_TOKENS_SAIDA,
    messages: [
      { role: "system", content: instrucao },
      { role: "user", content: `DADOS OFICIAIS: ${JSON.stringify(ficha)}\nFONTE OFICIAL INTEGRAL:\n${fonte.slice(0, MAX_CARACTERES_FONTE_COMPAT)}` },
    ],
    ...(comFormato ? { response_format: { type: "json_object" } } : {}),
  };
}

// Modelos menores às vezes embrulham o JSON em ```json.
function lerSaidaCompat(dados) {
  const escolha = dados.choices?.[0];
  const texto = String(escolha?.message?.content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!texto || ["length", "content_filter", "error"].includes(escolha?.finish_reason)) throw new Error(`resposta_incompleta_${escolha?.finish_reason || "vazia"}`);
  const saida = JSON.parse(texto);
  if (!saida || typeof saida.estrutura !== "object" || !saida.estrutura) throw new Error("resposta_sem_estrutura");
  return saida;
}

async function chamarCompat(provedor, ficha, fonte, { fetchFn = fetch, esgotados = new Set() } = {}) {
  const { nome, url, apiKey, modelos } = provedor;
  let sobrecarga = false, cotaEsgotada = false;
  if (fonte.length > MAX_CARACTERES_FONTE_COMPAT) console.log(`[dossiês] ${nome}: fonte de ${fonte.length} caracteres cortada em ${MAX_CARACTERES_FONTE_COMPAT} para caber no contexto.`);
  for (let indice = 0; indice < modelos.length;) {
    const rotulo = `${nome}/${modelos[indice]}`;
    // Memorizado na rodada para não gastar uma chamada por edital com um modelo que recusa o formato.
    const chaveSemFormato = `${rotulo}#sem_formato`;
    if (esgotados.has(rotulo)) { cotaEsgotada = true; indice += 1; continue; }
    const comFormato = !esgotados.has(chaveSemFormato);
    const resposta = await tentarFetch(rotulo, fetchFn, url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(corpoCompat(ficha, fonte, modelos[indice], comFormato)),
    });
    if (resposta?.status === 404) { await registrarRecusa(rotulo, resposta); indice += 1; continue; }
    // 401/403 = chave recusada: não é culpa do edital, então o modelo sai da rodada como na cota.
    if ([401, 403, 429].includes(resposta?.status)) {
      await registrarRecusa(rotulo, resposta);
      esgotados.add(rotulo);
      cotaEsgotada = true; indice += 1; continue;
    }
    if (!resposta || resposta.status >= 500) {
      if (resposta) await registrarRecusa(rotulo, resposta);
      sobrecarga = true; indice += 1; continue;
    }
    // response_format recusado: repete uma vez sem ele; o schema já está na instrução.
    if ([400, 422].includes(resposta.status) && comFormato) { esgotados.add(chaveSemFormato); continue; }
    if (!resposta.ok) throw new Error(`${nome}_http_${resposta.status}`);
    const dados = await resposta.json().catch(() => ({}));
    return { saida: lerSaidaCompat(dados), modelo: modelos[indice], uso: dados.usage ? { totalTokenCount: dados.usage.total_tokens } : null };
  }
  if (sobrecarga) throw new GeminiSobrecarregado(`${nome} sobrecarregado em todos os modelos`);
  if (cotaEsgotada) throw new CotaEsgotada(`${nome} sem cota em todos os modelos`);
  throw new ProvedorIndisponivel(`nenhum_modelo_${nome}_disponivel`);
}

// Só entram provedores com chave configurada (e, no OpenRouter, com lista de modelos).
function montarProvedores(env = process.env) {
  const provedores = [];
  if (env.GEMINI_API_KEY) provedores.push({ nome: "gemini", modelos: MODELOS, chamar: (ficha, fonte, opcoes) => chamarGemini(ficha, fonte, { ...opcoes, apiKey: env.GEMINI_API_KEY }) });
  for (const [nome, url, chave, modelos] of [
    ["mistral", URL_MISTRAL, env.MISTRAL_API_KEY, lista(env.MISTRAL_MODELOS, MODELOS_MISTRAL_PADRAO)],
    ["openrouter", URL_OPENROUTER, env.OPENROUTER_API_KEY, lista(env.OPENROUTER_MODELOS, MODELOS_OPENROUTER_PADRAO)],
    // Precisa da conta e do token: sem o ID da conta a URL nem existe.
    ["cloudflare", `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`, env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_TOKEN, lista(env.CLOUDFLARE_AI_MODELOS, MODELOS_CLOUDFLARE_PADRAO)],
  ]) {
    if (!chave || !modelos.length) continue;
    const provedor = { nome, url, apiKey: nome === "cloudflare" ? env.CLOUDFLARE_AI_TOKEN : chave, modelos };
    provedores.push({ nome, modelos, chamar: (ficha, fonte, opcoes) => chamarCompat(provedor, ficha, fonte, opcoes) });
  }
  return provedores;
}

// Percorre a cadeia na ordem. `esgotados` vale pela rodada inteira (compartilhado entre editais).
async function chamarCadeia(ficha, fonte, { provedores, fetchFn, esgotados = new Set() }) {
  let sobrecarga = false, cotaEsgotada = false;
  for (const provedor of provedores) {
    try {
      return { ...await provedor.chamar(ficha, fonte, { fetchFn, esgotados }), provedor: provedor.nome };
    } catch (erro) {
      if (erro instanceof GeminiSobrecarregado) sobrecarga = true;
      else if (erro instanceof CotaEsgotada) cotaEsgotada = true;
      else if (!(erro instanceof ProvedorIndisponivel)) throw erro;
    }
  }
  if (sobrecarga) throw new GeminiSobrecarregado("IA sobrecarregada em todos os provedores");
  if (cotaEsgotada) throw new CotaEsgotada("cota da IA esgotada em todos os provedores");
  throw new Error("nenhum_modelo_disponivel");
}

// metodoResumo continua "sintese_gemini" para qualquer provedor (o painel e o cache a conhecem);
// quem gerou fica nos campos novos provedorIA/modeloIA.
function montarResultado(saida, fonte, cobertura, agora = Date.now(), origem = {}) {
  const estrutura = ajustarAoSchema(saida, contrato.schema).estrutura;
  estrutura.coberturaLeitura = cobertura;
  estrutura.documentosConsultados = cobertura?.documentosLidos || [];
  // Antes, uma data da fonte ausente no resumo derrubava o dossiê e uma revisão paga
  // era repetida a cada dia. Agora o dossiê é entregue com a data em conferência, mas
  // sem a marca de prazos revisados: quem lê sabe que esses prazos não foram conferidos.
  const { datasAusentes } = ancorasPrazos(fonte, estrutura, agora);
  if (datasAusentes.length) {
    estrutura.pendenciasParaConferencia = [...estrutura.pendenciasParaConferencia,
      `Conferir no edital o evento correspondente às datas: ${datasAusentes.slice(0, 10).join(", ")}.`];
  }
  return conferirEvidenciasDoResumo({ estrutura, resposta: estrutura.resumoGeral, textoEdital: fonte, fonteLida: true, modoDegradado: false,
    metodoResumo: "sintese_gemini", versao: VERSAO_DOSSIE, versaoValidacao: VERSAO_DOSSIE,
    revisaoPrazos: datasAusentes.length === 0, prazosEmConferencia: datasAusentes.length > 0,
    geradoEm: new Date(agora).toISOString(), erro: null,
    ...(origem.provedor ? { provedorIA: origem.provedor, modeloIA: origem.modelo } : {}) });
}

// Cliques primeiro (alguém está esperando), depois boletins do mais novo ao mais antigo.
function selecionarCandidatos({ fila, boletim, antecipados = [], dossiesProntos, tentativas, limite }) {
  const vistos = new Set();
  const candidatos = [];
  const pode = (numero) => numero && !vistos.has(numero) && !dossiesProntos.has(numero) && (tentativas.get(numero) || 0) < MAX_TENTATIVAS;
  for (const item of [...fila].sort((a, b) => String(a.pedido_em).localeCompare(String(b.pedido_em)))) {
    if (pode(item.numero_controle_pncp)) { vistos.add(item.numero_controle_pncp); candidatos.push({ numero: item.numero_controle_pncp, origem: item.origem || "clique" }); }
  }
  for (const item of [...boletim, ...antecipados].sort((a, b) => String(b.publicacao).localeCompare(String(a.publicacao)))) {
    if (pode(item.numero_controle_pncp)) { vistos.add(item.numero_controle_pncp); candidatos.push({ numero: item.numero_controle_pncp, origem: "boletim" }); }
  }
  return candidatos.slice(0, Math.max(0, limite));
}

function listaIn(numeros) {
  return encodeURIComponent(`in.(${numeros.map((numero) => `"${String(numero).replaceAll('"', "")}"`).join(",")})`);
}

async function consultarEmLotes(tabela, coluna, numeros, selecao, filtros = "") {
  const linhas = [];
  for (let indice = 0; indice < numeros.length; indice += 100) {
    const lote = numeros.slice(indice, indice + 100);
    const resposta = await restFetch(`${tabela}?${coluna}=${listaIn(lote)}&select=${selecao}${filtros}`);
    linhas.push(...await resposta.json());
  }
  return linhas;
}

async function carregarAntecipados(desde, hoje, fetchFn = restFetch) {
  try {
    const resposta = await fetchFn("rpc/oportunidades_para_dossies", { method: "POST", body: JSON.stringify({
      p_versao: VERSAO_DOSSIE, p_max_tentativas: MAX_TENTATIVAS,
      p_desde: desde, p_hoje: hoje, p_limite: 200,
    }) });
    const linhas = await resposta.json();
    if (!Array.isArray(linhas)) throw new Error("resposta inválida");
    return linhas;
  } catch (erro) {
    // Migração ainda ausente ou falha temporária não interrompe os cliques/boletins existentes.
    console.warn(`[dossiês] seleção antecipada indisponível: ${erro.message}`);
    return [];
  }
}

async function carregarCandidatos(agora = Date.now()) {
  const fila = await (await restFetch(`fila_dossies?concluido_em=is.null&tentativas=lt.${MAX_TENTATIVAS}&select=numero_controle_pncp,origem,pedido_em&order=pedido_em.asc&limit=200`)).json();
  const historico = await buscarBlob("dados_robo", "editais_vistos");
  const enviados = [...new Set(Object.values(historico && typeof historico === "object" ? historico : {}).flat().filter(Boolean))];
  const desde = new Date(agora - DIAS_BOLETIM * 86400000).toISOString().slice(0, 10);
  const hoje = new Date(agora).toISOString().slice(0, 10);
  const antecipados = await carregarAntecipados(desde, hoje);
  const boletim = (await consultarEmLotes("oportunidades_abertas", "numero_controle_pncp", enviados, "numero_controle_pncp,publicacao,encerramento", `&publicacao=gte.${desde}`))
    .filter((linha) => !linha.encerramento || linha.encerramento >= hoje);
  const numeros = [...new Set([...fila, ...boletim, ...antecipados].map((linha) => linha.numero_controle_pncp))];
  const dossies = await consultarEmLotes("dossies_editais", "numero_controle_pncp", numeros, "numero_controle_pncp,versao,status");
  const registros = await consultarEmLotes("fila_dossies", "numero_controle_pncp", numeros, "numero_controle_pncp,tentativas");
  return {
    fila, boletim, antecipados,
    dossiesProntos: new Set(dossies.filter(dossieCompleto).map((linha) => linha.numero_controle_pncp)),
    tentativas: new Map(registros.map((linha) => [linha.numero_controle_pncp, Number(linha.tentativas) || 0])),
  };
}

// Parcial = algum documento do edital não foi lido; volta para a fila até esgotar as tentativas.
function dossieCompleto(linha) {
  return Number(linha?.versao) === VERSAO_DOSSIE && linha?.status === "pronto";
}

async function tentativasHoje(agora = Date.now()) {
  const hoje = new Date(agora).toISOString().slice(0, 10);
  return (await (await restFetch(`fila_dossies?ultima_tentativa_em=gte.${hoje}&select=numero_controle_pncp`)).json()).length;
}

async function registrarTentativa(candidato, tentativasAnteriores, { erro = null, concluido = false, esgotar = false }) {
  const agora = new Date().toISOString();
  await restFetch("fila_dossies?on_conflict=numero_controle_pncp", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ numero_controle_pncp: candidato.numero, origem: candidato.origem,
      tentativas: esgotar ? MAX_TENTATIVAS : tentativasAnteriores + 1, ultima_tentativa_em: agora,
      ultimo_erro: erro, concluido_em: concluido ? agora : null }]),
  });
}

async function gerarDossie(numero, { provedores, fetchFn, esgotados } = {}) {
  const ficha = await iaEdital.buscarFichaCanonica(numero) || { numeroControlePNCP: numero, fonte: "PNCP" };
  // A preparação em segundo plano pode ler os anexos que não cabem no limite interativo.
  const leitura = await iaEdital.buscarTextoEdital(numero, { limiteDocumentos: 12,
    extrairArquivo: process.env.LEITURA_MULTIFORMATO === "1" ? require("./extrair_anexo_local").extrairAnexoLocal : null });
  if (!leitura.texto && leitura.indisponivel) return { pncpIndisponivel: true };
  if (!leitura.texto) return { semDocumento: true, motivo: leitura.escaneado ? "escaneado" : "sem_documento" };
  const { saida, modelo, provedor, uso } = await chamarCadeia(ficha, leitura.texto, { provedores, fetchFn, esgotados });
  const resultado = montarResultado(saida, leitura.texto, leitura.coberturaLeitura, Date.now(), { provedor, modelo });
  await salvarDossiePersistido(numero, resultado);
  // salvarDossiePersistido só registra a falha no log; sem esta conferência um dossiê
  // não gravado sairia da fila como concluído e o cliente ficaria só com a ficha.
  const gravado = await (await restFetch(`dossies_editais?numero_controle_pncp=eq.${encodeURIComponent(numero)}&select=versao,status`)).json();
  if (Number(gravado[0]?.versao) !== VERSAO_DOSSIE) throw new Error("gravacao_falhou");
  return { modelo, provedor, uso, completo: dossieCompleto(gravado[0]) };
}

// Na primeira execução em produção (09/10/2026) o Google respondeu "sobrecarregado" e a
// rodada terminou em segundos sem gerar nada. Esperar um pouco e repetir o mesmo edital
// aproveita a janela da rodada; cota esgotada (429) continua encerrando de imediato.
async function gerarComEspera(numero, { prazoFinal, gerar = gerarDossie, esperar = (ms) => new Promise((r) => setTimeout(r, ms)), ...opcoes }) {
  for (let espera = 0; ; espera += 1) {
    try {
      return await gerar(numero, opcoes);
    } catch (erro) {
      const cabeEspera = Date.now() + ESPERA_SOBRECARGA_MS < prazoFinal;
      if (!(erro instanceof GeminiSobrecarregado) || espera >= ESPERAS_SOBRECARGA || !cabeEspera) throw erro;
      console.log(`[dossiês] IA sobrecarregada; nova tentativa em ${ESPERA_SOBRECARGA_MS / 1000} s.`);
      await esperar(ESPERA_SOBRECARGA_MS);
    }
  }
}

async function main() {
  const provedores = montarProvedores();
  if (!provedores.length) {
    console.log("[dossiês] nenhuma chave de IA configurada (GEMINI_API_KEY, MISTRAL_API_KEY ou OPENROUTER_API_KEY em Settings > Secrets and variables > Actions); nada a fazer.");
    return;
  }
  console.log(`[dossiês] cadeia de IA: ${provedores.map((p) => `${p.nome}(${p.modelos.join(",")})`).join(" > ")}`);
  const esgotados = new Set();
  const inicio = Date.now();
  const restanteDia = MAX_DIA - await tentativasHoje();
  const dados = await carregarCandidatos();
  const candidatos = selecionarCandidatos({ ...dados, limite: Math.min(MAX_POR_EXECUCAO, restanteDia) });
  console.log(`[dossiês] ${dados.fila.length} pedido(s) na fila, ${dados.boletim.length} edital(is) enviados, ${dados.antecipados.length} antecipado(s) pelos filtros; ${candidatos.length} a gerar (teto do dia: ${Math.max(0, restanteDia)} restante(s)).`);
  const contagem = { gerado: 0, sem_documento: 0, falha: 0 };
  for (const candidato of candidatos) {
    if (Date.now() - inicio > LIMITE_MS) break;
    const anteriores = dados.tentativas.get(candidato.numero) || 0;
    try {
      const resultado = await gerarComEspera(candidato.numero, { provedores, esgotados, prazoFinal: inicio + LIMITE_MS });
      if (resultado.pncpIndisponivel) {
        // PNCP fora do ar: o edital continua na fila sem gastar tentativa.
        console.warn(`[dossiês] PNCP não respondeu ao baixar ${candidato.numero}; o restante fica para a próxima execução.`);
        break;
      }
      if (resultado.semDocumento) {
        // Sem documento legível não há o que a IA ler: não volta para a fila.
        await registrarTentativa(candidato, anteriores, { erro: resultado.motivo, esgotar: true });
        contagem.sem_documento += 1;
        console.log(`[dossiês] ${resultado.motivo}: ${candidato.numero}`);
        continue;
      }
      // O dossiê parcial já fica visível ao cliente, mas o edital segue na fila para nova leitura.
      await registrarTentativa(candidato, anteriores, resultado.completo ? { concluido: true } : { erro: "leitura_parcial" });
      contagem.gerado += 1;
      console.log(`[dossiês] gerado ${resultado.completo ? "completo" : "parcial"} (${resultado.provedor}/${resultado.modelo}, ${resultado.uso?.totalTokenCount || "?"} tokens): ${candidato.numero}`);
    } catch (erro) {
      if (erro instanceof CotaEsgotada) {
        console.warn(`[dossiês] ${erro.message}; o restante fica para a próxima execução.`);
        break;
      }
      await registrarTentativa(candidato, anteriores, { erro: String(erro.message).slice(0, 200) });
      contagem.falha += 1;
      console.warn(`[dossiês] falhou ${candidato.numero}: ${erro.message}`);
    }
  }
  console.log(`[dossiês] concluído: ${contagem.gerado} gerado(s), ${contagem.sem_documento} sem documento legível, ${contagem.falha} falha(s).`);
}

if (require.main === module) {
  main().catch((erro) => { console.error(`[dossiês] ${erro.message}`); process.exitCode = 1; });
}

module.exports = { VERSAO_DOSSIE, montarProvedores, chamarCadeia, chamarCompat, corpoCompat, ajustarAoSchema, schemaParaGemini, corpoGemini, chamarGemini, montarResultado, selecionarCandidatos, carregarAntecipados, dossieCompleto, gerarComEspera, CotaEsgotada, GeminiSobrecarregado };
