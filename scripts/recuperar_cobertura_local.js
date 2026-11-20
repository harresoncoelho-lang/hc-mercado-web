// Recuperação somente em disco: não carrega credenciais nem publica no Supabase.
const fs = require("node:fs/promises");
const path = require("node:path");
const { fetchComRetentativa } = require("./atualizar_dados");
const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");

async function lerJson(caminho) {
  try { return JSON.parse(await fs.readFile(caminho, "utf8")); }
  catch (erro) { if (erro.code === "ENOENT") return null; throw erro; }
}

async function gravarJson(caminho, dado) {
  await fs.writeFile(`${caminho}.tmp`, JSON.stringify(dado), "utf8");
  await fs.rename(`${caminho}.tmp`, caminho);
}

function validarPagina(dado, numero) {
  if (!dado || !Array.isArray(dado.data) || !Number.isSafeInteger(dado.totalPaginas) || dado.totalPaginas < 0) {
    throw new Error("Fonte sem resposta válida; páginas anteriores preservadas.");
  }
  if (dado.totalPaginas === 0) {
    if (dado.data.length || (dado.totalRegistros !== undefined && dado.totalRegistros !== 0) ||
        (dado.numeroPagina !== undefined && dado.numeroPagina !== numero)) throw new Error("Resposta vazia com paginação/contagem contraditória.");
    return { ...dado, totalRegistros: 0, numeroPagina: numero };
  }
  if (dado.numeroPagina !== numero || !Number.isSafeInteger(dado.totalRegistros) || dado.totalRegistros < 0 ||
      dado.data.some((r) => typeof r.numeroControlePNCP !== "string" || !r.numeroControlePNCP)) {
    throw new Error("Resposta com paginação/identificação inválida.");
  }
  return dado;
}

async function recuperarUf({ diretorio, uf, buscarPagina, estado, salvarManifesto }) {
  let primeira;
  let totalPaginas = 1;
  const ids = new Set();
  estado.paginasSalvas = 0;
  for (let numero = 1; numero <= Math.max(1, totalPaginas); numero += 1) {
    const caminho = path.join(diretorio, `${uf}-${String(numero).padStart(4, "0")}.json`);
    const existente = await lerJson(caminho);
    const dado = validarPagina(existente || await buscarPagina(uf, numero), numero);
    if (!primeira) { primeira = dado; totalPaginas = dado.totalPaginas; }
    if (dado.totalPaginas !== totalPaginas || dado.totalRegistros !== primeira.totalRegistros) {
      throw new Error("Paginação da fonte mudou durante a recuperação. Recomece em outra pasta.");
    }
    if (!existente) await gravarJson(caminho, dado);
    for (const item of dado.data) ids.add(item.numeroControlePNCP);
    Object.assign(estado, { paginasSalvas: numero, totalPaginas, registrosUnicos: ids.size, totalEsperado: primeira.totalRegistros });
    await salvarManifesto();
  }
  if (ids.size !== primeira.totalRegistros) throw new Error("Contagem divergente ou registros duplicados; cobertura não confirmada.");
  const conferida = validarPagina(await buscarPagina(uf, 1), 1);
  // A fonte pode reordenar propriedades JSON; cobertura compara identidades e ordem dos registros.
  const identidades = (dado) => JSON.stringify(dado.data.map((item) => item.numeroControlePNCP));
  if (conferida.totalPaginas !== primeira.totalPaginas || conferida.totalRegistros !== primeira.totalRegistros ||
      identidades(conferida) !== identidades(primeira)) {
    throw new Error("Primeira página mudou durante a recuperação. Recomece em outra pasta.");
  }
  Object.assign(estado, { status: "concluida", conferidoEm: new Date().toISOString() });
  delete estado.erro;
}

function validarOpcoes({ diretorio, ufs, dataFinal, intervaloMs }) {
  if (!diretorio || !path.isAbsolute(diretorio) || !Array.isArray(ufs) || !ufs.length ||
      ufs.some((uf) => !UFS.includes(uf)) || new Set(ufs).size !== ufs.length || !/^\d{8}$/.test(dataFinal) ||
      !Number.isFinite(intervaloMs) || intervaloMs < 0) throw new Error("Informe pasta absoluta isolada, UFs válidas e dataFinal YYYYMMDD.");
  const raizRepositorio = path.resolve(__dirname, "..").toLowerCase();
  const destino = path.resolve(diretorio).toLowerCase();
  if (destino.startsWith(`${raizRepositorio}${path.sep}`) || destino === raizRepositorio) {
    throw new Error("Use uma pasta isolada fora do repositório; esta rotina não publica dados.");
  }
}

