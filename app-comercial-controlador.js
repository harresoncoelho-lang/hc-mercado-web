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
    empresasNaoCarregadas: 'Não foi possível carregar suas empresas. Tente de novo.',
    encerrada: CORE.MSG_SESSAO_ENCERRADA,
    descartarAlteracoes: 'Há alterações não salvas nesta peça. Se trocar agora, elas serão descartadas. Continuar?',
    erroNovoProcesso: 'Não foi possível cadastrar o processo. Tente de novo.',
  };

  function criarControlador({ doc, fetch, storage, kit, identificacao, itens = null, confirmar = null }) {
    const el = (id) => doc.getElementById(id);
    let epoca = 0;
    let atual = null;
    let ocupado = false;
    let sessao = null;
    let autorizados = [];
    let componente = null;
    let ident = null;
    let itensComp = null;
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
    }

    function setBusy(v) {
      ocupado = v;
      el('login-entrar').disabled = v;
      el('sair').disabled = v;
      el('tentar').disabled = v;
    }

    function mostrar(t) {
      tela = t;
      el('login').hidden = t !== 'login';
      el('sair').hidden = !(t === 'area' || t === 'sem-contexto' || t === 'erro-sair' || t === 'erro-empresas');
      el('tentar').hidden = !(t === 'erro-sessao' || t === 'erro-empresas');
      atualizarVisao();
    }

    // Uma visão por vez. Ocultar não desmonta: o contexto e os rascunhos do processo continuam no módulo.
    function atualizarVisao() {
      const processo = tela === 'area' && visao === 'processo';
      const preparar = tela === 'area' && visao === 'preparar';
      const hoje = tela === 'area' ? visao === 'hoje' : ['carregando', 'sem-contexto', 'erro-empresas'].includes(tela);
      el('area').hidden = !(processo || preparar);
      // Kit só existe com processo: em preparação ele fica oculto e sem montagem.
      el('kit').hidden = !processo;
      // Itens do processo só existem com processo: somem na preparação e no Hoje.
      el('itens-processo').hidden = !processo;
      el('empresa-bloco').hidden = !(processo || preparar);
      el('processo-bloco').hidden = !processo || processosDe(atual?.empresaId).length === 0;
      el('hoje').hidden = !hoje;
      el('novo-processo-bloco').hidden = !(hoje && novoEmpresaId !== null);
      el('hoje-estado').textContent = textoHoje();
    }

    function textoHoje() {
      if (tela === 'carregando') return 'Carregando empresas e processos autorizados…';
      if (tela === 'sem-contexto') return CORE.MSG_SEM_CONTEXTO;
      if (tela === 'erro-empresas') return MSG.empresasNaoCarregadas;
      return '';
    }

    // Lista só o que o servidor autorizou nesta sessão. Sem métricas, datas ou prazos.
    function renderizarHoje() {
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
          const botao = doc.createElement('button');
          botao.type = 'button';
          botao.className = 'app-primario';
          botao.textContent = 'Abrir processo';
          botao.setAttribute('aria-label', 'Abrir ' + a.processoRotulo + ' de ' + e.rotulo);
          botao.dataset.empresa = a.empresaId;
          botao.dataset.processo = a.processoId;
          item.append(texto, botao);
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
      componente = null;
      ident = null;
      identDe = null;
      el('kit').replaceChildren();
      el('identificacao').replaceChildren();
      el('contexto-atual').textContent = '';
    }

    async function consultarSessao() {
      try {
        const r = await fetch('/qa/session', { credentials: 'same-origin' });
        if (r.status === 401) return { estado: 'sem-sessao' };
        if (!r.ok) return { estado: 'erro' };
        const j = await r.json();
        if (!j || typeof j.userId !== 'string') return { estado: 'erro' };
        const empresas = Array.isArray(j.empresas) ? j.empresas.filter((e) => e && typeof e.empresaId === 'string').map((e) => ({ empresaId: e.empresaId, razaoSocial: typeof e.razaoSocial === 'string' ? e.razaoSocial.trim() : '' })) : [];
        return { estado: 'ok', sessao: { userId: j.userId, accessToken: j.accessToken, contextos: Array.isArray(j.contextos) ? j.contextos : [], empresas } };
      } catch { return { estado: 'erro' }; }
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
        const r = await fetch('/api/kit-documentos', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ acao: 'consultar', empresaId: c.empresaId, processoId: c.processoId, itensPaginados: true }),
        });
        if (!r.ok) return { ok: false, falha: r.status !== 403 && r.status !== 404 };
        const j = await r.json();
        return { ok: true, empresa: j.empresa, processo: j.processo };
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

    function selecionar(contexto) {
      // Kit só monta com processo: contexto sem processoId nunca chega aqui.
      if (!contexto || typeof contexto.processoId !== 'string' || !contexto.processoId) return;
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
      if (itens) itensComp = itens.montar({ alvo: el('itens-processo'), contexto: { empresaId: contexto.empresaId, processoId: contexto.processoId }, requisitar: (url, op) => fetch(url, op),
        // Mesmo kit e mesmo contexto, mesmo oculto (voltar ao Hoje preserva o kit). Fechado ou contexto trocado: bloqueia.
        aoSalvar: () => { if (epoca === epocaKit && componente !== null && componente === kitDoItem.atual) kitDoItem.atual?.atualizarItens?.(); } });
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
      const r = await consultarSessao();
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
        tinhaSessao ? aviso(MSG.sessaoExpirada, 'erro') : aviso('', '');
        return;
      }
      sessao = r.sessao;
      let falhas = 0;
      const aut = await CORE.autorizarContextos(sessao.contextos, async (c) => {
        const r = await consultarContexto(c);
        if (r.falha) falhas += 1;
        return r;
      });
      if (e !== epoca) return;
      autorizados = aut;
      empresasSessao = sessao.empresas || [];
      if (!empresasAutorizadas().length) {
        fecharAreas();
        limparSessaoVisivel();
        if (falhas > 0) { mostrar('erro-empresas'); aviso(MSG.empresasNaoCarregadas, 'erro'); }
        else { mostrar('sem-contexto'); aviso(MSG.semContexto, 'vazio'); }
        return;
      }
      preencherSeletores();
      visao = 'hoje';
      renderizarHoje();
      mostrar('area'); aviso('', '');
    }

    async function entrar(email, password) {
      if (ocupado) return;
      const e = ++epoca;
      setBusy(true);
      mostrar('carregando');
      aviso(MSG.entrando, 'carregando');
      let ok = false;
      try {
        const r = await fetch('/qa/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ email, password }),
        });
        ok = r.ok === true;
      } catch { ok = false; }
      if (e !== epoca) return;
      setBusy(false);
      if (!ok) { mostrar('login'); aviso(MSG.erroEntrar, 'erro'); return; }
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
      try {
        const r = await fetch('/qa/logout', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: '{}',
        });
        ok = r.ok === true;
      } catch { ok = false; }
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
      selecionar(lista[0]);
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
      selecionar(contexto);
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
      selecionar(contexto);
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
        r = await fetch('/api/criar-processo', {
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
        abrirProcesso(empresaId, p.id);
        return;
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
      selecionar(contexto);
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

  global.LicitaPlenaComercialControlador = { criarControlador, MSG };
})(globalThis);
