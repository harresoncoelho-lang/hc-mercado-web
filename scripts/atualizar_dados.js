// Robô de coleta diária do PNCP para o HC Licitações.
// Roda no GitHub Actions (cron diário) e grava arquivos JSON estáticos em /data,
// que o site (index.html) lê diretamente — sem precisar consultar o PNCP na hora
// que o usuário faz uma busca.
//
// Uso: node scripts/atualizar_dados.js
// Variáveis de ambiente opcionais:
//   DIAS_HISTORICO_INICIAL=30  -> na 1ª execução (sem arquivo anterior), quantos dias varrer (padrão 30)
//   RETENCAO_DIAS=730          -> quantos dias de histórico manter acumulado (padrão 730 = 24 meses)
//   LIMITE_MINUTOS=25          -> orçamento de tempo total do robô (padrão 25 min)
//
// IMPORTANTE: a partir desta versão o robô é INCREMENTAL — ele não re-varre tudo do zero
// a cada execução. Ele lê o data/contratos_recentes.json já existente (comitado no repo),
// busca só o que é novo desde a última coleta (com uma folga de 2 dias pra pegar contratos
// que o PNCP publicou com atraso) e junta com o que já tinha, descartando duplicatas e
// registros mais velhos que RETENCAO_DIAS. Assim, o histórico vai crescendo dia após dia até
// cobrir os 24 meses — não tem como "pular" direto pra 24 meses de uma vez só, porque isso
// exigiria escanear anos de licitações nacionais numa única execução, o que estoura o tempo
// e os limites de taxa da API do PNCP.

const DIAS_HISTORICO_INICIAL = parseInt(process.env.DIAS_HISTORICO_INICIAL || "30", 10);
const RETENCAO_DIAS = parseInt(process.env.RETENCAO_DIAS || "730", 10);
const FOLGA_DIAS = 2; // re-busca os últimos 2 dias pra pegar publicações atrasadas no PNCP
const LIMITE_MINUTOS = parseFloat(process.env.LIMITE_MINUTOS || "25");
const LIMITE_MS = LIMITE_MINUTOS * 60 * 1000;
const TAMANHO_PAGINA = 100;

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
  "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
  "SP", "SE", "TO",
];

const inicioExecucao = Date.now();

function tempoRestanteMs() {
  return LIMITE_MS - (Date.now() - inicioExecucao);
}

function fmtData(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

async function fetchComRetentativa(url, tentativas = 3) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30000);
      const resp = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (resp.status === 429) {
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        continue;
      }
      if (!resp.ok) return null;
      const texto = await resp.text();
      if (!texto) return null;
      return JSON.parse(texto);
    } catch (e) {
      if (i === tentativas - 1) return null;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  return null;
}

// Lê o arquivo acumulado da execução anterior (se existir). Retorna null se não existir
// ainda ou se estiver corrompido/em formato antigo.
async function lerContratosExistentes(caminho) {
  try {
    const fs = await import("node:fs/promises");
    const texto = await fs.readFile(caminho, "utf8");
    const dados = JSON.parse(texto);
    if (!Array.isArray(dados.registros)) return null;
    return dados;
  } catch (e) {
    return null;
  }
}

// Chave única de um contrato, pra deduplicar ao juntar coleta nova com a antiga.
function chaveRegistro(r) {
  return r.numeroControlePNCP || `${r.cnpjFornecedor}|${r.dataAssinatura}|${r.valor}|${r.objeto}`;
}

