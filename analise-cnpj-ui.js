/* global module */
// Análise por CNPJ (tela "Analisar concorrente" do painel): cabeçalho da Receita, alertas, disputas por item
// (vencidas e não vencidas, com descrição, preço, posição, órgão, data e link) e motivos de desclassificação.
// Dados:
//   - RPC analise_cnpj_participacoes (tabelas historico_*, com a RLS do usuário): PNCP, dados abertos do
//     Compras.gov e arquivo semanal de propostas;
//   - pregoes_gravados_* (extensão "Gravar pregão"): desclassificação/inabilitação com o texto literal;
//   - /api/sancoes-cnpj (CEIS/CNEP) e /api/analise-cnpj (coleta por demanda + fila do robô).
// Tudo por textContent (o dado vem de fontes externas). Regras puras exportadas para o node --test.
(function (global) {
  'use strict';
  const moeda = (v) => (Number.isFinite(v) ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—');
  const pct = (v) => (Number.isFinite(v) ? `${(Math.round(v * 10) / 10).toLocaleString('pt-BR')}%` : '—');
  const dataBr = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10).split('-').reverse().join('/') : '—');
  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const cnpjFormatado = (d) => String(d || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  const media = (lista) => (lista.length ? lista.reduce((s, x) => s + x, 0) / lista.length : null);

  // Arquivo de propostas: "2" = recusada no julgamento (sem dicionário oficial; ver supabase/analise_cnpj.sql).
  const RECUSADA = '2';
  const cancelado = (p) => /cancel/i.test(p.situacao_resultado || '');
  const precoFinal = (p) => num(p.valor_homologado) ?? num(p.valor_negociado) ?? num(p.valor_lance) ?? num(p.valor_proposta);
  function posicao(p) {
    return num(p.ordem_classificacao) ?? num(p.classificacao);
  }
  // Venceu: 1º colocado não recusado e não cancelado; sem posição (resultado fora de SRP), quem tem valor homologado.
  function venceu(p) {
    if (cancelado(p) || p.situacao_proposta === RECUSADA) return false;
    const pos = posicao(p);
    return pos === null ? num(p.valor_homologado) !== null : pos === 1;
  }
  const fracassadoSendo1o = (p) => posicao(p) === 1 && /fracass/i.test(p.situacao_item || '');

  function agrupar(linhas, chaveDe) {
    const g = new Map();
    for (const p of linhas) {
      const k = chaveDe(p) || 'Não informado';
      const a = g.get(k) || { chave: k, disputas: 0, vencidas: 0, valor: 0 };
      a.disputas++;
      if (p._venceu) { a.vencidas++; a.valor += p._valorGanho || 0; }
      g.set(k, a);
    }
    return [...g.values()].sort((x, y) => y.disputas - x.disputas || y.valor - x.valor);
  }
  // Produto: código do catálogo quando existe; senão as 2 primeiras palavras da descrição.
  const produto = (p) => (p.catmat ? `CATMAT ${p.catmat} · ${String(p.descricao || '').split(/[,;:]/)[0].slice(0, 60)}` : String(p.descricao || '').split(/[\s,;:]+/).slice(0, 2).join(' ').toUpperCase());

  // linhas: RPC analise_cnpj_participacoes. -> números da tela (puro).
  function resumir(linhas) {
    const itens = (Array.isArray(linhas) ? linhas : []).map((p) => {
      const v = venceu(p);
      const preco = precoFinal(p);
      const qtd = num(p.quantidade_homologada) ?? num(p.quantidade);
      return { ...p, _venceu: v, _posicao: posicao(p) ?? (v ? 1 : null), _preco: preco, _valorGanho: v && preco !== null && qtd !== null ? preco * qtd : 0,
        _vencedorPreco: num(p.vencedor_valor), _recusada: p.situacao_proposta === RECUSADA, _fracassado1: fracassadoSendo1o(p) };
    });
    const vencidas = itens.filter((p) => p._venceu), naoVencidas = itens.filter((p) => !p._venceu);
    // Preço com que perde vs vencedor: só pares com os dois preços (diferença % item a item).
    const pares = naoVencidas.filter((p) => p._preco > 0 && p._vencedorPreco > 0 && !p._recusada);
    const descontos = vencidas.filter((p) => p._preco > 0 && num(p.valor_estimado) > 0).map((p) => (p._preco / num(p.valor_estimado) - 1) * 100);
    return {
      disputas: itens.length, compras: new Set(itens.map((p) => p.id_compra)).size, vencidas: vencidas.length, naoVencidas: naoVencidas.length,
      vitoria: itens.length ? (vencidas.length / itens.length) * 100 : null, valorGanho: vencidas.reduce((s, p) => s + p._valorGanho, 0),
      precoMedioGanha: media(vencidas.map((p) => p._preco).filter((x) => x > 0)), descontoMedioGanha: media(descontos),
      precoMedioPerde: media(pares.map((p) => p._preco)), precoMedioVencedor: media(pares.map((p) => p._vencedorPreco)),
      diferencaMediaPerde: media(pares.map((p) => (p._preco / p._vencedorPreco - 1) * 100)), paresComparados: pares.length,
      recusadas: itens.filter((p) => p._recusada), fracassados1: itens.filter((p) => p._fracassado1),
      porUf: agrupar(itens, (p) => p.uf), porModalidade: agrupar(itens, (p) => p.modalidade),
      porOrgao: agrupar(itens, (p) => p.orgao_nome || p.unidade_nome || (p.uasg && `UASG ${p.uasg}`)), porProduto: agrupar(itens, produto),
      itensVencidos: vencidas, itensNaoVencidos: naoVencidas,
    };
  }

  // Pregões gravados pela extensão: mensagens do pregoeiro por tipo e situação da proposta lida na página.
  // Lido por um usuário do LicitaPlena, não pelo robô: só é "verificado" com 2+ organizações concordando
  // (leituras_concordantes, supabase/pregoes_gravados.sql). Abaixo disso a tela mostra o selo.
  const DESCLASS = /desclassific|recusad/i, INABIL = /inabilit/i;
  const leituras = (x) => Number(x?.leituras_concordantes) || 1;
  const seloNaoVerificado = (n) => `lido por usuário, não verificado (${n} leitura${n === 1 ? '' : 's'} concordando)`;
  function motivosGravados(mensagens, propostas) {
    const desclass = new Set(), inabil = new Set(), lista = [];
    let naoVerificados = 0;
    for (const m of Array.isArray(mensagens) ? mensagens : []) {
      if (!['recusa', 'desclassificacao', 'inabilitacao'].includes(m.tipo)) continue;
      const k = `${m.id_compra}|${m.numero_item}`;
      (m.tipo === 'inabilitacao' ? inabil : desclass).add(k);
      const pg = m.pregoes_gravados || {};
      if (leituras(m) < 2) naoVerificados += 1;
      lista.push({ chave: k, id_compra: m.id_compra, numero_item: m.numero_item, tipo: m.tipo, texto: m.motivo || m.texto, data: m.data_hora,
        url: pg.url || null, orgao: pg.orgao || null, descricao: pg.itens?.[String(m.numero_item)]?.descricao || null,
        leituras: leituras(m), verificado: leituras(m) >= 2 });
    }
    for (const p of Array.isArray(propostas) ? propostas : []) {
      const k = `${p.id_compra}|${p.numero_item}`;
      const conta = INABIL.test(p.situacao || '') ? inabil : DESCLASS.test(p.situacao || '') ? desclass : null;
      if (!conta) continue;
      conta.add(k);
      if (leituras(p) < 2) naoVerificados += 1;
    }
    return { desclassificacoes: desclass.size, inabilitacoes: inabil.size, lista, chaves: new Set([...desclass, ...inabil]), naoVerificados };
  }

  // ---------- Tela ----------
  function el(doc, tag, attrs, ...filhos) {
    const e = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'texto') e.textContent = v; else e.setAttribute(k, v);
    }
    for (const f of filhos.flat()) if (f !== null && f !== undefined && f !== false) e.append(typeof f === 'string' ? doc.createTextNode(f) : f);
    return e;
  }
  const link = (doc, href, texto) => (/^https:\/\//.test(String(href || '')) ? el(doc, 'a', { href, target: '_blank', rel: 'noopener', class: 'link-pncp', texto }) : null);
  const rolavel = (doc, tabela) => el(doc, 'div', { style: 'overflow-x:auto;-webkit-overflow-scrolling:touch' }, tabela);
  const cartao = (doc, titulo, valor) => el(doc, 'div', { class: 'cartao' }, el(doc, 'h3', { texto: titulo }), el(doc, 'div', { class: 'valor', texto: valor }));

  function cabecalho(doc, cnpj, ficha) {
    const caixa = el(doc, 'div', { class: 'acn-cabecalho' });
    if (!ficha) {
      caixa.append(el(doc, 'p', { class: 'dica-clique', texto: `CNPJ ${cnpjFormatado(cnpj)} — dados cadastrais da Receita indisponíveis agora (BrasilAPI não respondeu ou o CNPJ não existe na base aberta).` }));
      return caixa;
    }
    const cnaes = [ficha.cnae_fiscal && `${ficha.cnae_fiscal} — ${ficha.cnae_fiscal_descricao || ''}`, ...(ficha.cnaes_secundarios || []).filter((c) => c && c.codigo).map((c) => `${c.codigo} — ${c.descricao || ''}`)];
    caixa.append(el(doc, 'h3', { style: 'margin:0 0 4px', texto: ficha.razao_social || '—' }),
      el(doc, 'p', { style: 'margin:0', texto: [`CNPJ ${cnpjFormatado(cnpj)}`, [ficha.municipio, ficha.uf].filter(Boolean).join('/'), ficha.descricao_porte || ficha.porte,
        ficha.descricao_situacao_cadastral && `Situação: ${ficha.descricao_situacao_cadastral}`].filter(Boolean).join(' · ') }),
      cnaes.length ? el(doc, 'details', {}, el(doc, 'summary', { texto: `CNAEs (${cnaes.length})` }), el(doc, 'ul', { class: 'ficha-lista' }, cnaes.map((c) => el(doc, 'li', { texto: c })))) : null,
      el(doc, 'p', { class: 'dica-clique', style: 'margin:4px 0 0', texto: 'Fonte: base aberta de CNPJ da Receita Federal, consultada pela BrasilAPI (grátis, sem chave). Sócios: só nomes, na Análise administrativa abaixo.' }));
    return caixa;
  }

  function blocoAlertas(doc, r, mot, sancoes, hoje, LicitaSancoes) {
    const caixa = el(doc, 'div', { class: 'acn-alertas' }, el(doc, 'h3', { texto: 'Alertas' }));
    if (sancoes && sancoes.erro) caixa.append(el(doc, 'p', { class: 'aviso', texto: `Sanções: ${sancoes.erro}` }));
    else if (sancoes && LicitaSancoes) caixa.append(LicitaSancoes.montarSelo(doc, sancoes, hoje) || el(doc, 'p', { texto: 'Sem sanção no CEIS/CNEP (cadastro da CGU carregado diariamente).' }));
    const recusasSemGravacao = r.recusadas.filter((p) => !mot.chaves.has(`${p.id_compra}|${p.numero_item}`));
    caixa.append(el(doc, 'div', { class: 'cartoes' },
      cartao(doc, 'Desclassificações (pregões gravados)', String(mot.desclassificacoes)),
      cartao(doc, 'Inabilitações (pregões gravados)', String(mot.inabilitacoes)),
      cartao(doc, 'Propostas recusadas (arquivo do Compras.gov)', String(recusasSemGravacao.length)),
      cartao(doc, 'Itens fracassados sendo o 1º colocado', String(r.fracassados1.length))));
    if (mot.naoVerificados) caixa.append(el(doc, 'p', { class: 'aviso', texto: `Desclassificações/inabilitações de pregões gravados: ${mot.naoVerificados} registro(s) lido(s) por usuário, não verificado(s) — confira no pregão.` }));
    caixa.append(el(doc, 'p', { class: 'dica-clique', texto: 'Recusada = situação "2" no arquivo semanal de propostas do Compras.gov: o governo não publica o significado nem distingue desclassificação de inabilitação. Grave o pregão pela extensão para ter o motivo literal.' }));
    return caixa;
  }

  function tabelaGrupo(doc, titulo, grupos) {
    if (!grupos.length) return null;
    return el(doc, 'details', { class: 'acn-grupo' }, el(doc, 'summary', { texto: `${titulo} (${grupos.length})` }), rolavel(doc, el(doc, 'table', {},
      el(doc, 'tr', {}, ['', 'Disputas', 'Vencidas', '% vitória', 'Valor ganho'].map((t) => el(doc, 'th', { texto: t || titulo }))),
      grupos.slice(0, 30).map((g) => el(doc, 'tr', {}, el(doc, 'td', { texto: g.chave }), el(doc, 'td', { texto: String(g.disputas) }),
        el(doc, 'td', { texto: String(g.vencidas) }), el(doc, 'td', { texto: pct((g.vencidas / g.disputas) * 100) }), el(doc, 'td', { texto: moeda(g.valor) }))))));
  }

  const MAX_LINHAS = 100;
  // Selo CEIS/CNEP do vencedor (sancoes-ui.js) quando ele tem sanção; selos = { resultados, hoje, LicitaSancoes } da consulta em lote.
  const seloDoVencedor = (doc, selos, ni) => {
    const res = selos && ni && selos.resultados && selos.resultados[ni];
    return res ? selos.LicitaSancoes.montarSelo(doc, res, selos.hoje) : null;
  };
  // CNPJs dos vencedores das linhas que a tabela mostra (até 200, o teto do endpoint em lote).
  const cnpjsDosVencedores = (itens) => [...new Set(itens.slice(0, MAX_LINHAS).map((p) => p.vencedor_ni).filter((ni) => /^\d{14}$/.test(String(ni || ''))))].slice(0, 200);

  function tabelaItens(doc, titulo, itens, perdidos, selos) {
    const caixa = el(doc, 'div', {}, el(doc, 'h3', { texto: `${titulo} (${itens.length})` }));
    if (!itens.length) { caixa.append(el(doc, 'p', { class: 'dica-clique', texto: 'Nenhum no histórico guardado.' })); return caixa; }
    const cab = ['Item', 'Qtd', 'Preço unit.', ...(perdidos ? ['Vencedor (preço)'] : []), 'Posição', 'Órgão', 'Data', 'Fonte'];
    const linhas = itens.slice(0, MAX_LINHAS).map((p) => el(doc, 'tr', {},
      el(doc, 'td', { texto: `${p.numero_item}. ${p.descricao || 'Descrição não informada pela fonte'}` }),
      el(doc, 'td', { texto: num(p.quantidade_homologada ?? p.quantidade) === null ? '—' : `${Number(p.quantidade_homologada ?? p.quantidade).toLocaleString('pt-BR')} ${p.unidade || ''}`.trim() }),
      el(doc, 'td', { texto: moeda(p._preco) }),
      perdidos ? el(doc, 'td', {}, p.vencedor_nome ? `${p.vencedor_nome} (${moeda(p._vencedorPreco)})` : '—', seloDoVencedor(doc, selos, p.vencedor_ni)) : null,
      el(doc, 'td', { texto: p._recusada ? 'recusada' : p._fracassado1 ? '1º (item fracassado)' : p._posicao ? `${p._posicao}º` : '—' }),
      el(doc, 'td', { texto: [p.orgao_nome || p.unidade_nome, p.uf].filter(Boolean).join(' / ') || (p.uasg ? `UASG ${p.uasg}` : '—') }),
      el(doc, 'td', { texto: dataBr(p.data_resultado || p.data_publicacao) }),
      el(doc, 'td', {}, link(doc, p.link_pncp, 'PNCP'), p.link_pncp && p.link_origem ? ' · ' : null, link(doc, p.link_origem, 'Compras.gov'))));
    caixa.append(rolavel(doc, el(doc, 'table', {}, el(doc, 'tr', {}, cab.map((t) => el(doc, 'th', { texto: t }))), linhas)));
    if (itens.length > MAX_LINHAS) caixa.append(el(doc, 'p', { class: 'dica-clique', texto: `Mostrando os ${MAX_LINHAS} mais recentes de ${itens.length}.` }));
    return caixa;
  }

  function blocoParticipacoes(doc, r, selos) {
    const caixa = el(doc, 'div', { class: 'acn-participacoes' }, el(doc, 'h3', { texto: 'Participações' }));
    caixa.append(el(doc, 'div', { class: 'cartoes' },
      cartao(doc, 'Disputas (itens)', `${r.disputas} em ${r.compras} contratação(ões)`), cartao(doc, 'Vencidas', String(r.vencidas)),
      cartao(doc, 'Não vencidas', String(r.naoVencidas)), cartao(doc, '% de vitória', pct(r.vitoria)), cartao(doc, 'Valor ganho', moeda(r.valorGanho))));
    caixa.append(el(doc, 'div', { class: 'cartoes' },
      cartao(doc, 'Preço médio com que ganha', `${moeda(r.precoMedioGanha)}${Number.isFinite(r.descontoMedioGanha) ? ` (${pct(r.descontoMedioGanha)} vs estimado)` : ''}`),
      cartao(doc, 'Preço médio com que perde', r.paresComparados ? `${moeda(r.precoMedioPerde)} vs ${moeda(r.precoMedioVencedor)} do vencedor (${pct(Math.abs(r.diferencaMediaPerde))} ${r.diferencaMediaPerde >= 0 ? 'acima' : 'abaixo'}, ${r.paresComparados} itens)` : '—')));
    caixa.append(tabelaGrupo(doc, 'Por estado (UF do órgão)', r.porUf) || '', tabelaGrupo(doc, 'Por modalidade', r.porModalidade) || '',
      tabelaGrupo(doc, 'Por órgão', r.porOrgao) || '', tabelaGrupo(doc, 'Por produto / CATMAT', r.porProduto) || '');
    caixa.append(tabelaItens(doc, 'Itens vencidos', r.itensVencidos, false), tabelaItens(doc, 'Itens não vencidos', r.itensNaoVencidos, true, selos));
    return caixa;
  }

  const ROTULO = { recusa: 'Recusa', desclassificacao: 'Desclassificação', inabilitacao: 'Inabilitação' };
  function blocoMotivos(doc, r, mot) {
    const caixa = el(doc, 'div', { class: 'acn-motivos' }, el(doc, 'h3', { texto: 'Motivos de desclassificação / inabilitação' }));
    const linhas = mot.lista.map((m) => el(doc, 'tr', {}, el(doc, 'td', { texto: `${m.numero_item}. ${m.descricao || ''}`.trim() }), el(doc, 'td', { texto: ROTULO[m.tipo] }),
      el(doc, 'td', { texto: m.texto }), el(doc, 'td', { texto: m.orgao || `Compra ${m.id_compra}` }), el(doc, 'td', { texto: dataBr(m.data) }),
      el(doc, 'td', {}, link(doc, m.url, 'Pregão gravado'), m.verificado ? null : el(doc, 'small', { class: 'selo-nao-verificado', texto: seloNaoVerificado(m.leituras) }))));
    for (const p of r.recusadas.filter((x) => !mot.chaves.has(`${x.id_compra}|${x.numero_item}`)).slice(0, MAX_LINHAS)) {
      linhas.push(el(doc, 'tr', {}, el(doc, 'td', { texto: `${p.numero_item}. ${p.descricao || ''}`.trim() }), el(doc, 'td', { texto: 'Recusada (arquivo)' }),
        el(doc, 'td', { texto: 'Motivo não registrado — abra o pregão' }), el(doc, 'td', { texto: p.orgao_nome || (p.uasg ? `UASG ${p.uasg}` : '—') }),
        el(doc, 'td', { texto: dataBr(p.data_resultado || p.data_publicacao) }), el(doc, 'td', {}, link(doc, p.link_origem, 'Abrir no Compras.gov'))));
    }
    if (!linhas.length) { caixa.append(el(doc, 'p', { class: 'dica-clique', texto: 'Nenhuma desclassificação ou inabilitação registrada no histórico guardado.' })); return caixa; }
    caixa.append(rolavel(doc, el(doc, 'table', {}, el(doc, 'tr', {}, ['Item', 'Tipo', 'Motivo (texto literal)', 'Órgão', 'Data', 'Fonte'].map((t) => el(doc, 'th', { texto: t }))), linhas)));
    return caixa;
  }

  function blocoColeta(doc, coleta, aoAtualizar) {
    const caixa = el(doc, 'div', { class: 'aviso acn-coleta', role: 'status' });
    if (!coleta) return null;
    if (coleta.erro) { caixa.textContent = `Coleta nova não foi possível agora (${coleta.erro}). Mostrando o que já está guardado.`; return caixa; }
    const lidos = (coleta.meses_lidos || []).length;
    const base = `PNCP: ${coleta.total_pncp ?? 0} contratação(ões) com resultado deste CNPJ. Arquivo de propostas do Compras.gov: ${lidos} mês(es) lido(s).`;
    if (coleta.situacao === 'completo') { caixa.textContent = `${base} Coleta completa em ${dataBr(coleta.atualizado_em)}.`; return caixa; }
    caixa.append(`Completando… ${base} Faltam ${coleta.compras_pendentes} contratação(ões) e ${coleta.meses_pendentes} mês(es) do arquivo semanal (é ele que traz as disputas perdidas); o robô completa a cada 2 horas. `,
      el(doc, 'button', { type: 'button', class: 'btn-imprimir', texto: 'Atualizar' }));
    caixa.querySelector('button').addEventListener('click', aoAtualizar);
    for (const a of coleta.avisos || []) caixa.append(el(doc, 'br'), a);
    return caixa;
  }

  async function lerTudo(sb, cnpj) {
    const linhas = [];
    for (let de = 0; de < 10000; de += 1000) {
      const { data, error } = await sb.rpc('analise_cnpj_participacoes', { p_cnpj: cnpj }).range(de, de + 999);
      if (error) throw error;
      linhas.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    // Tabelas da extensão ausentes (banco sem pregoes_gravados.sql): sem motivos gravados, o resto segue.
    const [msg, prop] = await Promise.all([
      sb.from('pregoes_gravados_mensagens').select('id_compra,numero_item,data_hora,texto,tipo,motivo,leituras_concordantes,pregoes_gravados(url,orgao,itens)')
        .eq('fornecedor_chave', cnpj).in('tipo', ['recusa', 'desclassificacao', 'inabilitacao']).order('data_hora', { ascending: false }).limit(500),
      sb.from('pregoes_gravados_propostas').select('id_compra,numero_item,situacao,leituras_concordantes').eq('cnpj', cnpj).limit(5000),
    ]);
    return { linhas, mensagens: msg.error ? [] : msg.data, propostas: prop.error ? [] : prop.data };
  }

  // alvo: container; requisitar(corpo) -> /api/analise-cnpj; sancoes() -> /api/sancoes-cnpj (ou {erro}).
  // sancoesLote(cnpjs) -> { resultados, hoje } (POST /api/sancoes-cnpj): selo de sanção nos vencedores das disputas perdidas.
  async function montar({ alvo, cnpj, ficha, sb, requisitar, sancoes, sancoesLote, hoje, LicitaSancoes }) {
    const doc = alvo.ownerDocument;
    const status = el(doc, 'div', { class: 'carregando', texto: 'Buscando as disputas deste CNPJ no PNCP e no Compras.gov…' });
    alvo.replaceChildren(cabecalho(doc, cnpj, ficha), status);
    const [coleta, sanc] = await Promise.all([requisitar({ acao: 'coletar', cnpj }).catch((e) => ({ erro: String(e.message || e) })), sancoes().catch(() => ({ erro: 'indisponível agora' }))]);
    let dados;
    try { dados = await lerTudo(sb, cnpj); } catch (e) {
      status.replaceWith(el(doc, 'div', { class: 'aviso', texto: `Não foi possível ler o histórico agora (${e.message || e.code || 'erro'}).` }));
      return null;
    }
    const r = resumir(dados.linhas), mot = motivosGravados(dados.mensagens, dados.propostas);
    let selos = null;
    const vencedores = sancoesLote && LicitaSancoes ? cnpjsDosVencedores(r.itensNaoVencidos) : [];
    if (vencedores.length) {
      try { const lote = await sancoesLote(vencedores); if (lote && lote.resultados) selos = { resultados: lote.resultados, hoje: lote.hoje || hoje, LicitaSancoes }; } catch { selos = null; }
    }
    alvo.replaceChildren(cabecalho(doc, cnpj, ficha), blocoColeta(doc, coleta, () => montar({ alvo, cnpj, ficha, sb, requisitar, sancoes, sancoesLote, hoje, LicitaSancoes })) || '',
      blocoAlertas(doc, r, mot, sanc, hoje, LicitaSancoes), blocoParticipacoes(doc, r, selos), blocoMotivos(doc, r, mot),
      el(doc, 'p', { class: 'dica-clique', texto: 'Fontes: PNCP (resultados por fornecedor), dados abertos do Compras.gov, arquivo semanal de propostas (repositorio.dados.gov.br, só itens homologados), CEIS/CNEP da CGU e pregões gravados pela extensão. Outras plataformas (Licitanet, BLL, BNC…) entram só pelo resultado publicado no PNCP: as disputas perdidas nelas não são públicas.' }));
    return r;
  }

  // Busca por nome: lista clicável dos fornecedores do PNCP (só CNPJ).
  function montarEscolha(doc, alvo, lista, aoEscolher) {
    if (!lista.length) { alvo.replaceChildren(el(doc, 'div', { class: 'aviso', texto: 'Nenhuma empresa com esse nome tem resultado no PNCP. Tente outra parte do nome ou o CNPJ.' })); return; }
    alvo.replaceChildren(el(doc, 'p', { texto: 'Escolha a empresa:' }), el(doc, 'ul', { class: 'ficha-lista' }, lista.map((f) => {
      const b = el(doc, 'button', { type: 'button', class: 'btn-imprimir', texto: `${f.nome} — ${cnpjFormatado(f.cnpj)} (${f.total} contratações no PNCP)` });
      b.addEventListener('click', () => aoEscolher(f.cnpj));
      return el(doc, 'li', {}, b);
    })));
  }

  const api = { resumir, motivosGravados, venceu, posicao, precoFinal, montar, montarEscolha, cnpjsDosVencedores };
  global.LicitaAnaliseCnpj = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
