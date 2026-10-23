const chavesExatas = (objeto, chaves) => objeto && typeof objeto === 'object' && !Array.isArray(objeto) && Object.keys(objeto).length === chaves.length && chaves.every(chave => Object.hasOwn(objeto, chave));

function prepararTransporte(mensagens, schema) {
  const numeros = schema.properties.ancoras?.required;
  if (!numeros) return { mensagens, schema };
  // Chaves fixas evitam números de cláusula como tokens de propriedade no decodificador estrito.
  const chaves = numeros.map((_, i) => `A${i + 1}`);
  const properties = { ...schema.properties, ancoras: { ...schema.properties.ancoras, required: chaves,
    properties: Object.fromEntries(numeros.map((numero, i) => [chaves[i], schema.properties.ancoras.properties[numero]])) } };
  delete properties.pontos;
  const contexto = JSON.parse(mensagens[1].content);
  contexto.ancorasObrigatorias = contexto.ancorasObrigatorias.map((ancora, i) => ({ ...ancora, chave: chaves[i] }));
  return { schema: { ...schema, required: schema.required.filter(chave => chave !== 'pontos'), properties },
    mensagens: [{ ...mensagens[0], content: mensagens[0].content.replace('Com âncoras obrigatórias, pontos deve ser um array vazio: o escopo fica delimitado às cláusulas pedidas.', 'Com âncoras obrigatórias, não envie pontos: o escopo fica delimitado às cláusulas pedidas.').replace('TODAS as chaves de ancorasObrigatorias', 'TODAS as propriedades chave de ancorasObrigatorias (A1, A2 etc.; nunca numero)') }, { ...mensagens[1], content: JSON.stringify(contexto) }] };
}

function traduzirTransporte(texto, schema) {
  if (typeof texto !== 'string' || texto.length > 30000) return null;
  const numeros = schema.properties.ancoras?.required;
  if (!numeros) return texto;
  let dados;
  try { dados = JSON.parse(texto); } catch (_) { return null; }
  const chaves = numeros.map((_, i) => `A${i + 1}`);
  if (!chavesExatas(dados, schema.required.filter(chave => chave !== 'pontos')) || !chavesExatas(dados.ancoras, chaves)) return null;
  return JSON.stringify({ ...dados, ancoras: Object.fromEntries(numeros.map((numero, i) => [numero, dados.ancoras[chaves[i]]])), pontos: [] });
}

module.exports = { prepararTransporte, traduzirTransporte };
