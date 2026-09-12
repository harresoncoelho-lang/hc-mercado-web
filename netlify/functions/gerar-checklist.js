// Gera um .docx real para o checklist do edital. O Word abria o antigo HTML
// renomeado como .doc, mas isso fazia cada cliente renderizar de um jeito e
// deixava o documento com aparência improvisada.
const AdmZip = require("adm-zip");
const { cabecalhosPadrao, exigirUsuarioLogado } = require("./_auth");

function responder(event, statusCode, corpo, extra = {}) {
  return { statusCode, headers: { ...cabecalhosPadrao(event), ...extra }, body: corpo };
}

function xml(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function texto(valor) {
  if (valor === null || valor === undefined) return "";
  if (typeof valor !== "object") return String(valor).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return texto(valor.titulo || valor.pergunta || valor.texto || valor.descricao || valor.item || "");
}

function util(valor) {
  const resultado = texto(valor);
  return resultado && !/^(?:n[ãa]o (informado|localizado)|nenhum(?:a)?\b)/i.test(resultado) ? resultado : "";
}

function formatarDataHora(valor) {
  return texto(valor).replace(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2})(?::\d{2})?)?$/, (_, ano, mes, dia, hora) => `${dia}/${mes}/${ano}${hora ? ` às ${hora}` : ""}`);
}

function podeGerarChecklist(resumo) {
  return resumo.fonteLida === true && ["documentosCredenciamento", "requisitosProposta", "documentosHabilitacao", "declaracoesExigidas"]
    .some((chave) => Array.isArray(resumo[chave]) && resumo[chave].some(util));
}

function coberturaDocumento(resumo) {
  const cobertura = resumo.coberturaLeitura || {};
  const lidos = Array.isArray(cobertura.documentosLidos) ? cobertura.documentosLidos.map(texto).filter(Boolean) : [];
  const naoLidos = Array.isArray(cobertura.documentosNaoLidos) ? cobertura.documentosNaoLidos.map(texto).filter(Boolean) : [];
  const parcial = cobertura.parcial !== false || naoLidos.length > 0 || resumo.modoDegradado;
  const partes = [parcial ? "Leitura parcial: este checklist não confirma a totalidade das exigências." : "Requisitos extraídos dos documentos analisados. Confira a referência de cada item no edital."];
  if (lidos.length) partes.push(`Documentos lidos: ${lidos.join("; ")}.`);
  if (naoLidos.length) partes.push(`Documentos não lidos: ${naoLidos.join("; ")}.`);
  if (Array.isArray(cobertura.motivos)) partes.push(...cobertura.motivos.map(texto).filter(Boolean));
  return partes.join("\n");
}

function paragrafo(conteudo, { negrito = false, tamanho = 21, cor = "17243A", antes = 0, depois = 120, alinhamento = "left" } = {}) {
  const partes = String(conteudo || "").split(/\r?\n/).filter(Boolean);
  const propriedades = `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:color w:val="${cor}"/><w:sz w:val="${tamanho}"/>${negrito ? '<w:b/>' : ""}</w:rPr>`;
  const textoXml = (partes.length ? partes : [""]).map((parte, indice) => `<w:r>${propriedades}${indice ? '<w:br/>' : ""}<w:t xml:space="preserve">${xml(parte)}</w:t></w:r>`).join("");
  const jc = alinhamento === "center" ? '<w:jc w:val="center"/>' : alinhamento === "right" ? '<w:jc w:val="right"/>' : "";
  return `<w:p><w:pPr><w:spacing w:before="${antes}" w:after="${depois}"/>${jc}</w:pPr>${textoXml}</w:p>`;
}

function tituloSecao(titulo) {
  return `<w:p><w:pPr><w:spacing w:before="240" w:after="90"/><w:shd w:val="clear" w:fill="EEF3F8"/><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="1F75DF"/></w:pBdr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:color w:val="193A63"/><w:sz w:val="22"/></w:rPr><w:t>${xml(titulo)}</w:t></w:r></w:p>`;
}

