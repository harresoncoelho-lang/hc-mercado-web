// Robô de coleta diária do PNCP para o HC Licitações.
// Roda no GitHub Actions (cron diário) e grava arquivos JSON estáticos em /data,
// que o site (index.html) lê diretamente — sem precisar consultar o PNCP na hora
// que o usuário faz uma busca.
//
// Uso: node scripts/atualizar_dados.js
// Variáveis de ambiente opcionais:
//   DIAS_HISTORICO_INICIAL=30     -> na 1ª execução (sem arquivo anterior), quantos dias varrer (padrão 30)
//   RETENCAO_DIAS=730             -> quantos dias de histórico manter acumulado (padrão 730 = 24 meses)
//   LIMITE_MINUTOS_CONTRATOS=13   -> orçamento de tempo da etapa de contratos nacionais (padrão 13 min)
//   LIMITE_MINUTOS_MERCADO=13     -> orçamento de tempo da etapa de atas/empresas por segmento (padrão 13 min)
//   CONCORRENCIA_PAGINAS=5        -> quantas páginas buscar em paralelo na coleta de contratos (padrão 5)
//
// IMPORTANTE: a partir desta versão o robô é INCREMENTAL — ele não re-varre tudo do zero
// a cada execução. Ele lê os arquivos já existentes (comitados no repo), busca só o que é
// novo desde a última coleta (com uma folga de alguns dias pra pegar publicações atrasadas)
// e junta com o que já tinha, descartando duplicatas e registros mais velhos que RETENCAO_DIAS.
//
// Duas etapas independentes, cada uma com seu próprio orçamento de tempo:
//   1) coletarContratos()        -> data/contratos_recentes.json (todos os setores, nacional)
//   2) coletarMercadoSegmentos() -> data/mercado_segmentos.json (atas de registro de preço +
//      empresas vencedoras, só para os segmentos que a HC realmente monitora — ver SEGMENTOS
//      abaixo). Essa etapa é mais cara por ata (precisa consultar itens e resultados de cada
//      contratação vinculada), por isso fica restrita a um conjunto fixo de segmentos em vez
//      de tentar cobrir livremente qualquer palavra-chave que o usuário digitar no site.

const DIAS_HISTORICO_INICIAL = parseInt(process.env.DIAS_HISTORICO_INICIAL || "30", 10);
const RETENCAO_DIAS = parseInt(process.env.RETENCAO_DIAS || "730", 10);
const FOLGA_DIAS = 2; // re-busca os últimos dias pra pegar publicações atrasadas no PNCP
const LIMITE_MINUTOS_CONTRATOS = parseFloat(process.env.LIMITE_MINUTOS_CONTRATOS || "13");
const LIMITE_MINUTOS_MERCADO = parseFloat(process.env.LIMITE_MINUTOS_MERCADO || "13");
const CONCORRENCIA_PAGINAS = parseInt(process.env.CONCORRENCIA_PAGINAS || "5", 10);
const TAMANHO_PAGINA = 100;

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
  "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
  "SP", "SE", "TO",
];

// Segmentos que a HC realmente monitora pros clientes (mesma lista usada no boletim de
// e-mail em busca_editais.py). É nesses que vale a pena pagar o custo extra de consultar
// item por item das atas de registro de preço pra descobrir quem são as empresas vencedoras.
const SEGMENTOS = [
  "expediente",
  "higiene",
  "limpeza",
  "aliment",
  "veiculo",
  "hospitalar",
  "engenharia",
  "fotovoltaic",
  "eletric",
  "informatica",
];

