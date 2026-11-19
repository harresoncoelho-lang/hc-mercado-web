/* global module, require */
// Checklist da esteira dentro do processo (tarefa E13): faixa de status (Itens / Exigências / Documentos),
// exigências do edital com fonte e resposta do usuário, e declarações pedidas (lote e DOCX das revisadas).
// Lê com o cliente supabase do usuário (RLS): operacao_esteira_tarefas, operacao_exigencias_situacao e
// operacao_kit_documentos. Só grava a coluna resposta (grant update(resposta) de operacao_exigencias.sql).
// Banco sem as tabelas (ambiente antigo) ou processo sem esteira: o bloco fica vazio (CSS esconde) e não mostra erro.
(function (global) {
  'use strict';
  const MARCADOR = '[PREENCHER:'; // mesmo marcador de _kit_declaracoes.js: bloqueia revisão e exportação
  const LOTE_MAX = 30; // mesmo teto do servidor (gerarDeclaracoesLote)
  const declaracoes = () => global.LicitaDeclaracoes || (typeof module !== 'undefined' && module.exports ? require('./declaracoes-modelos.js') : null);

  const SITUACOES = { falta: 'Falta documento', vence_antes_da_sessao: 'Vence antes da sessão', conferir: 'Conferir', vigente: 'Vigente' };
  // Ordem de atenção: o que derruba a habilitação primeiro.
  const PESO_SITUACAO = { falta: 0, vence_antes_da_sessao: 1, conferir: 2, vigente: 3 };
  const RESPOSTAS = { atendo: 'Atendo', nao_se_aplica: 'Não se aplica', vou_providenciar: 'Vou providenciar' };
  const CATEGORIAS = { juridica: 'Jurídica', fiscal: 'Fiscal', tecnica: 'Técnica', economica: 'Econômica', declaracao: 'Declaração',
    proposta: 'Proposta', amostra: 'Amostra', visita: 'Visita', garantia: 'Garantia', credenciamento: 'Credenciamento', execucao: 'Execução' };

  // Tabela/view ainda não aplicada: Postgres 42P01 ou PostgREST PGRST205 (fora do cache do schema).
  function tabelaAusente(erro) {
    return Boolean(erro) && (erro.code === '42P01' || erro.code === 'PGRST205' || erro.status === 404);
  }

  // Estado legível de uma etapa do robô. tom: ok | andamento | erro | atencao | neutro.
  function rotuloEtapa(etapa, tarefa) {
    if (!tarefa) return { texto: 'Ainda não começou', tom: 'neutro' };
    const d = tarefa.detalhe && typeof tarefa.detalhe === 'object' ? tarefa.detalhe : {};
    switch (tarefa.estado) {
      case 'executando': return { texto: etapa === 'itens' ? 'Buscando os itens…' : 'Lendo o edital…', tom: 'andamento' };
      case 'pendente': return { texto: d.situacao === 'aguardando_dossie' ? 'Esperando o edital ser lido…' : 'Na fila…', tom: 'andamento' };
      case 'aguardando_leitura': return { texto: 'Não consegui ler todos os anexos', tom: 'erro' };
      case 'falhou': return { texto: 'Falhou', tom: 'erro', acao: 'tentar' };
      case 'feito':
        if (etapa === 'itens' && Number.isInteger(d.total)) return { texto: d.total === 1 ? 'Pronto: 1 item' : `Pronto: ${d.total} itens`, tom: 'ok' };
        return { texto: 'Pronto', tom: 'ok' };
      default: return { texto: 'Ainda não começou', tom: 'neutro' };
    }
  }

  // Declarações: pedidas pelo edital (exigências da categoria) × geradas no kit.
  function contarDeclaracoes(docs) {
    const lista = Array.isArray(docs) ? docs : [];
    return { total: lista.length,
      comPreencher: lista.filter((d) => typeof d.texto === 'string' && d.texto.includes(MARCADOR)).length,
      revisadas: lista.filter((d) => Number.isInteger(d.versao) && d.revisao_versao === d.versao).length };
  }
  function rotuloDocumentos(exigidas, docs) {
    const c = contarDeclaracoes(docs);
    if (!c.total) return exigidas ? { texto: exigidas === 1 ? 'Falta gerar 1 declaração' : `Falta gerar ${exigidas} declarações`, tom: 'atencao' } : { texto: 'Nenhuma declaração pedida', tom: 'neutro' };
    if (c.comPreencher) return { texto: c.comPreencher === 1 ? '1 com campos a preencher' : `${c.comPreencher} com campos a preencher`, tom: 'atencao' };
    if (c.revisadas < c.total) return { texto: `${c.total - c.revisadas} para revisar`, tom: 'atencao' };
    return { texto: 'Pronto', tom: 'ok' };
  }

  // Alerta vermelho fixo: um por anexo não lido. Sem lista mas aguardando leitura: a mensagem do robô.
  function alertasLeitura(tarefa) {
    if (!tarefa || tarefa.estado !== 'aguardando_leitura') return [];
    const d = tarefa.detalhe || {};
    const nao = Array.isArray(d.naoLidos) ? d.naoLidos.filter((x) => x && typeof x.documento === 'string') : [];
    if (nao.length) return nao.map((x) => ({ texto: `Não consegui ler ${x.estado === 'parcial' ? 'por completo ' : ''}o anexo ${x.documento}.`, motivo: typeof x.motivo === 'string' ? x.motivo : '' }));
    return [{ texto: typeof d.mensagem === 'string' && d.mensagem ? d.mensagem : 'Não consegui ler todos os anexos do edital.', motivo: '' }];
  }

  // Cobertura: documento lido com palavra-gatilho e nenhuma exigência extraída (a defesa contra a pegadinha).
  function alertasCobertura(tarefa) {
    const d = tarefa?.detalhe || {};
    const lista = (Array.isArray(d.alertas) ? d.alertas : []).filter((a) => a && typeof a.mensagem === 'string' && a.mensagem.trim())
      .map((a) => a.mensagem.trim().replace(/^./, (c) => c.toUpperCase()).replace(/\.?$/, '.'));
    const resto = Number.isInteger(d.totalAlertas) ? d.totalAlertas - lista.length : 0;
    if (resto > 0) lista.push(resto === 1 ? 'Mais 1 trecho para conferir.' : `Mais ${resto} trechos para conferir.`);
    return lista;
  }

  // Incomuns no topo; depois o que derruba a habilitação; depois documento, página e código (estável).
  function ordenarExigencias(lista) {
    const peso = (e) => PESO_SITUACAO[e.situacao] ?? 2;
    return [...(Array.isArray(lista) ? lista : [])].sort((a, b) => (b.incomum === true) - (a.incomum === true)
      || peso(a) - peso(b)
      || String(a.documento || '').localeCompare(String(b.documento || ''))
      || (a.pagina || 0) - (b.pagina || 0)
      || String(a.codigo || '').localeCompare(String(b.codigo || '')));
  }

  // Pendência = ainda não respondida ou "vou providenciar". "Não se aplica" e "atendo" saem da conta.
  function contarPendencias(lista) {
    const ativas = (Array.isArray(lista) ? lista : []).filter((e) => e.resposta !== 'nao_se_aplica');
    return { total: ativas.length,
      semResposta: ativas.filter((e) => !e.resposta || e.resposta === 'pendente').length,
      providenciar: ativas.filter((e) => e.resposta === 'vou_providenciar').length,
      falta: ativas.filter((e) => e.situacao === 'falta' && e.resposta !== 'atendo').length,
      venceAntes: ativas.filter((e) => e.situacao === 'vence_antes_da_sessao' && e.resposta !== 'atendo').length,
      incomuns: ativas.filter((e) => e.incomum === true).length };
  }

  // Exigência de categoria "declaracao" que de fato pede uma declaração: a regra classifica por "declara" e pega
  // também cláusula de sanção ("declaração de inidoneidade", "pedido de reconsideração"), que não se gera.
  // Com modelo achado pelo robô (do edital ou da biblioteca) vale o modelo.
  const ehDeclaracao = (e) => e.categoria === 'declaracao' && e.resposta !== 'nao_se_aplica' &&
    ((typeof e.modelo_texto === 'string' && e.modelo_texto.trim()) || e.modelo_declaracao ||
      (/declar/i.test(e.texto || '') && !/inidoneidade|reconsidera|san[cç][aã]o|penalidade/i.test(e.texto || '')));
  // Título curto da peça: o que se declara, sem o preâmbulo da cláusula ("No cadastramento da proposta, o licitante declarará…").
  function tituloDeclaracao(texto, pagina) {
    const t = String(texto || '').replace(/\s+/g, ' ').trim();
    const curto = (v) => { v = v.replace(/[\s:;,.]+$/, ''); return v.length <= 90 ? v : v.slice(0, 90).replace(/\s+\S*$/, '') + '…'; };
    if (/^declara/i.test(t) && t.length <= 90) return curto(t);
    const que = /declar\w*\b.*?\bque\b:?\s*(.+)$/i.exec(t);
    if (que && que[1].replace(/[\s:;,.]+$/, '').length >= 8) return curto('Declaração de que ' + que[1]);
    const de = /declara[cç][aã]o\s+(de\s+[^.;:]+)/i.exec(t);
    if (de) return curto('Declaração ' + de[1]);
    return 'Declaração exigida pelo edital' + (pagina ? ` (pág. ${pagina})` : '');
  }

  // Lote para gerarDeclaracoesLote. Modelo literal do edital (modelo_texto, gravado pelo robô) > biblioteca (código
  // salvo pelo robô ou escolha pelo texto) > texto livre com marcador, para a declaração nunca sumir: sem modelo, o
  // usuário redige a partir do trecho. O mesmo modelo do edital vai uma vez só (o servidor recusa texto repetido no lote).
  function loteDeclaracoes(exigencias) {
    const D = declaracoes();
    const pedidos = [], vistos = new Set();
    for (const e of ordenarExigencias(exigencias)) {
      if (!ehDeclaracao(e) || pedidos.length >= LOTE_MAX) continue;
      if (typeof e.modelo_texto === 'string' && e.modelo_texto.trim()) {
        if (!vistos.has(e.modelo_texto)) {
          vistos.add(e.modelo_texto);
          const f = e.modelo_fonte || {};
          const local = [f.documento, f.pagina ? 'pág. ' + f.pagina : ''].filter(Boolean).join(', ');
          pedidos.push({ modeloCodigo: 'edital', titulo: tituloDeclaracao(e.texto, e.pagina), texto: e.modelo_texto,
            fonte: ('Modelo do próprio edital (texto literal)' + (local ? ': ' + local : '') + '. Confira com o original.').slice(0, 1000) });
        }
        continue;
      }
      const modelo = D && (D.obterModelo(e.modelo_declaracao) || D.escolherModelo(e.texto));
      if (modelo) {
        if (!vistos.has(modelo.codigo)) { vistos.add(modelo.codigo); pedidos.push({ modeloCodigo: modelo.codigo }); }
        continue;
      }
      const fonte = [e.documento, e.pagina ? 'pág. ' + e.pagina : ''].filter(Boolean).join(', ');
      pedidos.push({ modeloCodigo: 'livre', titulo: tituloDeclaracao(e.texto, e.pagina),
        texto: `[PREENCHER: texto da declaração]\n\nO edital pede: ${String(e.texto).slice(0, 2000)}${e.trecho ? '\n\nTrecho do edital: "' + String(e.trecho).slice(0, 1200) + '"' : ''}`,
        ...(fonte ? { fonte: 'Exigência do edital: ' + fonte.slice(0, 900) } : {}) });
    }
    return pedidos;
  }

  // RPC esteira_tentar_de_novo (operacao_esteira.sql): o banco confere papel, estado 'falhou' e o teto de 3 por dia.
  // As mensagens P0001 do banco já são para o usuário; o resto vira texto fixo (sem erro técnico na tela).
  async function tentarDeNovo(cliente, processoId, etapa) {
    try {
      const { error } = await cliente.rpc('esteira_tentar_de_novo', { p_processo: processoId, p_etapa: etapa });
      if (!error) return { ok: true, mensagem: 'Pedido feito. A etapa voltou para a fila.' };
      if (error.code === '42501') return { ok: false, mensagem: 'Seu acesso não permite tentar de novo. Peça a um gestor ou operador.' };
      if (error.code === 'P0001' && typeof error.message === 'string' && error.message) return { ok: false, mensagem: error.message.replace(/\.?$/, '.') };
      if (error.code === 'PGRST202' || error.code === '42883') return { ok: false, mensagem: 'Ainda não dá para pedir isso por aqui. Fale com o suporte.' };
    } catch { /* sem conexão: mensagem genérica abaixo */ }
    return { ok: false, mensagem: 'Não foi possível pedir agora. Tente de novo.' };
  }

  const formatarData = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(8, 10) + '/' + v.slice(5, 7) + '/' + v.slice(0, 4) : '');

  function montar({ alvo, contexto, cliente, requisitar, documento = global.document }) {
    const doc = documento;
    let vivo = true;
    let geracao = 0;
    let tarefas = new Map();
    let exigencias = [];
    let docs = [];
    let somenteLeitura = false;
    let exigenciasDisponiveis = false;
    let declaracoesDisponiveis = false;
    let ocupado = false;
    let avisoDecl = '';
    let avisoFaixa = '';
    const filtro = (q) => q.eq('empresa_id', contexto.empresaId).eq('processo_id', contexto.processoId);

    function h(tag, props, ...filhos) {
      const n = doc.createElement(tag);
      for (const [k, v] of Object.entries(props || {})) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'texto') n.textContent = v;
        else if (k === 'classe') n.className = v;
        else if (k.startsWith('data-') || k.startsWith('aria-') || k === 'role' || k === 'for' || k === 'name' || k === 'type' || k === 'value') n.setAttribute(k, v === true ? '' : v);
        else n[k] = v;
      }
      for (const f of filhos.flat()) if (f) n.append(f);
      return n;
    }

    async function ler(consulta) {
      try {
        const { data, error } = await consulta;
        if (error) return { ausente: tabelaAusente(error), erro: true, dados: [] };
        return { dados: Array.isArray(data) ? data : [] };
      } catch { return { erro: true, dados: [] }; }
    }

    async function carregar() {
      const g = ++geracao;
      const [t, e, k] = await Promise.all([
        ler(filtro(cliente.from('operacao_esteira_tarefas').select('etapa,estado,detalhe,erro,tentativas')).limit(10)),
        ler(filtro(cliente.from('operacao_exigencias_situacao').select('id,codigo,categoria,texto,documento,pagina,trecho,origem,incomum,motivo_incomum,tipo_documento,modelo_declaracao,modelo_texto,modelo_fonte,resposta,situacao,documento_empresa_titulo,documento_vencimento')).limit(500)),
        ler(filtro(cliente.from('operacao_kit_documentos').select('id,versao,revisao_versao,texto:dados->declaracao->>texto')).eq('tipo', 'declaracao').limit(100)),
      ]);
      if (!vivo || g !== geracao) return;
      tarefas = new Map(t.dados.map((x) => [x.etapa, x]));
      exigencias = e.dados;
      exigenciasDisponiveis = !e.ausente && !e.erro;
      // Banco sem operacao_kit_modelos/kit: o bloco de declarações some, o resto continua.
      declaracoesDisponiveis = !k.ausente && !k.erro;
      docs = k.dados;
      // Ambiente antigo (tabelas ausentes) ou processo sem esteira e sem exigências: nada a mostrar, sem erro.
      if ((t.ausente || !t.dados.length) && !e.dados.length) {
        alvo.replaceChildren(...(t.erro && !t.ausente || e.erro && !e.ausente ? [h('p', { classe: 'esteira-apoio', role: 'status', texto: 'Não foi possível carregar o checklist do edital agora.' })] : []));
        return;
      }
      render();
    }

    function etapaLi(nome, r, etapa) {
      return h('li', { 'data-tom': r.tom }, h('span', { classe: 'esteira-etapa', texto: nome }), h('strong', { texto: r.texto }),
        r.apoio ? h('span', { classe: 'esteira-apoio', texto: r.apoio }) : null,
        r.acao === 'tentar' ? h('button', { type: 'button', 'data-acao': 'tentar', 'data-etapa': etapa, disabled: ocupado, texto: 'Tentar de novo' }) : null);
    }

    function selos(e) {
      const s = [];
      if (e.incomum) s.push(h('span', { classe: 'esteira-selo', 'data-selo': 'incomum', texto: 'Fora do comum' }));
      if (e.origem === 'leitura_deterministica') s.push(h('span', { classe: 'esteira-selo', 'data-selo': 'conferir', texto: 'A IA não listou; confira' }));
      if (e.origem === 'ia_sem_trecho') s.push(h('span', { classe: 'esteira-selo', 'data-selo': 'conferir', texto: 'Sem trecho no edital; confira' }));
      return s.length ? h('p', { classe: 'esteira-selos' }, s) : null;
    }

    function situacaoTexto(e) {
      const base = SITUACOES[e.situacao] || 'Conferir';
      const venc = formatarData(e.documento_vencimento);
      if ((e.situacao === 'vigente' || e.situacao === 'vence_antes_da_sessao') && venc) return `${base} · ${e.documento_empresa_titulo || 'documento'} vence em ${venc}`;
      return base;
    }

    function exigenciaLi(e) {
      const fonte = [e.documento, e.pagina ? 'pág. ' + e.pagina : ''].filter(Boolean).join(', ');
      const grupo = 'resp-' + e.id;
      const opcoes = Object.entries(RESPOSTAS).map(([valor, rotulo]) => h('label', { classe: 'esteira-opcao' },
        h('input', { type: 'radio', name: grupo, value: valor, checked: e.resposta === valor, disabled: somenteLeitura || ocupado, 'data-exigencia': e.id }), rotulo));
      return h('li', { 'data-situacao': e.situacao || 'conferir', 'data-incomum': e.incomum ? 'sim' : null },
        selos(e),
        h('strong', { texto: e.texto }),
        h('p', { classe: 'esteira-meta' }, h('span', { classe: 'esteira-situacao', texto: situacaoTexto(e) }), ' · ' + (CATEGORIAS[e.categoria] || 'Outra')),
        e.incomum && e.motivo_incomum ? h('p', { classe: 'esteira-apoio', texto: 'Por quê: ' + e.motivo_incomum }) : null,
        h('p', { classe: 'esteira-apoio', texto: fonte ? 'Onde está: ' + fonte : 'Onde está: não localizado nos documentos lidos' }),
        e.trecho ? h('details', null, h('summary', { texto: 'Ver trecho do edital' }), h('blockquote', { texto: e.trecho })) : null,
        h('fieldset', { classe: 'esteira-resposta' }, h('legend', { texto: 'Sua resposta' }), opcoes));
    }

    function blocoDeclaracoes() {
      const exigidas = exigencias.filter(ehDeclaracao).length;
      if (!declaracoesDisponiveis || (!exigidas && !docs.length)) return null;
      const c = contarDeclaracoes(docs);
      const linhas = [exigidas === 1 ? 'O edital pede 1 declaração.' : `O edital pede ${exigidas} declarações.`];
      if (c.total) linhas.push(`${c.total} gerada(s) · ${c.revisadas} revisada(s)` + (c.comPreencher ? ` · ${c.comPreencher} com [PREENCHER]` : ''));
      return h('section', { classe: 'esteira-declaracoes', 'aria-labelledby': 'esteira-decl-titulo' },
        h('h3', { id: 'esteira-decl-titulo', texto: 'Declarações exigidas' }),
        ...linhas.map((t) => h('p', { texto: t })),
        c.comPreencher ? h('p', { classe: 'esteira-apoio', texto: 'Abra cada uma em Documentos e propostas e troque o [PREENCHER] antes de revisar.' }) : null,
        h('div', { classe: 'esteira-acoes' },
          h('button', { type: 'button', classe: 'app-primario', 'data-acao': 'gerar', disabled: ocupado || !exigidas, texto: 'Gerar declarações' }),
          h('button', { type: 'button', 'data-acao': 'baixar', disabled: ocupado || !c.revisadas, texto: 'Baixar revisadas' })),
        h('p', { classe: 'esteira-apoio', role: 'status', 'aria-live': 'polite', 'data-aviso-decl': true, texto: avisoDecl }));
    }

    function render() {
      const tEx = tarefas.get('exigencias');
      const exigidas = exigencias.filter(ehDeclaracao).length;
      const faixa = h('ol', { classe: 'esteira-faixa', 'aria-label': 'Andamento da leitura do edital' },
        etapaLi('Itens', rotuloEtapa('itens', tarefas.get('itens')), 'itens'),
        etapaLi('Exigências', rotuloEtapa('exigencias', tEx), 'exigencias'),
        etapaLi('Documentos', declaracoesDisponiveis ? rotuloDocumentos(exigidas, docs) : { texto: 'Indisponível', tom: 'neutro' }));
      const leitura = alertasLeitura(tEx);
      const cobertura = alertasCobertura(tEx);
      const filhos = [h('h2', { classe: 'app-subtitulo', texto: 'Checklist do edital' }), faixa,
        avisoFaixa ? h('p', { classe: 'esteira-apoio', role: 'status', 'aria-live': 'polite', texto: avisoFaixa }) : null].filter(Boolean);
      if (leitura.length) filhos.push(h('div', { classe: 'esteira-alerta', 'data-tom': 'erro', role: 'alert' },
        h('strong', { texto: 'Leitura incompleta: o checklist pode estar faltando exigências.' }),
        h('ul', null, leitura.map((a) => h('li', null, a.texto, a.motivo ? h('span', { classe: 'esteira-motivo', texto: ' ' + a.motivo }) : null)))));
      if (cobertura.length) filhos.push(h('div', { classe: 'esteira-alerta', 'data-tom': 'atencao', role: 'alert' },
        h('strong', { texto: 'Confira no edital: pode ter exigência que ninguém listou.' }),
        h('ul', null, cobertura.map((t) => h('li', { texto: t })))));
      if (exigenciasDisponiveis) {
        const p = contarPendencias(exigencias);
        const resumo = !p.total ? 'Nenhuma exigência pendente.'
          : [p.semResposta && `${p.semResposta} sem resposta`, p.providenciar && `${p.providenciar} para providenciar`,
            p.falta && `${p.falta} sem documento`, p.venceAntes && `${p.venceAntes} vencem antes da sessão`].filter(Boolean).join(' · ') || 'Tudo respondido.';
        filhos.push(h('p', { classe: 'esteira-resumo', role: 'status', texto: resumo }));
        if (somenteLeitura) filhos.push(h('p', { classe: 'esteira-apoio', texto: 'Você pode ver as respostas, mas não alterar.' }));
        filhos.push(exigencias.length ? h('ul', { classe: 'esteira-lista' }, ordenarExigencias(exigencias).map(exigenciaLi))
          : h('p', { classe: 'esteira-apoio', texto: tEx?.estado === 'feito' ? 'Nenhuma exigência encontrada nos documentos lidos.' : 'As exigências aparecem aqui quando a leitura terminar.' }));
      }
      const decl = blocoDeclaracoes();
      if (decl) filhos.push(decl);
      alvo.replaceChildren(...filhos);
    }

    async function responder(id, resposta) {
      const e = exigencias.find((x) => x.id === id);
      if (!e || somenteLeitura || !Object.hasOwn(RESPOSTAS, resposta)) return;
      const anterior = e.resposta;
      e.resposta = resposta;
      ocupado = true; render();
      let ok = false;
      try {
        const { data, error } = await filtro(cliente.from('operacao_exigencias_processo').update({ resposta }).eq('id', id)).select('id,resposta');
        // 42501 = sem grant; zero linhas = a RLS não deixou escrever (papel sem escrita).
        if (error?.code === '42501' || (!error && (!Array.isArray(data) || !data.length))) somenteLeitura = true;
        ok = !error && Array.isArray(data) && data.length === 1;
      } catch { ok = false; }
      if (!vivo) return;
      if (!ok) e.resposta = anterior;
      ocupado = false; render();
      if (!ok && !somenteLeitura) avisar('Não foi possível salvar a resposta. Tente de novo.');
    }

    function avisar(t) { avisoDecl = t; const n = alvo.querySelector('[data-aviso-decl]'); if (n) n.textContent = t; else if (t) alvo.append(h('p', { classe: 'esteira-apoio', role: 'status', texto: t })); }

    async function chamarKit(corpo) {
      const r = await requisitar('/api/kit-documentos', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ empresaId: contexto.empresaId, processoId: contexto.processoId, ...corpo }) });
      let j = null;
      try { j = await r.json(); } catch { j = null; }
      return { ok: r.ok, status: r.status, j: j || {} };
    }

    async function gerar() {
      const lote = loteDeclaracoes(exigencias);
      if (!lote.length) return;
      ocupado = true; avisoDecl = 'Gerando declarações…'; render();
      try {
        const r = await chamarKit({ acao: 'gerarDeclaracoesLote', declaracoes: lote });
        if (!vivo) return;
        avisoDecl = r.ok ? `${(r.j.criados || []).length} nova(s), ${(r.j.existentes || []).length} já existia(m). Revise em Documentos e propostas.`
          : (typeof r.j.erro === 'string' ? r.j.erro : 'Não foi possível gerar agora. Tente de novo.');
      } catch { avisoDecl = 'Não foi possível gerar agora. Tente de novo.'; }
      ocupado = false;
      await carregar();
    }

    async function baixar() {
      ocupado = true; avisoDecl = 'Preparando o arquivo…'; render();
      try {
        const r = await chamarKit({ acao: 'exportarDeclaracoes' });
        if (!vivo) return;
        const fora = (r.j.ignoradas || []).length;
        if (r.ok && typeof r.j.arquivoBase64 === 'string' && r.j.mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
          const bytes = Uint8Array.from(global.atob(r.j.arquivoBase64), (ch) => ch.charCodeAt(0));
          const url = global.URL.createObjectURL(new global.Blob([bytes], { type: r.j.mime }));
          const a = doc.createElement('a'); a.href = url; a.download = String(r.j.nome || 'declaracoes.docx').replace(/[^\p{L}\p{N}._ -]/gu, '_').replace(/^\.+/, '') || 'declaracoes.docx';
          try { doc.body.append(a); a.click(); } finally { a.remove(); global.setTimeout(() => global.URL.revokeObjectURL(url), 1000); }
          avisoDecl = `${(r.j.incluidas || []).length} no arquivo` + (fora ? `; ${fora} ficaram de fora (sem revisão ou com [PREENCHER]).` : '.');
        } else avisoDecl = typeof r.j.erro === 'string' ? r.j.erro : 'Não foi possível baixar agora. Tente de novo.';
      } catch { avisoDecl = 'Não foi possível baixar agora. Tente de novo.'; }
      ocupado = false; render();
    }

    async function tentar(etapa) {
      ocupado = true; avisoFaixa = 'Pedindo de novo…'; render();
      const r = await tentarDeNovo(cliente, contexto.processoId, etapa);
      if (!vivo) return;
      avisoFaixa = r.mensagem;
      ocupado = false;
      await carregar();
    }

    alvo.addEventListener('change', (ev) => {
      const d = ev.target?.dataset || {};
      if (d.exigencia) void responder(d.exigencia, ev.target.value);
    });
    alvo.addEventListener('click', (ev) => {
      const b = ev.target?.closest?.('button[data-acao]');
      if (!b || ocupado) return;
      if (b.dataset.acao === 'gerar') void gerar();
      else if (b.dataset.acao === 'baixar') void baixar();
      else if (b.dataset.acao === 'tentar') void tentar(b.dataset.etapa);
    });
    if (cliente && typeof cliente.from === 'function') void carregar();

    return { fechar() { vivo = false; geracao += 1; alvo.replaceChildren(); }, atualizar: () => carregar() };
  }

  const api = { montar, tentarDeNovo, rotuloEtapa, rotuloDocumentos, contarDeclaracoes, alertasLeitura, alertasCobertura, ordenarExigencias,
    contarPendencias, loteDeclaracoes, tituloDeclaracao, tabelaAusente, SITUACOES, RESPOSTAS, CATEGORIAS };
  global.LicitaChecklistEsteira = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
