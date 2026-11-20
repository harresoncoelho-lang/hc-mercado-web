(function (global) {
  'use strict';
  // Lógica pura da casca comercial. Autorização vem só do handler real (consultar); a preferência não concede acesso.
  // Empresa ativa: mesma chave do painel e do operacao.html (só o id da empresa). A chave antiga guardava empresa + processo
  // e só é lida uma vez, para migrar quem já tinha preferência salva.
  const CHAVE_EMPRESA = 'licitaplena_empresa_operacional_id';
  const CHAVE_PREFERENCIA_ANTIGA = 'licitaplena.contextoPreferido';
  // Tema: mesma chave e valores do painel ("claro" | "escuro"), claro como padrão. A chave antiga ("light" | "dark") migra uma vez.
  const CHAVE_TEMA = 'licitaplena_tema';
  const CHAVE_TEMA_ANTIGA = 'licitaplena.tema';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

  // Hoje a partir do catálogo (contextos-operacao, lido com o token do usuário e RLS): uma requisição, sem consultar por processo.
  // Só entra processo de empresa do próprio catálogo; o acesso de fato é confirmado por consultar ao abrir.
  function contextosDoCatalogo(contextos, empresas) {
    const txt = (v) => (typeof v === 'string' ? v.trim() : '');
    const razoes = new Map((Array.isArray(empresas) ? empresas : []).filter((e) => e && typeof e.empresaId === 'string').map((e) => [e.empresaId, txt(e.razaoSocial) || 'Empresa']));
    const lista = [];
    for (const c of Array.isArray(contextos) ? contextos : []) {
      if (!c || typeof c.processoId !== 'string' || !c.processoId || !razoes.has(c.empresaId)) continue;
      if (lista.some((x) => mesmoContexto(x, c))) continue;
      const razao = razoes.get(c.empresaId);
      const numero = txt(c.numero);
      const processoRotulo = numero ? 'Processo ' + numero : 'Processo sem número';
      lista.push({ empresaId: c.empresaId, processoId: c.processoId, empresaRotulo: razao, processoRotulo, rotulo: razao + ' · ' + processoRotulo, objeto: txt(c.objeto), status: txt(c.status), prazo: txt(c.prazo) });
    }
    return lista;
  }

  // Preferido só é escolhido se já estiver entre os autorizados.
  function escolherContexto(autorizados, preferido) {
    if (!Array.isArray(autorizados) || !autorizados.length) return null;
    return autorizados.find((x) => mesmoContexto(x, preferido)) || autorizados[0];
  }

  // Devolve o id da empresa preferida (ou null). A preferência só escolhe entre empresas já autorizadas; não concede acesso.
  function lerPreferencia(storage) {
    try {
      const s = storage || global.localStorage;
      if (!s) return null;
      const atual = s.getItem(CHAVE_EMPRESA);
      if (atual) return atual;
      const bruto = s.getItem(CHAVE_PREFERENCIA_ANTIGA);
      if (bruto === null) return null;
      s.removeItem?.(CHAVE_PREFERENCIA_ANTIGA);
      let o = null;
      try { o = JSON.parse(bruto); } catch { o = null; }
      if (!o || typeof o.empresaId !== 'string' || !o.empresaId) return null;
      s.setItem(CHAVE_EMPRESA, o.empresaId);
      return o.empresaId;
    } catch { return null; }
  }

  function gravarPreferencia(contexto, storage) {
    try {
      const s = storage || global.localStorage;
      if (s && contexto && typeof contexto.empresaId === 'string' && contexto.empresaId) s.setItem(CHAVE_EMPRESA, contexto.empresaId);
    } catch { /* preferência é opcional */ }
  }

  // 'claro' | 'escuro'. Sem nada salvo, claro. A chave antiga é lida uma vez, gravada na nova e apagada.
  function lerTema(storage) {
    try {
      const s = storage || global.localStorage;
      if (!s) return 'claro';
      const atual = s.getItem(CHAVE_TEMA);
      if (atual === 'claro' || atual === 'escuro') return atual;
      const antigo = s.getItem(CHAVE_TEMA_ANTIGA);
      if (antigo === null) return 'claro';
      const tema = antigo === 'dark' ? 'escuro' : 'claro';
      s.setItem(CHAVE_TEMA, tema);
      s.removeItem?.(CHAVE_TEMA_ANTIGA);
      return tema;
    } catch { return 'claro'; }
  }

  // Link direto /sistema?empresa=<uuid>&processo=<uuid>. Só devolve o par se os dois forem uuid; não concede acesso
  // (o controlador ainda confere no catálogo e com consultar em kit-documentos).
  function lerLinkDireto(busca) {
    if (typeof busca !== 'string' || !busca) return null;
    let p = null;
    try { p = new global.URLSearchParams(busca); } catch { return null; }
    const empresaId = (p.get('empresa') || '').trim().toLowerCase();
    const processoId = (p.get('processo') || '').trim().toLowerCase();
    return UUID.test(empresaId) && UUID.test(processoId) ? { empresaId, processoId } : null;
  }

  // Textos de situação do Hoje (dias já contados pelo servidor no calendário de Brasília). Número inválido não vira texto.
  const plural = (n) => n + (n === 1 ? ' dia' : ' dias');
  function textoVencimentoCertidao(dias, data) {
    if (!Number.isInteger(dias)) return '';
    const quando = /^\d{4}-\d{2}-\d{2}$/.test(data || '') ? ' (' + data.split('-').reverse().join('/') + ')' : '';
    if (dias < 0) return 'Vencida há ' + plural(-dias) + quando;
    return (dias === 0 ? 'Vence hoje' : 'Vence em ' + plural(dias)) + quando;
  }
  function textoDiasPrazo(dias) {
    if (!Number.isInteger(dias) || dias < 0) return '';
    return dias === 0 ? 'Hoje' : dias === 1 ? 'Amanhã' : 'Em ' + plural(dias);
  }
  // Aba real de operacao.html (data-aba="documentos"); ?empresa= escolhe a empresa se ela estiver no acesso do usuário.
  function linkDocumentos(empresaId) {
    return typeof empresaId === 'string' && UUID.test(empresaId) ? 'operacao.html?aba=documentos&empresa=' + encodeURIComponent(empresaId) : null;
  }

  // Cadastro de processo: validação de campos no navegador (o servidor valida de novo e é a fonte final).
  const LIMITES_PROCESSO = { objetoMin: 3, objetoMax: 500, numeroMax: 60, orgaoMax: 200, modalidadeMax: 60 };
  // eslint-disable-next-line no-control-regex -- o objetivo é justamente recusar caracteres de controle.
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

  const api = { CHAVE_EMPRESA, CHAVE_PREFERENCIA_ANTIGA, CHAVE_TEMA, CHAVE_TEMA_ANTIGA, lerTema, lerLinkDireto, MSG_LOGIN, MSG_SEM_CONTEXTO, MSG_SESSAO_ENCERRADA, autorizarContextos, contextosDoCatalogo, escolherContexto, lerPreferencia, gravarPreferencia, validarProcessoNovo, novaTentativaId, LIMITES_PROCESSO, textoVencimentoCertidao, textoDiasPrazo, linkDocumentos };
  global.LicitaPlenaComercialCore = api;
})(globalThis);
