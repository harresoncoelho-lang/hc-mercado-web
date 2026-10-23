/* global module */
(function (raiz) {
  "use strict";
  function chaveRascunho(usuario, empresa, edital) {
    if (![usuario, empresa, edital].every((v) => typeof v === "string" && v.trim())) throw new Error("Selecione uma conta e empresa antes de salvar a minuta.");
    return `lp-defesa-v1:${JSON.stringify([usuario, empresa, edital])}`;
  }
  function temEvidencias(ponto) {
    return Array.isArray(ponto?.evidencias) && ponto.evidencias.length > 0 && ponto.evidencias.every((e) =>
      typeof e?.documento === "string" && e.documento.trim() && typeof e.texto === "string" && e.texto.trim());
  }
  const marcadorIdentidade = 'Destinatário e identificação da interessada: [preencher e conferir]';
  const blocoIdentidade = /^Destinatário: [^\n]*(?:\nAutoridade destinatária: [^\n]*)?\nInteressada: [^\n]*\nCNPJ: [^\n]*(?:\nEndereço da interessada: [^\n]*)?(?:\nRepresentante: [^\n]*)?(?:\nCargo do representante: [^\n]*)?/m;
  const linha = valor => typeof valor === 'string' ? valor.replace(/\s+/g, ' ').trim() : '';
  function possuiIdentificacaoLocal(texto) { return texto.includes(marcadorIdentidade) || blocoIdentidade.test(texto) || /\[RAZAO_SOCIAL\]|\[CNPJ\]/.test(texto); }
  function preencherIdentificacao(texto, { empresa = {}, perfil, orgao = '' } = {}) {
    const razao = linha(empresa.razao_social) || '[preencher razão social]';
    const cnpj = /^\d{14}$/.test(String(empresa.cnpj || '').replace(/\D/g, '')) ? linha(empresa.cnpj) : '[preencher CNPJ]';
    const dados = perfil?.status === 'confirmado' ? perfil.dados : null;
    const bloco = [`Destinatário: ${linha(orgao) || '[preencher e conferir]'}`, ...(linha(orgao) ? ['Autoridade destinatária: [confirmar autoridade competente]'] : []), `Interessada: ${razao}`, `CNPJ: ${cnpj}`,
      ...(dados ? [`Endereço da interessada: ${linha(dados.endereco) || '[preencher e conferir]'}`, `Representante: ${linha(dados.representante) || '[preencher e conferir]'}`, `Cargo do representante: ${linha(dados.cargo) || '[preencher e conferir]'}`] : [])].join('\n');
    return texto.replace(marcadorIdentidade, () => bloco).replace(blocoIdentidade, () => bloco).replaceAll('[RAZAO_SOCIAL]', () => razao).replaceAll('[CNPJ]', () => cnpj);
  }
  function assinaturaIdentificacao({ empresa = {}, perfil } = {}) {
    return JSON.stringify([empresa.id, linha(empresa.razao_social), String(empresa.cnpj || '').replace(/\D/g, ''), perfil?.status, perfil?.versao, perfil?.confirmadoEm,
      perfil?.dados?.endereco, perfil?.dados?.representante, perfil?.dados?.cargo]);
  }
  function prepararMinuta(tipo, ponto, dados) {
    if (!["esclarecimento", "impugnacao"].includes(tipo)) throw new Error("Tipo de minuta inválido.");
    if (!temEvidencias(ponto)) throw new Error("O ponto precisa de evidência documental antes de preparar uma minuta.");
    const provas = ponto.evidencias.map((e) => `${e.documento}${e.pagina ? `, página ${e.pagina}` : ""}${e.numero ? `, cláusula ${e.numero}` : ""}:\n${e.texto}`).join("\n\n");
    return [tipo === "esclarecimento" ? "Pedido de esclarecimento" : "Impugnação ao edital — minuta para revisão",
      `Destinatário: ${dados.orgao || "[confirmar órgão e autoridade responsável]"}`,
      `Interessada: ${dados.empresa || "[preencher razão social e identificação]"}`,
      `Licitação: ${dados.numeroControlePNCP || "[identificar certame]"}`,
      "Prazo e canal de apresentação: [conferir no edital e no portal oficial]",
      `1. Ponto a esclarecer\n${ponto.titulo || "Ponto documental"}`,
      `2. Trechos dos documentos\n${provas}`,
      tipo === "impugnacao" ? "3. Fundamentação jurídica — revisão necessária\n[Indicar a razão concreta do pedido e conferir a fundamentação jurídica em fonte oficial antes de finalizar. A divergência documental isolada não comprova ilegalidade.]" : "3. Motivo do pedido\nOs trechos demandam confirmação sobre sua aplicação à contratação, para permitir a preparação adequada da proposta.",
      `4. Pedido\n${ponto.pergunta || "Solicita-se esclarecer o alcance dos trechos citados."}${tipo === "impugnacao" ? "\n[Especificar a alteração pretendida e justificar seu cabimento após revisão.]" : ""}`,
      "[Local e data]\n[Nome, identificação e assinatura do responsável]",
      "Minuta elaborada com apoio do LicitaPlena. Revise fatos, enquadramento, legitimidade, prazo e canal antes de utilizar. Nenhum documento foi protocolado ou enviado.",
    ].join("\n\n");
  }
  const api = { chaveRascunho, prepararMinuta, temEvidencias, preencherIdentificacao, assinaturaIdentificacao, possuiIdentificacaoLocal };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.DefesaLicitante = api;
})(globalThis);
