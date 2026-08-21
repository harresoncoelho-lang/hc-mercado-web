// scripts/coletar_comprasnet_legado.js
// Robô de coleta ampla (Fase 1) do módulo Legado do Compras.gov.br —
// histórico de licitações federais sob a Lei 8.666/93, de 2015 até o ano
// corrente. Não busca vencedor ainda (isso é a Fase 2, robô separado
// enriquecer_comprasnet_legado.js). Grava no repositório de dados
// histórico dedicado (ver scripts/github_dados_historicos.js), não no
// Supabase — só um cursor de progresso pequeno fica no Supabase.
//
// Uso: node scripts/coletar_comprasnet_legado.js
// Variáveis de ambiente:
//   DADOS_HISTORICOS_TOKEN (obrigatória) - token de escrita no repo de dados
//   SUPABASE_SERVICE_ROLE_KEY (obrigatória) - pro cursor de progresso e cache de UASG
//   LIMITE_MINUTOS=12 - orçamento de tempo total do robô
//   ANO_INICIAL=2015 - primeiro ano da janela de coleta

const { obterMapaUasg } = require("./comprasnet_uasg_cache");
const { lerArquivoJson, escreverArquivoJson } = require("./github_dados_historicos");
const { buscarBlob, salvarBlob } = require("./supabase_dados");

const LIMITE_MINUTOS = parseFloat(process.env.LIMITE_MINUTOS || "12");
const ANO_INICIAL = parseInt(process.env.ANO_INICIAL || "2015", 10);
const LIMITE_MS = LIMITE_MINUTOS * 60 * 1000;
const inicioExecucao = Date.now();
function tempoRestanteMs() {
  return LIMITE_MS - (Date.now() - inicioExecucao);
}

const BASE_URL = "https://dadosabertos.compras.gov.br/modulo-legado/1_consultarLicitacao";

async function fetchComRetentativa(url, tentativas = 2, timeoutMs = 25000) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const resp = await fetch(url, { headers: { accept: "application/json" }, signal: ctrl.signal });
      clearTimeout(t);
      if (!resp.ok) {
        console.log(`[comprasnet-legado] HTTP ${resp.status} em ${url}`);
        if (i === tentativas - 1) return null;
        continue;
      }
      return await resp.json();
    } catch (e) {
      console.log(`[comprasnet-legado] Falha em ${url}: ${String((e && e.message) || e)}`);
      if (i === tentativas - 1) return null;
    }
  }
  return null;
}

// Guarda de escopo: o repositório de dados históricos é PÚBLICO. Esta lista é
// a única fonte da verdade de quais campos podem ir pra lá — qualquer objeto
// que vá ser escrito no repositório passa por validarCamposPermitidos()
// antes. Isso é uma garantia estrutural (falha alto e cedo se algum campo
// fora do escopo da spec aparecer), não só "cuidado" ao escrever o código —
// pedido explícito do Harreson antes do primeiro push de dados reais.
const CAMPOS_PERMITIDOS_LICITACAO = [
  "idCompra", "numeroProcesso", "uasg", "uf", "municipio", "modalidade",
  "nomeModalidade", "numeroAviso", "situacaoAviso", "objeto",
  "valorEstimado", "valorHomologado", "dataPublicacao", "dataAberturaProposta",
];

function validarCamposPermitidos(objeto, camposPermitidos, rotulo) {
  const chavesExtras = Object.keys(objeto).filter((k) => !camposPermitidos.includes(k));
  if (chavesExtras.length > 0) {
    throw new Error(
      `[guarda-escopo] ${rotulo} contém campo(s) fora do escopo definido na spec ` +
      `(docs/superpowers/specs/2026-08-20-comprasnet-legado-integracao-design.md): ` +
      `${chavesExtras.join(", ")}. Bloqueado de propósito — este repositório é público.`
    );
  }
}

