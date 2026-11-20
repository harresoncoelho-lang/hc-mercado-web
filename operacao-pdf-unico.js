/* global module */
// "Baixar PDF único" (operacao.html): junta no navegador os arquivos dos documentos marcados, na ordem em que
// foram marcados. Nada vai ao servidor: cada arquivo é baixado do bucket privado com a sessão do usuário e
// montado com pdf-lib (carregado sob demanda, versão fixa + SRI). Imagem PNG/JPEG vira página A4; o resto é
// pulado com aviso "não incluído: X — motivo".
(function (global) {
  'use strict';
  const LIMITE_ARQUIVOS = 30;
  const LIMITE_BYTES = 60 * 1024 * 1024;
  const A4 = [595.28, 841.89];
  const MARGEM = 28;

  const nomeDoc = (d) => [d.tipo, d.titulo].filter(Boolean).join(' — ') || 'Documento';
  const aviso = (nome, motivo) => `não incluído: ${nome} — ${motivo}`;

  // Ordem = ordem de marcação; ids sem documento (lista recarregada) somem em silêncio.
  function planejar(documentos, idsEmOrdem) {
    const porId = new Map(documentos.map((d) => [d.id, d]));
    const fila = [], avisos = [];
    for (const id of idsEmOrdem) {
      const d = porId.get(id);
      if (!d) continue;
      if (!d.arquivo_caminho) { avisos.push(aviso(nomeDoc(d), 'sem arquivo anexado')); continue; }
      if (fila.length >= LIMITE_ARQUIVOS) { avisos.push(aviso(nomeDoc(d), `limite de ${LIMITE_ARQUIVOS} arquivos por PDF`)); continue; }
      fila.push({ id, nome: nomeDoc(d), caminho: d.arquivo_caminho });
    }
    return { fila, avisos };
  }

  // Tipo pela assinatura dos bytes, não pela extensão do nome.
  function tipoArquivo(b) {
    if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return 'pdf';
    if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return 'png';
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
    return null;
  }

  // Imagem reduzida (nunca ampliada) para caber no A4 com margem, centralizada.
  function encaixe(largura, altura) {
    const escala = Math.min(1, (A4[0] - 2 * MARGEM) / largura, (A4[1] - 2 * MARGEM) / altura);
    const w = largura * escala, h = altura * escala;
    return { x: (A4[0] - w) / 2, y: (A4[1] - h) / 2, width: w, height: h };
  }

  async function anexar(PDFLib, saida, tipo, bytes) {
    if (tipo === 'pdf') {
      const origem = await PDFLib.PDFDocument.load(bytes);
      const paginas = await saida.copyPages(origem, origem.getPageIndices());
      paginas.forEach((p) => saida.addPage(p));
      return;
    }
    const imagem = tipo === 'png' ? await saida.embedPng(bytes) : await saida.embedJpg(bytes);
    saida.addPage(A4).drawImage(imagem, encaixe(imagem.width, imagem.height));
  }

  function motivoFalha(tipo, erro) {
    if (tipo === 'pdf' && /encrypt/i.test(`${erro?.name} ${erro?.message}`)) return 'PDF protegido por senha';
    return tipo === 'pdf' ? 'PDF ilegível ou corrompido' : 'imagem ilegível ou corrompida';
  }

  // baixar(caminho) -> Promise<Uint8Array>. Retorna { bytes: Uint8Array|null, incluidos, avisos }.
  async function montar(PDFLib, fila, baixar, limiteBytes = LIMITE_BYTES) {
    const saida = await PDFLib.PDFDocument.create();
    const avisos = [];
    let incluidos = 0, total = 0;
    for (const item of fila) {
      let bytes;
      try { bytes = await baixar(item.caminho); } catch { avisos.push(aviso(item.nome, 'não foi possível baixar o arquivo')); continue; }
      if (total + bytes.length > limiteBytes) { avisos.push(aviso(item.nome, `o PDF passaria de ${Math.round(limiteBytes / 1048576)} MB`)); continue; }
      const tipo = tipoArquivo(bytes);
      if (!tipo) { avisos.push(aviso(item.nome, 'formato não suportado (só PDF, PNG ou JPEG)')); continue; }
      try { await anexar(PDFLib, saida, tipo, bytes); } catch (e) { avisos.push(aviso(item.nome, motivoFalha(tipo, e))); continue; }
      total += bytes.length; incluidos++;
    }
    return { bytes: incluidos ? await saida.save() : null, incluidos, avisos };
  }

  const api = { planejar, tipoArquivo, encaixe, montar, LIMITE_ARQUIVOS, LIMITE_BYTES };
  global.OperacaoPdfUnico = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
