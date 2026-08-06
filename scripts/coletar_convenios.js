// Robo de coleta de CONVENIOS e REPASSES federais (Portal da Transparencia) para o
// HC Licitacoes. Roda no GitHub Actions (cron diario) e grava data/convenios.json.
//
// Por que isso e diferente da lista de "licitacoes federais" que a aba Portal da
// Transparencia mostrava antes: convenio/repasse e dinheiro que um orgao federal
// libera pra um municipio/entidade executar uma obra ou servico. Quando um municipio
// recebe um convenio novo, e um sinal forte de que uma licitacao pra executar aquilo
// tende a aparecer NO PNCP dali a algumas semanas/meses. Ou seja: e um radar de
// demanda futura, dado que nenhuma outra aba do site cobre hoje (o PNCP so mostra a
// licitacao quando ela ja foi publicada, nao o repasse que a origina).
//
// Endpoint: GET /api-de-dados/convenios (aceita uf, dataInicial/dataFinal, direto -
// nao exige codigoOrgao como o endpoint de licitacoes exigia).
//
// Uso: node scripts/coletar_convenios.js
// Variavel de ambiente obrigatoria:
//   TRANSPARENCIA_TOKEN  -> mesma chave ja usada em coletar_transparencia.js
// Variaveis opcionais:
//   RETENCAO_DIAS=730        -> quanto historico manter acumulado (padrao 24 meses)
//   LIMITE_MINUTOS=13        -> orcamento de tempo total do robo (padrao 13 min)
//   DIAS_HISTORICO_INICIAL=60 -> na 1a execucao, quantos dias varrer (padrao 60)

const TOKEN = process.env.TRANSPARENCIA_TOKEN;
const RETENCAO_DIAS = parseInt(process.env.RETENCAO_DIAS || "730", 10);
const LIMITE_MINUTOS = parseFloat(process.env.LIMITE_MINUTOS || "13");
const LIMITE_MS = LIMITE_MINUTOS * 60 * 1000;
const DIAS_HISTORICO_INICIAL = parseInt(process.env.DIAS_HISTORICO_INICIAL || "60", 10);
const FOLGA_DIAS = 3;
const BASE_URL = "https://api.portaldatransparencia.gov.br/api-de-dados";

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

