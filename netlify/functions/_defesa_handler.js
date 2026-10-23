const { prepararContexto, mensagensDefesa, schemaDefesa, validarAnalise, fonteDocumentalVerificada, coberturaLeituraBloqueada } = require('./_defesa_contexto');
const { Tiktoken } = require('js-tiktoken/lite');
const ranks = require('js-tiktoken/ranks/o200k_base');
let codificador;
const { ancorasSolicitadas } = require('./_defesa_pontos');
const { prepararTransporte, traduzirTransporte } = require('./_defesa_transporte');

function codificacaoDentroDoLimite(texto) {
  // O BPE em JS tem custo superlinear por fragmento; a guarda não altera texto nem estima tokens.
  for (const fragmento of texto.matchAll(new RegExp(ranks.pat_str, 'ug'))) {
    if (Buffer.byteLength(fragmento[0], 'utf8') > 256) return false;
  }
  return true;
}

function ajustarOrcamento(ctx, body, modelo) {
  const medir = fontes => {
    const mensagens = mensagensDefesa({ ...ctx, fontes }, body);
    const schema = schemaDefesa({ ...ctx, fontes }, body);
    const transporte = prepararTransporte(mensagens, schema);
    const requisicao = JSON.stringify({ model: modelo, max_tokens: 2500, messages: transporte.mensagens, response_format: { type: 'json_schema', json_schema: { name: 'etapa_operacional', strict: true, schema: transporte.schema } }, reasoning_effort: 'low' });
    const bytes = Buffer.byteLength(requisicao, 'utf8');
    const tokens = bytes > 48000 || !codificacaoDentroDoLimite(requisicao) ? Infinity : (codificador ||= new Tiktoken(ranks)).encode(requisicao).length + 256 + 2500;
    return { mensagens: transporte.mensagens, schema, schemaTransporte: transporte.schema, bytes, tokens, cabe: bytes <= 48000 && tokens <= 7200 };
  };
  const conferirMedida = medida => medida.cabe && medida.schema.properties.pontos.items.anyOf.length &&
    Object.values(medida.schema.properties.ancoras?.properties || {}).every(a => a.anyOf.length) &&
    (!medida.schema.properties.resposta || medida.schema.properties.resposta.anyOf.length) ? medida : null;
  const ancoras = ancorasSolicitadas(ctx, body);
  if (ancoras.length) {
    if (ancoras.some(a => !a.fontesPermitidas.length)) return null;
    // O schema ancorado só permite estas fontes; não tokenizamos fatos que nunca poderiam ser selecionados.
    const permitidas = new Set([...ancoras.flatMap(a => a.fontesPermitidas), 'R1', 'M1']);
    const removidas = ctx.fontes.filter(f => !permitidas.has(f.id));
    ctx.fontes = ctx.fontes.filter(f => permitidas.has(f.id));
    if (removidas.length) {
      ctx.cobertura.parcial = true;
      ctx.cobertura.contextoParcial = true;
      ctx.cobertura.fontesOmitidas = [...(ctx.cobertura.fontesOmitidas || []), ...removidas.map(f => ({ documento: f.documento, pagina: f.pagina || '', numero: f.numero || '', escopoDocumento: f.escopoDocumento }))];
      if (removidas.some(f => f.declarada)) ctx.cobertura.declaracoesParciais = true;
      if (!ctx.pendencias.includes('Contexto selecionado por relevância e orçamento; confira também as cláusulas e páginas omitidas.')) ctx.pendencias.push('Contexto selecionado por relevância e orçamento; confira também as cláusulas e páginas omitidas.');
    }
    // Nenhuma âncora é podada para caber: uma única medição exata decide entre aceitar e abster.
    return conferirMedida(medir(ctx.fontes));
  }
  const canonicas = ctx.fontes.filter(f => !f.declarada);
  if (!canonicas.length || !medir([canonicas[0], ...ctx.fontes.filter(f => f.id === 'R1')]).cabe) return null;
  const omitidas = [...(ctx.cobertura.fontesOmitidas || [])];
  let medida = medir(ctx.fontes);
  while (!medida.cabe) {
    const removivel = ctx.fontes.findLastIndex(f => f.id !== 'R1' && (f.declarada || ctx.fontes.filter(p => !p.declarada).length > 1));
    if (removivel < 0) return null;
    const [fonte] = ctx.fontes.splice(removivel, 1);
    omitidas.push({ documento: fonte.documento, pagina: fonte.pagina || '', numero: fonte.numero || '' });
    ctx.cobertura.parcial = true;
    ctx.cobertura.contextoParcial = true;
    ctx.cobertura.fontesOmitidas = omitidas;
    if (fonte.declarada) ctx.cobertura.declaracoesParciais = true;
    if (!ctx.pendencias.includes('Contexto selecionado por relevância e orçamento; confira também as cláusulas e páginas omitidas.')) ctx.pendencias.push('Contexto selecionado por relevância e orçamento; confira também as cláusulas e páginas omitidas.');
    medida = medir(ctx.fontes);
  }
  return conferirMedida(medida);
}

