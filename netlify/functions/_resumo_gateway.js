/* global AbortSignal */
const { createHash } = require("node:crypto");
const { Tiktoken } = require("js-tiktoken/lite");
const ranks = require("js-tiktoken/ranks/o200k_base");
const contrato = require("./_resumo_gateway_contrato");
const VERSAO = 17;
const DURACAO_JOB = 8 * 60 * 1000;
const ERRO_PUBLICO = "Não foi possível concluir o resumo. Nenhum checklist foi apresentado como concluído.";
let tokenizador;

function requisicaoGateway(fonte, ficha) {
  return { model: "gpt-5.1", reasoning: { effort: "medium" }, max_output_tokens: 12000,
    input: [{ role: "developer", content: contrato.prompt }, { role: "user", content: `DADOS OFICIAIS: ${JSON.stringify(ficha)}\nFONTE OFICIAL INTEGRAL:\n${fonte}` }],
    text: { format: { type: "json_schema", name: "resumo_edital", strict: true, schema: contrato.schema } } };
}

function tokensRequisicao(requisicao) {
  tokenizador ||= new Tiktoken(ranks);
  return tokenizador.encode(JSON.stringify(requisicao), [], []).length + 256;
}

function estruturaValida(valor, schema = contrato.schema) {
  if (schema.type === "string") return typeof valor === "string" && (!schema.enum || schema.enum.includes(valor));
  if (schema.type === "array") return Array.isArray(valor) && valor.every((item) => estruturaValida(item, schema.items));
  return Boolean(valor && typeof valor === "object" && !Array.isArray(valor) &&
    Object.keys(valor).every((chave) => Object.hasOwn(schema.properties, chave)) &&
    schema.required.every((chave) => Object.hasOwn(valor, chave) && estruturaValida(valor[chave], schema.properties[chave])));
}

function respostaJob(estado, agora = Date.now()) {
  if (estado.status === "concluido") return { statusCode: 200, body: estado.resultado };
  if (estado.status === "falhou" || estado.criadoEm + DURACAO_JOB < agora) return { statusCode: 503, body: { erro: ERRO_PUBLICO, estrutura: null, fonteLida: true, metodoResumo: "sintese_falhou", emProcessamento: false } };
  return { statusCode: 202, body: { emProcessamento: true, progresso: { concluidas: 0, total: 1, aguardarSegundos: 5 }, resposta: "Analisando o edital e seus anexos. O resumo será exibido quando estiver completo.", estrutura: null, fonteLida: true, metodoResumo: "sintese_em_andamento", erro: null } };
}

function urlBackground() {
  // URL é injetada pelo Netlify; nunca usa Host, Origin ou corpo do navegador.
  const url = new URL(process.env.URL || "https://licitaplena.com.br");
  if (url.protocol !== "https:" || !["licitaplena.com.br", "www.licitaplena.com.br", "hc-mercado-web.netlify.app"].includes(url.hostname)) throw new Error("Destino interno indisponível");
  return new URL("/.netlify/functions/ia-resumo-background", url).href;
}

async function solicitarResumo({ store, fonte, ficha, cobertura, usuario, autorizar, authorization, retomar = false, agora = Date.now(), disparar }) {
  const hashFonte = createHash("sha256").update(fonte).digest("hex");
  const chave = `gateway:v${VERSAO}:${ficha.numeroControlePNCP}:${hashFonte}`;
  let registro = await store.getWithMetadata(chave, { type: "json", consistency: "strong" });
  if (registro) {
    const estado = registro.data;
    const interrompido = estado.status !== "concluido" && (estado.status === "falhou" || estado.criadoEm + DURACAO_JOB < agora);
    if (interrompido && estado.expiraEm > agora && !(retomar === true && estado.usuario === usuario)) return respostaJob(estado, agora);
    if (!interrompido && estado.expiraEm > agora) return respostaJob(estado, agora);
  }
  const requisicao = requisicaoGateway(fonte, ficha);
  if (tokensRequisicao(requisicao) > 200000) return { statusCode: 422, body: { erro: "Os documentos ultrapassam o limite de leitura integral. A geração não foi iniciada.", estrutura: null } };
  const estado = { status: "autorizando", hashFonte, usuario, fonte, ficha, cobertura, criadoEm: agora, expiraEm: agora + 86400000, tentativas: 0 };
  let reserva = await store.setJSON(chave, estado, registro ? { onlyIfMatch: registro.etag } : { onlyIfNew: true });
  if (!reserva.modified) {
    registro = await store.getWithMetadata(chave, { type: "json", consistency: "strong" });
    return respostaJob(registro.data, agora);
  }
  const limite = await autorizar();
  if (!limite.ok) {
    await store.setJSON(chave, { ...estado, status: "falhou", expiraEm: agora, erroPrivado: { etapa: "cota" } }, { onlyIfMatch: reserva.etag });
    return { statusCode: limite.status || 429, body: { erro: limite.erro || "Limite diário atingido.", estrutura: null } };
  }
  estado.status = "pendente";
  estado.cotaAutorizada = true;
  reserva = await store.setJSON(chave, estado, { onlyIfMatch: reserva.etag });
  if (!reserva.modified) throw new Error("Reserva indisponível");
  try {
    const resposta = await (disparar || fetch)(urlBackground(), { method: "POST", headers: { "Content-Type": "application/json", Authorization: authorization }, body: JSON.stringify({ chave }), signal: AbortSignal.timeout(10000) });
    if (resposta.status !== 202) throw new Error("Disparo não confirmado");
  } catch (_) {
    // CAS não sobrescreve um worker que já começou apesar de timeout no despacho.
    await store.setJSON(chave, { ...estado, status: "falhou", erroPrivado: { etapa: "despacho" } }, { onlyIfMatch: reserva.etag });
    const atual = await store.getWithMetadata(chave, { type: "json", consistency: "strong" });
    return respostaJob(atual.data, agora);
  }
  return respostaJob(estado, agora);
}

