const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('./robo-lances.js');

const base = (o = {}) => ({ modo: 'aberto', piso: 8000n, inicial: 10000n, decremento: 50n, semente: 7,
  concorrentes: R.gerarConcorrentes({ semente: 7, quantidade: 3, referencia: 10000n, piso: 8000n }), ...o });

test('centavosDe aceita formatos de reais e recusa zero/negativo/lixo', () => {
  assert.equal(R.centavosDe('12,34'), 1234n);
  assert.equal(R.centavosDe('12.34'), 1234n);
  assert.equal(R.centavosDe('1.234,56'), 123456n);
  assert.equal(R.centavosDe('R$ 0,50'), 50n);
  for (const v of ['0', '0,00', '-1', '1e3', '12,345', '', null, 'abc']) assert.equal(R.centavosDe(v), null);
});

test('decremento em R$ e % nunca fica abaixo da diferença mínima do edital', () => {
  assert.deepEqual(R.decremento({ tipo: 'reais', valor: '0,50' }), { ok: true, centavos: 50n, aviso: '' });
  // 0,5% de R$ 100,00 = R$ 0,50; 0,33% de R$ 100,01 arredonda para cima.
  assert.equal(R.decremento({ tipo: 'percentual', valor: '0,5', referencia: 10000n }).centavos, 50n);
  assert.equal(R.decremento({ tipo: 'percentual', valor: '0,33', referencia: 10001n }).centavos, 34n);
  const ajustado = R.decremento({ tipo: 'reais', valor: '0,10', diferencaMinima: 100n });
  assert.equal(ajustado.centavos, 100n); assert.match(ajustado.aviso, /diferença mínima/);
  for (const valor of ['0', '51', 'x', '1,234']) assert.equal(R.decremento({ tipo: 'percentual', valor, referencia: 10000n }).ok, false);
  assert.equal(R.decremento({ tipo: 'percentual', valor: '1', referencia: null }).ok, false);
  assert.equal(R.decremento({ tipo: 'reais', valor: '0' }).ok, false);
});

test('intervalo nunca abaixo de 20 s nem acima de 10 min', () => {
  assert.equal(R.intervaloMs('5'), 20000);
  assert.equal(R.intervaloMs('30'), 30000);
  assert.equal(R.intervaloMs('99999'), 600000);
  assert.equal(R.intervaloMs('abc'), 20000);
});

test('podeLancar respeita 20 s do próprio lance e 3 s do melhor lance de outro', () => {
  assert.equal(R.podeLancar(1000, {}).ok, true);
  const proprio = R.podeLancar(15000, { ultimoProprioEm: 0 });
  assert.deepEqual([proprio.ok, proprio.esperaMs, proprio.motivo], [false, 5000, 'intervalo_proprio']);
  const melhor = R.podeLancar(31000, { ultimoProprioEm: 0, melhorOutroEm: 30000 });
  assert.deepEqual([melhor.ok, melhor.esperaMs, melhor.motivo], [false, 2000, 'intervalo_melhor']);
  assert.equal(R.podeLancar(33000, { ultimoProprioEm: 0, melhorOutroEm: 30000 }).ok, true);
  // Intervalo configurado abaixo de 20 s não fura a regra.
  assert.equal(R.podeLancar(10000, { ultimoProprioEm: 0 }, 5000).ok, false);
});

test('aceitaLance recusa o que a sala recusaria', () => {
  assert.equal(R.aceitaLance({ valor: 100n, ultimoProprio: 100n, melhor: 90n }).motivo, 'nao_melhora_proprio');
  assert.equal(R.aceitaLance({ valor: 90n, ultimoProprio: 100n, melhor: 90n }).motivo, 'igual_ao_melhor');
  assert.equal(R.aceitaLance({ valor: 89n, ultimoProprio: 100n, melhor: 90n, diferencaMinima: 5n }).motivo, 'diferenca_minima');
  assert.equal(R.aceitaLance({ valor: 85n, ultimoProprio: 100n, melhor: 90n, diferencaMinima: 5n }).ok, true);
  assert.equal(R.aceitaLance({ valor: 95n, ultimoProprio: 100n, melhor: 90n }).ok, true); // lance intermediário
});