function paraIso(dataBr) {
  if (!dataBr) return null;
  const m = String(dataBr).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

async function fetchApi(caminho, tentativas = 3) {
  const url = `${BASE_URL}${caminho}`;
  for (let i = 0; i < tentativas; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 25000);
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
        if (resp.status === 401) console.error("ERRO 401: token invalido (TRANSPARENCIA_TOKEN).");
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

async function lerJsonExistente(caminho) {
  try {
    const fs = await import("node:fs/promises");
    const texto = await fs.readFile(caminho, "utf8");
    return JSON.parse(texto);
  } catch (e) {
    return null;
  }
}

function chaveConvenio(r) {
  return r.id || `${r.numeroProcesso}|${r.convenente}|${r.dataPublicacao}`;
}

// Varre /convenios pra TODO o Brasil (sem restringir UF) dentro da janela de datas,
// pra caber no proposito nacional do site (nao so Manaus/AM). Pagina ate estourar o
// orcamento de tempo ou acabar os resultados.
async function coletarConvenios(caminhoArquivo) {
  const existentes = await lerJsonExistente(caminhoArquivo);
  const hoje = new Date();

  let inicio;
  const primeiraExecucao = !existentes || !Array.isArray(existentes.registros);
  if (!primeiraExecucao && existentes.dataFinal) {
    const [dd, mm, yyyy] = existentes.dataFinal.split("/");
    const dataFinalAnterior = new Date(`${yyyy}-${mm}-${dd}`);
    inicio = new Date(dataFinalAnterior.getTime() - FOLGA_DIAS * 24 * 60 * 60 * 1000);
  } else {
    inicio = new Date(hoje.getTime() - DIAS_HISTORICO_INICIAL * 24 * 60 * 60 * 1000);
  }
  const dataInicial = fmtDataBR(inicio);
  const dataFinal = fmtDataBR(hoje);

  const novos = [];
  let pagina = 1;
  let paginasVarridas = 0;
  let parcial = false;

  while (true) {
    if (tempoRestanteMs() < 15000) { parcial = true; break; }
    const dados = await fetchApi(`/convenios?dataInicial=${dataInicial}&dataFinal=${dataFinal}&pagina=${pagina}`);
    if (dados === null) { parcial = true; break; }
    if (!Array.isArray(dados) || dados.length === 0) break;
    paginasVarridas += 1;

    for (const item of dados) {
      const localidade = item.localidadePessoa || {};
      const municipioConv = item.municipioConvenente || {};
      novos.push({
        id: item.id || null,
        numeroProcesso: item.numeroProcesso || "",
        objeto: (item.dimConvenio && item.dimConvenio.objeto) || item.tipoInstrumento || "",
        situacao: item.situacao || "",
        tipoInstrumento: item.tipoInstrumento || "",
        convenente: item.convenente || "",
        orgao: (item.orgao && item.orgao.nome) || "",
        unidadeGestora: (item.unidadeGestora && item.unidadeGestora.nome) || "",
        municipio: municipioConv.nomeIBGE || localidade.municipio || "",
        uf: (municipioConv.uf && municipioConv.uf.sigla) || localidade.uf || "",
        valor: Number(item.valor || 0),
        valorLiberado: Number(item.valorLiberado || 0),
        valorContrapartida: Number(item.valorContrapartida || 0),
        dataPublicacao: paraIso(item.dataPublicacao),
        dataInicioVigencia: paraIso(item.dataInicioVigencia),
        dataFinalVigencia: paraIso(item.dataFinalVigencia),
        dataUltimaLiberacao: paraIso(item.dataUltimaLiberacao),
      });
    }

    if (dados.length < 10) break; // provavelmente ultima pagina
    pagina += 1;
    if (pagina > 300) break; // trava de seguranca
  }

  const mapa = new Map();
  if (existentes && Array.isArray(existentes.registros)) {
    for (const r of existentes.registros) mapa.set(chaveConvenio(r), r);
  }
  for (const r of novos) mapa.set(chaveConvenio(r), r);

  const limiteRetencao = new Date(hoje.getTime() - RETENCAO_DIAS * 24 * 60 * 60 * 1000);
  const registros = Array.from(mapa.values()).filter((r) => {
    if (!r.dataPublicacao) return true;
    const d = new Date(r.dataPublicacao);
    return isNaN(d) || d >= limiteRetencao;
  });

  console.log(
    `[convenios] Concluido: ${novos.length} vistos nesta execucao (${paginasVarridas} pagina(s), parcial=${parcial}). ` +
    `Total acumulado apos fundir/podar (retencao ${RETENCAO_DIAS}d): ${registros.length} registros.`
  );

  return {
    atualizadoEm: new Date().toISOString(),
    dataInicial,
    dataFinal,
    retencaoDias: RETENCAO_DIAS,
    parcial,
    totalRegistros: registros.length,
    registros,
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

  console.log(`Iniciando coleta de convenios/repasses. Retencao: ${RETENCAO_DIAS} dias. Orcamento: ${LIMITE_MINUTOS} min.`);

  const caminhoArquivo = path.join(dirDados, "convenios.json");
  const resultado = await coletarConvenios(caminhoArquivo);
  await fs.writeFile(caminhoArquivo, JSON.stringify(resultado), "utf8");
  console.log("Gravado data/convenios.json");
  console.log("Coleta finalizada com sucesso.");
}

main().catch((e) => {
  console.error("Erro fatal no robo de coleta:", e);
  process.exit(1);
});
