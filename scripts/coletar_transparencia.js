// Robô de coleta do Portal da Transparência (licitações federais) para o HC Licitações.
// Roda no GitHub Actions (cron diário) e grava data/transparencia_licitacoes.json.
//
// Diferença importante em relação ao PNCP: a API de licitações do Portal da
// Transparência EXIGE um "codigoOrgao" em cada consulta (não da pra buscar por
// UF ou palavra-chave livremente). A estrategia aqui e:
//   1. Buscar a lista de orgaos federais (SIAFI) - endpoint publico, paginado.
//   2. Para cada orgao, consultar as licitacoes dos ultimos DIAS_JANELA dias.
//   3. Filtrar so as licitacoes cujo municipio.uf bate com as UFs de interesse.
//   4. Aplicar o mesmo filtro de palavra-chave usado no boletim de editais.
//
// Uso: node scripts/coletar_transparencia.js
// Variavel de ambiente obrigatoria:
//   TRANSPARENCIA_TOKEN  -> chave de API gerada em portaldatransparencia.gov.br/api-de-dados/cadastrar-email
// Variaveis opcionais:
//   DIAS_JANELA=3          -> quantos dias pra tras buscar (padrao 3, cobre falhas de execucao)
//   UFS_INTERESSE=AM,RR    -> UFs a filtrar (padrao AM,RR)
//   LIMITE_MINUTOS=20      -> orcamento de tempo total do robo (padrao 20 min)

const TOKEN = process.env.TRANSPARENCIA_TOKEN;
const DIAS_JANELA = parseInt(process.env.DIAS_JANELA || "3", 10);
const UFS_INTERESSE = (process.env.UFS_INTERESSE || "AM,RR").split(",").map((s) => s.trim().toUpperCase());
const LIMITE_MINUTOS = parseFloat(process.env.LIMITE_MINUTOS || "20");
const LIMITE_MS = LIMITE_MINUTOS * 60 * 1000;
const BASE_URL = "https://api.portaldatransparencia.gov.br/api-de-dados";

// Radicais de palavra (sem plural/genero fixo) - mesma logica do boletim de editais.
const PALAVRAS_CHAVE = [
  "expediente", "higiene", "limpeza", "aliment", "veiculo", "hospitalar",
  "engenharia", "fotovoltaic", "eletric", "informatica",
];

const inicioExecucao = Date.now();
function tempoRestanteMs() {
  return LIMITE_MS - (Date.now() - inicioExecucao);
}