test('simulação é determinística, nunca passa do piso e respeita 20 s entre seus lances', () => {
  for (const modo of Object.keys(R.MODOS)) {
    const a = R.simular(base({ modo })), b = R.simular(base({ modo }));
    assert.deepEqual(a.resultado, b.resultado);
    const seus = a.log.filter((e) => e.tipo === 'aceito');
    for (const e of seus) assert.ok(e.valor >= 8000n, `${modo}: lance abaixo do piso`);
    for (let k = 1; k < seus.length; k++) assert.ok(seus[k].t - seus[k - 1].t >= 20000, `${modo}: menos de 20 s entre lances`);
    assert.ok(a.resultado.seu >= 8000n);
    assert.equal(a.log.at(-1).tipo, 'fim');
  }
});

test('lance dos 2 minutos finais prorroga no aberto; aberto e fechado não prorroga e sugere o piso no lance fechado', () => {
  // Concorrente que só reage devagar empurra lances para o fim da etapa.
  const lento = [{ nome: 'C1', inicial: 10500n, piso: 7000n, decremento: 10n, reacaoMs: 530000 }];
  const aberto = R.simular(base({ concorrentes: lento }));
  assert.ok(aberto.resultado.prorrogacoes > 0);
  assert.ok(aberto.resultado.fimMs > R.TEMPOS.aberto);
  const af = R.simular(base({ modo: 'aberto_fechado', concorrentes: lento }));
  assert.equal(af.resultado.prorrogacoes, 0);
  assert.ok(af.log.some((e) => e.tipo === 'sugestao' && /fechado/.test(e.texto) && e.valor === 8000n));
});

test('líder não recebe sugestão e piso inalcançável bloqueia', () => {
  const fraco = [{ nome: 'C1', inicial: 20000n, piso: 19000n, decremento: 100n, reacaoMs: 20000 }];
  const s = R.simular(base({ concorrentes: fraco }));
  assert.equal(s.resultado.voceVenceu, true);
  assert.equal(s.resultado.sugestoes, 0);
  assert.ok(s.log.some((e) => e.tipo === 'bloqueado' && /lidera/.test(e.texto)));
  const forte = [{ nome: 'C1', inicial: 9000n, piso: 1000n, decremento: 500n, reacaoMs: 20000 }];
  assert.ok(R.simular(base({ concorrentes: forte })).log.some((e) => e.tipo === 'bloqueado' && /piso/.test(e.texto)));
});

test('fechado e aberto: proposta mais de 10% acima e fora das 3 melhores não disputa', () => {
  const melhores = [9000n, 9100n, 9200n].map((v, k) => ({ nome: `C${k + 1}`, inicial: v, piso: v, decremento: 10n, reacaoMs: 20000 }));
  const s = R.simular(base({ modo: 'fechado_aberto', concorrentes: melhores, inicial: 11000n }));
  assert.equal(s.resultado.posicao, 4);
  assert.match(s.log.at(-1).texto, /fora da etapa aberta/);
});

test('entradas inválidas são recusadas antes de simular', () => {
  assert.throws(() => R.simular(base({ modo: 'leilao' })));
  assert.throws(() => R.simular(base({ piso: 0n })));
  assert.throws(() => R.simular(base({ piso: 20000n })));
});

test('tela: item sem preço-limite, sem proposta ou com piso acima da proposta não simula', () => {
  const UI = require('./robo-lances-ui.js');
  const cfg = { tipo: 'reais', valor: '0,50', intervalo: '10' };
  assert.match(UI.parametrosItem({ piso: null, inicial: 10000n, cfg }).erro, /preço-limite/);
  assert.match(UI.parametrosItem({ piso: 8000n, inicial: null, cfg }).erro, /proposta/);
  assert.match(UI.parametrosItem({ piso: 12000n, inicial: 10000n, cfg }).erro, /passa da sua proposta/);
  const ok = UI.parametrosItem({ piso: 8000n, inicial: 10000n, cfg, diferencaMinima: 100n });
  assert.deepEqual([ok.ok, ok.decremento, ok.intervalo], [true, 100n, 20000]);
  const reg = UI.entradasRegistro([{ t: 0, tipo: 'concorrente', texto: 'x' }, { t: 5000, tipo: 'sugestao', texto: 'y' }], { itemId: 'i', rotulo: 'Item 1', modo: 'aberto', rodada: 2, em: 'agora' });
  assert.deepEqual(reg.map((e) => e.tipo), ['sugestao']);
});
