const { clausulasDaFonte } = require('./_edital_operacional');
const normalizar = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
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
  for (const original of fonte.split(/\r?\n/)) {
    const linha = original.trim(); const doc = linha.match(/^--- (.+) ---$/);
    if (doc) { guardar(); arquivo = doc[1]; pagina = ''; escopo = escopoDoTitulo(arquivo); continue; }
    const pg = linha.match(/^\[Página (\d+)\]$/); if (pg) pagina = pg[1];
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
module.exports = { clausulasComEscopo, escopoDaReferencia };