async function executarDefesa(body, { sessao, robo, env = process.env, carregar, autorizar, chamar, modelo = 'openai/gpt-oss-20b' }) {
  const erro = (statusCode, mensagem) => ({ statusCode, dados: { erro: mensagem } });
  if (robo) return erro(403, 'A Central de Defesa exige uma sessão de usuário.');
  if (!sessao?.ok || !sessao.userId) return erro(401, 'Faça login para analisar o questionamento.');
  if (!['esclarecimento', 'impugnacao'].includes(body.tipo) ||
      !/^\d{14}-1-\d{6}\/\d{4}$/.test(body.edital?.numeroControlePNCP || '') ||
      typeof body.hashFonte !== 'string' || !/^[a-f0-9]{64}$/.test(body.hashFonte) ||
      typeof body.questionamento !== 'string' || !body.questionamento.trim() || body.questionamento.length > 3000 ||
      (body.objetivo !== undefined && (typeof body.objetivo !== 'string' || body.objetivo.length > 3000)) ||
      !['questionamento', 'resposta_orgao', 'manifestacao'].includes(body.fase || 'questionamento') ||
      (body.respostaOrgao !== undefined && (typeof body.respostaOrgao !== 'string' || body.respostaOrgao.length > 12000)) ||
      (body.manifestacaoAnterior !== undefined && (typeof body.manifestacaoAnterior !== 'string' || body.manifestacaoAnterior.length > 6000)) ||
      (body.fase && body.fase !== 'questionamento' && !body.respostaOrgao?.trim())) return erro(400, 'Confira identificação, fonte, fase, questionamento e limites de texto.');
  if (env.DEFESA_IA_GRATUITA_CONFIRMADA !== 'true' || !env.GROQ_API_KEY) return erro(503, 'A análise inteligente está desabilitada até confirmar acesso gratuito ao provedor atual. O rascunho documental permanece disponível.');
  try {
    const dossie = await carregar(body.edital.numeroControlePNCP);
    if (coberturaLeituraBloqueada(dossie?.estrutura?.coberturaLeitura)) return erro(409, 'A leitura documental está parcial ou contém OCR ainda não revisado. Confira os documentos e conclua a revisão da fonte antes de analisar; nenhuma chamada de IA foi feita.');
    const documentalVerificado = fonteDocumentalVerificada(dossie);
    if (!dossie || dossie.versao !== 17 || dossie.fonteLida !== true || (dossie.modoDegradado && !documentalVerificado) || dossie.metadadosIndisponiveis || typeof dossie.textoEdital !== 'string' || !dossie.textoEdital.trim()) return erro(409, 'A fonte canônica do edital ainda não está disponível para esta análise.');
    const ctx = prepararContexto(dossie, body);
    if (ctx.hashFonte !== body.hashFonte) return erro(409, 'A fonte documental mudou. Reabra o resumo antes de analisar.');
    const ancoras = ancorasSolicitadas(ctx, body);
    const ausentes = ancoras.filter(a => !a.fontesPermitidas.length);
    if (ausentes.length) return erro(409, `As cláusulas solicitadas não estão disponíveis no contexto canônico: ${ausentes.map(a => a.numero).join(', ')}. Confira a numeração ou reabra os documentos; nenhuma chamada de IA foi feita.`);
    if (!ctx.fontes.some(f => !f.declarada)) return erro(409, 'Não foi possível localizar evidência documental verificável.');
    if (ancoras.length + Number(Boolean(body.fase && body.fase !== 'questionamento')) > 6) return erro(422, 'O questionamento excede o limite de pontos documentais. Divida as cláusulas solicitadas; nenhuma chamada de IA foi feita.');
    const orcamento = ajustarOrcamento(ctx, body, modelo);
    if (!orcamento) return erro(422, 'O texto não pode ser processado com segurança no formato atual. Reduza o questionamento ou a resposta e evite sequências muito longas sem separação. Nenhuma chamada de IA foi feita.');
    const cota = await autorizar(sessao.userId, 'ia-edital', 40);
    if (!cota?.ok) return erro(cota?.status === 429 ? 429 : 503, cota?.erro || 'Não foi possível confirmar a cota da IA. Tente depois.');
    const resposta = await chamar(env.GROQ_API_KEY, orcamento.mensagens, orcamento.schemaTransporte);
    if (!resposta?.ok) return erro(502, 'A IA não concluiu uma análise utilizável. Tente depois; nenhum documento foi enviado.');
    const analise = validarAnalise(traduzirTransporte(resposta.texto, orcamento.schema), ctx, body);
    if (!analise) return erro(502, 'A análise não passou na conferência das evidências e fundamentos. Revise os documentos ou tente depois.');
    const referencia = await require('./_defesa_modelos').selecionarReferenciaPrivada(body, ctx, sessao, env);
    if (referencia) analise.modeloReferencia = referencia;
    return { statusCode: 200, dados: { analise, hashFonte: ctx.hashFonte, versaoBase: ctx.versaoBase, cobertura: ctx.cobertura } };
  } catch (_) {
    return erro(503, 'Não foi possível concluir a análise agora. Tente novamente depois.');
  }
}

module.exports = { executarDefesa, ajustarOrcamento };
