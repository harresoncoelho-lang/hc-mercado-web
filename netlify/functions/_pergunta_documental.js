const { paginasDaFonte, clausulasDaFonte } = require('./_edital_operacional');
const normalizar = (v) => v.normalize('NFC').replace(/\s+/g, ' ').trim();

function prepararFontesPergunta(texto, pergunta, limite = 22000) {
  // shortcut: a seleção lexical por páginas pode omitir contexto; ampliar a recuperação quando perguntas reais exigirem outros trechos.
  const termos = pergunta.toLocaleLowerCase('pt-BR').match(/[\p{L}]{4,}/gu) || [];
  const paginas = texto.split(/(?=^--- .+ ---$)/m).filter((parte) => parte.trim()).flatMap((parte) => {
    const lidas = paginasDaFonte(parte);
    return lidas.length ? lidas : [{ documento: parte.match(/^--- (.+) ---$/m)?.[1] || 'Documento oficial', pagina: '', texto: parte.replace(/^--- .+ ---$/m, '') }];
  }).map((p, i) => ({ ...p, id: `F${i + 1}`, texto: normalizar(p.texto), ordem: i }));
  const candidatas = paginas.filter((p) => p.texto).map((p) => ({ ...p,
    pontos: termos.reduce((n, t) => n + Number(p.texto.toLocaleLowerCase('pt-BR').includes(t)), 0) }));
  let restante = limite;
  const fontes = [];
  for (const p of candidatas.sort((a, b) => b.pontos - a.pontos || a.ordem - b.ordem)) {
    if (restante < 200) break;
    const trecho = p.texto.slice(0, restante);
    fontes.push({ ...p, texto: trecho }); restante -= trecho.length;
  }
  fontes.sort((a, b) => a.ordem - b.ordem);
  return { fontes, selecaoParcial: fontes.reduce((n, p) => n + p.texto.length, 0) < paginas.reduce((n, p) => n + p.texto.length, 0) };
}

function responderPagamento(texto, pergunta) {
  if (!/pagamento|liquida[cç][aã]o/i.test(pergunta) || /banco|ag[eê]ncia|conta (?:banc[aá]ria|corrente)/i.test(pergunta)) return null;
  const clausulas = clausulasDaFonte(texto);
  const ancoras = clausulas.filter((c) => /pagamento ser[aá] efetuado|prazo de \d+(?:\s*\([^)]*\))? dias [uú]teis para (?:fins de )?liquida[cç][aã]o/i.test(c.texto));
  if (!ancoras.length) return null;
  // Inclui o capítulo inteiro para conservar condições e exceções junto dos prazos.
  const grupos = new Set(ancoras.map((c) => JSON.stringify([c.documento, c.numero.split('.')[0]])));
  const trechos = clausulas.filter((c) => grupos.has(JSON.stringify([c.documento, c.numero.split('.')[0]])));
  return 'Trechos das regras de pagamento, separados por fonte. Confira com o órgão o alcance de cada regra; não foi escolhida uma regra de prevalência.\n\n' +
    trechos.map((c) => `${c.texto}\n[${c.documento}${c.pagina ? `, página ${c.pagina}` : ''}, cláusula ${c.numero}]`).join('\n\n');
}

function formatarRespostaDocumental(texto, fontes) {
  if (typeof texto !== 'string' || texto.length > 30000) return null;
  let dados;
  try { dados = JSON.parse(texto.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch (_) { return null; }
  if (!dados || typeof dados.naoLocalizado !== 'boolean' || !Array.isArray(dados.evidencias) || dados.evidencias.length > 6) return null;
  if (dados.naoLocalizado) return dados.evidencias.length ? null : 'Não localizei a informação nos trechos analisados. Isso não comprova que ela inexista no edital. Confira os documentos oficiais.';
  if (!dados.evidencias.length) return null;
  const trechos = [];
  for (const e of dados.evidencias) {
    const fonte = fontes.find((f) => f.id === e?.id);
    if (!fonte || typeof e.trecho !== 'string') return null;
    const trecho = normalizar(e.trecho);
    if (trecho.length < 15 || trecho.length > 3500 || !fonte.texto.includes(trecho)) return null;
    trechos.push(`${trecho}\n[${fonte.documento}${fonte.pagina ? `, página ${fonte.pagina}` : ''}${fonte.numero ? `, cláusula ${fonte.numero}` : ''}]`);
  }
  return `Trechos localizados para sua pergunta:\n\n${[...new Set(trechos)].join('\n\n')}`;
}

function avisarCobertura(resposta, leituraParcial, selecaoParcial) {
  const avisos = [];
  if (leituraParcial) avisos.push('Atenção: a leitura dos documentos é parcial. Confira também o material não lido.');
  if (selecaoParcial) avisos.push('Esta resposta usa uma seleção de trechos da fonte armazenada; não equivale à análise integral do edital.');
  return [...avisos, resposta].join('\n\n');
}

module.exports = { prepararFontesPergunta, responderPagamento, formatarRespostaDocumental, avisarCobertura };
