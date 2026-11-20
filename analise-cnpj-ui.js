/* global module */
// Análise por CNPJ (tela "Analisar concorrente" do painel): cabeçalho da Receita, alertas, disputas por item
// (vencidas e não vencidas, com descrição, preço, posição, órgão, data e link) e motivos de desclassificação.
// Dados:
//   - RPC analise_cnpj_participacoes (tabelas historico_*, com a RLS do usuário): PNCP, dados abertos do
//     Compras.gov e arquivo semanal de propostas;
//   - pregoes_gravados_* (extensão "Gravar pregão"): desclassificação/inabilitação com o texto literal;
//   - /api/sancoes-cnpj (CEIS/CNEP) e /api/analise-cnpj (coleta por demanda + fila do robô);
//   - /api/analise-cnpj {acao:"cadastro"} (base aberta da Receita, cache empresas_cadastro) e a tabela
//     historico_contratos_fornecedor (contratos do PNCP por fornecedor; empenhado/pago/faturado do Contratos.gov.br).
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

  // Contratos do fornecedor (historico_contratos_fornecedor) -> totais e por UF da unidade contratante (puro).
  // Empenhado/liquidado/pago/faturado só existem para contrato federal com registro no Contratos.gov.br.
  function resumirContratos(contratos, hoje) {
    const lista = Array.isArray(contratos) ? contratos : [];
    const soma = (campo, l = lista) => l.reduce((t, c) => t + (num(c[campo]) || 0), 0);
    const vigente = (c) => Boolean(c.vigencia_fim) && c.vigencia_fim >= hoje;
    const comGov = lista.filter((c) => num(c.valor_empenhado) !== null || num(c.valor_pago) !== null);
    const porUf = new Map();
    for (const c of lista) {
      const k = c.uf || 'Não informado';
      const a = porUf.get(k) || { chave: k, contratos: 0, valor: 0, vigentes: 0 };
      a.contratos++;
      a.valor += num(c.valor_global) || 0;
      if (vigente(c)) a.vigentes++;
      porUf.set(k, a);
    }
    return { total: lista.length, valorContratado: soma('valor_global'), vigentes: lista.filter(vigente).length,
      maiorContrato: lista.reduce((m, c) => Math.max(m, num(c.valor_global) || 0), 0),
      federaisComValores: comGov.length, valorContratadoFederal: soma('valor_global', comGov), empenhado: soma('valor_empenhado', comGov),
      liquidado: soma('valor_liquidado', comGov), pago: soma('valor_pago', comGov), faturado: soma('valor_faturado', comGov),
      porUf: [...porUf.values()].sort((x, y) => y.valor - x.valor || y.contratos - x.contratos), lista };
  }

  // Alerta de vulnerabilidade (puro): o que o ConLicitação mostra no topo (desclassificações, inabilitações, sanções)
  // mais sinais cadastrais. nivel: 'alto' (pode impedir de contratar) | 'medio' (atenção) | 'info'.
  // Capital: a Lei 14.133 (art. 69, §4º) deixa o edital exigir capital ou patrimônio mínimo de até 10% do valor estimado;
  // capital abaixo de 10% do maior contrato já assinado é sinal de que pode não passar nessa exigência.
  const MS_DIA = 864e5;
  const TETO_MEI = 81000;
  function alertasCadastro(cadastro, maior, hoje) {
    const a = [];
    const situacao = String(cadastro.situacao || '').toUpperCase();
    if (situacao && situacao !== 'ATIVA') {
      const motivo = cadastro.motivo_situacao && !/sem motivo/i.test(cadastro.motivo_situacao) ? ` (${cadastro.motivo_situacao})` : '';
      a.push({ nivel: 'alto', texto: `Situação cadastral na Receita: ${cadastro.situacao}${cadastro.data_situacao ? ` desde ${dataBr(cadastro.data_situacao)}` : ''}${motivo}.` });
    }
    if (cadastro.situacao_especial) a.push({ nivel: 'alto', texto: `Situação especial na Receita: ${cadastro.situacao_especial}.` });
    const idadeDias = /^\d{4}-\d{2}-\d{2}$/.test(String(cadastro.data_abertura || '')) ? (Date.parse(hoje) - Date.parse(cadastro.data_abertura)) / MS_DIA : null;
    if (idadeDias !== null && idadeDias >= 0 && idadeDias < 365) {
      a.push({ nivel: 'medio', texto: `Empresa aberta há ${Math.floor(idadeDias / 30)} mês(es) (${dataBr(cadastro.data_abertura)}): pode não ter atestado de capacidade técnica nem balanço.` });
    }
    const capital = num(cadastro.capital_social);
    if (capital !== null && maior > 0 && capital < maior * 0.1) {
      a.push({ nivel: 'medio', texto: `Capital social de ${moeda(capital)} é menos de 10% do maior contrato dela (${moeda(maior)}): editais que exigem capital mínimo (até 10%, Lei 14.133 art. 69 §4º) podem barrá-la.` });
    }
    if (cadastro.opcao_mei && maior > TETO_MEI) a.push({ nivel: 'medio', texto: `Optante pelo MEI com contrato de ${moeda(maior)}: acima do teto anual do MEI (R$ 81 mil).` });
    return a;
  }
  function alertasVulnerabilidade({ cadastro, sancoes, resumo, mot, contratos, hoje }) {
    const a = [];
    const vig = (sancoes && sancoes.vigentes) || [], exp = (sancoes && sancoes.expiradas) || [];
    if (vig.length) a.push({ nivel: 'alto', texto: `${vig.length} sanção(ões) vigente(s) no CEIS/CNEP (${vig.map((x) => x.orgao_sancionador).filter(Boolean).slice(0, 2).join('; ') || 'órgão não informado'}).` });
    else if (exp.length) a.push({ nivel: 'info', texto: `${exp.length} sanção(ões) já encerrada(s) no CEIS/CNEP: histórico, não impede contratar.` });
    if (cadastro) a.push(...alertasCadastro(cadastro, contratos ? contratos.maiorContrato : 0, hoje));
    if (mot && resumo) {
      const recusas = mot.desclassificacoes + mot.inabilitacoes + resumo.recusadas.filter((p) => !mot.chaves.has(`${p.id_compra}|${p.numero_item}`)).length;
      if (resumo.disputas >= 5 && recusas / resumo.disputas >= 0.2) {
        a.push({ nivel: 'medio', texto: `${recusas} desclassificação(ões)/inabilitação(ões)/recusa(s) em ${resumo.disputas} disputas (${pct((recusas / resumo.disputas) * 100)}).` });
      }
    }
    return a;
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

  // Ficha da BrasilAPI que o painel já buscou -> mesmo formato de empresas_cadastro (quando o cache não respondeu).
  const cadastroDaFicha = (ficha) => (ficha ? { razao_social: ficha.razao_social, municipio: ficha.municipio, uf: ficha.uf, porte: ficha.descricao_porte || ficha.porte,
    situacao: ficha.descricao_situacao_cadastral, cnae_principal: ficha.cnae_fiscal ? { codigo: String(ficha.cnae_fiscal), descricao: ficha.cnae_fiscal_descricao } : null,
    cnaes_secundarios: (ficha.cnaes_secundarios || []).filter((x) => x && x.codigo).map((x) => ({ codigo: String(x.codigo), descricao: x.descricao })),
    data_abertura: ficha.data_inicio_atividade, capital_social: num(ficha.capital_social), natureza_juridica: ficha.natureza_juridica, socios: [] } : null);

  // cad: linha de empresas_cadastro (via /api/analise-cnpj); sem ela, a ficha da BrasilAPI.
  function cabecalho(doc, cnpj, cad, ficha) {
    const caixa = el(doc, 'div', { class: 'acn-cabecalho' });
    const c = cad || cadastroDaFicha(ficha);
    if (!c) {
      caixa.append(el(doc, 'p', { class: 'dica-clique', texto: `CNPJ ${cnpjFormatado(cnpj)} — dados cadastrais da Receita indisponíveis agora (a base aberta não respondeu ou o CNPJ não existe nela).` }));
      return caixa;
    }
    const cnaes = [c.cnae_principal && `${c.cnae_principal.codigo} — ${c.cnae_principal.descricao || ''} (principal)`, ...(c.cnaes_secundarios || []).map((x) => `${x.codigo} — ${x.descricao || ''}`)].filter(Boolean);
    const campo = (rotulo, valor) => el(doc, 'li', {}, el(doc, 'strong', { texto: `${rotulo}: ` }), valor || '—');
    const fonte = cad ? `${cad.fonte === 'minhareceita' ? 'minhareceita.org' : 'BrasilAPI'}, consultada em ${dataBr(cad.consultado_em)}` : 'BrasilAPI';
    caixa.append(el(doc, 'h3', { style: 'margin:0 0 4px', texto: c.razao_social || '—' }),
      el(doc, 'p', { style: 'margin:0', texto: [`CNPJ ${cnpjFormatado(cnpj)}`, [c.municipio, c.uf].filter(Boolean).join('/'), c.porte, c.situacao && `Situação: ${c.situacao}`].filter(Boolean).join(' · ') }),
      el(doc, 'ul', { class: 'ficha-lista acn-cadastro' },
        campo('Situação cadastral', [c.situacao, c.data_situacao && `desde ${dataBr(c.data_situacao)}`, c.situacao_especial && `situação especial: ${c.situacao_especial}`].filter(Boolean).join(' · ')),
        campo('Abertura', c.data_abertura ? dataBr(c.data_abertura) : null),
        campo('Capital social', num(c.capital_social) === null ? null : moeda(num(c.capital_social))),
        campo('Porte', [c.porte, c.opcao_mei ? 'MEI' : c.opcao_simples ? 'Simples Nacional' : null].filter(Boolean).join(' · ')),
        campo('Natureza jurídica', c.natureza_juridica),
        campo('CNAE principal', c.cnae_principal ? `${c.cnae_principal.codigo} — ${c.cnae_principal.descricao || ''}` : null)),
      cnaes.length > 1 ? el(doc, 'details', {}, el(doc, 'summary', { texto: `CNAEs (${cnaes.length})` }), el(doc, 'ul', { class: 'ficha-lista' }, cnaes.map((x) => el(doc, 'li', { texto: x })))) : null,
      (c.socios || []).length ? el(doc, 'details', {}, el(doc, 'summary', { texto: `Sócios e administradores (${c.socios.length})` }),
        el(doc, 'ul', { class: 'ficha-lista' }, c.socios.map((x) => el(doc, 'li', { texto: [x.nome, x.qualificacao, x.entrada && `desde ${dataBr(x.entrada)}`].filter(Boolean).join(' — ') })))) : null,
      el(doc, 'p', { class: 'dica-clique', style: 'margin:4px 0 0', texto: `Fonte: base aberta de CNPJ da Receita Federal (${fonte}). Sócios: só o nome como a Receita publica; CPF não é guardado.` }));
    return caixa;
  }

  const ROTULO_NIVEL = { alto: 'Alto', medio: 'Atenção', info: 'Info' };
  function blocoVulnerabilidade(doc, alertas) {
    const caixa = el(doc, 'div', { class: 'acn-vulnerabilidade' }, el(doc, 'h3', { texto: 'Alerta de vulnerabilidade' }));
    if (!alertas.length) caixa.append(el(doc, 'p', { class: 'dica-clique', texto: 'Nenhum sinal de risco nas fontes consultadas (CEIS/CNEP, Receita, disputas e contratos guardados).' }));
    else caixa.append(el(doc, 'ul', { class: 'ficha-lista' }, alertas.map((x) => el(doc, 'li', { class: x.nivel === 'alto' ? 'aviso' : null, 'data-nivel': x.nivel },
      el(doc, 'strong', { texto: `${ROTULO_NIVEL[x.nivel]}: ` }), x.texto))));
    caixa.append(el(doc, 'p', { class: 'dica-clique', texto: 'Certidões (CND federal, FGTS, trabalhista) não entram: as consultas oficiais exigem captcha. Confira no SICAF ou nos sites emissores.' }));
    return caixa;
  }

  function linhaContrato(doc, x) {
    const gov = Number(x.contratos_gov_id);
    return el(doc, 'tr', {},
      el(doc, 'td', { texto: `${x.numero || '—'} · ${x.objeto || 'Objeto não informado'}` }),
      el(doc, 'td', { texto: [x.unidade_nome || x.orgao_nome, x.municipio, x.uf].filter(Boolean).join(' / ') || '—' }),
      el(doc, 'td', { texto: `${dataBr(x.vigencia_inicio || x.data_assinatura)} a ${dataBr(x.vigencia_fim)}` }),
      el(doc, 'td', { texto: moeda(num(x.valor_global)) }),
      el(doc, 'td', { texto: num(x.valor_empenhado) === null ? '—' : `${moeda(num(x.valor_empenhado))} / ${moeda(num(x.valor_pago))} / ${moeda(num(x.valor_faturado))}` }),
      el(doc, 'td', {}, link(doc, x.link_pncp, 'PNCP'), gov > 0 ? ' · ' : null, gov > 0 ? link(doc, `https://contratos.comprasnet.gov.br/api/contrato/id/${gov}`, 'Contratos.gov.br') : null));
  }

  function blocoContratos(doc, c) {
    const caixa = el(doc, 'div', { class: 'acn-contratos' }, el(doc, 'h3', { texto: 'Contratos e valores faturados' }));
    if (!c.total) { caixa.append(el(doc, 'p', { class: 'dica-clique', texto: 'Nenhum contrato deste CNPJ guardado ainda (PNCP). O robô completa a leitura na fila.' })); return caixa; }
    const fed = (v) => (c.federaisComValores ? moeda(v) : '—');
    caixa.append(el(doc, 'div', { class: 'cartoes' },
      cartao(doc, 'Contratos (PNCP)', `${c.total} · ${c.vigentes} vigente(s)`), cartao(doc, 'Valor contratado', moeda(c.valorContratado)),
      cartao(doc, 'Empenhado (federal)', fed(c.empenhado)), cartao(doc, 'Pago (federal)', fed(c.pago)), cartao(doc, 'Faturado (notas no Contratos.gov.br)', fed(c.faturado))));
    if (c.federaisComValores) {
      caixa.append(el(doc, 'p', { class: 'dica-clique', texto: `Empenhado, liquidado (${moeda(c.liquidado)}), pago e faturado de ${c.federaisComValores} contrato(s) federal(is) que somam ${moeda(c.valorContratadoFederal)} contratados (Contratos.gov.br). Estados e municípios não publicam esses valores numa fonte aberta única.` }));
    }
    caixa.append(el(doc, 'details', { class: 'acn-grupo', open: 'open' }, el(doc, 'summary', { texto: `Contratos por estado (${c.porUf.length})` }), rolavel(doc, el(doc, 'table', {},
      el(doc, 'tr', {}, ['Estado (UF da unidade contratante)', 'Contratos', 'Vigentes', 'Valor contratado'].map((t) => el(doc, 'th', { texto: t }))),
      c.porUf.map((g) => el(doc, 'tr', {}, el(doc, 'td', { texto: g.chave }), el(doc, 'td', { texto: String(g.contratos) }), el(doc, 'td', { texto: String(g.vigentes) }), el(doc, 'td', { texto: moeda(g.valor) })))))));
    caixa.append(el(doc, 'details', { class: 'acn-grupo' }, el(doc, 'summary', { texto: `Lista de contratos (${c.total})` }), rolavel(doc, el(doc, 'table', {},
      el(doc, 'tr', {}, ['Contrato', 'Contratante', 'Vigência', 'Valor', 'Empenhado / pago / faturado', 'Fonte'].map((t) => el(doc, 'th', { texto: t }))),
      c.lista.slice(0, MAX_LINHAS).map((x) => linhaContrato(doc, x))))));
    if (c.total > MAX_LINHAS) caixa.append(el(doc, 'p', { class: 'dica-clique', texto: `Lista: os ${MAX_LINHAS} mais recentes de ${c.total}; totais e estados contam todos.` }));
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

  // Camadas do que o painel já tem das disputas deste CNPJ (puro): tudo o que vem do PNCP e dos dados abertos já
  // está aqui (automático); o motivo de recusa só vem do pregão gravado (extensão); o resto exige captcha.
  function camadasCnpj(r, mensagens, propostas) {
    const gravadas = new Map(); // id_compra -> true se verificado (2+ organizações concordando)
    for (const x of [...(Array.isArray(mensagens) ? mensagens : []), ...(Array.isArray(propostas) ? propostas : [])]) {
      gravadas.set(x.id_compra, (gravadas.get(x.id_compra) || false) || leituras(x) >= 2);
    }
    const compras = new Map();
    for (const p of [...r.itensVencidos, ...r.itensNaoVencidos]) {
      const c = compras.get(p.id_compra) || { id_compra: p.id_compra, orgao: p.orgao_nome || p.unidade_nome || (p.uasg && `UASG ${p.uasg}`) || '', link: p.link_origem || null, recusas: 0 };
      if (p._recusada || p._fracassado1) c.recusas++;
      compras.set(p.id_compra, c);
    }
    const lista = [...compras.values()];
    const faltam = lista.filter((c) => c.recusas && !gravadas.has(c.id_compra)).sort((a, b) => b.recusas - a.recusas);
    const nGravadas = lista.filter((c) => gravadas.has(c.id_compra)).length;
    return { compras: lista.length, gravadas: nGravadas, verificadas: lista.filter((c) => gravadas.get(c.id_compra)).length, faltam, comRecusa: lista.filter((c) => c.recusas).length };
  }
  // Mudou o que foi gravado? (para atualizar sozinho quando o usuário volta da página do governo)
  const assinaturaGravado = (mensagens, propostas) => [...(mensagens || []), ...(propostas || [])].reduce((n, x) => n + leituras(x), 0) + '|' + (mensagens || []).length + '|' + (propostas || []).length;

  function blocoCamadas(doc, c) {
    const caixa = el(doc, 'div', { class: 'acn-camadas la-camadas' }, el(doc, 'h3', { texto: 'O que já está aqui, e de onde veio' }));
    const selo = (classe, texto) => caixa.append(el(doc, 'span', { class: 'la-camada ' + classe, texto }));
    selo('la-cam-auto', `Automático: ${c.compras} contratação(ões) (PNCP e dados abertos)`);
    selo(c.gravadas ? (c.verificadas ? 'la-cam-verificado' : 'la-cam-gravado') : 'la-cam-falta', c.gravadas ? `Gravado por clientes: ${c.gravadas} pregão(ões)${c.verificadas ? ` · ${c.verificadas} verificado(s)` : ' · não verificado'}` : 'Gravado por clientes: nenhum ainda');
    selo(c.faltam.length ? 'la-cam-falta' : 'la-cam-ok', c.faltam.length ? `Falta ver (precisa do captcha): ${c.faltam.length} pregão(ões)` : 'Tudo visto');
    const feitos = c.comRecusa - c.faltam.length;
    caixa.append(el(doc, 'p', { class: 'la-completude', texto: `Vencedores e preços ✔ · Motivos de recusa ${c.comRecusa ? (c.faltam.length ? (feitos ? '◐' : '✖') : '✔') : '✔'}${c.comRecusa ? ` (${feitos} de ${c.comRecusa} pregões com recusa)` : ''}${c.faltam.length ? ' — abra o pregão' : ''}` }));
    if (c.faltam.length) {
      caixa.append(el(doc, 'details', {}, el(doc, 'summary', { texto: 'Pregões para abrir e gravar (você resolve o captcha, a extensão grava)' }),
        el(doc, 'ul', { class: 'ficha-lista' }, c.faltam.slice(0, 10).map((f) => el(doc, 'li', {}, `${f.orgao || 'Contratação ' + f.id_compra} · ${f.recusas} recusa(s) `, link(doc, f.link, 'Abrir o pregão') || '')))));
    }
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
    // Contratos: tabela da parte 2 (analise_cnpj_v2.sql); ausente, a tela segue sem contratos.
    const ct = await sb.from('historico_contratos_fornecedor').select('numero_controle_pncp,numero,objeto,orgao_nome,unidade_nome,municipio,uf,esfera,data_assinatura,vigencia_inicio,vigencia_fim,valor_global,valor_empenhado,valor_liquidado,valor_pago,valor_faturado,contratos_gov_id,link_pncp')
      .eq('fornecedor_ni', cnpj).order('data_assinatura', { ascending: false, nullsFirst: false }).limit(1000);
    return { linhas, contratos: ct.error ? [] : ct.data, ...(await lerGravados(sb, cnpj)) };
  }
  async function lerGravados(sb, cnpj) {
    // Tabelas da extensão ausentes (banco sem pregoes_gravados.sql): sem motivos gravados, o resto segue.
    const [msg, prop] = await Promise.all([
      sb.from('pregoes_gravados_mensagens').select('id_compra,numero_item,data_hora,texto,tipo,motivo,leituras_concordantes,pregoes_gravados(url,orgao,itens)')
        .eq('fornecedor_chave', cnpj).in('tipo', ['recusa', 'desclassificacao', 'inabilitacao']).order('data_hora', { ascending: false }).limit(500),
      sb.from('pregoes_gravados_propostas').select('id_compra,numero_item,situacao,leituras_concordantes').eq('cnpj', cnpj).limit(5000),
    ]);
    return { mensagens: msg.error ? [] : msg.data, propostas: prop.error ? [] : prop.data };
  }

  // alvo: container; requisitar(corpo) -> /api/analise-cnpj; sancoes() -> /api/sancoes-cnpj (ou {erro}).
  // sancoesLote(cnpjs) -> { resultados, hoje } (POST /api/sancoes-cnpj): selo de sanção nos vencedores das disputas perdidas.
  async function montar({ alvo, cnpj, ficha, sb, requisitar, sancoes, sancoesLote, hoje, LicitaSancoes }) {
    const doc = alvo.ownerDocument;
    const status = el(doc, 'div', { class: 'carregando', texto: 'Buscando as disputas deste CNPJ no PNCP e no Compras.gov…' });
    alvo.replaceChildren(cabecalho(doc, cnpj, null, ficha), status);
    const [coleta, sanc, cad] = await Promise.all([requisitar({ acao: 'coletar', cnpj }).catch((e) => ({ erro: String(e.message || e) })), sancoes().catch(() => ({ erro: 'indisponível agora' })),
      requisitar({ acao: 'cadastro', cnpj }).then((x) => (x && x.cadastro) || null).catch(() => null)]);
    let dados;
    try { dados = await lerTudo(sb, cnpj); } catch (e) {
      status.replaceWith(el(doc, 'div', { class: 'aviso', texto: `Não foi possível ler o histórico agora (${e.message || e.code || 'erro'}).` }));
      return null;
    }
    const r = resumir(dados.linhas), mot = motivosGravados(dados.mensagens, dados.propostas), ct = resumirContratos(dados.contratos, hoje);
    const vulneraveis = alertasVulnerabilidade({ cadastro: cad, sancoes: sanc && !sanc.erro ? sanc : null, resumo: r, mot, contratos: ct, hoje });
    let selos = null;
    const vencedores = sancoesLote && LicitaSancoes ? cnpjsDosVencedores(r.itensNaoVencidos) : [];
    if (vencedores.length) {
      try { const lote = await sancoesLote(vencedores); if (lote && lote.resultados) selos = { resultados: lote.resultados, hoje: lote.hoje || hoje, LicitaSancoes }; } catch { selos = null; }
    }
    const desenhar = (mot, atualizado) => alvo.replaceChildren(cabecalho(doc, cnpj, cad, ficha), blocoVulnerabilidade(doc, vulneraveis), blocoColeta(doc, coleta, () => montar({ alvo, cnpj, ficha, sb, requisitar, sancoes, sancoesLote, hoje, LicitaSancoes })) || '',
      atualizado ? el(doc, 'p', { class: 'la-atualizado', role: 'status', texto: 'Atualizado com o que você gravou' }) : '',
      blocoCamadas(doc, camadasCnpj(r, mot.mensagens, mot.propostas)),
      blocoAlertas(doc, r, mot, sanc, hoje, LicitaSancoes), blocoParticipacoes(doc, r, selos), blocoContratos(doc, ct), blocoMotivos(doc, r, mot),
      el(doc, 'p', { class: 'dica-clique', texto: 'Fontes: PNCP (resultados e contratos por fornecedor), Contratos.gov.br (empenhos e faturas de contrato federal), base aberta de CNPJ da Receita, dados abertos do Compras.gov, arquivo semanal de propostas (repositorio.dados.gov.br, só itens homologados), CEIS/CNEP da CGU e pregões gravados pela extensão. Outras plataformas (Licitanet, BLL, BNC…) entram só pelo resultado publicado no PNCP: as disputas perdidas nelas não são públicas.' }));
    desenhar(Object.assign(mot, { mensagens: dados.mensagens, propostas: dados.propostas }), false);
    // Voltou da página do governo (foco da janela) e há gravação nova: atualiza sozinho, sem clicar.
    if (alvo.__acnVoltar && global.removeEventListener) global.removeEventListener('focus', alvo.__acnVoltar);
    if (global.addEventListener) {
      let assin = assinaturaGravado(dados.mensagens, dados.propostas), ocupado = false;
      alvo.__acnVoltar = async () => {
        if (ocupado || !alvo.isConnected) return;
        ocupado = true;
        try {
          const novo = await lerGravados(sb, cnpj);
          const a = assinaturaGravado(novo.mensagens, novo.propostas);
          if (a !== assin) { assin = a; desenhar(Object.assign(motivosGravados(novo.mensagens, novo.propostas), novo), true); }
        } catch { /* sem rede agora: fica como está */ } finally { ocupado = false; }
      };
      global.addEventListener('focus', alvo.__acnVoltar);
    }
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

  const api = { resumir, motivosGravados, venceu, posicao, precoFinal, montar, montarEscolha, cnpjsDosVencedores, camadasCnpj, resumirContratos, alertasVulnerabilidade };
  global.LicitaAnaliseCnpj = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