async function executarResumo({ store, chave, usuario, cliente, agora = Date.now() }) {
  if (!/^gateway:v17:\d{14}-1-\d{6}\/\d{4}:[a-f0-9]{64}$/.test(chave || "")) return;
  const registro = await store.getWithMetadata(chave, { type: "json", consistency: "strong" });
  const estado = registro?.data;
  if (!estado || estado.usuario !== usuario || !estado.cotaAutorizada || estado.status !== "pendente" || estado.criadoEm + DURACAO_JOB < agora) return;
  estado.status = "processando";
  const reserva = await store.setJSON(chave, estado, { onlyIfMatch: registro.etag });
  if (!reserva.modified) return;
  try {
    const requisicao = requisicaoGateway(estado.fonte, estado.ficha);
    if (tokensRequisicao(requisicao) > 200000) throw new Error("limite_contexto");
    const sdk = cliente || new (require("openai"))({ timeout: 180000, maxRetries: 0 });
    let resposta;
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      estado.tentativas++;
      try { resposta = await sdk.responses.create(requisicao); break; }
      catch (erro) {
        if (tentativa || ![429, 500, 502, 503, 504].includes(erro.status)) throw erro;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    if (resposta.status !== "completed") throw new Error("resposta_incompleta");
    const saida = JSON.parse(resposta.output_text);
    if (!estruturaValida(saida)) throw new Error("schema_invalido");
    saida.estrutura.coberturaLeitura = estado.cobertura;
    saida.estrutura.documentosConsultados = estado.cobertura?.documentosLidos || [];
    const resultado = { estrutura: saida.estrutura, resposta: saida.estrutura.resumoGeral, textoEdital: estado.fonte, fonteLida: true, modoDegradado: false, metodoResumo: "sintese_gateway", versao: VERSAO, versaoValidacao: VERSAO, geradoEm: new Date().toISOString(), expiraEm: new Date(Date.now() + 86400000).toISOString(), erro: null };
    estado.status = "concluido";
    estado.resultado = resultado;
    estado.usoPrivado = resposta.usage;
    const entrada = resposta.usage?.input_tokens || 0;
    const cache = resposta.usage?.input_tokens_details?.cached_tokens || 0;
    const saidaTokens = resposta.usage?.output_tokens || 0;
    estado.custoEstimadoCreditos = ((entrada - cache) * 1.25 + cache * 0.125 + saidaTokens * 10) / 1000000 * 180;
    const conclusao = await store.setJSON(chave, estado, { onlyIfMatch: reserva.etag });
    if (conclusao.modified) await store.setJSON(estado.ficha.numeroControlePNCP, resultado);
  } catch (erro) {
    estado.status = "falhou";
    estado.erroPrivado = { status: Number.isInteger(erro.status) ? erro.status : null, tipo: ["schema_invalido", "resposta_incompleta", "limite_contexto"].includes(erro.message) ? erro.message : "falha_provedor" };
    await store.setJSON(chave, estado, { onlyIfMatch: reserva.etag });
  }
}

module.exports = { solicitarResumo, executarResumo, respostaJob, requisicaoGateway, tokensRequisicao, estruturaValida, urlBackground };
