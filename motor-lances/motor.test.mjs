import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotor } from './motor.mjs';

const NOW = 1793577600000;
const policy = () => ({ id: 'p1', version: 1, cnpj: '12345678000195', purchaseId: '78882005000412026', itemId: '1', criterion: 'menor_preco_unitario', mode: 'simulado', floor: '10.0000', decrement: '0.0001' });
const config = () => ({ source: 'fixture-portal', maxSnapshotAgeMs: 1000 });
const snapshot = () => ({ cnpj: policy().cnpj, purchaseId: policy().purchaseId, itemId: '1', criterion: 'menor_preco_unitario', mode: 'simulado', source: 'fixture-portal', observedAt: NOW, observationId: 's1', session: 'ativa', itemState: 'aberto', leading: false, bestPrice: '12.3456', ownPrice: '15.0000' });
function ready(p = policy()) {
  const motor = createMotor(p, config());
  const auth = { id: 'a1', policyKey: motor.policyKey, notBefore: NOW - 100, expiresAt: NOW + 10000 };
  motor.authorize(auth, NOW);
  return { motor, auth };
}

test('gera somente candidata exata e reserva pendência, sem envio', () => {
  const { motor } = ready(); const result = motor.decide(snapshot(), NOW);
  assert.equal(result.status, 'candidata'); assert.equal(result.price, '12.3455');
  assert.equal(result.sent, false); assert.equal(motor.status(NOW).pending, 'pendente');
});

test('política e autorização separadas, imutáveis e vinculadas ao conteúdo', () => {
  const p = policy(); const motor = createMotor(p, config()); p.floor = '1.0000';
  assert.equal(motor.decide(snapshot(), NOW).reason, 'nao_autorizado');
  assert.equal(motor.authorize({ id: 'a', policyKey: 'outra', notBefore: NOW, expiresAt: NOW + 10 }, NOW).ok, false);
  assert.equal(motor.authorize({ id: 'a', policyKey: motor.policyKey, notBefore: NOW, expiresAt: NOW + 10 }, NOW).ok, true);
  assert.equal(motor.decide({ ...snapshot(), bestPrice: '10.0000', authorization: { floor: '1' } }, NOW).reason, 'piso');
});

test('dinheiro inválido, números binários, precisão extra e política desconhecida negados', () => {
  for (const value of ['0.0000', '-1', '1e3', '01.0000', '12.12345', 'NaN', 12.34, '10000000000000.0000']) {
    assert.throws(() => createMotor({ ...policy(), floor: value }, config()));
  }
  for (const override of [{ criterion: 'desconto' }, { mode: 'aberto' }, { groupId: '1' }, { version: 0 }, { cnpj: '00000000000000' }]) {
    assert.throws(() => createMotor({ ...policy(), ...override }, config()));
  }
  for (const value of ['12.12345', 12, '-1', 'Infinity']) assert.equal(ready().motor.decide({ ...snapshot(), bestPrice: value }, NOW).status, 'bloqueado');
});

test('piso, preço próprio e liderança nunca geram piora ou ultrapassagem', () => {
  assert.equal(ready().motor.decide({ ...snapshot(), bestPrice: '10.0001' }, NOW).price, '10.0000');
  assert.equal(ready().motor.decide({ ...snapshot(), bestPrice: '10.0000' }, NOW).reason, 'piso');
  assert.equal(ready().motor.decide({ ...snapshot(), ownPrice: '12.3455' }, NOW).reason, 'sem_melhoria');
  assert.equal(ready().motor.decide({ ...snapshot(), leading: true }, NOW).reason, 'ja_lider');
});

test('fonte, contexto, sessão, critério e modo do snapshot não podem ser substituídos', () => {
  for (const override of [{ source: '' }, { source: 'outra' }, { cnpj: '99999999000191' }, { purchaseId: '78882005000422026' }, { itemId: '2' }, { criterion: 'desconto' }, { mode: 'aberto' }, { session: 'expirada' }, { itemState: 'fechado' }, { leading: null }, { groupId: 'g' }]) {
    assert.equal(ready().motor.decide({ ...snapshot(), ...override }, NOW).status, 'bloqueado');
  }
});

