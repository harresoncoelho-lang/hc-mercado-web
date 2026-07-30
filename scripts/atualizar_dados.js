// Robo de coleta diaria do PNCP para o HC Licitacoes.
// Roda no GitHub Actions (cron diario) e grava arquivos JSON estaticos em /data,
// que o site (index.html) le diretamente - sem precisar consultar o PNCP na hora
// que o usuario faz uma busca.
//
// Uso: node scripts/atualizar_dados.js
// Variaveis de ambiente opcionais:
//   DIAS_HISTORICO=15          -> quantos dias de contratos historicos varrer (padrao 15)
//   LIMITE_MINUTOS=25          -> orcamento de tempo total do robo (padrao 25 min)

const DIAS_HISTORICO = parseInt(process.env.DIAS_HISTORICO || "15", 10);
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

// ---------- Contratos historicos (nacional, ultimos N dias) ----------
async function coletarContratos() {
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - DIAS_HISTORICO * 24 * 60 * 60 * 1000);
  const dataInicial = fmtData(inicio);
  const dataFinal = fmtData(hoje);

  const registros = [];
  let pagina = 1;
  let totalPaginas = 1;
  let paginasVarridas = 0;
  let parcial = false;

  while (pagina <= totalPaginas) {
    if (tempoRestanteMs() < 15000) {
      parcial = true;
      console.log(`[contratos] Orcamento de tempo esgotado na pagina ${pagina}/${totalPaginas}.`);
      break;
    }
    const url = `https://pncp.gov.br/api/consulta/v1/contratos?dataInicial=${dataInicial}&dataFinal=${dataFinal}&pagina=${pagina}&tamanhoPagina=${TAMANHO_PAGINA}`;
    const dados = await fetchComRetentativa(url);
    if (!dados) {
      console.log(`[contratos] Falha ao buscar pagina ${pagina}, parando (parcial).`);
      parcial = true;
      break;
    }
    const itens = dados.data || [];
    totalPaginas = dados.totalPaginas || 1;
    paginasVarridas += 1;

    for (const item of itens) {
      registros.push({
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
      console.log(`[contratos] ${pagina}/${totalPaginas} paginas, ${registros.length} registros ate agora...`);
    }
    pagina += 1;
  }

  console.log(`[contratos] Concluido: ${registros.length} registros, ${paginasVarridas} paginas varridas de ${totalPaginas}, parcial=${parcial}.`);

  return {
    atualizadoEm: new Date().toISOString(),
    dataInicial,
    dataFinal,
    diasHistorico: DIAS_HISTORICO,
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
      console.log(`[oportunidades] Orcamento de tempo esgotado antes de terminar todas as UFs (parou em ${uf}).`);
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
          orgao: (item.orgaoEntidade && item.orgaoEntidade.razaoSocial) || "Orgao nao informado",
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

  console.log(`[oportunidades] Concluido: ${todas.length} oportunidades abertas, falhas em: ${ufsComFalha.join(", ") || "nenhuma"}.`);

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

  console.log(`Iniciando coleta. Historico: ${DIAS_HISTORICO} dias. Orcamento: ${LIMITE_MINUTOS} min.`);

  const contratos = await coletarContratos();
  await fs.writeFile(
    path.join(dirDados, "contratos_recentes.json"),
    JSON.stringify(contratos),
    "utf8"
  );
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
  console.error("Erro fatal no robo de coleta:", e);
  process.exit(1);
});
