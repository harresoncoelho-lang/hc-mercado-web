import test from 'node:test';
import assert from 'node:assert/strict';
import { criarMotor } from './motor.mjs';
const contexto = { cnpj: '12345678000195', uasg: '788820', number: '41', year: '2026', purchaseId: '78882005000412026' };
function fixture(n = 1) {
  const ids = Array.from({ length: n }, (_, i) => String(i + 1));
  const fonte = new Map(), chamadas = [], paginas = [];
  let now = 100;
  const porta = {
    tipo: 'ficticia',
    async lerPagina({ cursor }) {
      const i = Number(cursor ?? 0); paginas.push(i);
      return { contexto, ids: ids.slice(i, i + 10), proximo: i + 10 < n ? String(i + 10) : null };
    },
    async aplicar(c) { chamadas.push(c.item.id); fonte.set(c.item.id, structuredClone(c)); return { status: 'aplicado', comando: c }; },
    async conciliar(c) { return fonte.has(c.item.id) ? { status: 'aplicado', comando: fonte.get(c.item.id) } : null; },
  };
  const motor = criarMotor({ contexto, versao: 1,
    catalogo: ids.map(id => ({ id, quantidade: '1', grupo: null, exigidos: ['marca', 'modelo'] })),
    linhas: ids.map(id => ({ id, quantidade: '1', unitario: '1.2300', marca: 'Marca', modelo: 'Modelo' })) }, porta, () => now);
  const autorizar = (id = 'a') => motor.autorizar({ id, vinculo: motor.vinculo, expiraEm: 200 });
  return { motor, porta, fonte, chamadas, paginas, autorizar, tick: x => now = x };
}
for (const n of [206, 1001]) test(`percorre ${n} itens em páginas de dez`, async () => {
  const f = fixture(n); f.autorizar();
  assert.equal((await f.motor.executar()).estado, 'concluido');
  assert.equal(f.paginas.length, Math.ceil(n / 10)); assert.equal(new Set(f.chamadas).size, n);
  f.autorizar('b'); await f.motor.executar(); assert.equal(f.chamadas.length, n);
});
test('última resposta perdida exige fonte independente e não repete aplicado', async () => {
  const f = fixture(206), aplicar = f.porta.aplicar;
  f.porta.aplicar = async c => { const r = await aplicar(c); if (c.item.id === '206') throw Error('timeout'); return r; };
  f.autorizar(); assert.equal((await f.motor.executar()).estado, 'incerto');
  assert.equal(f.motor.autorizar({ id: 'b', vinculo: f.motor.vinculo, expiraEm: 200 }), false);
  await f.motor.executar(); assert.equal(f.chamadas.length, 206);
  await f.motor.reconciliar(); f.autorizar('c'); await f.motor.executar();
  assert.equal(f.chamadas.length, 206); assert.equal(f.motor.status().estado, 'concluido');
});
test('fonte ausente ou valor divergente mantém incerteza', async () => {
  const f = fixture(); f.porta.aplicar = async () => { throw Error('timeout'); }; f.autorizar(); await f.motor.executar();
  await f.motor.reconciliar(); assert.ok(f.motor.status().pendente);
  f.porta.conciliar = async c => ({ status: 'aplicado', comando: { ...c, item: { ...c.item, unitario: '99' } } });
  await f.motor.reconciliar(); assert.equal(f.motor.status().estado, 'incerto');
});
test('rejeição explícita requer nova autorização', async () => {
  const f = fixture(); f.porta.aplicar = async c => ({ status: 'rejeitado', comando: c });
  f.autorizar(); assert.equal((await f.motor.executar()).estado, 'rejeitado');
  assert.equal(f.autorizar(), false); assert.equal(f.autorizar('b'), true);
});
test('troca contexto A-B-A revoga; expiração e pausa interrompem', async () => {
  const f = fixture(); f.autorizar(); f.motor.observarContexto({ ...contexto, cnpj: 'outro' });
  f.motor.observarContexto(contexto); await f.motor.executar(); assert.equal(f.chamadas.length, 0);
  f.autorizar('b'); f.tick(200); assert.equal((await f.motor.executar()).estado, 'expirado');
  f.motor.pausar(); await f.motor.executar(); assert.equal(f.chamadas.length, 0);
});
test('exclusividade local; revogação durante chamada preserva confirmação e para próximo', async () => {
  const f = fixture(2); let liberar, entrou;
  const iniciada = new Promise(r => entrou = r);
  const aplicar = f.porta.aplicar;
  f.porta.aplicar = async c => { await new Promise(r => { liberar = r; entrou(); }); return aplicar(c); };
  f.autorizar(); const run = f.motor.executar(); await iniciada;
  assert.equal((await f.motor.executar()).ocupado, true);
  f.motor.revogar(); liberar(); await run;
  assert.deepEqual(f.chamadas, ['1']); assert.deepEqual(f.motor.status().confirmados, ['1']);
});
test('identidade idempotente vincula lote e contexto, mantendo estabilidade na repetição', async () => {
  const ledger = new Map(), recebidos = [];
  async function executar(unitario, ctx = contexto) {
    const porta = {
      tipo: 'ficticia',
      async lerPagina() { return { contexto: ctx, ids: ['1'], proximo: null }; },
      async aplicar(c) {
        recebidos.push(c.id);
        if (!ledger.has(c.id)) ledger.set(c.id, structuredClone(c));
        return { status: 'aplicado', comando: ledger.get(c.id) };
      },
      async conciliar(c) { return { status: 'aplicado', comando: ledger.get(c.id) }; },
    };
    const m = criarMotor({ contexto: ctx, versao: 1,
      catalogo: [{ id: '1', quantidade: '1', grupo: null, exigidos: [] }],
      linhas: [{ id: '1', quantidade: '1', unitario }] }, porta, () => 100);
    m.autorizar({ id: 'a', vinculo: m.vinculo, expiraEm: 200 });
    assert.equal((await m.executar()).estado, 'concluido');
  }
  await executar('1.00'); await executar('2.00');
  await executar('1.00', { ...contexto, cnpj: '11222333000181' });
  await executar('1.00');
  assert.equal(new Set(recebidos.slice(0, 3)).size, 3);
  assert.equal(recebidos[0], recebidos[3]);
});
