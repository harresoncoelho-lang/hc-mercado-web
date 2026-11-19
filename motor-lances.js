/* global module */
// Cérebro do robô de lances (antes em motor-lances/motor.mjs, que hoje só reexporta este arquivo).
// Na raiz e sem ESM para o navegador carregar com <script src> como os outros módulos da casca; regras em motor-lances/README.md.
(function (global) {
  'use strict';
  const token = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
  const time = value => Number.isSafeInteger(value) && value > 0;
  function money(value) {
    if (typeof value !== 'string' || !/^(0|[1-9]\d{0,11})\.\d{4}$/.test(value)) return null;
    const amount = BigInt(value.replace('.', ''));
    return amount > 0n ? amount : null;
  }
  function format(value) { return `${value / 10000n}.${String(value % 10000n).padStart(4, '0')}`; }
  function cnpj(value) {
    if (typeof value !== 'string' || !/^\d{14}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
    for (let size = 12; size <= 13; size++) {
      const weights = size === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
      const rem = weights.reduce((sum, w, i) => sum + Number(value[i]) * w, 0) % 11;
      if (Number(value[size]) !== (rem < 2 ? 0 : 11 - rem)) return false;
    }
    return true;
  }

  // Política/configuração/autorização/relógio pertencem ao chamador confiável, nunca ao modelo ou ao DOM.
  function createMotor(input, config) {
    if (!input || !token(input.id) || !Number.isSafeInteger(input.version) || input.version < 1
      || !cnpj(input.cnpj) || typeof input.purchaseId !== 'string' || !/^\d{17}$/.test(input.purchaseId) || !token(input.itemId)
      || input.criterion !== 'menor_preco_unitario' || input.mode !== 'simulado' || 'groupId' in input
      || money(input.floor) === null || money(input.decrement) === null
      || !config || !token(config.source) || !Number.isSafeInteger(config.maxSnapshotAgeMs) || config.maxSnapshotAgeMs <= 0) {
      throw new TypeError('Política/configuração inválida ou modalidade não suportada');
    }
    const policy = Object.fromEntries(['id','version','cnpj','purchaseId','itemId','criterion','mode','floor','decrement'].map(k => [k, input[k]]));
    const policyKey = JSON.stringify(policy); // Comparação de conteúdo, não segredo/assinatura.
    const source = config.source; const maxAge = config.maxSnapshotAgeMs;
    const floor = money(policy.floor); const decrement = money(policy.decrement);
    let state = 'nao_autorizado'; let authorization = null; let pending = null;
    let clock = 0; let sequence = 0; let lastObservationAt = 0; let lastObservationId = null; let lastPrice = null;
    const usedAuthorizations = new Set();
    const blocked = reason => ({ status: 'bloqueado', reason, sent: false });
    function tick(now) {
      if (!time(now) || now < clock) return false;
      clock = now;
      if (state === 'ativo' && now >= authorization.expiresAt) { state = 'expirado'; authorization = null; }
      return true;
    }
    return {
      policyKey,
      authorize(auth, now) {
        if (!tick(now) || state === 'revogado' || !auth || !token(auth.id) || usedAuthorizations.has(auth.id)
          || auth.policyKey !== policyKey || !time(auth.notBefore) || !time(auth.expiresAt)
          || auth.notBefore > now || auth.expiresAt <= now || auth.expiresAt <= auth.notBefore) return { ok: false };
        authorization = { id: auth.id, expiresAt: auth.expiresAt };
        usedAuthorizations.add(auth.id); state = 'ativo'; return { ok: true };
      },
      pause() { if (state !== 'revogado') state = 'pausado'; authorization = null; },
      revoke() { state = 'revogado'; authorization = null; },
      status(now) { return tick(now) ? { state, pending: pending?.state || null } : { state: 'relogio_invalido', pending: pending?.state || null }; },
      decide(s, now) {
        if (!tick(now)) return blocked('relogio');
        if (state !== 'ativo') return blocked(state);
        if (!s || typeof s !== 'object' || s.source !== source || !token(s.observationId) || !time(s.observedAt) || s.observedAt > now || now - s.observedAt > maxAge) return blocked('snapshot');
        if (s.observedAt <= lastObservationAt || s.observationId === lastObservationId) return blocked(pending?.state || 'snapshot_repetido');
        if (!cnpj(s.cnpj) || typeof s.purchaseId !== 'string' || !/^\d{17}$/.test(s.purchaseId) || !token(s.itemId)) return blocked('contexto');
        if (['cnpj','purchaseId','itemId'].some(k => s[k] !== policy[k])) {
          state = 'pausado'; authorization = null; return blocked('contexto');
        }
        // Uma observação bloqueadora recente também torna antigas observações inadequadas.
        lastObservationAt = s.observedAt; lastObservationId = s.observationId;
        if (s.criterion !== policy.criterion || s.mode !== policy.mode || 'groupId' in s) return blocked('contexto');
        if (['expirada', 'desconectada', 'revogada'].includes(s.session)) {
          state = 'pausado'; authorization = null; return blocked('sessao_ou_item');
        }
        if (s.session !== 'ativa' || s.itemState !== 'aberto' || typeof s.leading !== 'boolean') return blocked('sessao_ou_item');
        if (pending) return blocked(pending.state);
        if (s.leading) return blocked('ja_lider');
        const best = money(s.bestPrice); const own = money(s.ownPrice);
        if (best === null || own === null) return blocked('valor');
        const candidate = best - decrement;
        if (candidate < floor) return blocked('piso');
        if (candidate >= own || (lastPrice !== null && candidate >= lastPrice)) return blocked('sem_melhoria');
        const decisionId = `${policy.id}-${policy.version}-${++sequence}`;
        pending = { decisionId, price: format(candidate), state: 'pendente' };
        return { status: 'candidata', decisionId, price: pending.price, policyKey, authorizationId: authorization.id, sent: false };
      },
      // O chamador deve obter esse resultado por fonte autenticada; este módulo não a consulta.
      resolve(result, now) {
        if (!tick(now) || !pending || !result || result.decisionId !== pending.decisionId) return { ok: false };
        if (result.outcome === 'desconhecido') { pending.state = 'incerto'; return { ok: true }; }
        if (result.outcome === 'aplicado') {
          if (result.price !== pending.price) { pending.state = 'incerto'; return { ok: false }; }
          lastPrice = money(pending.price); pending = null; return { ok: true };
        }
        if (result.outcome === 'rejeitado') { pending = null; return { ok: true }; }
        return { ok: false };
      },
    };
  }
  const api = { createMotor };
  global.LicitaMotorLances = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
