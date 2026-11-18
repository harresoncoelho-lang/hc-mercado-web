// Registro durável, só de IDs, dos processos QA que o fluxo de cadastro tentou criar.
// Guarda userId, empresaId e processoId (UUID). Nunca credenciais, tokens ou dados do processo.
// A descoberta continua validando cada id no banco com o token do usuário: id registrado sem linha visível não entra.
const fs = require('node:fs');
const path = require('node:path');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const LIMITE_POR_USUARIO = 50;
const LIMITE_TOTAL = 2000;

function criarRegistro(caminho) {
  if (typeof caminho !== 'string' || !caminho) throw new Error('Registro QA inválido');
  let itens = [];
  if (fs.existsSync(caminho)) {
    let bruto;
    try { bruto = JSON.parse(fs.readFileSync(caminho, 'utf8')); } catch { throw new Error('Registro QA corrompido'); }
    // Falha fechada: qualquer entrada inválida invalida o arquivo inteiro (nada é filtrado em silêncio).
    if (!Array.isArray(bruto)) throw new Error('Registro QA corrompido');
    for (const x of bruto) {
      if (!x || typeof x !== 'object' || !UUID.test(x.userId || '') || !UUID.test(x.empresaId || '') || !UUID.test(x.processoId || '')) throw new Error('Registro QA corrompido');
    }
    itens = bruto.map(x => ({ userId: x.userId, empresaId: x.empresaId, processoId: x.processoId }));
  }
  // Escrita atômica: grava um temporário e troca pelo arquivo final. Se qualquer passo falhar, lança o erro
  // e o arquivo anterior permanece intacto. Quem chama só atualiza a memória depois que isto retorna.
  function salvar(lista) {
    const tmp = caminho + '.' + process.pid + '.tmp';
    try {
      fs.mkdirSync(path.dirname(caminho), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(lista, null, 2));
      fs.renameSync(tmp, caminho);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* temporário inexistente ou diretório: nada a limpar */ }
      throw e;
    }
  }
  return {
    listar(userId) { return itens.filter(x => x.userId === userId).map(({ empresaId, processoId }) => ({ empresaId, processoId })); },
    contar(userId) { return itens.filter(x => x.userId === userId).length; },
    // Verificação de limite sem escrever: usada antes da criação, para não gravar em registro cheio.
    podeRegistrar(userId) {
      return itens.filter(x => x.userId === userId).length < LIMITE_POR_USUARIO && itens.length < LIMITE_TOTAL;
    },
    registrar(userId, empresaId, processoId) {
      if (!UUID.test(userId) || !UUID.test(empresaId) || !UUID.test(processoId)) throw new Error('Id inválido no registro QA');
      if (itens.some(x => x.userId === userId && x.processoId === processoId)) return;
      if (itens.filter(x => x.userId === userId).length >= LIMITE_POR_USUARIO || itens.length >= LIMITE_TOTAL) throw new Error('Limite QA de processos atingido');
      // Commit em duas fases: grava primeiro; a memória só recebe o par se a gravação for bem-sucedida.
      const proximos = [...itens, { userId, empresaId, processoId }];
      salvar(proximos);
      itens = proximos;
    },
  };
}

module.exports = { criarRegistro, LIMITE_POR_USUARIO };