function linhaChecklist(textoLinha) {
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="420"/><w:gridCol w:w="8700"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="420" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:r><w:rPr><w:color w:val="1F75DF"/><w:sz w:val="24"/></w:rPr><w:t>☐</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:w="8700" w:type="dxa"/></w:tcPr>${paragrafo(textoLinha, { tamanho: 20, depois: 70 })}</w:tc></w:tr></w:tbl>`;
}

function linhaDados(rotulo, valor) {
  return `<w:tr><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/><w:shd w:val="clear" w:fill="F8FAFC"/></w:tcPr>${paragrafo(rotulo, { negrito: true, tamanho: 18, cor: "637085", antes: 60, depois: 60 })}</w:tc><w:tc><w:tcPr><w:tcW w:w="6120" w:type="dxa"/></w:tcPr>${paragrafo(valor, { tamanho: 19, antes: 60, depois: 60 })}</w:tc></w:tr>`;
}

function tabelaDados(linhas) {
  const uteis = linhas.filter(([, valor]) => util(valor));
  if (!uteis.length) return "";
  return `<w:tbl><w:tblPr><w:tblW w:w="9120" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="DCE5EF"/><w:left w:val="single" w:sz="4" w:color="DCE5EF"/><w:bottom w:val="single" w:sz="4" w:color="DCE5EF"/><w:right w:val="single" w:sz="4" w:color="DCE5EF"/><w:insideH w:val="single" w:sz="4" w:color="DCE5EF"/><w:insideV w:val="single" w:sz="4" w:color="DCE5EF"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="6120"/></w:tblGrid>${uteis.map(([rotulo, valor]) => linhaDados(rotulo, util(valor))).join("")}</w:tbl>`;
}

function conteudoDocumento(edital, resumo) {
  const identificacao = resumo.identificacao || {};
  const sessao = resumo.sessaoPublica || {};
  const detalhes = resumo.detalhes || {};
  const orgao = resumo.orgao || {};
  const numero = util(identificacao.numero) || util(edital.numero) || util(edital.numeroControlePNCP) || "Não informado";
  const rotuloNumero = /^\d{14}-\d-\d+\/\d{4}$/.test(numero) ? "Controle PNCP" : "Número da licitação";
  const objeto = util(identificacao.objeto) || util(edital.objeto) || "Não informado";
  const documentos = Array.isArray(resumo.documentosHabilitacao) ? resumo.documentosHabilitacao.map(util).filter(Boolean) : [];
  const credenciamento = Array.isArray(resumo.documentosCredenciamento) ? resumo.documentosCredenciamento.map(util).filter(Boolean) : [];
  const proposta = Array.isArray(resumo.requisitosProposta) ? resumo.requisitosProposta.map(util).filter(Boolean) : [];
  const declaracoes = Array.isArray(resumo.declaracoesExigidas) ? resumo.declaracoesExigidas.map(util).filter(Boolean) : [];
  const pendencias = Array.isArray(resumo.pendenciasParaConferencia) ? resumo.pendenciasParaConferencia.map(util).filter(Boolean) : [];
  const dataEmissao = new Date().toLocaleDateString("pt-BR");
  const cabecalho = `<w:tbl><w:tblPr><w:tblW w:w="9120" w:type="dxa"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="single" w:sz="18" w:color="1F75DF"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="6500"/><w:gridCol w:w="2620"/></w:tblGrid><w:tr><w:tc>${paragrafo("LicitaPlena", { negrito: true, tamanho: 34, cor: "102D56", depois: 120 })}</w:tc><w:tc>${paragrafo("Checklist operacional", { tamanho: 17, cor: "637085", depois: 20, alinhamento: "right" })}${paragrafo(`Emitido em ${dataEmissao}`, { tamanho: 16, cor: "637085", depois: 120, alinhamento: "right" })}</w:tc></w:tr></w:tbl>`;
  const destaque = `<w:tbl><w:tblPr><w:tblW w:w="9120" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="DCE5EF"/><w:left w:val="single" w:sz="4" w:color="DCE5EF"/><w:bottom w:val="single" w:sz="4" w:color="DCE5EF"/><w:right w:val="single" w:sz="4" w:color="DCE5EF"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders><w:shd w:val="clear" w:fill="F3F7FC"/></w:tblPr><w:tblGrid><w:gridCol w:w="9120"/></w:tblGrid><w:tr><w:tc>${paragrafo("Objeto", { negrito: true, tamanho: 17, cor: "637085", antes: 110, depois: 30 })}${paragrafo(objeto, { negrito: true, tamanho: 24, cor: "132F56", depois: 110 })}</w:tc></w:tr></w:tbl>`;
  const dadosBasicos = tabelaDados([[rotuloNumero, numero], ["Órgão", orgao.nome || edital.orgao], ["Modalidade", identificacao.modalidade || edital.modalidade], ["Data e horário da sessão", [util(sessao.data), util(sessao.horario)].filter(Boolean).join(" às ")], ["Prazo final de propostas", formatarDataHora(edital.encerramento || resumo.prazos?.limiteEnvioPropostas)], ["Critério de julgamento", detalhes.criterioJulgamento], ["Regime de execução", detalhes.regimeExecucao || edital.regimeExecucao]]);
  const condicoes = tabelaDados([["Prazo de entrega", detalhes.prazoEntrega], ["Condições da entrega", resumo.entregaExecucao?.condicoes], ["Subcontratação", resumo.analiseCritica?.permiteSubcontratacao], ["Validade da proposta", resumo.criteriosProposta?.validadeProposta], ["Condições de pagamento", resumo.condicoesPagamento], ["Garantia de proposta", resumo.garantias?.proposta], ["Garantia contratual", resumo.garantias?.contrato], ["Legislação e base legal", resumo.legislacao]]);
  const listaComFallback = (titulo, itens, fallback) => `${tituloSecao(titulo)}${itens.length ? itens.map(linhaChecklist).join("") : paragrafo(fallback, { tamanho: 19, cor: "637085" })}`;
  return `${cabecalho}${paragrafo("Checklist de Licitação", { negrito: true, tamanho: 36, cor: "102D56", antes: 280, depois: 45 })}${paragrafo(`${rotuloNumero}: ${numero}`, { tamanho: 20, cor: "637085", depois: 180 })}${destaque}${tituloSecao("Cobertura da leitura")}${paragrafo(coberturaDocumento(resumo), { tamanho: 20, cor: "637085" })}${tituloSecao("Identificação e prazos")}${dadosBasicos}${listaComFallback("Credenciamento e participação", credenciamento, "Nenhum requisito de credenciamento foi identificado no material lido; isso não confirma dispensa.")}${listaComFallback("Preparação e envio da proposta", proposta, "Nenhum requisito de proposta foi identificado no material lido; confira o edital.")}${listaComFallback("Documentos de habilitação", documentos, "Nenhum documento específico foi identificado no material analisado. Confira o edital oficial.")}${condicoes ? tituloSecao("Condições comerciais e operacionais") + condicoes : ""}${listaComFallback("Declarações e formulários", declaracoes, "Nenhuma declaração específica foi identificada no material analisado.")}${listaComFallback("Pontos para conferir antes da proposta", pendencias, "Revise o edital, os anexos e o termo de referência antes de apresentar a proposta.")}${util(resumo.anexosDeclaracoes) ? tituloSecao("Anexos e modelos citados") + paragrafo(util(resumo.anexosDeclaracoes)) : ""}${(Array.isArray(resumo.outrasInformacoesRelevantes) && resumo.outrasInformacoesRelevantes.length ? tituloSecao("Informações operacionais complementares") + resumo.outrasInformacoesRelevantes.map(item => paragrafo(util(item))).join("") : "") + tituloSecao("Síntese do edital")}${paragrafo(util(resumo.resumoGeral) || "O resumo completo não está disponível. Consulte o edital e seus anexos oficiais.", { tamanho: 20, depois: 180 })}${paragrafo("Documento gerado pelo LicitaPlena como apoio operacional. Confirme sempre o edital e os anexos oficiais antes de decidir.", { tamanho: 16, cor: "637085", antes: 180, depois: 0 })}`;
}

function montarDocx(edital, resumo) {
  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`));
  zip.addFile("_rels/.rels", Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`));
  zip.addFile("word/_rels/document.xml.rels", Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`));
  zip.addFile("word/styles.xml", Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`));
  zip.addFile("docProps/core.xml", Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><dc:title>Checklist de Licitação</dc:title><dc:creator>LicitaPlena</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`));
  zip.addFile("docProps/app.xml", Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>LicitaPlena</Application></Properties>`));
  zip.addFile("word/document.xml", Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${conteudoDocumento(edital, resumo)}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="900" w:right="900" w:bottom="900" w:left="900"/><w:defaultTabStop w:val="720"/></w:sectPr></w:body></w:document>`));
  return zip.toBuffer();
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return responder(event, 204, "");
  if (event.httpMethod !== "POST") return responder(event, 405, JSON.stringify({ erro: "Método não permitido." }));
  const usuario = await exigirUsuarioLogado(event);
  if (!usuario.ok) return responder(event, usuario.status, JSON.stringify({ erro: usuario.erro }));
  let dados;
  try { dados = JSON.parse(event.body || "{}"); } catch (e) { return responder(event, 400, JSON.stringify({ erro: "Dados do checklist inválidos." })); }
  const edital = dados.edital && typeof dados.edital === "object" ? dados.edital : {};
  const resumo = dados.resumoEstruturado && typeof dados.resumoEstruturado === "object" ? dados.resumoEstruturado : {};
  if (!podeGerarChecklist(resumo)) return responder(event, 422, JSON.stringify({ erro: "O checklist requer a leitura do edital e requisitos identificados. Gere o Resumo do Edital antes de exportar." }));
  const arquivo = montarDocx(edital, resumo);
  return { ...responder(event, 200, arquivo.toString("base64"), {
    "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Content-Disposition": 'attachment; filename="checklist-licitacao.docx"',
    "Content-Transfer-Encoding": "base64",
  }), isBase64Encoded: true };
};

exports.__test = { montarDocx, conteudoDocumento, util, podeGerarChecklist, coberturaDocumento };