// ---------- Contratos históricos (nacional, acumulados de forma incremental) ----------
async function coletarContratos(caminhoArquivo) {
  const existentes = await lerContratosExistentes(caminhoArquivo);
  const hoje = new Date();

  let inicio;
  let primeiraExecucao = !existentes;
  if (existentes && existentes.dataFinal) {
    // Já tem histórico: busca só a partir de perto de onde parou (com folga pra pegar
    // publicações atrasadas do PNCP), em vez de re-varrer tudo de novo.
    const dataFinalAnterior = new Date(
      `${existentes.dataFinal.slice(0, 4)}-${existentes.dataFinal.slice(4, 6)}-${existentes.dataFinal.slice(6, 8)}`
    );
    inicio = new Date(dataFinalAnterior.getTime() - FOLGA_DIAS * 24 * 60 * 60 * 1000);
  } else {
    // 1ª execução (sem arquivo anterior no repo): faz uma varredura inicial curta.
    inicio = new Date(hoje.getTime() - DIAS_HISTORICO_INICIAL * 24 * 60 * 60 * 1000);
  }
  const dataInicial = fmtData(inicio);
  const dataFinal = fmtData(hoje);

  const novos = [];
  let pagina = 1;
  let totalPaginas = 1;
  let paginasVarridas = 0;
  let parcial = false;

  while (pagina <= totalPaginas) {
    if (tempoRestanteMs() < 15000) {
      parcial = true;
      console.log(`[contratos] Orçamento de tempo esgotado na página ${pagina}/${totalPaginas}.`);
      break;
    }
    const url = `https://pncp.gov.br/api/consulta/v1/contratos?dataInicial=${dataInicial}&dataFinal=${dataFinal}&pagina=${pagina}&tamanhoPagina=${TAMANHO_PAGINA}`;
    const dados = await fetchComRetentativa(url);
    if (!dados) {
      console.log(`[contratos] Falha ao buscar página ${pagina}, parando (parcial).`);
      parcial = true;
      break;
    }
    const itens = dados.data || [];
    totalPaginas = dados.totalPaginas || 1;
    paginasVarridas += 1;

    for (const item of itens) {
      novos.push({
        objeto: item.objetoContrato || item.objetoCompra || "",
        orgao: (item.orgaoEntidade && item.orgaoEntidade.razaoSocial) || "",
        uf: (item.unidadeOrgao && item.unidadeOrgao.ufSigla) || "",
        municipio: (item.unidadeOrgao && item.unidadeOrgao.municipioNome) || "",
        cnpjFornecedor: item.niFornecedor || "",
        nomeFornecedor: item.nomeRazaoSocialFornecedor || "",
        valor: Number(item.valorGlobal || item.valorInicial || 0),
        dataAssinatura: item.dataAssinatura || item.dataVigenciaInicio || null,
        numeroControlePNCP: item.numeroControlePNCP || null,
      });
    }

    if (pagina % 20 === 0) {
      console.log(`[contratos] ${pagina}/${totalPaginas} páginas, ${novos.length} registros novos até agora...`);
    }
    pagina += 1;
  }

  // Junta com o que já tinha, deduplicando, e descarta o que passou da retenção.
  const mapa = new Map();
  if (existentes) {
    for (const r of existentes.registros) mapa.set(chaveRegistro(r), r);
  }
  for (const r of novos) mapa.set(chaveRegistro(r), r);

  const limiteRetencao = new Date(hoje.getTime() - RETENCAO_DIAS * 24 * 60 * 60 * 1000);
  let registros = Array.from(mapa.values()).filter((r) => {
    if (!r.dataAssinatura) return true; // mantém registros sem data (raros) por segurança
    const d = new Date(r.dataAssinatura);
    return isNaN(d) || d >= limiteRetencao;
  });

  // Trava de segurança de tamanho: contratos nacionais acumulados por até 24 meses podem
  // crescer bastante. Se passar de MAX_REGISTROS, descarta primeiro os mais antigos —
  // assim o arquivo não estoura o limite de tamanho do GitHub nem o tempo de carregamento
  // no navegador do usuário.
  const MAX_REGISTROS = 250000;
  if (registros.length > MAX_REGISTROS) {
    registros.sort((a, b) => (b.dataAssinatura || "").localeCompare(a.dataAssinatura || ""));
    registros = registros.slice(0, MAX_REGISTROS);
    console.log(`[contratos] Atingiu MAX_REGISTROS (${MAX_REGISTROS}); descartados os mais antigos.`);
  }

  const dataInicialReal = registros.reduce((min, r) => {
    if (!r.dataAssinatura) return min;
    return !min || r.dataAssinatura < min ? r.dataAssinatura : min;
  }, null);

  console.log(
    `[contratos] Concluído: ${novos.length} novos nesta execução (${paginasVarridas} páginas de ${totalPaginas}, parcial=${parcial}). ` +
    `Total acumulado após deduplicar/podar: ${registros.length} registros (${primeiraExecucao ? "1ª execução" : "incremental"}), ` +
    `cobrindo desde ${dataInicialReal || "?"}.`
  );

  return {
    atualizadoEm: new Date().toISOString(),
    dataInicial: dataInicialReal || dataInicial,
    dataFinal,
    retencaoDias: RETENCAO_DIAS,
    totalRegistros: registros.length,
    paginasVarridas,
    totalPaginasDisponiveis: totalPaginas,
    parcial,
    registros,
  };
}

// ---------- Oportunidades abertas agora (por UF) ----------
async function coletarOportunidadesAbertas() {
  const dataFinal = fmtData(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));
  const todas = [];
  let ufsComFalha = [];

  for (const uf of UFS) {
    if (tempoRestanteMs() < 10000) {
      console.log(`[oportunidades] Orçamento de tempo esgotado antes de terminar todas as UFs (parou em ${uf}).`);
      break;
    }
    let pagina = 1;
    let totalPaginas = 1;
    let falhouUf = false;

    while (pagina <= totalPaginas && pagina <= 20) {
      const url = `https://pncp.gov.br/api/consulta/v1/contratacoes/proposta?uf=${uf}&dataFinal=${dataFinal}&pagina=${pagina}&tamanhoPagina=50`;
      const dados = await fetchComRetentativa(url);
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
          numeroControlePNCP: item.numeroControlePNCP || null,
        });
      }
      pagina += 1;
    }
    if (falhouUf) ufsComFalha.push(uf);
    console.log(`[oportunidades] ${uf}: ok (${todas.length} acumuladas)`);
  }

  console.log(`[oportunidades] Concluído: ${todas.length} oportunidades abertas, falhas em: ${ufsComFalha.join(", ") || "nenhuma"}.`);

  return {
    atualizadoEm: new Date().toISOString(),
    totalRegistros: todas.length,
    ufsComFalha,
    registros: todas,
  };
}

async function main() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const dirDados = path.join(process.cwd(), "data");
  await fs.mkdir(dirDados, { recursive: true });

  console.log(`Iniciando coleta incremental. Retenção: ${RETENCAO_DIAS} dias. Orçamento: ${LIMITE_MINUTOS} min.`);

  const caminhoContratos = path.join(dirDados, "contratos_recentes.json");
  const contratos = await coletarContratos(caminhoContratos);
  await fs.writeFile(caminhoContratos, JSON.stringify(contratos), "utf8");
  console.log("Gravado data/contratos_recentes.json");

  const oportunidades = await coletarOportunidadesAbertas();
  await fs.writeFile(
    path.join(dirDados, "oportunidades_abertas.json"),
    JSON.stringify(oportunidades),
    "utf8"
  );
  console.log("Gravado data/oportunidades_abertas.json");

  console.log("Coleta finalizada com sucesso.");
}

main().catch((e) => {
  console.error("Erro fatal no robô de coleta:", e);
  process.exit(1);
});
