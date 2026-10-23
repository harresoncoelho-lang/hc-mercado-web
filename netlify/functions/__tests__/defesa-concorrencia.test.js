const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { executarDefesa } = require('../_defesa_handler');
const fetchOriginal = globalThis.fetch;
let tentativasDeRede = 0;
test.before(() => { globalThis.fetch = async () => { tentativasDeRede++; throw new Error('Rede desabilitada neste teste isolado'); }; });
test.after(() => { globalThis.fetch = fetchOriginal; assert.equal(tentativasDeRede, 0); });

function barreira(total) {
  let chegaram = 0, liberar;
  const espera = new Promise(resolve => { liberar = resolve; });
  return async () => { if (++chegaram === total) liberar(); await espera; };
}
function caso(indice, usuario = `sessao-${indice}`) {
  const marcador = `fonte-publica-${indice}`;
  const textoEdital = `--- Edital.pdf ---\n[Página 1]\nLei 14.133/2021. Pregão eletrônico.\n1. ENTREGA\n1.1. O fornecimento de ${marcador} será realizado em ${indice + 5} dias após a ordem de fornecimento.`;
  const body = { tipo: 'esclarecimento', edital: { numeroControlePNCP: `11111111000111-1-${String(indice + 1).padStart(6, '0')}/2026` }, hashFonte: createHash('sha256').update(textoEdital).digest('hex'), questionamento: 'Esclarecer o prazo de fornecimento no item 1.1 do Edital.', objetivo: 'Confirmar o evento inicial e a contagem.', empresaId: `empresa-ficticia-${indice}`, empresa: `campo-empresa-nao-enviado-${indice}` };
  const dossie = { versao: 17, fonteLida: true, textoEdital, estrutura: { identificacao: { modalidade: 'Pregão' }, coberturaLeitura: { parcial: false, documentosNaoLidos: [] } } };
  return { usuario, marcador, body, dossie };
}
function respostaEstrita(schema) {
  const ancoras = {};
  for (const chave of schema.properties.ancoras.required) {
    const ramo = schema.properties.ancoras.properties[chave].anyOf[0];
    ancoras[chave] = { tipo: ramo.properties.tipo.enum[0], fontes: [ramo.properties.fontes.items.enum[0]], fundamentos: [] };
  }
  const dados = { ancoras };
  if (schema.properties.resposta) dados.resposta = { tipo: 'analisar_resposta_incompleta', fontes: ['R1', Object.values(ancoras)[0].fontes[0]], fundamentos: [] };
  return { ok: true, texto: JSON.stringify(dados) };
}
function dependencias(c, overrides = {}) {
  return { sessao: { ok: true, userId: c.usuario }, env: { DEFESA_IA_GRATUITA_CONFIRMADA: 'true', GROQ_API_KEY: `fixture-${c.usuario}` }, carregar: async numero => { assert.equal(numero, c.body.edital.numeroControlePNCP); return c.dossie; }, autorizar: async (usuario, funcao, limite) => { assert.equal(usuario, c.usuario); assert.equal(funcao, 'ia-edital'); assert.equal(limite, 40); return { ok: true }; }, chamar: async (_chave, _mensagens, schema) => respostaEstrita(schema), ...overrides };
}

test('oito sessões simultâneas mantêm fontes, declarações e credenciais injetadas isoladas', async () => {
  const casos = Array.from({ length: 8 }, (_, i) => caso(i));
  const carregarJuntos = barreira(casos.length), providerJuntos = barreira(casos.length);
  const originais = casos.map(c => JSON.stringify(c.dossie));
  const resultados = await Promise.all(casos.map(c => {
    c.body.fase = 'resposta_orgao'; c.body.respostaOrgao = `Declaração não autenticada: resposta-privada-${c.usuario}, confirmaremos a contagem.`;
    return executarDefesa(c.body, dependencias(c, { carregar: async () => { await carregarJuntos(); return c.dossie; }, chamar: async (chave, mensagens, schema) => {
      assert.equal(chave, `fixture-${c.usuario}`);
      const contexto = JSON.parse(mensagens[1].content), texto = JSON.stringify(contexto);
      assert.ok(texto.includes(c.marcador));
      assert.ok(texto.includes(`resposta-privada-${c.usuario}`));
      assert.equal(texto.includes(c.body.empresa), false, 'empresa é preenchida localmente; este campo não é contexto da IA');
      for (const outro of casos.filter(outro => outro !== c)) {
        assert.equal(texto.includes(outro.marcador), false);
        assert.equal(texto.includes(`resposta-privada-${outro.usuario}`), false);
      }
      await providerJuntos();
      return respostaEstrita(schema);
    } }));
  }));
  resultados.forEach((r, i) => {
    assert.equal(r.statusCode, 200);
    assert.equal(r.dados.hashFonte, casos[i].body.hashFonte);
    assert.ok(r.dados.analise.minutaTexto.includes(casos[i].marcador));
    for (const outro of casos.filter((_, j) => j !== i)) assert.equal(r.dados.analise.minutaTexto.includes(outro.marcador), false);
    assert.equal(JSON.stringify(casos[i].dossie), originais[i], 'requisição não deve mutar o dossiê compartilhável');
  });
});