function normalizarLicitacao(r, mapaUasg) {
  const uasg = r.uasg != null ? String(r.uasg) : "";
  const infoUasg = uasg ? mapaUasg.get(uasg) : null;
  const registro = {
    idCompra: r.id_compra || "",
    numeroProcesso: r.numero_processo || "",
    uasg,
    uf: (infoUasg && infoUasg.uf) || "",
    municipio: (infoUasg && infoUasg.municipio) || "",
    modalidade: r.modalidade != null ? r.modalidade : null,
    nomeModalidade: r.nome_modalidade || "",
    numeroAviso: r.numero_aviso != null ? String(r.numero_aviso) : "",
    situacaoAviso: r.situacao_aviso || "",
    objeto: r.objeto || "",
    valorEstimado: r.valor_estimado_total != null ? Number(r.valor_estimado_total) : null,
    valorHomologado: r.valor_homologado_total != null ? Number(r.valor_homologado_total) : null,
    dataPublicacao: r.data_publicacao || null,
    dataAberturaProposta: r.data_abertura_proposta || null,
  };
  validarCamposPermitidos(registro, CAMPOS_PERMITIDOS_LICITACAO, "Registro de licitação");
  return registro;
}

async function coletarAno(ano, paginaInicial, mapaUasg) {
  const novasPorRegistro = [];
  let pagina = paginaInicial;
  let totalPaginas = 1;
  let interrompidoPorTempo = false;

  while (pagina <= totalPaginas) {
    if (tempoRestanteMs() < 8000) { interrompidoPorTempo = true; break; }
    const url = `${BASE_URL}?pagina=${pagina}&tamanhoPagina=500&data_publicacao_inicial=${ano}-01-01&data_publicacao_final=${ano}-12-31`;
    const dados = await fetchComRetentativa(url);
    if (!dados) { interrompidoPorTempo = true; break; }
    totalPaginas = dados.totalPaginas || 1;
    for (const r of dados.resultado || []) {
      novasPorRegistro.push(normalizarLicitacao(r, mapaUasg));
    }
    pagina += 1;
  }

  return { registros: novasPorRegistro, proximaPagina: pagina, totalPaginas, interrompidoPorTempo };
}

async function gravarAno(ano, novosRegistros) {
  const { conteudo: existente } = await lerArquivoJson(`licitacoes/${ano}.json`);
  const mapa = new Map();
  for (const r of (existente && existente.registros) || []) mapa.set(r.idCompra, r);
  for (const r of novosRegistros) if (r.idCompra) mapa.set(r.idCompra, r);
  const registros = Array.from(mapa.values());
  await escreverArquivoJson(
    `licitacoes/${ano}.json`,
    { atualizadoEm: new Date().toISOString(), ano, registros },
    `Atualiza licitações de ${ano} (${registros.length} registro(s))`
  );
  return registros.length;
}

const CAMPOS_PERMITIDOS_LICITACAO_UASG = [
  "idCompra", "ano", "objeto", "situacaoAviso", "valorEstimado", "valorHomologado", "dataPublicacao",
];

async function gravarUasgsAfetadas(ano, novosRegistros, mapaUasg) {
  const porUasg = new Map();
  for (const r of novosRegistros) {
    if (!r.uasg) continue;
    if (!porUasg.has(r.uasg)) porUasg.set(r.uasg, []);
    porUasg.get(r.uasg).push(r);
  }
  let arquivosAtualizados = 0;
  for (const [uasg, registrosDaUasg] of porUasg) {
    const caminho = `uasgs/${uasg}.json`;
    const { conteudo: existente } = await lerArquivoJson(caminho);
    const mapa = new Map();
    for (const l of (existente && existente.licitacoes) || []) mapa.set(l.idCompra, l);
    for (const r of registrosDaUasg) {
      const registroUasg = {
        idCompra: r.idCompra,
        ano,
        objeto: r.objeto,
        situacaoAviso: r.situacaoAviso,
        valorEstimado: r.valorEstimado,
        valorHomologado: r.valorHomologado,
        dataPublicacao: r.dataPublicacao,
      };
      validarCamposPermitidos(registroUasg, CAMPOS_PERMITIDOS_LICITACAO_UASG, "Registro de licitação (arquivo de UASG)");
      mapa.set(r.idCompra, registroUasg);
    }
    const infoUasg = mapaUasg.get(uasg) || {};
    await escreverArquivoJson(
      caminho,
      {
        atualizadoEm: new Date().toISOString(),
        codigoUasg: uasg,
        uf: infoUasg.uf || "",
        municipio: infoUasg.municipio || "",
        nomeUasg: infoUasg.nomeUasg || "",
        licitacoes: Array.from(mapa.values()),
      },
      `Atualiza licitações da UASG ${uasg}`
    );
    arquivosAtualizados += 1;
  }
  return arquivosAtualizados;
}

