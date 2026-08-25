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
//   CONCORRENCIA_ATAS=6           -> quantas chamadas de "resultados de item" buscar em paralelo por
//                                    ata, dentro de enriquecerAta() (padrão 6) — ver comentário lá
//
// IMPORTANTE: a partir desta versão o robô é INCREMENTAL — ele não re-varre tudo do zero
// a cada execução. Ele lê os arquivos já existentes (comitados no repo), busca só o que é
// novo desde a última coleta (com uma folga de alguns dias pra pegar publicações atrasadas)
// e junta com o que já tinha, descartando duplicatas e registros mais velhos que RETENCAO_DIAS.
//
// Duas etapas independentes, cada uma com seu próprio orçamento de tempo:
//   1) coletarContratos()        -> data/contratos_recentes.json (todos os setores, nacional)
//   2) coletarMercadoSegmentos() -> data/mercado_segmentos.json (atas de registro de preço).
//      Coleta atas de TODOS os segmentos, nacional (SEGMENTOS abaixo é só um rótulo
//      informativo por ata, não filtra mais a coleta — ver segmentosQueBatem()). Essa etapa é
//      cara por ata (precisa consultar itens e resultados de cada contratação vinculada, até
//      ~32 chamadas por ata), por isso o gargalo real é tempo de rede, não escopo de busca.

const DIAS_HISTORICO_INICIAL = parseInt(process.env.DIAS_HISTORICO_INICIAL || "30", 10);
const RETENCAO_DIAS = parseInt(process.env.RETENCAO_DIAS || "730", 10);
const FOLGA_DIAS = 2; // re-busca os últimos dias pra pegar publicações atrasadas no PNCP
const LIMITE_MINUTOS_CONTRATOS = parseFloat(process.env.LIMITE_MINUTOS_CONTRATOS || "13");
const LIMITE_MINUTOS_MERCADO = parseFloat(process.env.LIMITE_MINUTOS_MERCADO || "13");
const CONCORRENCIA_PAGINAS = parseInt(process.env.CONCORRENCIA_PAGINAS || "5", 10);
// Quantas chamadas de "resultados de item" (o passo mais repetitivo do enriquecimento de uma
// ata — até 30 por ata, uma por item) rodam em paralelo. Cada ata é enriquecida por completo
// antes de passar pra próxima (não paraleliza ENTRE atas), então nunca mistura itens de atas
// diferentes — só acelera os até 30 itens de UMA MESMA ata, que antes eram sequenciais.
// Comece baixo (6) e suba com cuidado se o PNCP não reclamar (ver log de 429/rate-limit).
const CONCORRENCIA_ATAS = parseInt(process.env.CONCORRENCIA_ATAS || "6", 10);
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
  "construcao",
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

