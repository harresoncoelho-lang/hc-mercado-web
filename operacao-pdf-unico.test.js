const test = require('node:test');
const assert = require('node:assert/strict');
const { planejar, tipoArquivo, encaixe, montar, LIMITE_ARQUIVOS } = require('./operacao-pdf-unico');
const { Buffer } = require('node:buffer');

const PDF = Uint8Array.from(Buffer.from('%PDF-1.7\n'));
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
const doc = (id, extra = {}) => ({ id, tipo: `Doc ${id}`, arquivo_caminho: `org/emp/${id}.bin`, ...extra });

// pdf-lib falso: registra a ordem das páginas e simula PDF protegido/corrompido pelo conteúdo.
function pdfLibFalso() {
  const paginas = [];
  const saida = {
    copyPages: async (origem) => origem.paginas,
    addPage: (p) => { const pg = Array.isArray(p) ? { tamanho: p, drawImage: (img, pos) => { pg.img = img.nome; pg.pos = pos; } } : p; paginas.push(pg); return pg; },
    embedPng: async (b) => ({ nome: `png:${b.at(-1)}`, width: 1200, height: 600 }),
    embedJpg: async (b) => ({ nome: `jpg:${b.at(-1)}`, width: 100, height: 100 }),
    save: async () => Uint8Array.from([1, 2, 3]),
  };
  const PDFLib = { PDFDocument: {
    create: async () => saida,
    load: async (b) => {
      const marca = Buffer.from(b).toString('latin1');
      if (marca.includes('ENC')) { const e = new Error('Input document to `PDFDocument.load` is encrypted'); e.name = 'EncryptedPDFError'; throw e; }
      if (marca.includes('RUIM')) throw new Error('Failed to parse');
      return { paginas: [`pdf:${marca.slice(9)}:1`, `pdf:${marca.slice(9)}:2`], getPageIndices: () => [0, 1] };
    },
  } };
  return { PDFLib, paginas };
}
const bytes = (base, sufixo) => Uint8Array.from([...base, ...Buffer.from(sufixo)]);

test('planejar: segue a ordem de marcação, pula sem arquivo e respeita o limite de arquivos', () => {
  const docs = [doc('a'), doc('b', { arquivo_caminho: null, titulo: 'Sem anexo' }), doc('c')];
  const r = planejar(docs, ['c', 'x-removido', 'b', 'a']);
  assert.deepEqual(r.fila.map((f) => f.id), ['c', 'a']);
  assert.deepEqual(r.avisos, ['não incluído: Doc b — Sem anexo — sem arquivo anexado']);
  const muitos = Array.from({ length: LIMITE_ARQUIVOS + 2 }, (_, i) => doc(String(i)));
  const l = planejar(muitos, muitos.map((d) => d.id));
  assert.equal(l.fila.length, 30);
  assert.deepEqual(l.avisos, ['não incluído: Doc 30 — limite de 30 arquivos por PDF', 'não incluído: Doc 31 — limite de 30 arquivos por PDF']);
});

test('tipoArquivo: decide pela assinatura dos bytes', () => {
  assert.equal(tipoArquivo(PDF), 'pdf');
  assert.equal(tipoArquivo(PNG), 'png');
  assert.equal(tipoArquivo(JPG), 'jpeg');
  assert.equal(tipoArquivo(Uint8Array.from(Buffer.from('PK\x03\x04docx'))), null);
  assert.equal(tipoArquivo(new Uint8Array()), null);
});

test('encaixe: imagem grande é reduzida para o A4 com margem; pequena não é ampliada', () => {
  const g = encaixe(1200, 600);
  assert.ok(Math.abs(g.width - (595.28 - 56)) < 1e-9);
  assert.ok(Math.abs(g.x - 28) < 1e-9);
  assert.deepEqual(encaixe(100, 100).width, 100);
});

test('montar: mantém a ordem, imagem vira página e o resto é pulado com motivo', async () => {
  const { PDFLib, paginas } = pdfLibFalso();
  const arquivos = {
    p1: bytes(PDF, 'um'), img: bytes(PNG, ''), enc: bytes(PDF, 'ENC'), ruim: bytes(PDF, 'RUIM'),
    docx: Uint8Array.from(Buffer.from('PK\x03\x04')), jpg: JPG,
  };
  const fila = ['p1', 'img', 'enc', 'ruim', 'docx', 'falha', 'jpg'].map((id) => ({ id, nome: id, caminho: id }));
  const baixar = async (c) => { if (!arquivos[c]) throw new Error('403'); return arquivos[c]; };
  const r = await montar(PDFLib, fila, baixar);
  assert.equal(r.incluidos, 3);
  assert.deepEqual(paginas.map((p) => (typeof p === 'string' ? p : p.img)), ['pdf:um:1', 'pdf:um:2', 'png:0', 'jpg:224']);
  assert.deepEqual(r.avisos, [
    'não incluído: enc — PDF protegido por senha',
    'não incluído: ruim — PDF ilegível ou corrompido',
    'não incluído: docx — formato não suportado (só PDF, PNG ou JPEG)',
    'não incluído: falha — não foi possível baixar o arquivo',
  ]);
  assert.deepEqual([...r.bytes], [1, 2, 3]);
});

test('montar: limite de tamanho total pula o arquivo que estouraria; nada incluído devolve bytes null', async () => {
  const { PDFLib } = pdfLibFalso();
  const grande = new Uint8Array(40); grande.set(PDF);
  const fila = [{ nome: 'A', caminho: 'a' }, { nome: 'B', caminho: 'b' }, { nome: 'C', caminho: 'c' }];
  const r = await montar(PDFLib, fila, async () => grande, 100);
  assert.equal(r.incluidos, 2);
  assert.deepEqual(r.avisos, ['não incluído: C — o PDF passaria de 0 MB']);
  const vazio = await montar(PDFLib, [{ nome: 'X', caminho: 'x' }], async () => JPG.slice(0, 1));
  assert.equal(vazio.bytes, null);
  assert.deepEqual(vazio.avisos, ['não incluído: X — formato não suportado (só PDF, PNG ou JPEG)']);
});
