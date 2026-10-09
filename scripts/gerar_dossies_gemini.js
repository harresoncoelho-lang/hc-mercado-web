/* global AbortSignal */
// Gera os dossiês (resumo completo) dos editais com o Gemini, fora da Netlify.
// Uso: node scripts/gerar_dossies_gemini.js
// Env obrigatórias: GEMINI_API_KEY e SUPABASE_SERVICE_ROLE_KEY.
// Env opcionais: GEMINI_MODELO (gemini-3.8-flash), MAX_DOSSIES_POR_EXECUCAO (10),
// MAX_DOSSIES_DIA (60), MAX_TENTATIVAS_DOSSIE (2), DIAS_BOLETIM_DOSSIE (30),
// LIMITE_MINUTOS_DOSSIES (20), ESPERAS_SOBRECARGA (3), ESPERA_SOBRECARGA_SEGUNDOS (60).
//
// Até 08/10/2026 o dossiê era gerado pelo GPT-5.1 no AI Gateway da Netlify (~40
// créditos por edital) e o robô resumia toda a base nova, não só o que os clientes
// veem; a conta da Netlify foi suspensa por isso. Agora só entram na fila os editais
// enviados nos boletins (histórico editais_vistos) e os que um cliente abriu sem
// dossiê pronto (tabela fila_dossies). A chamada vai direto à API do Gemini, que tem
// cota gratuita, e o resultado é gravado em dossies_editais, de onde o painel lê.

const contrato = require("../netlify/functions/_resumo_gateway_contrato");
const { ancorasPrazos } = require("../netlify/functions/_resumo_gateway");
const { salvarDossiePersistido } = require("../netlify/functions/_dossies_persistidos");
const { __test: iaEdital } = require("../netlify/functions/lib/ia-edital");
const { restFetch, buscarBlob } = require("./supabase_dados");
// A mesma VERSAO_RESUMO que a Function grava e exige no cache.
const { VERSAO_DOSSIE } = require("./preparar_dossies_editais");

const MODELOS = [...new Set([process.env.GEMINI_MODELO || "gemini-3.8-flash", "gemini-3.7-flash", "gemini-2.5-flash"])];
const MAX_POR_EXECUCAO = Math.max(1, Number(process.env.MAX_DOSSIES_POR_EXECUCAO || 10));
const MAX_DIA = Math.max(1, Number(process.env.MAX_DOSSIES_DIA || 60));
const MAX_TENTATIVAS = Math.max(1, Number(process.env.MAX_TENTATIVAS_DOSSIE || 2));
const DIAS_BOLETIM = Math.max(1, Number(process.env.DIAS_BOLETIM_DOSSIE || 30));
const LIMITE_MS = Math.max(1, Number(process.env.LIMITE_MINUTOS_DOSSIES || 20)) * 60 * 1000;
const ESPERAS_SOBRECARGA = Math.max(0, Number(process.env.ESPERAS_SOBRECARGA ?? 3));
const ESPERA_SOBRECARGA_MS = Math.max(0, Number(process.env.ESPERA_SOBRECARGA_SEGUNDOS ?? 60)) * 1000;
const NAO_INFORMADO = "Não informado";
const URL_GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";

class CotaEsgotada extends Error {}
// Sobrecarga do Google costuma passar em um ou dois minutos; a cota esgotada (429) não.
class GeminiSobrecarregado extends CotaEsgotada {}

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
  "A data da sessão pública é a abertura da disputa; não a confunda com o início ou o fim do envio de propostas.",
].join(" ");

function corpoGemini(ficha, fonte, comSchema = true) {
  return {
    systemInstruction: { parts: [{ text: `${contrato.prompt}\n\n${REFORCO_GEMINI}` }] },
    contents: [{ role: "user", parts: [{ text: `DADOS OFICIAIS: ${JSON.stringify(ficha)}\nFONTE OFICIAL INTEGRAL:\n${fonte}` }] }],
    generationConfig: { responseMimeType: "application/json", maxOutputTokens: 32768, ...(comSchema ? { responseJsonSchema: schemaParaGemini(contrato.schema) } : {}) },
  };
}

function lerSaida(dados) {
  const candidato = dados.candidates?.[0];
  if (candidato?.finishReason !== "STOP") throw new Error(`resposta_incompleta_${candidato?.finishReason || "vazia"}`);
  return JSON.parse((candidato.content?.parts || []).map((parte) => parte.text || "").join(""));
}

