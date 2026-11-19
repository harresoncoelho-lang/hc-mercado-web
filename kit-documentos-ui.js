(function (global) {
  'use strict';
  function mensagemFalha(e) {
    return Array.isArray(e?.pendencias) && e.pendencias.length ? 'Falta cadastro para preparar a prévia. Complete os campos indicados e prepare de novo.' : 'A operação falhou. Prepare e confirme uma nova prévia antes de baixar.';
  }
  // Sem hook, o link continua apontando para operacao.html (comportamento original). Com hook, o clique fica dentro da casca.
  function alvoCadastro(escopo, aoConferir) {
    if (typeof aoConferir === 'function') return { href: '#identificacao', target: null, rel: null, aoClicar: (ev) => { ev.preventDefault(); aoConferir({ empresaId: escopo.empresaId, processoId: escopo.processoId }); } };
    return { href: `operacao.html?aba=identificacao&empresa=${encodeURIComponent(escopo.empresaId)}&processo=${encodeURIComponent(escopo.processoId)}`, target: '_blank', rel: 'noopener noreferrer', aoClicar: null };
  }
  // Textos do cadastro: no /app (com hook) a identificação abre na mesma página; sem hook, mantém o texto legado de nova aba.
  function textosCadastro(aoConferir) {
    return typeof aoConferir === 'function'
      ? { link: 'Conferir dados da empresa', aberto: 'Identificação aberta nesta página. Consulte novamente os dados antes de preparar a prévia.' }
      : { link: 'Conferir dados da empresa (nova aba)', aberto: 'Cadastro aberto em outra aba. Consulte novamente os dados antes de preparar a prévia.' };
  }
  // O rascunho guarda o marcador {{cpf_representante}}; o CPF real só entra no DOCX exportado (lido na hora no servidor).
  // Na tela o marcador aparece legível e volta a ser marcador ao salvar.
  const MARCADOR_CPF = /\{\{\s*cpf_representante\s*\}\}/g, ROTULO_CPF = '[CPF do representante]';
  // Peça legada (gerada antes da correção A1) pode ter o CPF formatado no texto: também vira o rótulo, e ao salvar, marcador.
  const CPF_FORMATADO = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;
  const textoParaTela = t => String(t ?? '').replace(MARCADOR_CPF, ROTULO_CPF).replace(CPF_FORMATADO, ROTULO_CPF);
  const textoParaSalvar = t => String(t ?? '').split(ROTULO_CPF).join('{{cpf_representante}}');
  function criarControle() {
    let geracao = 0, aberto = false, hash = '', revisado = false, documentoId, versao;
    const vigente = g => aberto && g === geracao;
    return {
      abrir(peca = {}) { aberto = true; hash = ''; revisado = false; documentoId = peca.documentoId; versao = peca.versao; return ++geracao; },
      fechar() { aberto = false; hash = ''; revisado = false; ++geracao; },
      alterar() { hash = ''; revisado = false; return ++geracao; },
      vigente,
      preparada(h, g = geracao) { if (!vigente(g) || !h) return false; hash = h; revisado = false; return true; },
      confirmada(d, g) {
        if (!vigente(g) || !hash || d?.id !== documentoId || d.versao !== versao || d.revisao?.hash !== hash) return false;
        revisado = true; return true;
      },
      podeExportar() { return aberto && Boolean(hash) && revisado; },
      get hash() { return hash; }, get geracao() { return geracao; }
    };
  }
  function criarSelecao() {
    const mapa = new Map();
    return { restaurar(p = {}) { mapa.clear(); for (const id of p.itemIds || []) mapa.set(id, p.unidades?.[id] || ''); },
      definir(id, marcado, unidade = '') { if (marcado) mapa.set(id, unidade); else mapa.delete(id); },
      campos() { const itemIds = [...mapa.keys()].sort(); return { itemIds, unidades: Object.fromEntries(itemIds.map(id => [id, mapa.get(id)])) }; },
      tem(id) { return mapa.has(id); }, unidade(id) { return mapa.get(id) || ''; } };
  }
  // Quantidade do banco vem com 3 casas ("400.000", que em pt-BR se lê quatrocentos mil): mesma regra de itens-processo-ui.js.
  const quantidadeTexto = v => v === null || v === undefined || v === '' ? 'não informado' : String(v).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '').replace('.', ',');
  // Proposta nova parte da "Proposta padrão" do perfil; campo já preenchido pelo usuário não é sobrescrito.
  function aplicarPadraoProposta(atual, padrao) {
    const saida = { ...atual };
    for (const n of ['validade', 'prazoEntrega', 'pagamento']) if (!saida[n] && typeof padrao?.[n] === 'string') saida[n] = padrao[n];
    return saida;
  }
  function montar({ alvo, contexto, obterSessao, requisitar = global.fetch.bind(global), canalLeitura = null, aoConferirIdentificacao = null }) {
    const controle = criarControle(), escopo = { empresaId: contexto.empresaId, processoId: contexto.processoId };
    let dados = null, ocupado = false, usuario = null, documentos = [], peca, alterado = true, tentativa = null, cadastroAberto = false;
    let itensPendentes = false; // atualizacao pedida durante operacao em curso: roda quando o kit ficar livre
    let estado = 'Novo · não salvo', listaEstado = 'carregando', listaErro = '', geracaoLista = 0, trocaPendente = null;
    const selecao = criarSelecao(), conhecidos = new Map(); let cursores = [undefined], pagina = 0, maisItens = false, selecionados = false, paginaSelecao = 0;
    const doc = alvo.ownerDocument;
    let leituraAtiva=null;
    let relatos=[],reciboSelecionado=null,cursorRelatos=null,geracaoRelatos=0;
    const canalDisponivel=()=>canalLeitura&&/^[a-p]{32}$/.test(canalLeitura.extensionId)&&typeof canalLeitura.runtime?.connect==='function';
    async function cancelarLeitura(expectedId=null){
      if(expectedId&&leituraAtiva?.id!==expectedId)return;
      const anterior=leituraAtiva;leituraAtiva=null;if(!anterior)return;
      clearTimeout(anterior.timer);try{anterior.port?.disconnect();}catch{}
      if(controle.vigente(controle.geracao))atualizar();
      const session=await obterSessao();if(!session||session.userId!==anterior.usuario)return;
      try{await requisitar('/api/kit-documentos',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.accessToken}`},body:JSON.stringify({acao:'cancelarLeitura',tentativaId:anterior.id})});}catch{}
    }
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const decimalTexto = v => String(v ?? 'não informado').replace('.', ',');
    const cnpjTexto = v => String(v ?? '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    const campo = (nome, titulo, attrs = '') => `<label>${titulo}<input name="${nome}" ${attrs}></label>`;
    alvo.innerHTML = `<section class="kit-documentos" aria-label="Documentos e propostas">
      <h3>Documentos e propostas</h3><p class="kit-contexto" data-contexto>Carregando empresa e processo…</p>
      <p><a class="link" data-cadastro target="_blank" rel="noopener noreferrer">Conferir dados da empresa (nova aba)</a></p>
      <p>Confira as exigências do edital. Sem assinatura, envio ou protocolo automático.</p><div data-requisitos></div>
      <section class="kit-lista" aria-label="Documentos salvos"><h4>Documentos salvos</h4><div data-lista></div>
      <div class="kit-acoes"><button type="button" class="btn" data-novo="declaracao">Nova declaração</button><button type="button" class="btn" data-novo="proposta">Nova proposta</button><button type="button" class="btn" data-listar>Atualizar lista</button></div></section>
      <p role="status" aria-live="polite" data-aviso></p><div data-pendencias></div>
      <div class="kit-alerta" data-descarte hidden><p>Há alterações não salvas nesta peça. Salve antes de sair para preservá-las.</p><button type="button" class="btn" data-cancelar-troca>Continuar editando</button><button type="button" class="btn" data-descartar>Descartar alterações e continuar</button></div>
      <form novalidate><h4 tabindex="-1" data-peca>Nova declaração</h4><p class="kit-estado" data-estado></p><p data-historico></p>
      <label>Tipo de documento<select name="tipo"><option value="declaracao">Declaração com texto informado</option><option value="proposta">Proposta de materiais</option></select></label>
      <div data-declaracao>${campo('titulo', 'Título da declaração', 'maxlength="180"')}<label>Texto do modelo (até 20.000 caracteres)<textarea name="texto" maxlength="20000" rows="6"></textarea></label>${campo('fonte', 'Referência informada pelo usuário (opcional; não verificada)', 'maxlength="1000"')}<p>Variáveis permitidas: {{razao_social}}, {{cnpj}}, {{endereco}}, {{representante}}, {{cargo}}, {{numero_edital}}, {{orgao}}. Para o CPF do representante, escreva [CPF do representante]: o número só entra no arquivo exportado.</p></div>
      <div data-proposta hidden><p>Selecione os itens (limite técnico e tamanho total serão conferidos). Quantidade, preço ofertado, marca e modelo vêm do cadastro. A unidade vem do edital quando disponível; confira e ajuste.</p><p data-contagem-itens></p><button type="button" class="btn" data-ver-selecionados>Ver selecionados</button><div data-itens></div><button type="button" class="btn" data-itens-anterior>Itens anteriores</button><button type="button" class="btn" data-itens-proxima>Próximos itens</button><div data-itens-ausentes></div>${campo('validade', 'Validade da proposta', 'maxlength="500"')}${campo('prazoEntrega', 'Prazo de entrega', 'maxlength="500"')}${campo('pagamento', 'Condições de pagamento', 'maxlength="500"')}</div>
      <div class="kit-acoes"><button type="button" class="btn primario" data-salvar disabled>Salvar rascunho</button><button type="submit" class="btn" data-preparar disabled>Preparar prévia</button><button type="button" class="btn" data-recarregar hidden>Carregar versão do servidor</button></div></form>
      <section class="kit-previa" aria-label="Revisão da peça"><h4 tabindex="-1" data-titulo-previa>Prévia integral</h4><pre data-previa>Salve o rascunho e prepare a prévia para conferir todo o conteúdo.</pre><div data-fontes></div>
      <label class="kit-revisao"><input type="checkbox" data-revisado disabled> Conferi os dados e o conteúdo para este edital</label>
      <div class="kit-acoes"><button type="button" class="btn primario" data-exportar disabled>Baixar DOCX</button><button type="button" class="btn" data-cancelar-previa disabled>Cancelar revisão</button><button type="button" class="btn" data-preparar-operacao hidden disabled>Preparar cadastro</button></div><div data-leitura hidden><div class="kit-acoes"><button type="button" class="btn" data-iniciar-leitura disabled>Conferir página com extensão</button><button type="button" class="btn" data-cancelar-leitura disabled>Cancelar leitura</button></div><section aria-label="Correspondências dos relatos"><h4>Conferir itens observados</h4><p>Relatos parciais, separados por recibo. Grupo, exigências e completude desconhecidos. Não autoriza cadastro.</p><button type="button" class="btn" data-carregar-relatos disabled>Carregar relatos desta revisão</button><button type="button" class="btn" data-mais-relatos disabled>Recibos anteriores</button><label>Recibo observado<select data-recibo><option value="">Selecione um recibo</option></select></label><div data-pares></div><label><input type="checkbox" data-pares-revisados> Conferi cada correspondência selecionada</label><button type="button" class="btn" data-salvar-pares disabled>Salvar correspondências revisadas</button><p data-pares-status role="status" aria-live="polite"></p></section><p data-canal-status>Canal de leitura indisponível: requer configuração e homologação da extensão.</p></div><pre data-operacao role="status" aria-live="polite" hidden></pre></section></section>`;
    const el = s => alvo.querySelector(s), form = el('form');
    const cadastro = alvoCadastro(escopo, aoConferirIdentificacao), linkCadastro = el('[data-cadastro]');
    linkCadastro.href = cadastro.href;
    linkCadastro.textContent = textosCadastro(aoConferirIdentificacao).link;
    if (cadastro.target) linkCadastro.target = cadastro.target; else linkCadastro.removeAttribute('target');
    if (cadastro.rel) linkCadastro.rel = cadastro.rel; else linkCadastro.removeAttribute('rel');
    if (cadastro.aoClicar) linkCadastro.addEventListener('click', cadastro.aoClicar);
    const aviso = texto => { el('[data-aviso]').textContent = texto; };
    const pendencias = lista => { el('[data-pendencias]').innerHTML = lista.length ? `<p>Confira os campos, a identificação empresarial e os itens:</p><ul>${lista.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''; };
    function vivo(g) {
      if (!controle.vigente(controle.geracao)) return false;
      if (contexto.empresaId !== escopo.empresaId || contexto.processoId !== escopo.processoId) { controle.fechar(); alvo.replaceChildren(); }
      return controle.vigente(g);
    }
    function limparPrevia(texto = 'Salve o rascunho e prepare a prévia para conferir todo o conteúdo.') {
      void cancelarLeitura();limparRelatos();
      el('[data-operacao]').textContent = ''; el('[data-operacao]').hidden = true;
      el('[data-revisado]').checked = false; el('[data-previa]').textContent = texto; el('[data-fontes]').textContent = '';
    }
    function atualizar() {
      if (itensPendentes && !ocupado) { itensPendentes = false; controle.alterar(); limparPrevia('Itens atualizados. Prepare uma nova pr\u00e9via antes de baixar.'); void consultar(); }
      const proposta = form.elements.tipo.value === 'proposta';
      el('[data-declaracao]').hidden = proposta; el('[data-proposta]').hidden = !proposta;
      for (const input of el('[data-declaracao]').querySelectorAll('input,textarea')) input.disabled = proposta;
      for (const input of el('[data-proposta]').querySelectorAll('input')) input.disabled = !proposta || input.dataset.bloqueado === 'true';
      form.inert = !dados; form.elements.tipo.disabled = Boolean(peca?.versao || tentativa);
      el('[data-salvar]').disabled = ocupado || !dados || (!alterado && !tentativa);
      el('[data-salvar]').textContent = tentativa && !ocupado ? 'Repetir salvamento' : 'Salvar rascunho';
      el('[data-preparar]').disabled = ocupado || !dados || cadastroAberto || alterado || !peca?.versao || Boolean(tentativa) || Boolean(dados.pendencias?.length);
      el('[data-revisado]').disabled = ocupado || !controle.hash;
      el('[data-exportar]').disabled = ocupado || !controle.podeExportar() || itensPendentes;
      // Extensão de leitura desligada por padrão (nenhuma tela passa canalLeitura): o bloco técnico não aparece ao usuário.
      el('[data-leitura]').hidden = !canalDisponivel();
      el('[data-iniciar-leitura]').disabled = !canalDisponivel()||ocupado||!proposta||!controle.podeExportar()||alterado||Boolean(leituraAtiva);
      el('[data-cancelar-leitura]').disabled = !leituraAtiva;
      el('[data-carregar-relatos]').disabled=!canalDisponivel()||ocupado||!proposta||!controle.podeExportar()||alterado;
      el('[data-mais-relatos]').disabled=ocupado||!cursorRelatos||!controle.podeExportar()||alterado;
      el('[data-salvar-pares]').disabled=ocupado||!reciboSelecionado||!controle.podeExportar()||alterado||!el('[data-pares-revisados]').checked;
      el('[data-preparar-operacao]').hidden = !proposta || !controle.podeExportar();
      el('[data-preparar-operacao]').disabled = ocupado || !controle.podeExportar();
      el('[data-cancelar-previa]').disabled = !controle.hash && !['Preparando prévia…', 'Confirmando revisão…', 'Exportando DOCX…'].includes(estado);
      el('[data-salvar]').classList.toggle('primario', alterado || Boolean(tentativa));
      el('[data-preparar]').classList.toggle('primario', !alterado && !controle.hash);
      el('[data-listar]').disabled = ocupado;
      for (const botao of alvo.querySelectorAll('[data-novo]')) botao.disabled = !dados;
      el('[data-estado]').textContent = `${estado}${peca?.versao ? ` · versão ${peca.versao}` : ''}`;
      el('[data-historico]').textContent = peca?.revisao && !controle.podeExportar() ? 'Revisão histórica registrada. Prepare e confirme novamente nesta abertura antes de baixar.' : '';
      el('[data-lista]').setAttribute('aria-busy', String(listaEstado === 'carregando'));
      alvo.setAttribute('aria-busy', String(ocupado || listaEstado === 'carregando'));
    }
    function renderLista() {
      const foco = doc.activeElement?.dataset?.abrir;
      el('[data-lista]').innerHTML = listaEstado === 'carregando' ? '<p>Carregando documentos…</p>' : listaEstado === 'erro' ? `<p role="alert">Não foi possível carregar a lista. ${esc(listaErro)} Use Atualizar lista para tentar novamente.</p>` : !documentos.length ? '<p>Nenhum documento salvo neste processo.</p>' : `<ul>${documentos.map(d => `<li><div><strong>${esc(d.titulo || (d.tipo === 'proposta' ? 'Proposta de materiais' : 'Declaração'))}</strong><p>${d.tipo === 'proposta' ? 'Proposta' : 'Declaração'} · versão ${esc(d.versao)} · ${d.revisadoEm ? 'Revisão histórica registrada' : 'Pendente de revisão'}${d.id === peca?.id ? ' · Em edição' : ''}</p></div><button type="button" class="btn" data-abrir="${esc(d.id)}" aria-label="Abrir ${esc(d.titulo || d.tipo)}, versão ${esc(d.versao)}">Abrir</button></li>`).join('')}</ul>`;
      if (foco) [...alvo.querySelectorAll('[data-abrir]')].find(b => b.dataset.abrir === foco)?.focus();
    }
    function atualizarLista(d) {
      const recarregar = listaEstado === 'carregando';
      ++geracaoLista; documentos = [d, ...documentos.filter(v => v.id !== d.id)]; listaEstado = 'pronta'; renderLista();
      if (recarregar) void listar();
    }
    function renderItens() {
      const ids = selecao.campos().itemIds;
      const visiveis = selecionados ? ids.slice(paginaSelecao * 100, (paginaSelecao + 1) * 100).map(id => conhecidos.get(id) || { id, tipo: 'item', identificador: id, descricao: 'Selecionado salvo; dados serão conferidos ao preparar.' }) : (dados?.itens || []);
      el('[data-itens]').innerHTML = visiveis.map(item => `<div class="kit-item"><label><input type="checkbox" data-item value="${esc(item.id)}" ${item.tipo !== 'item' ? 'data-bloqueado="true" disabled' : ''}> ${esc(item.identificador)} — ${esc(item.descricao)}</label><p>Quantidade: ${esc(quantidadeTexto(item.quantidade))}${item.unidade ? ' ' + esc(item.unidade) : ''} · Unitário ofertado: R$ ${esc(decimalTexto(item.valorUnitario))} · Marca: ${esc(item.marca || 'não informada')} · Modelo: ${esc(item.modelo || 'não informado')}${item.tipo !== 'item' ? ' · Lote pendente de detalhamento' : ''}</p>${campo(`unidade-${esc(item.id)}`, 'Unidade deste item', 'maxlength="40"')}</div>`).join('') || '<p>Nenhum item cadastrado. Cadastre os itens no acompanhamento.</p>';
      for (const input of alvo.querySelectorAll('[data-item]')) { input.checked = selecao.tem(input.value); form.elements['unidade-' + input.value].value = selecao.tem(input.value) ? selecao.unidade(input.value) : conhecidos.get(input.value)?.unidade || ''; }
      el('[data-contagem-itens]').textContent = ids.length + ' selecionados · limite técnico: ' + (dados?.limitesProposta?.itens || 'consultar servidor') + ' · tamanho total também limitado';
      el('[data-itens-anterior]').disabled = ocupado || (selecionados ? paginaSelecao === 0 : pagina === 0);
      el('[data-itens-proxima]').disabled = ocupado || (selecionados ? (paginaSelecao + 1) * 100 >= ids.length : !maisItens);
      el('[data-ver-selecionados]').textContent = selecionados ? 'Ver catálogo de itens' : 'Ver selecionados';
      el('[data-itens-ausentes]').textContent = '';
    }
    async function mudarPagina(direcao) {
      if (ocupado || !dados) return;
      if (selecionados) { paginaSelecao = Math.max(0, paginaSelecao + direcao); renderItens(); return; }
      const proxima = pagina + direcao; if (proxima < 0 || (direcao > 0 && !maisItens)) return;
      const g = controle.geracao; ocupado = true; atualizar();
      try { const r = await enviar({ ...escopo, acao: 'listarItens', ...(cursores[proxima] ? { afterId: cursores[proxima] } : {}) }, g);
        if (!r || !vivo(g)) return;
        if (!Array.isArray(r.itens) || !r.paginacaoItens || r.itens.length > 100 || (r.paginacaoItens.hasMore && !r.paginacaoItens.nextCursor)) throw new Error('Página incompleta. Tente novamente.');
        pagina = proxima; dados.itens = r.itens; maisItens = r.paginacaoItens.hasMore; cursores[pagina + 1] = r.paginacaoItens.nextCursor;
        for (const item of r.itens) conhecidos.set(item.id, item);
      } catch (e) { if (vivo(g)) aviso(e.message); }
      finally { if (vivo(g)) { ocupado = false; renderItens(); atualizar(); } }
    }
    function capturarItem(e) {
      const input = e.target; const id = input.dataset.item !== undefined ? input.value : input.name?.startsWith('unidade-') ? input.name.slice(8) : null;
      if (id) { const checked = input.dataset.item !== undefined ? input.checked : selecao.tem(id); selecao.definir(id, checked, form.elements['unidade-' + id]?.value || ''); el('[data-contagem-itens]').textContent = selecao.campos().itemIds.length + ' selecionados'; }
    }
    function lerCampos() {
      if (form.elements.tipo.value === 'declaracao') return { declaracao: Object.fromEntries(['titulo', 'texto', 'fonte'].map(n => [n, n === 'texto' ? textoParaSalvar(form.elements[n].value) : form.elements[n].value])) };
      return { proposta: { ...selecao.campos(), ...Object.fromEntries(['validade', 'prazoEntrega', 'pagamento'].map(n => [n, form.elements[n].value])) } };
    }
    function camposIguais(d) {
      const atual = lerCampos()[d.tipo], salvo = d.dados[d.tipo];
      if (d.tipo === 'declaracao') return ['titulo', 'fonte'].every(n => atual[n] === salvo[n]) && textoParaTela(atual.texto) === textoParaTela(salvo.texto);
      return ['validade', 'prazoEntrega', 'pagamento'].every(n => atual[n] === salvo[n]) && atual.itemIds.length === salvo.itemIds.length && atual.itemIds.every((id, i) => id === salvo.itemIds[i] && atual.unidades[id] === salvo.unidades[id]);
    }
    function preencher(d) {
      form.reset(); form.elements.tipo.value = d.tipo;
      const campos = d.dados?.[d.tipo] || {};
      selecao.restaurar(campos); renderItens();
      for (const n of ['titulo', 'texto', 'fonte', 'validade', 'prazoEntrega', 'pagamento']) form.elements[n].value = n === 'texto' && d.tipo === 'declaracao' ? textoParaTela(campos[n]) : campos[n] || '';

    }
    function nova(tipo, focar = true) {
      peca = { id: global.crypto.randomUUID(), tipo, versao: 0 }; controle.abrir({ documentoId: peca.id, versao: 0 });
      tentativa = null; alterado = true; ocupado = false; estado = 'Novo · não salvo'; preencher(peca); limparPrevia(); pendencias(dados?.pendencias || []);
      if (tipo === 'proposta') { const p = aplicarPadraoProposta({}, dados?.propostaPadrao); for (const n of ['validade', 'prazoEntrega', 'pagamento']) form.elements[n].value = p[n] || ''; }
      el('[data-peca]').textContent = tipo === 'proposta' ? 'Nova proposta' : 'Nova declaração'; el('[data-recarregar]').hidden = true;
      aviso('Novo rascunho. Salve para preservar seu trabalho.'); atualizar(); renderLista();
      if (focar) (tipo === 'declaracao' ? form.elements.titulo : el('[data-proposta] input'))?.focus();
    }
    // Unidade e condições sugeridas (PNCP / Proposta padrão) não contam como trabalho do usuário; a seleção de itens conta.
    function algoPreenchido() {
      const sugerido = e => e.name?.startsWith('unidade-') || (typeof dados?.propostaPadrao?.[e.name] === 'string' && e.value === dados.propostaPadrao[e.name]);
      return [...form.querySelectorAll('input,textarea')].some(e => !e.disabled && (e.type === 'checkbox' ? e.checked : Boolean(e.value) && !sugerido(e)));
    }
    function pedirTroca(acao) {
      const preenchido = algoPreenchido();
      if (alterado && (peca.versao || tentativa || preenchido || (peca.tipo === 'proposta' && selecao.campos().itemIds.length > 0))) {
        trocaPendente = acao; el('[data-descarte]').hidden = false; el('[data-cancelar-troca]').focus(); return;
      }
      acao();
    }
    function invalidar() {
      void cancelarLeitura();
      controle.alterar(); ocupado = false; alterado = true; estado = peca.versao ? 'Alterações não salvas' : 'Novo · não salvo';
      limparPrevia('Conteúdo alterado. Salve e prepare uma nova prévia.'); aviso(tentativa ? 'Salvamento anterior incerto. Repetir confirma a mesma tentativa; suas novas alterações continuam no formulário.' : 'Alterações não salvas.'); atualizar();
    }
    async function enviar(body, g, verificar = () => vivo(g)) {
      const sessao = await obterSessao();
      if (!verificar()) return null;
      if (!sessao?.userId || !sessao.accessToken) throw new Error('Sessão expirada. Entre novamente.');
      if (usuario && usuario !== sessao.userId) { controle.fechar(); alvo.replaceChildren(); return null; }
      usuario = sessao.userId;
      let resposta, resultado, erroRede;
      try {
        resposta = await requisitar('/api/kit-documentos', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.accessToken}` }, body: JSON.stringify(body) });
        if (!verificar()) return null;
        resultado = await resposta.json();
      } catch { erroRede = new Error('Falha de conexão ou resposta inválida. Tente novamente.'); }
      if (!verificar()) return null;
      const atual = await obterSessao();
      if (!verificar()) return null;
      if (!atual || atual.userId !== sessao.userId) { controle.fechar(); alvo.replaceChildren(); return null; }
      if (erroRede) throw erroRede;
      if (!resposta.ok) { const erro = new Error(resultado.erro || `Serviço indisponível (${resposta.status}).`); erro.status = resposta.status; erro.motivo = resultado.motivo; erro.pendencias = resultado.pendencias || []; throw erro; }
      return resultado;
    }
    function validarDocumento(d, id) {
      if (!d || d.id !== id || d.empresaId !== escopo.empresaId || d.processoId !== escopo.processoId || !Number.isSafeInteger(d.versao) || d.versao < 1 || !['declaracao', 'proposta'].includes(d.tipo) || !d.dados?.[d.tipo]) throw new Error('Documento recebido inválido. Tente abrir novamente.');
      return d;
    }
    function falhar(e, acao) {
      controle.alterar(); ocupado = false; limparPrevia(mensagemFalha(e)); pendencias(e.pendencias || []);
      if (acao === 'salvar') {
        if (e.status && e.status !== 503) tentativa = null;
        estado = e.status === 409 ? 'Conflito · alterações locais preservadas' : 'Falha ao salvar · alterações locais preservadas';
      } else estado = e.status === 422 ? 'Rascunho incompleto' : e.status === 409 ? 'Revisão desatualizada · confira a versão do servidor' : 'Falha na operação';
      if (e.status === 409) el('[data-recarregar]').hidden = false;
      aviso(e.message); atualizar();
    }
    async function abrir(id) {
      const g = controle.alterar(); ocupado = true; limparPrevia(); atualizar(); aviso('Abrindo documento…');
      try {
        const r = await enviar({ ...escopo, acao: 'abrir', documentoId: id }, g); if (!r || !vivo(g)) return;
        peca = validarDocumento(r.documento, id); tentativa = null; alterado = false; estado = 'Salvo · pendente de revisão';
        controle.abrir({ documentoId: peca.id, versao: peca.versao }); ocupado = false; preencher(peca); limparPrevia(); pendencias(dados.pendencias || []);
        el('[data-peca]').textContent = peca.titulo || 'Documento salvo'; el('[data-recarregar]').hidden = true; atualizarLista(peca); atualizar(); aviso(r.itensNaoVerificados ? 'Documento aberto; não foi possível conferir todos os itens selecionados. O rascunho foi preservado. Confira o cadastro e prepare novamente antes de revisar ou exportar.' : 'Documento aberto. Confira uma nova prévia integral antes de baixar.'); form.elements[peca.tipo === 'declaracao' ? 'titulo' : 'validade'].focus();
      } catch (e) { if (vivo(g)) falhar(e, 'abrir'); }
    }
    function baixar(r) {
      if (!r.arquivoBase64 || r.mime !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') throw new Error('Arquivo DOCX inválido. Prepare novamente.');
      const bytes = Uint8Array.from(global.atob(r.arquivoBase64), c => c.charCodeAt(0));
      const url = global.URL.createObjectURL(new global.Blob([bytes], { type: r.mime }));
      const a = doc.createElement('a'); a.href = url; a.download = String(r.nome || 'documento.docx').replace(/[^\p{L}\p{N}._ -]/gu, '_').replace(/^\.+/, '') || 'documento.docx';
      try { doc.body.append(a); a.click(); } finally { a.remove(); global.setTimeout(() => global.URL.revokeObjectURL(url), 1000); }
    }
    async function executar(acao) {
      if (ocupado || !dados || (acao === 'exportar' && !controle.podeExportar())) return;
      if (itensPendentes && (acao === 'exportar' || acao === 'confirmarRevisao')) return; // revisao antiga nao vale com itens mudados
      if (acao !== 'salvar' && (!peca.versao || alterado || tentativa)) return;
      if (acao === 'confirmarRevisao' && !controle.hash) return;
      const g = controle.geracao, id = peca.id, versao = peca.versao;
      let body = { ...escopo, acao, documentoId: id, versaoEsperada: versao };
      if (acao === 'salvar') { tentativa ||= { ...body, tipo: peca.tipo, ...lerCampos() }; body = tentativa; }
      if (acao === 'confirmarRevisao' || acao === 'exportar') Object.assign(body, { revisado: true, revisaoHash: controle.hash });
      ocupado = true; estado = { salvar: 'Salvando…', preparar: 'Preparando prévia…', confirmarRevisao: 'Confirmando revisão…', exportar: 'Exportando DOCX…' }[acao]; atualizar(); aviso(estado);
      try {
        const r = await enviar(body, g); if (!r || !vivo(g)) return;
        if (itensPendentes && acao !== 'salvar') return; // resultado anterior a edicao do item nao libera revisao nem download
        if (acao === 'salvar') {
          const d = validarDocumento(r.documento, id); if (d.tipo !== peca.tipo || d.versao < versao) throw new Error('Versão recebida inválida. Reabra o documento.');
          alterado = !camposIguais(d); peca = d; tentativa = null;
          controle.abrir({ documentoId: id, versao: d.versao }); ocupado = false; estado = alterado ? 'Alterações posteriores ainda não salvas' : 'Salvo · pendente de revisão';
          el('[data-peca]').textContent = d.titulo || 'Documento salvo'; el('[data-recarregar]').hidden = true; limparPrevia('Rascunho salvo. Prepare a prévia integral para revisar.'); atualizarLista(d); atualizar(); aviso(alterado ? 'Tentativa anterior salva. Salve também as alterações posteriores do formulário.' : 'Rascunho salvo. Prepare a prévia para verificar se há pendências.');
          (alterado ? el('[data-salvar]') : el('[data-preparar]').disabled ? el('[data-peca]') : el('[data-preparar]')).focus();
        } else if (acao === 'preparar') {
          if (typeof r.previa?.texto !== 'string' || !Array.isArray(r.previa.fontes) || !r.revisaoHash) throw new Error('Prévia indisponível. Tente novamente.');
          controle.preparada(r.revisaoHash, g); el('[data-revisado]').checked = false; el('[data-previa]').textContent = r.previa.texto;
          el('[data-fontes]').textContent = `Referências: ${r.previa.fontes.join(' · ') || 'nenhuma informada'}`;
          el('[data-titulo-previa]').focus(); estado = 'Prévia pronta · pendente de revisão'; pendencias([]); aviso('Confira o conteúdo integral e as referências. A confirmação será registrada no servidor.');
        } else if (acao === 'confirmarRevisao') {
          const d = validarDocumento(r.documento, id); if (!controle.confirmada(d, g)) throw new Error('A confirmação não corresponde à peça e versão atuais. Prepare novamente.');
          peca = d; atualizarLista(d); estado = 'Revisão confirmada nesta abertura'; aviso('Revisão registrada. DOCX disponível para esta peça.');
        } else { baixar(r); estado = 'Revisão confirmada nesta abertura'; aviso('DOCX baixado. Alterações posteriores exigem nova geração.'); }
      } catch (e) { if (vivo(g)) falhar(e, acao); }
      finally { if (vivo(g)) { ocupado = false; atualizar(); if (acao === 'confirmarRevisao' && controle.podeExportar()) el('[data-exportar]').focus(); } }
    }
    async function prepararCadastro() {
      if (ocupado || !dados || peca.tipo !== 'proposta' || !controle.podeExportar() || alterado) return;
      const g = controle.geracao, resultado = el('[data-operacao]');
      const cabecalho = `${dados.empresa.razaoSocial} · CNPJ ${cnpjTexto(dados.empresa.cnpj)} · Processo ${dados.processo.numero} · versão ${peca.versao}`;
      ocupado = true; resultado.hidden = false; resultado.textContent = cabecalho + '\nConferindo vínculo e itens do portal…'; atualizar();
      try {
        const r = await enviar({ ...escopo, acao: 'prepararOperacao', documentoId: peca.id, versaoEsperada: peca.versao }, g);
        if (!r || !vivo(g)) return;
        if (r.valido !== true || r.writeAuthorized !== false || r.documentoId !== peca.id || r.versao !== peca.versao || !Array.isArray(r.lote?.itens)) throw new Error('Preparação operacional inválida.');
        resultado.textContent = cabecalho + '\nPregão no portal: ' + r.contexto.purchaseId + '\n' + r.lote.itens.map(i => `Item ${i.id} · quantidade ${i.quantidade} · unitário ${i.unitario} · marca ${i.marca || 'não exigida'} · modelo ${i.modelo || 'não exigido'}`).join('\n') + '\nSomente conferência. Nenhuma proposta ou lance enviado.';
      } catch (e) {
        if (!vivo(g)) return;
        if (e.motivo === 'vinculo_portal_indisponivel') resultado.textContent = cabecalho + '\nCadastro indisponível: vínculo com o Compras.gov ainda não verificado. Origem PNCP não confirma esse vínculo. Nenhuma proposta ou lance enviado.';
        else { falhar(e, 'prepararOperacao'); resultado.hidden = false; resultado.textContent = cabecalho + '\n' + e.message + '\nPrepare e revise novamente. Nenhum cadastro enviado.'; }
      } finally { if (vivo(g)) { ocupado = false; atualizar(); } }
    }
    async function iniciarLeitura(){
      if(!canalDisponivel()||ocupado||alterado||!controle.podeExportar()||peca.tipo!=='proposta'||leituraAtiva)return;
      const g=controle.geracao,output=el('[data-canal-status]');ocupado=true;atualizar();
      try{
        const r=await enviar({...escopo,acao:'iniciarLeitura',documentoId:peca.id,versaoEsperada:peca.versao},g);
        if(!r||!vivo(g))return;
        if(r.writeAuthorized!==false||r.documentoId!==peca.id||r.versao!==peca.versao||!r.tentativaId||!r.nonce||!r.contexto)throw Error('Tentativa inválida.');
        leituraAtiva={id:r.tentativaId,usuario,port:null,timer:null};
        const port=canalLeitura.runtime.connect(canalLeitura.extensionId,{name:'licitaplena-leitura-v1'});leituraAtiva.port=port;
        leituraAtiva.timer=setTimeout(()=>{if(leituraAtiva?.id!==r.tentativaId)return;void cancelarLeitura(r.tentativaId);if(vivo(g))output.textContent='Leitura expirada. Inicie novamente.';},Math.max(0,Math.min(300000,Date.parse(r.expiraEm)-Date.now())));
        port.onDisconnect.addListener(()=>{if(leituraAtiva?.id===r.tentativaId){void cancelarLeitura(r.tentativaId);if(vivo(g))output.textContent='Conexão encerrada. Inicie outra leitura.';}});
        port.onMessage.addListener(async m=>{
          if(leituraAtiva?.id!==r.tentativaId)return;
          if(!vivo(g)||m?.tipo!=='resultadoLeitura'||m.tentativaId!==r.tentativaId||m.geracao!==g||m.nonce!==r.nonce||JSON.stringify(m).length>30000){void cancelarLeitura(r.tentativaId);return;}
          try{const receipt=await enviar({...escopo,acao:'registrarLeitura',documentoId:peca.id,versaoEsperada:peca.versao,tentativaId:r.tentativaId,nonce:r.nonce,snapshot:m.snapshot},g);
            if(receipt&&vivo(g)&&leituraAtiva?.id===r.tentativaId){output.textContent=`Relato parcial registrado: ${receipt.recibo}. Não autoriza cadastro ou lance.`;const a=leituraAtiva;leituraAtiva=null;clearTimeout(a?.timer);port.disconnect();atualizar();}
          }catch(e){if(vivo(g)&&leituraAtiva?.id===r.tentativaId)output.textContent=e.message;void cancelarLeitura(r.tentativaId);}
        });
        port.postMessage({tipo:'iniciarLeitura',tentativaId:r.tentativaId,nonce:r.nonce,contexto:r.contexto,documentoId:r.documentoId,versao:r.versao,revisaoHash:r.revisaoHash,expiraEm:r.expiraEm,geracao:g});
        output.textContent='Abra a extensão na aba do Compras.gov.br, escolha a tentativa e confira a página. Nenhum envio de proposta.';
      }catch(e){if(vivo(g))output.textContent=e.message;void cancelarLeitura();}
      finally{if(vivo(g)){ocupado=false;atualizar();}}
    }
    function limparRelatos(){
      ++geracaoRelatos;relatos=[];reciboSelecionado=null;cursorRelatos=null;
      el('[data-recibo]').innerHTML='<option value="">Selecione um recibo</option>';el('[data-pares]').textContent='';el('[data-pares-status]').textContent='';el('[data-pares-revisados]').checked=false;
    }
    function renderPares(){
      el('[data-pares-revisados]').checked=false;
      const ids=selecao.campos().itemIds;
      el('[data-pares]').innerHTML=!reciboSelecionado?'':reciboSelecionado.itens.map(item=>{
        const saved=reciboSelecionado.correspondencia?.pares.find(p=>p.portalId===item.id)?.itemId;
        return `<label>Item observado ${esc(item.id)} · ${esc(item.descricao)}; quantidade ${esc(item.quantidadeSolicitada)} ${esc(item.unidade)}<select data-par-portal="${esc(item.id)}"><option value="">Sem correspondencia</option>${ids.map(id=>`<option value="${esc(id)}" ${saved===id?'selected':''}>${esc(conhecidos.get(id)?.descricao||id)} · ${esc(id)}</option>`).join('')}</select></label>`;
      }).join('');
      el('[data-pares-status]').textContent=reciboSelecionado?(reciboSelecionado.correspondencia?`Correspondencias salvas, versao ${reciboSelecionado.correspondencia.versao}. Confira antes de alterar.`:'Nenhuma correspondencia revisada neste recibo.'):'Selecione um recibo. Nenhum mapa foi agregado.';atualizar();
    }
    async function carregarRelatos(cursor){
      if(ocupado||alterado||!controle.podeExportar()||peca.tipo!=='proposta')return;
      const g=controle.geracao,rg=++geracaoRelatos;ocupado=true;reciboSelecionado=null;el('[data-pares]').textContent='';el('[data-pares-revisados]').checked=false;atualizar();
      try{
        const r=await enviar({...escopo,acao:'consultarLeituras',documentoId:peca.id,versaoEsperada:peca.versao,...(cursor?{cursor}:{})},g);
        if(!r||!vivo(g)||rg!==geracaoRelatos)return;
        if(!Array.isArray(r.recibos)||r.recibos.length>20)throw Error('Lista de relatos invalida.');
        relatos=r.recibos;cursorRelatos=r.nextCursor||null;
        el('[data-recibo]').innerHTML='<option value="">Selecione um recibo</option>'+relatos.map(r=>`<option value="${esc(r.id)}">${esc(r.criadoEm)} · ${esc(r.id)}</option>`).join('');
        el('[data-pares-status]').textContent=relatos.length?'Escolha um recibo. Cada pagina observada e parcial; nao existe catalogo consolidado.':'Nenhum relato vigente nesta revisao.';
      }catch(e){if(vivo(g)&&rg===geracaoRelatos){relatos=[];cursorRelatos=null;el('[data-recibo]').innerHTML='<option value="">Selecione um recibo</option>';el('[data-pares-status]').textContent=e.message;}}
      finally{if(vivo(g)){ocupado=false;atualizar();}}
    }
    async function salvarPares(){
      if(ocupado||alterado||!controle.podeExportar()||!reciboSelecionado||!el('[data-pares-revisados]').checked)return;
      const g=controle.geracao,rg=geracaoRelatos,recibo=reciboSelecionado.id,versaoCorrespondencia=reciboSelecionado.correspondencia?.versao||0;
      const pares=[...el('[data-pares]').querySelectorAll('[data-par-portal]')].filter(n=>n.value).map(n=>({itemId:n.value,portalId:n.dataset.parPortal}));
      if(!pares.length){el('[data-pares-status]').textContent='Selecione ao menos uma correspondencia explicita.';return;}
      ocupado=true;atualizar();
      try{
        const r=await enviar({...escopo,acao:'confirmarCorrespondencias',documentoId:peca.id,versaoEsperada:peca.versao,recibo,versaoCorrespondencia,revisado:true,pares},g);
        if(!r||!vivo(g)||rg!==geracaoRelatos||reciboSelecionado?.id!==recibo)return;
        reciboSelecionado.correspondencia={versao:r.versaoCorrespondencia,pares};renderPares();el('[data-pares-status]').textContent='Correspondencias revisadas salvas para este recibo. Lote indisponivel; nenhum envio autorizado.';
      }catch(e){if(vivo(g)&&rg===geracaoRelatos&&reciboSelecionado?.id===recibo){limparRelatos();el('[data-pares-status]').textContent=e.message+' Carregue os relatos novamente.';}}
      finally{if(vivo(g)){ocupado=false;atualizar();}}
    }
    async function listar() {
      const g = ++geracaoLista, vigente = () => g === geracaoLista && vivo(controle.geracao);
      listaEstado = 'carregando'; renderLista(); atualizar();
      try { const r = await enviar({ ...escopo, acao: 'listar' }, null, vigente); if (!r || !vigente()) return; if (!Array.isArray(r.documentos)) throw new Error('Lista inválida.'); documentos = r.documentos; listaEstado = 'pronta'; renderLista(); }
      catch (e) { if (vigente()) { listaEstado = 'erro'; listaErro = e.message; renderLista(); } }
      finally { if (vigente()) atualizar(); }
    }
    form.addEventListener('input', e => { capturarItem(e); if (e.target !== form.elements.tipo) invalidar(); });
    form.addEventListener('change', e => { capturarItem(e); if (e.target === form.elements.tipo) { const tipo = e.target.value; e.target.value = peca.tipo; pedirTroca(() => nova(tipo)); } else invalidar(); });
    form.addEventListener('submit', e => { e.preventDefault(); void executar('preparar'); });
    el('[data-itens-anterior]').addEventListener('click', () => void mudarPagina(-1));
    el('[data-itens-proxima]').addEventListener('click', () => void mudarPagina(1));
    el('[data-ver-selecionados]').addEventListener('click', () => { if (!ocupado) { selecionados = !selecionados; paginaSelecao = 0; renderItens(); } });
    el('[data-salvar]').addEventListener('click', () => void executar('salvar'));
    el('[data-revisado]').addEventListener('change', e => { if (e.target.checked) void executar('confirmarRevisao'); else { controle.alterar(); limparPrevia('Confirmação cancelada. Prepare uma nova prévia.'); estado = 'Salvo · pendente de revisão'; atualizar(); } });
    el('[data-exportar]').addEventListener('click', () => void executar('exportar'));
    el('[data-preparar-operacao]').addEventListener('click', () => void prepararCadastro());
    el('[data-carregar-relatos]').addEventListener('click',()=>void carregarRelatos());
    el('[data-mais-relatos]').addEventListener('click',()=>void carregarRelatos(cursorRelatos));
    el('[data-recibo]').addEventListener('change',()=>{++geracaoRelatos;reciboSelecionado=relatos.find(r=>r.id===el('[data-recibo]').value)||null;renderPares();});
    el('[data-pares]').addEventListener('change',()=>{el('[data-pares-revisados]').checked=false;atualizar();});
    el('[data-pares-revisados]').addEventListener('change',atualizar);
    el('[data-salvar-pares]').addEventListener('click',()=>void salvarPares());
    el('[data-iniciar-leitura]').addEventListener('click',()=>void iniciarLeitura());
    el('[data-cancelar-leitura]').addEventListener('click',()=>{void cancelarLeitura();el('[data-canal-status]').textContent='Leitura cancelada.';});
    el('[data-cancelar-previa]').addEventListener('click', () => { controle.alterar(); ocupado = false; limparPrevia('Revisão cancelada. Prepare uma nova prévia quando desejar.'); estado = alterado ? 'Alterações não salvas' : 'Salvo · pendente de revisão'; aviso('Revisão cancelada nesta abertura.'); atualizar(); el('[data-preparar]').focus(); });
    for (const b of alvo.querySelectorAll('[data-novo]')) b.addEventListener('click', () => pedirTroca(() => nova(b.dataset.novo)));
    el('[data-lista]').addEventListener('click', e => { const b = e.target.closest('[data-abrir]'); if (b) pedirTroca(() => void abrir(b.dataset.abrir)); });
    el('[data-recarregar]').addEventListener('click', () => pedirTroca(() => void abrir(peca.id)));
    el('[data-listar]').addEventListener('click', () => {
      if (ocupado) return;
      controle.alterar();
      limparPrevia('Dados atualizados. Prepare uma nova prévia antes de baixar.');
      void consultar();
    });
    function invalidarParaCadastro(e) {
      if (!vivo(controle.geracao) || ocupado) { e.preventDefault(); return; }
      cadastroAberto = true; controle.alterar(); limparPrevia(textosCadastro(aoConferirIdentificacao).aberto);
      estado = alterado ? (peca.versao ? 'Alterações não salvas' : 'Novo · não salvo') : 'Salvo · pendente de revisão';
      aviso('Seu rascunho continua aqui. Ao voltar, use Atualizar lista para consultar a identificação e preparar uma nova prévia.'); atualizar();
    }
    el('[data-cadastro]').addEventListener('click', invalidarParaCadastro);
    el('[data-cadastro]').addEventListener('auxclick', e => { if (e.button === 1) invalidarParaCadastro(e); });
    el('[data-cadastro]').addEventListener('contextmenu', invalidarParaCadastro);
    el('[data-cancelar-troca]').addEventListener('click', () => { trocaPendente = null; el('[data-descarte]').hidden = true; form.elements[peca.tipo === 'declaracao' ? 'titulo' : 'validade'].focus(); });
    el('[data-descartar]').addEventListener('click', () => { const continuar = trocaPendente; trocaPendente = null; el('[data-descarte]').hidden = true; continuar?.(); });
    async function consultar() {
      const g = controle.geracao; ocupado = true; atualizar(); aviso('Consultando identificação e itens…');
      const rascunho = dados ? { tipo: form.elements.tipo.value, dados: lerCampos() } : null;
      try {
        const r = await enviar({ ...escopo, acao: 'consultar', itensPaginados: true }, g); if (!r || !vivo(g)) return;
        dados = r;
        el('[data-contexto]').textContent = `${r.empresa.razaoSocial} · CNPJ ${cnpjTexto(r.empresa.cnpj)} · Processo ${r.processo.numero} · ${r.processo.orgao}`;
        el('[data-requisitos]').innerHTML = `<strong>Requisitos registrados — confira com o edital</strong><ul>${(r.requisitos || []).map(v => `<li>${esc(v)}</li>`).join('') || '<li>Nenhum requisito registrado; confira o edital.</li>'}</ul>`;
        pendencias(r.pendencias || []);
        cursores = [undefined, r.paginacaoItens?.nextCursor]; pagina = 0; maisItens = r.paginacaoItens?.hasMore === true; for (const item of r.itens || []) conhecidos.set(item.id, item); renderItens();
        if (rascunho) preencher(rascunho);
        cadastroAberto = false; ocupado = false; atualizar(); aviso('Dados carregados. Crie ou abra uma peça.'); await listar();
      } catch (e) { if (vivo(g)) { listaEstado = 'erro'; listaErro = e.message; renderLista(); aviso(e.message); ocupado = false; atualizar(); } }
    }
    // Leitura para a casca: mesma regra de pedirTroca (não salva nem envia nada).
    function temAlteracoesNaoSalvas() {
      if (!peca) return false;
      const preenchido = algoPreenchido();
      return Boolean(alterado && (peca.versao || tentativa || preenchido || (peca.tipo === 'proposta' && selecao.campos().itemIds.length > 0)));
    }
    // Atualizacao de itens (ex.: apos salvar item na casca). Invalida previa/revisao/exportacao antes de consultar.
    // Nao envia escrita. Se o kit estiver ocupado, adia: uma unica consulta quando a operacao atual terminar.
    function atualizarItens() {
      // Operacao em voo: so marca pendencia (a geracao nao avanca, para o finally reconciliar e liberar ocupado).
      itensPendentes = true;
      if (ocupado) aviso('Itens atualizados. A revis\u00e3o anterior fica bloqueada at\u00e9 a opera\u00e7\u00e3o atual terminar.');
      atualizar(); // se livre, drena agora (invalida e consulta)
    }
    nova('declaracao', false); void consultar();
    return { fechar() { void cancelarLeitura();controle.fechar(); alvo.replaceChildren(); }, temAlteracoesNaoSalvas, atualizarItens };
  }
  global.LicitaKitDocumentos = { quantidadeTexto, aplicarPadraoProposta, textoParaTela, textoParaSalvar, criarControle, criarSelecao, montar, mensagemFalha, alvoCadastro, textosCadastro };
})(globalThis);

