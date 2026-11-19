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
//   PAUSA_429_MS_OPORTUNIDADES=5000 -> base do backoff global após 429 sem Retry-After (dobra a
//                                    cada tentativa, teto 60s) — ver esperaAposRateLimitMs()
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
//      uma chamada por item), por isso o gargalo real é tempo de rede, não escopo de busca.

const DIAS_HISTORICO_INICIAL = parseInt(process.env.DIAS_HISTORICO_INICIAL || "30", 10);
const RETENCAO_DIAS = parseInt(process.env.RETENCAO_DIAS || "730", 10);
const FOLGA_DIAS = 2; // re-busca os últimos dias pra pegar publicações atrasadas no PNCP
const LIMITE_MINUTOS_CONTRATOS = parseFloat(process.env.LIMITE_MINUTOS_CONTRATOS || "13");
const LIMITE_MINUTOS_MERCADO = parseFloat(process.env.LIMITE_MINUTOS_MERCADO || "13");
const CONCORRENCIA_PAGINAS = parseInt(process.env.CONCORRENCIA_PAGINAS || "5", 10);
// Quantas chamadas de "resultados de item" (o passo mais repetitivo do enriquecimento de uma
// ata — uma por item) rodam em paralelo. Cada ata é enriquecida por completo
// antes de passar pra próxima (não paraleliza ENTRE atas), então nunca mistura itens de atas
// diferentes — só acelera os itens de UMA MESMA ata, que antes eram sequenciais.
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

// aoLimitarTaxa(retryAfter, tentativa): opcional. Quando a fonte devolve 429, o chamador
// que tem um limitador global pausa TODOS os workers de uma vez (ver
// coletarOportunidadesAbertas). Sem ele, esta função espera sozinha.
async function fetchComRetentativa(url, tentativas = 2, timeoutMs = 20000, rotulo = "", antesDaTentativa = null, aoLimitarTaxa = null) {
  for (let i = 0; i < tentativas; i++) {
    let t;
    try {
      // Algumas fontes (em especial o endpoint de propostas do PNCP) aplicam o
      // limite por IP, não por requisição individual. O chamador pode fornecer
      // um limitador compartilhado para que até as retentativas respeitem a
      // cadência da fonte, sem tornar os demais coletores mais lentos.
      if (antesDaTentativa) await antesDaTentativa();
      const ctrl = new AbortController();
      t = setTimeout(() => ctrl.abort(), timeoutMs);
      const resp = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: ctrl.signal,
      });
      if (resp.status === 429) {
        if (i === tentativas - 1) {
          console.log(`[fetch${rotulo ? " " + rotulo : ""}] Rate-limit (429) persistente após ${tentativas} tentativa(s) em ${url}`);
          return null;
        }
        const retryAfter = resp.headers && resp.headers.get ? resp.headers.get("retry-after") : null;
        if (aoLimitarTaxa) aoLimitarTaxa(retryAfter, i);
        else await new Promise((r) => setTimeout(r, esperaAposRateLimitMs(retryAfter, i, 1000)));
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
    } finally {
      // O prazo inclui o corpo da resposta, não apenas os cabeçalhos.
      if (t) clearTimeout(t);
    }
  }
  return null;
}

