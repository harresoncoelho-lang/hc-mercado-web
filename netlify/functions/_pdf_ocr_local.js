const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtemp, writeFile, stat, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const executar = promisify(execFile);
let ocupado = false;

function criarOCRLocal({ pdftoppm, tesseract, idioma = 'eng', maxPaginas = 20, timeoutMs = 120000, timeoutPaginaMs = 20000 } = {}) {
  if (![pdftoppm, tesseract].every((p) => typeof p === 'string' && path.isAbsolute(p)) || !['eng', 'por', 'por+eng'].includes(idioma)) throw new Error('Configuração local de OCR inválida');
  if (!Number.isInteger(maxPaginas) || maxPaginas < 1 || maxPaginas > 20 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000 || !Number.isInteger(timeoutPaginaMs) || timeoutPaginaMs < 1 || timeoutPaginaMs > 20000) throw new Error('Limites locais de OCR inválidos');
  return async function ocrPDF(buffer, { paginas, totalPaginas, prazoMs }) {
    if (!Buffer.isBuffer(buffer) || buffer.length > 32 * 1024 * 1024 || buffer.subarray(0, 5).toString() !== '%PDF-') throw new Error('PDF fora dos limites de OCR');
    if (!Number.isInteger(totalPaginas) || !Array.isArray(paginas) || paginas.some((p) => !Number.isInteger(p) || p < 1 || p > totalPaginas) || new Set(paginas).size !== paginas.length) throw new Error('Páginas de OCR inválidas');
    if (ocupado) throw new Error('OCR local ocupado; leitura parcial');
    ocupado = true;
    let pasta;
    const resultado = { metodo: 'pdftoppm+tesseract', idioma, paginas: [], pendencias: [] };
    const inicio = Date.now();
    const prazo = Math.min(inicio + timeoutMs, Number.isFinite(prazoMs) ? prazoMs : Infinity);
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|LANG|TESSDATA_PREFIX)$/i.test(k)));
    env.OMP_THREAD_LIMIT = '1';
    const comando = async (programa, args, fimPagina) => {
      const restante = Math.min(prazo, fimPagina) - Date.now();
      if (restante <= 0) throw new Error('limite de tempo');
      return executar(programa, args, { shell: false, windowsHide: true, timeout: restante, maxBuffer: 1024 * 1024, env });
    };
    try {
      pasta = await mkdtemp(path.join(tmpdir(), 'licitaplena-ocr-'));
      const arquivo = path.join(pasta, 'entrada.pdf');
      await writeFile(arquivo, buffer);
      for (const pagina of paginas.slice(0, maxPaginas)) {
        const prefixo = path.join(pasta, 'pagina');
        try {
          const fimPagina = Date.now() + timeoutPaginaMs;
          await comando(pdftoppm, ['-f', String(pagina), '-l', String(pagina), '-singlefile', '-scale-to', '2500', '-png', arquivo, prefixo], fimPagina);
          const imagem = prefixo + '.png';
          if ((await stat(imagem)).size > 24 * 1024 * 1024) throw new Error('imagem excede limite');
          const { stdout } = await comando(tesseract, [imagem, 'stdout', '-l', idioma], fimPagina);
          if (stdout.trim().length < 80 || stdout.length > 100000 || resultado.paginas.reduce((n, p) => n + p.texto.length, 0) + stdout.length > 600000) throw new Error('texto OCR insuficiente ou acima do limite');
          resultado.paginas.push({ pagina, texto: stdout.trim() });
        } catch (_) {
          resultado.pendencias.push(`Página ${pagina}: OCR não concluído ou texto insuficiente; conferir original`);
        } finally {
          await rm(prefixo + '.png', { force: true });
        }
        if (Date.now() >= prazo) break;
      }
      for (const pagina of paginas) if (!resultado.paginas.some((p) => p.pagina === pagina) && !resultado.pendencias.some((p) => p.startsWith(`Página ${pagina}:`))) resultado.pendencias.push(`Página ${pagina}: limite de páginas ou tempo de OCR; conferir original`);
      resultado.duracaoMs = Date.now() - inicio;
      return resultado;
    } finally {
      try {
        // mkdtemp é a única origem deste caminho; valida antes da remoção recursiva no Windows.
        if (pasta && path.dirname(path.resolve(pasta)) === path.resolve(tmpdir()) && path.basename(pasta).startsWith('licitaplena-ocr-')) await rm(pasta, { recursive: true, force: true });
      } finally { ocupado = false; }
    }
  };
}

function ocrLocalConfigurado() {
  if (process.env.LEITURA_OCR_LOCAL !== '1') return null;
  try { return criarOCRLocal({ pdftoppm: process.env.OCR_LOCAL_PDFTOPPM, tesseract: process.env.OCR_LOCAL_TESSERACT, idioma: process.env.OCR_LOCAL_IDIOMA || 'eng' }); }
  catch (_) { return null; }
}
module.exports = { criarOCRLocal, ocrLocalConfigurado };