test('relógio injetado e snapshots antigos/futuros ou sem identidade são negados', () => {
  for (const override of [{ observedAt: NOW + 1 }, { observedAt: NOW - 1001 }, { observedAt: NaN }, { observationId: '' }]) {
    assert.equal(ready().motor.decide({ ...snapshot(), ...override }, NOW).status, 'bloqueado');
  }
  assert.equal(ready().motor.decide(snapshot(), NOW - 1).reason, 'relogio');
});

test('pausa/revogação/expiração invalidam autorização; snapshot não reativa', () => {
  const { motor, auth } = ready(); motor.pause();
  assert.equal(motor.decide(snapshot(), NOW).reason, 'pausado');
  assert.equal(motor.authorize(auth, NOW).ok, false);
  assert.equal(motor.authorize({ ...auth, id: 'a2' }, NOW).ok, true);
  motor.revoke(); assert.equal(motor.authorize({ ...auth, id: 'a3' }, NOW).ok, false);
  assert.equal(motor.decide(snapshot(), NOW).reason, 'revogado');
  const expired = ready(); assert.equal(expired.motor.decide(snapshot(), NOW + 10000).reason, 'expirado');
});

test('duas chamadas na mesma instância reservam apenas uma candidata', async () => {
  const { motor } = ready();
  const results = await Promise.all([Promise.resolve().then(() => motor.decide(snapshot(), NOW)), Promise.resolve().then(() => motor.decide(snapshot(), NOW))]);
  assert.equal(results.filter(x => x.status === 'candidata').length, 1);
  assert.equal(results.filter(x => x.reason === 'pendente').length, 1);
});

test('incerto bloqueia; resolução explícita não permite replay do snapshot', () => {
  const { motor } = ready(); const first = motor.decide(snapshot(), NOW);
  motor.resolve({ decisionId: first.decisionId, outcome: 'desconhecido' }, NOW);
  assert.equal(motor.decide({ ...snapshot(), observationId: 's2', observedAt: NOW + 1 }, NOW + 1).reason, 'incerto');
  assert.equal(motor.resolve({ decisionId: 'errado', outcome: 'rejeitado' }, NOW + 1).ok, false);
  assert.equal(motor.resolve({ decisionId: first.decisionId, outcome: 'aplicado', price: first.price }, NOW + 1).ok, true);
  assert.equal(motor.decide(snapshot(), NOW + 1).reason, 'snapshot_repetido');
  const next = motor.decide({ ...snapshot(), observationId: 's3', observedAt: NOW + 2, bestPrice: '12.0000', ownPrice: first.price }, NOW + 2);
  assert.equal(next.price, '11.9999');
});

test('confirmação com valor divergente mantém incerto; pausa não cancela pendência', () => {
  const { motor } = ready(); const first = motor.decide(snapshot(), NOW); motor.pause();
  assert.equal(motor.status(NOW).pending, 'pendente');
  assert.equal(motor.resolve({ decisionId: first.decisionId, outcome: 'aplicado', price: '1.0000' }, NOW).ok, false);
  assert.equal(motor.status(NOW).pending, 'incerto');
  assert.equal(motor.resolve({ decisionId: first.decisionId, outcome: 'rejeitado' }, NOW).ok, true);
  assert.equal(motor.decide(snapshot(), NOW).reason, 'pausado');
});

test('entradas não são mutadas e resultado não permite editar estado interno', () => {
  const { motor } = ready(); const s = snapshot(); const copy = structuredClone(s);
  const candidate = motor.decide(s, NOW); candidate.price = '1.0000';
  assert.deepEqual(s, copy);
  assert.equal(motor.resolve({ decisionId: candidate.decisionId, outcome: 'aplicado', price: '12.3455' }, NOW).ok, true);
});

