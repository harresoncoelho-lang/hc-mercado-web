// Contrato local: strings decimais canônicas, positivas, até quatro casas.
function decimal(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,17})(?:\.\d{1,4})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const scaled = BigInt(whole + fraction.padEnd(4, '0'));
  return scaled > 0n ? scaled : null;
}
const idValido = value => typeof value === 'string' && /^[1-9]\d{0,17}$/.test(value);
const texto = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 500;
const formatar = value => `${value / 100000000n}.${String(value % 100000000n).padStart(8, '0')}`;

export function validarLote(catalogo, linhas) {
  const erros = [];
  const rejeitar = () => ({ valido: false, erros, itens: [], lotesRevisao: [], totalExato: null, requerRevisaoPrecisao: false, writeAuthorized: false });
  if (!Array.isArray(catalogo) || !catalogo.length || !Array.isArray(linhas) || !linhas.length) {
    erros.push('Catálogo e lote devem conter itens.'); return rejeitar();
  }
  const mapa = new Map(); const grupos = new Map();
  for (const item of catalogo) {
    if (!item || !idValido(item.id) || mapa.has(item.id) || decimal(item.quantidade) === null
      || !(item.grupo === null || texto(item.grupo)) || !Array.isArray(item.exigidos)
      || item.exigidos.some(campo => !['marca', 'modelo', 'fabricante'].includes(campo))) {
      erros.push('Catálogo inválido: confira IDs, quantidade, grupo e exigências.'); return rejeitar();
    }
    mapa.set(item.id, item);
    if (item.grupo !== null) {
      if (!grupos.has(item.grupo)) grupos.set(item.grupo, []);
      grupos.get(item.grupo).push(item.id);
    }
  }
  const vistos = new Set(); const itens = []; let total = 0n; let requerRevisaoPrecisao = false;
  for (const [index, linha] of linhas.entries()) {
    const erro = mensagem => erros.push(`Linha ${index + 1}: ${mensagem}`);
    if (!linha || !idValido(linha.id) || !mapa.has(linha.id)) { erro('ID desconhecido ou inválido.'); continue; }
    if (vistos.has(linha.id)) { erro('ID duplicado.'); continue; }
    vistos.add(linha.id);
    const item = mapa.get(linha.id); const quantidade = decimal(linha.quantidade); const unitario = decimal(linha.unitario);
    if (linha.grupo !== undefined && linha.grupo !== item.grupo) { erro('Grupo diverge do catálogo.'); continue; }
    if (quantidade === null || unitario === null) { erro('Use números positivos em texto, ponto decimal e até quatro casas; sem separador de milhar.'); continue; }
    if (quantidade !== decimal(item.quantidade)) { erro('Quantidade diverge do catálogo.'); continue; }
    if (item.exigidos.some(campo => !texto(linha[campo]))) { erro('Preencha marca, modelo ou fabricante exigidos pelo catálogo.'); continue; }
    if (['marca', 'modelo', 'fabricante'].some(campo => linha[campo] !== undefined && !texto(linha[campo]))) { erro('Campo descritivo informado está vazio ou inválido.'); continue; }
    const valor = quantidade * unitario;
    const revisar = valor % 10000n !== 0n;
    requerRevisaoPrecisao ||= revisar; total += valor;
    itens.push({ id: linha.id, grupo: item.grupo, quantidade: linha.quantidade, unitario: linha.unitario,
      marca: linha.marca ?? null, modelo: linha.modelo ?? null, fabricante: linha.fabricante ?? null,
      totalExato: formatar(valor), requerRevisaoPrecisao: revisar });
  }
  for (const ids of grupos.values()) {
    const selecionados = ids.filter(id => vistos.has(id)).length;
    if (selecionados && selecionados !== ids.length) erros.push('Grupo incompleto: inclua todos os IDs da composição do catálogo.');
  }
  if (erros.length) return rejeitar();
  const lotesRevisao = [];
  for (let offset = 0; offset < itens.length; offset += 10) lotesRevisao.push(itens.slice(offset, offset + 10).map(item => item.id));
  return { valido: true, erros, itens, lotesRevisao, totalExato: formatar(total), requerRevisaoPrecisao, writeAuthorized: false };
}