function fmtDataBR(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function normalizar(texto) {
  return (texto || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function bateComPalavraChave(objeto) {
  const norm = normalizar(objeto);
  return PALAVRAS_CHAVE.some((p) => norm.includes(normalizar(p)));
}

async function fetchApi(caminho, tentativas = 3) {
  const url = `${BASE_URL}${caminho}`;
  for (let i = 0; i < tentativas; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30000);
      const resp = await fetch(url, {
        headers: { Accept: "application/json", "chave-api-dados": TOKEN },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (resp.status === 429) {
        await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
        continue;
      }
      if (!resp.ok) {
        if (resp.status === 401) {
          console.error("ERRO 401: token invalido ou nao informado (TRANSPARENCIA_TOKEN).");
        }
        return null;
      }
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

// ---------- 1. Lista de orgaos federais (SIAFI) ----------
async function buscarOrgaos() {
  const orgaos = [];
  let pagina = 1;
  while (true) {
    if (tempoRestanteMs() < 60000) {
      console.log("[orgaos] Orcamento de tempo esgotado buscando lista de orgaos.");
      break;
    }
    const dados = await fetchApi(`/orgaos-siafi?pagina=${pagina}`);
    if (!dados || !Array.isArray(dados) || dados.length === 0) break;
    orgaos.push(...dados);
    pagina += 1;
    if (pagina > 30) break; // trava de seguranca
  }
  console.log(`[orgaos] ${orgaos.length} orgaos encontrados.`);
  return orgaos;
}

// ---------- 2. Licitacoes por orgao, filtradas por UF e palavra-chave ----------
async function coletarLicitacoes(orgaos) {
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - DIAS_JANELA * 24 * 60 * 60 * 1000);
  const dataInicial = fmtDataBR(inicio);
  const dataFinal = fmtDataBR(hoje);

  const encontradas = [];
  let orgaosComFalha = [];
  let orgaosVarridos = 0;

  for (const orgao of orgaos) {
    if (tempoRestanteMs() < 15000) {
      console.log(`[licitacoes] Orcamento de tempo esgotado (parou apos ${orgaosVarridos}/${orgaos.length} orgaos).`);
      break;
    }
    const codigo = orgao.codigo;
    if (!codigo) continue;

    let pagina = 1;
    let falhouOrgao = false;
    while (pagina <= 5) {
      const caminho = `/licitacoes?dataInicial=${dataInicial}&dataFinal=${dataFinal}&codigoOrgao=${codigo}&pagina=${pagina}`;
      const dados = await fetchApi(caminho);
      if (dados === null) { falhouOrgao = true; break; }
      if (!Array.isArray(dados) || dados.length === 0) break;

      for (const item of dados) {
        const uf = item.municipio && item.municipio.uf && item.municipio.uf.sigla;
        if (!uf || !UFS_INTERESSE.includes(uf)) continue;
        const objeto = (item.licitacao && item.licitacao.objeto) || "";
        if (!bateComPalavraChave(objeto)) continue;
        encontradas.push({
          id: item.id || null,
          objeto,
          numero: (item.licitacao && item.licitacao.numero) || "",
          numeroProcesso: (item.licitacao && item.licitacao.numeroProcesso) || "",
          modalidade: item.modalidadeLicitacao || "",
          situacao: item.situacaoCompra || "",
          dataAbertura: item.dataAbertura || null,
          dataPublicacao: item.dataPublicacao || null,
          valor: Number(item.valor || 0),
          uf,
          municipio: (item.municipio && item.municipio.nomeIBGE) || "",
          orgao: orgao.descricao || "",
          unidadeGestora: (item.unidadeGestora && item.unidadeGestora.descricao) || "",
        });
      }
      if (dados.length < 15) break; // provavelmente ultima pagina (tamanho padrao da API)
      pagina += 1;
    }
    if (falhouOrgao) orgaosComFalha.push(codigo);
    orgaosVarridos += 1;
    if (orgaosVarridos % 25 === 0) {
      console.log(`[licitacoes] ${orgaosVarridos}/${orgaos.length} orgaos varridos, ${encontradas.length} achadas ate agora...`);
    }
  }

  console.log(`[licitacoes] Concluido: ${encontradas.length} licitacoes relevantes, ${orgaosVarridos} orgaos varridos, falhas em ${orgaosComFalha.length} orgao(s).`);

  return {
    atualizadoEm: new Date().toISOString(),
    dataInicial,
    dataFinal,
    ufsInteresse: UFS_INTERESSE,
    orgaosVarridos,
    totalOrgaos: orgaos.length,
    orgaosComFalha,
    totalRegistros: encontradas.length,
    registros: encontradas,
  };
}

async function main() {
  if (!TOKEN) {
    console.error("ERRO FATAL: variavel TRANSPARENCIA_TOKEN nao configurada.");
    process.exit(1);
  }

  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const dirDados = path.join(process.cwd(), "data");
  await fs.mkdir(dirDados, { recursive: true });

  console.log(`Iniciando coleta Portal da Transparencia. Janela: ${DIAS_JANELA} dias. UFs: ${UFS_INTERESSE.join(",")}. Orcamento: ${LIMITE_MINUTOS} min.`);

  const orgaos = await buscarOrgaos();
  if (orgaos.length === 0) {
    console.error("Nenhum orgao encontrado (token invalido ou API indisponivel). Abortando sem sobrescrever dados antigos.");
    process.exit(1);
  }

  const resultado = await coletarLicitacoes(orgaos);
  await fs.writeFile(
    path.join(dirDados, "transparencia_licitacoes.json"),
    JSON.stringify(resultado),
    "utf8"
  );
  console.log("Gravado data/transparencia_licitacoes.json");
  console.log("Coleta finalizada com sucesso.");
}

main().catch((e) => {
  console.error("Erro fatal no robo de coleta:", e);
  process.exit(1);
});
