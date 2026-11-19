(function (global) {
  'use strict';
  // Controlador da casca comercial. Dependências entram por parâmetro (DOM, fetch, storage, módulos reais),
  // para o teste executar esta mesma lógica com doubles. Respostas antigas são descartadas por época.
  const CORE = global.LicitaPlenaComercialCore;
  const MSG = {
    carregando: 'Verificando sua sessão…',
    entrando: 'Entrando…',
    encerrando: 'Encerrando sessão…',
    sessaoExpirada: 'Sua sessão expirou. Entre novamente.',
    usuarioMudou: 'Sua sessão mudou. Entre novamente.',
    sessaoNaoVerificada: 'Não foi possível verificar sua sessão. Tente de novo.',
    erroSair: 'Não foi possível encerrar a sessão. Tente de novo.',
    erroEntrar: CORE.MSG_LOGIN,
    semContexto: CORE.MSG_SEM_CONTEXTO,
    encerrada: CORE.MSG_SESSAO_ENCERRADA,
    descartarAlteracoes: 'Há alterações não salvas nesta peça. Se trocar agora, elas serão descartadas. Continuar?',
    erroNovoProcesso: 'Não foi possível cadastrar o processo. Tente de novo.',
    processoNaoAutorizado: 'Este processo não está disponível para sua conta.',
    processoNaoCarregado: 'Não foi possível abrir o processo. Tente de novo.',
    naoAprovado: 'Seu cadastro ainda está em análise. Você recebe um aviso assim que for aprovado.',
  };

  // Autenticação do servidor QA local (docs/qa/qa-real-isolado/servidor.cjs): cookie HttpOnly e rotas /qa/*.
  // É o padrão quando a página não pede produção, para os testes e o harness QA seguirem iguais.
  function autenticacaoQA(fetch) {
    return {
      async entrar(email, password) {
        const r = await fetch('/qa/login', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ email, password }) });
        return { ok: r.ok === true };
      },
      async sair() {
        const r = await fetch('/qa/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: '{}' });
        return { ok: r.ok === true };
      },
      // O QA devolve o catálogo em toda consulta; o pedido de catálogo é ignorado.
      async sessao() {
        const r = await fetch('/qa/session', { credentials: 'same-origin' });
        if (r.status === 401) return { estado: 'sem-sessao' };
        if (!r.ok) return { estado: 'erro' };
        return lerCatalogo(await r.json(), null);
      },
    };
  }

  // Normaliza { userId, contextos, empresas } vindo do QA ou do handler contextos-operacao.
  function lerCatalogo(j, accessToken) {
    if (!j || typeof j.userId !== 'string') return { estado: 'erro' };
    const empresas = Array.isArray(j.empresas) ? j.empresas.filter((e) => e && typeof e.empresaId === 'string').map((e) => ({ empresaId: e.empresaId, razaoSocial: typeof e.razaoSocial === 'string' ? e.razaoSocial.trim() : '' })) : [];
    // Certidões e prazos: lista, null (o servidor não conseguiu ler) ou ausente (fonte sem esses blocos, como o QA).
    const bloco = (v) => (Array.isArray(v) ? v : v === null ? null : undefined);
    return { estado: 'ok', sessao: { userId: j.userId, accessToken: accessToken || j.accessToken, contextos: Array.isArray(j.contextos) ? j.contextos : [], empresas, certidoes: bloco(j.certidoes), prazos: bloco(j.prazos), sancoes: bloco(j.sancoes), contratos: bloco(j.contratos) } };
  }

  // Produção (sistema.html): Supabase Auth no navegador, mesmo fluxo do login.html, inclusive recusar e
  // deslogar quem não tem clientes.status === 'aprovado'. O catálogo vem de /api/contextos-operacao com o
  // token do próprio usuário (RLS). cliente nulo (supabase-js não carregou) falha fechado.
  function criarAutenticacaoSupabase({ cliente, fetch }) {
    async function sessaoLocal() {
      const { data, error } = await cliente.auth.getSession();
      if (error) return { estado: 'erro' };
      const s = data && data.session;
      if (!s || typeof s.access_token !== 'string' || !s.user || typeof s.user.id !== 'string') return { estado: 'sem-sessao' };
      return { estado: 'ok', sessao: { userId: s.user.id, accessToken: s.access_token } };
    }
    async function encerrarNaoAprovado() {
      try { await cliente.auth.signOut(); } catch { /* a sessão local é descartada de qualquer forma */ }
      return MSG.naoAprovado;
    }
    return {
      async entrar(email, password) {
        if (!cliente) return { ok: false };
        const { data, error } = await cliente.auth.signInWithPassword({ email: String(email || '').trim(), password });
        if (error || !data || !data.user) return { ok: false };
        const { data: c } = await cliente.from('clientes').select('status').eq('id', data.user.id).single();
        if (!c || c.status !== 'aprovado') return { ok: false, mensagem: await encerrarNaoAprovado() };
        return { ok: true };
      },
      async sair() {
        if (!cliente) return { ok: false };
        const { error } = await cliente.auth.signOut();
        return { ok: !error };
      },
      // Sem catálogo: só a sessão local (barata; os módulos chamam a cada requisição).
      async sessao({ comCatalogo = false } = {}) {
        if (!cliente) return { estado: 'erro' };
        const atual = await sessaoLocal();
        if (atual.estado !== 'ok' || !comCatalogo) return atual;
        const r = await fetch('/api/contextos-operacao', { headers: { Authorization: 'Bearer ' + atual.sessao.accessToken } });
        if (r.status === 401) return { estado: 'sem-sessao' };
        // Sessão antiga de conta não aprovada (ex.: logo após o cadastro): encerra, como o login.html.
        if (r.status === 403) return { estado: 'sem-sessao', mensagem: await encerrarNaoAprovado() };
        if (!r.ok) return { estado: 'erro' };
        const lido = lerCatalogo(await r.json(), atual.sessao.accessToken);
        // Catálogo de usuário diferente do da sessão local nunca é aceito.
        return lido.estado === 'ok' && lido.sessao.userId !== atual.sessao.userId ? { estado: 'erro' } : lido;
      },
      // Token atual do supabase-js (renovado sozinho): o guardado no início expira em 1 h.
      async token() {
        const atual = cliente ? await sessaoLocal() : null;
        return atual && atual.estado === 'ok' ? atual.sessao.accessToken : null;
      },
    };
  }

  // pedirLogin(mensagem): produção não tem formulário próprio; quando a casca cai no login, quem chama redireciona
  // para o login.html. Sem ele (QA), o formulário da própria página continua sendo usado.
  function criarControlador({ doc, fetch, storage, kit, identificacao, itens = null, portal = globalThis.LicitaPortalCliente || null, esteira = null, anterior = null, confirmar = null, autenticacao = null, pedirLogin = null, busca = '' }) {
    const auth = autenticacao || autenticacaoQA(fetch);
    const el = (id) => doc.getElementById(id);
    let epoca = 0;
    let atual = null;
    let ocupado = false;
    let sessao = null;
    let autorizados = [];
    let componente = null;
    let ident = null;
    let itensComp = null;
    let portalComp = null;
    let esteiraComp = null;
    let anteriorComp = null;
    let tela = 'carregando';
    // 'hoje' lista empresas/processos autorizados; 'processo' mostra identificação e kit do contexto atual.
    let visao = 'hoje';
    // Empresas autorizadas vindas da descoberta (inclui empresa sem processo). Só a descoberta alimenta esta lista.
    let empresasSessao = [];
    // Cadastro de processo: empresa do formulário, tentativa atual (id estável) e bloqueio de envio duplo.
    let novoEmpresaId = null;
    let tentativa = null;
    let ultimoDados = null;
    let criandoNovo = false;
    // Geração da sessão: avança em toda fronteira de sessão; resposta de geração anterior não altera a tela.
    let geracao = 0;
    // Preparação de empresa (identificação, sem processo e sem kit): empresa do módulo montado e seu modo.
    let prepEmpresaId = null;
    let identDe = null;

    function aviso(texto, estado) {
      el('app-aviso').textContent = texto || '';
      el('app-aviso').dataset.estado = estado || '';
      // Todo mostrar('login') é seguido de aviso(): é aqui que a mensagem do motivo já está definida.
      if (tela === 'login' && pedirLogin) pedirLogin(texto || '');
    }

    function setBusy(v) {
      ocupado = v;
      const entrarBtn = el('login-entrar');
      if (entrarBtn) entrarBtn.disabled = v;
      el('sair').disabled = v;
      el('tentar').disabled = v;
    }

    function mostrar(t) {
      tela = t;
      const login = el('login');
      if (login) login.hidden = t !== 'login';
      el('sair').hidden = !(t === 'area' || t === 'sem-contexto' || t === 'erro-sair');
      el('tentar').hidden = t !== 'erro-sessao';
      // Convite para cadastrar a primeira empresa (sistema.html); a página do harness QA não tem o bloco.
      const convite = el('sem-empresa');
      if (convite) convite.hidden = t !== 'sem-contexto';
      atualizarVisao();
    }

    // Uma visão por vez. Ocultar não desmonta: o contexto e os rascunhos do processo continuam no módulo.
    function atualizarVisao() {
      const processo = tela === 'area' && visao === 'processo';
      const preparar = tela === 'area' && visao === 'preparar';
      const hoje = tela === 'area' ? visao === 'hoje' : ['carregando', 'sem-contexto'].includes(tela);
      el('area').hidden = !(processo || preparar);
      // Kit só existe com processo: em preparação ele fica oculto e sem montagem.
      el('kit').hidden = !processo;
      // Itens do processo só existem com processo: somem na preparação e no Hoje.
      el('itens-processo').hidden = !processo;
      // Portal do cliente: mesma regra dos itens; a página do harness QA não tem o bloco.
      if (el('portal-cliente')) el('portal-cliente').hidden = !processo;
      // Checklist da esteira: mesma regra; vazio (banco antigo ou sem esteira) o CSS esconde o cartão.
      if (el('checklist-esteira')) el('checklist-esteira').hidden = !processo;
      // Licitação anterior: mesma regra do checklist (vazio, o CSS esconde).
      if (el('licitacao-anterior')) el('licitacao-anterior').hidden = !processo;
      el('empresa-bloco').hidden = !(processo || preparar);
      el('processo-bloco').hidden = !processo || processosDe(atual?.empresaId).length === 0;
      el('hoje').hidden = !hoje;
      el('novo-processo-bloco').hidden = !(hoje && novoEmpresaId !== null);
      el('hoje-estado').textContent = textoHoje();
    }

    function textoHoje() {
      if (tela === 'carregando') return 'Carregando empresas e processos autorizados…';
      if (tela === 'sem-contexto') return CORE.MSG_SEM_CONTEXTO;
      return '';
    }

    // Lista o catálogo do servidor desta sessão (número, objeto, situação e prazo como texto). Sem métricas.
    // Prazo chega como texto ISO; data inválida aparece como veio (textContent, sem HTML).
    function formatarPrazo(v) {
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? v : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
    }

    // Topo do Hoje: certidões vencidas ou vencendo em 30 dias e prazos dos próximos 7 dias. Tudo por textContent.
    // A situação vai em texto (Atrasado/Atenção) além da cor; a página do harness QA não tem o bloco.
    function blocoAlerta(id, titulo, itens, vazio, montarItem) {
      const sec = doc.createElement('section');
      sec.className = 'app-cartao hoje-alerta';
      sec.setAttribute('aria-labelledby', id);
      const h = doc.createElement('h2');
      h.id = id;
      h.textContent = titulo;
      sec.append(h);
      if (!Array.isArray(itens) || !itens.length) {
        const p = doc.createElement('p');
        p.className = 'app-apoio';
        p.textContent = itens === null ? 'Não foi possível carregar agora. Tente de novo em instantes.' : vazio;
        sec.append(p);
        return sec;
      }
      const ul = doc.createElement('ul');
      for (const x of itens) ul.append(montarItem(x));
      sec.append(ul);
      return sec;
    }
    function linhaAlerta(situacao, rotuloSituacao, principal, detalhe) {
      const li = doc.createElement('li');
      li.dataset.situacao = situacao;
      const selo = doc.createElement('span');
      selo.className = 'hoje-selo';
      selo.textContent = rotuloSituacao;
      const p = doc.createElement('p');
      p.textContent = principal;
      const d = doc.createElement('p');
      d.className = 'hoje-detalhe';
      d.textContent = detalhe;
      li.append(selo, p, d);
      return li;
    }
    function renderizarAlertas() {
      const alvo = el('hoje-alertas');
      if (!alvo) return;
      const certidoes = sessao?.certidoes, prazos = sessao?.prazos;
      // Sanções: o bloco só aparece se alguma empresa tiver sanção vigente (ou se a conferência falhou).
      const contratos = sessao?.contratos, comContrato = contratos === null || (Array.isArray(contratos) && contratos.length > 0);
      const sancoes = sessao?.sancoes, comSancao = sancoes === null || (Array.isArray(sancoes) && sancoes.length > 0);
      alvo.hidden = certidoes === undefined && prazos === undefined && !comSancao && !comContrato;
      if (alvo.hidden) { alvo.replaceChildren(); return; }
      const nomes = new Map(empresasAutorizadas().map((e) => [e.empresaId, e.rotulo]));
      const txt = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
      const filhos = [];
      if (comSancao) filhos.push(blocoAlerta('hoje-sancoes-titulo', 'Sanções (CEIS/CNEP)', sancoes, '', (s) =>
        linhaAlerta('atrasado', 'Sanção', txt(s.texto, 300) || 'Empresa com sanção vigente',
          // CNEP já traz o tipo no texto principal; no CEIS o tipo (suspensão, inidoneidade...) vai no detalhe.
          [nomes.get(s.empresaId) || 'Empresa', s.cadastro === 'CEIS' && txt(s.tipo, 200), 'Fonte: CGU'].filter(Boolean).join(' · '))));
      // Etapa 8 da esteira: contrato a vencer (90/60/30 dias) e pagamento atrasado, vindos do PNCP e do Contratos.gov.br.
      if (comContrato) filhos.push(blocoAlerta('hoje-contratos-titulo', 'Contratos e pagamentos', contratos, '', (c) => {
        const pag = c.tipo === 'pagamento';
        const ref = [nomes.get(c.empresaId) || 'Empresa', 'Contrato ' + (txt(c.numero, 60) || 'sem número')].join(' · ');
        return linhaAlerta(pag || c.dias <= 30 ? 'atrasado' : 'atencao', pag ? 'Pagamento atrasado' : 'Vence em ' + c.dias + (c.dias === 1 ? ' dia' : ' dias'),
          pag ? 'Liquidado e sem pagamento há ' + c.dias + ' dias' + (Number.isFinite(c.valor) ? ' (R$ ' + c.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + ')' : '')
            : 'Contrato vence em ' + c.dias + (c.dias === 1 ? ' dia' : ' dias') + ' (faixa de ' + c.nivel + ' dias)',
          ref + ' · Fonte: PNCP/Contratos.gov.br');
      }));
      if (certidoes !== undefined) filhos.push(blocoAlerta('hoje-certidoes-titulo', 'Certidões vencendo', certidoes, 'Nenhuma certidão vencida ou vencendo nos próximos 30 dias.', (c) => {
        const vencida = c.situacao === 'vencido';
        const empresa = nomes.get(c.empresaId) || 'Empresa';
        const li = linhaAlerta(vencida ? 'atrasado' : 'atencao', vencida ? 'Atrasado' : 'Atenção',
          [txt(c.tipo, 120) || 'Documento', txt(c.titulo, 200)].filter(Boolean).join(' · '),
          [empresa, CORE.textoVencimentoCertidao(c.dias, txt(c.vencimento, 10))].filter(Boolean).join(' · '));
        const href = CORE.linkDocumentos(c.empresaId);
        if (href) {
          const a = doc.createElement('a');
          a.href = href;
          a.textContent = 'Ver documentos';
          a.setAttribute('aria-label', 'Ver documentos de ' + empresa);
          li.append(a);
        }
        return li;
      }));
      const processos = new Map(autorizados.map((a) => [a.processoId, a.processoRotulo]));
      if (prazos !== undefined) filhos.push(blocoAlerta('hoje-prazos-titulo', 'Próximos prazos', prazos, 'Nenhum prazo nos próximos 7 dias.', (p) => {
        const quando = typeof p.vencimento === 'string' ? formatarPrazo(p.vencimento) : '';
        const li = linhaAlerta(p.dias <= 1 ? 'atencao' : 'em-dia', CORE.textoDiasPrazo(p.dias),
          txt(p.titulo, 200) || 'Prazo',
          [nomes.get(p.empresaId) || (p.empresaId ? 'Empresa' : 'Toda a organização'), processos.get(p.processoId), quando].filter(Boolean).join(' · '));
        // id real (uuid validado no servidor): o mesmo prazo baixado aqui e em processos.html tem o mesmo UID.
        const agenda = global.AgendaIcs?.montarBotao(doc, { id: p.id, titulo: txt(p.titulo, 200) || 'Prazo', inicio: p.vencimento,
          processo: processos.get(p.processoId), empresa: nomes.get(p.empresaId), empresaId: p.empresaId, processoId: p.processoId });
        if (agenda) li.append(agenda);
        return li;
      }));
      alvo.replaceChildren(...filhos);
    }

    function renderizarHoje() {
      renderizarAlertas();
      el('hoje-lista').replaceChildren(...empresasAutorizadas().map((e) => {
        const bloco = doc.createElement('article');
        bloco.className = 'app-cartao hoje-empresa';
        const titulo = doc.createElement('h2');
        titulo.textContent = e.rotulo;
        bloco.append(titulo);
        const procs = processosDe(e.empresaId);
        if (!procs.length) {
          const vazio = doc.createElement('p');
          vazio.textContent = 'Esta empresa ainda não tem processos cadastrados.';
          bloco.append(vazio);
        }
        const lista = doc.createElement('ul');
        for (const a of procs) {
          const item = doc.createElement('li');
          const texto = doc.createElement('p');
          texto.textContent = a.processoRotulo;
          const detalhe = doc.createElement('p');
          detalhe.className = 'hoje-detalhe';
          detalhe.textContent = [a.objeto, a.status && 'Situação: ' + a.status, a.prazo && 'Sessão: ' + formatarPrazo(a.prazo)].filter(Boolean).join(' · ');
          const botao = doc.createElement('button');
          botao.type = 'button';
          botao.className = 'app-primario';
          botao.textContent = 'Abrir processo';
          botao.setAttribute('aria-label', 'Abrir ' + a.processoRotulo + ' de ' + e.rotulo);
          botao.dataset.empresa = a.empresaId;
          botao.dataset.processo = a.processoId;
          item.append(texto, ...(detalhe.textContent ? [detalhe] : []), botao);
          lista.append(item);
        }
        bloco.append(lista);
        const preparo = doc.createElement('button');
        preparo.type = 'button';
        preparo.textContent = 'Preparar empresa';
        preparo.setAttribute('aria-label', 'Preparar identificação de ' + e.rotulo);
        preparo.dataset.prepararEmpresa = e.empresaId;
        bloco.append(preparo);
        const novo = doc.createElement('button');
        novo.type = 'button';
        novo.textContent = 'Novo processo';
        novo.setAttribute('aria-label', 'Cadastrar novo processo em ' + e.rotulo);
        novo.dataset.novoEmpresa = e.empresaId;
        bloco.append(novo);
        return bloco;
      }));
    }

    // Fronteira de sessão (entrar, sair, expirar, trocar usuário, nova verificação): apaga cartões e contexto.
    // Não é chamada por voltarHoje, selecionar nem troca de processo.
    function limparSessaoVisivel() {
      el('hoje-lista').replaceChildren();
      el('hoje-alertas')?.replaceChildren();
      atual = null;
      empresasSessao = [];
      novoEmpresaId = null;
      tentativa = null;
      ultimoDados = null;
      criandoNovo = false;
      prepEmpresaId = null;
      identDe = null;
      geracao += 1;
      const erroNovo = el('novo-processo-erro');
      if (erroNovo) erroNovo.textContent = '';
      const salvarNovo = el('novo-processo-salvar');
      if (salvarNovo) salvarNovo.disabled = false;
    }

    function fecharAreas() {
      try { componente?.fechar(); } catch { /* módulo já desmontado */ }
      try { ident?.limpar(''); } catch { /* idem */ }
      try { itensComp?.fechar(); } catch { /* módulo já desmontado */ }
      itensComp = null;
      el('itens-processo').replaceChildren();
      try { portalComp?.fechar(); } catch { /* módulo já desmontado */ }
      portalComp = null;
      el('portal-cliente')?.replaceChildren();
      try { esteiraComp?.fechar(); } catch { /* módulo já desmontado */ }
      esteiraComp = null;
      el('checklist-esteira')?.replaceChildren();
      try { anteriorComp?.fechar(); } catch { /* módulo já desmontado */ }
      anteriorComp = null;
      el('licitacao-anterior')?.replaceChildren();
      componente = null;
      ident = null;
      identDe = null;
      el('kit').replaceChildren();
      el('identificacao').replaceChildren();
      el('contexto-atual').textContent = '';
    }

    async function consultarSessao(comCatalogo) {
      try { return await auth.sessao({ comCatalogo }); } catch { return { estado: 'erro' }; }
    }

    // Toda chamada do controlador e dos itens leva o Bearer real: os handlers o exigem (_auth.js).
    // No QA o servidor troca pelo token do cookie, então o marcador enviado é inofensivo. Sem await no
    // caminho QA, para o fetch sair no mesmo instante de antes.
    async function requisitarAutenticado(url, op = {}) {
      const token = auth.token ? await auth.token() : sessao?.accessToken;
      const headers = { ...(op.headers || {}) };
      if (token) headers.Authorization = 'Bearer ' + token;
      return fetch(url, { ...op, headers });
    }

    // Encerra a casca sem recursão: a época avança antes de limpar, então respostas pendentes ficam obsoletas.
    function encerrarPorSessao(tela, texto) {
      ++epoca;
      fecharAreas();
      limparSessaoVisivel();
      sessao = null;
      autorizados = [];
      setBusy(false);
      mostrar(tela);
      aviso(texto, 'erro');
    }

    // Usada pelos módulos reais. Captura época e usuário antes do await; resposta obsoleta não entrega dados.
    async function obterSessao() {
      const epocaInicial = epoca;
      const usuarioInicial = sessao ? sessao.userId : null;
      const r = await consultarSessao();
      if (epocaInicial !== epoca) return null;
      if (r.estado === 'ok') {
        if (usuarioInicial === null || r.sessao.userId !== usuarioInicial) {
          if (usuarioInicial !== null) encerrarPorSessao('login', MSG.usuarioMudou);
          return null;
        }
        return r.sessao;
      }
      if (usuarioInicial !== null) {
        if (r.estado === 'erro') encerrarPorSessao('erro-sessao', MSG.sessaoNaoVerificada);
        else encerrarPorSessao('login', MSG.sessaoExpirada);
      }
      return null;
    }

    async function consultarContexto(c) {
      // itensPaginados:true é exigido pelo handler quando há mais de uma página de itens (sem ele, 409).
      // 403/404 = não autorizado; qualquer outra falha é tratada como falha de carregamento, não como ausência de acesso.
      try {
        const r = await requisitarAutenticado('/api/kit-documentos', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ acao: 'consultar', empresaId: c.empresaId, processoId: c.processoId, itensPaginados: true }),
        });
        if (!r.ok) return { ok: false, falha: r.status !== 403 && r.status !== 404 };
        const j = await r.json();
        return { ok: true, empresa: j.empresa, processo: j.processo, itens: Array.isArray(j.itens) ? j.itens : [] };
      } catch { return { ok: false, falha: true }; }
    }

    // Empresas e processos vêm dos mesmos pares autorizados; empresa só aparece se tiver ao menos um processo autorizado.
    function empresasAutorizadas() {
      const vistas = new Map();
      for (const e of empresasSessao) if (!vistas.has(e.empresaId)) vistas.set(e.empresaId, e.razaoSocial || 'Empresa');
      for (const a of autorizados) if (!vistas.has(a.empresaId)) vistas.set(a.empresaId, a.empresaRotulo);
      return [...vistas].map(([empresaId, rotulo]) => ({ empresaId, rotulo }));
    }

    function processosDe(empresaId) {
      return autorizados.filter((a) => a.empresaId === empresaId);
    }

    function preencherSeletores() {
      el('empresa-ativa').replaceChildren(...empresasAutorizadas().map((e) => {
        const o = doc.createElement('option');
        o.value = e.empresaId;
        o.textContent = e.rotulo;
        return o;
      }));
    }

    function preencherProcessos(empresaId) {
      const lista = processosDe(empresaId);
      el('processo-ativo').replaceChildren(...lista.map((a) => {
        const o = doc.createElement('option');
        o.value = a.processoId;
        o.textContent = a.processoRotulo;
        return o;
      }));
      el('processo-bloco').hidden = lista.length === 0;
    }

    // Alterações não salvas: só o módulo sabe. Sem confirmação explícita, a troca é cancelada.
    function haAlteracoesNaoSalvas() {
      try { if (componente?.temAlteracoesNaoSalvas?.() === true) return true; } catch { /* módulo indisponível */ }
      try { if (ident?.temAlteracoesNaoSalvas?.() === true) return true; } catch { /* idem */ }
      try { if (itensComp?.temAlteracoesNaoSalvas?.() === true) return true; } catch { /* idem */ }
      try { if (portalComp?.temAlteracoesNaoSalvas?.() === true) return true; } catch { /* idem */ }
      return false;
    }

    function podeTrocar() {
      if (!haAlteracoesNaoSalvas()) return true;
      try { return typeof confirmar === 'function' && confirmar(MSG.descartarAlteracoes) === true; } catch { return false; }
    }

    // Cancelar devolve os seletores ao contexto atual, sem fechar módulos nem perder rascunho.
    function restaurarSeletores() {
      const empresaId = atual ? atual.empresaId : prepEmpresaId;
      if (!empresaId) return;
      el('empresa-ativa').value = empresaId;
      if (atual) el('processo-ativo').value = atual.processoId;
    }

    // Abrir processo: o handler real (consultar) confirma empresa e processo antes de montar qualquer módulo.
    // 403/404 tira o par da lista desta sessão; outra falha mantém a lista e só avisa. Resposta obsoleta (época) não monta.
    async function selecionar(candidato) {
      // Kit só monta com processo: contexto sem processoId nunca chega aqui.
      if (!candidato || typeof candidato.processoId !== 'string' || !candidato.processoId) return;
      const e = epoca;
      let falha = false;
      let consulta = null;
      const [confirmado] = await CORE.autorizarContextos([candidato], async (c) => {
        const r = await consultarContexto(c);
        falha = r.falha === true;
        consulta = r;
        return r;
      });
      if (e !== epoca || tela !== 'area') return;
      if (!confirmado) {
        if (!falha) {
          autorizados = autorizados.filter((a) => !(a.empresaId === candidato.empresaId && a.processoId === candidato.processoId));
          preencherSeletores();
          renderizarHoje();
        }
        restaurarSeletores();
        atualizarVisao();
        aviso(falha ? MSG.processoNaoCarregado : MSG.processoNaoAutorizado, 'erro');
        return;
      }
      // Rótulos confirmados pelo servidor; detalhes de exibição continuam os do catálogo.
      const contexto = { ...candidato, ...confirmado };
      atual = contexto;
      fecharAreas();
      novoEmpresaId = null;
      prepEmpresaId = null;
      identDe = { empresaId: contexto.empresaId, modo: 'processo' };
      visao = 'processo';
      el('contexto-atual').textContent = contexto.rotulo;
      el('empresa-ativa').value = contexto.empresaId;
      preencherProcessos(contexto.empresaId);
      el('processo-ativo').value = contexto.processoId;
      CORE.gravarPreferencia(contexto, storage);
      ident = identificacao.montar({ alvo: el('identificacao'), obterSessao });
      ident.abrir(contexto.empresaId, sessao.userId);
      // Itens do processo: mesmo contexto do kit (empresa + processo). Sem processo, nunca chega aqui.
      // Gancho: apos salvar item, renova o catalogo do kit SOMENTE se o contexto ainda for o mesmo (epoca) e o mesmo kit.
      const epocaKit = epoca, kitDoItem = { atual: null };
      if (itens) itensComp = itens.montar({ alvo: el('itens-processo'), contexto: { empresaId: contexto.empresaId, processoId: contexto.processoId }, requisitar: requisitarAutenticado,
        // Mesmo kit e mesmo contexto, mesmo oculto (voltar ao Hoje preserva o kit). Fechado ou contexto trocado: bloqueia.
        aoSalvar: () => { if (epoca === epocaKit && componente !== null && componente === kitDoItem.atual) kitDoItem.atual?.atualizarItens?.(); } });
      if (esteira && el('checklist-esteira')) esteiraComp = esteira.montar({ alvo: el('checklist-esteira'), contexto: { empresaId: contexto.empresaId, processoId: contexto.processoId }, requisitar: requisitarAutenticado });
      if (anterior && el('licitacao-anterior')) anteriorComp = anterior.montar({ alvo: el('licitacao-anterior'), contexto: { empresaId: contexto.empresaId, processoId: contexto.processoId } });
      // Portal do cliente: compara a resposta do cliente com os itens que o consultar já trouxe.
      // shortcut: só a primeira página de itens do consultar; item de outra página aparece sem a checagem de "valores mudaram".
      if (portal && el('portal-cliente')) portalComp = portal.montar({ alvo: el('portal-cliente'), requisitar: requisitarAutenticado, confirmar: confirmar || undefined,
        contexto: { empresaId: contexto.empresaId, processoId: contexto.processoId, numero: typeof consulta?.processo?.numero === 'string' ? consulta.processo.numero : '' }, itens: consulta?.itens || [] });
      componente = kit.montar({
        alvo: el('kit'),
        contexto: { empresaId: contexto.empresaId, processoId: contexto.processoId },
        obterSessao,
        aoConferirIdentificacao: () => {
          const alvo = el('identificacao');
          alvo.focus?.();
          alvo.scrollIntoView?.({ block: 'start' });
        },
      });
      kitDoItem.atual = componente;
      atualizarVisao();
      el('area-titulo')?.focus?.();
    }

    async function iniciar() {
      const e = ++epoca;
      const tinhaSessao = sessao !== null;
      limparSessaoVisivel();
      setBusy(true);
      mostrar('carregando');
      aviso(MSG.carregando, 'carregando');
      const r = await consultarSessao(true);
      if (e !== epoca) return;
      setBusy(false);
      if (r.estado === 'erro') {
        fecharAreas(); limparSessaoVisivel(); sessao = null; autorizados = [];
        mostrar('erro-sessao'); aviso(MSG.sessaoNaoVerificada, 'erro');
        return;
      }
      if (r.estado === 'sem-sessao') {
        fecharAreas(); limparSessaoVisivel(); sessao = null; autorizados = [];
        mostrar('login');
        if (r.mensagem) aviso(r.mensagem, 'erro');
        else if (tinhaSessao) aviso(MSG.sessaoExpirada, 'erro');
        else aviso('', '');
        return;
      }
      sessao = r.sessao;
      // Uma requisição só (o catálogo): consultar roda por processo apenas quando ele é aberto (selecionar).
      autorizados = CORE.contextosDoCatalogo(sessao.contextos, sessao.empresas);
      empresasSessao = sessao.empresas || [];
      if (!empresasAutorizadas().length) {
        fecharAreas();
        limparSessaoVisivel();
        mostrar('sem-contexto'); aviso(MSG.semContexto, 'vazio');
        return;
      }
      preencherSeletores();
      // Empresa ativa salva (mesma chave do painel e do operacao.html): só vale se estiver entre as autorizadas.
      const preferida = CORE.lerPreferencia(storage);
      if (preferida && empresasAutorizadas().some((x) => x.empresaId === preferida)) el('empresa-ativa').value = preferida;
      visao = 'hoje';
      renderizarHoje();
      mostrar('area'); aviso('', '');
      // Link direto: o par precisa estar no catálogo desta conta; abrir ainda passa por consultar (selecionar).
      const link = CORE.lerLinkDireto(busca);
      if (!link) return;
      if (processosDe(link.empresaId).some((a) => a.processoId === link.processoId)) return abrirProcesso(link.empresaId, link.processoId);
      aviso(MSG.processoNaoAutorizado, 'erro');
    }

    async function entrar(email, password) {
      if (ocupado) return;
      const e = ++epoca;
      setBusy(true);
      mostrar('carregando');
      aviso(MSG.entrando, 'carregando');
      let r = { ok: false };
      try { r = await auth.entrar(email, password); } catch { r = { ok: false }; }
      if (e !== epoca) return;
      setBusy(false);
      if (!r || r.ok !== true) { mostrar('login'); aviso((r && r.mensagem) || MSG.erroEntrar, 'erro'); return; }
      await iniciar();
    }

    // Sair sempre é aceito: qualquer resposta pendente fica obsoleta pela época.
    async function sair() {
      const e = ++epoca;
      fecharAreas();
      limparSessaoVisivel();
      sessao = null;
      autorizados = [];
      setBusy(true);
      mostrar('carregando');
      aviso(MSG.encerrando, 'carregando');
      let ok = false;
      try { ok = (await auth.sair()).ok === true; } catch { ok = false; }
      if (e !== epoca) return;
      setBusy(false);
      if (ok) { mostrar('login'); aviso(MSG.encerrada, 'ok'); return; }
      // Sem confirmação do servidor, a sessão pode seguir ativa: não anuncia encerramento.
      mostrar('erro-sair'); aviso(MSG.erroSair, 'erro');
    }

    // Troca de empresa: abre o primeiro processo autorizado dela. Respostas da seleção anterior ficam obsoletas.
    function selecionarEmpresa(empresaId) {
      if (tela !== 'area') return;
      const lista = processosDe(empresaId);
      // Empresa sem processo abre a preparação (só identificação), nunca o kit.
      if (!lista.length) { prepararEmpresa(empresaId); return; }
      if (!podeTrocar()) { restaurarSeletores(); return; }
      ++epoca;
      return selecionar(lista[0]);
    }

    // Preparar empresa autorizada (com ou sem processo): monta só a identificação existente. Sem kit, sem processo.
    // Mesma empresa já montada em modo preparar: só reexibe, preservando alterações. Outra: confirma antes de descartar.
    function prepararEmpresa(empresaId) {
      if (tela !== 'area') return;
      const e = empresasAutorizadas().find((x) => x.empresaId === empresaId);
      if (!e) { restaurarSeletores(); return; }
      if (identDe && identDe.empresaId === empresaId && identDe.modo === 'preparar') {
        if (visao !== 'preparar') { visao = 'preparar'; atualizarVisao(); el('area-titulo')?.focus?.(); }
        return;
      }
      if (!podeTrocar()) { restaurarSeletores(); return; }
      ++epoca;
      fecharAreas();
      atual = null;
      novoEmpresaId = null;
      prepEmpresaId = empresaId;
      CORE.gravarPreferencia({ empresaId }, storage);
      identDe = { empresaId, modo: 'preparar' };
      visao = 'preparar';
      el('contexto-atual').textContent = 'Preparar empresa: ' + e.rotulo;
      el('empresa-ativa').value = empresaId;
      ident = identificacao.montar({ alvo: el('identificacao'), obterSessao });
      ident.abrir(empresaId, sessao.userId);
      atualizarVisao();
      el('area-titulo')?.focus?.();
    }

    // Troca de processo: só aceita processo autorizado para a empresa atualmente ativa.
    function selecionarProcesso(processoId) {
      const empresaId = el('empresa-ativa').value;
      const contexto = processosDe(empresaId).find((a) => a.processoId === processoId);
      if (!contexto || tela !== 'area') return;
      if (!podeTrocar()) { restaurarSeletores(); return; }
      ++epoca;
      return selecionar(contexto);
    }

    // Abre o processo a partir do Hoje. Só par da lista autorizada nesta sessão; resposta da visão anterior fica obsoleta.
    function abrirProcesso(empresaId, processoId) {
      if (tela !== 'area') return;
      const contexto = processosDe(empresaId).find((a) => a.processoId === processoId);
      if (!contexto) return;
      // Mesmo par ainda montado: só reexibe o módulo (rascunho e contexto preservados, sem remontar).
      if (atual && componente && atual.empresaId === empresaId && atual.processoId === processoId) {
        if (visao !== 'processo') { visao = 'processo'; atualizarVisao(); el('area-titulo')?.focus?.(); }
        return;
      }
      if (!podeTrocar()) return;
      ++epoca;
      return selecionar(contexto);
    }

    // Cadastro de processo: formulário no Hoje, só para empresa autorizada da descoberta.
    function abrirNovoProcesso(empresaId) {
      if (tela !== 'area' || visao !== 'hoje' || criandoNovo) return;
      const e = empresasAutorizadas().find((x) => x.empresaId === empresaId);
      if (!e) return;
      novoEmpresaId = empresaId;
      tentativa = null;
      ultimoDados = null;
      el('novo-processo-empresa').textContent = 'Empresa: ' + e.rotulo;
      el('novo-processo-erro').textContent = '';
      atualizarVisao();
      el('novo-processo-titulo')?.focus?.();
    }

    function fecharNovoProcesso() {
      if (criandoNovo) return;
      novoEmpresaId = null;
      tentativa = null;
      ultimoDados = null;
      el('novo-processo-erro').textContent = '';
      atualizarVisao();
    }

    // Envio único por tentativa: clique duplo é ignorado; reenvio com os mesmos dados usa o mesmo id.
    async function criarProcesso(campos) {
      if (criandoNovo || novoEmpresaId === null || tela !== 'area' || visao !== 'hoje') return;
      const empresaId = novoEmpresaId;
      const e = empresasAutorizadas().find((x) => x.empresaId === empresaId);
      if (!e) return;
      const v = CORE.validarProcessoNovo(campos);
      if (!v.ok) { el('novo-processo-erro').textContent = Object.values(v.erros).join(' '); return; }
      const dadosJson = JSON.stringify(v.dados);
      if (!tentativa || ultimoDados !== dadosJson) { tentativa = { id: CORE.novaTentativaId() }; ultimoDados = dadosJson; }
      const geracaoInicial = geracao;
      criandoNovo = true;
      el('novo-processo-salvar').disabled = true;
      el('novo-processo-erro').textContent = '';
      let r = null;
      let corpo = null;
      try {
        r = await requisitarAutenticado('/api/criar-processo', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ empresaId, tentativaId: tentativa.id, ...v.dados }),
        });
        corpo = await r.json().catch(() => null);
      } catch { r = null; }
      criandoNovo = false;
      if (geracaoInicial !== geracao) return;
      el('novo-processo-salvar').disabled = false;
      if (r && (r.status === 201 || r.status === 200) && corpo && corpo.processo && typeof corpo.processo.id === 'string') {
        const p = corpo.processo;
        if (p.empresa_id !== empresaId) { el('novo-processo-erro').textContent = MSG.erroNovoProcesso; return; }
        if (!autorizados.some((x) => x.processoId === p.id)) {
          const numero = typeof p.numero === 'string' ? p.numero : '';
          const processoRotulo = numero ? 'Processo ' + numero : 'Processo sem número';
          autorizados.push({ empresaId, processoId: p.id, empresaRotulo: e.rotulo, processoRotulo, rotulo: e.rotulo + ' · ' + processoRotulo });
        }
        novoEmpresaId = null;
        tentativa = null;
        ultimoDados = null;
        preencherSeletores();
        renderizarHoje();
        atualizarVisao();
        aviso('Processo cadastrado.', 'ok');
        return abrirProcesso(empresaId, p.id);
      }
      if (r && r.status === 401) { encerrarPorSessao('login', MSG.sessaoExpirada); return; }
      el('novo-processo-erro').textContent = corpo && typeof corpo.erro === 'string' ? corpo.erro : MSG.erroNovoProcesso;
    }

    // Volta ao Hoje sem fechar o módulo: o contexto e os rascunhos continuam válidos.
    function voltarHoje() {
      if (tela !== 'area' || (visao !== 'processo' && visao !== 'preparar')) return;
      visao = 'hoje';
      atualizarVisao();
      el('hoje-titulo')?.focus?.();
    }

    function selecionarIndice(i) {
      const contexto = autorizados[i];
      if (!contexto || tela !== 'area') return;
      ++epoca;
      return selecionar(contexto);
    }

    function tentarNovamente() {
      if (ocupado) return;
      return iniciar();
    }

    return {
      iniciar,
      entrar,
      sair,
      selecionarIndice,
      selecionarEmpresa,
      selecionarProcesso,
      abrirProcesso,
      voltarHoje,
      prepararEmpresa,
      abrirNovoProcesso,
      fecharNovoProcesso,
      criarProcesso,
      tentarNovamente,
      estado: () => ({ tela, visao, epoca, ocupado, criandoNovo, novoEmpresaId, prepEmpresaId, identDe: identDe ? { ...identDe } : null, kitMontado: componente !== null, itensMontado: itensComp !== null, autorizados: autorizados.map((a) => a.rotulo) }),
    };
  }

  global.LicitaPlenaComercialControlador = { criarControlador, criarAutenticacaoSupabase, MSG };
})(globalThis);
