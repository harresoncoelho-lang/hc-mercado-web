const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const executar = promisify(execFile);

function nomeSeguro(nome) {
  let valor = String(nome || '').split(/[?#]/)[0];
  try { valor = decodeURIComponent(valor); } catch { /* nome não codificado */ }
  return path.posix.basename(valor.replaceAll('\\', '/')).normalize('NFC').toLowerCase();
}

function grupoRar(nome) {
  const parte = nome.match(/^(.+)\.part(\d+)\.rar$/i);
  if (parte) return { chave: 'part:' + parte[1], indice: Number(parte[2]) };
  const antigo = nome.match(/^(.+)\.(rar|[r-z]\d{2})$/i);
  return antigo ? { chave: 'old:' + antigo[1], indice: antigo[2] === 'rar' ? 0 : (antigo[2].charCodeAt(0) - 'r'.charCodeAt(0)) * 100 + Number(antigo[2].slice(1)) + 1 } : null;
}

async function extrairAnexoLocal(buffer, nome, { python = process.env.PYTHON_EXTRATOR || (process.platform === 'win32' ? 'python' : 'python3'), imagem = process.env.IMAGEM_EXTRATOR_ANEXOS, companheiros = [] } = {}) {
  if (buffer.length > 64 * 1024 * 1024) return { texto: '', pendencias: ['limite de bytes do anexo'] };
  const pasta = await mkdtemp(path.join(tmpdir(), 'licitaplena-anexo-'));
  try {
    const extensao = path.extname(String(nome || '')).match(/^\.[a-z0-9]{1,8}$/i)?.[0] || '.bin';
    const nomeBase = nomeSeguro(nome);
    const grupo = grupoRar(nomeBase);
    let arquivos = [{ nome: 'anexo' + extensao, buffer }];
    let entrada = arquivos[0].nome;
    if (grupo) {
      const mesmoGrupo = [...companheiros, { nome, buffer }].map(a => ({ nome: nomeSeguro(a.nome), buffer: a.buffer }))
        .filter(a => grupoRar(a.nome)?.chave === grupo.chave);
      const unicos = new Map();
      for (const a of mesmoGrupo) {
        if (unicos.has(a.nome) && !unicos.get(a.nome).buffer.equals(a.buffer)) return { texto: '', pendencias: ['nomes de volumes ambíguos; grupo não reunido'] };
        unicos.set(a.nome, a);
      }
      arquivos = [...unicos.values()];
      const indices = new Set();
      for (const a of arquivos) {
        const indice = grupoRar(a.nome).indice;
        if (indices.has(indice)) return { texto: '', pendencias: ['índice de volume RAR duplicado; grupo ambíguo'] };
        indices.add(indice);
      }
      const primeiro = arquivos.find(a => grupoRar(a.nome).indice === (grupo.chave.startsWith('part:') ? 1 : 0));
      if (!primeiro) return { texto: '', pendencias: ['primeiro volume RAR ausente'] };
      if (nomeBase !== primeiro.nome) return { texto: '', pendencias: [], volumeDe: primeiro.nome };
      entrada = primeiro.nome;
    }
    if (arquivos.reduce((soma, a) => soma + a.buffer.length, 0) > 64 * 1024 * 1024) return { texto: '', pendencias: ['limite de bytes do conjunto de volumes'] };
    for (const a of arquivos) await writeFile(path.join(pasta, a.nome), a.buffer);
    const arquivo = path.join(pasta, entrada);
    const env = Object.fromEntries(Object.entries(process.env).filter(([chave]) => /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|LANG|TESSDATA_PREFIX)$/i.test(chave)));
    const programa = imagem ? 'docker' : python;
    // O mesmo UID do executor pode ler o mkdtemp(0700) sem ampliar suas permissões.
    const usuario = typeof process.getuid === 'function' && process.getuid() !== 0 ? ['--user', `${process.getuid()}:${process.getgid()}`] : [];
    const argumentos = imagem ? ['run', '--rm', ...usuario, '--network=none', '--read-only', '--cap-drop=ALL',
      '--security-opt=no-new-privileges', '--memory=1g', '--cpus=1', '--pids-limit=128',
      '--tmpfs=/tmp:rw,size=268435456,mode=1777', '--env=HOME=/tmp',
      '--mount', `type=bind,source=${pasta},target=/dados,readonly`, imagem, '/dados/' + path.basename(arquivo)]
      : [path.join(__dirname, 'extrair_anexo.py'), arquivo];
    const { stdout } = await executar(programa, argumentos, {
      timeout: 100000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: imagem ? process.env : env,
    });
    const resultado = JSON.parse(stdout);
    if (typeof resultado.texto !== 'string' || !Array.isArray(resultado.pendencias)) throw new Error('Resposta inválida do extrator');
    return resultado;
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}
module.exports = { extrairAnexoLocal };
