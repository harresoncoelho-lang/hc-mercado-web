/* global module */
// Cadastro e edição de itens do processo, na casca comercial. Regras espelham o servidor (_itens_processo.js)
// só para feedback imediato; a validação real e a gravação ficam no servidor, com o token do usuário.
// Escopo fixo: empresa e processo do contexto montado. Resposta de outro cadastro é descartada.
(function (global) {
  'use strict';
  const LIMITE = 999999999999999n; // mesmo limite de escala do kit (decimal() em _kit_documentos.js)
  // eslint-disable-next-line no-control-regex -- remove caracteres de controle de texto digitado
  const CONTROLE = /[\u0000-\u001f\u007f]/;
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const MSG = {
    carregando: 'Carregando itens…',
    erroCarregar: 'Não foi possível carregar os itens. Use Atualizar itens para tentar de novo.',
    salvo: 'Item salvo. Para incluí-lo na proposta, use Atualizar lista na área de proposta.',
    editando: 'Ao salvar, uma revisão já confirmada desta proposta deixa de valer. Prepare e confirme de novo antes de exportar.',
    divergente: 'Resposta de outro cadastro descartada. Recarregue a página.',
    conexao: 'Não foi possível salvar agora. Tente de novo; o mesmo cadastro não será duplicado.',
    numeroImportar: 'Informe o número do item no edital (só números, de 1 a 1000000). Ex.: 3',
    importando: 'Importando item do PNCP…',
    importado: 'Item importado do PNCP. Informe sua oferta (valor unitário) editando o item.',
    inalterado: 'Este item já estava importado e não mudou no PNCP. Nada foi alterado.',
    desligada: 'A importação de itens do PNCP ainda não está ligada. Cadastre o item pelo formulário acima.',
    erroImportar: 'Não foi possível importar o item. Tente de novo em instantes.',
  };
  // Mesmo texto que o handler importar-item-pncp devolve quando IMPORTACAO_PNCP_LOCAL não está ligada (503).
  const ERRO_DESLIGADA = 'Importação rastreável ainda não habilitada.';

  // Número do item no edital, mesmo limite do handler (inteiro de 1 a 1000000). Inválido: null.
  function numeroItemImportacao(textoDigitado) {
    const t = typeof textoDigitado === 'string' ? textoDigitado.trim() : '';
    if (!/^[1-9][0-9]{0,6}$/.test(t)) return null;
    const n = Number(t);
    return n <= 1000000 ? n : null;
  }
  // Resposta de /api/importar-item-pncp → { ok, texto }. Mensagem do servidor só como texto curto.
  function respostaImportacao(status, j) {
    const msg = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : '');
    if (status === 200 && j && typeof j.itemId === 'string') {
      if (j.estado === 'inalterado') return { ok: true, texto: MSG.inalterado };
      return { ok: true, texto: msg(j.mensagem) || MSG.importado };
    }
    if (status === 503 && j?.erro === ERRO_DESLIGADA) return { ok: false, texto: MSG.desligada };
    return { ok: false, texto: msg(j?.erro) || MSG.erroImportar };
  }

  // Decimal canônico, positivo e dentro do limite. Retorna BigInt escalado ou null.
  function decimalPositivo(texto, escala) {
    if (typeof texto !== 'string' || !new RegExp(`^(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,${escala}})?$`).test(texto)) return null;
    const [inteiro, fracao = ''] = texto.split('.');
    const n = BigInt(inteiro + fracao.padEnd(escala, '0'));
    return n > 0n && n <= LIMITE ? n : null;
  }
  // Mesma regra do servidor: (quantidade × valor) em 1e-5, arredondado meio-para-cima para centavos.
  function totalCentavos(quantidade, valor) {
    const q = decimalPositivo(quantidade, 3), v = decimalPositivo(valor, 2);
    if (q === null || v === null) return null;
    const total = (q * v + 500n) / 1000n;
    return total > LIMITE ? null : total;
  }
  function reais(centavos) {
    return `R$ ${centavos / 100n},${String(centavos % 100n).padStart(2, '0')}`;
  }
  function texto(valor, max) {
    if (typeof valor !== 'string' || valor.length > max || CONTROLE.test(valor)) return null;
    return valor.trim();
  }
  // Retorna {ok, erros, dados}. Campos opcionais vazios viram null.
  function validarItemCampos(c) {
    const erros = {};
    const identificador = texto(c.identificador, 180);
    if (!identificador) erros.identificador = 'Informe o identificador do item (até 180 caracteres, sem caracteres de controle).';
    const descricao = texto(c.descricao, 10000);
    if (!descricao) erros.descricao = 'Informe a descrição do item.';
    const marca = texto(c.marca || '', 500), modelo = texto(c.modelo || '', 500);
    if (marca === null) erros.marca = 'Confira a marca (até 500 caracteres).';
    if (modelo === null) erros.modelo = 'Confira o modelo (até 500 caracteres).';
    if (decimalPositivo(c.quantidade, 3) === null) erros.quantidade = 'Quantidade: número positivo com até 3 casas decimais, dentro do limite. Ex.: 2.500';
    if (decimalPositivo(c.valorUnitario, 2) === null) erros.valorUnitario = 'Valor unitário: número positivo com até 2 casas decimais, dentro do limite. Ex.: 1.10';
    if (!erros.quantidade && !erros.valorUnitario && totalCentavos(c.quantidade, c.valorUnitario) === null) erros.total = 'O total do item excede o limite. Confira quantidade e valor unitário.';
    const ok = Object.keys(erros).length === 0;
    return { ok, erros, dados: ok ? { identificador, descricao, marca: marca || null, modelo: modelo || null, quantidade: c.quantidade, valorUnitario: c.valorUnitario } : null };
  }
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

  function montar({ alvo, contexto, requisitar = global.fetch.bind(global), aoSalvar = null }) {
    if (!alvo || !contexto || !UUID.test(contexto.empresaId || '') || !UUID.test(contexto.processoId || '')) throw new Error('Contexto de itens inválido');
    let vivo = true, ocupado = false, edicao = null, tentativa = null, itens = [], cursor = null, maisItens = false, geracao = 0;
    alvo.innerHTML = `<h2 id="itens-titulo" tabindex="-1">Itens do processo</h2>
      <p data-item-estado role="status" aria-live="polite"></p>
      <form data-item-form novalidate>
        <label>Identificador do item <input name="identificador" maxlength="180" autocomplete="off"></label>
        <label>Descrição <textarea name="descricao" maxlength="10000"></textarea></label>
        <label>Marca <input name="marca" maxlength="500" autocomplete="off"></label>
        <label>Modelo <input name="modelo" maxlength="500" autocomplete="off"></label>
        <label>Quantidade <input name="quantidade" inputmode="decimal" autocomplete="off" placeholder="Ex.: 2.500"></label>
        <label>Valor unitário (R$) <input name="valorUnitario" inputmode="decimal" autocomplete="off" placeholder="Ex.: 1.10"></label>
        <p data-item-total></p>
        <p data-item-erros role="alert"></p>
        <div class="itens-acoes"><button type="submit" class="app-primario" data-item-salvar>Salvar item</button><button type="button" data-item-cancelar hidden>Cancelar edição</button></div>
      </form>
      <div class="itens-acoes"><button type="button" data-item-atualizar>Atualizar itens</button><button type="button" data-item-importar-abrir aria-expanded="false" aria-controls="itens-importar">Importar itens do edital (PNCP)</button></div>
      <form data-item-importar id="itens-importar" class="itens-importar" hidden novalidate>
        <label>Número do item no edital <input name="numeroItem" inputmode="numeric" pattern="[0-9]*" maxlength="7" autocomplete="off" placeholder="Ex.: 3"></label>
        <p class="itens-importar-ajuda">Um item por vez, direto do PNCP. Aguarde alguns segundos entre uma importação e outra.</p>
        <p data-item-importar-estado role="status" aria-live="polite"></p>
        <div class="itens-acoes"><button type="submit" class="app-primario" data-item-importar-enviar>Importar este item</button></div>
      </form>
      <div data-item-lista></div>
      <button type="button" data-item-mais hidden>Carregar mais itens</button>`;
    const el = (s) => alvo.querySelector(s);
    const form = el('[data-item-form]');
    const campos = () => Object.fromEntries(['identificador', 'descricao', 'marca', 'modelo', 'quantidade', 'valorUnitario'].map((n) => [n, form.elements[n].value]));

    function estado(t, tipo) { el('[data-item-estado]').textContent = t || ''; el('[data-item-estado]').dataset.itemEstado = tipo || ''; }
    function atualizarTotal() {
      const c = campos(), t = totalCentavos(c.quantidade, c.valorUnitario);
      el('[data-item-total]').textContent = t === null ? 'Total do item: informe quantidade e valor válidos.' : `Total do item: ${reais(t)}`;
    }
    function bloquear(v) { ocupado = v; el('[data-item-salvar]').disabled = v; el('[data-item-atualizar]').disabled = v; el('[data-item-mais]').disabled = v; el('[data-item-importar-enviar]').disabled = v; }

    function renderLista() {
      el('[data-item-lista]').innerHTML = itens.length
        ? `<ul>${itens.map((i) => {
          const t = totalCentavos(i.quantidade, i.valorUnitario);
          return `<li><strong>${esc(i.identificador)}</strong><p>${esc(i.descricao)}</p>
            <p>Quantidade: ${esc(i.quantidade)} · Unitário: R$ ${esc(i.valorUnitario)} · Total: ${t === null ? 'indisponível' : esc(reais(t))}</p>
            <p>Marca: ${esc(i.marca || 'não informada')} · Modelo: ${esc(i.modelo || 'não informado')}</p>
            <button type="button" data-item-editar="${esc(i.id)}" aria-label="Editar ${esc(i.identificador)}">Editar</button></li>`;
        }).join('')}</ul>`
        : '<p>Nenhum item cadastrado neste processo.</p>';
      el('[data-item-mais]').hidden = !maisItens;
    }

    // Lista paginada pelo contrato existente (listarItens + afterId/nextCursor). Resposta confere empresa e processo.
    async function carregar({ reiniciar, mensagemFinal = '' }) {
      const g = ++geracao; bloquear(true); estado(MSG.carregando, 'carregando');
      try {
        const corpo = { acao: 'listarItens', empresaId: contexto.empresaId, processoId: contexto.processoId, ...(!reiniciar && cursor ? { afterId: cursor } : {}) };
        const r = await requisitar('/api/kit-documentos', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(corpo) });
        const j = await r.json().catch(() => null);
        if (!vivo || g !== geracao) return;
        if (!r.ok || !j) throw new Error(j?.erro || MSG.erroCarregar);
        if (j.empresa?.id !== contexto.empresaId || j.processo?.id !== contexto.processoId) throw new Error(MSG.divergente);
        itens = reiniciar ? (j.itens || []) : itens.concat(j.itens || []);
        cursor = j.paginacaoItens?.nextCursor || null; maisItens = j.paginacaoItens?.hasMore === true;
        renderLista(); estado(mensagemFinal, mensagemFinal ? 'ok' : '');
      } catch (e) {
        if (vivo && g === geracao) estado(e.message || MSG.erroCarregar, 'erro');
      } finally { if (vivo && g === geracao) bloquear(false); }
    }

    // Envio único por tentativa: mesmo id enquanto os dados não mudam; edição usa o id do item.
    async function salvar(ev) {
      ev.preventDefault();
      if (ocupado || !vivo) return;
      const v = validarItemCampos(campos());
      if (!v.ok) { el('[data-item-erros]').textContent = Object.values(v.erros).join(' '); return; }
      el('[data-item-erros]').textContent = '';
      const modo = edicao ? 'editar' : 'criar';
      const chave = JSON.stringify([modo, edicao, v.dados]);
      if (!tentativa || tentativa.chave !== chave) tentativa = { id: edicao || global.crypto.randomUUID(), chave };
      const g = geracao; bloquear(true); estado('Salvando item…', 'carregando');
      let r = null, j = null;
      try {
        r = await requisitar('/api/kit-documentos', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
          body: JSON.stringify({ acao: 'salvarItem', empresaId: contexto.empresaId, processoId: contexto.processoId, modo, item: { id: tentativa.id, ...v.dados } }) });
        j = await r.json().catch(() => null);
      } catch { r = null; }
      if (!vivo || g !== geracao) return;
      bloquear(false);
      if (r && (r.status === 201 || r.status === 200) && j?.item) {
        tentativa = null; edicao = null; form.reset(); el('[data-item-cancelar]').hidden = true; atualizarTotal();
        // Gancho opcional, ANTES da consulta: o kit invalida revisao/exportacao ja com a gravacao confirmada. Falha ali nao afeta o item.
        if (vivo && typeof aoSalvar === 'function') { try { aoSalvar(); } catch { /* sem efeito no cadastro */ } }
        await carregar({ reiniciar: true, mensagemFinal: typeof aoSalvar === 'function' ? 'Item salvo. Catálogo da proposta será atualizado; confira a nova prévia.' : MSG.salvo });
        return;
      }
      if (!r) { estado(MSG.conexao, 'erro'); return; }
      estado(j?.erro || 'Não foi possível salvar o item.', 'erro');
    }

    function editar(id) {
      const i = itens.find((x) => x.id === id);
      if (!i || ocupado) return;
      edicao = id; tentativa = null;
      for (const n of ['identificador', 'descricao', 'marca', 'modelo', 'quantidade', 'valorUnitario']) form.elements[n].value = i[n] ?? '';
      el('[data-item-cancelar]').hidden = false; atualizarTotal(); estado(MSG.editando, 'vazio');
      el('#itens-titulo')?.focus?.();
    }
    // Importação PNCP: mesmo endpoint e regra de processos.html; o servidor confere empresa, processo e vínculo.
    const formImportar = el('[data-item-importar]');
    // Retorno ao lado do botão: no celular o topo do cartão fica fora da tela.
    function avisoImportar(t, tipo) { const p = el('[data-item-importar-estado]'); p.textContent = t || ''; p.dataset.situacao = tipo || ''; }
    async function importar(ev) {
      ev.preventDefault();
      if (ocupado || !vivo) return;
      const numeroItem = numeroItemImportacao(formImportar.elements.numeroItem.value);
      if (numeroItem === null) { avisoImportar(MSG.numeroImportar, 'erro'); formImportar.elements.numeroItem.focus?.(); return; }
      const g = geracao; bloquear(true); avisoImportar(MSG.importando, 'carregando');
      let r = null, j = null;
      try {
        r = await requisitar('/api/importar-item-pncp', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
          body: JSON.stringify({ empresaId: contexto.empresaId, processoId: contexto.processoId, numeroItem }) });
        j = await r.json().catch(() => null);
      } catch { r = null; }
      if (!vivo || g !== geracao) return;
      bloquear(false);
      if (!r) { avisoImportar(MSG.erroImportar, 'erro'); return; }
      const resultado = respostaImportacao(r.status, j);
      if (!resultado.ok) { avisoImportar(resultado.texto, 'erro'); return; }
      formImportar.reset();
      avisoImportar(resultado.texto, 'ok');
      if (typeof aoSalvar === 'function') { try { aoSalvar(); } catch { /* sem efeito na importação */ } }
      await carregar({ reiniciar: true });
    }
    function cancelarEdicao() { edicao = null; tentativa = null; form.reset(); el('[data-item-cancelar]').hidden = true; atualizarTotal(); estado('', ''); }

    form.addEventListener('submit', salvar);
    form.addEventListener('input', atualizarTotal);
    el('[data-item-cancelar]').addEventListener('click', cancelarEdicao);
    el('[data-item-atualizar]').addEventListener('click', () => { void carregar({ reiniciar: true }); });
    el('[data-item-mais]').addEventListener('click', () => { void carregar({ reiniciar: false }); });
    el('[data-item-importar-abrir]').addEventListener('click', (ev) => {
      formImportar.hidden = !formImportar.hidden;
      ev.currentTarget.setAttribute('aria-expanded', String(!formImportar.hidden));
      if (!formImportar.hidden) formImportar.elements.numeroItem.focus?.();
    });
    formImportar.addEventListener('submit', importar);
    alvo.addEventListener('click', (ev) => {
      const b = ev.target && ev.target.closest ? ev.target.closest('button[data-item-editar]') : null;
      if (b) editar(b.dataset.itemEditar);
    });
    atualizarTotal();
    void carregar({ reiniciar: true });

    return {
      fechar() { vivo = false; geracao += 1; alvo.replaceChildren(); },
      temAlteracoesNaoSalvas: () => vivo && (Object.values(campos()).some((v) => v !== '') || edicao !== null),
    };
  }

  const api = { montar, validarItemCampos, totalCentavos, reais, decimalPositivo, numeroItemImportacao, respostaImportacao, MSG };
  global.LicitaItensProcesso = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
