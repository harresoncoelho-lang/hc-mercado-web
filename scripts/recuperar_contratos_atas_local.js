// Respostas públicas em disco isolado; não lê chaves nem sincroniza Supabase.
// Uso: node scripts/recuperar_contratos_atas_local.js PASTA MERCADO INICIO FIM DATA [IDS | --historico SNAPSHOT_ANTERIOR]
// Sob demanda: mesmos cinco argumentos, depois --catalogo PASTA_HISTORICO IDS (separados por vírgula).
// Detalhes certificados: mesmos cinco argumentos, depois --detalhes ORIGEM ARQUIVO_IDS_JSON (array de IDs).
// --detalhes usa 7 s, no máximo 350 chamadas por rodada e não renova compras parciais vencidas.
// Opcional: RECUPERACAO_MAX_CHAMADAS=350 (mínimo 5 no histórico, 2 nos detalhes) por rodada.
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { fetchComRetentativa } = require("./atualizar_dados");
const hash = (v) => createHash("sha256").update(v).digest("hex");
const origem = "https://pncp.gov.br";
const validadeSnapshotMs = 6 * 3600000;
async function ler(arquivo) {
  try { return JSON.parse(await fs.readFile(arquivo, "utf8")); }
  catch (e) { if (e.code === "ENOENT") return null; throw e; }
}
async function gravar(arquivo, valor) {
  await fs.writeFile(`${arquivo}.tmp`, JSON.stringify(valor));
  await fs.rename(`${arquivo}.tmp`, arquivo);
}
function exigir(ok, mensagem) { if (!ok) throw new Error(mensagem); }
function lista(dado) {
  if (Array.isArray(dado)) return dado;
  if (dado && Array.isArray(dado.data) && dado.totalPaginas === 0 && dado.data.length === 0 && (dado.totalRegistros === undefined || dado.totalRegistros === 0)) return [];
  throw new Error("Lista PNCP inválida ou paginação não reconhecida.");
}
function validarContratos(dado, numero, identidade = "numeroControlePNCP") {
  exigir(dado && Array.isArray(dado.data) && Number.isSafeInteger(dado.totalPaginas) && dado.totalPaginas >= 0, "Página de contratos inválida.");
  if (dado.totalPaginas === 0) {
    exigir(dado.data.length === 0 && (!dado.totalRegistros || dado.totalRegistros === 0), "Vazio contraditório.");
    return { ...dado, totalRegistros: 0, numeroPagina: numero };
  }
  exigir(dado.numeroPagina === numero && Number.isSafeInteger(dado.totalRegistros) && dado.totalRegistros >= 0, "Paginação de contratos inválida.");
  exigir(dado.data.every((r) => typeof r[identidade] === "string" && r[identidade]), "Registro sem identidade.");
  return dado;
}
function validarPaginaCatalogo(dado, numero) {
  const pagina = validarContratos(dado, numero, "numeroControlePNCPAta");
  exigir(pagina.totalPaginas === Math.ceil(pagina.totalRegistros / 500) && numero <= Math.max(1, pagina.totalPaginas), "Metadados de paginação do catálogo incompatíveis.");
  exigir(pagina.data.length === Math.min(500, Math.max(0, pagina.totalRegistros - (numero - 1) * 500)), "Quantidade da página do catálogo incompatível com o total.");
  return pagina;
}
async function revalidarCatalogo({ estado, buscarPagina, lerPagina, salvar }, motivo, minimo = estado.totalEsperado) {
  const numeros = [...new Set([1, estado.paginas])], verificacoes = [];
  let total, totalPaginas, extensao = false;
  for (const n of numeros) {
    const anterior = await lerPagina(n), atual = await buscarPagina(n);
    total ??= atual.dado.totalRegistros; totalPaginas ??= atual.dado.totalPaginas;
    exigir(atual.dado.totalRegistros === total && atual.dado.totalPaginas === totalPaginas, "Totais das fronteiras do catálogo divergiram.");
    exigir(total >= minimo, "Total do catálogo diminuiu durante revalidação.");
    const iguais = isDeepStrictEqual(anterior.data, atual.dado.data);
    const cresceuCauda = n === estado.paginas && anterior.data.length < 500 && atual.dado.data.length > anterior.data.length && isDeepStrictEqual(anterior.data, atual.dado.data.slice(0, anterior.data.length));
    exigir(iguais || cresceuCauda, n === 1 ? "Primeira página do catálogo mudou." : "Registros da fronteira do catálogo mudaram.");
    extensao ||= cresceuCauda;
    verificacoes.push({ pagina: n, arquivo: atual.arquivo, sha256: atual.sha256, recebidoEm: atual.recebidoEm, extensao: cresceuCauda });
  }
  const conferidoEm = new Date(Date.now()).toISOString();
  const observacao = { motivo, conferidoEm, totalAnterior: estado.totalEsperado, totalObservado: total, totalPaginas, verificacoes };
  estado.ancoras.push(observacao);
  if (total !== estado.totalEsperado || extensao) estado.observacoes.push(observacao);
  const cresceu = total > estado.totalEsperado || extensao;
  Object.assign(estado, { totalEsperado: total, totalPaginas, revalidadoEm: conferidoEm });
  if (motivo !== "final") for (const v of verificacoes) if (v.extensao) estado.paginasAceitas[v.pagina] = v;
  await salvar();
  exigir(motivo !== "final" || !cresceu, "Catálogo cresceu na conferência final; último trecho pendente para retomada.");
}
function incluirReferenciasCatalogo(dado, referencias, compras, referenciasOriginais) {
  for (const ata of dado.data) {
    rotaAta(ata);
    exigir(!referencias.has(ata.numeroControlePNCPAta), "Ata duplicada entre páginas da descoberta.");
    const anterior = referenciasOriginais.get(ata.numeroControlePNCPAta);
    exigir(!anterior || anterior.numeroControlePNCPCompra === ata.numeroControlePNCPCompra, "Compra da ata mudou entre fontes.");
    referencias.add(ata.numeroControlePNCPAta); compras.add(ata.numeroControlePNCPCompra);
  }
}
async function descobrirAtas({ buscar, estado, salvar, gravarArtefato, lerArtefato, referenciasOriginais, inicio, fim }) {
  estado.snapshot ||= new Date().toISOString();
  estado.paginasAceitas ||= {}; estado.observacoes ||= []; estado.ancoras ||= [];
  const rota = (n) => `/api/consulta/v1/atas?dataInicial=${inicio}&dataFinal=${fim}&pagina=${n}&tamanhoPagina=500`;
  const buscarPagina = async (n) => {
    const resposta = await buscar(rota(n), true, estado.snapshot, true);
    return { ...resposta, dado: validarPaginaCatalogo(resposta.dado, n) };
  };
  const lerPagina = async (n) => validarPaginaCatalogo((await lerArtefato(estado.paginasAceitas[n].arquivo)).dado, n);
  for (let n = 1; n <= (estado.paginas || 0); n++) estado.paginasAceitas[n] ||= { pagina: n, arquivo: `resposta-${hash(estado.snapshot + rota(n))}.json` };
  if (estado.paginas) {
    estado.totalInicial ??= (await lerPagina(1)).totalRegistros;
    await revalidarCatalogo({ estado, buscarPagina, lerPagina, salvar }, "retomada");
  }
  const referencias = new Set(), compras = new Set();
  for (let n = 1; n <= (estado.paginas || 0); n++) incluirReferenciasCatalogo(await lerPagina(n), referencias, compras, referenciasOriginais);
  estado.registros = referencias.size;
  for (let n = (estado.paginas || 0) + 1; n <= Math.max(1, estado.totalPaginas || 1); n++) {
    exigir(!estado.revalidadoEm || Date.now() - Date.parse(estado.revalidadoEm) <= validadeSnapshotMs, "Validação do catálogo venceu; retome para revalidar fronteiras sem descartar páginas.");
    const resposta = await buscarPagina(n), dado = resposta.dado;
    if (estado.totalInicial === undefined) Object.assign(estado, { totalInicial: dado.totalRegistros, totalEsperado: dado.totalRegistros, totalPaginas: dado.totalPaginas, revalidadoEm: new Date(Date.now()).toISOString() });
    exigir(dado.totalRegistros >= estado.totalEsperado, "Total do catálogo diminuiu durante paginação.");
    if (dado.totalRegistros > estado.totalEsperado) await revalidarCatalogo({ estado, buscarPagina, lerPagina, salvar }, "crescimento", dado.totalRegistros);
    exigir(dado.data.length === 500 || dado.totalRegistros === estado.totalEsperado, "Crescimento durante a leitura da última página; revalidar página pendente na retomada.");
    incluirReferenciasCatalogo(dado, referencias, compras, referenciasOriginais);
    estado.paginasAceitas[n] = { pagina: n, arquivo: resposta.arquivo, sha256: resposta.sha256, recebidoEm: resposta.recebidoEm };
    Object.assign(estado, { paginas: n, registros: referencias.size });
    await salvar();
  }
  await revalidarCatalogo({ estado, buscarPagina, lerPagina, salvar }, "final");
  exigir(referencias.size === estado.totalEsperado, "Contagem da descoberta divergente; catálogo permanece pendente.");
  const catalogo = `catalogo-${hash(estado.snapshot + rota(1))}.json`, conferidoEm = new Date().toISOString();
  const limite = "Cobertura observada: páginas percorridas, sem duplicações observadas, contagens conciliadas e verificações de estabilidade. API sem snapshot transacional ou garantia de ordenação; não prova ausência de omissões num instante.";
  await gravarArtefato(catalogo, { inicio, fim, inicioLeitura: estado.snapshot, conferidoEm, totalInicial: estado.totalInicial, registros: referencias.size, compras: compras.size, paginas: Object.values(estado.paginasAceitas), observacoes: estado.observacoes, ancoras: estado.ancoras, limite });
  Object.assign(estado, { status: "concluida-local", conferidoEm, catalogo, compras: compras.size, limite });
}
async function contratos({ buscar, estado, salvar, inicio, fim }) {
  let primeira;
  const ids = new Set();
  const rota = (n) => `/api/consulta/v1/contratos?dataInicial=${inicio}&dataFinal=${fim}&pagina=${n}&tamanhoPagina=500`;
  for (let n = 1; n <= Math.max(1, primeira?.totalPaginas || 1); n++) {
    const dado = validarContratos(await buscar(rota(n)), n);
    primeira ||= dado;
    exigir(dado.totalPaginas === primeira.totalPaginas && dado.totalRegistros === primeira.totalRegistros, "Total de contratos mudou; use pasta nova.");
    for (const item of dado.data) { exigir(!ids.has(item.numeroControlePNCP), "Contrato duplicado entre páginas."); ids.add(item.numeroControlePNCP); }
    Object.assign(estado, { paginas: n, totalPaginas: primeira.totalPaginas, registros: ids.size, totalEsperado: primeira.totalRegistros });
    await salvar();
  }
  exigir(ids.size === primeira.totalRegistros, "Contagem de contratos divergente.");
  const conferida = validarContratos(await buscar(rota(1), true), 1);
  exigir(conferida.totalPaginas === primeira.totalPaginas && conferida.totalRegistros === primeira.totalRegistros && JSON.stringify(conferida.data.map((r) => r.numeroControlePNCP)) === JSON.stringify(primeira.data.map((r) => r.numeroControlePNCP)), "Primeira página mudou; use pasta nova.");
  Object.assign(estado, { status: "concluida-local", conferidoEm: new Date().toISOString() });
  delete estado.erro;
}
function partes(compra) {
  const match = /^(\d{14})-1-(\d+)\/(\d{4})$/.exec(compra);
  exigir(match, "Identidade de compra inválida.");
  return `${match[1]}/compras/${match[3]}/${Number(match[2])}`;
}
function rotaAta(ata) {
  const id = ata.numeroControlePNCPAta, seq = Number(id.slice(id.lastIndexOf("-") + 1));
  exigir(Number.isSafeInteger(seq) && seq > 0 && id.startsWith(`${ata.numeroControlePNCPCompra}-`), "Referência da ata inválida.");
  return `/api/pncp/v1/orgaos/${partes(ata.numeroControlePNCPCompra)}/atas/${seq}`;
}
async function recuperarCompra({ referencia, buscar, gravarArtefato, estado, salvar }) {
  const id = referencia.numeroControlePNCPCompra;
  const base = `/api/pncp/v1/orgaos/${partes(id)}`;
  const compra = await buscar(`/api/consulta/v1/orgaos/${partes(id)}`);
  exigir(compra?.numeroControlePNCP === id, "Compra retornada não corresponde à referência.");
  const itens = [], numeros = new Set();
  let primeira;
  const rota = (n) => `${base}/itens?pagina=${n}&tamanhoPagina=100`;
  for (let n = 1; ; n++) {
    const lote = lista(await buscar(rota(n)));
    primeira ||= lote;
    exigir(lote.length <= 100, "Fonte ignorou tamanho da página de itens.");
    for (const item of lote) {
      exigir(Number.isSafeInteger(item.numeroItem) && item.numeroItem > 0 && !numeros.has(item.numeroItem), "Item sem número ou repetido; paginação não comprovada.");
      numeros.add(item.numeroItem); itens.push(item);
    }
    Object.assign(estado, { paginasItens: n, itens: itens.length }); await salvar();
    if (lote.length < 100) break;
  }
  const conferida = lista(await buscar(rota(1), true));
  exigir(JSON.stringify(conferida.map((i) => i.numeroItem)) === JSON.stringify(primeira.map((i) => i.numeroItem)), "Itens mudaram durante paginação; use pasta nova.");
  const resultadosPorItem = [];
  for (const item of itens) {
    const resultados = lista(await buscar(`${base}/itens/${item.numeroItem}/resultados`));
    exigir(resultados.every((r) => r.numeroItem === item.numeroItem && r.numeroControlePNCPCompra === id), "Resultado associado a outro item/compra.");
    resultadosPorItem.push({ item, resultados });
    estado.itensComResultadoConsultado = resultadosPorItem.length; await salvar();
  }
  await gravarArtefato(`compra-${hash(id)}.json`, { consulta: id, compra, resultadosPorItem, marca: "não consultada", limite: "Resultados da compra; vínculo de cada vencedor à ata não inferido." });
  Object.assign(estado, { status: "concluida-local", conferidoEm: new Date().toISOString() }); delete estado.erro;
}
function validarDestino(diretorio) {
  exigir(diretorio && path.isAbsolute(diretorio), "Pasta absoluta obrigatória.");
  const raiz = path.resolve(__dirname, "..").toLowerCase(), destino = path.resolve(diretorio).toLowerCase();
  exigir(destino !== raiz && !destino.startsWith(raiz + path.sep), "Pasta deve ficar fora do repositório.");
}
async function validarArtefatos(diretorio, arquivos) {
  exigir(arquivos && typeof arquivos === "object", "Manifesto sem inventário de integridade.");
  for (const [nome, esperado] of Object.entries(arquivos)) {
    exigir(/^(resposta|compra|catalogo)-[a-f0-9]{64}\.json$/.test(nome), "Nome de artefato inválido.");
    const bytes = await fs.readFile(path.join(diretorio, nome));
    exigir(hash(bytes) === esperado, `Artefato alterado: ${nome}.`);
  }
}
async function prepararConsulta({ diretorio, mercado, inicio, fim, referencia, buscarRemoto, intervaloMs, maxChamadas, ataIds, historico, snapshotAnterior, catalogo }) {
  validarDestino(diretorio);
  exigir(/^\d{8}$/.test(inicio) && /^\d{8}$/.test(fim) && inicio <= fim && /^\d{4}-\d{2}-\d{2}$/.test(referencia), "Datas inválidas.");
  const minimoChamadas = historico ? 5 : 2;
  exigir(Number.isInteger(maxChamadas) && maxChamadas >= minimoChamadas, `Orçamento inválido: use no mínimo ${minimoChamadas} chamadas por rodada para avançar após a reconferência.`);
  exigir(Number.isFinite(intervaloMs) && intervaloMs >= (buscarRemoto ? 0 : 7000), "Cadência inválida.");
  exigir(Array.isArray(mercado?.filaPendente), "Fila de atas ausente.");
  const referenciasCatalogo = catalogo ? await selecionarCatalogo(catalogo, mercado, ataIds) : [];
  const fila = [...mercado.filaPendente, ...referenciasCatalogo.filter((a) => !mercado.filaPendente.some((r) => r.numeroControlePNCPAta === a.numeroControlePNCPAta))];
  exigir(fila.every((a) => typeof a.numeroControlePNCPAta === "string") && new Set(fila.map((a) => a.numeroControlePNCPAta)).size === fila.length, "Fila de atas duplicada/inválida.");
  const selecionadas = ataIds || fila.filter((a) => historico || a.vigenciaFim >= referencia).map((a) => a.numeroControlePNCPAta);
  exigir(Array.isArray(selecionadas) && new Set(selecionadas).size === selecionadas.length && selecionadas.every((id) => fila.some((a) => a.numeroControlePNCPAta === id)), "Seleção de atas inválida.");
  const consulta = { fonte: "PNCP contratos e itens/resultados de compras das atas", inicio, fim, referencia, mercadoHash: hash(JSON.stringify(mercado)), selecionadas };
  if (catalogo) {
    exigir(!historico && path.resolve(catalogo) !== path.resolve(diretorio), "Catálogo deve ficar em outra pasta, sem modo histórico simultâneo.");
    consulta.catalogoOrigem = path.resolve(catalogo);
  }
  if (historico) {
    validarDestino(snapshotAnterior);
    exigir(path.resolve(snapshotAnterior) !== path.resolve(diretorio), "Origem e destino devem ser diferentes.");
    exigir(!ataIds && Array.isArray(mercado.janelasPendentes), "Histórico exige fila completa e janelas explícitas.");
    exigir(mercado.janelasPendentes.every((j) => /^\d{8}$/.test(j.inicio) && /^\d{8}$/.test(j.fim) && j.inicio <= j.fim), "Janela histórica inválida.");
    Object.assign(consulta, { historico: true, snapshotAnterior: path.resolve(snapshotAnterior) });
  }
  if (!historico && !catalogo && snapshotAnterior !== undefined) {
    exigir(Array.isArray(ataIds) && ataIds.length > 0, "Seleção explícita obrigatória para reutilizar origem certificada.");
    validarDestino(snapshotAnterior);
    exigir(path.resolve(snapshotAnterior) !== path.resolve(diretorio), "Origem e destino devem ser diferentes.");
    Object.assign(consulta, { detalhes: true, snapshotAnterior: path.resolve(snapshotAnterior) });
  }
  return { fila, selecionadas, consulta, origemCertificados: catalogo || snapshotAnterior, modoRetomavel: historico || Boolean(catalogo) || consulta.detalhes === true };
}
async function selecionarCatalogo(diretorio, mercado, ids) {
  validarDestino(diretorio);
  exigir(Array.isArray(ids) && ids.length > 0 && new Set(ids).size === ids.length, "Seleção de IDs do catálogo inválida.");
  const m = await ler(path.join(diretorio, "manifesto.json"));
  exigir(m?.concluidaSelecao && m.consulta.historico && m.consulta.mercadoHash === hash(JSON.stringify(mercado)), "Catálogo histórico não concluído ou de outra fila.");
  await validarArtefatos(diretorio, m.arquivos);
  const arquivoOrigem = await fs.readFile(path.join(m.importacao.diretorio, "manifesto.json"));
  exigir(hash(arquivoOrigem) === m.importacao.manifestoHash, "Manifesto de origem do catálogo alterado.");
  await validarArtefatos(m.importacao.diretorio, JSON.parse(arquivoOrigem).arquivos);
  const referencias = new Map(mercado.filaPendente.filter((a) => ids.includes(a.numeroControlePNCPAta)).map((a) => [a.numeroControlePNCPAta, a]));
  for (const estado of Object.values(m.descobertas)) {
    exigir(estado.status === "concluida-local" && m.arquivos[estado.catalogo], "Catálogo sem certificado de integridade.");
    const catalogo = await ler(path.join(diretorio, estado.catalogo));
    for (const pagina of catalogo.paginas) {
      exigir(m.arquivos[pagina.arquivo], "Página não consta do certificado do catálogo.");
      const resposta = await ler(path.join(diretorio, pagina.arquivo));
      for (const ata of resposta.dado.data) if (ids.includes(ata.numeroControlePNCPAta)) {
        rotaAta(ata);
        const anterior = referencias.get(ata.numeroControlePNCPAta);
        exigir(!anterior || anterior.numeroControlePNCPCompra === ata.numeroControlePNCPCompra, "Compra da ata mudou entre fontes.");
        referencias.set(ata.numeroControlePNCPAta, ata);
      }
    }
  }
  exigir(ids.every((id) => referencias.has(id)), "ID ausente do catálogo e da fila original.");
  return [...referencias.values()];
}
async function importarCertificados(m, diretorio, consulta) {
  const arquivo = await fs.readFile(path.join(diretorio, "manifesto.json"));
  const anterior = JSON.parse(arquivo);
  exigir(anterior.concluidaSelecao && anterior.contratos.status === "concluida-local" && anterior.consulta.mercadoHash === consulta.mercadoHash && anterior.consulta.inicio === consulta.inicio && anterior.consulta.fim === consulta.fim, "Origem não certifica a mesma consulta/fila.");
  await validarArtefatos(diretorio, anterior.arquivos);
  const manifestoHash = hash(arquivo);
  exigir(!m.importacao || m.importacao.manifestoHash === manifestoHash, "Manifesto de origem alterado.");
  if (m.importacao) return;
  m.importacao = { diretorio: path.resolve(diretorio), manifestoHash, conferidoEm: new Date().toISOString() };
  m.contratos = { ...anterior.contratos, origem: anterior.contratos.origem || m.importacao.diretorio };
  for (const [id, estado] of Object.entries(anterior.atas)) {
    if (estado.status === "concluida-local" && m.atas[id]) m.atas[id] = { ...estado, selecionada: m.atas[id].selecionada, origem: estado.origem || m.importacao.diretorio };
  }
  for (const [id, estado] of Object.entries(anterior.compras)) {
    if (estado.status === "concluida-local") m.compras[id] = { ...estado, origem: estado.origem || m.importacao.diretorio };
  }
}
function buscarNoSnapshot(estado, buscar, renovarParciais) {
  if (!estado.snapshot || Date.now() - Date.parse(estado.snapshot) > validadeSnapshotMs) {
    exigir(!estado.snapshot || renovarParciais, "Snapshot parcial venceu; encadeamento exige revalidação coordenada, sem renovar páginas automaticamente.");
    for (const chave of Object.keys(estado)) delete estado[chave];
    Object.assign(estado, { status: "pendente", snapshot: new Date().toISOString() });
  }
  const snapshot = estado.snapshot;
  return (rota, conferir) => {
    exigir(Date.now() - Date.parse(snapshot) <= validadeSnapshotMs, "Snapshot parcial venceu; retome para iniciar somente esta unidade novamente.");
    return buscar(rota, conferir, snapshot);
  };
}
async function recuperarAtas({ fila, selecionadas, historico, modoRetomavel, renovarParciais, mercado, m, buscar, gravarArtefato, lerArtefato, salvar }) {
  const referencias = new Map(fila.filter((a) => selecionadas.includes(a.numeroControlePNCPAta)).map((a) => [a.numeroControlePNCPAta, a]));
  if (historico) {
    m.descobertas ||= {};
    for (const janela of mercado.janelasPendentes) {
      const estado = m.descobertas[`${janela.inicio}-${janela.fim}`] ||= { status: "pendente" };
      if (estado.status !== "concluida-local") await descobrirAtas({ ...janela, buscar, estado, salvar, gravarArtefato, lerArtefato, referenciasOriginais: referencias });
      exigir(estado.catalogo, "Catálogo certificado ausente.");
      await salvar();
    }
  }
  for (const [id, a] of referencias) m.atas[id] ||= { status: "pendente", compra: a.numeroControlePNCPCompra, selecionada: true };
  await salvar();
  for (const [id, a] of referencias) {
    const estado = m.atas[id];
    if (estado.status === "concluida-local") continue;
    const ata = await buscar(rotaAta(a));
    exigir(ata?.numeroControlePNCP === id && ata.numeroControlePncpCompra === a.numeroControlePNCPCompra, "Ata retornada não corresponde à referência.");
    const compraEstado = m.compras[a.numeroControlePNCPCompra] ||= { status: "pendente" };
    if (compraEstado.status !== "concluida-local") await recuperarCompra({ referencia: a, buscar: modoRetomavel ? buscarNoSnapshot(compraEstado, buscar, renovarParciais) : buscar, gravarArtefato, estado: compraEstado, salvar });
    Object.assign(estado, { status: "concluida-local", vigenciaFimFonte: ata.dataVigenciaFim, canceladoFonte: ata.cancelado, conferidoEm: new Date().toISOString() });
    await salvar();
  }
}
async function recuperar({ diretorio, mercado, inicio, fim, referencia, buscarRemoto, intervaloMs = 7000, maxChamadas = 350, ataIds, historico = false, snapshotAnterior, catalogo, renovarParciais = true }) {
  const { fila, selecionadas, consulta, origemCertificados, modoRetomavel } = await prepararConsulta({ diretorio, mercado, inicio, fim, referencia, buscarRemoto, intervaloMs, maxChamadas, ataIds, historico, snapshotAnterior, catalogo });
  await fs.mkdir(diretorio, { recursive: true });
  const lock = path.join(diretorio, "recuperacao.lock");
  let trava;
  try { trava = await fs.open(lock, "wx"); } catch (e) { if (e.code === "EEXIST") throw new Error("Recuperação já travada; confira PID antes de retomar."); throw e; }
  try {
    await trava.writeFile(JSON.stringify({ pid: process.pid, iniciadoEm: new Date().toISOString() }));
    const manifestoPath = path.join(diretorio, "manifesto.json");
    const m = await ler(manifestoPath) || { consulta, iniciadoEm: new Date().toISOString(), destino: "somente-local", contratos: { status: "pendente" }, compras: {}, atas: {}, arquivos: {} };
    exigir(JSON.stringify(m.consulta) === JSON.stringify(consulta), "Pasta pertence a outra consulta.");
    exigir(Number.isFinite(Date.parse(m.iniciadoEm)) && (modoRetomavel || Date.now() - Date.parse(m.iniciadoEm) <= validadeSnapshotMs), "Checkpoint antigo; use pasta nova.");
    for (const a of fila) m.atas[a.numeroControlePNCPAta] ||= { status: "pendente", compra: a.numeroControlePNCPCompra, selecionada: selecionadas.includes(a.numeroControlePNCPAta) };
    await gravar(path.join(diretorio, "fila-origem-mercado.json"), mercado);
    const salvar = async () => { m.atualizadoEm = new Date().toISOString(); await gravar(manifestoPath, m); };
    try {
      await validarArtefatos(diretorio, m.arquivos);
      if (modoRetomavel) await importarCertificados(m, origemCertificados, consulta);
    } catch (e) {
      m.concluidaSelecao = false; m.erro = `Integridade local não confirmada: ${e.message}`; await salvar(); return m;
    }
    const gravarArtefato = async (nome, valor) => {
      await gravar(path.join(diretorio, nome), valor);
      m.arquivos[nome] = hash(JSON.stringify(valor));
    };
    const lerArtefato = async (nome) => {
      exigir(m.arquivos[nome], "Página ausente do inventário de integridade.");
      const bytes = await fs.readFile(path.join(diretorio, nome));
      exigir(hash(bytes) === m.arquivos[nome], "Página do catálogo alterada.");
      return JSON.parse(bytes);
    };
    await salvar();
    // A espera inicial também protege a fronteira com a última tentativa da rodada anterior.
    let chamadas = 0, proxima = Date.now() + intervaloMs;
    const cadencia = async () => {
      exigir(chamadas < maxChamadas, "Orçamento de chamadas atingido; páginas preservadas para retomada.");
      const espera = Math.max(0, proxima - Date.now()); if (espera) await new Promise((r) => setTimeout(r, espera));
      chamadas++; proxima = Date.now() + intervaloMs;
    };
    const buscar = async (rota, conferir = false, snapshot = "", comEvidencia = false) => {
      exigir(/^\/api\/(consulta|pncp)\/v1\//.test(rota), "Rota pública não permitida.");
      const arquivo = path.join(diretorio, `resposta-${hash(snapshot + rota)}.json`);
      const cache = await ler(arquivo);
      if (cache) {
        exigir(cache.rota === rota && cache.hash === hash(JSON.stringify(cache.dado)), "Cache corrompido.");
        m.arquivos[path.basename(arquivo)] = hash(JSON.stringify(cache));
      }
      if (cache && !conferir) return comEvidencia ? { dado: cache.dado, arquivo: path.basename(arquivo), recebidoEm: cache.recebidoEm, sha256: m.arquivos[path.basename(arquivo)] } : cache.dado;
      exigir(chamadas < maxChamadas, "Orçamento de chamadas atingido; páginas preservadas para retomada.");
      let dado;
      if (buscarRemoto) { await cadencia(); dado = await buscarRemoto(origem + rota); }
      // A página inicial do catálogo histórico respondeu em 47 s no diagnóstico local.
      else dado = await fetchComRetentativa(origem + rota, Math.min(4, maxChamadas - chamadas), historico === true && rota.startsWith("/api/consulta/v1/atas?") ? 60000 : 25000, "recuperação contratos/atas", cadencia);
      if (dado === null && chamadas >= maxChamadas) throw new Error("Orçamento de chamadas atingido sem resposta válida; retome depois.");
      exigir(dado !== null && dado !== undefined, "Fonte indisponível; recuperação interrompida sem perder páginas.");
      // Revalidações preservam a resposta inicial e sua própria evidência.
      const nome = conferir ? `resposta-${hash(`${snapshot}${rota}${new Date().toISOString()}`)}.json` : path.basename(arquivo);
      const recebidoEm = new Date().toISOString();
      await gravarArtefato(nome, { rota, recebidoEm, hash: hash(JSON.stringify(dado)), dado, ...(conferir ? { conferencia: true } : {}) });
      return comEvidencia ? { dado, arquivo: nome, recebidoEm, sha256: m.arquivos[nome] } : dado;
    };
    try {
      if (m.contratos.status !== "concluida-local") await contratos({ buscar, estado: m.contratos, salvar, inicio, fim });
      await salvar();
      await recuperarAtas({ fila, selecionadas, historico, modoRetomavel, renovarParciais, mercado, m, buscar, gravarArtefato, lerArtefato, salvar });
      delete m.erro;
    } catch (e) { m.erro = e.message; }
    m.chamadasNestaExecucao = chamadas;
    const descobertaCompleta = !historico || mercado.janelasPendentes.every((j) => m.descobertas?.[`${j.inicio}-${j.fim}`]?.status === "concluida-local");
    m.concluidaSelecao = !m.erro && descobertaCompleta && m.contratos.status === "concluida-local" && Object.values(m.atas).filter((a) => a.selecionada).every((a) => a.status === "concluida-local");
    m.atasPendentes = Object.values(m.atas).filter((a) => a.status !== "concluida-local").length;
    await salvar(); return m;
  } finally { await trava.close(); await fs.unlink(lock); }
}
async function lerOpcoesCli(args, ambiente = process.env) {
  const [diretorio, arquivoMercado, inicio, fim, referencia, listaAtas, snapshotAnterior, idsCatalogo] = args;
  const maxChamadas = Number(ambiente.RECUPERACAO_MAX_CHAMADAS || 350);
  if (listaAtas === "--detalhes") {
    exigir(args.length === 8 && snapshotAnterior && idsCatalogo, "Uso: PASTA MERCADO INICIO FIM DATA --detalhes ORIGEM ARQUIVO_IDS_JSON.");
    exigir(Number.isInteger(maxChamadas) && maxChamadas >= 2 && maxChamadas <= 350, "Orçamento de detalhes deve ficar entre 2 e 350 chamadas.");
    const ataIds = await ler(idsCatalogo);
    exigir(Array.isArray(ataIds) && ataIds.length > 0 && ataIds.every((id) => typeof id === "string" && id.length > 0) && new Set(ataIds).size === ataIds.length, "Seleção explícita inválida no arquivo de IDs.");
    return { diretorio, mercado: await ler(arquivoMercado), inicio, fim, referencia, maxChamadas, intervaloMs: 7000, ataIds, snapshotAnterior, renovarParciais: false };
  }
  const selecao = listaAtas === "--catalogo" ? { catalogo: snapshotAnterior, ataIds: idsCatalogo?.split(",") } : listaAtas === "--historico" ? { historico: true, snapshotAnterior } : listaAtas ? { ataIds: listaAtas.split(",") } : {};
  return { diretorio, mercado: await ler(arquivoMercado), inicio, fim, referencia, maxChamadas, ...selecao };
}
module.exports = { recuperar, lerOpcoesCli };
if (require.main === module) {
  lerOpcoesCli(process.argv.slice(2)).then(recuperar).then((m) => {
    console.log(JSON.stringify({ concluidaSelecao: m.concluidaSelecao, contratos: m.contratos, compras: m.compras, descoberta: Object.fromEntries(Object.entries(m.descobertas || {}).map(([id, { referencias: _referencias, ...estado }]) => [id, estado])), atasPendentes: m.atasPendentes, chamadas: m.chamadasNestaExecucao, erro: m.erro }));
    if (!m.concluidaSelecao) process.exitCode = 1;
  }).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