// Espera com backoff EXPONENCIAL + jitter entre tentativas (1s, 2s, 4s, ... até um teto de
// 8s, mais até 300ms aleatórios). O jitter existe pra evitar "thundering herd": com várias
// chamadas em paralelo (ver CONCORRENCIA_ATAS) todas esbarrando em rate-limit ao mesmo tempo,
// sem jitter elas re-tentariam todas no mesmíssimo instante e derrubariam a API de novo.
function esperarComBackoff(tentativaZeroIndexed) {
  const base = Math.min(1000 * 2 ** tentativaZeroIndexed, 8000);
  return new Promise((r) => setTimeout(r, base + Math.random() * 300));
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
        if (i === tentativas - 1) {
          console.log(`[fetch${rotulo ? " " + rotulo : ""}] Rate-limit (429) persistente após ${tentativas} tentativa(s) em ${url}`);
          return null;
        }
        await esperarComBackoff(i);
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
      await esperarComBackoff(i);
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

// ---------- Coleta complementar por UF (corrige o viés do scan nacional) ----------
// O endpoint /v1/contratos (usado acima) NÃO aceita filtro de UF — ele devolve uma página
// "nacional" cuja ordem é decidida pelo próprio PNCP, e isso tem gerado uma amostra bem
// desequilibrada entre estados (ex: SC sozinho respondendo por ~30% dos registros
// coletados, enquanto estados como AM ficam com menos de 1%, mesmo tendo mercado real —
// confirmado buscando direto no PNCP: só de material/serviço de informática em Manaus,
// existem centenas de contratos assinados). Isso fazia o Diagnóstico de Mercado parecer
// vazio pra segmentos que na verdade têm bastante atividade em estados menores.
//
// Pra corrigir sem descartar o scan nacional (que é a única fonte com fornecedor/CNPJ pra
// TODO contrato, usado pela aba "Analisar Empresa"), rodamos uma segunda passada: usamos o
// endpoint api/search (o mesmo que o site pncp.gov.br usa na busca, e que o Boletim/
// Encontrar Licitações já usam com sucesso) que ACEITA filtro de UF, priorizando sempre os
// estados com menos registros na base atual — assim cada execução do robô vai enchendo os
// "buracos" dos estados mais esquecidos, em vez de gastar tempo de novo nos que já estão
// bem cobertos (como SC/SP). Cada contrato novo encontrado é enriquecido com uma chamada
// extra (fornecedor, valor, objeto) pra manter o mesmo formato de registro de sempre.
const LIMITE_MINUTOS_CONTRATOS_UF = parseFloat(process.env.LIMITE_MINUTOS_CONTRATOS_UF || "10");
const CONCORRENCIA_UF_CONTRATOS = parseInt(process.env.CONCORRENCIA_UF_CONTRATOS || "4", 10);
const MAX_PAGINAS_POR_UF_CONTRATOS = parseInt(process.env.MAX_PAGINAS_POR_UF_CONTRATOS || "6", 10);

function contarRegistrosPorUf(registros) {
  const contagem = new Map();
  for (const uf of UFS) contagem.set(uf, 0);
  for (const r of registros) {
    if (r.uf && contagem.has(r.uf)) contagem.set(r.uf, contagem.get(r.uf) + 1);
  }
  return contagem;
}

async function buscarDetalheContrato(numeroControlePNCP) {
  const partes = partesNumeroControle(numeroControlePNCP);
  if (!partes) return null;
  const dados = await fetchComRetentativa(
    `https://pncp.gov.br/api/pncp/v1/orgaos/${partes.cnpj}/contratos/${partes.ano}/${partes.sequencial}`,
    2, 15000, "detalhe contrato"
  );
  return dados;
}

async function coletarContratosComplementarPorUf(registrosExistentes) {
  iniciarFase(LIMITE_MINUTOS_CONTRATOS_UF);
  const conhecidos = new Set(registrosExistentes.map((r) => r.numeroControlePNCP).filter(Boolean));
  const contagemPorUf = contarRegistrosPorUf(registrosExistentes);
  // Prioriza sempre os estados com MENOS registros hoje — é assim que os "buracos" (ex: AM)
  // vão sendo preenchidos primeiro, em vez de sempre reprocessar os estados já robustos.
  const filaUfs = [...UFS].sort((a, b) => contagemPorUf.get(a) - contagemPorUf.get(b));
  const novos = [];
  let ufsProcessadas = 0;

  async function processarUf(uf) {
    let pagina = 1;
    while (pagina <= MAX_PAGINAS_POR_UF_CONTRATOS) {
      if (tempoRestanteMs() < 10000) return;
      const params = new URLSearchParams({
        tipos_documento: "contrato", status: "todos", ufs: uf,
        ordenacao: "-data", tam_pagina: "50", pagina: String(pagina),
      });
      const dados = await fetchComRetentativa(`https://pncp.gov.br/api/search/?${params}`, 2, 15000, `contratos ${uf}`);
      if (!dados || !Array.isArray(dados.items) || dados.items.length === 0) return;
      for (const item of dados.items) {
        if (tempoRestanteMs() < 8000) return;
        const numero = item.numero_controle_pncp;
        if (!numero || conhecidos.has(numero)) continue;
        conhecidos.add(numero); // evita re-tentar o mesmo contrato 2x na mesma execução
        const detalhe = await buscarDetalheContrato(numero);
        if (!detalhe) continue;
        const objeto = detalhe.objetoContrato || item.description || item.title || "";
        novos.push({
          objeto,
          orgao: (detalhe.orgaoEntidade && detalhe.orgaoEntidade.razaoSocial) || item.orgao_nome || "",
          cnpjOrgao: (detalhe.orgaoEntidade && detalhe.orgaoEntidade.cnpj) || item.orgao_cnpj || "",
          uf: (detalhe.unidadeOrgao && detalhe.unidadeOrgao.ufSigla) || uf,
          municipio: (detalhe.unidadeOrgao && detalhe.unidadeOrgao.municipioNome) || item.municipio_nome || "",
          cnpjFornecedor: detalhe.niFornecedor || "",
          nomeFornecedor: detalhe.nomeRazaoSocialFornecedor || "",
          valor: Number(detalhe.valorGlobal || item.valor_global || 0),
          dataAssinatura: detalhe.dataAssinatura || item.data_assinatura || null,
          numeroControlePNCP: numero,
          segmentos: segmentosQueBatem(objeto),
        });
      }
      pagina += 1;
    }
  }

  async function trabalhador() {
    while (filaUfs.length > 0) {
      if (tempoRestanteMs() < 10000) return;
      const uf = filaUfs.shift();
      if (!uf) return;
      await processarUf(uf);
      ufsProcessadas += 1;
    }
  }

  await Promise.all(Array.from({ length: CONCORRENCIA_UF_CONTRATOS }, () => trabalhador()));
  console.log(`[contratos-uf] Complementar concluído: ${novos.length} contrato(s) novo(s) em ${ufsProcessadas} UF(s) processada(s) (priorizando as menos cobertas).`);
  return novos;
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

  // Passada complementar por UF (ver coletarContratosComplementarPorUf acima) — preenche os
  // estados que o scan nacional deixou de fora, usando o que já temos (existentes + novos
  // desta execução) pra saber quais estados priorizar.
  try {
    const baseParaContagem = Array.from(mapa.values());
    const complementares = await coletarContratosComplementarPorUf(baseParaContagem);
    for (const r of complementares) mapa.set(chaveRegistro(r), r);
  } catch (e) {
    console.log(`[contratos-uf] Falhou, seguindo só com o scan nacional: ${e && e.message}`);
  }

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

// amparoLegal costuma vir como objeto único ({ nome, descricao }), mas usa nome se tiver
// (mais curto/direto, ex: "Lei 14.133/2021, Art. 75, II") e cai pra descrição só se faltar.
function extrairAmparoLegal(amparoLegal) {
  if (!amparoLegal || typeof amparoLegal !== "object") return null;
  return amparoLegal.nome || amparoLegal.descricao || null;
}

// A API já teve o campo tanto como string única (fonteOrcamentaria) quanto como lista
// (fontesOrcamentarias, itens com nome/descricao) — aceita os dois formatos.
function extrairFonteOrcamentaria(item) {
  if (typeof item.fonteOrcamentaria === "string" && item.fonteOrcamentaria.trim()) {
    return item.fonteOrcamentaria.trim();
  }
  if (Array.isArray(item.fontesOrcamentarias) && item.fontesOrcamentarias.length > 0) {
    const nomes = item.fontesOrcamentarias
      .map((f) => (typeof f === "string" ? f : (f && (f.nome || f.descricao)) || ""))
      .filter(Boolean);
    if (nomes.length > 0) return nomes.join(", ");
  }
  return null;
}

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
          modalidadeNome: item.modalidadeNome || null,
          tipoInstrumentoConvocatorioNome: item.tipoInstrumentoConvocatorioNome || null,
          amparoLegal: extrairAmparoLegal(item.amparoLegal),
          modoDisputaNome: item.modoDisputaNome || null,
          srp: typeof item.srp === "boolean" ? item.srp : null,
          fonteOrcamentaria: extrairFonteOrcamentaria(item),
          situacaoCompraNome: item.situacaoCompraNome || null,
          valorTotalEstimado: item.valorTotalEstimado ?? null,
          valorTotalHomologado: item.valorTotalHomologado ?? null,
          numeroCompra: item.numeroCompra || null,
          anoCompra: item.anoCompra || null,
          processo: item.processo || null,
          codigoUnidade: (item.unidadeOrgao && item.unidadeOrgao.codigoUnidade) || null,
          esferaId: (item.orgaoEntidade && item.orgaoEntidade.esferaId) || null,
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

  // Segunda passada só nas UFs que falharam na primeira: falhas de UF individual costumam
  // ser instabilidade pontual do PNCP (timeout numa página específica), não um problema
  // sistêmico — tentar de novo, agora sem concorrência de outras 5 UFs disputando a mesma
  // API, resolve a maioria dos casos (era comum um estado como "AM" falhar sozinho mesmo
  // com todas as outras 26 UFs tendo sido coletadas com sucesso na mesma execução).
  if (ufsComFalha.length > 0 && tempoRestanteMs() > 20000) {
    const paraRetentar = [...ufsComFalha];
    console.log(`[oportunidades] Segunda passada em ${paraRetentar.length} UF(s) que falharam: ${paraRetentar.join(", ")}.`);
    ufsComFalha = [];
    for (const uf of paraRetentar) {
      if (tempoRestanteMs() < 10000) { ufsComFalha.push(uf); continue; }
      await processarUf(uf);
    }
    if (ufsComFalha.length > 0) {
      console.log(`[oportunidades] Ainda falharam após a segunda passada: ${ufsComFalha.join(", ")}.`);
    } else {
      console.log(`[oportunidades] Segunda passada recuperou todas as UFs pendentes.`);
    }
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
// Antes só processava atas cujo objeto batesse com uma lista fixa de ~10 segmentos — o
// problema é que qualquer cliente cujo ramo não estivesse nessa lista via o painel
// permanentemente vazio, mesmo que o mercado dele existisse de verdade no PNCP (foi
// exatamente o que aconteceu com informática/AM e depois com construção civil). Trocamos
// pra registrar e enfileirar TODA ata encontrada, de qualquer segmento — sem lista fixa. O
// que já limitava o custo (consultas extras de itens + resultados por ata) continua
// limitando: o orçamento de tempo por execução + a fila persistente (filaPendente) fazem o
// robô processar o que der a cada dia e continuar de onde parou no dia seguinte. Com isso,
// qualquer mercado pesquisado no Diagnóstico acaba sendo coberto mais cedo ou mais tarde,
// sem precisar cadastrar palavra-chave nenhuma de antemão. SEGMENTOS continua existindo só
// como rótulo informativo (usado também pra marcar os contratos nacionais).
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

  async function buscarUfOrgao(numeroControlePNCPCompra) {
    const partes = partesNumeroControle(numeroControlePNCPCompra);
    if (!partes) return { ufOrgao: "", municipioOrgao: "" };
    const chaveCompra = `${partes.cnpj}|${partes.ano}|${partes.sequencial}`;
    if (cacheOrgaoUf.has(chaveCompra)) return cacheOrgaoUf.get(chaveCompra);
    let ufOrgao = "", municipioOrgao = "";
    // Nota: o endpoint antigo /api/pncp/v1/orgaos/.../compras/{ano}/{sequencial} (sem
    // /arquivos ou /itens) foi descontinuado pelo PNCP e agora responde 301 pra
    // /api/consulta/v1/... — usando o antigo, "compra" vinha sempre vazio/sem
    // unidadeOrgao, e ufOrgao/municipioOrgao ficavam em branco pra TODAS as atas, de
    // qualquer segmento (zerando o filtro de UF do painel de mercado/atas). Corrigido
    // pra usar o endpoint novo direto.
    const compra = await fetchComRetentativa(
      `https://pncp.gov.br/api/consulta/v1/orgaos/${partes.cnpj}/compras/${partes.ano}/${partes.sequencial}`,
      2, 15000
    );
    if (compra) {
      ufOrgao = (compra.unidadeOrgao && compra.unidadeOrgao.ufSigla) || "";
      municipioOrgao = (compra.unidadeOrgao && compra.unidadeOrgao.municipioNome) || "";
    }
    const resultado = { ufOrgao, municipioOrgao };
    cacheOrgaoUf.set(chaveCompra, resultado);
    return resultado;
  }

  async function enriquecerAta(referenciaAta) {
    const partes = partesNumeroControle(referenciaAta.numeroControlePNCPCompra);
    if (!partes) return null;

    // UF do órgão e lista de itens são independentes entre si — buscar em paralelo em vez de
    // em sequência economiza uma ida-e-volta inteira por ata.
    const [{ ufOrgao, municipioOrgao }, itensResp] = await Promise.all([
      buscarUfOrgao(referenciaAta.numeroControlePNCPCompra),
      fetchComRetentativa(
        `https://pncp.gov.br/api/pncp/v1/orgaos/${partes.cnpj}/compras/${partes.ano}/${partes.sequencial}/itens?pagina=1&tamanhoPagina=50`,
        3, 15000, `itens ata ${referenciaAta.numeroControlePNCPAta}`
      ),
    ]);
    const listaItens = Array.isArray(itensResp) ? itensResp : (itensResp && itensResp.data) || [];

    // Limita a no máx. 30 itens por ata pra não estourar o orçamento numa única contratação
    // com centenas de itens (ex: atas de material de expediente com muitos itens).
    const itensParaBuscar = listaItens.slice(0, 30).filter((item) => item.numeroItem || item.numero);

    // Busca o "resultados" (vencedores) de cada item EM PARALELO, em lotes de até
    // CONCORRENCIA_ATAS requisições simultâneas — antes era 1 chamada de cada vez,
    // sequencial, e uma única ata com 30 itens podia levar até 30x o tempo de ida-e-volta
    // até o PNCP. Cada worker escreve só na posição do SEU PRÓPRIO item (array indexado por
    // posição, não uma lista que cresce por push concorrente), então dois workers nunca
    // podem pisar no resultado um do outro nem misturar item de uma ata com o de outra —
    // essa função só processa os itens de UMA ata por vez (o paralelismo é só entre os itens
    // dessa mesma ata; a próxima ata começa depois que essa terminar).
    const slots = new Array(itensParaBuscar.length).fill(null);
    let cursorItem = 0;
    async function trabalhadorItem() {
      while (cursorItem < itensParaBuscar.length) {
        if (tempoRestanteMs() < 10000) return;
        const indice = cursorItem++;
        const item = itensParaBuscar[indice];
        const numeroItem = item.numeroItem || item.numero;
        const resultados = await fetchComRetentativa(
          `https://pncp.gov.br/api/pncp/v1/orgaos/${partes.cnpj}/compras/${partes.ano}/${partes.sequencial}/itens/${numeroItem}/resultados`,
          3, 15000, `resultados ata ${referenciaAta.numeroControlePNCPAta} item ${numeroItem}`
        );
        const listaResultados = Array.isArray(resultados) ? resultados : (resultados && resultados.data) || [];
        if (listaResultados.length === 0) continue;
        slots[indice] = {
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
        };
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONCORRENCIA_ATAS, itensParaBuscar.length) }, () => trabalhadorItem())
    );
    const itensComVencedor = slots.filter(Boolean);

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

  // 1b) Reconserta atas já coletadas ANTES da correção do endpoint de UF (ver comentário em
  // enriquecerAta acima) — essas ficaram com ufOrgao/municipioOrgao em branco pra sempre,
  // porque o passo 2 abaixo só processa atas NOVAS (pula qualquer chave que já exista no
  // mapa). Sem esse retrabalho, o filtro por estado no painel de "Empresas atuantes" e
  // "Atas vigentes" continuaria vazio pra praticamente todo mundo, mesmo depois do fix,
  // porque quase todas as atas já coletadas têm o defeito antigo. Prioriza as mais recentes
  // (ainda vigentes) primeiro, já que são as mais relevantes pro diagnóstico.
  const pendentesDeUf = Array.from(atasMapa.values())
    .filter((a) => a.enriquecida && !a.ufOrgao)
    .sort((a, b) => new Date(b.vigenciaFim || 0) - new Date(a.vigenciaFim || 0));
  let ufsReconsertadas = 0;
  for (const ata of pendentesDeUf) {
    if (tempoRestanteMs() < 10000) break;
    const { ufOrgao, municipioOrgao } = await buscarUfOrgao(ata.numeroControlePNCPCompra);
    if (ufOrgao) {
      atasMapa.set(ata.numeroControlePNCPAta, { ...ata, ufOrgao, municipioOrgao });
      ufsReconsertadas += 1;
    }
  }
  if (pendentesDeUf.length > 0) {
    console.log(`[atas] Retrabalho de UF: ${ufsReconsertadas}/${pendentesDeUf.length} ata(s) corrigida(s) nesta execução (o resto continua na próxima).`);
  }

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
        const segs = segmentosQueBatem(objeto); // só rótulo informativo agora, não filtra mais
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

  // Conta empresas vencedoras distintas só pro log — o ranking completo (valores, atas
  // vigentes/encerradas por empresa) é recalculado em painel.html (calcularEmpresasMercado),
  // sempre já filtrado pela busca atual do usuário (segmento/UF/período). Calcular esse
  // ranking aqui de novo era trabalho puro perdido: o resultado (empresasArray) nunca era
  // gravado em lugar nenhum (nem Supabase, nem mercado_meta.json) — só virava essa linha de
  // log e era descartado. Ver diagnóstico de estrutura de dados do Diagnóstico de Mercado.
  const cnpjsVencedoresDistintos = new Set();
  for (const ata of atas) {
    if (!ata.enriquecida || !Array.isArray(ata.itens)) continue;
    for (const item of ata.itens) {
      for (const v of item.vencedores || []) {
        if (v.cnpj) cnpjsVencedoresDistintos.add(v.cnpj);
      }
    }
  }

  console.log(
    `[mercado] Concluído: ${janelasProcessadasNestaExecucao} janela(s) de datas varridas nesta execução ` +
    `(${janelasPendentes.length} janela(s) restando pro backfill), ${atasNovas} atas novas enriquecidas, ` +
    `${atasEnfileiradas} enfileiradas pra próxima execução, ${filaPendente.length} pendentes no total, ` +
    `${paginasVarridas} páginas de atas varridas. Total acumulado: ${atas.length} atas, ${cnpjsVencedoresDistintos.size} empresas vencedoras distintas.`
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
  };
}

// ----------------------------------------------------------------------------
// Ponte com o Supabase (ver scripts/supabase_dados.js e
// supabase/schema_dados_mercado.sql). Desde esta versão, contratos_recentes.json
// e mercado_segmentos.json NÃO são mais comitados no git — cada um pesava
// dezenas de MB e, comitado todo dia, disparava um "Production deploy" caro no
// Netlify mesmo sem nenhum usuário acessando o site (Achado #1 do Diagnóstico
// Crítico). Em vez disso: só um arquivo pequeno de "metadados" (sem os
// registros/atas em si) é comitado, e os registros ficam só no banco.
//
// Estratégia (mantém o algoritmo incremental de coletarContratos/
// coletarMercadoSegmentos 100% intocado — eles continuam lendo/escrevendo um
// arquivo local local normalmente):
//   1) ANTES de coletar: reconstrói o arquivo local juntando o metadado (git)
//      com os registros baixados do Supabase — assim o algoritmo enxerga
//      exatamente o mesmo estado "anterior" que enxergaria lendo do git antes.
//   2) Roda a coleta normalmente (sem nenhuma mudança de lógica).
//   3) DEPOIS: separa o resultado em metadado (pequeno, vai pro git) + registros
//      (vão só pro Supabase via upsert), e apaga do banco o que passou da
//      retenção.
const { upsertEmLotes, baixarTodasAsLinhas, removerMaisAntigosQue } = require("./supabase_dados");

async function hidratarContratosDoSupabase(caminhoArquivo, caminhoMeta) {
  const meta = await lerJsonExistente(caminhoMeta);
  if (!meta) {
    console.log("[supabase] Sem metadado anterior de contratos — tratando como 1ª execução.");
    return;
  }
  try {
    const linhas = await baixarTodasAsLinhas("contratos", "dado");
    const registros = linhas.map((l) => l.dado);
    const fs = await import("node:fs/promises");
    await fs.writeFile(caminhoArquivo, JSON.stringify({ ...meta, registros }), "utf8");
    console.log(`[supabase] Hidratado ${registros.length} contrato(s) do Supabase pra continuar o incremental.`);
  } catch (e) {
    console.log(`[supabase] Falha ao baixar contratos existentes (${e && e.message}) — seguindo sem hidratar (pode reprocessar mais do que o normal desta vez).`);
  }
}

async function sincronizarContratosNoSupabase(contratos) {
  const linhas = contratos.registros
    .filter((r) => r.numeroControlePNCP)
    .map((r) => ({
      numero_controle_pncp: r.numeroControlePNCP,
      objeto: r.objeto || "",
      uf: r.uf || null,
      cnpj_fornecedor: r.cnpjFornecedor || null,
      data_assinatura: r.dataAssinatura || null,
      dado: r,
    }));
  try {
    const enviadas = await upsertEmLotes("contratos", linhas, "numero_controle_pncp");
    console.log(`[supabase] ${enviadas} contrato(s) sincronizado(s) na tabela "contratos".`);
    const limiteRetencaoIso = new Date(Date.now() - RETENCAO_DIAS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await removerMaisAntigosQue("contratos", "data_assinatura", limiteRetencaoIso);
  } catch (e) {
    console.log(`[supabase] Falha ao sincronizar contratos (${e && e.message}) — dados continuam só no arquivo local desta execução.`);
  }
}

async function hidratarMercadoDoSupabase(caminhoArquivo, caminhoMeta) {
  const meta = await lerJsonExistente(caminhoMeta);
  if (!meta) {
    console.log("[supabase] Sem metadado anterior de mercado/atas — tratando como 1ª execução.");
    return;
  }
  try {
    const linhas = await baixarTodasAsLinhas("mercado_atas", "dado");
    const atas = linhas.map((l) => l.dado);
    const fs = await import("node:fs/promises");
    await fs.writeFile(caminhoArquivo, JSON.stringify({ ...meta, atas }), "utf8");
    console.log(`[supabase] Hidratada(s) ${atas.length} ata(s) do Supabase pra continuar o incremental.`);
  } catch (e) {
    console.log(`[supabase] Falha ao baixar atas existentes (${e && e.message}) — seguindo sem hidratar.`);
  }
}

async function sincronizarMercadoNoSupabase(mercado) {
  const linhas = (mercado.atas || [])
    .filter((a) => a.numeroControlePNCPAta)
    .map((a) => ({
      numero_controle_pncp_ata: a.numeroControlePNCPAta,
      numero_controle_pncp_compra: a.numeroControlePNCPCompra || null,
      objeto: a.objeto || "",
      uf_orgao: a.ufOrgao || null,
      municipio_orgao: a.municipioOrgao || null,
      segmentos: a.segmentos || [],
      data_assinatura: a.dataAssinatura || null,
      vigencia_fim: a.vigenciaFim || null,
      cancelado: !!a.cancelado,
      enriquecida: !!a.enriquecida,
      dado: a,
    }));
  try {
    const enviadas = await upsertEmLotes("mercado_atas", linhas, "numero_controle_pncp_ata");
    console.log(`[supabase] ${enviadas} ata(s) sincronizada(s) na tabela "mercado_atas".`);
  } catch (e) {
    console.log(`[supabase] Falha ao sincronizar atas (${e && e.message}) — dados continuam só no arquivo local desta execução.`);
  }
}

async function main() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const dirDados = path.join(process.cwd(), "data");
  await fs.mkdir(dirDados, { recursive: true });

  console.log(`Iniciando coleta incremental. Retenção: ${RETENCAO_DIAS} dias.`);

  const caminhoContratos = path.join(dirDados, "contratos_recentes.json");
  const caminhoContratosMeta = path.join(dirDados, "contratos_meta.json");
  await hidratarContratosDoSupabase(caminhoContratos, caminhoContratosMeta);

  iniciarFase(LIMITE_MINUTOS_CONTRATOS);
  const contratos = await coletarContratos(caminhoContratos);
  await fs.writeFile(caminhoContratos, JSON.stringify(contratos), "utf8");
  const { registros: _registrosContratos, ...contratosMeta } = contratos;
  await fs.writeFile(caminhoContratosMeta, JSON.stringify(contratosMeta), "utf8");
  console.log("Gravado data/contratos_meta.json (metadado leve, vai pro git)");
  await sincronizarContratosNoSupabase(contratos);

  const caminhoOportunidades = path.join(dirDados, "oportunidades_abertas.json");
  const oportunidades = await coletarOportunidadesAbertas(caminhoOportunidades);
  await fs.writeFile(caminhoOportunidades, JSON.stringify(oportunidades), "utf8");
  console.log("Gravado data/oportunidades_abertas.json");

  const caminhoMercado = path.join(dirDados, "mercado_segmentos.json");
  const caminhoMercadoMeta = path.join(dirDados, "mercado_meta.json");
  await hidratarMercadoDoSupabase(caminhoMercado, caminhoMercadoMeta);

  iniciarFase(LIMITE_MINUTOS_MERCADO);
  const mercado = await coletarMercadoSegmentos(caminhoMercado);
  await fs.writeFile(caminhoMercado, JSON.stringify(mercado), "utf8");
  // "empresas" não é mais nem calculado aqui (ver coletarMercadoSegmentos): o painel já
  // recalcula esse ranking sozinho a partir das atas filtradas (calcularEmpresasMercado em
  // painel.html) — calcular nunca era gravado (nem no git, nem no Supabase) e só desperdiçava
  // CPU do robô a cada execução (era 6,3 MB dos 9,6 MB do arquivo antigo, quando ainda ia pro
  // disco à toa).
  const { atas: _atasMercado, ...mercadoMeta } = mercado;
  await fs.writeFile(caminhoMercadoMeta, JSON.stringify(mercadoMeta), "utf8");
  console.log("Gravado data/mercado_meta.json (metadado leve, vai pro git)");
  await sincronizarMercadoNoSupabase(mercado);

  console.log("Coleta finalizada com sucesso.");
}

main().catch((e) => {
  console.error("Erro fatal no robô de coleta:", e);
  process.exit(1);
});