async function main() {
  console.log(`Iniciando coleta ComprasNet Legado (Fase 1). Orçamento: ${LIMITE_MINUTOS} min.`);

  const mapaUasg = await obterMapaUasg();

  const progresso = (await buscarBlob("dados_robo", "comprasnet_progresso")) || {
    anoAtual: ANO_INICIAL,
    paginaAtual: 1,
    anosCompletos: [],
  };

  const anoFinal = new Date().getFullYear();
  let { anoAtual, paginaAtual, anosCompletos } = progresso;
  if (anoAtual > anoFinal) { anoAtual = ANO_INICIAL; paginaAtual = 1; anosCompletos = []; }

  let totalNovosNesteRun = 0;
  let totalUasgsAtualizadas = 0;

  while (anoAtual <= anoFinal && tempoRestanteMs() > 8000) {
    console.log(`[comprasnet-legado] Varrendo ano ${anoAtual}, a partir da página ${paginaAtual}...`);
    const { registros, proximaPagina, totalPaginas, interrompidoPorTempo } = await coletarAno(anoAtual, paginaAtual, mapaUasg);

    if (registros.length > 0) {
      const totalNoAno = await gravarAno(anoAtual, registros);
      const uasgsAtualizadas = await gravarUasgsAfetadas(anoAtual, registros, mapaUasg);
      totalNovosNesteRun += registros.length;
      totalUasgsAtualizadas += uasgsAtualizadas;
      console.log(`[comprasnet-legado] Ano ${anoAtual}: +${registros.length} registro(s) coletado(s) neste run, ${totalNoAno} no total do ano, ${uasgsAtualizadas} arquivo(s) de UASG atualizado(s).`);
    }

    if (interrompidoPorTempo) {
      paginaAtual = proximaPagina;
      break;
    }

    // Ano completo: avança pro próximo.
    anosCompletos.push(anoAtual);
    anoAtual += 1;
    paginaAtual = 1;
  }

  await salvarBlob("dados_robo", "comprasnet_progresso", { anoAtual, paginaAtual, anosCompletos });

  console.log(
    `Coleta finalizada. ${totalNovosNesteRun} registro(s) coletado(s) neste run, ` +
    `${totalUasgsAtualizadas} arquivo(s) de UASG atualizado(s). ` +
    `Progresso salvo: ano ${anoAtual}, página ${paginaAtual}.`
  );

  if (totalNovosNesteRun === 0 && anosCompletos.length === 0) {
    console.log("AVISO: nenhum registro coletado nesta execução — verifique se a API mudou ou se o orçamento de tempo é suficiente.");
  }
}

// require.main === module: só roda main() quando o script é executado
// diretamente (node scripts/coletar_comprasnet_legado.js ou via workflow) —
// não quando é importado como módulo (Task 4, Step 3, teste isolado da
// guarda de escopo), senão o teste dispararia uma coleta real sem querer.
if (require.main === module) {
  main().catch((e) => {
    console.error("Erro fatal no robô de coleta do ComprasNet Legado:", e);
    process.exit(1);
  });
}

module.exports = { validarCamposPermitidos, CAMPOS_PERMITIDOS_LICITACAO };