function normalizar(txt) {
  if (!txt) return "";
  return txt.toString().normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function segmentosQueBatem(texto) {
  const norm = normalizar(texto);
  return SEGMENTOS.filter((s) => norm.includes(normalizar(s)));
}

let inicioExecucaoFase = Date.now();
let limiteMsFase = 0;

function iniciarFase(minutos) {
  inicioExecucaoFase = Date.now();
  limiteMsFase = minutos * 60 * 1000;
}

function tempoRestanteMs() {
  return limiteMsFase - (Date.now() - inicioExecucaoFase);
}

function fmtData(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

// Quebra um período [inicioStr, fimStr] (yyyymmdd) em janelas de no máximo `diasPorJanela`
// dias. A API de /v1/atas do PNCP fica muito lenta (e às vezes nem responde dentro do
// timeout) quando o período pedido é muito longo — por isso nunca pedimos mais que uma
// janela curta de cada vez, mesmo que isso signifique várias chamadas.
function gerarJanelas(inicioStr, fimStr, diasPorJanela) {
  const ini = new Date(`${inicioStr.slice(0, 4)}-${inicioStr.slice(4, 6)}-${inicioStr.slice(6, 8)}`);
  const fim = new Date(`${fimStr.slice(0, 4)}-${fimStr.slice(4, 6)}-${fimStr.slice(6, 8)}`);
  const janelas = [];
  let cursor = ini;
  while (cursor < fim) {
    const fimJanela = new Date(Math.min(cursor.getTime() + diasPorJanela * 24 * 60 * 60 * 1000, fim.getTime()));
    janelas.push({ inicio: fmtData(cursor), fim: fmtData(fimJanela) });
    cursor = new Date(fimJanela.getTime() + 24 * 60 * 60 * 1000);
  }
  return janelas;
}

async function fetchComRetentativa(url, tentativas = 2, timeoutMs = 20000, rotulo = "") {
  for (let i = 0; i < tentativas; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const resp = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (resp.status === 429) {
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        continue;
      }
      if (resp.status === 204) return { data: [], totalPaginas: 0 };
      if (!resp.ok) {
        console.log(`[fetch${rotulo ? " " + rotulo : ""}] HTTP ${resp.status} em ${url}`);
        return null;
      }
      const texto = await resp.text();
      if (!texto) return null;
      return JSON.parse(texto);
    } catch (e) {
      const motivo = e && e.name === "AbortError" ? `timeout (${timeoutMs}ms)` : String(e && e.message || e);
      if (i === tentativas - 1) {
        console.log(`[fetch${rotulo ? " " + rotulo : ""}] Falhou após ${tentativas} tentativas (${motivo}) em ${url}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  return null;
}

async function lerJsonExistente(caminho) {
  try {
    const fs = await import("node:fs/promises");
    const texto = await fs.readFile(caminho, "utf8");
    return JSON.parse(texto);
  } catch (e) {
    return null;
  }
}

// Chave única de um contrato, pra deduplicar ao juntar coleta nova com a antiga.
function chaveRegistro(r) {
  return r.numeroControlePNCP || `${r.cnpjFornecedor}|${r.dataAssinatura}|${r.valor}|${r.objeto}`;
}

// Extrai {cnpj, ano, sequencial} de um numeroControlePNCP no formato
// "CNPJ-TIPO-SEQUENCIAL/ANO" (mesmo formato usado em toda a integração do PNCP).
function partesNumeroControle(numeroControlePNCP) {
  if (!numeroControlePNCP) return null;
  try {
    const partes = numeroControlePNCP.split("-");
    if (partes.length < 3) return null;
    const cnpj = partes[0];
    const seqAno = partes.slice(2).join("-");
    const [seq, ano] = seqAno.split("/");
    if (!cnpj || !seq || !ano) return null;
    return { cnpj, ano, sequencial: parseInt(seq, 10) };
  } catch (e) {
    return null;
  }
}

// ---------- Utilitário: busca um lote de páginas em paralelo (com limite de concorrência) ----------
async function buscarPaginasEmLote(montarUrl, paginaInicial, totalPaginasConhecido, concorrencia, aoReceberPagina) {
  let proximaPagina = paginaInicial;
  let totalPaginas = totalPaginasConhecido || 1;
  let paginasVarridas = 0;
  let parouPorTempo = false;
  let falhaConsecutivas = 0;

  async function trabalhador() {
    while (true) {
      if (tempoRestanteMs() < 12000) { parouPorTempo = true; return; }
      if (proximaPagina > totalPaginas) return;
      const paginaAtual = proximaPagina;
      proximaPagina += 1;
      const dados = await fetchComRetentativa(montarUrl(paginaAtual));
      if (!dados) {
        falhaConsecutivas += 1;
        if (falhaConsecutivas > 8) { parouPorTempo = true; return; }
        continue;
      }
      falhaConsecutivas = 0;
      if (typeof dados.totalPaginas === "number" && dados.totalPaginas > 0) {
        totalPaginas = dados.totalPaginas;
      }
      paginasVarridas += 1;
      aoReceberPagina(dados, paginaAtual);
    }
  }

  const trabalhadores = Array.from({ length: concorrencia }, () => trabalhador());
  await Promise.all(trabalhadores);

  return { paginasVarridas, totalPaginas, parcial: parouPorTempo || proximaPagina <= totalPaginas };
}

// ---------- Contratos históricos (nacional, acumulados de forma incremental) ----------
async function coletarContratos(caminhoArquivo) {
  const existentes = await lerJsonExistente(caminhoArquivo);
  const hoje = new Date();

  let inicio;
  let primeiraExecucao = !existentes || !Array.isArray(existentes.registros);
  if (!primeiraExecucao && existentes.dataFinal) {
    const dataFinalAnterior = new Date(
      `${existentes.dataFinal.slice(0, 4)}-${existentes.dataFinal.slice(4, 6)}-${existentes.dataFinal.slice(6, 8)}`
    );
    inicio = new Date(dataFinalAnterior.getTime() - FOLGA_DIAS * 24 * 60 * 60 * 1000);
  } else {
    inicio = new Date(hoje.getTime() - DIAS_HISTORICO_INICIAL * 24 * 60 * 60 * 1000);
  }
  const dataInicial = fmtData(inicio);
  const dataFinal = fmtData(hoje);

  const novos = [];
  const montarUrl = (pagina) =>
    `https://pncp.gov.br/api/consulta/v1/contratos?dataInicial=${dataInicial}&dataFinal=${dataFinal}&pagina=${pagina}&tamanhoPagina=${TAMANHO_PAGINA}`;

  const resultado = await buscarPaginasEmLote(montarUrl, 1, 1, CONCORRENCIA_PAGINAS, (dados) => {
    const itens = dados.data || [];
    for (const item of itens) {
      const objeto = item.objetoContrato || item.objetoCompra || "";
      novos.push({
        objeto,
        orgao: (item.orgaoEntidade && item.orgaoEntidade.razaoSocial) || "",
        cnpjOrgao: (item.orgaoEntidade && item.orgaoEntidade.cnpj) || "",
        uf: (item.unidadeOrgao && item.unidadeOrgao.ufSigla) || "",
        municipio: (item.unidadeOrgao && item.unidadeOrgao.municipioNome) || "",
        cnpjFornecedor: item.niFornecedor || "",
        nomeFornecedor: item.nomeRazaoSocialFornecedor || "",
        valor: Number(item.valorGlobal || item.valorInicial || 0),
        dataAssinatura: item.dataAssinatura || item.dataVigenciaInicio || null,
        numeroControlePNCP: item.numeroControlePNCP || null,
        segmentos: segmentosQueBatem(objeto),
      });
    }
  });

  // Junta com o que já tinha, deduplicando, e descarta o que passou da retenção.
  const mapa = new Map();
  if (existentes && Array.isArray(existentes.registros)) {
    for (const r of existentes.registros) mapa.set(chaveRegistro(r), r);
  }
  for (const r of novos) mapa.set(chaveRegistro(r), r);

  const limiteRetencao = new Date(hoje.getTime() - RETENCAO_DIAS * 24 * 60 * 60 * 1000);
  let registros = Array.from(mapa.values()).filter((r) => {
    if (!r.dataAssinatura) return true;
    const d = new Date(r.dataAssinatura);
    return isNaN(d) || d >= limiteRetencao;
  });

  // Trava de segurança de tamanho: ao podar, prioriza manter os registros que batem com
  // algum dos segmentos monitorados (mais valiosos pro diagnóstico de mercado) e descarta
  // primeiro os mais antigos entre os que não batem com nenhum segmento.
  const MAX_REGISTROS = 250000;
  if (registros.length > MAX_REGISTROS) {
    registros.sort((a, b) => {
      const aTem = (a.segmentos || []).length > 0 ? 1 : 0;
      const bTem = (b.segmentos || []).length > 0 ? 1 : 0;
      if (aTem !== bTem) return bTem - aTem; // prioriza quem tem segmento
      return (b.dataAssinatura || "").localeCompare(a.dataAssinatura || "");
    });
    registros = registros.slice(0, MAX_REGISTROS);
    console.log(`[contratos] Atingiu MAX_REGISTROS (${MAX_REGISTROS}); descartados os mais antigos sem segmento.`);
  }

  const dataInicialReal = registros.reduce((min, r) => {
    if (!r.dataAssinatura) return min;
    return !min || r.dataAssinatura < min ? r.dataAssinatura : min;
  }, null);

  console.log(
    `[contratos] Concluído: ${novos.length} novos nesta execução (${resultado.paginasVarridas} páginas de ${resultado.totalPaginas}, parcial=${resultado.parcial}). ` +
    `Total acumulado após dedupuplicar/podar: ${registros.length} registros (${primeiraExecucao ? "1ª execução" : "incremental"}), ` +
    `cobrindo desde ${dataInicialReal || "?"}.`
  );

  return {
    atualizadoEm: new Date().toISOString(),
    dataInicial: dataInicialReal || dataInicial,
    dataFinal,
    retencaoDias: RETENCAO_DIAS,
    totalRegistros: registros.length,
    paginasVarridas: resultado.paginasVarridas,
    totalPaginasDisponiveis: resultado.totalPaginas,
    parcial: resultado.parcial,
    registros,
  };
}

// ---------- Oportunidades (por UF) — ACUMULADO, não só "abertas agora" ----------
// A API do PNCP (/contratacoes/proposta) só devolve o que ainda está com prazo de
// proposta aberto hoje. Pra permitir busca retroativa no site (ex: "o que foi publicado
// nos últimos 30/60 dias", incluindo o que já encerrou nesse meio tempo), este robô
// FUNDE o resultado de cada execução com o que já tinha coletado antes (por
// numeroControlePNCP), em vez de sobrescrever o arquivo do zero. Registros somem do
// arquivo só quando ficam mais velhos que RETENCAO_DIAS_OPORTUNIDADES.
const RETENCAO_DIAS_OPORTUNIDADES = parseInt(process.env.RETENCAO_DIAS_OPORTUNIDADES || "120", 10);

async function coletarOportunidadesAbertas(caminhoArquivo) {
  // Orçamento maior (era 6 min fixo) e busca em PARALELO por UF (era 1 UF de cada vez) —
  // com 27 UFs e a API do PNCP às vezes lenta, rodar sequencial estourava o orçamento
  // depois de só 8-9 UFs e o resto nunca era nem tentado. Um pool de workers concorrentes
  // consegue cobrir muito mais UFs no mesmo tempo, do mesmo jeito que coletarContratos já
  // faz pras páginas de contratos.
  const ORCAMENTO_MINUTOS_OPORTUNIDADES = parseFloat(process.env.LIMITE_MINUTOS_OPORTUNIDADES || "18");
  const CONCORRENCIA_UF = parseInt(process.env.CONCORRENCIA_UF_OPORTUNIDADES || "6", 10);
  iniciarFase(ORCAMENTO_MINUTOS_OPORTUNIDADES);
  const existentes = await lerJsonExistente(caminhoArquivo);
  const hoje = new Date();
  const dataFinal = fmtData(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));
  const todas = [];
  let ufsComFalha = [];
  let ufsOk = [];

  const filaUfs = [...UFS];

  async function processarUf(uf) {
    let pagina = 1;
    let totalPaginas = 1;
    let falhouUf = false;

    while (pagina <= totalPaginas && pagina <= 20) {
      if (tempoRestanteMs() < 8000) { falhouUf = true; break; }
      const url = `https://pncp.gov.br/api/consulta/v1/contratacoes/proposta?uf=${uf}&dataFinal=${dataFinal}&pagina=${pagina}&tamanhoPagina=50`;
      const dados = await fetchComRetentativa(url, 2, 25000, `oportunidades ${uf}`);
      if (!dados) { falhouUf = true; break; }
      const itens = dados.data || [];
      totalPaginas = dados.totalPaginas || 1;

      for (const item of itens) {
        todas.push({
          objeto: item.objetoCompra || item.objetoContrato || "",
          orgao: (item.orgaoEntidade && item.orgaoEntidade.razaoSocial) || "Órgão não informado",
          uf,
          municipio: (item.unidadeOrgao && item.unidadeOrgao.municipioNome) || "",
          encerramento: item.dataEncerramentoProposta || null,
          publicacao: item.dataPublicacaoPncp || null,
          numeroControlePNCP: item.numeroControlePNCP || null,
        });
      }
      pagina += 1;
    }
    if (falhouUf) ufsComFalha.push(uf); else ufsOk.push(uf);
  }

  async function trabalhador() {
    while (filaUfs.length > 0) {
      if (tempoRestanteMs() < 8000) return;
      const uf = filaUfs.shift();
      if (!uf) return;
      await processarUf(uf);
    }
  }

  await Promise.all(Array.from({ length: CONCORRENCIA_UF }, () => trabalhador()));
  if (filaUfs.length > 0) {
    console.log(`[oportunidades] Orçamento de tempo esgotado — ${filaUfs.length} UF(s) nem chegaram a ser tentadas: ${filaUfs.join(", ")}.`);
  }

  // Funde com o que já existia, mantendo a versão mais nova de cada registro (a que
  // acabou de vir da API, se ele ainda apareceu; senão, a antiga que já tínhamos).
  const chave = (r) => r.numeroControlePNCP || `${r.objeto}|${r.orgao}|${r.uf}`;
  const mapa = new Map();
  if (existentes && Array.isArray(existentes.registros)) {
    for (const r of existentes.registros) mapa.set(chave(r), r);
  }
  for (const r of todas) mapa.set(chave(r), r);

  const limiteRetencao = new Date(hoje.getTime() - RETENCAO_DIAS_OPORTUNIDADES * 24 * 60 * 60 * 1000);
  const registros = Array.from(mapa.values()).filter((r) => {
    const refBruta = r.publicacao || r.encerramento;
    if (!refBruta) return true;
    const d = new Date(refBruta);
    return isNaN(d) || d >= limiteRetencao;
  });

  console.log(
    `[oportunidades] Concluído: ${todas.length} vistas nesta execução (UFs ok: ${ufsOk.length}, falhas em: ${ufsComFalha.join(", ") || "nenhuma"}). ` +
    `Total acumulado após fundir/podar (retenção ${RETENCAO_DIAS_OPORTUNIDADES}d): ${registros.length} registros.`
  );

  return {
    atualizadoEm: new Date().toISOString(),
    retencaoDias: RETENCAO_DIAS_OPORTUNIDADES,
    totalRegistros: registros.length,
    ufsComFalha,
    registros,
  };
}

// ---------- Mercado por segmento: atas de registro de preço + empresas vencedoras ----------
// Só processa atas cujo objeto bate com algum dos SEGMENTOS monitorados — cada ata que bate
// custa consultas extras (itens + resultados de cada item), então não dá pra fazer isso pra
// TODAS as atas do Brasil sem estourar o orçamento de tempo/limites da API do PNCP.
async function coletarMercadoSegmentos(caminhoArquivo) {
  const existentes = await lerJsonExistente(caminhoArquivo);
  const hoje = new Date();

  let inicio;
  let primeiraExecucao = !existentes || !existentes.dataFinal;
  if (!primeiraExecucao) {
    const dataFinalAnterior = new Date(
      `${existentes.dataFinal.slice(0, 4)}-${existentes.dataFinal.slice(4, 6)}-${existentes.dataFinal.slice(6, 8)}`
    );
    inicio = new Date(dataFinalAnterior.getTime() - FOLGA_DIAS * 24 * 60 * 60 * 1000);
  } else {
    // 1ª execução: varre uma janela de vigência mais generosa, já que atas costumam durar
    // até 12 meses — assim já pegamos atas ainda vigentes hoje mesmo que tenham sido
    // assinadas há alguns meses.
    inicio = new Date(hoje.getTime() - 365 * 24 * 60 * 60 * 1000);
  }
  const dataInicial = fmtData(inicio);
  // Janela de vigência: também olha um pouco pra frente, porque a consulta é por
  // "período de vigência coincide com o período informado" — isso pega atas com vigência
  // futura já publicadas hoje. Na 1ª execução usamos uma janela bem generosa pra frente
  // (backfill único); nas execuções seguintes basta uma janela curta, senão ficaríamos
  // re-varrendo o mesmo período enorme todo dia à toa.
  const diasParaFrente = primeiraExecucao ? 400 : 60;
  const dataFinal = fmtData(new Date(hoje.getTime() + diasParaFrente * 24 * 60 * 60 * 1000));

  const atasMapa = new Map();
  if (existentes && Array.isArray(existentes.atas)) {
    for (const a of existentes.atas) atasMapa.set(a.numeroControlePNCPAta, a);
  }

  // Fila de atas que já sabemos que batem com algum segmento mas ainda não tiveram os
  // itens/resultados consultados (por falta de tempo em execuções anteriores). Processar
  // essa fila primeiro garante que o robô sempre termina de enriquecer o que já achou antes
  // de gastar tempo procurando atas novas.
  let filaPendente = (existentes && Array.isArray(existentes.filaPendente)) ? existentes.filaPendente : [];

  const cacheOrgaoUf = new Map();

  async function enriquecerAta(referenciaAta) {
    const partes = partesNumeroControle(referenciaAta.numeroControlePNCPCompra);
    if (!partes) return null;

    // UF/município do órgão (1 chamada, cacheada por CNPJ+ano+sequencial pra não repetir
    // à toa se duas atas forem da mesma compra).
    let ufOrgao = "", municipioOrgao = "";
    const chaveCompra = `${partes.cnpj}|${partes.ano}|${partes.sequencial}`;
    if (cacheOrgaoUf.has(chaveCompra)) {
      const c = cacheOrgaoUf.get(chaveCompra);
      ufOrgao = c.uf; municipioOrgao = c.municipio;
    } else {
      const compra = await fetchComRetentativa(
        `https://pncp.gov.br/api/pncp/v1/orgaos/${partes.cnpj}/compras/${partes.ano}/${partes.sequencial}`,
        2, 15000
      );
      if (compra) {
        ufOrgao = (compra.unidadeOrgao && compra.unidadeOrgao.ufSigla) || "";
        municipioOrgao = (compra.unidadeOrgao && compra.unidadeOrgao.municipioNome) || "";
      }
      cacheOrgaoUf.set(chaveCompra, { uf: ufOrgao, municipio: municipioOrgao });
    }

    const itensResp = await fetchComRetentativa(
      `https://pncp.gov.br/api/pncp/v1/orgaos/${partes.cnpj}/compras/${partes.ano}/${partes.sequencial}/itens?pagina=1&tamanhoPagina=50`,
      2, 15000
    );
    const listaItens = Array.isArray(itensResp) ? itensResp : (itensResp && itensResp.data) || [];

    const itensComVencedor = [];
    // Limita a no máx. 30 itens por ata pra não estourar o orçamento numa única contratação
    // com centenas de itens (ex: atas de material de expediente com muitos itens).
    for (const item of listaItens.slice(0, 30)) {
      if (tempoRestanteMs() < 10000) break;
      const numeroItem = item.numeroItem || item.numero;
      if (!numeroItem) continue;
      const resultados = await fetchComRetentativa(
        `https://pncp.gov.br/api/pncp/v1/orgaos/${partes.cnpj}/compras/${partes.ano}/${partes.sequencial}/itens/${numeroItem}/resultados`,
        2, 15000
      );
      const listaResultados = Array.isArray(resultados) ? resultados : (resultados && resultados.data) || [];
      if (listaResultados.length === 0) continue;
      itensComVencedor.push({
        numeroItem,
        descricao: item.descricao || item.descricaoItem || "",
        vencedores: listaResultados.map((r) => ({
          cnpj: r.niFornecedor || "",
          nome: r.nomeRazaoSocialFornecedor || "",
          valorUnitario: Number(r.valorUnitarioHomologado || 0),
          valorTotal: Number(r.valorTotalHomologado || 0),
          quantidade: Number(r.quantidadeHomologada || 0),
          data: r.dataResultado || null,
        })),
      });
    }

    return { ufOrgao, municipioOrgao, itens: itensComVencedor };
  }

  // 1) Processa primeiro a fila pendente de execuções anteriores.
  const novaFilaPendente = [];
  for (const referenciaAta of filaPendente) {
    if (tempoRestanteMs() < 12000) { novaFilaPendente.push(referenciaAta); continue; }
    const enriquecido = await enriquecerAta(referenciaAta);
    if (enriquecido) {
      atasMapa.set(referenciaAta.numeroControlePNCPAta, { ...referenciaAta, ...enriquecido, enriquecida: true });
    } else {
      novaFilaPendente.push(referenciaAta);
    }
  }
  filaPendente = novaFilaPendente;

  // 2) Varre novas atas no período, em janelas curtas de datas (nunca pedimos o período
  // inteiro de uma vez — ver gerarJanelas). A fila de janelas é persistida entre execuções:
  // se o orçamento de tempo acabar no meio do backfill, a próxima execução continua dali.
  const JANELA_DIAS = 90;
  let janelasPendentes = (existentes && Array.isArray(existentes.janelasPendentes) && existentes.janelasPendentes.length > 0)
    ? existentes.janelasPendentes
    : gerarJanelas(dataInicial, dataFinal, JANELA_DIAS);

  let paginasVarridas = 0;
  let atasNovas = 0;
  let atasEnfileiradas = 0;
  let janelasProcessadasNestaExecucao = 0;

  while (janelasPendentes.length > 0) {
    if (tempoRestanteMs() < 15000) break;
    const janela = janelasPendentes[0];
    let pagina = 1;
    let totalPaginas = 1;
    let janelaOk = true;

    while (pagina <= totalPaginas) {
      if (tempoRestanteMs() < 12000) { janelaOk = false; break; }
      const url = `https://pncp.gov.br/api/consulta/v1/atas?dataInicial=${janela.inicio}&dataFinal=${janela.fim}&pagina=${pagina}&tamanhoPagina=500`;
      const dados = await fetchComRetentativa(url, 2, 20000, "atas");
      if (!dados) { janelaOk = false; break; }
      const itens = dados.data || [];
      totalPaginas = dados.totalPaginas || 1;
      paginasVarridas += 1;

      for (const item of itens) {
        const objeto = item.objetoContratacao || "";
        const segs = segmentosQueBatem(objeto);
        if (segs.length === 0) continue;
        const chave = item.numeroControlePNCPAta;
        if (!chave || atasMapa.has(chave)) continue;

        const referenciaAta = {
          numeroControlePNCPAta: chave,
          numeroControlePNCPCompra: item.numeroControlePNCPCompra || null,
          objeto,
          segmentos: segs,
          orgao: item.nomeOrgao || "",
          cnpjOrgao: item.cnpjOrgao || "",
          numeroAta: item.numeroAtaRegistroPreco || "",
          anoAta: item.anoAta || null,
          dataAssinatura: item.dataAssinatura || null,
          vigenciaInicio: item.vigenciaInicio || null,
          vigenciaFim: item.vigenciaFim || null,
          cancelado: !!item.cancelado,
        };

        if (tempoRestanteMs() < 12000) {
          filaPendente.push(referenciaAta);
          atasEnfileiradas += 1;
          continue;
        }
        const enriquecido = await enriquecerAta(referenciaAta);
        if (enriquecido) {
          atasMapa.set(chave, { ...referenciaAta, ...enriquecido, enriquecida: true });
          atasNovas += 1;
        } else {
          filaPendente.push(referenciaAta);
          atasEnfileiradas += 1;
        }
      }
      pagina += 1;
    }

    if (janelaOk) {
      janelasPendentes.shift();
      janelasProcessadasNestaExecucao += 1;
    } else {
      break; // orçamento de tempo ou falha de rede — retoma essa mesma janela na próxima execução
    }
  }

  // Descarta atas encerradas há muito tempo (mantém histórico de ~24 meses, igual contratos).
  const limiteRetencao = new Date(hoje.getTime() - RETENCAO_DIAS * 24 * 60 * 60 * 1000);
  const atas = Array.from(atasMapa.values()).filter((a) => {
    if (!a.vigenciaFim) return true;
    const d = new Date(a.vigenciaFim);
    return isNaN(d) || d >= limiteRetencao;
  });

  // Agrega por empresa (CNPJ vencedor), cruzando todos os itens de todas as atas.
  const empresas = new Map();
  const agora = hoje.getTime();
  for (const ata of atas) {
    if (!ata.enriquecida || !Array.isArray(ata.itens)) continue;
    const vigente = !ata.cancelado && ata.vigenciaFim && new Date(ata.vigenciaFim).getTime() >= agora;
    for (const item of ata.itens) {
      for (const v of item.vencedores || []) {
        if (!v.cnpj) continue;
        if (!empresas.has(v.cnpj)) {
          empresas.set(v.cnpj, {
            cnpj: v.cnpj,
            nome: v.nome,
            segmentos: new Set(),
            ufs: new Set(),
            atasVigentes: [],
            atasEncerradas: [],
            valorTotalVigente: 0,
            valorTotalHistorico: 0,
            itensGanhos: 0,
          });
        }
        const emp = empresas.get(v.cnpj);
        if (v.nome) emp.nome = v.nome;
        for (const s of ata.segmentos || []) emp.segmentos.add(s);
        if (ata.ufOrgao) emp.ufs.add(ata.ufOrgao);
        emp.itensGanhos += 1;
        emp.valorTotalHistorico += v.valorTotal || 0;
        const refEntry = {
          numeroControlePNCPAta: ata.numeroControlePNCPAta,
          orgao: ata.orgao,
          uf: ata.ufOrgao,
          municipio: ata.municipioOrgao,
          objeto: ata.objeto,
          item: item.descricao,
          valorTotal: v.valorTotal,
          quantidade: v.quantidade,
          vigenciaInicio: ata.vigenciaInicio,
          vigenciaFim: ata.vigenciaFim,
          cancelado: ata.cancelado,
        };
        if (vigente) {
          emp.valorTotalVigente += v.valorTotal || 0;
          emp.atasVigentes.push(refEntry);
        } else {
          emp.atasEncerradas.push(refEntry);
        }
      }
    }
  }

  const empresasArray = Array.from(empresas.values())
    .map((e) => ({
      ...e,
      segmentos: Array.from(e.segmentos),
      ufs: Array.from(e.ufs),
    }))
    .sort((a, b) => b.valorTotalHistorico - a.valorTotalHistorico);

  console.log(
    `[mercado] Concluído: ${janelasProcessadasNestaExecucao} janela(s) de datas varridas nesta execução ` +
    `(${janelasPendentes.length} janela(s) restando pro backfill), ${atasNovas} atas novas enriquecidas, ` +
    `${atasEnfileiradas} enfileiradas pra próxima execução, ${filaPendente.length} pendentes no total, ` +
    `${paginasVarridas} páginas de atas varridas. Total acumulado: ${atas.length} atas, ${empresasArray.length} empresas identificadas.`
  );

  return {
    atualizadoEm: new Date().toISOString(),
    segmentosMonitorados: SEGMENTOS,
    dataInicial,
    dataFinal: fmtData(hoje),
    retencaoDias: RETENCAO_DIAS,
    janelasPendentes,
    filaPendente,
    parcial: filaPendente.length > 0 || janelasPendentes.length > 0,
    totalAtas: atas.length,
    atas,
    empresas: empresasArray,
  };
}

async function main() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const dirDados = path.join(process.cwd(), "data");
  await fs.mkdir(dirDados, { recursive: true });

  console.log(`Iniciando coleta incremental. Retenção: ${RETENCAO_DIAS} dias.`);

  iniciarFase(LIMITE_MINUTOS_CONTRATOS);
  const caminhoContratos = path.join(dirDados, "contratos_recentes.json");
  const contratos = await coletarContratos(caminhoContratos);
  await fs.writeFile(caminhoContratos, JSON.stringify(contratos), "utf8");
  console.log("Gravado data/contratos_recentes.json");

  const caminhoOportunidades = path.join(dirDados, "oportunidades_abertas.json");
  const oportunidades = await coletarOportunidadesAbertas(caminhoOportunidades);
  await fs.writeFile(caminhoOportunidades, JSON.stringify(oportunidades), "utf8");
  console.log("Gravado data/oportunidades_abertas.json");

  iniciarFase(LIMITE_MINUTOS_MERCADO);
  const caminhoMercado = path.join(dirDados, "mercado_segmentos.json");
  const mercado = await coletarMercadoSegmentos(caminhoMercado);
  await fs.writeFile(caminhoMercado, JSON.stringify(mercado), "utf8");
  console.log("Gravado data/mercado_segmentos.json");

  console.log("Coleta finalizada com sucesso.");
}

main().catch((e) => {
  console.error("Erro fatal no robô de coleta:", e);
  process.exit(1);
});