// Antes o 429 esperava 1s, 2s, 4s (7s no total em 4 tentativas) e ignorava Retry-After:
// em 18/11 a recuperação teve 26 de 27 UFs com "429 persistente" na primeira passada e 11
// na segunda, todas dentro desses 7s.
// Agora respeita Retry-After (segundos ou data HTTP) e, sem ele, dobra a partir de baseMs.
// O teto impede que um único pedido da fonte consuma o orçamento da fase.
const TETO_PAUSA_429_MS = 60000;
function esperaAposRateLimitMs(retryAfter, tentativa, baseMs) {
  const segundos = Number(retryAfter);
  const pedido = retryAfter && Number.isFinite(segundos) ? segundos * 1000 : Date.parse(retryAfter) - Date.now();
  const backoff = baseMs * 2 ** tentativa + Math.random() * 300;
  return Math.min(TETO_PAUSA_429_MS, Math.max(backoff, Number.isFinite(pedido) ? pedido : 0));
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
async function buscarPaginasEmLote(montarUrl, paginaInicial, totalPaginasConhecido, concorrencia, aoReceberPagina, anterior = null) {
  let totalPaginas = totalPaginasConhecido || 1;
  let paginasVarridas = 0;
  let parouPorTempo = false;
  let falhaConsecutivas = 0;
  let houveFalha = false;
  const valida = (dado, numero) => dado && Array.isArray(dado.data) && Number.isSafeInteger(dado.totalPaginas) && dado.totalPaginas >= 0 &&
    (dado.totalRegistros === undefined || (Number.isSafeInteger(dado.totalRegistros) && dado.totalRegistros >= 0)) &&
    (dado.totalPaginas > 0 || (dado.data.length === 0 && !dado.totalRegistros)) && (dado.data.length > 0 || !dado.totalRegistros) &&
    dado.data.every((r) => typeof r?.numeroControlePNCP === "string" && r.numeroControlePNCP.trim()) &&
    new Set(dado.data.map((r) => r.numeroControlePNCP)).size === dado.data.length &&
    (dado.numeroPagina === undefined || dado.numeroPagina === numero);
  const assinatura = (dado) => JSON.stringify([dado.totalPaginas, dado.totalRegistros, dado.data.map((r) => r.numeroControlePNCP)]);
  if (tempoRestanteMs() < 12000) return { paginasVarridas, totalPaginas, parcial: true, progresso: anterior };
  const primeira = await fetchComRetentativa(montarUrl(1));
  if (!valida(primeira, 1)) return { paginasVarridas, totalPaginas, parcial: true, progresso: anterior };
  totalPaginas = primeira.totalPaginas;
  let progresso = anterior && anterior.consulta === montarUrl(1) && anterior.primeiraPagina === assinatura(primeira) &&
    Array.isArray(anterior.ids) && new Set(anterior.ids).size === anterior.ids.length &&
    (anterior.proximaPagina === 1 || anterior.ids.length >= primeira.data.length) &&
    Number.isSafeInteger(anterior.proximaPagina) && anterior.proximaPagina > 0 && anterior.proximaPagina <= Math.max(1, totalPaginas) + 1
    ? { ...anterior, ids: [...anterior.ids] }
    : { consulta: montarUrl(1), primeiraPagina: assinatura(primeira), iniciadoEm: new Date().toISOString(), proximaPagina: paginaInicial, ids: [] };
  let proximaPagina = progresso.proximaPagina;
  const recebidas = new Map();
  const ids = new Set(progresso.ids);
  if (proximaPagina === 1) {
    for (const item of primeira.data) ids.add(item.numeroControlePNCP);
    progresso.ids = Array.from(ids);
    aoReceberPagina(primeira, 1);
    paginasVarridas++;
    proximaPagina = 2;
    progresso.proximaPagina = 2;
  }

  async function trabalhador() {
    while (true) {
      if (!progresso) return;
      if (tempoRestanteMs() < 12000) { parouPorTempo = true; return; }
      if (proximaPagina > totalPaginas) return;
      const paginaAtual = proximaPagina;
      proximaPagina += 1;
      const dados = await fetchComRetentativa(montarUrl(paginaAtual));
      if (!progresso) return;
      if (!valida(dados, paginaAtual)) {
        houveFalha = true;
        falhaConsecutivas += 1;
        if (falhaConsecutivas > 8) { parouPorTempo = true; return; }
        continue;
      }
      falhaConsecutivas = 0;
      if (dados.totalPaginas !== totalPaginas || dados.totalRegistros !== primeira.totalRegistros) { houveFalha = true; progresso = null; return; }
      const idsPagina = dados.data.map((r) => r.numeroControlePNCP);
      if (idsPagina.some((id) => ids.has(id))) { houveFalha = true; progresso = null; return; }
      for (const id of idsPagina) ids.add(id);
      paginasVarridas += 1;
      aoReceberPagina(dados, paginaAtual);
      recebidas.set(paginaAtual, idsPagina);
      while (recebidas.has(progresso.proximaPagina)) {
        progresso.ids.push(...recebidas.get(progresso.proximaPagina));
        recebidas.delete(progresso.proximaPagina++);
      }
    }
  }

  const trabalhadores = Array.from({ length: concorrencia }, () => trabalhador());
  await Promise.all(trabalhadores);

  let parcial = houveFalha || parouPorTempo || proximaPagina <= totalPaginas;
  if (!parcial && primeira.totalRegistros !== undefined && ids.size !== primeira.totalRegistros) { parcial = true; progresso = null; }
  if (!parcial && totalPaginas > 1) {
    if (tempoRestanteMs() < 12000) parcial = true;
    else {
      const conferida = await fetchComRetentativa(montarUrl(1));
      if (!valida(conferida, 1)) parcial = true;
      else if (assinatura(conferida) !== assinatura(primeira)) { parcial = true; progresso = null; }
    }
  }
  return { paginasVarridas, totalPaginas, parcial, progresso: parcial ? progresso : null };
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

async function coletarContratosComplementarPorUf(registrosExistentes, anteriores = {}) {
  iniciarFase(LIMITE_MINUTOS_CONTRATOS_UF);
  const conhecidos = new Set(registrosExistentes.map((r) => r.numeroControlePNCP).filter(Boolean));
  const contagemPorUf = contarRegistrosPorUf(registrosExistentes);
  // Prioriza sempre os estados com MENOS registros hoje — é assim que os "buracos" (ex: AM)
  // vão sendo preenchidos primeiro, em vez de sempre reprocessar os estados já robustos.
  const filaUfs = [...UFS].sort((a, b) => contagemPorUf.get(a) - contagemPorUf.get(b));
  const novos = [];
  const ufsOk = [];
  const progressoPorUf = { ...anteriores };

  async function processarUf(uf) {
    const buscarPagina = (pagina) => {
      const params = new URLSearchParams({
        tipos_documento: "contrato", status: "todos", ufs: uf,
        ordenacao: "-data", tam_pagina: "50", pagina: String(pagina),
      });
      return fetchComRetentativa(`https://pncp.gov.br/api/search?${params}`, 2, 15000, `contratos ${uf}`);
    };
    const assinatura = (dados) => JSON.stringify([dados.total, dados.items.map((r) => r.numero_controle_pncp)]);
    const primeira = await buscarPagina(1);
    if (!primeira || !Array.isArray(primeira.items)) return false;
    let progresso = progressoPorUf[uf];
    if (!progresso || progresso.primeiraPagina !== assinatura(primeira) || !Number.isSafeInteger(progresso.proximaPagina) || progresso.proximaPagina < 1) {
      progresso = { primeiraPagina: assinatura(primeira), proximaPagina: 1 };
    } else progresso = { ...progresso };
    progressoPorUf[uf] = progresso;
    let pagina = progresso.proximaPagina;
    let detalhesOk = true;
    // O teto divide o trabalho entre UFs; o cursor retoma além dele na próxima execução.
    for (let varridas = 0; varridas < MAX_PAGINAS_POR_UF_CONTRATOS; varridas++) {
      if (tempoRestanteMs() < 10000) return false;
      const dados = pagina === 1 ? primeira : await buscarPagina(pagina);
      if (!dados || !Array.isArray(dados.items)) return false;
      if (dados.total !== primeira.total) { delete progressoPorUf[uf]; return false; }
      for (const item of dados.items) {
        if (tempoRestanteMs() < 8000) return false;
        const numero = item.numero_controle_pncp;
        if (!numero || conhecidos.has(numero)) continue;
        conhecidos.add(numero); // evita re-tentar o mesmo contrato 2x na mesma execução
        const detalhe = await buscarDetalheContrato(numero);
        if (!detalhe) { detalhesOk = false; continue; }
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
      if (!detalhesOk) return false;
      if (dados.items.length < 50) {
        if (tempoRestanteMs() < 10000) return false;
        const conferida = await buscarPagina(1);
        if (!conferida || !Array.isArray(conferida.items)) return false;
        delete progressoPorUf[uf];
        return assinatura(conferida) === progresso.primeiraPagina;
      }
      pagina += 1;
      progresso.proximaPagina = pagina;
    }
    return false;
  }

  async function trabalhador() {
    while (filaUfs.length > 0) {
      if (tempoRestanteMs() < 10000) return false;
      const uf = filaUfs.shift();
      if (!uf) return;
      if (await processarUf(uf)) ufsOk.push(uf);
    }
  }

  await Promise.all(Array.from({ length: CONCORRENCIA_UF_CONTRATOS }, () => trabalhador()));
  console.log(`[contratos-uf] Complementar concluído: ${novos.length} contrato(s) novo(s) em ${ufsOk.length} UF(s) processada(s) (priorizando as menos cobertas).`);
  return { registros: novos, ufsComFalha: UFS.filter((uf) => !ufsOk.includes(uf)), progressoPorUf };
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
  const dataInicial = existentes?.consultaPendente?.dataInicial || fmtData(inicio);
  const dataFinal = existentes?.consultaPendente?.dataFinal || fmtData(hoje);

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
  }, existentes?.consultaPendente?.paginacao);

  // Junta com o que já tinha, deduplicando, e descarta o que passou da retenção.
  const mapa = new Map();
  if (existentes && Array.isArray(existentes.registros)) {
    for (const r of existentes.registros) mapa.set(chaveRegistro(r), r);
  }
  // Só o que veio da fonte nesta execução vai para o upsert (ver sincronizarContratosNoSupabase).
  const chavesDaExecucao = new Set();
  for (const r of novos) { mapa.set(chaveRegistro(r), r); chavesDaExecucao.add(chaveRegistro(r)); }

  // Passada complementar por UF (ver coletarContratosComplementarPorUf acima) — preenche os
  // estados que o scan nacional deixou de fora, usando o que já temos (existentes + novos
  // desta execução) pra saber quais estados priorizar.
  let ufsComFalha = [...UFS];
  let progressoPorUf = existentes?.progressoPorUf || {};
  try {
    const baseParaContagem = Array.from(mapa.values());
    const complementares = await coletarContratosComplementarPorUf(baseParaContagem, progressoPorUf);
    ufsComFalha = complementares.ufsComFalha;
    progressoPorUf = complementares.progressoPorUf || {};
    for (const r of complementares.registros) { mapa.set(chaveRegistro(r), r); chavesDaExecucao.add(chaveRegistro(r)); }
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
    // Repetir a janela incompleta evita perder páginas antigas no incremental.
    dataFinal: resultado.parcial ? ((existentes && existentes.dataFinal) || dataInicial) : dataFinal,
    retencaoDias: RETENCAO_DIAS,
    totalRegistros: registros.length,
    paginasVarridas: resultado.paginasVarridas,
    totalPaginasDisponiveis: resultado.totalPaginas,
    consultaPendente: resultado.parcial ? { dataInicial, dataFinal, paginacao: resultado.progresso } : null,
    parcial: resultado.parcial || ufsComFalha.length > 0,
    ufsComFalha,
    progressoPorUf,
    registros,
    novosNaExecucao: registros.filter((r) => chavesDaExecucao.has(chaveRegistro(r))),
  };
}

// ---------- Oportunidades (por UF) — ACUMULADO, não só "abertas agora" ----------
// A API do PNCP (/contratacoes/proposta) só devolve o que ainda está com prazo de
// proposta aberto hoje. Pra permitir busca retroativa no site (ex: "o que foi publicado
// nos últimos 30/60 dias", incluindo o que já encerrou nesse meio tempo), este robô
// FUNDE o resultado de cada execução com o que já tinha coletado antes (por
// numeroControlePNCP), em vez de sobrescrever o arquivo do zero. Registros somem do
// arquivo só quando seu encerramento confirmado fica mais velho que RETENCAO_DIAS_OPORTUNIDADES.
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

function ufsPendentesDeAtualizacao(existentes, agora = new Date()) {
  // Virar o dia UTC não garante uma coleta recente durante o expediente local.
  const limiteAtualizacao = agora.getTime() - 6 * 60 * 60 * 1000;
  const falhas = new Set(Array.isArray(existentes && existentes.ufsComFalha) ? existentes.ufsComFalha : []);
  const cobertura = (existentes && existentes.coberturaPorUf) || {};
  return UFS.filter((uf) => {
    const atualizadoEm = cobertura[uf] && cobertura[uf].atualizadoEm;
    const ultimaColeta = atualizadoEm ? new Date(atualizadoEm).getTime() : NaN;
    return falhas.has(uf) || !!existentes?.paginasPendentesPorUf?.[uf] || !Number.isFinite(ultimaColeta) || ultimaColeta <= limiteAtualizacao;
  });
}

function dataEncerramentoIso(valor) {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(valor) || !Number.isFinite(Date.parse(valor))) return null;
  const dia = valor.slice(0, 10);
  return new Date(`${dia}T00:00:00Z`).toISOString().slice(0, 10) === dia ? dia : null;
}