async function abrirTrava(diretorio) {
  try { return await fs.open(path.join(diretorio, "recuperacao.lock"), "wx"); }
  catch (erro) {
    if (erro.code === "EEXIST") throw new Error("Existe recuperacao.lock. Confira o PID da trava; só remova se a execução tiver terminado (docs/qa/recuperacao-cobertura-local.md).");
    throw erro;
  }
}

async function recuperarCoberturaLocal({ diretorio, ufs, dataFinal, intervaloMs = 7000, buscarPagina }) {
  validarOpcoes({ diretorio, ufs, dataFinal, intervaloMs });
  await fs.mkdir(diretorio, { recursive: true });
  const caminho = path.join(diretorio, "manifesto.json");
  const consulta = { fonte: "PNCP contratacoes/proposta", dataFinal, tamanhoPagina: 50, ufs };
  const manifesto = await lerJson(caminho) || { consulta, iniciadoEm: new Date().toISOString(), destino: "somente-local", ufs: {} };
  if (JSON.stringify(manifesto.consulta) !== JSON.stringify(consulta)) throw new Error("Pasta já pertence a outra consulta.");
  if (Date.now() - Date.parse(manifesto.iniciadoEm) > 6 * 60 * 60 * 1000) throw new Error("Consulta antiga: use outra pasta para não juntar páginas de dias diferentes.");
  const trava = await abrirTrava(diretorio);
  try {
    await trava.writeFile(JSON.stringify({ pid: process.pid, iniciadoEm: new Date().toISOString() }));
    const salvarManifesto = async () => { manifesto.atualizadoEm = new Date().toISOString(); await gravarJson(caminho, manifesto); };
    for (const uf of ufs) manifesto.ufs[uf] ||= { status: "pendente", paginasSalvas: 0 };
    await salvarManifesto();
    let proximaChamada = 0;
    async function cadencia() {
      const espera = Math.max(0, proximaChamada - Date.now());
      if (espera) await new Promise((r) => setTimeout(r, espera));
      proximaChamada = Date.now() + intervaloMs;
    }
    const buscar = buscarPagina || ((uf, pagina) => fetchComRetentativa(
      `https://pncp.gov.br/api/consulta/v1/contratacoes/proposta?uf=${uf}&dataFinal=${dataFinal}&pagina=${pagina}&tamanhoPagina=50`,
      4, 25000, `recuperação local ${uf} p${pagina}`, cadencia));
    for (const uf of ufs) {
      const estado = manifesto.ufs[uf];
      if (estado.status === "concluida") continue;
      try {
        await recuperarUf({ diretorio, uf, buscarPagina: buscar, estado, salvarManifesto });
        console.log(`[recuperação local] ${uf}: ${estado.registrosUnicos} registros, ${estado.paginasSalvas} páginas conferidas.`);
      } catch (erro) {
        Object.assign(estado, { status: "pendente", erro: erro.message });
        await salvarManifesto();
        break; // Evita insistir nas demais UFs quando a fonte começa a recusar a origem.
      }
      await salvarManifesto();
    }
    return manifesto;
  } finally {
    await trava.close();
    await fs.unlink(path.join(diretorio, "recuperacao.lock"));
  }
}

module.exports = { recuperarCoberturaLocal };

if (require.main === module) {
  const [diretorio, listaUfs, dataFinal] = process.argv.slice(2);
  recuperarCoberturaLocal({ diretorio, ufs: listaUfs?.split(","), dataFinal }).then((resultado) => {
    const pendentes = Object.entries(resultado.ufs).filter(([, estado]) => estado.status !== "concluida");
    console.log(JSON.stringify({ destino: resultado.destino, concluidas: Object.keys(resultado.ufs).length - pendentes.length,
      pendentes: pendentes.map(([uf]) => uf), erros: pendentes.filter(([, estado]) => estado.erro).map(([uf, estado]) => ({ uf, erro: estado.erro })) }));
    if (pendentes.length) process.exitCode = 1;
  }).catch((erro) => { console.error(erro.message); process.exitCode = 1; });
}
