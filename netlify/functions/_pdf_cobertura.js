const pdfjs = require("pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js");
// Só extraímos texto/operadores; carregar fontes de tela exigiria DOM no servidor.
pdfjs.PDFJS.disableFontFace = true;
const { OPS } = pdfjs;
const IMAGENS = new Set([OPS.paintImageXObject, OPS.paintJpegXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject]);
const IMAGENS_AGRUPADAS = new Set([OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObjectRepeat, OPS.paintInlineImageXObjectGroup, OPS.paintImageMaskXObjectGroup]);
const PINTURAS = new Set([OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);

function combinar(a, b) {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3],
    a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}

function caminhoDecorativo(comandos, coordenadas) {
  if (comandos.length === 1 && comandos[0] === OPS.rectangle) return true;
  if (comandos.length <= 2 && comandos.every((c) => c === OPS.moveTo || c === OPS.lineTo)) return true;
  let pontos = [], indice = 0;
  for (const comando of comandos) {
    if (comando === OPS.moveTo || comando === OPS.lineTo) {
      if (comando === OPS.moveTo && pontos.length) return false;
      pontos.push(coordenadas.slice(indice, indice + 2));
      indice += 2;
    } else if (comando === OPS.closePath) {
      if (pontos.length === 5 && pontos[4][0] === pontos[0][0] && pontos[4][1] === pontos[0][1]) pontos.pop();
      if (pontos.length !== 4 || new Set(pontos.map(([x]) => x)).size !== 2 || new Set(pontos.map(([, y]) => y)).size !== 2) return false;
      if (!pontos.every(([x, y], i) => x === pontos[(i + 1) % 4][0] || y === pontos[(i + 1) % 4][1])) return false;
      pontos = [];
    } else return false;
  }
  return pontos.length === 0 && indice === coordenadas.length;
}

async function paginaCurtaPendente(pagina) {
  try {
    const [x0, y0, x1, y1] = pagina.view || [];
    if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) return true;
    const { fnArray, argsArray } = await pagina.getOperatorList();
    if (!Array.isArray(fnArray) || fnArray.length !== argsArray?.length) return true;
    let matriz = [1, 0, 0, 1, 0, 0];
    let caminhoComplexo = false;
    const pilha = [];
    for (let i = 0; i < fnArray.length; i += 1) {
      const op = fnArray[i], args = argsArray[i];
      if (op === OPS.constructPath) {
        caminhoComplexo ||= !caminhoDecorativo(args[0], args[1]);
      } else if (PINTURAS.has(op)) {
        if (caminhoComplexo) return true;
        caminhoComplexo = false;
      } else if (op === OPS.endPath) caminhoComplexo = false;
      else if (op === OPS.save || op === OPS.paintFormXObjectBegin) {
        pilha.push(matriz);
        if (op === OPS.paintFormXObjectBegin && args[0]) matriz = combinar(matriz, args[0]);
      } else if (op === OPS.restore || op === OPS.paintFormXObjectEnd) {
        if (!pilha.length) return true;
        matriz = pilha.pop();
      } else if (op === OPS.transform) matriz = combinar(matriz, args);
      else if (IMAGENS_AGRUPADAS.has(op) || op === OPS.beginGroup || op === OPS.paintSolidColorImageMask) return true;
      else if (IMAGENS.has(op)) {
        const imagem = op === OPS.paintImageXObject && pagina.objs?.isResolved?.(args[0]) ? pagina.objs.get(args[0]) : null;
        if (imagem?.kind === 2 && imagem.data?.length === imagem.width * imagem.height * 3 && imagem.data.every((v) => v === 255)) continue;
        if (pagina.rotate % 180) return true;
        const pontos = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [matriz[0]*x+matriz[2]*y+matriz[4], matriz[1]*x+matriz[3]*y+matriz[5]]);
        const xs = pontos.map((p) => p[0]), ys = pontos.map((p) => p[1]);
        if (![...xs, ...ys].every(Number.isFinite)) return true;
        const baixo = Math.min(...ys), alto = Math.max(...ys);
        const largura = Math.max(...xs) - Math.min(...xs), altura = alto - baixo;
        // shortcut: margens de 15% e linhas finas são decoração; conteúdo gráfico no corpo continua exigindo conferência, até haver OCR.
        const margem = (y1 - y0) * 0.15;
        if (largura > 2 && altura > 2 && alto > y0 + margem && baixo < y1 - margem) return true;
      }
    }
    return pilha.length !== 0;
  } catch (_) {
    return true;
  }
}

module.exports = { paginaCurtaPendente };


