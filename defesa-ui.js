/* global module */
(function (raiz) {
  "use strict";
  function preencherIdentidadeLocal(texto, empresa = {}) {
    const razaoSocial = typeof empresa?.razaoSocial === "string" && empresa.razaoSocial.trim() ? empresa.razaoSocial.trim() : "[preencher razão social]";
    const cnpj = typeof empresa?.cnpj === "string" && /^\d{14}$/.test(empresa.cnpj.replace(/\D/g, "")) ? empresa.cnpj : "[preencher CNPJ]";
    return texto.replace("Destinatário e identificação da interessada: [preencher e conferir]", `Destinatário: [preencher e conferir]\nInteressada: ${razaoSocial}\nCNPJ: ${cnpj}`)
      .replaceAll("[RAZAO_SOCIAL]", razaoSocial).replaceAll("[CNPJ]", cnpj);
  }
  function renderizar(host, contexto) {
    const { estrutura = {}, edital = {}, usuarioId, empresaId, empresa, storage, exportar } = contexto;
    const identidade = JSON.stringify([usuarioId, empresaId, edital.numeroControlePNCP]);
    const hash = estrutura.hashFonte || "";
    const cobertura = estrutura.coberturaLeitura;
    const fonteBloqueada = Boolean(cobertura && ((cobertura.parcial !== undefined && cobertura.parcial !== false) ||
      (cobertura.documentosNaoLidos !== undefined && (!Array.isArray(cobertura.documentosNaoLidos) || cobertura.documentosNaoLidos.length)) ||
      (cobertura.ocrDocumentos !== undefined && (!Array.isArray(cobertura.ocrDocumentos) || cobertura.ocrDocumentos.some(o => o?.revisadoVisualmente !== true)))));
    const versaoPontos = JSON.stringify([estrutura.questionamentosDocumentais, estrutura.possiveisQuestionamentos, estrutura.questionamentosSugeridos, fonteBloqueada]);
    let rascunhoEmMemoria;
    if (host._defesa?.identidade === identidade) {
      if (hash === host._defesa.hash && versaoPontos === host._defesa.versaoPontos) return;
      rascunhoEmMemoria = host._defesa.rascunho();
    }
    host.replaceChildren();
    const doc = host.ownerDocument;
    const el = (tag, texto) => { const e = doc.createElement(tag); if (texto) e.textContent = texto; return e; };
    const secao = el("details"); secao.className = "secao-ia defesa-central"; secao.open = true;
    const sumario = el("summary", "Central de Defesa do Licitante"); sumario.className = "secao-ia-titulo"; secao.append(sumario);
    secao.append(el("p", "Analise um questionamento com o contexto do edital e fontes normativas. Revise fatos, limites e minuta antes de exportar. Nada é enviado automaticamente."));
    const avisos = el("p"); avisos.className = "defesa-status"; avisos.setAttribute("role", "status"); secao.append(avisos);
    if (fonteBloqueada) avisos.textContent = "A leitura está parcial ou contém OCR não revisado. Confira os documentos e conclua a revisão da fonte antes de analisar com IA.";
    const editor = el("div"); editor.id = "defesa-editor"; editor.className = "defesa-editor"; editor.hidden = true;
    const rotulo = el("label", "Minuta editável — confirme destinatário, empresa, pedido e prazo");
    const texto = el("textarea"); texto.id = "defesa-minuta-texto"; texto.maxLength = 50000; texto.rows = 20;
    texto.setAttribute("aria-describedby", "defesa-editor-ajuda");
    rotulo.htmlFor = texto.id;
    const confirmar = el("input"); confirmar.type = "checkbox"; confirmar.id = "defesa-minuta-revisada";
    const label = el("label", "Revisei fatos, provas, fundamentação, identificação da empresa, destinatário e prazo desta minuta."); label.htmlFor = confirmar.id;
    const salvar = el("button", "Salvar rascunho neste navegador"); salvar.type = "button";
    const baixar = el("button", "Exportar minuta .docx"); baixar.type = "button"; baixar.disabled = true;
    salvar.className = "defesa-botao"; baixar.className = "defesa-botao defesa-botao-destaque";
    const revisao = el("div"); revisao.className = "defesa-revisao"; revisao.append(confirmar, label);
    const ajuda = el("p", "Rascunho privado desta conta e empresa, salvo somente neste navegador. A exportação exige confirmar a revisão."); ajuda.id = "defesa-editor-ajuda";
    const acoesEditor = el("div"); acoesEditor.className = "defesa-acoes"; acoesEditor.append(salvar, baixar);
    editor.append(rotulo, texto, revisao, ajuda, acoesEditor);
    const origem = el("p", "Rascunho documental: estrutura para preenchimento; não é uma análise jurídica por IA."); editor.prepend ? editor.prepend(origem) : editor.append(origem);
    let tipo = "esclarecimento", hashMinuta = hash, desatualizado = false, alterado = false, origemMinuta = "documental";
    let chave;
    try { chave = raiz.DefesaLicitante.chaveRascunho(usuarioId, empresaId, edital.numeroControlePNCP); }
    catch (e) { avisos.textContent = e.message; }
    const atualizar = () => { baixar.disabled = desatualizado || !confirmar.checked || !texto.value.trim() || !chave; };
    const estado = { identidade, hash, versaoPontos, rascunho: () => ({ tipo, texto: texto.value, hashFonte: hashMinuta, origem: origemMinuta }), desatualizar() {
      desatualizado = true; confirmar.checked = false; confirmar.disabled = true; atualizar();
      avisos.textContent = "A fonte mudou. O texto foi preservado; prepare uma nova minuta com as evidências atuais antes de exportar.";
    } };
    host._defesa = estado;
    const formulario = el("div"); formulario.className = "defesa-ponto";
    formulario.append(el("h4", "Seu questionamento"), el("p", "Descreva o ponto do edital e o resultado pretendido. Não inclua dados pessoais ou informações sigilosas da empresa."));
    const fase = el("select"); fase.id = "defesa-fase";
    const rotuloFase = el("label", "Etapa da análise"); rotuloFase.htmlFor = fase.id;
    for (const [valor, titulo] of [["questionamento", "Preparar questionamento inicial"], ["resposta_orgao", "Analisar resposta do órgão"], ["manifestacao", "Preparar nova manifestação"]]) {
      const opcao = el("option", titulo); opcao.value = valor; fase.append(opcao);
    }
    fase.value = "questionamento"; formulario.append(rotuloFase, fase);
    const pergunta = el("textarea"); pergunta.id = "defesa-questionamento"; pergunta.rows = 3; pergunta.maxLength = 3000;
    const rotuloPergunta = el("label", "O que precisa ser esclarecido ou questionado?"); rotuloPergunta.htmlFor = pergunta.id;
    const objetivo = el("textarea"); objetivo.id = "defesa-objetivo"; objetivo.rows = 2; objetivo.maxLength = 3000;
    const rotuloObjetivo = el("label", "Qual resultado você pretende obter?"); rotuloObjetivo.htmlFor = objetivo.id;
    formulario.append(rotuloPergunta, pergunta, rotuloObjetivo, objetivo);
    const textosResposta = el("div"); textosResposta.hidden = true;
    textosResposta.append(el("p", "A resposta do órgão e a manifestação anterior são informações fornecidas por você, sem verificação independente. Não substituem documentos oficiais nem normas. Confira prazo e canal diretamente no procedimento."));
    const respostaOrgao = el("textarea"); respostaOrgao.id = "defesa-resposta-orgao"; respostaOrgao.rows = 5; respostaOrgao.maxLength = 12000;
    const rotuloResposta = el("label", "Resposta do órgão — transcreva o texto recebido"); rotuloResposta.htmlFor = respostaOrgao.id;
    const manifestacaoAnterior = el("textarea"); manifestacaoAnterior.id = "defesa-manifestacao-anterior"; manifestacaoAnterior.rows = 3; manifestacaoAnterior.maxLength = 6000;
    const rotuloAnterior = el("label", "Sua manifestação anterior — opcional"); rotuloAnterior.htmlFor = manifestacaoAnterior.id;
    textosResposta.append(rotuloResposta, respostaOrgao, rotuloAnterior, manifestacaoAnterior); formulario.append(textosResposta);
    fase.onchange = () => { textosResposta.hidden = fase.value === "questionamento"; };
    const acoesIA = el("div"); acoesIA.className = "defesa-acoes";
    const resultadoIA = el("div"); resultadoIA.className = "defesa-analise";
    let analisando = false;
    const historicoUI = el("details"); historicoUI.className = "defesa-ponto";
    const historicoLista = el("div"); historicoUI.append(el("summary", "Histórico privado neste navegador"), el("p", "Até dez análises desta conta, empresa e edital. Registros antigos não validam documentos, normas ou prazos atuais."), historicoLista);
    const chaveHistorico = chave ? `${chave}:historico-v1` : "";
    let historico = [];
    try {
      const registros = chaveHistorico && JSON.parse(storage.getItem(chaveHistorico) || "[]");
      if (Array.isArray(registros)) historico = registros.filter((r) => r && ["questionamento", "resposta_orgao", "manifestacao"].includes(r.entrada?.fase) && ["questionamento", "objetivo", "respostaOrgao", "manifestacaoAnterior"].every((k) => typeof r.entrada[k] === "string") && typeof r.hashFonte === "string" && typeof r.versaoBase === "string").slice(-10);
    } catch { /* Histórico indisponível não impede análise nem edição. */ }
    const mostrarHistorico = () => {
      historicoLista.replaceChildren();
      if (!historico.length) historicoLista.append(el("p", "Nenhuma análise salva nesta conta e empresa."));
      for (const registro of [...historico].reverse()) {
        const item = el("article");
        item.append(el("p", `${registro.data || "Data não informada"} — ${registro.entrada.fase} — base ${registro.versaoBase}${registro.hashFonte !== hash ? " — fonte anterior: exige nova análise" : ""}`), el("p", registro.entrada.questionamento));
        const carregar = el("button", "Reutilizar contexto para nova análise"); carregar.type = "button"; carregar.className = "defesa-botao";
        carregar.onclick = () => {
          if (analisando) return;
          fase.value = registro.entrada.fase; fase.onchange(); pergunta.value = registro.entrada.questionamento.slice(0, 3000); objetivo.value = registro.entrada.objetivo.slice(0, 3000);
          respostaOrgao.value = registro.entrada.respostaOrgao.slice(0, 12000); manifestacaoAnterior.value = registro.entrada.manifestacaoAnterior.slice(0, 6000);
          avisos.textContent = "Contexto anterior recuperado. Confira os textos e solicite nova análise da fonte atual."; pergunta.focus();
        };
        item.append(carregar); historicoLista.append(item);
      }
    };
    mostrarHistorico();
    const botoesIA = [];
    for (const [acao, titulo] of [["esclarecimento", "Analisar esclarecimento com IA"], ["impugnacao", "Analisar impugnação com IA"]]) {
      const botao = el("button", titulo); botao.type = "button"; botao.className = "defesa-botao defesa-botao-destaque";
      botao.disabled = fonteBloqueada || !hash || !chave || typeof contexto.analisar !== "function";
      if (botao.disabled) botao.title = fonteBloqueada ? "A leitura está parcial ou contém OCR não revisado. Confira a fonte antes de analisar." : "A análise exige fonte identificada, conta e empresa selecionadas e serviço disponível.";
      botao.onclick = async () => {
        if (botao.disabled) return;
        if (!pergunta.value.trim() || !objetivo.value.trim()) { avisos.textContent = "Preencha o questionamento e o objetivo antes de analisar."; pergunta.focus(); return; }
        if (!["questionamento", "resposta_orgao", "manifestacao"].includes(fase.value) || pergunta.value.length > 3000 || objetivo.value.length > 3000 || respostaOrgao.value.length > 12000 || manifestacaoAnterior.value.length > 6000) { avisos.textContent = "Confira a etapa e os limites dos textos informados."; return; }
        if (fase.value !== "questionamento" && !respostaOrgao.value.trim()) { avisos.textContent = "Informe a resposta do órgão para analisar esta etapa."; respostaOrgao.focus(); return; }
        if (alterado && !doc.defaultView.confirm("Substituir o texto atual pela análise? Salve o rascunho antes se quiser conservá-lo.")) return;
        const textoAnterior = texto.value;
        analisando = true;
        [fase, pergunta, objetivo, respostaOrgao, manifestacaoAnterior].forEach((campo) => { campo.disabled = true; });
        botoesIA.forEach((b) => { b.disabled = true; }); formulario.setAttribute("aria-busy", "true");
        avisos.textContent = "Analisando o questionamento com o contexto documental e a base normativa...";
        try {
          const entrada = { tipo: acao, questionamento: pergunta.value.trim(), objetivo: objetivo.value.trim(), fase: fase.value, respostaOrgao: fase.value === "questionamento" ? "" : respostaOrgao.value.trim(), manifestacaoAnterior: fase.value === "questionamento" ? "" : manifestacaoAnterior.value.trim() };
          const resposta = await contexto.analisar(entrada);
          if (host._defesa !== estado) return;
          const analise = resposta?.analise;
          if (resposta?.hashFonte !== hash || typeof resposta?.versaoBase !== "string" || !resposta.versaoBase || !resposta.cobertura || typeof resposta.cobertura.parcial !== "boolean" ||
              !analise || !["diagnostico", "argumentoContrario", "pedido", "minutaTexto"].every((k) => typeof analise[k] === "string" && analise[k].trim()) ||
              !["fatos", "fundamentos", "pendencias"].every((k) => Array.isArray(analise[k])) || analise.minutaTexto.length > 50000 ||
              !analise.fatos.every((f) => typeof f?.texto === "string" && raiz.DefesaLicitante.temEvidencias(f)) ||
              !analise.fundamentos.every((f) => ["id", "norma", "dispositivo", "url", "aplicabilidade"].every((k) => typeof f?.[k] === "string")) ||
              !analise.pendencias.every((p) => typeof p === "string")) throw new Error("A análise não trouxe contexto e referências válidos. Seu rascunho foi preservado.");
          if (texto.value !== textoAnterior) throw new Error("Você editou o rascunho durante a análise. O texto foi preservado; solicite nova análise quando terminar.");
          resultadoIA.replaceChildren();
          const limitesCobertura = [
            ...(cobertura?.parcial ? ["Leitura documental parcial: confira os documentos ainda não lidos."] : []),
            ...(resposta.cobertura.contextoParcial ? ["Contexto parcial selecionado para análise por relevância e orçamento; confira também as cláusulas e páginas omitidas."] : []),
            ...(resposta.cobertura.declaracoesParciais ? ["Declarações informadas foram incluídas apenas parcialmente; confira os trechos e as pendências."] : []),
            ...(resposta.cobertura.parcial && !cobertura?.parcial && !resposta.cobertura.contextoParcial && !resposta.cobertura.declaracoesParciais ? ["Cobertura da análise parcial: confira os limites indicados nas pendências."] : []),
            "Confira os documentos e as referências antes de utilizar a minuta.",
          ].join(" ");
          resultadoIA.append(el("h4", "Análise do questionamento"), el("p", analise.diagnostico), el("p", `Base normativa: ${resposta.versaoBase}. ${limitesCobertura}`), el("h4", "Fatos e provas"));
          const modelo = analise.modeloReferencia;
          if (modelo?.referenciaPrivada === true && typeof modelo.titulo === "string" && typeof modelo.criterio === "string") {
            resultadoIA.append(el("h4", "Modelo de referência privado"), el("p", modelo.titulo), el("p", modelo.criterio));
            for (const pendencia of Array.isArray(modelo.camposPendentes) ? modelo.camposPendentes : []) if (typeof pendencia === "string") resultadoIA.append(el("p", pendencia));
          }
          for (const fato of analise.fatos) {
            resultadoIA.append(el("p", fato.texto));
            for (const e of fato.evidencias) resultadoIA.append(el("blockquote", `${/^(?:R\b|M\b)|resposta.*órgão|manifestação anterior/i.test(e.documento) ? "Texto fornecido pelo usuário, sem verificação independente — " : ""}${e.documento}${e.pagina ? `, página ${e.pagina}` : ""}${e.numero ? `, cláusula ${e.numero}` : ""}: ${e.texto}`));
          }
          resultadoIA.append(el("h4", "Fundamentos e aplicabilidade"));
          for (const fundamento of analise.fundamentos) {
            const linha = el("p", `${fundamento.norma}, ${fundamento.dispositivo}: ${fundamento.aplicabilidade} `);
            try {
              const url = new raiz.URL(fundamento.url);
              if (url.protocol === "https:" && !url.username && !url.password && ["planalto.gov.br", "tcu.gov.br", "gov.br"].some((dominio) => url.hostname === dominio || url.hostname.endsWith(`.${dominio}`))) {
                const link = el("a", "Consultar fonte oficial"); link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer"; linha.append(link);
              }
            } catch { /* Referência sem URL segura permanece somente como texto. */ }
            resultadoIA.append(linha);
          }
          resultadoIA.append(el("h4", "Argumento contrário e limites"), el("p", analise.argumentoContrario), el("h4", "Pedido proposto"), el("p", analise.pedido), el("h4", "Pendências para revisão"));
          for (const pendencia of analise.pendencias) resultadoIA.append(el("p", pendencia));
          if (!analise.pendencias.length) resultadoIA.append(el("p", "Nenhuma pendência indicada pela análise. Isso não dispensa revisão humana."));
          tipo = acao; hashMinuta = hash; origemMinuta = "ia"; desatualizado = false; alterado = true;
          origem.textContent = "Minuta assistida por IA, vinculada aos fatos e fundamentos exibidos. Exige revisão humana antes de utilizar.";
          confirmar.disabled = false; confirmar.checked = false; texto.value = preencherIdentidadeLocal(analise.minutaTexto, resposta.empresaLocal); editor.hidden = false; atualizar();
          if (resposta.empresaLocal) origem.textContent += " A identificação foi preenchida neste navegador com a empresa selecionada. Confira razão social e CNPJ; esses dados não foram enviados à IA.";
          avisos.textContent = "Análise recebida. Confira provas, aplicabilidade, prazo, canal e minuta antes de exportar."; texto.focus();
          try {
            historico = [...historico, { data: new Date().toISOString(), entrada, analise, hashFonte: resposta.hashFonte, versaoBase: resposta.versaoBase, cobertura: resposta.cobertura }].slice(-10);
            storage.setItem(chaveHistorico, JSON.stringify(historico)); mostrarHistorico();
          } catch { avisos.textContent += " O histórico não pôde ser salvo; copie os dados antes de fechar."; }
        } catch (erro) { if (host._defesa === estado) avisos.textContent = erro.message || "Não foi possível analisar agora. Tente novamente depois. Seu texto foi preservado."; }
        finally { if (host._defesa === estado) { analisando = false; [fase, pergunta, objetivo, respostaOrgao, manifestacaoAnterior].forEach((campo) => { campo.disabled = false; }); botoesIA.forEach((b) => { b.disabled = false; }); formulario.setAttribute("aria-busy", "false"); } }
      };
      botoesIA.push(botao); acoesIA.append(botao);
    }
    formulario.append(acoesIA); secao.append(formulario, resultadoIA, historicoUI);
    const lista = (v) => Array.isArray(v) ? v.filter((p) => p && ["string", "object"].includes(typeof p)) : [];
    const pontos = [...lista(estrutura.questionamentosDocumentais), ...[...lista(estrutura.possiveisQuestionamentos), ...lista(estrutura.questionamentosSugeridos)].map((p) => ({ titulo: typeof p === "string" ? p : p.texto || p.titulo, evidencias: [] }))];
    if (pontos.length) secao.append(el("p", "Pontos documentais identificados. Os botões abaixo preenchem uma estrutura documental sem IA; use a análise acima para avaliar fundamentação e aplicabilidade."));
    if (!pontos.length) secao.append(el("p", "Nenhum ponto com evidência estruturada foi identificado nesta análise. Isso não confirma ausência de problemas."));
    for (const ponto of pontos) {
      const card = el("article"); card.className = "defesa-ponto"; card.append(el("h4", ponto.titulo || "Ponto a conferir"), el("p", ponto.descricao || "Sugestão ainda sem evidência documental confirmada."));
      const provas = el("details"); provas.append(el("summary", "Ver trechos dos documentos"));
      for (const e of Array.isArray(ponto.evidencias) ? ponto.evidencias : []) {
        if (raiz.DefesaLicitante.temEvidencias({ evidencias: [e] })) provas.append(el("p", `${e.documento}${e.pagina ? `, página ${e.pagina}` : ""}${e.numero ? `, cláusula ${e.numero}` : ""}: ${e.texto}`));
      }
      card.append(provas);
      const acoes = el("div"); acoes.className = "defesa-acoes";
      for (const [acao, titulo] of [["esclarecimento", "Preparar esclarecimento"], ["impugnacao", "Preparar impugnação"]]) {
        const botao = el("button", titulo); botao.type = "button";
        botao.className = `defesa-botao${acao === "impugnacao" ? " defesa-botao-destaque" : ""}`;
        botao.setAttribute("aria-controls", editor.id);
        botao.disabled = !chave || !hash || !raiz.DefesaLicitante.temEvidencias(ponto);
        if (botao.disabled) botao.title = "Selecione a empresa e aguarde uma fonte identificada com evidência documental para preparar a minuta.";
        botao.onclick = () => {
          if (alterado && !doc.defaultView.confirm("Substituir o texto atual por uma nova minuta? Salve o rascunho antes se quiser conservá-lo.")) return;
          tipo = acao; hashMinuta = contexto.estrutura.hashFonte; desatualizado = false; alterado = false; origemMinuta = "documental";
          origem.textContent = "Rascunho documental: estrutura para preenchimento; não é uma análise jurídica por IA.";
          confirmar.disabled = false; confirmar.checked = false;
          texto.value = raiz.DefesaLicitante.prepararMinuta(tipo, ponto, { ...edital, empresa });
          editor.hidden = false; avisos.textContent = "Minuta preparada. Revise e complete os campos entre colchetes antes de utilizar."; atualizar(); texto.focus();
        };
        acoes.append(botao);
      }
      card.append(acoes);
      secao.append(card);
    }
    texto.oninput = () => { alterado = true; confirmar.checked = false; atualizar(); };
    confirmar.onchange = atualizar;
    salvar.onclick = () => {
      try {
        if (!chave) throw new Error("Selecione uma conta e empresa.");
        storage.setItem(chave, JSON.stringify({ tipo, texto: texto.value, hashFonte: hashMinuta, origem: origemMinuta, salvoEm: new Date().toISOString() }));
        alterado = false; avisos.textContent = "Rascunho salvo neste navegador para esta conta e empresa.";
      } catch { avisos.textContent = "Não foi possível salvar. Copie o texto antes de fechar a página."; }
    };
    baixar.onclick = async () => {
      if (baixar.disabled) return;
      baixar.disabled = true;
      try { await exportar({ tipo, texto: texto.value, revisado: confirmar.checked }); avisos.textContent = "Minuta exportada. Nenhum documento foi enviado ou protocolado."; }
      catch (e) { avisos.textContent = e.message || "Não foi possível exportar. Seu texto foi preservado."; }
      finally { atualizar(); }
    };
    try {
      const salvo = rascunhoEmMemoria?.texto ? rascunhoEmMemoria : chave && JSON.parse(storage.getItem(chave) || "null");
      if (salvo && typeof salvo.texto === "string" && salvo.texto.length <= 50000 && ["esclarecimento", "impugnacao"].includes(salvo.tipo)) {
        texto.value = salvo.texto; tipo = salvo.tipo; hashMinuta = salvo.hashFonte; editor.hidden = false;
        origemMinuta = salvo.origem === "ia" ? "ia" : "documental";
        if (origemMinuta === "ia") origem.textContent = "Rascunho assistido por IA recuperado. Reconfira fatos, base normativa e limites antes de utilizar.";
        alterado = Boolean(rascunhoEmMemoria);
        if (hashMinuta !== hash) estado.desatualizar();
        else avisos.textContent = "Rascunho recuperado. Revise novamente antes de exportar.";
      }
    } catch { avisos.textContent = "O rascunho não pôde ser recuperado neste navegador."; }
    secao.append(editor); host.append(secao);
  }
  const api = { renderizar, preencherIdentidadeLocal };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.DefesaUI = api;
})(globalThis);
