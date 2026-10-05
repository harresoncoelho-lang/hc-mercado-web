/* global FormData, crypto, window */
(function (raiz) {
  const ROTULOS = {
    nao_apurado: "Não apurado", nao_participou: "Não participou", em_disputa: "Em disputa",
    sem_vitoria: "Participou sem vencer", vitoria_parcial: "Vitória parcial", vitoria_total: "Vitória total",
    revogado_anulado: "Revogado / anulado", pendente: "Pendente", ganho: "Ganho", perdido: "Perdido",
    desclassificado: "Desclassificado", inabilitado: "Inabilitado", nao_disputado: "Não disputado",
    cancelado: "Cancelado", a_assinar: "A assinar", vigente: "Vigente", encerrado: "Encerrado", rescindido: "Rescindido",
  };

  function criar(deps) {
    const { sb, estado, $, esc, dinheiro, data, dataHora, linkSeguro, aviso, abrir, fechar, carregarTudo, abrirDossie, editarProcesso } = deps;
    const doProcesso = (colecao, id) => colecao.filter(registro => registro.processo_id === id);
    const rotulo = valor => ROTULOS[valor] || valor || "—";
    const origem = valor => { const url = linkSeguro(valor); return url ? `<a href="${esc(url)}" target="_blank" rel="noopener">Fonte oficial</a>` : ""; };
    const valorOpcional = valor => valor == null ? "Não informado" : dinheiro(valor);
    const valorNumero = valor => valor === "" || valor == null ? null : Number(valor);
    const mensagemErro = erro => erro?.message || "Tente novamente.";
    const dataLocal = valor => { const instante = new Date(valor); return new Date(instante.getTime() - instante.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

    function renderizar(processo) {
      if (!estado.detalhesCarregados) {
        $("d-acompanhamento").innerHTML = estado.erroDetalhes
          ? '<p class="aviso-dados">O acompanhamento não pôde ser carregado. Confira o aviso no topo e tente atualizar. Nenhum resultado foi presumido.</p>'
          : '<p class="nota">Carregando resultados, prazos, contratos e anexos…</p>';
        return;
      }
      const itens = doProcesso(estado.itens, processo.id);
      const ocorrencias = doProcesso(estado.ocorrencias, processo.id);
      const contratos = doProcesso(estado.contratos, processo.id);
      const anexos = doProcesso(estado.anexos, processo.id);
      const prazos = doProcesso(estado.prazos, processo.id);
      const empenhos = doProcesso(estado.empenhos, processo.id);
      const apurado = raiz.LicitaAcompanhamento.resultadoEfetivo(processo, itens);
      const lista = (registros, montar, vazio) => registros.length ? registros.map(montar).join("") : `<p class="nota">${vazio}</p>`;
      $("d-acompanhamento").innerHTML = `
        <section class="bloco-dossie"><h3>Participação e resultado</h3>
          <div class="dossie-grid"><div class="dado"><span>Participação / resultado</span><b>${esc(rotulo(apurado.situacao))}</b></div><div class="dado"><span>Valor homologado à empresa</span><b>${valorOpcional(apurado.valor)}</b></div><div class="dado"><span>Apuração</span><b>${itens.length ? `${apurado.ganhos} de ${apurado.total} itens/lotes ganhos` : "Resultado informado manualmente"}</b></div></div>
          ${itens.length && !apurado.valorCompleto && apurado.ganhos ? '<p class="aviso-dados">Há item ganho sem valor homologado informado; o total permanece desconhecido.</p>' : ""}
          <p class="nota">Data: ${data(processo.data_resultado)} · ${origem(processo.fonte_resultado) || "Fonte oficial não vinculada"}${processo.motivo_perda ? ` · ${esc(processo.motivo_perda)}` : ""}</p>
          ${processo.resultado ? `<p class="nota">Registro anterior do processo: ${esc(processo.resultado)}</p>` : ""}
          <div class="acoes-bloco"><button class="btn" data-editar-processo="${processo.id}">Editar cadastro e sessão</button><button class="btn" data-resultado="${processo.id}">Registrar resultado</button><button class="btn" data-item="${processo.id}">+ Item/lote</button></div>
          ${lista(itens, item => `<div class="linha-registro"><span class="tag">${esc(item.tipo)} ${esc(item.identificador)}</span><strong>${esc(item.descricao || "Sem descrição")}</strong><small>${esc(rotulo(item.situacao))} · proposta: ${valorOpcional(item.valor_proposta)} · homologado à empresa: ${valorOpcional(item.valor_homologado)}${item.quantidade == null ? "" : ` · qtd.: ${esc(item.quantidade)}`}</small>${item.motivo ? `<small>${esc(item.motivo)}</small>` : ""}${origem(item.fonte_oficial)} <button class="btn" data-corrigir-item="${item.id}">Corrigir</button></div>`, "Nenhum item/lote registrado. O resultado geral pode ser informado manualmente.")}
        </section>
        <section class="bloco-dossie"><h3>Relatório cronológico</h3><div class="acoes-bloco"><button class="btn" data-ocorrencia="${processo.id}">+ Ocorrência</button></div>
          ${lista(ocorrencias, evento => `<div class="linha-registro"><strong>${dataHora(evento.ocorrido_em)} · ${esc(evento.categoria)}</strong><small>${esc(evento.descricao)}</small>${origem(evento.fonte_oficial)} <button class="btn" data-editar-ocorrencia="${evento.id}">Corrigir registro</button></div>`, "Nenhuma ocorrência registrada. Anote sessões, mensagens, diligências e decisões com suas datas.")}
        </section>
        <section class="bloco-dossie"><h3>Prazos e sessão</h3><div class="acoes-bloco"><button class="btn" data-add-prazo="${processo.id}">+ Prazo</button></div>
          <p class="nota">Sessão: ${dataHora(processo.data_sessao)}</p>
          ${lista(prazos, prazo => `<div class="linha-registro"><strong>${esc(prazo.titulo)}</strong><small>${dataHora(prazo.vencimento)} · ${esc(prazo.responsavel || "Sem responsável")} · ${prazo.concluido_em ? `concluído em ${dataHora(prazo.concluido_em)}` : "pendente"}</small><button class="btn" data-editar-prazo="${prazo.id}">Editar prazo</button> ${prazo.concluido_em ? "" : `<button class="btn" data-concluir-prazo="${prazo.id}">Concluir prazo</button>`}</div>`, "Nenhum prazo cadastrado.")}
        </section>
        <section class="bloco-dossie"><h3>Contratos e execução</h3><div class="acoes-bloco"><button class="btn" data-contrato="${processo.id}">+ Contrato</button><button class="btn" data-add-empenho="${processo.id}">+ Empenho</button></div>
          ${lista(contratos, contrato => `<div class="linha-registro"><strong>Contrato ${esc(contrato.numero)}</strong><small>${esc(rotulo(contrato.situacao))} · assinado: ${data(contrato.assinado_em)} · vigência: ${data(contrato.vigencia_inicio)} a ${data(contrato.vigencia_fim)} · valor: ${valorOpcional(contrato.valor)}</small>${contrato.observacoes ? `<small>${esc(contrato.observacoes)}</small>` : ""}<button class="btn" data-editar-contrato="${contrato.id}">Editar contrato</button></div>`, "Nenhum contrato cadastrado.")}
          ${lista(empenhos, empenho => `<div class="linha-registro"><strong>Empenho ${esc(empenho.numero)}</strong><small>${esc(rotulo(empenho.status))} · emitido: ${data(empenho.emitido_em)} · valor: ${dinheiro(empenho.valor)} · saldo: ${dinheiro(empenho.saldo ?? empenho.valor)}</small><button class="btn" data-editar-empenho="${empenho.id}">Editar empenho</button></div>`, "Nenhum empenho cadastrado.")}
        </section>
        <section class="bloco-dossie"><h3>Arquivos do processo</h3><div class="acoes-bloco"><button class="btn" data-anexo="${processo.id}">+ Anexar contrato, empenho ou documento</button></div>
          ${lista(anexos, anexo => `<div class="linha-registro"><strong>${esc(rotulo(anexo.tipo))}: ${esc(anexo.titulo)}</strong><small>${esc(anexo.referencia_numero || "Sem número")} · ${esc(anexo.arquivo_nome)} · ${dataHora(anexo.criado_em)}</small><button class="btn" data-abrir-anexo="${anexo.id}">Abrir arquivo</button></div>`, "Nenhum arquivo vinculado a este processo.")}
        </section>`;
    }

    function prepararFormulario(nome, id) {
      const formulario = $(`form-${nome}`);
      formulario.reset();
      formulario.elements.namedItem("processo_id").value = id;
      fechar("modal-dossie");
      abrir(`modal-${nome}`);
      return formulario;
    }

    async function atualizarEReabrir(id) { await carregarTudo(); abrirDossie(id); }

    async function salvarResultado(ev) {
      ev.preventDefault();
      const formulario = ev.currentTarget, f = new FormData(formulario), id = f.get("processo_id");
      const itens = doProcesso(estado.itens, id);
      const situacao = f.get("situacao_resultado");
      const valor = valorNumero(f.get("valor_homologado"));
      if (!itens.length && valor != null && !["vitoria_parcial", "vitoria_total"].includes(situacao)) {
        aviso("Informe valor homologado somente para vitória parcial ou total.", "erro"); return;
      }
      const dados = { data_resultado: f.get("data_resultado") || null, fonte_resultado: linkSeguro(f.get("fonte_resultado")) || null, motivo_perda: f.get("motivo_perda") || null, atualizado_em: new Date().toISOString() };
      if (!itens.length) Object.assign(dados, { situacao_resultado: situacao, valor_homologado: valor });
      const { error } = await sb.from("operacao_processos").update(dados).eq("id", id).eq("organizacao_id", estado.orgId);
      if (error) { aviso("Não foi possível salvar o resultado: " + error.message, "erro"); return; }
      formulario.reset(); fechar("modal-resultado"); await atualizarEReabrir(id);
    }

    async function salvarItem(ev) {
      ev.preventDefault();
      const formulario = ev.currentTarget, f = new FormData(formulario), id = f.get("processo_id");
      const valor = valorNumero(f.get("valor_homologado"));
      if (valor != null && f.get("situacao") !== "ganho") { aviso("O valor homologado à empresa só cabe em item ganho.", "erro"); return; }
      const dados = { tipo: f.get("tipo"), identificador: String(f.get("identificador")).trim(), descricao: f.get("descricao") || null, situacao: f.get("situacao"), quantidade: valorNumero(f.get("quantidade")), valor_proposta: valorNumero(f.get("valor_proposta")), valor_homologado: valor, motivo: f.get("motivo") || null, fonte_oficial: linkSeguro(f.get("fonte_oficial")) || null, atualizado_em: new Date().toISOString() };
      const consulta = f.get("id")
        ? sb.from("operacao_itens_resultado").update(dados).eq("id", f.get("id")).eq("organizacao_id", estado.orgId)
        : sb.from("operacao_itens_resultado").insert({ ...dados, organizacao_id: estado.orgId, processo_id: id });
      const { error } = await consulta;
      if (error) { aviso("Não foi possível salvar o item/lote: " + error.message, "erro"); return; }
      formulario.reset(); fechar("modal-item"); await atualizarEReabrir(id);
    }

    async function salvarOcorrencia(ev) {
      ev.preventDefault();
      const formulario = ev.currentTarget, f = new FormData(formulario), id = f.get("processo_id");
      const dados = { ocorrido_em: new Date(f.get("ocorrido_em")).toISOString(), categoria: f.get("categoria"), descricao: String(f.get("descricao")).trim(), fonte_oficial: linkSeguro(f.get("fonte_oficial")) || null };
      const consulta = f.get("id")
        ? sb.from("operacao_ocorrencias").update(dados).eq("id", f.get("id")).eq("organizacao_id", estado.orgId)
        : sb.from("operacao_ocorrencias").insert({ ...dados, organizacao_id: estado.orgId, processo_id: id });
      const { error } = await consulta;
      if (error) { aviso("Não foi possível salvar a ocorrência: " + error.message, "erro"); return; }
      formulario.reset(); fechar("modal-ocorrencia"); await atualizarEReabrir(id);
    }

    async function salvarContrato(ev) {
      ev.preventDefault();
      const formulario = ev.currentTarget, f = new FormData(formulario), id = f.get("processo_id");
      const dados = { numero: String(f.get("numero")).trim(), situacao: f.get("situacao"), assinado_em: f.get("assinado_em") || null, valor: valorNumero(f.get("valor")), vigencia_inicio: f.get("vigencia_inicio") || null, vigencia_fim: f.get("vigencia_fim") || null, observacoes: f.get("observacoes") || null };
      const consulta = f.get("id")
        ? sb.from("operacao_contratos").update(dados).eq("id", f.get("id")).eq("organizacao_id", estado.orgId)
        : sb.from("operacao_contratos").insert({ ...dados, organizacao_id: estado.orgId, processo_id: id });
      const { error } = await consulta;
      if (error) { aviso("Não foi possível salvar o contrato: " + error.message, "erro"); return; }
      formulario.reset(); fechar("modal-contrato"); await atualizarEReabrir(id);
    }

    async function salvarAnexo(ev) {
      ev.preventDefault();
      const formulario = ev.currentTarget, f = new FormData(formulario), id = f.get("processo_id"), arquivo = f.get("arquivo");
      if (!arquivo?.name || arquivo.size > 10 * 1024 * 1024 || !/\.(pdf|docx?|png|jpe?g)$/i.test(arquivo.name)) {
        aviso("Escolha um PDF, Word ou imagem de até 10 MB.", "erro"); return;
      }
      const botao = $("btn-salvar-anexo"); botao.disabled = true;
      const seguro = arquivo.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]/g, "-");
      const caminho = `${estado.orgId}/${estado.empresaId}/${id}/${crypto.randomUUID()}-${seguro}`;
      const storage = sb.storage.from("operacao-documentos");
      let enviado = false, registrado = false;
      try {
        const { error: uploadError } = await storage.upload(caminho, arquivo, { upsert: false });
        if (uploadError) throw uploadError;
        enviado = true;
        const { error } = await sb.from("operacao_anexos_processo").insert({ organizacao_id: estado.orgId, processo_id: id, tipo: f.get("tipo"), titulo: String(f.get("titulo")).trim(), referencia_numero: f.get("referencia_numero") || null, arquivo_caminho: caminho, arquivo_nome: arquivo.name });
        if (error) throw error;
        registrado = true;
      } catch (erro) {
        let remocaoError = null;
        if (enviado && !registrado) {
          try { ({ error: remocaoError } = await storage.remove([caminho])); }
          catch (falhaRemocao) { remocaoError = falhaRemocao; }
        }
        aviso("Não foi possível anexar: " + mensagemErro(erro) + (remocaoError ? " O arquivo enviado precisa de revisão manual." : ""), "erro");
        botao.disabled = false; return;
      }
      formulario.reset(); fechar("modal-anexo"); aviso("Arquivo anexado com sucesso.", "info");
      try { await atualizarEReabrir(id); }
      catch (erro) { aviso("Arquivo anexado, mas a lista não atualizou: " + mensagemErro(erro), "erro"); }
      finally { botao.disabled = false; }
    }

    async function abrirAnexo(id) {
      const anexo = estado.anexos.find(item => item.id === id);
      if (!anexo) return;
      const { data: assinado, error } = await sb.storage.from("operacao-documentos").createSignedUrl(anexo.arquivo_caminho, 60);
      if (error) { aviso("Não foi possível abrir o anexo: " + error.message, "erro"); return; }
      window.open(assinado.signedUrl, "_blank", "noopener");
    }

    function vincular() {
      $("form-resultado").addEventListener("submit", salvarResultado);
      $("form-item").addEventListener("submit", salvarItem);
      $("form-ocorrencia").addEventListener("submit", salvarOcorrencia);
      $("form-contrato").addEventListener("submit", salvarContrato);
      $("form-anexo").addEventListener("submit", salvarAnexo);
      $("d-conteudo").addEventListener("click", async ev => {
        const botao = ev.target.closest("[data-editar-processo],[data-resultado],[data-item],[data-corrigir-item],[data-ocorrencia],[data-editar-ocorrencia],[data-editar-prazo],[data-contrato],[data-editar-contrato],[data-editar-empenho],[data-anexo],[data-abrir-anexo],[data-concluir-prazo]");
        if (!botao) return;
        const { editarProcesso: editar, resultado, item, corrigirItem, ocorrencia, editarOcorrencia, editarPrazo, contrato, editarContrato, editarEmpenho, anexo, abrirAnexo: abrirId, concluirPrazo } = botao.dataset;
        if (editar) { editarProcesso(editar); return; }
        if (resultado) {
          const p = estado.processos.find(processo => processo.id === resultado), form = prepararFormulario("resultado", resultado);
          for (const campo of ["situacao_resultado", "data_resultado", "valor_homologado", "fonte_resultado", "motivo_perda"]) form.elements.namedItem(campo).value = p[campo] ?? "";
          const apurado = doProcesso(estado.itens, resultado).length > 0;
          form.elements.namedItem("situacao_resultado").disabled = apurado;
          form.elements.namedItem("valor_homologado").disabled = apurado;
          return;
        }
        if (item || corrigirItem) {
          const registro = estado.itens.find(x => x.id === corrigirItem);
          const form = prepararFormulario("item", item || registro.processo_id);
          if (registro) for (const campo of ["id", "tipo", "identificador", "descricao", "situacao", "quantidade", "valor_proposta", "valor_homologado", "motivo", "fonte_oficial"]) form.elements.namedItem(campo).value = registro[campo] ?? "";
          return;
        }
        if (ocorrencia) { const form = prepararFormulario("ocorrencia", ocorrencia); form.elements.namedItem("ocorrido_em").value = dataLocal(new Date()); return; }
        if (editarOcorrencia) {
          const registro = estado.ocorrencias.find(x => x.id === editarOcorrencia);
          const form = prepararFormulario("ocorrencia", registro.processo_id);
          for (const campo of ["id", "categoria", "descricao", "fonte_oficial"]) form.elements.namedItem(campo).value = registro[campo] ?? "";
          form.elements.namedItem("ocorrido_em").value = dataLocal(registro.ocorrido_em);
          return;
        }
        if (editarPrazo) {
          const registro = estado.prazos.find(x => x.id === editarPrazo);
          const form = prepararFormulario("prazo", registro.processo_id);
          $("titulo-form-prazo").textContent = "Editar prazo";
          for (const campo of ["id", "categoria", "titulo", "responsavel", "observacoes"]) form.elements.namedItem(campo).value = registro[campo] ?? "";
          form.elements.namedItem("vencimento").value = dataLocal(registro.vencimento);
          return;
        }
        if (contrato) { prepararFormulario("contrato", contrato); return; }
        if (editarContrato) {
          const registro = estado.contratos.find(x => x.id === editarContrato);
          const form = prepararFormulario("contrato", registro.processo_id);
          for (const campo of ["id", "numero", "situacao", "assinado_em", "valor", "vigencia_inicio", "vigencia_fim", "observacoes"]) form.elements.namedItem(campo).value = registro[campo] ?? "";
          return;
        }
        if (editarEmpenho) {
          const registro = estado.empenhos.find(x => x.id === editarEmpenho);
          const form = prepararFormulario("empenho", registro.processo_id);
          $("titulo-form-empenho").textContent = "Editar empenho";
          for (const campo of ["id", "numero", "emitido_em", "valor", "saldo", "entrega_prevista", "status", "observacoes"]) form.elements.namedItem(campo).value = registro[campo] ?? "";
          return;
        }
        if (anexo) { prepararFormulario("anexo", anexo); return; }
        if (abrirId) { await abrirAnexo(abrirId); return; }
        if (concluirPrazo) {
          const prazo = estado.prazos.find(x => x.id === concluirPrazo);
          const { error } = await sb.from("operacao_prazos_processo").update({ concluido_em: new Date().toISOString() }).eq("id", concluirPrazo).eq("organizacao_id", estado.orgId);
          if (error) { aviso("Não foi possível concluir o prazo: " + error.message, "erro"); return; }
          await atualizarEReabrir(prazo.processo_id);
        }
      });
    }

    return { renderizar, vincular };
  }

  raiz.criarAcompanhamentoOperacional = criar;
})(window);
