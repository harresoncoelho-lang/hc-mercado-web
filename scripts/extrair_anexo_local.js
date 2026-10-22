const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const executar = promisify(execFile);

async function extrairAnexoLocal(buffer, nome, { python = process.env.PYTHON_EXTRATOR || (process.platform === 'win32' ? 'python' : 'python3'), imagem = process.env.IMAGEM_EXTRATOR_ANEXOS } = {}) {
  if (buffer.length > 64 * 1024 * 1024) return { texto: '', pendencias: ['limite de bytes do anexo'] };
  const pasta = await mkdtemp(path.join(tmpdir(), 'licitaplena-anexo-'));
  try {
    const extensao = path.extname(String(nome || '')).match(/^\.[a-z0-9]{1,8}$/i)?.[0] || '.bin';
    const arquivo = path.join(pasta, 'anexo' + extensao);
    await writeFile(arquivo, buffer);
    const env = Object.fromEntries(Object.entries(process.env).filter(([chave]) => /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|LANG|TESSDATA_PREFIX)$/i.test(chave)));
    const programa = imagem ? 'docker' : python;
    const argumentos = imagem ? ['run', '--rm', '--network=none', '--read-only', '--cap-drop=ALL',
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