test('dois pedidos da mesma sessão não cruzam declarações ou contexto em respostas fora de ordem', async () => {
  const casos = [caso(10, 'mesma-sessao'), caso(11, 'mesma-sessao')];
  casos.forEach(c => { c.body.fase = 'resposta_orgao'; c.body.respostaOrgao = `Declaração privada deste pedido: ${c.body.empresaId}.`; });
  let liberarPrimeira, segundaConcluida;
  const primeiraAguarda = new Promise(resolve => { liberarPrimeira = resolve; });
  const segundaPassou = new Promise(resolve => { segundaConcluida = resolve; });
  const chamadas = casos.map((c, i) => executarDefesa(c.body, dependencias(c, { chamar: async (_chave, mensagens, schema) => {
    assert.ok(JSON.stringify(mensagens).includes(c.marcador));
    assert.equal(JSON.stringify(mensagens).includes(casos[1 - i].marcador), false);
    assert.ok(JSON.stringify(mensagens).includes(c.body.respostaOrgao));
    assert.equal(JSON.stringify(mensagens).includes(casos[1 - i].body.respostaOrgao), false);
    if (i === 0) await primeiraAguarda; else segundaConcluida();
    return respostaEstrita(schema);
  } })));
  await segundaPassou; liberarPrimeira();
  const resultados = await Promise.all(chamadas);
  resultados.forEach((r, i) => { assert.equal(r.statusCode, 200); assert.equal(r.dados.hashFonte, casos[i].body.hashFonte); assert.ok(r.dados.analise.minutaTexto.includes(casos[i].marcador)); });
});

test('concorrência na borda da cota usa contador atômico simulado por usuário e não chama IA após o limite', async () => {
  const a = caso(20, 'usuario-a'), b = caso(21, 'usuario-b');
  const pedidos = [...Array(12).fill(a), ...Array(4).fill(b)], todos = barreira(pedidos.length);
  const contagens = new Map([[a.usuario, 38], [b.usuario, 39]]), chamadas = new Map([[a.usuario, 0], [b.usuario, 0]]);
  const resultados = await Promise.all(pedidos.map(c => executarDefesa(c.body, dependencias(c, { autorizar: async usuario => {
    assert.equal(usuario, c.usuario); await todos();
    // Simula apenas o valor devolvido pelo UPSERT atômico; não é teste de Postgres.
    const atual = contagens.get(usuario) + 1; contagens.set(usuario, atual);
    return atual <= 40 ? { ok: true } : { ok: false, status: 429, erro: 'Limite simulado atingido' };
  }, chamar: async (_chave, _mensagens, schema) => { chamadas.set(c.usuario, chamadas.get(c.usuario) + 1); return respostaEstrita(schema); } }))));
  assert.equal(resultados.filter(r => r.statusCode === 200).length, 3);
  assert.equal(resultados.filter(r => r.statusCode === 429).length, 13);
  assert.equal(chamadas.get(a.usuario), 2); assert.equal(chamadas.get(b.usuario), 1);
  assert.equal(contagens.get(a.usuario), 50); assert.equal(contagens.get(b.usuario), 43);
});

test('falhas simultâneas de sessão, fonte e cota permanecem fechadas sem contaminar requisição válida', async () => {
  const casos = Array.from({ length: 7 }, (_, i) => caso(i + 30));
  const overrides = [{ sessao: null }, { autorizar: async () => ({ ok: false, status: 503, erro: 'Cota indisponível' }) }, { autorizar: async () => ({ ok: false, status: 429, erro: 'Limite simulado' }) }, { autorizar: async () => { throw new Error('Falha simulada da cota'); } }, { autorizar: async () => undefined }, {}, {}];
  casos[5].body.hashFonte = '0'.repeat(64);
  const chamadas = Array(casos.length).fill(0);
  const resultados = await Promise.all(casos.map((c, i) => executarDefesa(c.body, dependencias(c, { ...overrides[i], chamar: async (_chave, _mensagens, schema) => { chamadas[i]++; return respostaEstrita(schema); } }))));
  assert.deepEqual(resultados.map(r => r.statusCode), [401, 503, 429, 503, 503, 409, 200]);
  assert.deepEqual(chamadas, [0, 0, 0, 0, 0, 0, 1]);
});
