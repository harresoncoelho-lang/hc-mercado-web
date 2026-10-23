const { clausulasDaFonte } = require('./_edital_operacional');
const normalizar = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
function escopoDoTitulo(linha) {
  const t = normalizar(linha.trim());
  if (/^(?:modelo de edital\b|edital(?:\.pdf)?$)/.test(t)) return 'Edital';
  if (/^(?:modelo de termo de referencia\b|termo de referencia(?:\s+\d+\/\d+)?$|tr(?:\.pdf)?$)/.test(t)) return 'Termo de Referência';
  if (/^(?:termo de contrato administrativo\b|(?:minuta (?:de |do )?)?contrato(?:\.pdf)?$)/.test(t)) return 'Contrato';
  if (/^(?:minuta da ata de registro|ata de registro de prec)/.test(t)) return 'Ata de Registro de Preços';
  return null;
}
function clausulasComEscopo(fonte) {
  const blocos = []; let arquivo = 'Documento oficial', pagina = '', escopo = null, linhas = [];
  const guardar = () => { if (linhas.length) blocos.push({ arquivo, pagina, escopo, linhas }); linhas = []; };
  const normalizadas = normalizarMarcadores(fonte);
  for (let indice = 0; indice < normalizadas.length; indice++) {
    const original = normalizadas[indice];
    const linha = original.trim(); const doc = linha.match(/^--- (.+) ---$/);
    if (doc) { guardar(); arquivo = doc[1]; pagina = ''; escopo = escopoDoTitulo(arquivo); continue; }
    const pg = linha.match(/^\[Página (\d+)\]$/);
    if (pg) {
      pagina = pg[1];
      let fim = indice + 1;
      while (fim < normalizadas.length && !/^\[Página \d+\]$|^--- .+ ---$/.test(normalizadas[fim].trim())) fim++;
      const paginaLinhas = normalizadas.slice(indice + 1, fim);
      const rodape = escopoDoRodape(paginaLinhas);
      if (rodape && rodape !== escopo) { guardar(); escopo = rodape; }
      else if (!rodape && paginaLinhas.some(l => escopoDoTitulo(l) && escopoDoTitulo(l) !== escopo)) { guardar(); escopo = null; }
    }
    const titulo = escopoDoTitulo(linha);
    if (titulo && titulo !== escopo) { guardar(); escopo = titulo; }
    else if (/^(?:ANEXO|AP[EÊ]NDICE)\s+[IVX\d]+\b|^ESTUDO T[EÉ]CNICO PRELIMINAR\b/i.test(linha)) { guardar(); escopo = null; }
    if (!linhas.length && pagina && !pg) linhas.push(`[Página ${pagina}]`);
    linhas.push(original);
  }
  guardar();
  return blocos.flatMap(b => {
    const prefixo = `--- ${b.arquivo} ---\n`;
    const clausulas = clausulasDaFonte(prefixo + b.linhas.join('\n')).map(c => ({ ...c, escopoDocumento: b.escopo }));
    // PDF pode deslocar o marcador ao fim da linha; só aceitamos a sequência adjacente comprovada.
    let anterior = '', pg = '';
    for (let i = 0; i < b.linhas.length; i++) {
      const linha = b.linhas[i].trim(), pagina = linha.match(/^\[Página (\d+)\]$/);
      if (pagina) pg = pagina[1];
      const inicio = linha.match(/^(\d+(?:\.\d+)+)\.\s*[A-Za-zÀ-ÿ]/);
      const deslocado = !inicio && linha.match(/^(.+\D)(\d+(?:\.\d+)+)\.\s*$/);
      if (deslocado) {
        const n = deslocado[2], partes = n.split('.'), ultimo = Number(partes.pop()), raiz = partes.join('.');
        let j = i + 1; while (j < b.linhas.length && !/^\d+(?:\.\d+)+\.\s*[A-Za-zÀ-ÿ]/.test(b.linhas[j].trim()) && !/^\[Página /.test(b.linhas[j].trim())) j++;
        const seguinte = b.linhas[j]?.trim().match(/^(\d+(?:\.\d+)+)\./)?.[1];
        if (anterior === `${raiz}.${ultimo - 1}` && seguinte === `${raiz}.${ultimo + 1}` && !clausulas.some(c => c.numero === n)) {
          clausulas.push({ numero: n, documento: b.arquivo, pagina: pg, escopoDocumento: b.escopo, secao: '', texto: b.linhas.slice(i, j).map(v => v.trim()).join(' '), marcadorDeslocado: true });
        }
      }
      if (inicio) anterior = inicio[1];
    }
    return clausulas;
  });
}
function normalizarMarcadores(fonte) {
  let arquivo = '', pagina = '';
  return fonte.split(/\r?\n/).flatMap(linha => {
    const m = linha.trim().match(/^(?:--- (.+), página (\d+) ---|\[Fonte: (.+), página (\d+)\])$/i);
    if (m) {
      const nome = m[1] || m[3], numero = m[2] || m[4];
      const continuo = nome === arquivo && pagina && Number(numero) === Number(pagina) + 1;
      arquivo = nome; pagina = numero;
      return [...(continuo ? [] : [`--- ${nome} ---`]), `[Página ${numero}]`];
    }
    const doc = linha.trim().match(/^--- (.+) ---$/); if (doc) { arquivo = doc[1]; pagina = ''; }
    const pg = linha.trim().match(/^\[Página (\d+)\]$/);
    if (pg) {
      const reiniciar = pagina && Number(pg[1]) !== Number(pagina) + 1;
      pagina = pg[1];
      if (reiniciar) return [`--- ${arquivo || 'Documento oficial'} ---`, linha];
    }
    return [linha];
  });
}
function escopoDoRodape(linhas) {
  const limpas = linhas.map(l => l.trim()).filter(Boolean);
  const i = limpas.findLastIndex(l => /^Modelo de (?:Edital|Termo de Refer[eê]ncia)\b/i.test(l));
  if (i < 1 || !/^camara nacional de modelos de licitacoes e contratos\b/.test(normalizar(limpas[i - 1]))) return null;
  const depois = limpas.slice(i + 1).map(normalizar);
  const assinaturaLonga = depois.length === 3 && /^aprovado pela secretaria de gestao e inovacao/.test(depois[0]) &&
    /^identidade visual pela secretaria de gestao e inovacao/.test(depois[1]) && /^atualizacao:/.test(depois[2]);
  const assinaturaCurta = depois.length === 2 && /^aprovado pela secretaria de gestao e inovacao/.test(depois[0]) && /^atualizacao:/.test(depois[1]);
  if (!assinaturaLonga && !assinaturaCurta) return null;
  const escopo = escopoDoTitulo(limpas[i]);
  if (limpas.slice(0, i - 1).some(l => /^(?:ANEXO|AP[EÊ]NDICE)\b/i.test(l) || escopoDoTitulo(l))) return null;
  return escopo;
}
function escopoDaReferencia(texto, inicio, fim) {
  const tipo = v => /termo de refer[eê]ncia|^tr$/i.test(v) ? 'Termo de Referência' : /edital/i.test(v) ? 'Edital' : /ata/i.test(v) ? 'Ata de Registro de Preços' : 'Contrato';
  const depois = texto.slice(fim).match(/^\s*(?:d[oa]|n[oa])\s+(Edital|Termo de Refer[eê]ncia|TR|Contrato|Ata(?: de Registro de Preços)?)\b/i);
  if (depois) return tipo(depois[1]);
  const antes = texto.slice(Math.max(0, inicio - 120), inicio);
  const mencoes = [...antes.matchAll(/\b(Edital|Termo de Refer[eê]ncia|TR|Contrato|Ata de Registro de Preços)\b/gi)];
  const ultima = mencoes.at(-1);
  if (!ultima || /[)\n]|[!?]/.test(antes.slice(ultima.index + ultima[0].length))) return null;
  return tipo(ultima[1]);
}
const normalizarFonteDocumental = fonte => normalizarMarcadores(fonte).join('\n');
module.exports = { clausulasComEscopo, escopoDaReferencia, normalizarFonteDocumental };
