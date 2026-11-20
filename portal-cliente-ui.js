/* global module, URL */
// Cartão "Portal do cliente" do processo aberto no sistema CRM. Contrato: netlify/functions/portal-cliente-links.js
// (acao criar | listar | revogar, com o Bearer do usuário). O link do cliente volta uma única vez em "criar":
// fica só na tela, nunca em storage. Texto do servidor sempre por textContent; link externo só https:.
(function (global) {
  'use strict';
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const DIAS = [7, 15, 30, 60];
  const EVENTOS = { link_criado: 'Link criado', link_revogado: 'Link revogado', acesso: 'Acesso do cliente', resposta: 'Resposta enviada', negado: 'Tentativa negada', limite: 'Limite atingido' };
  const MSG = {
    carregando: 'Carregando links e respostas…',
    indisponivel: 'Portal do cliente ainda não está disponível',
    semPapel: 'Seu papel não permite gerar links',
    limite: 'Este processo já tem 5 links ativos. Revogue um antes.',
    invalido: 'Confira o nome do contato (2 a 120 caracteres) e a validade.',
    falha: 'Não foi possível concluir agora. Use Atualizar para tentar de novo.',
    contato: 'Digite o nome do contato, com 2 a 120 caracteres.',
    linkInseguro: 'O servidor devolveu um link fora do padrão seguro (https). Nada foi exibido; gere outro.',
    copiado: 'Link copiado. Cole na conversa com o cliente.',
    selecionado: 'Não deu para copiar sozinho. O link está selecionado: use Ctrl+C (ou segure e copie no celular).',
    revogarConfirma: 'Revogar este link? O cliente deixa de abrir a proposta por ele.',
    revogado: 'Link revogado.',
  };
  // Mesmos campos de portal_visto_item (supabase/operacao_portal_cliente.sql), com o nome usado no item do controlador.
  const CAMPOS_VISTO = [['identificador', 'identificador'], ['descricao', 'descricao'], ['quantidade', 'quantidade', true], ['unidade', 'unidade'],
    ['valor_unitario_proposta', 'valorUnitario', true], ['marca', 'marca'], ['modelo', 'modelo'], ['fabricante', 'fabricante'], ['valor_unitario_minimo', 'valorUnitarioMinimo', true]];

  const quando = (v, soDia) => {
    const d = new Date(v);
    if (!v || Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', soDia ? { dateStyle: 'short', timeZone: 'America/Sao_Paulo' } : { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
  };

  function situacaoLink(l, agora = Date.now()) {
    if (l?.revogado_em) return 'Revogado';
    return Date.parse(l?.expira_em) > agora ? 'Ativo' : 'Expirado';
  }

  function linkSeguro(v) {
    // http só em 127.0.0.1/localhost: o ambiente de teste local (PORTAL_ORIGEM_LINK em portal-cliente-links.js).
    try { const u = typeof v === 'string' ? new URL(v) : null; return u && (u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname))) ? v : null; } catch { return null; }
  }

  function mensagemCliente({ contato, numero, link, expiraEm }) {
    return `Olá, ${contato}! Confira e aprove os itens da proposta${numero ? ` do processo ${numero}` : ''}: ${link} (válido até ${quando(expiraEm, true)})`;
  }
  const urlWhatsApp = (d) => 'https://wa.me/?text=' + encodeURIComponent(mensagemCliente(d));
  const urlEmail = (d) => 'mailto:?subject=' + encodeURIComponent(`Proposta${d.numero ? ` do processo ${d.numero}` : ''} para sua aprovação`)
    + '&body=' + encodeURIComponent(mensagemCliente(d));

  // true = algum campo que o cliente viu difere do item atual; null = item atual desconhecido (não dá para dizer).
  function valoresMudaram(visto, item) {
    if (!item || !visto || typeof visto !== 'object') return null;
    return CAMPOS_VISTO.some(([k, campo, numerico]) => {
      if (!(k in visto)) return false; // mínimo só entra no visto quando o link mostra o mínimo
      const a = visto[k] ?? null, b = item[campo] ?? null;
      if (a === null || b === null) return a !== b;
      return numerico ? Number(a) !== Number(b) : String(a) !== String(b);
    });
  }

  // Última decisão por item (aceites só crescem), itens atuais primeiro; item respondido que não está na lista vai ao fim.
  function respostasPorItem(itens, aceites) {
    const ultima = new Map();
    const ordem = (Array.isArray(aceites) ? aceites : []).slice().sort((x, y) => (Date.parse(y.criado_em) || 0) - (Date.parse(x.criado_em) || 0));
    for (const a of ordem) if (a && !ultima.has(a.item_id)) ultima.set(a.item_id, a);
    const lista = Array.isArray(itens) ? itens : [];
    const linhas = lista.map((item) => ({ itemId: item.id, item, aceite: ultima.get(item.id) || null }));
    const ids = new Set(lista.map((i) => i.id));
    for (const [itemId, aceite] of ultima) if (!ids.has(itemId)) linhas.push({ itemId, item: null, aceite });
    return linhas.map((l) => ({ ...l, mudou: l.aceite ? valoresMudaram(l.aceite.visto, l.item) === true : false }));
  }

  function resumoAceites(linhas) {
    const n = { aprovado: 0, recusado: 0, sem: 0 };
    for (const l of linhas) n[l.aceite?.decisao === 'aprovado' ? 'aprovado' : l.aceite?.decisao === 'recusado' ? 'recusado' : 'sem'] += 1;
    const p = (q, um, varios) => `${q} ${q === 1 ? um : varios}`;
    return { ...n, texto: `${p(n.aprovado, 'aprovado', 'aprovados')} · ${p(n.recusado, 'recusado', 'recusados')} · ${n.sem} sem resposta` };
  }

  function historico(auditoria, links) {
    const contato = new Map((Array.isArray(links) ? links : []).map((l) => [l.id, l.rotulo]));
    return (Array.isArray(auditoria) ? auditoria : []).slice().sort((x, y) => (Date.parse(y.criado_em) || 0) - (Date.parse(x.criado_em) || 0))
      .map((e) => ({ quando: quando(e.criado_em), rotulo: EVENTOS[e.evento] || 'Outro evento', contato: contato.get(e.link_id) || '' }));
  }

  // 503 = portal desligado ou banco sem o SQL do portal: o cartão some com as ações.
  function estadoErro(status) {
    if (status === 503) return { texto: MSG.indisponivel, esconderAcoes: true };
    if (status === 403) return { texto: MSG.semPapel, esconderGerar: true };
    if (status === 409) return { texto: MSG.limite };
    if (status === 400) return { texto: MSG.invalido };
    return { texto: MSG.falha };
  }

  function validarContato(v) {
    const t = typeof v === 'string' ? v.trim() : '';
    return t.length >= 2 && t.length <= 120 ? t : null;
  }

  function montar({ alvo, contexto, itens = [], requisitar = global.fetch?.bind(global), confirmar = (m) => global.confirm(m), agora = () => Date.now() }) {
    if (!alvo || !contexto || !UUID.test(contexto.empresaId || '') || !UUID.test(contexto.processoId || '')) throw new Error('Contexto do portal inválido');
    let vivo = true, ocupado = false, geracao = 0, dados = { links: [], aceites: [], auditoria: [] };
    const doc = alvo.ownerDocument || global.document;
    alvo.innerHTML = `<h2 id="portal-titulo">Portal do cliente</h2>
      <p data-portal-estado class="portal-estado" role="status" aria-live="polite"></p>
      <div data-portal-corpo>
        <p data-portal-resumo class="portal-resumo"></p>
        <div data-portal-acoes>
          <div class="itens-acoes"><button type="button" class="app-primario" data-portal-abrir aria-expanded="false" aria-controls="portal-form">Gerar link para o cliente</button></div>
          <form id="portal-form" class="portal-form" data-portal-form hidden novalidate>
            <label for="portal-contato">Nome do contato</label>
            <input id="portal-contato" name="contato" maxlength="120" autocomplete="off" aria-describedby="portal-contato-erro" placeholder="Ex.: Maria, do setor de compras">
            <p id="portal-contato-erro" class="portal-erro" role="alert"></p>
            <label for="portal-dias">Validade do link</label>
            <select id="portal-dias" name="dias">${DIAS.map((d) => `<option value="${d}"${d === 15 ? ' selected' : ''}>${d} dias</option>`).join('')}</select>
            <div class="portal-check"><input type="checkbox" id="portal-minimo" name="minimo" checked><label for="portal-minimo">Mostrar preço mínimo ao cliente</label></div>
            <p class="portal-aviso">O link aparece só uma vez. Copie e envie agora.</p>
            <div class="itens-acoes"><button type="submit" class="app-primario" data-portal-gerar>Gerar link</button><button type="button" data-portal-cancelar>Cancelar</button></div>
          </form>
          <section data-portal-novo class="portal-novo" hidden aria-labelledby="portal-novo-titulo">
            <h3 id="portal-novo-titulo" tabindex="-1">Link pronto para enviar</h3>
            <label for="portal-link">Link do cliente (aparece só agora)</label>
            <input id="portal-link" data-portal-link readonly>
            <div class="itens-acoes">
              <button type="button" class="app-primario" data-portal-copiar>Copiar</button>
              <a class="portal-botao" data-portal-whats target="_blank" rel="noopener noreferrer">Enviar por WhatsApp</a>
              <a class="portal-botao" data-portal-email>Enviar por e-mail</a>
            </div>
            <p data-portal-copia class="portal-apoio" role="status" aria-live="polite"></p>
          </section>
        </div>
        <section class="portal-bloco" aria-labelledby="portal-respostas-titulo">
          <h3 id="portal-respostas-titulo">Respostas do cliente por item</h3>
          <ul data-portal-respostas class="portal-respostas"></ul>
        </section>
        <section class="portal-bloco" aria-labelledby="portal-links-titulo">
          <h3 id="portal-links-titulo">Links gerados</h3>
          <p data-portal-links-vazio class="portal-apoio"></p>
          <div class="tabela-rolagem" data-portal-tabela tabindex="0" role="region" aria-label="Links gerados para o cliente"><table><thead><tr><th scope="col">Contato</th><th scope="col">Criado em</th><th scope="col">Expira em</th><th scope="col">Último acesso</th><th scope="col">Situação</th><th scope="col">Ação</th></tr></thead><tbody data-portal-links></tbody></table></div>
        </section>
        <details class="portal-bloco portal-historico"><summary>Histórico</summary><ol data-portal-eventos></ol></details>
      </div>
      <div class="itens-acoes"><button type="button" data-portal-atualizar>Atualizar</button></div>`;
    const el = (s) => alvo.querySelector(s);
    const form = el('[data-portal-form]');
    function h(tag, classe, texto) { const e = doc.createElement(tag); if (classe) e.className = classe; if (texto !== undefined) e.textContent = texto; return e; }
    function estado(t, tipo) { el('[data-portal-estado]').textContent = t || ''; el('[data-portal-estado]').dataset.situacao = tipo || ''; }
    function bloquear(v) { ocupado = v; for (const b of alvo.querySelectorAll('button')) b.disabled = v; }
    async function chamar(corpo) {
      try {
        const r = await requisitar('/api/portal-cliente-links', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(corpo) });
        return { r, j: await r.json().catch(() => null) };
      } catch { return { r: null, j: null }; }
    }
    function aplicarErro(status) {
      const e = estadoErro(status);
      estado(e.texto, e.esconderAcoes ? 'vazio' : 'erro');
      if (e.esconderAcoes) el('[data-portal-corpo]').hidden = true;
      if (e.esconderGerar) { el('[data-portal-abrir]').hidden = true; form.hidden = true; }
    }

    function selo(texto, situacao) { const s = h('span', 'portal-selo', texto); s.dataset.situacao = situacao; return s; }
    function render() {
      const linhas = respostasPorItem(itens, dados.aceites);
      const rotulos = new Map(dados.links.map((l) => [l.id, l.rotulo]));
      el('[data-portal-resumo]').textContent = linhas.length ? resumoAceites(linhas).texto : 'Nenhum item cadastrado ainda.';
      el('[data-portal-respostas]').replaceChildren(...linhas.map((l) => {
        const li = h('li');
        const nome = l.item ? `Item ${l.item.identificador || ''} · ${l.item.descricao || ''}` : `Item ${l.aceite.visto?.identificador || ''} · ${l.aceite.visto?.descricao || ''}`;
        const dec = l.aceite?.decisao;
        const cab = h('div', 'portal-cabeca');
        cab.append(selo(dec === 'aprovado' ? 'Aprovado' : dec === 'recusado' ? 'Recusado' : 'Sem resposta', dec || 'sem'), h('strong', '', nome));
        li.append(cab);
        if (l.aceite) {
          if (l.aceite.observacao) li.append(h('p', '', `Observação: ${l.aceite.observacao}`));
          li.append(h('p', 'portal-apoio', `${quando(l.aceite.criado_em)} · link de ${rotulos.get(l.aceite.link_id) || 'contato não listado'}`));
          if (l.mudou) li.append(selo('Valores mudaram depois da resposta', 'mudou'));
        }
        return li;
      }));
      const t = agora();
      el('[data-portal-links-vazio]').textContent = dados.links.length ? '' : 'Nenhum link gerado ainda.';
      el('[data-portal-tabela]').hidden = !dados.links.length;
      el('[data-portal-links]').replaceChildren(...dados.links.map((l) => {
        const tr = h('tr'), sit = situacaoLink(l, t);
        tr.append(h('td', '', l.rotulo || '—'), h('td', '', quando(l.criado_em)), h('td', '', quando(l.expira_em)), h('td', '', l.ultimo_acesso_em ? quando(l.ultimo_acesso_em) : 'Nunca abriu'));
        const tdSit = h('td'); tdSit.append(selo(sit, sit.toLowerCase())); tr.append(tdSit);
        const tdAcao = h('td');
        if (sit === 'Ativo') { const b = h('button', '', 'Revogar'); b.type = 'button'; b.dataset.portalRevogar = l.id; b.setAttribute('aria-label', `Revogar link de ${l.rotulo || 'contato'}`); tdAcao.append(b); }
        tr.append(tdAcao);
        return tr;
      }));
      const ev = historico(dados.auditoria, dados.links);
      el('.portal-historico summary').textContent = `Histórico (${ev.length})`;
      el('[data-portal-eventos]').replaceChildren(...ev.map((e) => h('li', '', `${e.quando} · ${e.rotulo}${e.contato ? ` · ${e.contato}` : ''}`)));
    }

    async function carregar(final = '') {
      const g = ++geracao; bloquear(true); estado(MSG.carregando, 'carregando');
      const { r, j } = await chamar({ acao: 'listar', processoId: contexto.processoId });
      if (!vivo || g !== geracao) return;
      bloquear(false);
      if (!r || !r.ok || !j) return aplicarErro(r ? r.status : 0);
      el('[data-portal-corpo]').hidden = false;
      dados = { links: Array.isArray(j.links) ? j.links : [], aceites: Array.isArray(j.aceites) ? j.aceites : [], auditoria: Array.isArray(j.auditoria) ? j.auditoria : [] };
      render();
      estado(final, final ? 'ok' : '');
    }

    async function gerar() {
      const contato = validarContato(form.elements.contato.value);
      const erro = el('#portal-contato-erro');
      if (!contato) { erro.textContent = MSG.contato; form.elements.contato.setAttribute('aria-invalid', 'true'); form.elements.contato.focus(); return; }
      erro.textContent = ''; form.elements.contato.removeAttribute('aria-invalid');
      const dias = Number(form.elements.dias.value);
      bloquear(true); estado('Gerando link…', 'carregando');
      const { r, j } = await chamar({ acao: 'criar', empresaId: contexto.empresaId, processoId: contexto.processoId, rotulo: contato, dias: DIAS.includes(dias) ? dias : 15, mostrarMinimo: form.elements.minimo.checked });
      if (!vivo) return;
      bloquear(false);
      if (!r || !r.ok || !j) return aplicarErro(r ? r.status : 0);
      const link = linkSeguro(j.link);
      if (!link) { estado(MSG.linkInseguro, 'erro'); return; }
      const d = { contato, numero: contexto.numero || '', link, expiraEm: j.expiraEm };
      el('[data-portal-link]').value = link;
      el('[data-portal-whats]').href = urlWhatsApp(d);
      el('[data-portal-email]').href = urlEmail(d);
      el('[data-portal-copia]').textContent = '';
      form.reset(); form.hidden = true; el('[data-portal-abrir]').setAttribute('aria-expanded', 'false');
      el('[data-portal-novo]').hidden = false;
      el('#portal-novo-titulo').focus();
      await carregar(`Link criado para ${contato}. Copie e envie agora: ele não aparece de novo.`);
    }

    async function copiar() {
      const campo = el('[data-portal-link]');
      try { await global.navigator.clipboard.writeText(campo.value); el('[data-portal-copia]').textContent = MSG.copiado; } catch { campo.focus(); campo.select(); el('[data-portal-copia]').textContent = MSG.selecionado; }
    }

    async function revogar(id) {
      let ok = false;
      try { ok = confirmar(MSG.revogarConfirma) === true; } catch { ok = false; }
      if (!ok) return;
      bloquear(true); estado('Revogando…', 'carregando');
      const { r, j } = await chamar({ acao: 'revogar', linkId: id });
      if (!vivo) return;
      bloquear(false);
      if (!r || !r.ok || !j) return aplicarErro(r ? r.status : 0);
      await carregar(MSG.revogado);
    }

    alvo.addEventListener('click', (ev) => {
      const b = ev.target?.closest?.('button');
      if (!b || ocupado) return;
      if (b.matches('[data-portal-abrir]')) {
        // 5 ativos: já avisa aqui, sem abrir o formulário (o servidor confirmaria com 409).
        if (dados.links.filter((l) => situacaoLink(l, agora()) === 'Ativo').length >= 5) { estado(MSG.limite, 'erro'); return; }
        form.hidden = !form.hidden; b.setAttribute('aria-expanded', String(!form.hidden));
        if (!form.hidden) form.elements.contato.focus();
      } else if (b.matches('[data-portal-cancelar]')) { form.reset(); form.hidden = true; el('[data-portal-abrir]').setAttribute('aria-expanded', 'false'); el('#portal-contato-erro').textContent = ''; }
      else if (b.matches('[data-portal-copiar]')) void copiar();
      else if (b.matches('[data-portal-atualizar]')) void carregar();
      else if (b.dataset.portalRevogar) void revogar(b.dataset.portalRevogar);
    });
    form.addEventListener('submit', (ev) => { ev.preventDefault(); if (!ocupado) void gerar(); });
    form.elements.contato.addEventListener('input', () => {
      if (form.elements.contato.getAttribute('aria-invalid') && validarContato(form.elements.contato.value)) { form.elements.contato.removeAttribute('aria-invalid'); el('#portal-contato-erro').textContent = ''; }
    });
    void carregar();

    return {
      fechar() { vivo = false; geracao += 1; alvo.replaceChildren(); },
      // Link gerado e ainda na tela: trocar de processo o perde para sempre (o banco só tem o hash).
      temAlteracoesNaoSalvas: () => vivo && (!el('[data-portal-novo]').hidden || form.elements.contato.value.trim() !== ''),
    };
  }

  const api = { montar, situacaoLink, linkSeguro, mensagemCliente, urlWhatsApp, urlEmail, valoresMudaram, respostasPorItem, resumoAceites, historico, estadoErro, validarContato, EVENTOS, MSG };
  global.LicitaPortalCliente = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
