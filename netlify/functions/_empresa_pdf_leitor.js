const { LIMITES } = require('./_empresa_identificacao');

// Leitor exclusivo do cadastro empresarial. Não altera o parser do resumo nem o loader global.
async function lerPaginasPdf(bytes, tempoMs = 10000) {
  if (bytes.length > LIMITES.extracao) throw new Error('Limite de extração excedido.');
  // Carregamento sob demanda, como no leitor anterior; não antecipar PDF.js na inicialização.
  const pdf = require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');
  const { WorkerMessageHandler } = require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.worker.js');
  const port = new pdf.LoopbackPort(true);
  let worker, tarefa, timer;
  try {
    worker = pdf.PDFWorker.fromPort(port);
    WorkerMessageHandler.initializeFromPort(port);
    // Porta explícita evita _setupFakeWorker/node-ensure. Não atribuir disableWorker ou require.ensure.
    tarefa = pdf.getDocument({ data: new Uint8Array(bytes), worker });
    const leitura = async () => {
      const doc = await tarefa;
      const paginas = [];
      if (doc.numPages <= LIMITES.paginas) {
        for (let pagina = 1; pagina <= doc.numPages; pagina++) {
          const page = await doc.getPage(pagina);
          const conteudo = await page.getTextContent();
          let linha = -1, texto = '';
          for (const item of conteudo.items) {
            const y = item.transform?.[5];
            if (y !== linha) { texto += '\n'; linha = y; }
            texto += item.str + ' ';
          }
          paginas.push({ pagina, texto });
        }
      }
      return { numpages: doc.numPages, paginas };
    };
    return await Promise.race([leitura(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Tempo de leitura do PDF excedido.')), tempoMs);
    })]);
  } finally {
    clearTimeout(timer);
    try { if (tarefa) await tarefa.destroy(); }
    finally { try { if (worker) worker.destroy(); } finally { port.terminate(); } }
  }
}

module.exports = { lerPaginasPdf };
