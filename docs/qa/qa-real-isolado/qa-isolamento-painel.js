/* Painel QA TEMPORÁRIO: teste real de isolamento A/B contra o servidor da sessão atual.
 * Ativação EXCLUSIVA: location.hostname === '127.0.0.1', pathname '/app' e hash '#qa-isolamento'.
 * Somente leituras: consultar, listarItens, listar (kit) e consultar (identificação). Nenhuma escrita ou exportação.
 * Não coleta senhas. O accessToken de /qa/session é usado só em memória, no cabeçalho Authorization, e nunca é
 * exibido, registrado ou guardado. Corpos de resposta não são lidos. Registra apenas: caso, statusHTTP e resultado.
 * Resultado: aprovado | falhou | inconclusivo (401, 5xx ou sem resposta = inconclusivo; 200 no oposto = falhou).
 * Usuário: deve haver exatamente UMA empresa entre A e B em /qa/session; caso contrário aborta sem inferir.
 */
(function () {
  'use strict';
  if (!(location.hostname === '127.0.0.1' && location.pathname === '/app' && location.hash === '#qa-isolamento')) return;

  var EMP = { A: 'a1000000-0000-4000-8000-000000000002', B: 'b1000000-0000-4000-8000-000000000002' };
  var PROC = { A: 'a1000000-0000-4000-8000-000000000003', B: 'b1000000-0000-4000-8000-000000000003' };
  var token = null;   // somente memória
  var executando = false;

  function Aborto(mensagem) { this.message = mensagem; }

  function escreverEstilo() {
    var s = document.createElement('style');
    s.id = 'qa-iso-estilo';
    s.textContent = '#qa-isolamento-painel{margin:16px;padding:16px;border:2px dashed #888;border-radius:8px;font:14px/1.5 system-ui,sans-serif;color:CanvasText;background:Canvas}' +
      '#qa-isolamento-painel button{min-height:44px;padding:8px 14px;font:inherit;border-radius:6px;cursor:pointer}' +
      '#qa-isolamento-painel button:focus-visible,#qa-isolamento-painel table:focus-visible{outline:3px solid Highlight;outline-offset:2px}' +
      '#qa-isolamento-painel table{width:100%;border-collapse:collapse;margin-top:12px}' +
      '#qa-isolamento-painel th,#qa-isolamento-painel td{text-align:left;padding:6px;border-bottom:1px solid #8884;overflow-wrap:anywhere}';
    document.head.appendChild(s);
  }

  function montarPainel() {
    escreverEstilo();
    var sec = document.createElement('section');
    sec.id = 'qa-isolamento-painel';
    sec.setAttribute('aria-labelledby', 'qa-iso-titulo');
    sec.innerHTML =
      '<h2 id="qa-iso-titulo" tabindex="-1">Painel QA: isolamento A/B (temporário)</h2>' +
      '<p>Somente leituras no servidor. Não envia escritas nem exportação. Os resultados não mostram conteúdo de respostas.</p>' +
      '<button type="button" id="qa-iso-executar">Executar consultas de isolamento</button>' +
      '<p id="qa-iso-estado" role="status" aria-live="polite"></p>' +
      '<table id="qa-iso-tabela" hidden><caption>Resultados por caso</caption>' +
      '<thead><tr><th scope="col">Caso</th><th scope="col">Status HTTP</th><th scope="col">Resultado</th></tr></thead>' +
      '<tbody id="qa-iso-linhas"></tbody></table>' +
      '<p id="qa-iso-resumo"></p>';
    document.body.appendChild(sec);
    document.getElementById('qa-iso-executar').addEventListener('click', executar);
  }

  function estado(texto) { document.getElementById('qa-iso-estado').textContent = texto; }

  // Descoberta da conta: exatamente uma das empresas A/B precisa estar em /qa/session; caso contrário aborta.
  async function descobrirConta() {
    var r = await fetch('/qa/session', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
    if (r.status === 401) throw new Aborto('Sessão ausente. Entre na aplicação e reabra o painel. Nada foi executado.');
    if (!r.ok) throw new Aborto('Sessão QA indisponível (HTTP ' + r.status + '). Nada foi executado.');
    var j = await r.json();
    var contextos = Array.isArray(j.contextos) ? j.contextos : [];
    var empresas = [];
    contextos.forEach(function (c) { if (empresas.indexOf(c.empresaId) < 0) empresas.push(c.empresaId); });
    var presentes = ['A', 'B'].filter(function (k) { return empresas.indexOf(EMP[k]) >= 0; });
    if (presentes.length === 0) throw new Aborto('A sessão não contém A nem B. Abortado sem executar.');
    if (presentes.length > 1) throw new Aborto('A sessão contém A e B: conta ambígua. Abortado sem executar.');
    var dono = presentes[0], outro = dono === 'A' ? 'B' : 'A';
    if (!contextos.some(function (c) { return c.empresaId === EMP[dono] && c.processoId === PROC[dono]; })) {
      throw new Aborto('A sessão não contém o processo do próprio par. Abortado sem executar.');
    }
    if (typeof j.accessToken !== 'string' || !j.accessToken) throw new Aborto('Sessão sem credencial de leitura. Abortado sem executar.');
    token = j.accessToken;
    return { dono: dono, outro: outro };
  }

  function montarCasos(dono, outro) {
    var casos = [];
    var pares = [
      { nome: 'par-proprio', empresa: dono, processo: dono, esperado: 200 },
      { nome: 'oposto-completo', empresa: outro, processo: outro, esperado: 'negado' },
      { nome: 'misto-empresa-propria-processo-oposto', empresa: dono, processo: outro, esperado: 'negado' },
      { nome: 'misto-empresa-oposta-processo-proprio', empresa: outro, processo: dono, esperado: 'negado' }
    ];
    pares.forEach(function (p) {
      ['consultar', 'listarItens', 'listar'].forEach(function (acao) {
        var corpo = { acao: acao, empresaId: EMP[p.empresa], processoId: PROC[p.processo] };
        // consultar exige itensPaginados:true (sem a flag o kit responde 409 e o controle positivo ficaria inconclusivo).
        if (acao === 'consultar') corpo.itensPaginados = true;
        casos.push({ nome: 'kit.' + acao + '.' + p.nome, rota: '/api/kit-documentos', corpo: corpo, esperado: p.esperado });
      });
    });
    casos.push({ nome: 'identificacao.consultar.propria', rota: '/api/empresa-identificacao', corpo: { acao: 'consultar', empresaId: EMP[dono] }, esperado: 200 });
    casos.push({ nome: 'identificacao.consultar.oposta', rota: '/api/empresa-identificacao', corpo: { acao: 'consultar', empresaId: EMP[outro] }, esperado: 'negado' });
    return casos;
  }

  // Só o status é lido; o corpo é descartado sem leitura.
  async function chamar(caso) {
    try {
      var r = await fetch(caso.rota, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify(caso.corpo)
      });
      try { if (r.body) await r.body.cancel(); } catch (e) { /* sem corpo legível */ }
      return r.status;
    } catch (e) { return null; }
  }

  function avaliar(caso, status) {
    if (status === null || status === 401 || status >= 500) return 'inconclusivo';
    if (caso.esperado === 200) return status === 200 ? 'aprovado' : 'falhou';
    if (status === 200) return 'falhou';                       // oposto respondeu com sucesso: vazamento
    return (status === 403 || status === 404) ? 'aprovado' : 'falhou';
  }

  function linha(caso, status, resultado) {
    var tr = document.createElement('tr');
    [caso.nome, status === null ? 'sem resposta' : String(status), resultado].forEach(function (t) {
      var td = document.createElement('td'); td.textContent = t; tr.appendChild(td);
    });
    document.getElementById('qa-iso-linhas').appendChild(tr);
  }

  async function executar() {
    if (executando) return;
    executando = true;
    var botao = document.getElementById('qa-iso-executar');
    botao.disabled = true;
    document.getElementById('qa-iso-linhas').replaceChildren();
    document.getElementById('qa-iso-tabela').hidden = true;
    document.getElementById('qa-iso-resumo').textContent = '';
    try {
      estado('Descobrindo a conta da sessão…');
      var conta = await descobrirConta();
      var casos = montarCasos(conta.dono, conta.outro);
      var cont = { aprovado: 0, falhou: 0, inconclusivo: 0 };
      document.getElementById('qa-iso-tabela').hidden = false;
      for (var i = 0; i < casos.length; i++) {
        estado('Executando caso ' + (i + 1) + ' de ' + casos.length + '…');
        var status = await chamar(casos[i]);
        var res = avaliar(casos[i], status);
        cont[res] += 1;
        linha(casos[i], status, res);
      }
      document.getElementById('qa-iso-resumo').textContent =
        'Resumo: ' + cont.aprovado + ' aprovados, ' + cont.falhou + ' falharam, ' + cont.inconclusivo + ' inconclusivos.';
      estado('Concluído para a conta ' + conta.dono + '.');
      var resumo = document.getElementById('qa-iso-resumo'); resumo.tabIndex = -1; resumo.focus();
    } catch (e) {
      estado(e instanceof Aborto ? e.message : 'Execução interrompida. Nada além do que aparece na tabela foi registrado.');
    } finally {
      token = null;   // descarta a credencial da memória ao final
      executando = false;
      botao.disabled = false;
    }
  }

  function iniciar() { montarPainel(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
