/* global module */
(function (global) {
  'use strict';
  // Sanções de empresas (CEIS/CNEP da CGU, tabela sancoes_empresas). Regra pura + selo reutilizável.
  // Usado no servidor (contextos-operacao, sancoes-cnpj) e no navegador (Hoje, futura tela por CNPJ,
  // "Licitação anterior" para participantes punidos). Tudo por textContent, nunca HTML.

  // Linha da tabela -> vigente? Fora da lista da CGU conta como encerrada (revogada ou cumprida).
  // Início no futuro conta como vigente: a empresa já está publicada como sancionada.
  function vigente(s, hoje) {
    return !s.fora_da_lista && (!s.data_fim || s.data_fim >= hoje);
  }

  // lista: linhas de sancoes_empresas; cnpj com ou sem máscara; hoje 'AAAA-MM-DD' (dia de Brasília).
  // -> { vigentes, expiradas }, vigentes pelo fim mais distante primeiro (sem fim = indeterminado, no topo).
  function sancoesDoCnpj(lista, cnpj, hoje) {
    const alvo = String(cnpj || '').replace(/\D/g, '');
    const vigentes = [], expiradas = [];
    if (alvo.length !== 14 || !/^\d{4}-\d{2}-\d{2}$/.test(String(hoje))) return { vigentes, expiradas };
    for (const s of Array.isArray(lista) ? lista : []) {
      if (!s || s.cnpj !== alvo) continue;
      (vigente(s, hoje) ? vigentes : expiradas).push(s);
    }
    const fim = (s) => s.data_fim || '9999-12-31';
    const porFim = (a, b) => fim(b).localeCompare(fim(a));
    vigentes.sort(porFim);
    expiradas.sort(porFim);
    return { vigentes, expiradas };
  }

  const dataBr = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '');

  // Frase do selo. CEIS (inidoneidade, suspensão, impedimento) impede contratar; CNEP diz o tipo (multa etc.).
  function textoSancao(s, hoje) {
    const cadastro = s.cadastro === 'CNEP' ? 'CNEP' : 'CEIS';
    if (!vigente(s, hoje)) {
      return s.fora_da_lista ? `Sanção encerrada (${cadastro}) — fora da lista da CGU` : `Sanção encerrada (${cadastro}) em ${dataBr(s.data_fim)}`;
    }
    const prazo = s.data_fim ? `até ${dataBr(s.data_fim)}` : 'por prazo indeterminado';
    if (cadastro === 'CEIS') return `Empresa com sanção vigente (CEIS) — impedida de contratar ${prazo}`;
    const tipo = typeof s.tipo_sancao === 'string' && s.tipo_sancao.trim() ? s.tipo_sancao.trim().slice(0, 120) : 'sanção';
    return `Empresa com sanção vigente (CNEP) — ${tipo} ${s.data_fim ? prazo : '(sem data de fim)'}`;
  }

  // Detalhe curto: órgão, UF, processo e início. Sem fundamentação (texto longo; fica na tela de detalhe).
  function detalheSancao(s) {
    return [s.tipo_sancao, s.orgao_sancionador && s.orgao_sancionador + (s.uf_orgao ? '/' + s.uf_orgao : ''),
      s.numero_processo && 'Processo ' + s.numero_processo, s.data_inicio && 'desde ' + dataBr(s.data_inicio)]
      .filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 200)).join(' · ');
  }

  // Selo para qualquer tela: { vigentes, expiradas } -> <div class="sancao-selo"> ou null se não houver nada.
  // Vigente: role="alert" (aviso de risco); só expiradas: selo neutro informativo.
  function montarSelo(doc, resultado, hoje) {
    const vig = resultado?.vigentes || [], exp = resultado?.expiradas || [];
    if (!vig.length && !exp.length) return null;
    const caixa = doc.createElement('div');
    caixa.className = 'sancao-selo';
    caixa.dataset.situacao = vig.length ? 'vigente' : 'expirada';
    caixa.setAttribute('role', vig.length ? 'alert' : 'status');
    const titulo = doc.createElement('p');
    titulo.className = 'sancao-selo-titulo';
    titulo.textContent = vig.length ? textoSancao(vig[0], hoje) : `Sem sanção vigente — ${exp.length} sanção(ões) encerrada(s) no CEIS/CNEP`;
    caixa.append(titulo);
    const ul = doc.createElement('ul');
    for (const s of [...vig, ...exp].slice(0, 5)) {
      const li = doc.createElement('li');
      li.textContent = (vig.includes(s) ? '' : textoSancao(s, hoje) + ' · ') + detalheSancao(s);
      ul.append(li);
    }
    caixa.append(ul);
    if (vig.length + exp.length > 5) {
      const mais = doc.createElement('p');
      mais.className = 'sancao-selo-mais';
      mais.textContent = `e mais ${vig.length + exp.length - 5}.`;
      caixa.append(mais);
    }
    return caixa;
  }

  const api = { sancoesDoCnpj, textoSancao, detalheSancao, montarSelo, dataBr };
  global.LicitaSancoes = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