async function coletarOportunidadesAbertas(caminhoArquivo) {
  // Orçamento maior (era 6 min fixo) e busca em PARALELO por UF (era 1 UF de cada vez) —
  // com 27 UFs e a API do PNCP às vezes lenta, rodar sequencial estourava o orçamento
  // depois de só 8-9 UFs e o resto nunca era nem tentado. Um pool de workers concorrentes
  // consegue cobrir muito mais UFs no mesmo tempo, do mesmo jeito que coletarContratos já
  // faz pras páginas de contratos.
  const ORCAMENTO_MINUTOS_OPORTUNIDADES = parseFloat(process.env.LIMITE_MINUTOS_OPORTUNIDADES || "18");
  // O endpoint de propostas do PNCP é especialmente sensível a rajadas paralelas. Quando
  // seis UFs eram consultadas ao mesmo tempo, uma indisponibilidade momentânea podia fazer
  // as 27 falharem e o job ainda terminar "verde" usando apenas o cache antigo. Mantemos
  // uma concorrência moderada por padrão e deixamos o valor configurável no workflow.
  const CONCORRENCIA_UF = parseInt(process.env.CONCORRENCIA_UF_OPORTUNIDADES || "3", 10);
  // O PNCP começa a recusar a origem quando várias páginas são pedidas em
  // sequência. Este limitador é GLOBAL à fase (não um atraso por worker): três
  // workers ainda preparam e consolidam resultados em paralelo, mas somente uma
  // chamada ao endpoint sai a cada intervalo. Assim 27 UFs cabem no orçamento
  // sem transformar uma rajada em 26 falhas de cobertura.
  const INTERVALO_MS = parseInt(process.env.INTERVALO_MS_OPORTUNIDADES || "700", 10);
  // Quando a própria fonte fica indisponível, insistir nas 27 UFs multiplica
  // timeouts sem recuperar dado algum. Três sondas independentes falhando antes
  // do primeiro sucesso caracterizam indisponibilidade da fonte, não falta de
  // cobertura de um estado específico.
  const LIMIAR_FALHAS_FONTE = parseInt(process.env.LIMIAR_FALHAS_FONTE_OPORTUNIDADES || "3", 10);
  let proximaChamadaEm = 0;
  let falhasAntesDoPrimeiroSucesso = 0;
  let fonteIndisponivel = false;
  async function respeitarCadenciaPncp() {
    const agora = Date.now();
    const espera = Math.max(0, proximaChamadaEm - agora);
    proximaChamadaEm = Math.max(agora, proximaChamadaEm) + INTERVALO_MS;
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
  }
  // O limite do endpoint é por origem: se cada worker insistisse sozinho após um 429, os
  // outros continuariam batendo durante a pausa. Um 429 adia a próxima chamada de TODOS.
  const PAUSA_429_MS = parseInt(process.env.PAUSA_429_MS_OPORTUNIDADES || "5000", 10);
  function pausarCadenciaPncp(retryAfter, tentativa) {
    proximaChamadaEm = Math.max(proximaChamadaEm, Date.now() + esperaAposRateLimitMs(retryAfter, tentativa, PAUSA_429_MS));
  }
  iniciarFase(ORCAMENTO_MINUTOS_OPORTUNIDADES);
  const existentes = await lerJsonExistente(caminhoArquivo);
  const recuperarPendentes = process.env.RECUPERAR_UFS_PENDENTES === "1";
  const pendentesAnteriores = new Set(ufsPendentesDeAtualizacao(existentes));
  // Uma UF sem erro também precisa de recuperação se sua última coleta ficou em
  // outro dia. Só olhar ufsComFalha deixava AM preso em 03/09, mesmo com editais
  // novos disponíveis. UFs já coletadas hoje (UTC, como o cron) não são repetidas.
  const ufsAlvo = recuperarPendentes && pendentesAnteriores.size > 0
    ? UFS.filter((uf) => pendentesAnteriores.has(uf))
    : UFS;
  if (recuperarPendentes && pendentesAnteriores.size === 0) {
    console.log("[oportunidades] Recuperação dispensada: não há UFs pendentes no último boletim.");
    return { ...existentes, semPendencias: true, ufsOkNaExecucao: [] };
  }
  const hoje = new Date();
  const dataFinal = fmtData(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));
  const todas = [];
  let ufsComFalha = [];
  let ufsOk = [];
  const coberturaPorUf = { ...((existentes && existentes.coberturaPorUf) || {}) };
  const paginasPendentesPorUf = { ...((existentes && existentes.paginasPendentesPorUf) || {}) };

  const filaUfs = [...ufsAlvo];

  async function processarUf(uf) {
    if (fonteIndisponivel) {
      ufsComFalha.push(uf);
      return;
    }
    let progresso = paginasPendentesPorUf[uf];
    if (!progresso || Date.now() - Date.parse(progresso.iniciadoEm) > 6 * 60 * 60 * 1000 ||
        !Number.isFinite(Date.parse(progresso.iniciadoEm)) || !/^\d{8}$/.test(progresso.dataFinal) ||
        !Number.isSafeInteger(progresso.proximaPagina) || progresso.proximaPagina < 1 ||
        progresso.proximaPagina > Math.max(1, progresso.totalPaginas) + 1 || !Array.isArray(progresso.ids)) progresso = null;
    const fimConsulta = progresso?.dataFinal || dataFinal;
    const buscarPagina = (pagina) => fetchComRetentativa(
      `https://pncp.gov.br/api/consulta/v1/contratacoes/proposta?uf=${uf}&dataFinal=${fimConsulta}&pagina=${pagina}&tamanhoPagina=50`,
      4, 25000, `oportunidades ${uf}`, respeitarCadenciaPncp, pausarCadenciaPncp);
    const assinatura = (dado) => JSON.stringify([dado.totalPaginas, dado.totalRegistros, dado.data.map((r) => r.numeroControlePNCP)]);
    const paginaValida = (dado, numero) => dado && Array.isArray(dado.data) &&
      Number.isSafeInteger(dado.totalPaginas) && dado.totalPaginas >= 0 &&
      (dado.numeroPagina === undefined || dado.numeroPagina === numero) &&
      (dado.totalPaginas > 0 || dado.data.length === 0) && dado.data.every((r) => r.numeroControlePNCP);
    const primeira = await buscarPagina(1);
    if (paginaValida(primeira, 1) && (!progresso || progresso.primeiraPagina !== assinatura(primeira))) {
      progresso = { dataFinal: fimConsulta, iniciadoEm: new Date().toISOString(), primeiraPagina: assinatura(primeira),
        proximaPagina: 1, totalPaginas: primeira.totalPaginas, totalRegistros: primeira.totalRegistros, ids: [] };
    }
    let pagina = progresso?.proximaPagina || 1;
    const totalPaginas = progresso?.totalPaginas || 1;
    const ids = new Set(progresso?.ids || []);
    let falhouUf = false;
    if (!paginaValida(primeira, 1)) falhouUf = true;

    while (!falhouUf && pagina <= totalPaginas) {
      if (tempoRestanteMs() < 8000) { falhouUf = true; break; }
      // Para oportunidades, uma resposta perdida significa um boletim incompleto. Usa mais
      // tentativas que as coletas de enriquecimento, com o backoff já centralizado acima.
      const dados = pagina === 1 ? primeira : await buscarPagina(pagina);
      if (!paginaValida(dados, pagina)) { falhouUf = true; break; }
      const itens = dados.data;
      if (dados.totalPaginas !== progresso.totalPaginas || dados.totalRegistros !== progresso.totalRegistros ||
          itens.some((r) => ids.has(r.numeroControlePNCP)) || new Set(itens.map((r) => r.numeroControlePNCP)).size !== itens.length) {
        progresso = null; falhouUf = true; break;
      }

      for (const item of itens) {
        ids.add(item.numeroControlePNCP);
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
      progresso = { ...progresso, proximaPagina: pagina, ids: [...ids] };
    }
    if (pagina <= totalPaginas) falhouUf = true;
    if (!falhouUf && progresso.totalRegistros !== undefined && ids.size !== progresso.totalRegistros) {
      progresso = null; falhouUf = true;
    }
    if (!falhouUf && totalPaginas > 1) {
      if (tempoRestanteMs() < 8000) falhouUf = true;
      else {
        const conferida = await buscarPagina(1);
        if (!paginaValida(conferida, 1)) falhouUf = true;
        else if (assinatura(conferida) !== progresso.primeiraPagina) { progresso = null; falhouUf = true; }
      }
    }
    if (falhouUf && progresso) paginasPendentesPorUf[uf] = progresso;
    else delete paginasPendentesPorUf[uf];
    if (falhouUf) {
      ufsComFalha.push(uf);
      if (ufsOk.length === 0) {
        falhasAntesDoPrimeiroSucesso += 1;
        if (falhasAntesDoPrimeiroSucesso >= LIMIAR_FALHAS_FONTE) {
          fonteIndisponivel = true;
          console.log(`[oportunidades] Circuit breaker ativado: ${falhasAntesDoPrimeiroSucesso} UFs falharam antes do primeiro sucesso. Interrompendo tentativas que só repetiriam a indisponibilidade da fonte.`);
        }
      }
    } else {
      ufsOk.push(uf);
      coberturaPorUf[uf] = {
        atualizadoEm: new Date().toISOString(),
        registrosColetados: ids.size,
      };
    }
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
    // UF não tentada também é falha de cobertura; sem isso uma execução que esgotasse o
    // tempo antes de concluir a fila poderia parecer parcialmente saudável.
    ufsComFalha.push(...filaUfs);
  }

  // Segunda passada só nas UFs que falharam na primeira: falhas de UF individual costumam
  // ser instabilidade pontual do PNCP (timeout numa página específica), não um problema
  // sistêmico — tentar de novo, agora sem concorrência de outras 5 UFs disputando a mesma
  // API, resolve a maioria dos casos (era comum um estado como "AM" falhar sozinho mesmo
  // com todas as outras 26 UFs tendo sido coletadas com sucesso na mesma execução).
  if (ufsComFalha.length > 0 && !fonteIndisponivel && tempoRestanteMs() > 20000) {
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

  const limiteRetencaoIso = new Date(hoje.getTime() - RETENCAO_DIAS_OPORTUNIDADES * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const registros = Array.from(mapa.values()).filter((r) => {
    // Publicação antiga não significa oportunidade encerrada; a coluna do banco usa o mesmo dia civil.
    const encerramento = dataEncerramentoIso(r.encerramento);
    return !encerramento || encerramento >= limiteRetencaoIso;
  });

  console.log(
    `[oportunidades] Concluído: ${todas.length} vistas nesta execução (UFs ok: ${ufsOk.length}, falhas em: ${ufsComFalha.join(", ") || "nenhuma"}). ` +
    `Total acumulado após fundir/podar (retenção ${RETENCAO_DIAS_OPORTUNIDADES}d): ${registros.length} registros.`
  );

  const falhasDestaExecucao = [...new Set(ufsComFalha)];
  const ufsComFalhaFinais = recuperarPendentes
    ? UFS.filter((uf) => ufsAlvo.includes(uf) ? falhasDestaExecucao.includes(uf) : pendentesAnteriores.has(uf))
    : falhasDestaExecucao;
  const tentativaEm = new Date().toISOString();
  // Uma indisponibilidade total do PNCP não pode se passar por atualização recente.
  // Mantemos o último instante de dados efetivamente coletados e registramos a tentativa
  // separadamente; assim o painel pode avisar sobre a fonte sem derrubar a base já útil.
  const houveAtualizacao = ufsOk.length > 0;
  return {
    atualizadoEm: houveAtualizacao ? tentativaEm : ((existentes && existentes.atualizadoEm) || tentativaEm),
    ultimaTentativaEm: tentativaEm,
    retencaoDias: RETENCAO_DIAS_OPORTUNIDADES,
    totalRegistros: registros.length,
    ufsComFalha: ufsComFalhaFinais,
    ufsOk: UFS.filter((uf) => !ufsComFalhaFinais.includes(uf)),
    ufsOkNaExecucao: [...new Set(ufsOk)],
    coberturaPorUf,
    paginasPendentesPorUf,
    saudeFonte: fonteIndisponivel ? "indisponivel" : (ufsComFalha.length ? "parcial" : "ok"),
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
// Situações terminais do PNCP em que um item de licitação NÃO teve vencedor — usadas pra
// alimentar a aba "Baixa Concorrência" (proxy de baixa disputa, já que o PNCP não expõe
// contagem direta de participantes por item, só o desfecho final).
const SITUACOES_SEM_VENCEDOR_TERMOS = ["Deserto", "Fracassado", "Anulado", "Revogado", "Cancelado"];
// O PNCP às vezes devolve a situação como valor único combinado (ex: "Anulado/Revogado/
// Cancelado") em vez de um dos termos isolados — comparação exata com Set.has() nunca batia
// pra esses casos e metade do sinal de "baixa concorrência" nunca era capturado. Corrigido pra
// checagem por substring: basta a situação CONTER um dos termos-chave.
function situacaoSemVencedor(situacao) {
  if (!situacao) return false;
  return SITUACOES_SEM_VENCEDOR_TERMOS.some((termo) => situacao.includes(termo));
}

// Cache de consultas de marca por (código de catálogo do item + UASG) — o mesmo par se repete
// bastante quando várias atas do mesmo órgão compram o mesmo material catalogado, então cachear
// evita bater na API do Compras.gov.br mais de uma vez pro mesmo material+órgão.
const cacheMarcaProduto = new Map();

function normalizarDocumentoFornecedor(valor) {
  return String(valor || "").replace(/\D/g, "");
}

// Busca marca do produto na API pública de Pesquisa de Preço do Compras.gov.br
// (dadosabertos.compras.gov.br/modulo-pesquisapreco/1_consultarMaterial). Essa API é alimentada
// a partir de compras já homologadas no Comprasnet/SISPP-SISRP — sistema que efetivamente RODA
// os pregões federais (o PNCP só divulga; não tem campo de marca no seu próprio resultado de
// item). Cobertura é parcial: só funciona pra itens de órgãos federais/distritais (que têm UASG)
// cujo material tem código de catálogo (CATMAT/CATSER) e cuja marca foi de fato preenchida pelo
// fornecedor no Comprasnet ("marca, caso exista" — nem todo item tem).
async function buscarMarcasProduto(codigoCatalogo, uasg) {
  if (!codigoCatalogo || !uasg) return new Map();
  const chave = `${codigoCatalogo}|${uasg}`;
  if (cacheMarcaProduto.has(chave)) return cacheMarcaProduto.get(chave);
  const resp = await fetchComRetentativa(
    `https://dadosabertos.compras.gov.br/modulo-pesquisapreco/1_consultarMaterial?codigoItemCatalogo=${encodeURIComponent(codigoCatalogo)}&codigoUasg=${encodeURIComponent(uasg)}&tamanhoPagina=100&pagina=1`,
    2, 15000, `marca catalogo ${codigoCatalogo} uasg ${uasg}`
  );
  const lista = (resp && Array.isArray(resp.resultado)) ? resp.resultado : [];
  // Indexa por CNPJ do fornecedor -> marca mais recente (dataResultado), pra casar depois com
  // cada vencedor de item pelo mesmo CNPJ. Um mesmo fornecedor pode aparecer mais de uma vez
  // (materiais/datas diferentes dentro do mesmo catálogo+UASG); fica a ocorrência mais recente.
  const porFornecedor = new Map();
  for (const r of lista) {
    // A API de preços pode devolver CNPJ com formatação e variar o nome do campo de marca
    // entre registros legados. Normalizar aqui garante que o vencedor do PNCP seja casado
    // mesmo quando a representação do documento não é idêntica.
    const documento = normalizarDocumentoFornecedor(r.niFornecedor || r.cnpjFornecedor || r.cnpj);
    const marca = r.marca || r.nomeMarca || r.descricaoMarca;
    if (!documento || !marca) continue;
    const existente = porFornecedor.get(documento);
    const dataR = r.dataResultado || r.dataCompra || null;
    if (!existente || (dataR && new Date(dataR) > new Date(existente.data || 0))) {
      porFornecedor.set(documento, { marca, data: dataR });
    }
  }
  cacheMarcaProduto.set(chave, porFornecedor);
  return porFornecedor;
}

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
  const progressoAtas = { ...((existentes && existentes.progressoAtas) || {}) };

  const cacheOrgaoUf = new Map();

  async function buscarUfOrgao(numeroControlePNCPCompra) {
    const partes = partesNumeroControle(numeroControlePNCPCompra);
    if (!partes) return { ufOrgao: "", municipioOrgao: "", uasg: "" };
    const chaveCompra = `${partes.cnpj}|${partes.ano}|${partes.sequencial}`;
    if (cacheOrgaoUf.has(chaveCompra)) return cacheOrgaoUf.get(chaveCompra);
    let ufOrgao = "", municipioOrgao = "", uasg = "";
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
      // UASG só existe pra órgãos federais/distritais — reaproveita o mesmo campo que a UI já
      // usa em Encontrar Licitações (unidadeOrgao.codigoUnidade). É a chave que a API pública
      // de Pesquisa de Preço do Compras.gov.br (dadosabertos.compras.gov.br) exige pra filtrar
      // resultados por órgão comprador — sem UASG não dá pra consultar marca do produto ali.
      uasg = (compra.unidadeOrgao && compra.unidadeOrgao.codigoUnidade) || "";
    }
    const compraValida = !!compra && (!compra.numeroControlePNCP || compra.numeroControlePNCP === numeroControlePNCPCompra);
    const resultado = { ufOrgao, municipioOrgao, uasg, compraValida, versaoCompra: hashProgressoAtas(compra) };
    cacheOrgaoUf.set(chaveCompra, resultado);
    return resultado;
  }

  async function enriquecerAta(referenciaAta) {
    const partes = partesNumeroControle(referenciaAta.numeroControlePNCPCompra);
    if (!partes) return null;

    // UF do órgão e lista de itens são independentes entre si — buscar em paralelo em vez de
    // em sequência economiza uma ida-e-volta inteira por ata.
    const buscarItens = (pagina) => fetchComRetentativa(
      `https://pncp.gov.br/api/pncp/v1/orgaos/${partes.cnpj}/compras/${partes.ano}/${partes.sequencial}/itens?pagina=${pagina}&tamanhoPagina=50`,
      3, 15000, `itens ata ${referenciaAta.numeroControlePNCPAta}`);
    const [{ ufOrgao, municipioOrgao, uasg, compraValida, versaoCompra }, itensResp] = await Promise.all([
      buscarUfOrgao(referenciaAta.numeroControlePNCPCompra),
      buscarItens(1),
    ]);
    const lista = (resposta) => Array.isArray(resposta) ? resposta : resposta?.data;
    if (!compraValida || !Array.isArray(lista(itensResp))) return null;
    const chaveAta = referenciaAta.numeroControlePNCPAta;
    const primeiraPagina = hashProgressoAtas(itensResp);
    let progresso = progressoAtas[chaveAta];
    if (!progresso || progresso.compra !== referenciaAta.numeroControlePNCPCompra || progresso.versaoCompra !== versaoCompra ||
        progresso.primeiraPagina !== primeiraPagina || !Array.isArray(progresso.itens) ||
        progresso.totalPaginas !== itensResp.totalPaginas || progresso.totalRegistros !== itensResp.totalRegistros ||
        !progresso.resultados || typeof progresso.resultados !== "object" ||
        !Number.isSafeInteger(progresso.proximaPagina) || progresso.proximaPagina < 1) {
      progresso = { compra: referenciaAta.numeroControlePNCPCompra, versaoCompra, primeiraPagina, iniciadoEm: new Date().toISOString(),
        totalPaginas: itensResp.totalPaginas, totalRegistros: itensResp.totalRegistros,
        proximaPagina: 1, itens: [], resultados: {}, itensCompletos: false };
    } else progresso = { ...progresso, itens: [...progresso.itens], resultados: { ...progresso.resultados } };
    progressoAtas[chaveAta] = progresso;
    const numeros = new Set(progresso.itens.map((item) => Number(item.numeroItem || item.numero)));
    while (!progresso.itensCompletos) {
      if (tempoRestanteMs() < 10000) return null;
      const pagina = progresso.proximaPagina;
      const resposta = pagina === 1 ? itensResp : await buscarItens(pagina);
      const itens = lista(resposta);
      if (!Array.isArray(itens) || itens.length > 50 || (itens.length === 0 && resposta.totalRegistros) ||
          (resposta.totalRegistros !== undefined && (!Number.isSafeInteger(resposta.totalRegistros) || resposta.totalRegistros < 0)) ||
          (resposta.totalPaginas !== undefined && (!Number.isSafeInteger(resposta.totalPaginas) || resposta.totalPaginas < 0 ||
            (resposta.totalPaginas === 0 && itens.length > 0) || (pagina < resposta.totalPaginas && itens.length === 0))) ||
          (resposta.numeroPagina !== undefined && resposta.numeroPagina !== pagina)) return null;
      if (resposta.totalPaginas !== progresso.totalPaginas || resposta.totalRegistros !== progresso.totalRegistros) {
        delete progressoAtas[chaveAta]; return null;
      }
      for (const item of itens) {
        const numero = Number(item.numeroItem || item.numero);
        if (!Number.isSafeInteger(numero) || numero <= 0 || numeros.has(numero) ||
            (item.numeroControlePNCPCompra && item.numeroControlePNCPCompra !== progresso.compra)) {
          delete progressoAtas[chaveAta]; return null;
        }
        numeros.add(numero);
      }
      const itensCompletos = resposta.totalPaginas !== undefined
        ? pagina >= resposta.totalPaginas : itens.length < 50;
      if (progresso.totalRegistros !== undefined && (numeros.size > progresso.totalRegistros ||
          (itensCompletos && numeros.size !== progresso.totalRegistros))) {
        delete progressoAtas[chaveAta]; return null;
      }
      progresso.itens.push(...itens);
      progresso.proximaPagina += 1;
      progresso.itensCompletos = itensCompletos;
    }
    const itensParaBuscar = progresso.itens;

    // Busca o "resultados" (vencedores) de cada item EM PARALELO, em lotes de até
    // CONCORRENCIA_ATAS requisições simultâneas — antes era 1 chamada de cada vez,
    // sequencial, e uma única ata com 30 itens podia levar até 30x o tempo de ida-e-volta
    // até o PNCP. Cada worker escreve só na posição do SEU PRÓPRIO item (array indexado por
    // posição, não uma lista que cresce por push concorrente), então dois workers nunca
    // podem pisar no resultado um do outro nem misturar item de uma ata com o de outra —
    // essa função só processa os itens de UMA ata por vez (o paralelismo é só entre os itens
    // dessa mesma ata; a próxima ata começa depois que essa terminar).
    const slots = itensParaBuscar.map((item) => progresso.resultados[item.numeroItem || item.numero] || null);
    let cursorItem = 0;
    let incompleta = false;
    async function trabalhadorItem() {
      while (cursorItem < itensParaBuscar.length) {
        if (tempoRestanteMs() < 10000) { incompleta = true; return; }
        const indice = cursorItem++;
        const item = itensParaBuscar[indice];
        const numeroItem = item.numeroItem || item.numero;
        if (Object.hasOwn(progresso.resultados, numeroItem)) continue;
        const resultados = await fetchComRetentativa(
          `https://pncp.gov.br/api/pncp/v1/orgaos/${partes.cnpj}/compras/${partes.ano}/${partes.sequencial}/itens/${numeroItem}/resultados`,
          3, 15000, `resultados ata ${referenciaAta.numeroControlePNCPAta} item ${numeroItem}`
        );
        const listaResultados = Array.isArray(resultados) ? resultados : resultados && resultados.data;
        if (!Array.isArray(listaResultados) || resultados.totalPaginas > 1 ||
          (listaResultados.length === 0 && resultados.totalRegistros) || listaResultados.some((r) =>
          (r.numeroItem !== undefined && Number(r.numeroItem) !== Number(numeroItem)) ||
          (r.numeroControlePNCPCompra && r.numeroControlePNCPCompra !== progresso.compra))) { incompleta = true; continue; }
        const situacao = item.situacaoCompraItemNome || null;
        const codigoCatalogo = item.catalogoCodigoItem || null;
        // Só tenta buscar marca quando há vencedor de fato (sem CNPJ vencedor não tem o que
        // casar) e o item tem UASG + código de catálogo — cobre só órgãos federais/distritais.
        const marcasPorFornecedor = (listaResultados.length > 0 && codigoCatalogo && uasg)
          ? await buscarMarcasProduto(codigoCatalogo, uasg)
          : new Map();
        // Itens sem vencedor não são mais descartados de cara: quando a situação do item é
        // um estado terminal SEM vencedor (deserto/fracassado/anulado/revogado), guardamos
        // mesmo assim — é exatamente o sinal de "baixa concorrência" (aba Inteligência de
        // Mercado > Baixa Concorrência). Itens ainda "Em andamento"/"Divulgada no PNCP" sem
        // resultado continuam sendo pulados (não há nada definitivo pra mostrar ainda).
        if (listaResultados.length === 0 && !situacaoSemVencedor(situacao)) { progresso.resultados[numeroItem] = null; continue; }
        slots[indice] = {
          numeroItem,
          descricao: item.descricao || item.descricaoItem || "",
          situacao,
          vencedores: listaResultados.map((r) => ({
            cnpj: r.niFornecedor || "",
            nome: r.nomeRazaoSocialFornecedor || "",
            valorUnitario: Number(r.valorUnitarioHomologado || 0),
            valorTotal: Number(r.valorTotalHomologado || 0),
            quantidade: Number(r.quantidadeHomologada || 0),
            data: r.dataResultado || null,
            marca: (marcasPorFornecedor.get(normalizarDocumentoFornecedor(r.niFornecedor || r.cnpjFornecedor || r.cnpj)) || {}).marca || null,
          })),
        };
        progresso.resultados[numeroItem] = slots[indice];
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONCORRENCIA_ATAS, itensParaBuscar.length) }, () => trabalhadorItem())
    );
    if (incompleta) return null;
    if (tempoRestanteMs() < 10000) return null;
    const conferida = await buscarItens(1);
    if (!Array.isArray(lista(conferida))) return null;
    if (hashProgressoAtas(conferida) !== primeiraPagina) { delete progressoAtas[chaveAta]; return null; }
    const itensComVencedor = slots.filter(Boolean);
    delete progressoAtas[chaveAta];
    return { ufOrgao, municipioOrgao, uasg, itens: itensComVencedor, situacaoColetada: true };
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
  const chavesPendentes = new Set(filaPendente.map((a) => a.numeroControlePNCPAta));

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
    ? existentes.janelasPendentes.map((janela) => ({ ...janela }))
    : gerarJanelas(dataInicial, dataFinal, JANELA_DIAS);
  const dataFinalConsulta = existentes?.janelasPendentes?.length
    ? (existentes.dataFinalConsulta || existentes.dataFinal || fmtData(hoje)) : fmtData(hoje);

  let paginasVarridas = 0;
  let atasNovas = 0;
  let atasEnfileiradas = 0;
  let janelasProcessadasNestaExecucao = 0;

  while (janelasPendentes.length > 0) {
    if (tempoRestanteMs() < 15000) break;
    const janela = janelasPendentes[0];
    const buscarPagina = (pagina) => fetchComRetentativa(
      `https://pncp.gov.br/api/consulta/v1/atas?dataInicial=${janela.inicio}&dataFinal=${janela.fim}&pagina=${pagina}&tamanhoPagina=500`,
      2, 20000, "atas");
    const valida = (dado, numero) => dado && Array.isArray(dado.data) && Number.isSafeInteger(dado.totalPaginas) && dado.totalPaginas >= 0 &&
      (dado.totalRegistros === undefined || (Number.isSafeInteger(dado.totalRegistros) && dado.totalRegistros >= 0)) &&
      (dado.totalPaginas > 0 || (dado.data.length === 0 && !dado.totalRegistros)) && (dado.data.length > 0 || !dado.totalRegistros) &&
      dado.data.every((a) => typeof a?.numeroControlePNCPAta === "string" && a.numeroControlePNCPAta.trim()) &&
      new Set(dado.data.map((a) => a.numeroControlePNCPAta)).size === dado.data.length &&
      (dado.numeroPagina === undefined || dado.numeroPagina === numero);
    const assinatura = (dado) => JSON.stringify([dado.totalPaginas, dado.totalRegistros, dado.data.map((a) => a.numeroControlePNCPAta)]);
    const primeira = await buscarPagina(1);
    if (!valida(primeira, 1)) break;
    if (janela.primeiraPagina !== assinatura(primeira) || !Array.isArray(janela.ids) ||
        (janela.proximaPagina > 1 && janela.ids.length < primeira.data.length) ||
        !Number.isSafeInteger(janela.proximaPagina) || janela.proximaPagina < 1 || janela.proximaPagina > Math.max(1, primeira.totalPaginas) + 1) {
      janela.proximaPagina = 1; janela.ids = [];
    }
    janela.primeiraPagina = assinatura(primeira);
    const ids = new Set(janela.ids);
    let pagina = janela.proximaPagina || 1;
    const totalPaginas = primeira.totalPaginas || 1;
    let janelaOk = true;
    let fonteAlterada = false;

    while (pagina <= totalPaginas) {
      if (tempoRestanteMs() < 12000) { janelaOk = false; break; }
      const dados = pagina === 1 ? primeira : await buscarPagina(pagina);
      if (!valida(dados, pagina)) { janelaOk = false; break; }
      if (dados.totalPaginas !== primeira.totalPaginas || dados.totalRegistros !== primeira.totalRegistros) {
        fonteAlterada = true; janelaOk = false; break;
      }
      const itens = dados.data;
      if (itens.some((a) => ids.has(a.numeroControlePNCPAta))) { fonteAlterada = true; janelaOk = false; break; }
      for (const item of itens) ids.add(item.numeroControlePNCPAta);
      paginasVarridas += 1;

      for (const item of itens) {
        const objeto = item.objetoContratacao || "";
        const segs = segmentosQueBatem(objeto); // só rótulo informativo agora, não filtra mais
        const chave = item.numeroControlePNCPAta;
        if (!chave || atasMapa.has(chave) || chavesPendentes.has(chave)) continue;

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
          chavesPendentes.add(chave);
          atasEnfileiradas += 1;
          continue;
        }
        const enriquecido = await enriquecerAta(referenciaAta);
        if (enriquecido) {
          atasMapa.set(chave, { ...referenciaAta, ...enriquecido, enriquecida: true });
          atasNovas += 1;
        } else {
          filaPendente.push(referenciaAta);
          chavesPendentes.add(chave);
          atasEnfileiradas += 1;
        }
      }
      pagina += 1;
      janela.proximaPagina = pagina;
      janela.ids = Array.from(ids);
    }

    if (janelaOk && primeira.totalRegistros !== undefined && ids.size !== primeira.totalRegistros) { fonteAlterada = true; janelaOk = false; }
    if (janelaOk && totalPaginas > 1) {
      if (tempoRestanteMs() < 12000) janelaOk = false;
      else {
        const conferida = await buscarPagina(1);
        if (!valida(conferida, 1)) janelaOk = false;
        else if (assinatura(conferida) !== janela.primeiraPagina) { fonteAlterada = true; janelaOk = false; }
      }
    }
    if (janelaOk) {
      janelasPendentes.shift();
      janelasProcessadasNestaExecucao += 1;
    } else {
      if (fonteAlterada) { janela.proximaPagina = 1; janela.ids = []; }
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
    dataFinal: janelasPendentes.length ? (existentes?.dataFinal || dataInicial) : dataFinalConsulta,
    dataFinalConsulta: janelasPendentes.length ? dataFinalConsulta : null,
    retencaoDias: RETENCAO_DIAS,
    janelasPendentes,
    filaPendente,
    progressoAtas,
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
const { upsertEmLotes, baixarTodasAsLinhas, removerMaisAntigosQue, salvarBlob, buscarBlob } = require("./supabase_dados");

function hashProgressoAtas(progresso) {
  // JSONB pode reordenar chaves, mas a ordem de itens/resultados continua significativa.
  const texto = JSON.stringify(progresso, (_chave, valor) => valor && typeof valor === "object" && !Array.isArray(valor)
    ? Object.fromEntries(Object.keys(valor).sort().map((chave) => [chave, valor[chave]])) : valor);
  return require("node:crypto").createHash("sha256").update(texto).digest("hex");
}

async function hidratarContratosDoSupabase(caminhoArquivo, caminhoMeta) {
  const meta = await lerJsonExistente(caminhoMeta);
  if (!meta) {
    console.log("[supabase] Sem metadado anterior de contratos — tratando como 1ª execução.");
    return;
  }
  const linhas = await baixarTodasAsLinhas("contratos", "dado");
  const registros = linhas.map((l) => l.dado);
  const pendente = await buscarBlob("dados_robo", "contratos_coleta_pendente");
  if (pendente && pendente.atualizadoEm === meta.atualizadoEm) {
    if (!Array.isArray(pendente.ids) || pendente.hash !== hashProgressoAtas(pendente.ids)) {
      throw new Error("Integridade dos IDs de contratos não confirmada; preserve o blob contratos_coleta_pendente para diagnóstico.");
    }
    if (meta.consultaPendente?.paginacao) meta.consultaPendente.paginacao.ids = pendente.ids;
  }
  const fs = await import("node:fs/promises");
  await fs.writeFile(caminhoArquivo, JSON.stringify({ ...meta, registros }), "utf8");
  console.log(`[supabase] Hidratado ${registros.length} contrato(s) do Supabase pra continuar o incremental.`);
}

// Antes reenviava a base inteira (165 mil linhas, ~330 lotes) a cada execução, e os
// contratos inéditos ficavam no FIM do array (a Map preserva a ordem de inserção:
// hidratados primeiro). Qualquer falha num lote anterior — na produção engolida por um
// try/catch — impedia justamente as linhas novas de entrar (provável causa de nenhuma
// linha nova desde 30/10).
// O hidratado já está no banco: basta gravar o que a fonte devolveu agora. atualizado_em
// vai no payload porque o default now() só vale no INSERT; no merge-duplicates a coluna
// ficava parada e o painel mostrava a data do último contrato inédito, não da coleta.
async function sincronizarContratosNoSupabase(contratos) {
  const atualizadoEm = new Date().toISOString();
  const linhas = contratos.novosNaExecucao
    .filter((r) => r.numeroControlePNCP)
    .map((r) => ({
      numero_controle_pncp: r.numeroControlePNCP,
      objeto: r.objeto || "",
      uf: r.uf || null,
      cnpj_fornecedor: r.cnpjFornecedor || null,
      data_assinatura: r.dataAssinatura || null,
      dado: r,
      atualizado_em: atualizadoEm,
    }));
  const enviadas = await upsertEmLotes("contratos", linhas, "numero_controle_pncp");
  console.log(`[supabase] ${enviadas} contrato(s) sincronizado(s) na tabela "contratos".`);
  const limiteRetencaoIso = new Date(Date.now() - RETENCAO_DIAS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await removerMaisAntigosQue("contratos", "data_assinatura", limiteRetencaoIso);
}

async function hidratarMercadoDoSupabase(caminhoArquivo, caminhoMeta) {
  const meta = await lerJsonExistente(caminhoMeta);
  if (!meta) {
    console.log("[supabase] Sem metadado anterior de mercado/atas — tratando como 1ª execução.");
    return;
  }
  const linhas = await baixarTodasAsLinhas("mercado_atas", "dado");
  const atas = linhas.map((l) => l.dado);
  const pendente = await buscarBlob("dados_robo", "mercado_coleta_pendente");
  if (pendente && pendente.atualizadoEm === meta.atualizadoEm && (!pendente.progressoAtas || pendente.hash !== hashProgressoAtas(pendente.progressoAtas))) {
    throw new Error("Integridade do progresso de atas não confirmada; preserve o blob mercado_coleta_pendente para diagnóstico.");
  }
  const progressoAtas = pendente && pendente.atualizadoEm === meta.atualizadoEm ? pendente.progressoAtas : {};
  if (pendente && pendente.atualizadoEm === meta.atualizadoEm && pendente.idsJanelas !== undefined) {
    if (!Array.isArray(pendente.idsJanelas) || pendente.idsJanelas.length !== (meta.janelasPendentes || []).length ||
        !pendente.idsJanelas.every(Array.isArray) || pendente.hashIdsJanelas !== hashProgressoAtas(pendente.idsJanelas)) {
      throw new Error("Integridade dos IDs de atas não confirmada; preserve o blob mercado_coleta_pendente para diagnóstico.");
    }
    meta.janelasPendentes = (meta.janelasPendentes || []).map((janela, i) => ({ ...janela, ids: pendente.idsJanelas[i] }));
  }
  const fs = await import("node:fs/promises");
  await fs.writeFile(caminhoArquivo, JSON.stringify({ ...meta, atas, progressoAtas }), "utf8");
  console.log(`[supabase] Hidratada(s) ${atas.length} ata(s) do Supabase pra continuar o incremental.`);
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
  const enviadas = await upsertEmLotes("mercado_atas", linhas, "numero_controle_pncp_ata");
  console.log(`[supabase] ${enviadas} ata(s) sincronizada(s) na tabela "mercado_atas".`);

}

// Mesma chave de deduplicação que coletarOportunidadesAbertas() já usa em memória
// (linha "const chave = (r) => ..." dentro dela) — precisa ser idêntica, senão o
// upsert no Supabase cria linhas duplicadas pro mesmo registro.
function chaveOportunidade(r) {
  return r.numeroControlePNCP || `${r.objeto}|${r.orgao}|${r.uf}`;
}

// O metadado das oportunidades (coberturaPorUf, atualizadoEm, ufsComFalha...) mora na
// tabela dados_robo, chave "oportunidades_meta" — não num arquivo comitado. É isso que faz
// o progresso da recuperação de UFs sobreviver de uma execução pra outra: o workflow de
// recuperação roda de hora em hora e não comita nada, então um metadado local morreria com
// o job e a execução seguinte reprocessaria as mesmas UFs contra uma fonte sensível a
// excesso de requisições.
async function hidratarOportunidadesDoSupabase(caminhoArquivo) {
  const meta = await buscarBlob("dados_robo", "oportunidades_meta");
  if (!meta) {
    console.log("[supabase] Sem metadado anterior de oportunidades — tratando como 1ª execução.");
    return;
  }
  const linhas = await baixarTodasAsLinhas("oportunidades_abertas", "dado");
  const registros = linhas.map((l) => l.dado);
  const fs = await import("node:fs/promises");
  await fs.writeFile(caminhoArquivo, JSON.stringify({ ...meta, registros }), "utf8");
  console.log(`[supabase] Hidratada(s) ${registros.length} oportunidade(s) do Supabase pra continuar o incremental.`);
}

async function sincronizarOportunidadesNoSupabase(oportunidades) {
  const linhas = (oportunidades.registros || []).map((r) => ({
    chave: chaveOportunidade(r),
    numero_controle_pncp: r.numeroControlePNCP || null,
    objeto: r.objeto || "",
    uf: r.uf || null,
    publicacao: r.publicacao ? String(r.publicacao).slice(0, 10) : null,
    encerramento: dataEncerramentoIso(r.encerramento),
    dado: r,
  }));
  // Quem chama precisa saber se a sincronização falhou, porque o metadado de
  // cobertura (coberturaPorUf) só pode ser gravado depois que estas linhas realmente
  // chegaram no banco — ver comentário em main() logo antes da chamada.
  const enviadas = await upsertEmLotes("oportunidades_abertas", linhas, "chave");
  console.log(`[supabase] ${enviadas} oportunidade(s) sincronizada(s) na tabela "oportunidades_abertas".`);
  // Só remove encerramentos comprovadamente antigos; SQL lt preserva os null desconhecidos.
  const limiteRetencaoIso = new Date(Date.now() - RETENCAO_DIAS_OPORTUNIDADES * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await removerMaisAntigosQue("oportunidades_abertas", "encerramento", limiteRetencaoIso);
}

async function main() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  async function gravarJson(caminho, dado) {
    // Falha de disco não pode truncar o checkpoint anterior.
    await fs.writeFile(`${caminho}.tmp`, JSON.stringify(dado), "utf8");
    await fs.rename(`${caminho}.tmp`, caminho);
  }

  const dirDados = path.join(process.cwd(), "data");
  await fs.mkdir(dirDados, { recursive: true });

  const somenteOportunidades = process.env.SOMENTE_OPORTUNIDADES === "1";
  const recuperarPendentes = process.env.RECUPERAR_UFS_PENDENTES === "1";
  console.log(`Iniciando coleta incremental${somenteOportunidades ? " (somente oportunidades)" : ""}. Retenção: ${RETENCAO_DIAS} dias.`);

  const pendencias = [];
  if (!somenteOportunidades) {
    const caminhoContratos = path.join(dirDados, "contratos_recentes.json");
    const caminhoContratosMeta = path.join(dirDados, "contratos_meta.json");
    await hidratarContratosDoSupabase(caminhoContratos, caminhoContratosMeta);
    iniciarFase(LIMITE_MINUTOS_CONTRATOS);
    const contratos = await coletarContratos(caminhoContratos);
    if (contratos.parcial) pendencias.push("contratos: páginas pendentes");
    await sincronizarContratosNoSupabase(contratos);
    const ids = contratos.consultaPendente?.paginacao?.ids || [];
    await salvarBlob("dados_robo", "contratos_coleta_pendente", { atualizadoEm: contratos.atualizadoEm, ids, hash: hashProgressoAtas(ids) });
    await gravarJson(caminhoContratos, contratos);
    const { registros: _registrosContratos, novosNaExecucao: _novosContratos, ...contratosMeta } = contratos;
    if (contratosMeta.consultaPendente?.paginacao) {
      const { ids: _ids, ...paginacao } = contratosMeta.consultaPendente.paginacao;
      contratosMeta.consultaPendente = { ...contratosMeta.consultaPendente, paginacao };
    }
    await gravarJson(caminhoContratosMeta, contratosMeta);
    console.log("Gravado data/contratos_meta.json (metadado leve, vai pro git)");
  }

  const caminhoOportunidades = path.join(dirDados, "oportunidades_abertas.json");
  await hidratarOportunidadesDoSupabase(caminhoOportunidades);
  const oportunidades = await coletarOportunidadesAbertas(caminhoOportunidades);
  const { registros: _registrosOportunidades, ...oportunidadesMeta } = oportunidades;
  if (!oportunidades.semPendencias) {
    // Checkpoint só confirma cobertura depois de todas as linhas persistidas.
    await sincronizarOportunidadesNoSupabase(oportunidades);
    await salvarBlob("dados_robo", "oportunidades_meta", oportunidadesMeta);
    await gravarJson(caminhoOportunidades, oportunidades);
  }

  // Uma indisponibilidade do PNCP não deve abortar o pipeline inteiro. A função de coleta
  // já preserva a última base íntegra, expõe saudeFonte/ufsComFalha e agora também mantém
  // atualizadoEm no último dado realmente lido. Isso permite que as demais rotinas — em
  // especial a preparação antecipada dos dossiês — continuem usando a base confiável.
  const MIN_UFS_OK_OPORTUNIDADES = parseInt(process.env.MIN_UFS_OK_OPORTUNIDADES || "24", 10);
  const ufsOkOportunidades = UFS.length - oportunidades.ufsComFalha.length;
  if (recuperarPendentes && !oportunidades.semPendencias && oportunidades.ufsOkNaExecucao.length === 0) {
    console.warn("[oportunidades] Recuperação não atualizou nenhuma UF pendente; o último boletim íntegro foi preservado.");
  }
  if (!recuperarPendentes && ufsOkOportunidades < MIN_UFS_OK_OPORTUNIDADES) {
    console.warn(
      `[oportunidades] Cobertura parcial/indisponível: ${ufsOkOportunidades}/${UFS.length} UFs concluídas ` +
      `(referência operacional: ${MIN_UFS_OK_OPORTUNIDADES}). O último boletim íntegro foi preservado.`
    );
  }

  if (oportunidades.ufsComFalha.length) pendencias.push(`cobertura de oportunidades: ${oportunidades.ufsComFalha.join(", ")}`);
  if (somenteOportunidades) {
    if (pendencias.length) throw new Error(pendencias.join("; "));
    console.log("Recuperação de oportunidades finalizada com sucesso.");
    return;
  }

  const caminhoMercado = path.join(dirDados, "mercado_segmentos.json");
  const caminhoMercadoMeta = path.join(dirDados, "mercado_meta.json");
  await hidratarMercadoDoSupabase(caminhoMercado, caminhoMercadoMeta);

  iniciarFase(LIMITE_MINUTOS_MERCADO);
  const mercado = await coletarMercadoSegmentos(caminhoMercado);
  if (mercado.parcial) pendencias.push("mercado: janelas/atas pendentes");
  await sincronizarMercadoNoSupabase(mercado);
  // Itens/resultados e IDs dos scans crescem com a coleta; ficam no banco, fora do git.
  const progressoAtas = mercado.progressoAtas || {};
  const idsJanelas = (mercado.janelasPendentes || []).map((janela) => janela.ids || []);
  await salvarBlob("dados_robo", "mercado_coleta_pendente", { atualizadoEm: mercado.atualizadoEm, progressoAtas, hash: hashProgressoAtas(progressoAtas),
    idsJanelas, hashIdsJanelas: hashProgressoAtas(idsJanelas) });
  await gravarJson(caminhoMercado, mercado);
  // "empresas" não é mais nem calculado aqui (ver coletarMercadoSegmentos): o painel já
  // recalcula esse ranking sozinho a partir das atas filtradas (calcularEmpresasMercado em
  // painel.html) — calcular nunca era gravado (nem no git, nem no Supabase) e só desperdiçava
  // CPU do robô a cada execução (era 6,3 MB dos 9,6 MB do arquivo antigo, quando ainda ia pro
  // disco à toa).
  const { atas: _atasMercado, progressoAtas: _progressoAtas, ...mercadoMeta } = mercado;
  mercadoMeta.janelasPendentes = (mercado.janelasPendentes || []).map(({ ids: _ids, ...janela }) => janela);
  await gravarJson(caminhoMercadoMeta, mercadoMeta);
  console.log("Gravado data/mercado_meta.json (metadado leve, vai pro git)");

  if (pendencias.length) throw new Error(pendencias.join("; "));
  console.log("Coleta finalizada com sucesso.");
}

module.exports = { fetchComRetentativa };

if (require.main === module) {
  main().catch((e) => {
    console.error("Erro fatal no robô de coleta:", e);
    process.exit(1);
  });
}
