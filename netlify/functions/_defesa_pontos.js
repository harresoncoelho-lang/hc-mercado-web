const normalizar = valor => String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const { escopoDaReferencia } = require('./_referencias_documentais');
const referenciaProduto = /\bmarca\s+|\bmodelos? (?:comercial|comerciais|de (?:produtos?|bens|equipamentos?)|do produto|dos produtos)|\bmodelo\s+[a-z0-9-]+\s+(?:comercial|do produto)/;
const ambitoIN67Comprovado = texto => /(?:orgao|entidade) contratante (?:integra|pertence a) (?:a )?administracao publica federal (?:direta|autarquica|fundacional)|(?:esta|presente) contratacao (?:utiliza|executa|e custeada com) recursos (?:da uniao decorrentes de transferencias voluntarias|de transferencias voluntarias da uniao)/.test(normalizar(texto));
const tipos = {
  especificar_documentos: {
    assunto: /document|habilita|qualifica|matriz|filial|comprov/,
    fonte: /document|habilita|qualifica/,
    titulo: 'documentos e condições de apresentação',
    antecedente: 'Menção literal a documentos, habilitação ou qualificação, no assunto solicitado.',
    pedido: 'Especificar quais documentos serão solicitados e sob quais condições, sem presumir exigência imediata ou dispensa automática',
    limite: 'A seleção não define documentos obrigatórios; sujeitos, etapas e condições precisam ser conferidos no texto integral.',
  },
  confirmar_fase: {
    assunto: /fase|etapa|momento|vencedor|classificad|julgamento|antecipad|quando.{0,60}(?:apresent|habilita)/,
    fonte: /\bfases?\b|\bvencedor[aes]*\b|\bclassificad[ao]s?\b/,
    temaFonte: /habilita|vencedor|classificad|propost|lance|julgamento/,
    titulo: 'sequência e sujeitos das fases',
    antecedente: 'Fase procedimental, vencedora ou classificação mencionada no texto; fase de execução física não comprova fase da licitação.',
    pedido: 'Confirmar a sequência completa e o evento de apresentação, preservando quem está sujeito à regra e as condições transcritas',
    limite: 'Nenhuma fase foi antecipada ou suprimida pela análise; a sequência e eventual inversão dependem do procedimento e do texto integral.',
  },
  esclarecer_excecao: {
    assunto: /excecao|condic|dispensa|matriz|filial|condicion|se necess|alcance/,
    fonte: /\b(?:exceto|salvo|ressalvad[ao]s?|desde que|condicionad[ao]s?|caso|quando|somente|apenas)\b|\bse necess|\bpodera.{0,80}dispens/,
    temaFonte: /document|habilita|qualifica|matriz|filial/,
    vinculos: [/matriz|filial/],
    titulo: 'alcance da condição ou exceção',
    antecedente: 'Condição ou exceção documental expressa, no domínio solicitado; questão de matriz/filial exige esse vínculo na fonte.',
    pedido: 'Esclarecer como a condição ou exceção expressa se aplica ao caso e qual comprovação será aceita, sem antecipar documentos ou meios de prova não estabelecidos na fonte',
    limite: 'A condição ou exceção permanece nos termos literais transcritos; não foi substituída por regra de prática habitual nem teve seu alcance ampliado.',
  },
  especificar_cronograma: {
    assunto: /prazo|cronograma|entrega|parcelad|fornecimento|pagamento|assinatura|vigencia|marco|contagem|quando/,
    fonte: /\b(?:dias?|horas?|meses?|mes|anos?|minutos?|semanas?)\b/,
    evento: /assin|entrega|fornec|execu|pagamento|vigencia|convoc|recebimento|recebid|habilit|propost|lance|abertura|divulgacao/,
    vinculos: [/assinatura|convoc/, /entrega|fornecimento|recebimento|recebid/, /pagamento|nota fiscal/, /vigencia|execucao/],
    titulo: 'eventos, marcos e unidades do cronograma',
    antecedente: 'Unidade de tempo e evento contratual literalmente mencionados, relativos ao evento solicitado; não trocar entrega por pagamento ou assinatura.',
    pedido: 'Esclarecer a aplicação dos eventos, marcos e unidades de prazo transcritos ao cronograma do caso, sem equiparar prazos de eventos diferentes',
    limite: 'Prazos contratuais não foram convertidos em prazo de manifestação. Trechos sobre eventos ou organização da contratação não comprovam, por si só, conflito ou identidade entre cronogramas.',
  },
  esclarecer_recolhimento_multa: {
    assunto: /\bmultas?\b/,
    eventoAssunto: /recolh/,
    fonte: /\bmultas?\b/,
    evento: /\brecolh(?:id[ao]s?|imento|er)\b/,
    temaFonte: /(?:\d+|\b(?:um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|quinze|vinte|trinta|sessenta))[^.;]{0,40}\b(?:dias?|horas?|meses?|semanas?)\b/,
    marcoFonte: /\b(?:a contar|contad[oa]s?|apos|desde)\b.{0,100}\b(?:comunicacao|notificacao|ciencia|recebimento)\b/,
    titulo: 'prazos e marcos de recolhimento de multas',
    antecedente: 'Multa, recolhimento, prazo quantificado e marco de comunicação ou ciência literalmente expressos na mesma fonte.',
    pedido: 'Esclarecer o alcance de cada regra de recolhimento de multa, preservando as unidades de tempo, os marcos de contagem e as condições de recolhimento administrativo transcritos',
    limite: 'A seleção não afirma conflito ou ilegalidade, não equipara dias úteis e corridos nem comunicação e recebimento. Prazo de recolhimento de multa não foi convertido em prazo de recurso, esclarecimento ou impugnação.',
  },
  esclarecer_fornecimento: {
    assunto: /entrega|fornecimento|requisic|pedidos/,
    fonte: /requisic|ordem de fornecimento|nota de empenho|conforme.{0,40}solicit/,
    temaFonte: /entrega|fornec|produt|material|aquisic/,
    excluirFonte: /recurso|intimacao|sanc|penalidade|multa|afastamento do certame|suspensao do direito de licitar/,
    titulo: 'requisições e execução do fornecimento',
    antecedente: 'Requisição, ordem de fornecimento ou nota de empenho vinculada literalmente ao fornecimento solicitado.',
    pedido: 'Esclarecer a emissão e comunicação das requisições e a execução de cada fornecimento, preservando as condições integrais da fonte',
    limite: 'Requisições de entrega não se confundem com divisão do objeto em lotes; não foi presumido conflito entre documentos.',
  },
  esclarecer_organizacao_objeto: {
    assunto: /parcelamento.{0,30}(?:objeto|lotes)|divisao.{0,30}(?:objeto|lotes)|\blotes?\b|\bmarcas?\b|\bmodelos?\b/,
    fonte: new RegExp(`\\blotes?\\b|divisao do objeto|parcelamento do objeto|${referenciaProduto.source}`),
    excluirFonte: /\bmodelos? (?:de|da|do) (?:declaracao|proposta|documento|formulario|minuta|contrato)\b/,
    vinculos: [/\blotes?\b|divisao do objeto|parcelamento do objeto/, /\bmarcas?\b|\bmodelos?\b/],
    titulo: 'organização do objeto e referências de produto',
    antecedente: 'Lotes ou divisão do objeto, ou marca/modelo de produto expressamente indicado; entrega parcelada, marcação e modelo de documento não bastam.',
    pedido: 'Esclarecer o alcance e a justificativa da organização do objeto ou da referência de produto indicada no trecho, conferindo as condições e alternativas admitidas',
    limite: 'Divisão do objeto em lotes e entregas parceladas são questões distintas. Marca ou modelo não demonstra restrição indevida por si só; justificativas, alternativas e características do objeto exigem conferência.',
  },
  esclarecer_criterio_proposta: {
    assunto: /exequibil|inexequiv|desclassific|aceitabilidade|especificac.{0,30}propost|criterio.{0,30}propost/,
    fonte: /exequibil|inexequiv|desclassific|aceitabilidade|especificac.{0,60}propost|propost.{0,60}especificac/,
    temaFonte: /propost|preco|orcamento|julgamento/,
    titulo: 'critérios de avaliação da proposta',
    antecedente: 'Critério de especificação, aceitabilidade, desclassificação ou exequibilidade da proposta expresso na fonte; mera menção a proposta não basta.',
    pedido: 'Esclarecer o critério transcrito de avaliação da proposta e o procedimento de verificação aplicável ao objeto, inclusive eventual demonstração ou diligência prevista',
    limite: 'A seleção não desclassifica proposta nem presume inexequibilidade. Não foram transportados percentuais de engenharia para bens ou serviços em geral; natureza do objeto, critério e procedimento precisam de revisão.',
  },
  analisar_resposta_incompleta: {
    titulo: 'comparação da resposta declarada com os pontos documentais',
    antecedente: 'R1 e fonte canônica também citada em ponto temático; comparação não afirma incompletude automática.',
    pedido: 'Confirmar como a resposta declarada contempla os pontos documentais selecionados e quais informações adicionais precisam ser prestadas, se houver',
    limite: 'A resposta é uma declaração não autenticada. Sua comparação não demonstra, por si só, atendimento integral, omissão ou posição oficial do órgão.',
  },
};
const posterior = body => Boolean(body.fase && body.fase !== 'questionamento');
function referenciasSolicitadas(body) {
  const texto = normalizar(`${body.questionamento} ${body.objetivo || ''}`);
  const numeros = [];
  for (const referencia of texto.matchAll(/\b(?:(?:sub)?it(?:em|ens)|clausulas?)\s*(\d+(?:\.\d+)*(?:\s*(?:,|e|ou)\s*\d+(?:\.\d+)*)*)/g)) {
    if (/^\s*(?:da|do)\s+(?:lei|decreto|artigo|norma)\b/.test(texto.slice(referencia.index + referencia[0].length))) continue;
    for (const numero of referencia[1].matchAll(/\d+(?:\.\d+)*/g)) {
      const fim = referencia.index + referencia[0].indexOf(referencia[1]) + numero.index + numero[0].length;
      if (texto[fim] !== '/') numeros.push({ numero: numero[0], escopoDocumento: escopoDaReferencia(texto, referencia.index, referencia.index + referencia[0].length) });
    }
  }
  return numeros;
}
function clausulasSolicitadas(body) {
  return [...new Set(referenciasSolicitadas(body).map(r => r.numero))];
}
function ancorasSolicitadas(ctx, body) {
  const referencias = referenciasSolicitadas(body);
  const origens = f => f.origens?.length ? f.origens.map(o => ({ ...o, escopoDocumento: o.escopoDocumento ?? f.escopoDocumento })) : [f];
  const catalogo = ctx.clausulasCanonicas || ctx.fontes.filter(f => !f.declarada).flatMap(origens);
  const identidade = f => JSON.stringify([f.documento, f.pagina || '', f.numero, f.escopoDocumento || '', normalizar(f.texto).replace(/\s+/g, ' ').trim()]);
  return clausulasSolicitadas(body).map(numero => {
    const escopos = new Set(referencias.filter(r => r.numero === numero).map(r => r.escopoDocumento));
    const escopo = [...escopos][0];
    const candidatos = catalogo.filter(f => f.numero === numero && (!escopo || f.escopoDocumento === escopo));
    const unicos = new Set(candidatos.map(identidade));
    const univoco = ctx.clausulasCanonicas ? candidatos.length === 1 : unicos.size === 1;
    // A seleção por orçamento nunca resolve uma ambiguidade existente na fonte integral.
    const fontesPermitidas = escopos.size === 1 && univoco ? ctx.fontes.filter(f => !f.declarada && origens(f).some(o => o.numero === numero && unicos.has(identidade(o)))).map(f => f.id) : [];
    return { numero, fontesPermitidas };
  });
}
const fontesCanonicas = (fontes, tipo, body) => {
  const regra = tipos[tipo];
  const assunto = normalizar(`${body.questionamento} ${body.objetivo || ''}`);
  const pergunta = normalizar(body.questionamento);
  const vinculosPergunta = regra?.vinculos?.filter(v => v.test(pergunta)) || [];
  const vinculos = vinculosPergunta.length ? vinculosPergunta : regra?.vinculos?.filter(v => v.test(assunto)) || [];
  const temaFinanceiro = /pagamento|liquidac|preco|reajust|reequilibr|financeir|fatur/.test(pergunta);
  const financeiraAdjacente = fonte => {
    const texto = normalizar(fonte.texto);
    const financeira = /pagamento|liquidac|reajust|reequilibr|precos?.{0,40}(?:fix|vari|revis)/.test(texto);
    const entregaOperativa = /\b(?:deverao|devera|serao|sera|devem|deve)(?: ser)? (?:entregues?|fornecid[oa]s?|entregar|fornecer)\b|\b(?:entregar|fornecer|entregara|fornecera)\b|\bprazo(?: maximo)? (?:para|de) (?:entrega|fornecimento)/.test(texto);
    return /entrega|fornecimento|requisic/.test(pergunta) && (!temaFinanceiro || tipo === 'esclarecer_fornecimento') && financeira && !entregaOperativa;
  };
  const solicitadas = clausulasSolicitadas(body);
  return fontes.filter(f => !f.declarada && regra?.fonte?.test(normalizar(f.texto)) &&
    (!regra.excluirFonte || !regra.excluirFonte.test(normalizar(f.texto))) &&
    (!['esclarecer_fornecimento', 'especificar_cronograma'].includes(tipo) || !financeiraAdjacente(f)) &&
    !(tipo === 'especificar_cronograma' && /entrega|fornecimento|requisic/.test(assunto) && /recurso|intimacao|sanc|penalidade|multa|afastamento do certame|suspensao do direito de licitar/.test(normalizar(f.texto))) &&
    !(tipo === 'especificar_cronograma' && /\bmultas?\b/.test(assunto) && /recolh/.test(assunto) && /\bmultas?\b/.test(normalizar(f.texto))) &&
    !(tipo === 'esclarecer_organizacao_objeto' && !regra.assunto.test(normalizar(body.questionamento))) &&
    (!regra.evento || regra.evento.test(normalizar(f.texto))) &&
    (!regra.eventoAssunto || (regra.eventoAssunto.test(assunto) && regra.assunto.test(assunto))) &&
    (!regra.marcoFonte || regra.marcoFonte.test(normalizar(f.texto))) &&
    (!regra.temaFonte || regra.temaFonte.test(normalizar(f.texto))) &&
    (!vinculos.length || vinculos.some(v => v.test(normalizar(f.texto)))) &&
    (regra.assunto.test(assunto) || solicitadas.some(n => f.numero === n || f.origens?.some(o => o.numero === n))));
};
function pontosDisponiveis(ctx, body) {
  const disponiveis = Object.keys(tipos).filter(tipo => tipo !== 'analisar_resposta_incompleta').map(tipo => ({ tipo, assunto: tipos[tipo].titulo, antecedente: tipos[tipo].antecedente, fontesPermitidas: fontesCanonicas(ctx.fontes, tipo, body).map(f => f.id) })).filter(p => p.fontesPermitidas.length);
  if (disponiveis.length && posterior(body) && ctx.fontes.some(f => f.id === 'R1' && f.declarada)) disponiveis.push({ tipo: 'analisar_resposta_incompleta', assunto: tipos.analisar_resposta_incompleta.titulo, antecedente: tipos.analisar_resposta_incompleta.antecedente,
    fontesPermitidas: ['R1', ...new Set(disponiveis.flatMap(p => p.fontesPermitidas)), ...ctx.fontes.filter(f => f.id === 'M1' && f.declarada).map(f => f.id)] });
  return disponiveis.map(p => ({ ...p, fundamentosPermitidos: ctx.normas.map(n => ({ id: n.id,
    fontesDeApoio: p.fontesPermitidas.filter(id => fundamentoApoiado(n.id, [{ tipo: p.tipo, fontes: [id] }], ctx)),
  })).filter(n => n.fontesDeApoio.length) }));
}
const tiposDisponiveis = (ctx, body) => pontosDisponiveis(ctx, body).map(p => p.tipo);
function validarPontos(pontos, fatos, ctx, body, totalAncoras = 0) {
  if (!Array.isArray(pontos) || !pontos.length || pontos.length > 6) return 'pontos_invalidos';
  const usados = new Set();
  const repetidos = new Map();
  const disponiveis = pontosDisponiveis(ctx, body);
  for (const [indice, ponto] of pontos.entries()) {
    if (!ponto || typeof ponto !== 'object' || Object.keys(ponto).length !== 3 || !['tipo', 'fontes', 'fundamentos'].every(c => Object.hasOwn(ponto, c)) || !Object.hasOwn(tipos, ponto.tipo) ||
      !Array.isArray(ponto.fontes) || !ponto.fontes.length || ponto.fontes.length > 4 || new Set(ponto.fontes).size !== ponto.fontes.length ||
      !Array.isArray(ponto.fundamentos) || ponto.fundamentos.length > 4 || new Set(ponto.fundamentos).size !== ponto.fundamentos.length ||
      !ponto.fontes.every(id => typeof id === 'string' && fatos.includes(id))) return 'ponto_invalido';
    const fontes = ponto.fontes.map(id => ctx.fontes.find(f => f.id === id));
    const permitidas = disponiveis.find(p => p.tipo === ponto.tipo)?.fontesPermitidas || [];
    if (!ponto.fontes.every(id => permitidas.includes(id))) return 'ponto_sem_antecedente';
    if (ponto.tipo === 'analisar_resposta_incompleta') {
      if (!posterior(body) || !fontes.some(f => f.id === 'R1' && f.declarada) || !fontes.some(f => !f.declarada)) return 'ponto_sem_antecedente';
    }
    const chave = `${ponto.tipo}:${[...ponto.fontes].sort().join(',')}`;
    if (repetidos.has(chave) && !(indice < totalAncoras && repetidos.get(chave) < totalAncoras)) return 'ponto_invalido';
    repetidos.set(chave, indice);
    ponto.fontes.forEach(id => usados.add(id));
  }
  if (posterior(body)) {
    const comparacao = pontos.find(p => p.tipo === 'analisar_resposta_incompleta');
    if (!comparacao || !pontos.some(p => p.tipo !== 'analisar_resposta_incompleta' && p.fontes.some(id => comparacao.fontes.includes(id)))) return 'resposta_orgao_nao_analisada';
  }
  if (fatos.some(id => !usados.has(id))) return 'fato_sem_ponto';
  return null;
}
function fundamentoApoiado(id, pontos, ctx) {
  if (ctx.regimeConfirmado === false) return false;
  if (id === 'lei14133-art164' && pontos.some(p => p.tipo === 'esclarecer_recolhimento_multa') && ctx.regimeConfirmado !== true) return false;
  if (!pontos.some(p => p.tipo !== 'analisar_resposta_incompleta' && p.fontes.some(idFonte => ctx.fontes.some(f => f.id === idFonte && !f.declarada)))) return false;
  const fontesDos = tipo => pontos.filter(p => p.tipo === tipo).flatMap(p => p.fontes.map(idFonte => ctx.fontes.find(f => f.id === idFonte))).filter(f => !f.declarada);
  const fonteTema = (tipo, padrao) => fontesDos(tipo).some(f => padrao.test(normalizar(f.texto)));
  const licitacao = ctx.regimeConfirmado === true && ctx.dispensa === false;
  if (id === 'lei14133-art62') return licitacao && fonteTema('especificar_documentos', /habilita|qualifica/);
  if (id === 'lei14133-art68') return licitacao && fonteTema('especificar_documentos', /regularidade|fiscal|trabalhista|fgts|seguridade/);
  if (id === 'lei14133-art92-V-VII') return ctx.regimeConfirmado === true && fonteTema('especificar_cronograma', /pagamento|liquidacao|entrega|recebimento|execucao/);
  if (id === 'lei14133-art140-II') return ctx.regimeConfirmado === true && ctx.objetoCompras === true && fonteTema('especificar_cronograma', /recebid|recebimento/);
  if (id === 'lei14133-art40-parcelamento') return ctx.regimeConfirmado === true && ctx.objetoCompras === true && fonteTema('esclarecer_organizacao_objeto', /\blotes?\b|divisao do objeto|parcelamento do objeto/);
  if (id === 'lei14133-art41-I') return licitacao && ctx.objetoCompras === true && fonteTema('esclarecer_organizacao_objeto', referenciaProduto);
  if (id === 'lei14133-art59-II-IV') return licitacao && fonteTema('esclarecer_criterio_proposta', /exequibil|inexequiv|desclassific|aceitabilidade|especificac/);
  if (id === 'lei14133-art63-II-III') return ctx.dispensa === false && fontesDos('confirmar_fase').length > 0;
  if (id === 'lei14133-art69') return fontesDos('especificar_documentos').some(f => /econom|financeir|balanco|indice|contabil|demonstrac/.test(normalizar(f.texto)));
  if (id === 'lei14133-art67') return fontesDos('especificar_documentos').some(f => /tecnic|atestado|experiencia|conselho profissional/.test(normalizar(f.texto)));
  if (id === 'lei14133-art70-III') return [...fontesDos('especificar_documentos'), ...fontesDos('esclarecer_excecao')].some(f => /document.*dispens(?:ad[ao]s?|ar)|dispens(?:ad[ao]s?|ar).*document|dispensa (?:de )?document|entrega imediata|pesquisa.{0,30}desenvolvimento/.test(normalizar(f.texto)));
  return (id === 'lei14133-art164' && ctx.dispensa === false) ||
    (id === 'in67-2021-escopo-abertura' && ctx.dispensa === true && ctx.ambitoIN67 === true && fontesDos('especificar_cronograma').some(f => ambitoIN67Comprovado(f.texto) && /abertura|lances|divulgacao do aviso/.test(normalizar(f.texto))));
}
function redigirPontos(pontos, ctx, body) {
  const localizado = ponto => ponto.fontes.flatMap(id => {
    const f = ctx.fontes.find(s => s.id === id);
    return (f.origens || [f]).map(e => `${e.documento}${e.pagina ? `, página ${e.pagina}` : ''}${e.numero ? `, item ${e.numero}` : ''}`);
  }).join('; ');
  const pedidos = pontos.map(p => `${tipos[p.tipo].pedido}. Referências para conferência: ${localizado(p)}.`);
  return {
    diagnostico: `Foram selecionados pontos documentais para esclarecimento, sem conclusão jurídica ou alteração das condições das fontes: ${pontos.map(p => `${tipos[p.tipo].titulo} (${localizado(p)})`).join('; ')}.`,
    argumentoContrario: [...new Set(pontos.map(p => tipos[p.tipo].limite))].join(' '),
    pedido: `${body.tipo === 'impugnacao' ? 'Não foi formulado pedido de impugnação: a seleção documental e os fundamentos recuperados não comprovam, por si só, motivo para essa providência. Antes de avaliar cabimento, devem ser esclarecidos os pontos abaixo.\n' : ''}${pedidos.join('\n')}`,
    pendencias: ['Conferir os pontos selecionados com a questão apresentada e com todas as condições dos trechos integrais antes de utilizar qualquer texto.'],
  };
}
module.exports = { tipos, tiposDisponiveis, pontosDisponiveis, clausulasSolicitadas, ancorasSolicitadas, validarPontos, fundamentoApoiado, redigirPontos, ambitoIN67Comprovado };
