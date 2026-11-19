/* global module, URLSearchParams */
// "Buscar no mercado (Compras.gov)": produtos já licitados com marca declarada, preço homologado, órgão e data.
// Fonte: /api/comprasgov-marcas-produto (Catálogo CATMAT + Pesquisa de Preços, dados abertos, sem login).
// Usado no Catálogo de produtos (operacao.html, "Adicionar ao catálogo") e no preço por item (sistema.html, "Usar esta marca").
// O preço daqui é REFERÊNCIA do que o governo pagou; nunca é o custo do fornecedor do usuário.
(function (global) {
  'use strict';
  const MOSTRAR = 40;

  // Descrição de edital é longa ("CANETA ESFEROGRÁFICA, MATERIAL: PLÁSTICO, ..."): o catálogo público acha pelo nome curto.
  function termoDoItem(descricao) {
    const primeiro = String(descricao ?? '').split(/[,;:(\n–]| - /)[0].replace(/\s+/g, ' ').trim();
    return primeiro.split(' ').slice(0, 6).join(' ').slice(0, 100);
  }

  // Centavos inteiros (o servidor já converteu sem float). Média e mediana arredondam meio centavo para cima, em BigInt.
  function resumoPrecos(itens) {
    const v = (itens || []).map((i) => i.valorUnitarioCentavos).filter((c) => Number.isSafeInteger(c) && c > 0).sort((a, b) => a - b);
    if (!v.length) return { quantidade: 0, minimo: null, mediana: null, media: null, maximo: null };
    const n = BigInt(v.length), soma = v.reduce((s, c) => s + BigInt(c), 0n);
    const meio = v.length >> 1;
    const mediana = v.length % 2 ? v[meio] : Number((BigInt(v[meio - 1]) + BigInt(v[meio]) + 1n) / 2n);
    return { quantidade: v.length, minimo: v[0], mediana, media: Number((soma * 2n + n) / (2n * n)), maximo: v[v.length - 1] };
  }

  const contar = (itens, chave) => {
    const m = new Map();
    for (const i of itens) if (i[chave]) m.set(i[chave], (m.get(i[chave]) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'pt-BR'));
  };
  // Marca agrupada sem diferença de maiúscula ("bic" = "BIC"); exibe a grafia mais comum.
  const chaveMarca = (m) => String(m || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  function marcasDe(itens) {
    const grupos = new Map();
    for (const i of itens) {
      const k = chaveMarca(i.marca); if (!k) continue;
      const g = grupos.get(k) || { chave: k, grafias: new Map(), quantidade: 0 };
      g.quantidade += 1; g.grafias.set(i.marca, (g.grafias.get(i.marca) || 0) + 1); grupos.set(k, g);
    }
    return [...grupos.values()].map((g) => ({ chave: g.chave, nome: [...g.grafias.entries()].sort((a, b) => b[1] - a[1])[0][0], quantidade: g.quantidade }))
      .sort((a, b) => b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, 'pt-BR'));
  }
  // Filtros em cascata: produto do catálogo > unidade > marca. Preço só se compara dentro da mesma unidade (UN ≠ CX).
  function filtrar(itens, { produto = '', unidade = '', marca = '' } = {}) {
    return (itens || []).filter((i) => (!produto || String(i.codigoPdm) === String(produto)) && (!unidade || i.unidade === unidade) && (!marca || chaveMarca(i.marca) === marca));
  }

  const reais = (c) => (c === null || c === undefined ? null : `${Math.trunc(c / 100)}.${String(c % 100).padStart(2, '0')}`);
  function brl(c) {
    if (c === null || c === undefined) return '—';
    const [i, f] = reais(c).split('.');
    return `R$ ${i.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${f}`;
  }
  const dataBr = (d) => (/^(\d{4})-(\d{2})-(\d{2})/.test(d || '') ? d.slice(0, 10).split('-').reverse().join('/') : '—');

  // Rascunho de produto do catálogo a partir de um resultado + resumo do filtro em tela (mediana = preço de referência).
  // Data local (Brasília à noite já é amanhã em UTC; toISOString gravaria o dia errado).
  const hojeLocal = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function produtoParaCatalogo(item, resumo, hoje = hojeLocal()) {
    const ref = resumo && resumo.mediana ? reais(resumo.mediana) : null;
    return {
      nome: String(item.produtoCatalogo || item.descricaoItem || '').slice(0, 300),
      descricao: String(item.descricaoItem || '').slice(0, 5000) || null,
      marca: item.marca ? String(item.marca).slice(0, 200) : null,
      modelo: item.modelo ? String(item.modelo).slice(0, 200) : null,
      fabricante: item.fabricante ? String(item.fabricante).slice(0, 500) : null,
      unidade: (item.unidadeNome || item.unidade) ? String(item.unidadeNome || item.unidade).slice(0, 100) : null,
      preco_referencia: ref,
      referencia_fonte: ref ? `Compras.gov (Pesquisa de Preços): mediana de ${resumo.quantidade} compra(s)${item.unidade ? ` por ${item.unidade}` : ''}${resumo.marca ? `, marca ${resumo.marca}` : ''}` : null,
      referencia_em: ref ? hoje : null,
    };
  }

  // alvo: elemento vazio. aoUsar(item, resumo) recebe o resultado escolhido e o resumo do filtro atual.
  function montar({ alvo, doc = global.document, requisitar = (...a) => global.fetch(...a), termo = '', rotuloUsar = 'Usar', aoUsar }) {
    const estado = { itens: [], filtro: { produto: '', unidade: '', marca: '' }, buscando: false };
    const h = (tag, attrs = {}, ...filhos) => {
      const e = doc.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) { if (v === null || v === undefined || v === false) continue; if (k === 'texto') e.textContent = v; else if (k === 'classe') e.className = v; else e.setAttribute(k, v === true ? '' : String(v)); }
      e.append(...filhos.filter((f) => f !== null && f !== undefined && f !== false));
      return e;
    };
    const id = `mercado-${Math.random().toString(36).slice(2, 8)}`;
    const campo = h('input', { type: 'search', id: `${id}-termo`, maxlength: 100, autocomplete: 'off', placeholder: 'Ex.: papel A4, caneta esferográfica, detergente' });
    campo.value = termo;
    const botao = h('button', { type: 'submit', classe: 'btn primario', texto: 'Buscar' });
    const status = h('p', { classe: 'nota', role: 'status', 'aria-live': 'polite' });
    const filtros = h('div', { classe: 'mercado-filtros', hidden: true });
    const resumoEl = h('div', { classe: 'mercado-resumo', 'aria-live': 'polite' });
    const lista = h('ul', { classe: 'mercado-lista' });
    const form = h('form', { classe: 'mercado-busca', role: 'search' }, h('label', { for: campo.id, texto: 'Produto' }), h('div', { classe: 'mercado-linha' }, campo, botao));
    alvo.replaceChildren(form, status, filtros, resumoEl, lista,
      h('p', { classe: 'nota', texto: 'Fonte: Pesquisa de Preços e Catálogo do Compras.gov (dados abertos). Preço homologado pago pelo órgão: serve de referência, não é o seu custo. Marca e modelo são o que o fornecedor declarou.' }));

    function select(nome, rotulo, opcoes) {
      const s = h('select', { id: `${id}-${nome}`, 'data-filtro': nome });
      for (const [valor, texto] of opcoes) { const o = h('option', { value: valor, texto }); if (valor === estado.filtro[nome]) o.selected = true; s.append(o); }
      return h('div', { classe: 'mercado-campo' }, h('label', { for: s.id, texto: rotulo }), s);
    }
    function desenhar() {
      const doProduto = filtrar(estado.itens, { produto: estado.filtro.produto });
      const daUnidade = filtrar(doProduto, { unidade: estado.filtro.unidade });
      const visiveis = filtrar(daUnidade, { marca: estado.filtro.marca });
      const produtos = contar(estado.itens, 'codigoPdm').map(([c, n]) => [String(c), `${estado.itens.find((i) => String(i.codigoPdm) === String(c)).produtoCatalogo} (${n})`]);
      const unidades = contar(doProduto, 'unidade').map(([u, n]) => [u, `${u} (${n})`]);
      const marcas = marcasDe(daUnidade).map((m) => [m.chave, `${m.nome} (${m.quantidade})`]);
      filtros.hidden = !estado.itens.length;
      filtros.replaceChildren(select('produto', 'Produto do catálogo', produtos), select('unidade', 'Unidade', [['', 'Todas'], ...unidades]), select('marca', 'Marca', [['', 'Todas as marcas'], ...marcas]));
      const r = resumoPrecos(visiveis);
      const marcaNome = estado.filtro.marca ? marcasDe(visiveis)[0]?.nome : '';
      estado.resumo = { ...r, marca: marcaNome || '' };
      resumoEl.replaceChildren();
      if (estado.itens.length) {
        resumoEl.append(h('p', { texto: r.quantidade ? `${r.quantidade} compra(s)${estado.filtro.unidade ? ` por ${estado.filtro.unidade}` : ''}${marcaNome ? ` da marca ${marcaNome}` : ''}:` : 'Nenhuma compra com estes filtros.' }));
        if (r.quantidade) resumoEl.append(h('dl', { classe: 'mercado-numeros' }, ...[['Mínimo', r.minimo], ['Mediana', r.mediana], ['Média', r.media], ['Máximo', r.maximo]].map(([t, c]) => h('div', {}, h('dt', { texto: t }), h('dd', { texto: brl(c) })))));
        if (!estado.filtro.unidade && unidades.length > 1) resumoEl.append(h('p', { classe: 'nota', texto: 'Há unidades diferentes (unidade, caixa, pacote…). Escolha uma unidade para comparar preço com preço.' }));
      }
      lista.replaceChildren(...visiveis.slice(0, MOSTRAR).map((i, k) => h('li', { classe: 'mercado-item' },
        h('strong', { texto: [i.marca, i.modelo].filter(Boolean).join(' · modelo ') }),
        h('p', { classe: 'nota', texto: `Fabricante: ${i.fabricante || 'não informado na fonte'}` }),
        h('p', { texto: String(i.descricaoItem || '').slice(0, 220) }),
        h('p', {}, h('strong', { texto: `${brl(i.valorUnitarioCentavos)} por ${i.unidadeNome || i.unidade || 'unidade'}` }), ` · ${i.orgao || 'Órgão não informado'}${i.uf ? `/${i.uf}` : ''} · ${dataBr(i.dataResultado)}`),
        h('div', { classe: 'mercado-acoes' },
          i.link ? h('a', { href: i.link, target: '_blank', rel: 'noopener noreferrer', texto: 'Ver compra na fonte' }) : null,
          typeof aoUsar === 'function' ? h('button', { type: 'button', classe: 'btn', 'data-mercado-usar': String(k), texto: rotuloUsar }) : null))));
      if (visiveis.length > MOSTRAR) lista.append(h('li', { classe: 'nota', texto: `Mostrando ${MOSTRAR} de ${visiveis.length}. Use os filtros para ver as demais.` }));
      estado.visiveis = visiveis;
    }
    async function buscar(t) {
      const termoBusca = String(t || '').trim();
      if (termoBusca.length < 2) { status.textContent = 'Digite ao menos 2 letras do produto.'; return; }
      if (estado.buscando) return;
      estado.buscando = true; botao.disabled = true; status.textContent = 'Buscando no Compras.gov… pode levar alguns segundos.';
      try {
        const r = await requisitar(`/api/comprasgov-marcas-produto?${new URLSearchParams({ termo: termoBusca })}`, { method: 'GET' });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) throw new Error(j?.erro || 'A fonte pública não respondeu agora. Tente de novo em instantes.');
        estado.itens = Array.isArray(j.itens) ? j.itens.filter((i) => i && i.marca) : [];
        const primeiro = contar(estado.itens, 'codigoPdm')[0];
        const ordem = estado.itens[0]?.codigoPdm; // a fonte já vem ordenada pelo PDM mais próximo do termo
        estado.filtro = { produto: String(ordem ?? primeiro?.[0] ?? ''), unidade: '', marca: '' };
        estado.filtro.unidade = contar(filtrar(estado.itens, { produto: estado.filtro.produto }), 'unidade')[0]?.[0] || '';
        status.textContent = estado.itens.length
          ? `${estado.itens.length} compra(s) com marca declarada encontradas.${j.consultasComFalha ? ' Parte da fonte não respondeu: resultado parcial.' : ''}`
          : 'Nenhuma compra com marca declarada para este termo. Tente um nome mais curto (ex.: "detergente").';
        desenhar();
      } catch (e) {
        status.textContent = e.message || 'Não foi possível buscar agora.';
      } finally { estado.buscando = false; botao.disabled = false; }
    }
    form.addEventListener('submit', (ev) => { ev.preventDefault(); void buscar(campo.value); });
    filtros.addEventListener('change', (ev) => {
      const nome = ev.target?.dataset?.filtro; if (!nome) return;
      estado.filtro[nome] = ev.target.value;
      if (nome === 'produto') { estado.filtro.unidade = contar(filtrar(estado.itens, { produto: ev.target.value }), 'unidade')[0]?.[0] || ''; estado.filtro.marca = ''; }
      if (nome === 'unidade') estado.filtro.marca = '';
      desenhar();
    });
    lista.addEventListener('click', (ev) => {
      const b = ev.target?.closest?.('[data-mercado-usar]'); if (!b) return;
      const item = estado.visiveis?.[Number(b.dataset.mercadoUsar)];
      if (item) aoUsar(item, estado.resumo);
    });
    return { buscar, campo, estado };
  }

  const api = { termoDoItem, resumoPrecos, marcasDe, filtrar, produtoParaCatalogo, brl, montar };
  global.MercadoComprasGov = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