// Status e mensagem do Google no log: sem eles não dá para separar sobrecarga, cota por
// minuto e cota diária, e as primeiras rodadas pararam sem dizer qual foi.
async function registrarRecusa(modelo, resposta) {
  const texto = await resposta.text().catch(() => "");
  let detalhes = [];
  try { detalhes = JSON.parse(texto).error?.details || []; } catch (_) { /* corpo não-JSON: vai o texto */ }
  // O 429 só diz qual cota acabou (por minuto ou por dia) e quando volta nestes campos.
  const cotas = detalhes.flatMap((d) => d.violations || []).map((v) => v.quotaId).filter(Boolean);
  const espera = detalhes.find((d) => d.retryDelay)?.retryDelay;
  const resumo = cotas.length ? `cota ${[...new Set(cotas)].join(", ")}${espera ? `, volta em ${espera}` : ""}` : texto.replace(/\s+/g, " ").slice(0, 300);
  console.log(`[dossiês] ${modelo}: HTTP ${resposta.status} ${resumo}`);
}

async function chamarGemini(ficha, fonte, { apiKey, fetchFn = fetch, modelos = MODELOS } = {}) {
  let comSchema = true, sobrecarga = false, cotaEsgotada = false;
  for (let indice = 0; indice < modelos.length;) {
    const resposta = await fetchFn(`${URL_GEMINI}/${modelos[indice]}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(corpoGemini(ficha, fonte, comSchema)),
      signal: AbortSignal.timeout(300000),
    });
    if (resposta.status === 404) { await registrarRecusa(modelos[indice], resposta); indice += 1; continue; }
    // Na cota gratuita cada modelo tem a própria cota: um 429 no primeiro modelo não
    // impede o segundo de responder.
    if (resposta.status === 429) {
      await registrarRecusa(modelos[indice], resposta);
      cotaEsgotada = true; indice += 1; continue;
    }
    // 500/503 = modelo sobrecarregado no Google (comum na cota gratuita): tenta o próximo
    // modelo e, se todos estiverem assim, para a rodada sem gastar tentativa do edital.
    if (resposta.status >= 500) {
      await registrarRecusa(modelos[indice], resposta);
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
  throw new Error("nenhum_modelo_gemini_disponivel");
}

function montarResultado(saida, fonte, cobertura, agora = Date.now()) {
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
  return { estrutura, resposta: estrutura.resumoGeral, textoEdital: fonte, fonteLida: true, modoDegradado: false,
    metodoResumo: "sintese_gemini", versao: VERSAO_DOSSIE, versaoValidacao: VERSAO_DOSSIE,
    revisaoPrazos: datasAusentes.length === 0, prazosEmConferencia: datasAusentes.length > 0,
    geradoEm: new Date(agora).toISOString(), erro: null };
}

// Cliques primeiro (alguém está esperando), depois boletins do mais novo ao mais antigo.
function selecionarCandidatos({ fila, boletim, dossiesProntos, tentativas, limite }) {
  const vistos = new Set();
  const candidatos = [];
  const pode = (numero) => numero && !vistos.has(numero) && !dossiesProntos.has(numero) && (tentativas.get(numero) || 0) < MAX_TENTATIVAS;
  for (const item of [...fila].sort((a, b) => String(a.pedido_em).localeCompare(String(b.pedido_em)))) {
    if (pode(item.numero_controle_pncp)) { vistos.add(item.numero_controle_pncp); candidatos.push({ numero: item.numero_controle_pncp, origem: item.origem || "clique" }); }
  }
  for (const item of [...boletim].sort((a, b) => String(b.publicacao).localeCompare(String(a.publicacao)))) {
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

async function carregarCandidatos(agora = Date.now()) {
  const fila = await (await restFetch("fila_dossies?concluido_em=is.null&select=numero_controle_pncp,origem,pedido_em&order=pedido_em.asc&limit=200")).json();
  const historico = await buscarBlob("dados_robo", "editais_vistos");
  const enviados = [...new Set(Object.values(historico && typeof historico === "object" ? historico : {}).flat().filter(Boolean))];
  const desde = new Date(agora - DIAS_BOLETIM * 86400000).toISOString().slice(0, 10);
  const hoje = new Date(agora).toISOString().slice(0, 10);
  const boletim = (await consultarEmLotes("oportunidades_abertas", "numero_controle_pncp", enviados, "numero_controle_pncp,publicacao,encerramento", `&publicacao=gte.${desde}`))
    .filter((linha) => !linha.encerramento || linha.encerramento >= hoje);
  const numeros = [...new Set([...fila, ...boletim].map((linha) => linha.numero_controle_pncp))];
  const dossies = await consultarEmLotes("dossies_editais", "numero_controle_pncp", numeros, "numero_controle_pncp,versao,status");
  const registros = await consultarEmLotes("fila_dossies", "numero_controle_pncp", numeros, "numero_controle_pncp,tentativas");
  return {
    fila, boletim,
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

async function gerarDossie(numero, { apiKey, fetchFn } = {}) {
  const ficha = await iaEdital.buscarFichaCanonica(numero) || { numeroControlePNCP: numero, fonte: "PNCP" };
  const leitura = await iaEdital.buscarTextoEdital(numero);
  if (!leitura.texto) return { semDocumento: true, motivo: leitura.escaneado ? "escaneado" : "sem_documento" };
  const { saida, modelo, uso } = await chamarGemini(ficha, leitura.texto, { apiKey, fetchFn });
  const resultado = montarResultado(saida, leitura.texto, leitura.coberturaLeitura);
  await salvarDossiePersistido(numero, resultado);
  // salvarDossiePersistido só registra a falha no log; sem esta conferência um dossiê
  // não gravado sairia da fila como concluído e o cliente ficaria só com a ficha.
  const gravado = await (await restFetch(`dossies_editais?numero_controle_pncp=eq.${encodeURIComponent(numero)}&select=versao,status`)).json();
  if (Number(gravado[0]?.versao) !== VERSAO_DOSSIE) throw new Error("gravacao_falhou");
  return { modelo, uso, completo: dossieCompleto(gravado[0]) };
}

// Na primeira execução em produção (09/10/2026) o Google respondeu "sobrecarregado" e a
// rodada terminou em segundos sem gerar nada. Esperar um pouco e repetir o mesmo edital
// aproveita a janela da rodada; cota esgotada (429) continua encerrando de imediato.
async function gerarComEspera(numero, { apiKey, prazoFinal, gerar = gerarDossie, esperar = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  for (let espera = 0; ; espera += 1) {
    try {
      return await gerar(numero, { apiKey });
    } catch (erro) {
      const cabeEspera = Date.now() + ESPERA_SOBRECARGA_MS < prazoFinal;
      if (!(erro instanceof GeminiSobrecarregado) || espera >= ESPERAS_SOBRECARGA || !cabeEspera) throw erro;
      console.log(`[dossiês] Gemini sobrecarregado; nova tentativa em ${ESPERA_SOBRECARGA_MS / 1000} s.`);
      await esperar(ESPERA_SOBRECARGA_MS);
    }
  }
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log("[dossiês] GEMINI_API_KEY não configurada (Settings > Secrets and variables > Actions); nada a fazer.");
    return;
  }
  const inicio = Date.now();
  const restanteDia = MAX_DIA - await tentativasHoje();
  const dados = await carregarCandidatos();
  const candidatos = selecionarCandidatos({ ...dados, limite: Math.min(MAX_POR_EXECUCAO, restanteDia) });
  console.log(`[dossiês] ${dados.fila.length} pedido(s) na fila, ${dados.boletim.length} edital(is) de boletim recentes; ${candidatos.length} a gerar (teto do dia: ${Math.max(0, restanteDia)} restante(s)).`);
  const contagem = { gerado: 0, sem_documento: 0, falha: 0 };
  for (const candidato of candidatos) {
    if (Date.now() - inicio > LIMITE_MS) break;
    const anteriores = dados.tentativas.get(candidato.numero) || 0;
    try {
      const resultado = await gerarComEspera(candidato.numero, { apiKey, prazoFinal: inicio + LIMITE_MS });
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
      console.log(`[dossiês] gerado ${resultado.completo ? "completo" : "parcial"} (${resultado.modelo}, ${resultado.uso?.totalTokenCount || "?"} tokens): ${candidato.numero}`);
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

module.exports = { VERSAO_DOSSIE, ajustarAoSchema, schemaParaGemini, corpoGemini, chamarGemini, montarResultado, selecionarCandidatos, dossieCompleto, gerarComEspera, CotaEsgotada, GeminiSobrecarregado };
