/* global module */
// Tela "Robô de lances" do processo (casca comercial, sistema.html). Modo ASSISTIDO: só sugere; quem envia o
// lance é a pessoa, no portal. Sem leitura da sala por enquanto (extensao-leitura/sala-disputa.mjs não
// implementado): a tela configura por item e treina no simulador (robo-lances.js + cérebro motor-lances.js).
// Piso = preço-limite calculado em Itens do processo (custo + margem mínima); nunca vem de IA.
// shortcut: configuração e registro ficam no localStorage deste navegador (como Kanban/filtros do painel);
// se o registro precisar valer como prova entre computadores, mover para tabela com RLS no Supabase.
(function (global) {
  'use strict';
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const LIMITE_REGISTRO = 300;
  const R = () => global.LicitaRoboLances;
  const I = () => global.LicitaItensProcesso;

  // Configuração de um item → parâmetros do simulador, ou erro que diz o que fazer.
  function parametrosItem({ piso, inicial, cfg, diferencaMinima }) {
    if (piso === null || piso === undefined) return { ok: false, erro: 'Sem preço-limite: informe custo e margem mínima em Itens do processo.' };
    if (inicial === null || inicial === undefined) return { ok: false, erro: 'Sem proposta: informe o valor unitário do item.' };
    if (piso > inicial) return { ok: false, erro: 'O preço-limite passa da sua proposta: revise o valor unitário ou as margens.' };
    const d = R().decremento({ tipo: cfg.tipo, valor: cfg.valor, referencia: inicial, diferencaMinima });
    if (!d.ok) return d;
    return { ok: true, piso, inicial, decremento: d.centavos, intervalo: R().intervaloMs(cfg.intervalo), aviso: d.aviso };
  }
  // Entradas do registro que valem guardar: o que o robô sugeriu, bloqueou e o resultado.
  function entradasRegistro(log, { itemId, rotulo, modo, rodada, em }) {
    return log.filter((e) => ['sugestao', 'bloqueado', 'fim'].includes(e.tipo))
      .map((e) => ({ em, rodada, modo, itemId, rotulo, t: e.t, tipo: e.tipo, texto: e.texto }));
  }

  function montar({ alvo, contexto, requisitar = global.fetch.bind(global), storage = null }) {
    if (!alvo || !contexto || !UUID.test(contexto.empresaId || '') || !UUID.test(contexto.processoId || '')) throw new Error('Contexto do robô inválido');
    const doc = alvo.ownerDocument || global.document;
    const chave = `licitaplena_robo_${contexto.empresaId}_${contexto.processoId}`;
    const chaveRegistro = `licitaplena_robo_registro_${contexto.empresaId}_${contexto.processoId}`;
    const ler = (k, padrao) => { try { const v = JSON.parse(storage?.getItem(k) || 'null'); return v && typeof v === 'object' ? v : padrao; } catch { return padrao; } };
    const gravar = (k, v) => { try { storage?.setItem(k, JSON.stringify(v)); } catch { /* armazenamento opcional (aba privada) */ } };
    let vivo = true, itens = [], precos = new Map();
    const config = ler(chave, {});
    config.modo = R().MODOS[config.modo] ? config.modo : 'aberto';
    config.itens = config.itens && typeof config.itens === 'object' ? config.itens : {};
    config.rodada = Number.isInteger(config.rodada) ? config.rodada : 0;
    let registro = Array.isArray(ler(chaveRegistro, null)) ? ler(chaveRegistro, null) : [];
    const salvarConfig = () => gravar(chave, config);

    function h(tag, attrs = {}, ...filhos) {
      const n = doc.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'texto') n.textContent = v; else if (k === 'classe') n.className = v; else n.setAttribute(k, v === true ? '' : v);
      }
      n.append(...filhos.filter(Boolean));
      return n;
    }
    const el = (s) => alvo.querySelector(s);
    const reais = (c) => (typeof c === 'bigint' ? R().reais(c) : '—');
    const opcoesModo = Object.entries(R().MODOS).map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    alvo.innerHTML = `<h2 id="robo-titulo" tabindex="-1">Robô de lances</h2>
      <p class="robo-faixa" data-situacao="atencao"><strong>Modo assistido.</strong> O robô só sugere o próximo lance; quem envia é você, no portal. Ele nunca clica nem envia sozinho.</p>
      <p class="itens-apoio">Leitura da sala de disputa: <strong>não implementada</strong> — precisa da sala real do Compras.gov.br. Por enquanto, configure os itens e treine no simulador antes da sessão.</p>
      <fieldset class="robo-processo"><legend>Regras da disputa (do edital)</legend>
        <div class="robo-grade">
          <div class="itens-campo"><label for="robo-modo">Modo de disputa</label><select id="robo-modo" data-robo-modo>${opcoesModo}</select></div>
          <div class="itens-campo"><label for="robo-diferenca">Diferença mínima entre lances (R$)</label><input id="robo-diferenca" data-robo-diferenca inputmode="decimal" autocomplete="off" placeholder="Ex.: 0,10"></div>
          <div class="itens-campo"><label for="robo-concorrentes">Concorrentes no simulador</label><select id="robo-concorrentes" data-robo-concorrentes>${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}">${n}</option>`).join('')}</select></div>
        </div>
        <p class="itens-apoio">Intervalo mínimo usado: 20 s entre os seus lances e 3 s depois do melhor lance de outro fornecedor. O portal pode exigir mais; nunca menos.</p>
      </fieldset>
      <p data-robo-estado role="status" aria-live="polite"></p>
      <div data-robo-itens class="robo-itens"></div>
      <div class="itens-acoes"><button type="button" class="app-primario" data-robo-simular>Simular disputa</button><button type="button" data-robo-atualizar>Atualizar itens</button></div>
      <section data-robo-resultado class="robo-resultado" aria-labelledby="robo-resultado-titulo" hidden>
        <h3 id="robo-resultado-titulo" tabindex="-1">Resultado da simulação</h3>
        <p class="itens-apoio">Disputa fictícia em tempo acelerado, com concorrentes inventados. Não prevê o resultado real.</p>
        <ul data-robo-resumo class="robo-resumo"></ul>
        <details class="robo-tempo"><summary>Ver linha do tempo da disputa (inclui lances dos concorrentes)</summary><div class="tabela-rolagem" tabindex="0" role="region" aria-label="Linha do tempo da simulação"><table><thead><tr><th scope="col">Tempo</th><th scope="col">Item</th><th scope="col">Evento</th><th scope="col">Valor</th></tr></thead><tbody data-robo-linhas></tbody></table></div></details>
      </section>
      <section class="robo-registro" aria-labelledby="robo-registro-titulo">
        <h3 id="robo-registro-titulo">Registro do robô</h3>
        <p class="itens-apoio">O que o robô sugeriu ou bloqueou em cada rodada (guardado neste navegador, últimas ${LIMITE_REGISTRO} linhas).</p>
        <ul data-robo-registro class="robo-registro-lista"></ul>
        <div class="itens-acoes"><button type="button" data-robo-limpar>Limpar registro</button></div>
      </section>`;
    el('[data-robo-modo]').value = config.modo;
    el('[data-robo-diferenca]').value = config.diferenca || '';
    el('[data-robo-concorrentes]').value = String(config.concorrentes || 3);
    const estado = (t, tipo = '') => { const p = el('[data-robo-estado]'); p.textContent = t; p.dataset.situacao = tipo; };
    const diferencaMinima = () => R().centavosDe(config.diferenca);
    const cfgItem = (id) => ({ ligado: false, tipo: 'reais', valor: '', intervalo: '20', ...(config.itens[id] || {}) });
    const rotuloItem = (i) => `Item ${i.identificador || '—'}${i.descricao ? ` · ${String(i.descricao).slice(0, 80)}` : ''}`;
    const dadosItem = (i) => {
      const c = precos.get(i.id);
      return { piso: c?.limite ?? R().centavosDe(i.valorUnitarioMinimo), inicial: R().centavosDe(i.valorUnitario) ?? c?.alvo ?? null };
    };

    function renderItens() {
      const caixa = el('[data-robo-itens]');
      if (!itens.length) { caixa.replaceChildren(h('p', { classe: 'itens-apoio', texto: 'Nenhum item no processo. Cadastre os itens em Itens do processo.' })); return; }
      caixa.replaceChildren(...itens.map((i) => {
        const cfg = cfgItem(i.id), d = dadosItem(i), p = `robo-${i.id}`;
        const chec = parametrosItem({ ...d, cfg, diferencaMinima: diferencaMinima() });
        return h('article', { classe: 'robo-item', 'data-robo-item': i.id, 'data-ligado': cfg.ligado ? 'sim' : 'nao' },
          h('h4', { texto: rotuloItem(i) }),
          h('dl', { classe: 'robo-valores' },
            h('div', {}, h('dt', { texto: 'Sua proposta' }), h('dd', { texto: reais(d.inicial) })),
            h('div', {}, h('dt', { texto: 'Piso (preço-limite)' }), h('dd', { texto: reais(d.piso) }))),
          h('div', { classe: 'robo-grade' },
            h('div', { classe: 'itens-campo' }, h('label', { for: `${p}-dec`, texto: 'Decremento por lance' }),
              h('div', { classe: 'robo-junto' },
                h('input', { id: `${p}-dec`, 'data-campo': 'valor', inputmode: 'decimal', autocomplete: 'off', placeholder: cfg.tipo === 'percentual' ? 'Ex.: 0,5' : 'Ex.: 0,50', value: cfg.valor }),
                (() => { const s = h('select', { 'data-campo': 'tipo', 'aria-label': 'Unidade do decremento' }, h('option', { value: 'reais', texto: 'R$' }), h('option', { value: 'percentual', texto: '%' })); s.value = cfg.tipo; return s; })())),
            h('div', { classe: 'itens-campo' }, h('label', { for: `${p}-int`, texto: 'Intervalo entre seus lances (s)' }),
              h('input', { id: `${p}-int`, 'data-campo': 'intervalo', inputmode: 'numeric', autocomplete: 'off', placeholder: 'mín. 20', value: cfg.intervalo }))),
          h('label', { classe: 'robo-ligar' }, (() => { const c = h('input', { type: 'checkbox', 'data-campo': 'ligado' }); c.checked = cfg.ligado; return c; })(), ' Robô ligado neste item'),
          h('p', { classe: 'itens-campo-estado', 'data-situacao': chec.ok ? (chec.aviso ? 'erro' : 'ok') : (cfg.valor || cfg.ligado ? 'erro' : ''), 'aria-live': 'polite',
            texto: chec.ok ? (chec.aviso || `Pronto: baixa ${reais(chec.decremento)} por lance, até ${reais(chec.piso)}.`) : (cfg.valor || cfg.ligado || d.piso === null ? chec.erro : 'Informe o decremento.') }));
      }));
    }
    function renderRegistro() {
      const ul = el('[data-robo-registro]');
      if (!registro.length) { ul.replaceChildren(h('li', { classe: 'itens-apoio', texto: 'Nada registrado ainda.' })); return; }
      ul.replaceChildren(...registro.slice(-40).reverse().map((e) => h('li', { 'data-tipo': e.tipo },
        h('span', { classe: 'robo-quando', texto: `Rodada ${e.rodada} · ${R().MODOS[e.modo] || e.modo} · ${R().relogio(e.t)}` }),
        h('span', { texto: ` ${e.rotulo}: ${e.texto}` }))));
    }

    async function chamar(corpo) {
      try {
        const r = await requisitar('/api/kit-documentos', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
          body: JSON.stringify({ empresaId: contexto.empresaId, processoId: contexto.processoId, ...corpo }) });
        return { r, j: await r.json().catch(() => null) };
      } catch { return { r: null, j: null }; }
    }
    async function carregar() {
      estado('Carregando itens…', 'carregando');
      const todos = []; let depois = null;
      for (let n = 0; n < 11; n++) {
        const { r, j } = await chamar({ acao: 'listarItens', ...(depois ? { afterId: depois } : {}) });
        if (!vivo) return;
        // Resposta de outro processo é descartada (mesma regra de Itens do processo).
        if (!r || !r.ok || !j || j.empresa?.id !== contexto.empresaId || j.processo?.id !== contexto.processoId) { estado(j?.erro || 'Não foi possível carregar os itens. Use Atualizar itens.', 'erro'); return; }
        todos.push(...(j.itens || []));
        if (j.paginacaoItens?.hasMore !== true) break;
        depois = j.paginacaoItens.nextCursor;
      }
      const { r, j } = await chamar({ acao: 'lerPremissas' });
      if (!vivo) return;
      itens = todos;
      precos = I()?.calcularPrecos ? I().calcularPrecos(itens, r && r.ok ? j?.premissas : {}) : new Map();
      renderItens(); estado(itens.length ? '' : 'Sem itens neste processo.');
    }

    function simular() {
      const modo = config.modo, dif = diferencaMinima(), qtd = Number(config.concorrentes || 3);
      const ligados = itens.filter((i) => cfgItem(i.id).ligado);
      if (!ligados.length) { estado('Ligue o robô em pelo menos um item.', 'erro'); return; }
      config.rodada += 1; salvarConfig();
      const em = new Date().toISOString(), resumo = [], linhas = [];
      for (const i of ligados) {
        const par = parametrosItem({ ...dadosItem(i), cfg: cfgItem(i.id), diferencaMinima: dif });
        const rotulo = rotuloItem(i);
        if (!par.ok) { resumo.push(h('li', { 'data-situacao': 'erro', texto: `${rotulo}: ${par.erro}` })); continue; }
        // Semente = rodada + posição do item: a mesma rodada se repete igual, a próxima muda os concorrentes.
        const semente = config.rodada * 1000 + itens.indexOf(i) + 1;
        const concorrentes = R().gerarConcorrentes({ semente, quantidade: qtd, referencia: par.inicial, piso: par.piso });
        const { log, resultado } = R().simular({ itemId: i.id, modo, piso: par.piso, inicial: par.inicial, decremento: par.decremento, intervalo: par.intervalo, diferencaMinima: dif, concorrentes, semente });
        resumo.push(h('li', { 'data-situacao': resultado.voceVenceu ? 'ok' : 'atencao' },
          h('strong', { texto: `${rotulo}: ` }),
          h('span', { texto: resultado.voceVenceu ? `você ficou em 1º com ${reais(resultado.seu)}` : `você ficou em ${resultado.posicao}º com ${reais(resultado.seu)}; melhor ${reais(resultado.melhor)}` }),
          h('span', { classe: 'itens-apoio', texto: ` · ${resultado.sugestoes} sugestões · ${resultado.prorrogacoes} prorrogações · ${R().relogio(resultado.fimMs)} de disputa` })));
        for (const e of log) linhas.push(h('tr', { 'data-tipo': e.tipo }, h('td', { texto: R().relogio(e.t) }), h('td', { texto: i.identificador || '—' }), h('td', { texto: e.texto }), h('td', { texto: e.valor === null ? '' : reais(e.valor) })));
        registro = registro.concat(entradasRegistro(log, { itemId: i.id, rotulo, modo, rodada: config.rodada, em })).slice(-LIMITE_REGISTRO);
      }
      gravar(chaveRegistro, registro);
      el('[data-robo-resumo]').replaceChildren(...resumo);
      el('[data-robo-linhas]').replaceChildren(...linhas);
      el('[data-robo-resultado]').hidden = false;
      renderRegistro();
      estado(`Rodada ${config.rodada} simulada (${R().MODOS[modo]}).`, 'ok');
      el('#robo-resultado-titulo').focus?.();
    }

    alvo.addEventListener('change', (ev) => {
      const t = ev.target;
      if (t.dataset.roboModo !== undefined) config.modo = R().MODOS[t.value] ? t.value : 'aberto';
      else if (t.dataset.roboDiferenca !== undefined) { config.diferenca = t.value.trim(); renderItens(); }
      else if (t.dataset.roboConcorrentes !== undefined) config.concorrentes = Number(t.value);
      else if (t.dataset.campo) {
        const id = t.closest('[data-robo-item]')?.dataset.roboItem;
        if (!id) return;
        const cfg = cfgItem(id);
        cfg[t.dataset.campo] = t.type === 'checkbox' ? t.checked : t.value.trim().slice(0, 20);
        config.itens[id] = cfg;
        renderItens();
        doc.getElementById(t.id)?.focus?.();
      } else return;
      salvarConfig();
    });
    alvo.addEventListener('click', (ev) => {
      const b = ev.target.closest?.('button');
      if (!b) return;
      if (b.dataset.roboSimular !== undefined) simular();
      else if (b.dataset.roboAtualizar !== undefined) void carregar();
      else if (b.dataset.roboLimpar !== undefined) { registro = []; gravar(chaveRegistro, registro); renderRegistro(); }
    });
    renderRegistro();
    void carregar();
    return { fechar() { vivo = false; alvo.replaceChildren(); } };
  }

  const api = { montar, parametrosItem, entradasRegistro };
  global.LicitaRoboLancesUI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