test('extremos de precisão e mínimo não usam ponto flutuante', () => {
  const { motor } = ready({ ...policy(), floor: '0.0001' });
  assert.equal(motor.decide({ ...snapshot(), bestPrice: '0.0002', ownPrice: '0.0003' }, NOW).price, '0.0001');
  const big = ready();
  assert.equal(big.motor.decide({ ...snapshot(), bestPrice: '999999999999.9998', ownPrice: '999999999999.9999' }, NOW).price, '999999999999.9997');
});

test('autorização futura, expirada, sem ID e relógio inválido não ativam motor', () => {
  for (const override of [{ notBefore: NOW + 1 }, { expiresAt: NOW }, { id: '' }, { expiresAt: Infinity }]) {
    const motor = createMotor(policy(), config());
    assert.equal(motor.authorize({ id: 'a', policyKey: motor.policyKey, notBefore: NOW, expiresAt: NOW + 10, ...override }, NOW).ok, false);
    assert.equal(motor.decide(snapshot(), NOW).reason, 'nao_autorizado');
  }
  const { motor } = ready();
  assert.equal(motor.decide(snapshot(), NaN).reason, 'relogio');
});

test('identificador da compra exige string para evitar coerção numérica insegura', () => {
  // eslint-disable-next-line no-loss-of-precision -- o teste usa de propósito um inteiro acima de MAX_SAFE_INTEGER
  assert.throws(() => createMotor({ ...policy(), purchaseId: 78882005000412026 }, config()));
});

test('observação recente bloqueadora impede aberta/não líder anterior ainda no TTL', () => {
  for (const change of [{ itemState: 'fechado' }, { leading: true }]) {
    const { motor } = ready();
    assert.equal(motor.decide({ ...snapshot(), ...change, observedAt: NOW + 2, observationId: 'recente' }, NOW + 2).status, 'bloqueado');
    assert.equal(motor.decide({ ...snapshot(), observedAt: NOW + 1, observationId: 'antiga' }, NOW + 2).reason, 'snapshot_repetido');
  }
});

test('troca explícita de contexto fresco invalida autorização A→B→A', () => {
  const { motor, auth } = ready();
  assert.equal(motor.decide({ ...snapshot(), purchaseId: '78882005000422026' }, NOW).reason, 'contexto');
  assert.equal(motor.decide({ ...snapshot(), observationId: 'volta', observedAt: NOW + 1 }, NOW + 1).reason, 'pausado');
  assert.equal(motor.authorize(auth, NOW + 1).ok, false);
  assert.equal(motor.authorize({ ...auth, id: 'nova' }, NOW + 1).ok, true);
  assert.equal(motor.decide({ ...snapshot(), observationId: 'novo', observedAt: NOW + 2 }, NOW + 2).status, 'candidata');
});

test('sessão expirada durante pendência invalida autorização sem cancelar decisão', () => {
  const { motor } = ready(); const first = motor.decide(snapshot(), NOW);
  assert.equal(motor.decide({ ...snapshot(), session: 'expirada', observationId: 'expirou', observedAt: NOW + 1 }, NOW + 1).reason, 'sessao_ou_item');
  assert.deepEqual(motor.status(NOW + 1), { state: 'pausado', pending: 'pendente' });
  assert.equal(motor.resolve({ decisionId: first.decisionId, outcome: 'rejeitado' }, NOW + 1).ok, true);
  assert.equal(motor.decide({ ...snapshot(), observationId: 'voltou', observedAt: NOW + 2 }, NOW + 2).reason, 'pausado');
});

test('envelope inválido/fonte errada não revoga autorização nem envenena watermark', () => {
  for (const value of [null, { ...snapshot(), source: 'outra', session: 'expirada' }, { ...snapshot(), observedAt: NOW + 1, session: 'expirada' }, { ...snapshot(), cnpj: '', session: 'expirada' }]) {
    const { motor } = ready(); assert.equal(motor.decide(value, NOW).status, 'bloqueado');
    assert.equal(motor.status(NOW).state, 'ativo');
    assert.equal(motor.decide(snapshot(), NOW).status, 'candidata');
  }
});
