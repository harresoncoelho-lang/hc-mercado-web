/* global module, document */
// "Licitação anterior": o que aconteceu nas contratações anteriores do mesmo órgão e do mesmo produto.
// Dois usos, o mesmo desenho:
//   montar          cartão dentro do processo (sistema.html): lê com o cliente supabase do usuário (RLS) a
//                   tarefa 'historico' da esteira (casamento item a item) e as tabelas historico_*.
//   montarPesquisa  tela avulsa (painel.html, Inteligência de Mercado): órgão + produto + período pela
//                   função /api/licitacao-anterior.
// Tudo por textContent (o dado vem de fontes externas). Banco sem as tabelas: o cartão fica vazio e oculto.
// Camadas que entram por cima do histórico público (cada uma opcional, falha sem derrubar o cartão):
//   pregões gravados (pregoes_gravados*, docs/pregao-gravado.md): situação e MOTIVO literal de recusa, desclassificação
//   e inabilitação por participante, com o selo "lido por usuário, não verificado" (ou "verificado") e a data, e o aviso
//   "fonte sem HTTPS" quando a leitura veio de página http do ComprasNet antigo;
//   sanções (sancoes-ui.js, /api/sancoes-cnpj em lote): selo CEIS/CNEP no vencedor, na reserva e em cada participante.
(function (global) {
  'use strict';
  const SITUACAO_RUIM = /fracass|desert|cancel|anulad|revogad|suspens/i;
  const moeda = (v) => (Number.isFinite(Number(v)) && v !== null ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—');
  const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const chaveMarca = (m) => semAcento(m).replace(/[^a-z0-9]+/g, ' ').trim();
  const cnpjFormatado = (d) => (/^\d{14}$/.test(String(d || '')) ? String(d).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : '');
  const data = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10).split('-').reverse().join('/') : '');
  const titulo = (m) => String(m).toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

  function tabelaAusente(erro) {
    return Boolean(erro) && (erro.code === '42P01' || erro.code === 'PGRST205' || erro.status === 404);
  }

  // Vencedor: 1º colocado do PNCP ainda válido; sem PNCP (pregão antigo), o 1º do arquivo de propostas ou a
  // linha da Pesquisa de Preços (que só tem o vencedor).
  function vencedorDe(linhas) {
    const validas = linhas.filter((p) => !/cancel/i.test(p.situacao_resultado || ''));
    return validas.find((p) => p.ordem_classificacao === 1) || validas.find((p) => p.classificacao === 1)
      || validas.find((p) => p.ordem_classificacao == null && p.classificacao == null && (p.marca || p.marca_declarada !== undefined)) || null;
  }

  function variacao(de, para) {
    const a = Number(de), b = Number(para);
    if (!(a > 0) || !Number.isFinite(b) || de === null || para === null) return null;
    return Math.round(((b - a) / a) * 1000) / 10;
  }

  // Junta compras, itens, participações e casamentos no que a tela mostra. Puro: testado em node.
  function montarVisao({ compras = [], itens = [], participacoes = [], casamentos = [], alvos = [] } = {}) {
    const alvoPorNumero = new Map(alvos.filter((a) => a && a.numero != null).map((a) => [a.numero, a]));
    const porItem = new Map();
    for (const p of participacoes) {
      const k = `${p.id_compra}|${p.numero_item}`;
      if (!porItem.has(k)) porItem.set(k, []);
      porItem.get(k).push(p);
    }
    const casPorItem = new Map();
    for (const c of casamentos) {
      const k = `${c.id_compra}|${c.numero_item}`;
      if (!casPorItem.has(k)) casPorItem.set(k, []);
      casPorItem.get(k).push(c);
    }
    // Marcas aceitas por produto: no processo, por item do edital; na tela avulsa, um produto só.
    const grupos = new Map();
    const grupo = (alvo) => {
      const k = alvo ? alvo.numero : '*';
      if (!grupos.has(k)) grupos.set(k, { numero: alvo ? alvo.numero : null, descricao: alvo ? alvo.descricao : null, marcas: new Map(), semMarca: 0 });
      return grupos.get(k);
    };
    const geral = { marcas: new Map(), semMarca: 0 };
    const somar = (g, marca, compra) => {
      if (!marca) { g.semMarca++; return; }
      const k = chaveMarca(marca);
      const m = g.marcas.get(k) || { formas: new Map(), vitorias: 0, ultima: '', compras: new Set() };
      m.formas.set(marca, (m.formas.get(marca) || 0) + 1);
      m.vitorias++; m.compras.add(compra.id_compra);
      if (String(compra.data_publicacao || '') > m.ultima) m.ultima = String(compra.data_publicacao || '');
      g.marcas.set(k, m);
    };
    let ruins = 0;
    const lista = compras.map((compra) => {
      const seus = itens.filter((i) => i.id_compra === compra.id_compra && casPorItem.has(`${i.id_compra}|${i.numero_item}`))
        .sort((a, b) => a.numero_item - b.numero_item)
        .map((item) => {
          const linhas = porItem.get(`${item.id_compra}|${item.numero_item}`) || [];
          const ruim = SITUACAO_RUIM.test(item.situacao_item || '');
          // Item fracassado/cancelado não tem vencedor, mesmo com 1º colocado no arquivo de propostas (recusado depois).
          const vencedor = ruim ? null : vencedorDe(linhas);
          const primeiroRecusado = ruim ? linhas.find((p) => p.classificacao === 1) || null : null;
          // A marca é da linha da Pesquisa de Preços do mesmo fornecedor (a linha do vencedor no PNCP não tem marca).
          const marca = vencedor ? (vencedor.marca || linhas.find((p) => p.fornecedor_chave === vencedor.fornecedor_chave && p.marca)?.marca || null) : null;
          const cas = casPorItem.get(`${item.id_compra}|${item.numero_item}`);
          const alvo = cas.map((c) => alvoPorNumero.get(c.item_edital)).find(Boolean) || null;
          if (ruim) ruins++;
          if (vencedor && !ruim) { somar(geral, marca, compra); somar(grupo(alvo), marca, compra); }
          const homologado = vencedor ? vencedor.valor_homologado ?? vencedor.valor_negociado ?? vencedor.valor_lance ?? null : null;
          return {
            item, casamentos: cas, alvo, vencedor, primeiroRecusado, marca, ruim, homologado,
            sobreEstimado: variacao(item.valor_estimado, homologado),
            sobreEstimadoAtual: alvo ? variacao(alvo.valor_estimado, homologado) : null,
            reservas: linhas.filter((p) => p.ordem_classificacao > 1 && !/cancel/i.test(p.situacao_resultado || '')).sort((a, b) => a.ordem_classificacao - b.ordem_classificacao),
            cancelados: linhas.filter((p) => /cancel/i.test(p.situacao_resultado || '')),
            participantes: linhas.filter((p) => p.classificacao != null || p.valor_proposta != null)
              .sort((a, b) => (a.classificacao ?? 1e9) - (b.classificacao ?? 1e9)),
          };
        });
      return { compra, itens: seus };
    }).filter((c) => c.itens.length)
      .sort((a, b) => String(b.compra.data_publicacao || '').localeCompare(String(a.compra.data_publicacao || '')));
    const listar = (marcas) => [...marcas.values()].map((m) => ({
      // Forma mais usada pelos fornecedores; caixa alta inteira vira "Pilão" para a leitura.
      marca: titulo([...m.formas].sort((a, b) => b[1] - a[1])[0][0]), vitorias: m.vitorias, ultima: m.ultima, compras: m.compras.size,
    })).sort((a, b) => b.vitorias - a.vitorias || a.marca.localeCompare(b.marca));
    const porProduto = [...grupos.values()].sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0))
      .map((g) => ({ numero: g.numero, descricao: g.descricao, marcasAceitas: listar(g.marcas), semMarca: g.semMarca }));
    return { compras: lista, marcasAceitas: listar(geral.marcas), semMarca: geral.semMarca, porProduto, ruins };
  }

  // ---------- pregões gravados (extensão) ----------
  const TIPOS_MOTIVO = ['recusa', 'desclassificacao', 'inabilitacao'];
  const ROTULO_TIPO = { recusa: 'Recusa', desclassificacao: 'Desclassificação', inabilitacao: 'Inabilitação' };
  const leituras = (x) => Number(x && x.leituras_concordantes) || 1;
  const chaveItem = (id, n) => `${id}|${n}`;

  // Leitura do navegador (RLS + grant por coluna; nunca select('*')). Tabela ausente ou erro: nada gravado, o cartão segue.
  async function lerGravados(cliente, ids) {
    const vazio = { pregoes: [], propostas: [], mensagens: [] };
    const alvos = [...new Set(ids)].filter((x) => /^\d{17}$/.test(x)).slice(0, 50);
    if (!cliente || !alvos.length) return vazio;
    try {
      const [pg, pr, ms] = await Promise.all([
        cliente.from('pregoes_gravados').select('id_compra,fonte,url,orgao,itens,fonte_sem_https,leituras_concordantes,gravado_em,atualizado_em').in('id_compra', alvos),
        cliente.from('pregoes_gravados_propostas').select('id_compra,numero_item,fornecedor_chave,cnpj,nome,uf,situacao,marca,leituras_concordantes,gravado_em,atualizado_em').in('id_compra', alvos).limit(5000),
        cliente.from('pregoes_gravados_mensagens').select('id_compra,numero_item,fornecedor_chave,data_hora,autor,texto,tipo,motivo,leituras_concordantes,gravado_em').in('id_compra', alvos).in('tipo', TIPOS_MOTIVO).order('data_hora').limit(2000),
      ]);
      return { pregoes: pg.error ? [] : pg.data || [], propostas: pr.error ? [] : pr.data || [], mensagens: ms.error ? [] : ms.data || [] };
    } catch { return vazio; }
  }

  function indexarGravado(g) {
    const idx = { pregoes: new Map(), propostas: new Map(), mensagens: new Map() };
    const juntar = (m, k, x) => { if (!m.has(k)) m.set(k, []); m.get(k).push(x); };
    for (const p of (g && g.pregoes) || []) idx.pregoes.set(p.id_compra, p);
    for (const p of (g && g.propostas) || []) juntar(idx.propostas, chaveItem(p.id_compra, p.numero_item), p);
    for (const m of (g && g.mensagens) || []) if (TIPOS_MOTIVO.includes(m.tipo)) juntar(idx.mensagens, chaveItem(m.id_compra, m.numero_item), m);
    return idx;
  }

  // Quem lê o selo: lido por 1 organização = "não verificado"; 2+ = "verificado" (docs/pregao-gravado.md).
  const seloGravado = (x, semHttps) => ({ verificado: leituras(x) >= 2, leituras: leituras(x), em: String((x && (x.atualizado_em || x.gravado_em)) || '').slice(0, 10), semHttps: Boolean(semHttps) });
  function textoSelo(s) {
    const quando = s.em ? ` · lido em ${data(s.em)}` : '';
    return (s.verificado ? `verificado (${s.leituras} organizações concordando)` : 'lido por usuário, não verificado') + quando;
  }

  // Participantes do item: os do histórico público + os que só a gravação trouxe, com situação e motivos literais.
  function participantesDoItem(v, idx, idCompra) {
    const pg = idx ? idx.pregoes.get(idCompra) || null : null;
    const semHttps = Boolean(pg && pg.fonte_sem_https);
    const k = chaveItem(idCompra, v.item.numero_item);
    const mapa = new Map();
    const dono = (chave) => {
      if (!mapa.has(chave)) mapa.set(chave, { chave, nome: null, ni: null, uf: null, porte: null, classificacao: null, valor_proposta: null, final: null, situacao: null, marcaLida: null, selo: null, motivos: [] });
      return mapa.get(chave);
    };
    for (const p of v.participantes) {
      Object.assign(dono(p.fornecedor_chave), { nome: p.fornecedor_nome, ni: p.fornecedor_ni, uf: p.uf, porte: p.porte, classificacao: p.classificacao,
        valor_proposta: p.valor_proposta, final: p.valor_negociado ?? p.valor_lance ?? p.valor_proposta });
    }
    for (const g of (idx && idx.propostas.get(k)) || []) {
      const e = dono(g.fornecedor_chave);
      e.nome = e.nome || g.nome; e.ni = e.ni || g.cnpj || null; e.uf = e.uf || g.uf; e.situacao = g.situacao || e.situacao; e.marcaLida = g.marca || null; e.selo = seloGravado(g, semHttps);
    }
    const doItem = [];
    for (const m of (idx && idx.mensagens.get(k)) || []) {
      const motivo = { tipo: m.tipo, texto: m.motivo || m.texto, quando: m.data_hora, selo: seloGravado(m, semHttps) };
      if (m.fornecedor_chave) dono(m.fornecedor_chave).motivos.push(motivo); else doItem.push(motivo);
    }
    const lista = [...mapa.values()].sort((a, b) => (a.classificacao ?? 1e9) - (b.classificacao ?? 1e9));
    const itemGravado = pg && pg.itens ? pg.itens[String(v.item.numero_item)] : null;
    return { lista, doItem, pregao: pg, itemLido: Boolean(itemGravado && itemGravado.propostas_lidas_em) || lista.some((e) => e.selo) || doItem.length > 0, temMotivo: lista.some((e) => e.motivos.length) || doItem.length > 0 };
  }

  // CNPJs da visão para o selo de sanção em lote (até 200, vencedores primeiro).
  function cnpjsDaVisao(visao, idx) {
    const vistos = new Set();
    const add = (ni) => { if (/^\d{14}$/.test(String(ni || ''))) vistos.add(String(ni)); };
    for (const { compra, itens } of visao.compras) {
      for (const v of itens) {
        if (v.vencedor) add(v.vencedor.fornecedor_ni);
        for (const p of v.reservas) add(p.fornecedor_ni);
        for (const p of v.participantes) add(p.fornecedor_ni);
        for (const p of (idx && idx.propostas.get(chaveItem(compra.id_compra, v.item.numero_item))) || []) add(p.cnpj);
      }
    }
    return [...vistos].slice(0, 200);
  }

  // Consulta em lote dos selos (POST /api/sancoes-cnpj). Devolve { resultados, hoje } ou null: sem selo, o cartão segue.
  function sancoesEmLote(cliente, buscar) {
    return async (cnpjs) => {
      if (!cliente || !cnpjs.length) return null;
      const { data: sessao } = await cliente.auth.getSession();
      const token = sessao && sessao.session && sessao.session.access_token;
      if (!token) return null;
      const r = await (buscar || global.fetch)('/api/sancoes-cnpj', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ cnpjs }) });
      if (!r.ok) return null;
      const json = await r.json();
      return json && json.resultados ? { resultados: json.resultados, hoje: json.hoje } : null;
    };
  }

  // Camadas opcionais da visão: pregões gravados e sanções. Cada falha só tira a camada.
  async function carregarExtras(visao, { cliente, sancoes }) {
    const gravado = indexarGravado(await lerGravados(cliente, visao.compras.map((c) => c.compra.id_compra)).catch(() => null));
    let selos = null;
    if (sancoes) { try { selos = await sancoes(cnpjsDaVisao(visao, gravado)); } catch { selos = null; } }
    return { gravado, sancoes: selos };
  }

  // ---------- camadas e completude por pregão (puro, testado em node) ----------
  const ROTULOS_COMPLETUDE = ['Vencedor', 'Preços', 'Marcas', 'Todos os participantes', 'Motivos de recusa'];
  const estadoDe = (n, total) => (!total ? 'na' : n >= total ? 'ok' : n ? 'parcial' : 'falta');
  // De onde veio cada pedaço do pregão: automático (PNCP, dados abertos, ComprasNet antigo sem captcha), gravado
  // (extensão, verificado ou não) e o que ainda falta ver (só a página do governo, com captcha, mostra).
  function camadasDoPregao(compra, itens, idx) {
    const pg = (idx && idx.pregoes.get(compra.id_compra)) || null;
    const lidos = itens.filter((v) => participantesDoItem(v, idx, compra.id_compra).itemLido).length;
    const automatico = [compra.fonte === 'comprasnet-antigo' && 'ComprasNet antigo', linkOficial(compra.link_pncp) && 'PNCP', 'Dados abertos'].filter(Boolean);
    return { automatico, gravado: pg ? { ...seloGravado(pg, pg.fonte_sem_https), itensLidos: lidos, itensTotal: itens.length } : null, faltam: itens.length - lidos };
  }
  // "Vencedor ✔ · Preços ✔ · Marcas ✔ · Todos os participantes ✔ · Motivos de recusa ✖": calculado do que existe aqui.
  function completudeDoPregao(compra, itens, idx) {
    const uteis = itens.filter((v) => !v.ruim);
    const partes = itens.map((v) => participantesDoItem(v, idx, compra.id_compra));
    const quantos = (lista, f) => lista.filter(f).length;
    const estados = [
      estadoDe(quantos(uteis, (v) => v.vencedor), uteis.length),
      estadoDe(quantos(uteis, (v) => v.homologado != null), uteis.length),
      estadoDe(quantos(uteis, (v) => v.vencedor && v.marca), uteis.length),
      estadoDe(quantos(partes, (p) => p.itemLido || p.lista.length >= 2), itens.length),
      estadoDe(quantos(partes, (p) => p.itemLido), itens.length),
    ];
    return ROTULOS_COMPLETUDE.map((rotulo, i) => ({ rotulo, estado: estados[i] })).filter((x) => x.estado !== 'na');
  }
  // Mudou o que foi gravado desde a última leitura? (conta, leituras concordantes e a gravação mais recente)
  function assinaturaGravado(idx) {
    if (!idx) return '';
    const todos = [...idx.pregoes.values(), ...[...idx.propostas.values()].flat(), ...[...idx.mensagens.values()].flat()];
    const itensLidos = [...idx.pregoes.values()].reduce((n, p) => n + Object.values(p.itens || {}).filter((i) => i && i.propostas_lidas_em).length, 0);
    return [todos.length, itensLidos, todos.reduce((n, x) => n + leituras(x), 0), todos.map((x) => String(x.atualizado_em || x.gravado_em || '')).sort().pop() || ''].join('|');
  }
  // Quando a janela volta ao foco (o usuário voltou da página do governo): confere só as gravações e, se mudaram,
  // redesenha sozinho. shortcut: redesenhar fecha os <details> que o usuário abriu; trocar por patch só se incomodar.
  function aoVoltar(verificar) {
    if (typeof global.addEventListener !== 'function') return () => {};
    let ocupado = false, ultimo = 0;
    const rodar = async () => {
      if (ocupado || (document && document.hidden) || Date.now() - ultimo < 3000) return;
      ocupado = true; ultimo = Date.now();
      try { await verificar(); } catch { /* sem rede agora: fica como está */ } finally { ocupado = false; }
    };
    global.addEventListener('focus', rodar);
    if (document && document.addEventListener) document.addEventListener('visibilitychange', rodar);
    return () => { global.removeEventListener('focus', rodar); if (document && document.removeEventListener) document.removeEventListener('visibilitychange', rodar); };
  }
  async function recarregarSeMudou(estado, { cliente, sancoes }, redesenhar) {
    if (!estado.visao) return false;
    const leve = await carregarExtras(estado.visao, { cliente, sancoes: null });
    const nova = assinaturaGravado(leve.gravado);
    if (nova === estado.assinatura) return false;
    estado.assinatura = nova;
    await redesenhar(sancoes ? await carregarExtras(estado.visao, { cliente, sancoes }) : leve);
    return true;
  }

  // ---------- desenho ----------
  function el(tag, classe, texto) {
    const n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texto !== undefined && texto !== null) n.textContent = texto;
    return n;
  }
  // link_origem vem de dado externo (PNCP): só https e hosts oficiais (mesma lista de _licitacao_anterior.js).
  const HOSTS_OFICIAIS = ['pncp.gov.br', 'dadosabertos.compras.gov.br', 'contratos.comprasnet.gov.br',
    'cnetmobile.estaleiro.serpro.gov.br', 'comprasnet.gov.br', 'www.comprasnet.gov.br'];
  function linkOficial(u) {
    try {
      const url = new globalThis.URL(String(u || ''));
      return url.protocol === 'https:' && HOSTS_OFICIAIS.includes(url.hostname) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  }
  function link(href, texto) {
    const a = el('a', 'la-link', texto);
    a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  }
  // ---------- "Ver tudo do pregão (você resolve o captcha)" ----------
  // Só abre a página oficial em outra aba: o captcha é do usuário, nada é resolvido nem lido por aqui.
  // Quem lê e grava é a extensão no navegador dele (extensao-leitura/, docs/pregao-gravado.md).
  const COMPRASGOV_ACOMPANHAR = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra';
  const COMPRASNET_ATA = 'https://www.comprasnet.gov.br/livre/pregao/AtaEletronico.asp';
  // Formato do mapa do ComprasNet antigo: co_no_uasg=&uasg=&numprp=<número><ano>&codigoModalidade=5&Seq=1 (sem zeros no número).
  function urlsVerTudo(compra) {
    const m = /^(\d{6})(\d{2})(\d{5})(\d{4})$/.exec(String((compra && compra.id_compra) || ''));
    if (!m) return null;
    const antigo = compra.fonte === 'comprasnet-antigo' || compra.plataforma === 'ComprasNet (antigo)'
      || (m[2] === '05' && m[3][0] !== '9' && Number(m[4]) <= 2023);
    if (antigo) {
      const q = new globalThis.URLSearchParams({ co_no_uasg: m[1], uasg: m[1], numprp: `${Number(m[3])}${m[4]}`, codigoModalidade: '5', Seq: '1' });
      return { tipo: 'comprasnet-antigo', rotulo: 'Abrir a ata completa no ComprasNet', url: `${COMPRASNET_ATA}?${q}` };
    }
    return { tipo: 'comprasgov', rotulo: 'Abrir "Acompanhar contratação" no Compras.gov', url: `${COMPRASGOV_ACOMPANHAR}?compra=${m[0]}` };
  }
  const PASSOS_VER_TUDO = [
    { icone: 'captcha', texto: 'Resolva o captcha na página do governo.' },
    { icone: 'extensao', texto: 'Clique no botão da extensão LicitaPlena: "Ler esta página e gravar".' },
    { icone: 'atualizar', texto: 'Volte aqui: este painel atualiza sozinho e mostra tudo junto (vale para todos os clientes).' },
  ];
  const ICONES = {
    captcha: 'M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5l8-3zm-1 13l-3-3 1.4-1.4L11 12.2l3.6-3.6L16 10l-5 5z',
    extensao: 'M20.5 11H19V7a2 2 0 0 0-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4a2 2 0 0 0-2 2v3.8h1.5a2.7 2.7 0 0 1 0 5.4H2V20a2 2 0 0 0 2 2h3.8v-1.5a2.7 2.7 0 0 1 5.4 0V22H17a2 2 0 0 0 2-2v-4h1.5a2.5 2.5 0 0 0 0-5z',
    atualizar: 'M17.65 6.35A8 8 0 1 0 19.73 14h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  };
  function icone(nome) {
    if (!document.createElementNS) return el('span'); // DOM de teste sem SVG
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '22'); svg.setAttribute('height', '22'); svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', ICONES[nome]); p.setAttribute('fill', 'currentColor');
    svg.append(p);
    return svg;
  }
  function blocoVerTudo(compra, atualizar) {
    const alvo = urlsVerTudo(compra);
    if (!alvo) return null;
    const det = el('div', 'la-vertudo');
    det.append(el('h4', 'la-vertudo-titulo', 'Ver tudo do pregão (você resolve o captcha)'));
    const acoes = el('p', 'la-links');
    const abrir = link(alvo.url, alvo.rotulo); abrir.className = 'la-link la-botao la-primario';
    acoes.append(abrir);
    if (atualizar) {
      const b = el('button', 'la-botao', 'Atualizar'); b.type = 'button';
      b.addEventListener('click', async () => { b.disabled = true; b.textContent = 'Atualizando…'; try { await atualizar(); } finally { b.disabled = false; b.textContent = 'Atualizar'; } });
      acoes.append(b);
    }
    det.append(acoes);
    const ol = el('ol', 'la-passos');
    for (const p of PASSOS_VER_TUDO) { const li = el('li'); li.append(icone(p.icone), el('span', null, p.texto)); ol.append(li); }
    det.append(ol);
    const ext = el('p', 'la-fonte');
    const como = el('a', 'la-link', 'Como instalar a extensão'); como.href = 'extensao.html'; como.target = '_blank'; como.rel = 'noopener';
    ext.append('Ainda não tem a extensão? ', como, '. O LicitaPlena não resolve captcha por você.');
    det.append(ext);
    return det;
  }
  const SIMBOLO = { ok: '✔', parcial: '◐', falta: '✖' };
  function selosDoPregao(compra, itens, idx) {
    const c = camadasDoPregao(compra, itens, idx), comp = completudeDoPregao(compra, itens, idx);
    const caixa = el('div', 'la-camadas');
    const selo = (classe, texto) => caixa.append(el('span', 'la-camada ' + classe, texto));
    selo('la-cam-auto', `Automático: ${c.automatico.join(' · ')}`);
    if (c.gravado) selo(c.gravado.verificado ? 'la-cam-verificado' : 'la-cam-gravado', `Gravado por clientes · ${c.gravado.verificado ? 'verificado' : 'não verificado'} · ${c.gravado.itensLidos} de ${c.gravado.itensTotal} itens`);
    selo(c.faltam ? 'la-cam-falta' : 'la-cam-ok', c.faltam ? `Falta ver (precisa do captcha): ${c.faltam} item(ns)` : 'Tudo visto');
    const lista = el('p', 'la-completude');
    comp.forEach((x, i) => lista.append(el('span', 'la-comp la-comp-' + x.estado, `${x.rotulo} ${SIMBOLO[x.estado]}`), i < comp.length - 1 ? ' · ' : ''));
    if (comp.some((x) => x.estado !== 'ok' && /participantes|Motivos/.test(x.rotulo))) lista.append(el('span', 'la-comp-dica', ' — abra o pregão'));
    caixa.append(lista);
    return { caixa, faltam: c.faltam };
  }
  const pct = (v) => (v === null ? '' : ` (${v > 0 ? '+' : ''}${String(v).replace('.', ',')}%)`);
  function fornecedorTexto(p) {
    return [p.fornecedor_nome || 'Fornecedor', cnpjFormatado(p.fornecedor_ni), p.porte, p.uf].filter(Boolean).join(' · ');
  }

  function seloSancao(extras, ni) {
    const r = extras && extras.sancoes && extras.sancoes.resultados && extras.sancoes.resultados[ni];
    return r && global.LicitaSancoes ? global.LicitaSancoes.montarSelo(document, r, extras.sancoes.hoje) : null;
  }
  // "lido por usuário, não verificado" / "verificado" + data; "fonte sem HTTPS" quando a leitura veio de página http.
  function seloLeitura(s) {
    const caixa = el('span', 'la-selo-leitura' + (s.verificado ? ' la-verificado' : ' la-nao-verificado'), textoSelo(s));
    if (s.semHttps) caixa.append(' ', el('span', 'la-sem-https', 'fonte sem HTTPS (página http do ComprasNet antigo; pode ter sido alterada no caminho)'));
    return caixa;
  }
  function linhaMotivo(m) {
    const p = el('p', 'la-motivo');
    p.append(el('strong', null, `${ROTULO_TIPO[m.tipo] || m.tipo}${m.quando ? ' em ' + data(m.quando) : ''}: `), el('q', null, m.texto), ' ', seloLeitura(m.selo));
    return p;
  }

  function desenharParticipantes(box, v, extras, idCompra) {
    const part = participantesDoItem(v, extras && extras.gravado, idCompra);
    if (!part.lista.length && !part.doItem.length) return part;
    const det = el('details', 'la-participantes');
    det.open = part.temMotivo;
    det.append(el('summary', null, `Todos os participantes (${part.lista.length})`));
    // Sem gravação o porquê da recusa só existe no pregão (captcha); com gravação, vem por participante abaixo.
    if (!part.pregao && part.lista.some((p) => !p.classificacao)) det.append(el('p', 'la-fonte', 'Não classificado: proposta recusada, desclassificada, inabilitada ou desistente. O motivo fica no pregão (exige captcha); grave com a extensão para ele aparecer aqui.'));
    for (const m of part.doItem) det.append(linhaMotivo(m));
    const ol = el('ol', 'la-lista');
    for (const p of part.lista) {
      const li = el('li');
      const rotulo = p.classificacao ? `${p.classificacao}º` : p.selo ? 'lido do pregão gravado' : 'não classificado';
      li.append(`${rotulo} · ${[p.nome || 'Fornecedor', cnpjFormatado(p.ni), p.porte, p.uf].filter(Boolean).join(' · ')}` +
        (p.valor_proposta != null ? ` · proposta ${moeda(p.valor_proposta)} · final ${moeda(p.final)}` : ''));
      if (p.situacao) li.append(' · ', el('span', 'la-situacao-participante', `situação: ${p.situacao}`), ' ', p.selo ? seloLeitura(p.selo) : '');
      if (p.marcaLida) li.append(' · marca lida: ', el('span', 'la-marca', p.marcaLida));
      for (const m of p.motivos) li.append(linhaMotivo(m));
      const sanc = p.ni ? seloSancao(extras, p.ni) : null;
      if (sanc) li.append(sanc);
      ol.append(li);
    }
    det.append(ol);
    box.append(det);
    return part;
  }

  function desenharItem(v, comEdital, extras, idCompra) {
    const box = el('div', 'la-item' + (v.ruim ? ' la-item-ruim' : ''));
    const topo = el('p', 'la-item-topo');
    topo.append(el('strong', null, `Item ${v.item.numero_item}`), ` ${String(v.item.descricao || '').slice(0, 140)}`);
    box.append(topo);
    const meta = el('p', 'la-meta');
    const sit = el('span', 'la-situacao' + (v.ruim ? ' la-ruim' : ''), v.item.situacao_item || 'Situação não informada');
    meta.append(sit);
    const c = v.casamentos[0];
    meta.append(el('span', `la-confianca la-${c.confianca}`, `${c.confianca === 'alta' ? 'Casamento alto' : c.confianca === 'media' ? 'Casamento médio' : 'Casamento baixo'}: ${c.regra}`));
    if (comEdital && v.casamentos.some((x) => x.item_edital != null)) {
      meta.append(el('span', 'la-edital', `item ${[...new Set(v.casamentos.map((x) => x.item_edital).filter((x) => x != null))].join(', ')} do edital atual`));
    }
    box.append(meta);
    const precos = el('p', 'la-precos');
    precos.textContent = `Estimado ${moeda(v.item.valor_estimado)} · Homologado ${moeda(v.homologado)}${pct(v.sobreEstimado)}` +
      (v.alvo && v.alvo.valor_estimado ? ` · Estimado agora ${moeda(v.alvo.valor_estimado)}${v.sobreEstimadoAtual === null ? '' : ` (vencedor anterior ${pct(v.sobreEstimadoAtual).trim()} do estimado de agora)`}` : '');
    box.append(precos);
    if (v.vencedor) {
      const venc = el('p', 'la-vencedor');
      venc.append(el('strong', null, 'Vencedor: '), fornecedorTexto(v.vencedor), ' · Marca: ', el('span', v.marca ? 'la-marca' : 'la-marca la-sem', v.marca || 'não informada'));
      box.append(venc);
      const sancVenc = seloSancao(extras, v.vencedor.fornecedor_ni);
      if (sancVenc) box.append(sancVenc);
    } else if (v.primeiroRecusado) {
      const gravadoDele = participantesDoItem(v, extras && extras.gravado, idCompra).lista.find((e) => e.chave === v.primeiroRecusado.fornecedor_chave && e.motivos.length);
      box.append(el('p', 'la-cancelado', `1º colocado não levou o item (${fornecedorTexto(v.primeiroRecusado)}).` +
        (gravadoDele ? ' O motivo lido do pregão gravado está nos participantes abaixo.' : ' O motivo fica no pregão (exige captcha); grave com a extensão para ele aparecer aqui.')));
    } else if (!v.ruim) box.append(el('p', 'la-apoio', 'Sem resultado publicado para este item.'));
    if (v.reservas.length) {
      box.append(el('p', 'la-reservas', 'Cadastro reserva: ' + v.reservas.slice(0, 3).map((p) => `${p.ordem_classificacao}º ${fornecedorTexto(p)} ${moeda(p.valor_homologado)}`).join('; ')));
      for (const p of v.reservas.slice(0, 3)) { const s = seloSancao(extras, p.fornecedor_ni); if (s) box.append(s); }
    }
    if (v.item.motivo_situacao) {
      box.append(el('p', 'la-cancelado', `Motivo (termo de adjudicação do ComprasNet): ${v.item.motivo_situacao}${v.item.tem_recurso ? ' · item com recurso' : ''}`));
    } else if (v.item.tem_recurso) box.append(el('p', 'la-cancelado', 'Item com recurso no termo de adjudicação do ComprasNet.'));
    for (const p of v.cancelados) {
      box.append(el('p', 'la-cancelado', `Resultado cancelado (${fornecedorTexto(p)})${p.motivo_cancelamento ? ': ' + p.motivo_cancelamento : ''}`));
    }
    const part = desenharParticipantes(box, v, extras, idCompra);
    if (part.pregao && !part.itemLido) {
      box.append(el('p', 'la-apoio', `Item ${v.item.numero_item} não foi aberto na gravação do pregão: abra o item e grave com a extensão para ler os motivos.`));
    }
    return box;
  }

  function desenhar(alvo, visao, { comEdital = false, rodape = '', extras = null, atualizar = null, atualizado = false } = {}) {
    const raiz = el('div', 'la');
    if (atualizado) { const a = el('p', 'la-atualizado', 'Atualizado com o que você gravou'); a.setAttribute('role', 'status'); raiz.append(a); }
    if (!visao.compras.length) {
      raiz.append(el('p', 'la-apoio', 'Nenhuma contratação anterior deste órgão com este produto foi encontrada nos últimos anos.'));
      alvo.replaceChildren(raiz);
      return;
    }
    const resumo = el('p', 'la-apoio', `${visao.compras.length} contratação(ões) anterior(es)` + (visao.ruins ? ` · ${visao.ruins} item(ns) fracassado(s), deserto(s) ou cancelado(s)` : ''));
    raiz.append(resumo);
    const marcas = el('div', 'la-marcas');
    marcas.append(el('h3', 'la-subtitulo', 'Marcas aceitas por este órgão'));
    const chipsDe = (g) => {
      const chips = el('p', 'la-chips');
      for (const m of g.marcasAceitas) chips.append(el('span', 'la-chip', `${m.marca} · ${m.vitorias} item(ns)${m.ultima ? ' · ' + m.ultima.slice(0, 4) : ''}`));
      if (g.semMarca) chips.append(el('span', 'la-chip la-sem', `marca não informada · ${g.semMarca}`));
      if (!g.marcasAceitas.length && !g.semMarca) chips.append(el('span', 'la-apoio', 'Nenhuma marca vencedora registrada.'));
      return chips;
    };
    const produtos = (visao.porProduto || []).filter((g) => g.numero != null);
    if (produtos.length) {
      // Por item do edital: só os que têm marca declarada ficam à vista; o resto vai no resumo.
      const lista = el('ul', 'la-produtos');
      for (const g of produtos.filter((x) => x.marcasAceitas.length)) {
        const li = el('li');
        li.append(el('span', 'la-produto', `Item ${g.numero} do edital${g.descricao ? ' · ' + String(g.descricao).slice(0, 60) : ''}`), chipsDe(g));
        lista.append(li);
      }
      const sem = produtos.filter((x) => !x.marcasAceitas.length).length;
      if (lista.children.length) marcas.append(lista);
      if (sem) marcas.append(el('p', 'la-apoio', `${sem} item(ns) do edital sem marca vencedora informada nas compras anteriores.`));
    } else marcas.append(chipsDe(visao));
    marcas.append(el('p', 'la-fonte', 'Fonte: marca declarada pelo vencedor na Pesquisa de Preços do Compras.gov (dados abertos).'));
    raiz.append(marcas);
    // Edital grande casa dezenas de itens por compra: cada compra abre e fecha; a mais recente vem aberta.
    visao.compras.forEach(({ compra, itens }, posicao) => {
      const art = el('article', 'la-compra');
      const cab = el('div', 'la-compra-topo');
      cab.append(el('h3', 'la-subtitulo', `${compra.modalidade || 'Contratação'} ${compra.numero || ''}`.trim()));
      cab.append(el('p', 'la-meta-compra', [compra.unidade_nome, compra.plataforma, compra.situacao, data(compra.data_publicacao) && `publicada em ${data(compra.data_publicacao)}`].filter(Boolean).join(' · ')));
      const links = el('p', 'la-links');
      const origem = linkOficial(compra.link_origem), pncp = linkOficial(compra.link_pncp);
      if (origem) links.append(link(origem, compra.plataforma === 'ComprasNet (antigo)' ? 'Abrir pregão anterior no ComprasNet' : 'Abrir pregão anterior no Compras.gov'));
      if (pncp) links.append(link(pncp, 'Ver no PNCP'));
      cab.append(links);
      art.append(cab);
      if (compra.objeto) art.append(el('p', 'la-objeto', String(compra.objeto).slice(0, 300)));
      const selos = selosDoPregao(compra, itens, extras && extras.gravado);
      art.append(selos.caixa);
      const vertudo = selos.faltam ? blocoVerTudo(compra, atualizar) : null;
      if (vertudo) art.append(vertudo);
      const gravada = extras && extras.gravado && extras.gravado.pregoes.get(compra.id_compra);
      if (gravada) {
        const aviso = el('p', 'la-aviso', 'Gravado por clientes do LicitaPlena: os motivos aparecem em cada participante. ');
        aviso.append(seloLeitura(seloGravado(gravada, gravada.fonte_sem_https)));
        art.append(aviso);
      } else {
        const aviso = el('p', 'la-aviso', 'Motivos de desclassificação: ');
        if (origem) aviso.append(link(origem, 'abra o pregão'), ' (exige captcha)'); else aviso.append('abra o pregão (exige captcha)');
        aviso.append(' e grave com a extensão do LicitaPlena: o motivo passa a aparecer aqui.');
        art.append(aviso);
      }
      if (compra.fonte === 'comprasnet-antigo') {
        art.append(el('p', 'la-fonte', 'Marca, situação e vencedor lidos das páginas públicas do ComprasNet antigo (sem captcha)' + (compra.fonte_lida_em ? ` em ${data(compra.fonte_lida_em)}` : '') + '.'));
      }
      const lista = el('details', 'la-itens');
      lista.open = posicao === 0;
      const ruins = itens.filter((v) => v.ruim).length;
      lista.append(el('summary', null, `${itens.length} item(ns) deste produto` + (ruins ? ` · ${ruins} fracassado(s)/deserto(s)/cancelado(s)` : '')));
      for (const v of itens) lista.append(desenharItem(v, comEdital, extras, compra.id_compra));
      art.append(lista);
      raiz.append(art);
    });
    raiz.append(el('p', 'la-fonte', 'Fontes: PNCP (itens e resultados), Pesquisa de Preços e arquivo semanal de propostas do Compras.gov (dados abertos). ' + rodape));
    alvo.replaceChildren(raiz);
  }

  // O PostgREST devolve no máximo 1.000 linhas por pedido: um edital de 60 itens passa disso só nas participações.
  // shortcut: teto de 20 páginas (20 mil linhas); acima disso o cartão mostra o que veio.
  async function lerTudo(cliente, tabela, ids, ordem) {
    const linhas = [];
    for (let de = 0; de < 20000; de += 1000) {
      let q = cliente.from(tabela).select('*').in('id_compra', ids);
      for (const col of ordem.split(',')) q = q.order(col);
      const r = await q.range(de, de + 999);
      if (r.error) return r;
      linhas.push(...r.data);
      if (r.data.length < 1000) break;
    }
    return { data: linhas, error: null };
  }

  // ---------- cartão do processo ----------
  function montar({ alvo, contexto, cliente, sancoes }) {
    let vivo = true;
    const titulo = () => el('h2', 'app-subtitulo', 'Licitação anterior');
    async function carregar() {
      if (!cliente || !contexto?.processoId) return;
      const t = await cliente.from('operacao_esteira_tarefas').select('estado,detalhe,erro').eq('processo_id', contexto.processoId).eq('etapa', 'historico').maybeSingle();
      if (!vivo) return;
      if (t.error || !t.data) { alvo.replaceChildren(); return; }
      const corpo = el('div');
      alvo.replaceChildren(titulo(), corpo);
      const tarefa = t.data;
      if (tarefa.estado !== 'feito') {
        corpo.append(el('p', 'la-apoio', tarefa.estado === 'falhou' ? 'Não consegui buscar a licitação anterior deste órgão.' : 'Procurando as licitações anteriores deste órgão…'));
        return;
      }
      const d = tarefa.detalhe || {};
      const ids = Array.isArray(d.compras) ? d.compras.slice(0, 50) : [];
      if (!ids.length) { desenhar(corpo, montarVisao({})); return; }
      const [c, i, p] = await Promise.all([['historico_compras', 'id_compra'], ['historico_itens', 'id_compra,numero_item'],
        ['historico_participacoes', 'id_compra,numero_item,fornecedor_chave']].map(([tab, ordem]) => lerTudo(cliente, tab, ids, ordem)));
      if (!vivo) return;
      const erro = c.error || i.error || p.error;
      if (erro) { if (tabelaAusente(erro)) alvo.replaceChildren(); else corpo.replaceChildren(el('p', 'la-apoio', 'Não consegui carregar a licitação anterior agora.')); return; }
      const visao = montarVisao({ compras: c.data, itens: i.data, participacoes: p.data, casamentos: d.casamentos || [], alvos: d.alvos || [] });
      const extras = await carregarExtras(visao, { cliente, sancoes: sancoes || sancoesEmLote(cliente) });
      if (!vivo) return;
      estado.visao = visao; estado.assinatura = assinaturaGravado(extras.gravado);
      const rodape = d.gerado_em ? `Montado em ${data(d.gerado_em)}.` : '';
      estado.redesenhar = async (ex, atualizado) => { if (vivo) desenhar(corpo, visao, { comEdital: true, extras: ex, atualizar: carregar, rodape, atualizado }); };
      await estado.redesenhar(extras, false);
    }
    const estado = { visao: null, assinatura: '', redesenhar: null };
    carregar().catch(() => { if (vivo) alvo.replaceChildren(); });
    const parar = aoVoltar(() => vivo && recarregarSeMudou(estado, { cliente, sancoes: sancoes || sancoesEmLote(cliente) }, (ex) => estado.redesenhar(ex, true)));
    return { fechar() { vivo = false; parar(); } };
  }

  // ---------- tela avulsa ----------
  function montarPesquisa({ alvo, requisitar, cliente, sancoes }) {
    const form = el('form', 'la-form');
    form.noValidate = true;
    const campo = (rotulo, entrada) => { const l = el('label', 'la-campo', rotulo); l.append(entrada); return l; };
    const orgao = el('input'); orgao.name = 'orgao'; orgao.placeholder = 'Código UASG, nome ou CNPJ do órgão'; orgao.maxLength = 80; orgao.autocomplete = 'off';
    const buscarOrgao = el('button', 'la-botao', 'Buscar órgão'); buscarOrgao.type = 'button';
    const unidade = el('select'); unidade.name = 'uasg';
    unidade.append(new global.Option('Busque o órgão primeiro', ''));
    const catmat = el('input'); catmat.name = 'catmat'; catmat.placeholder = 'Ex.: 463574'; catmat.inputMode = 'numeric'; catmat.maxLength = 12;
    const palavras = el('input'); palavras.name = 'palavras'; palavras.placeholder = 'Ex.: café torrado moído'; palavras.maxLength = 120;
    const anos = el('select'); anos.name = 'anos';
    for (const n of [3, 2, 1]) anos.append(new global.Option(`Últimos ${n} ano${n > 1 ? 's' : ''}`, String(n)));
    const consultar = el('button', 'la-botao la-primario', 'Consultar licitações anteriores'); consultar.type = 'submit';
    const linhaOrgao = el('div', 'la-linha'); linhaOrgao.append(campo('Órgão', orgao), buscarOrgao);
    form.append(linhaOrgao, campo('Unidade compradora (UASG)', unidade), campo('Produto: código CATMAT', catmat), campo('ou palavras do produto', palavras), campo('Período', anos), consultar);
    const estado = el('p', 'la-apoio'); estado.setAttribute('role', 'status'); estado.setAttribute('aria-live', 'polite');
    const resultado = el('div');
    alvo.replaceChildren(form, estado, resultado);
    let ocupado = false;
    async function chamar(corpo) {
      try { return await requisitar(corpo); } catch (e) { return { erro: e && e.message ? e.message : 'Não foi possível consultar agora.' }; }
    }
    buscarOrgao.addEventListener('click', async () => {
      if (ocupado) return;
      ocupado = true; estado.textContent = 'Buscando o órgão…';
      const r = await chamar({ acao: 'orgaos', q: orgao.value });
      ocupado = false;
      unidade.replaceChildren();
      const lista = Array.isArray(r.orgaos) ? r.orgaos : [];
      if (!lista.length) { unidade.append(new global.Option(r.erro || 'Nenhuma unidade encontrada', '')); estado.textContent = r.erro || 'Nenhuma unidade encontrada. Tente o código UASG.'; return; }
      for (const o of lista) unidade.append(new global.Option(`${o.uasg} · ${o.nome}`, o.uasg));
      estado.textContent = `${lista.length} unidade(s) encontrada(s).`;
    });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (ocupado) return;
      if (!unidade.value) { estado.textContent = 'Escolha a unidade compradora.'; return; }
      ocupado = true; consultar.disabled = true;
      estado.textContent = 'Consultando PNCP e Compras.gov… pode levar até um minuto.';
      const r = await chamar({ acao: 'consultar', uasg: unidade.value, catmat: catmat.value, palavras: palavras.value, anos: Number(anos.value) });
      ocupado = false; consultar.disabled = false;
      if (r.erro) { estado.textContent = r.erro; resultado.replaceChildren(); return; }
      estado.textContent = (r.guardado ? 'Resultado guardado' : 'Consulta feita agora') + (r.gerado_em ? ` em ${data(r.gerado_em)}` : '') +
        (r.situacao === 'parcial' ? '. Os demais participantes (arquivo semanal de propostas) entram na próxima rodada do robô.' : '.');
      const visao = montarVisao(r);
      const extras = await carregarExtras(visao, { cliente, sancoes: sancoes || (cliente ? sancoesEmLote(cliente) : null) });
      const sanc = sancoes || (cliente ? sancoesEmLote(cliente) : null);
      const redesenhar = async (ex, atualizado) => desenhar(resultado, visao, { rodape: (r.avisos || []).join(' '), extras: ex, atualizado, atualizar: async () => redesenhar(await carregarExtras(visao, { cliente, sancoes: sanc })) });
      lido.visao = visao; lido.assinatura = assinaturaGravado(extras.gravado); lido.redesenhar = redesenhar;
      await redesenhar(extras, false);
    });
    const lido = { visao: null, assinatura: '', redesenhar: null };
    const parar = aoVoltar(() => cliente && recarregarSeMudou(lido, { cliente, sancoes: sancoes || sancoesEmLote(cliente) }, (ex) => lido.redesenhar(ex, true)));
    return { fechar() { parar(); alvo.replaceChildren(); } };
  }

  const api = { montarVisao, vencedorDe, variacao, chaveMarca, montar, montarPesquisa, desenhar, linkOficial, urlsVerTudo, PASSOS_VER_TUDO, indexarGravado, participantesDoItem, cnpjsDaVisao,
    textoSelo, seloGravado, sancoesEmLote, lerGravados, carregarExtras, camadasDoPregao, completudeDoPregao, assinaturaGravado, recarregarSeMudou };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.LicitaLicitacaoAnterior = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
