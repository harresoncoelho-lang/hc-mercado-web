(function (global) {
  'use strict';
  // Lógica pura da casca comercial. Autorização vem só do handler real (consultar); a preferência não concede acesso.
  const CHAVE_PREFERENCIA = 'licitaplena.contextoPreferido';
  const MSG_LOGIN = 'Não foi possível entrar. Confira os dados e tente de novo.';
  const MSG_SEM_CONTEXTO = 'Nenhuma empresa autorizada para esta conta.';
  const MSG_SESSAO_ENCERRADA = 'Sessão encerrada.';

  function mesmoContexto(a, b) {
    return Boolean(a && b && a.empresaId === b.empresaId && a.processoId === b.processoId);
  }

  // consultar(candidato) → { ok, empresa:{id,razaoSocial}, processo:{id,numero} } ; só ok com ids coincidentes entra.
  async function autorizarContextos(candidatos, consultar) {
    const autorizados = [];
    for (const candidato of Array.isArray(candidatos) ? candidatos : []) {
      let r = null;
      try { r = await consultar(candidato); } catch { r = null; }
      if (!r || r.ok !== true || !r.empresa || !r.processo) continue;
      if (r.empresa.id !== candidato.empresaId || r.processo.id !== candidato.processoId) continue;
      if (autorizados.some((x) => mesmoContexto(x, candidato))) continue;
      const razao = typeof r.empresa.razaoSocial === 'string' && r.empresa.razaoSocial.trim() ? r.empresa.razaoSocial.trim() : 'Empresa';
      const numero = typeof r.processo.numero === 'string' ? r.processo.numero : '';
      const processoRotulo = numero ? 'Processo ' + numero : 'Processo sem número';
      autorizados.push({ empresaId: candidato.empresaId, processoId: candidato.processoId, empresaRotulo: razao, processoRotulo, rotulo: razao + ' · ' + processoRotulo });
    }
    return autorizados;
  }

  // Preferido só é escolhido se já estiver entre os autorizados.
  function escolherContexto(autorizados, preferido) {
    if (!Array.isArray(autorizados) || !autorizados.length) return null;
    return autorizados.find((x) => mesmoContexto(x, preferido)) || autorizados[0];
  }

  function lerPreferencia(storage) {
    try {
      const s = storage || global.localStorage;
      const bruto = s && s.getItem(CHAVE_PREFERENCIA);
      const o = bruto ? JSON.parse(bruto) : null;
      return o && typeof o.empresaId === 'string' && typeof o.processoId === 'string' ? { empresaId: o.empresaId, processoId: o.processoId } : null;
    } catch { return null; }
  }

  function gravarPreferencia(contexto, storage) {
    try {
      const s = storage || global.localStorage;
      if (s && contexto) s.setItem(CHAVE_PREFERENCIA, JSON.stringify({ empresaId: contexto.empresaId, processoId: contexto.processoId }));
    } catch { /* preferência é opcional */ }
  }

  // Cadastro de processo: validação de campos no navegador (o servidor valida de novo e é a fonte final).
  const LIMITES_PROCESSO = { objetoMin: 3, objetoMax: 500, numeroMax: 60, orgaoMax: 200, modalidadeMax: 60 };
  const CONTROLE = /[\u0000-\u001f\u007f]/;
  function validarProcessoNovo(campos) {
    const c = campos && typeof campos === 'object' ? campos : {};
    const t = (v) => (typeof v === 'string' ? v.trim() : '');
    const dados = { objeto: t(c.objeto), numero: t(c.numero), orgao: t(c.orgao), modalidade: t(c.modalidade) };
    const erros = {};
    if (dados.objeto.length < LIMITES_PROCESSO.objetoMin) erros.objeto = 'Informe o objeto do processo (mínimo de 3 caracteres).';
    else if (dados.objeto.length > LIMITES_PROCESSO.objetoMax) erros.objeto = 'O objeto deve ter no máximo 500 caracteres.';
    if (dados.numero.length > LIMITES_PROCESSO.numeroMax) erros.numero = 'O número deve ter no máximo 60 caracteres.';
    if (dados.orgao.length > LIMITES_PROCESSO.orgaoMax) erros.orgao = 'O órgão deve ter no máximo 200 caracteres.';
    if (dados.modalidade.length > LIMITES_PROCESSO.modalidadeMax) erros.modalidade = 'A modalidade deve ter no máximo 60 caracteres.';
    for (const k of Object.keys(dados)) if (!erros[k] && CONTROLE.test(dados[k])) erros[k] = 'Use apenas texto simples, sem caracteres de controle.';
    return { ok: Object.keys(erros).length === 0, erros, dados: { objeto: dados.objeto, numero: dados.numero || null, orgao: dados.orgao || null, modalidade: dados.modalidade || null } };
  }
  // ID estável da tentativa (UUID v4): reenvio com os mesmos dados reutiliza o mesmo id.
  function novaTentativaId() {
    const c = global.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    const h = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-8' + h.slice(17, 20) + '-' + h.slice(20, 32);
  }

  const api = { CHAVE_PREFERENCIA, MSG_LOGIN, MSG_SEM_CONTEXTO, MSG_SESSAO_ENCERRADA, autorizarContextos, escolherContexto, lerPreferencia, gravarPreferencia, validarProcessoNovo, novaTentativaId, LIMITES_PROCESSO };
  global.LicitaPlenaComercialCore = api;
})(globalThis);
