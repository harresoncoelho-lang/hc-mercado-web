// Robô incremental de resultados homologados do Compras.gov (Lei 14.133),
// via API pública dadosabertos.compras.gov.br. Complementa o PNCP com quem
// venceu cada item, valores homologados e a descrição oficial do item.
//
// Uso: node scripts/coletar_comprasgov_resultados.js
// Variáveis de ambiente opcionais:
//   LIMITE_MINUTOS=12          -> orçamento total da execução
//   DIAS_INICIAIS=30           -> janela inicial quando ainda não há cursor
//   DATA_INICIAL=YYYY-MM-DD    -> início explícito (útil para backfill)
//   DATA_FINAL=YYYY-MM-DD      -> fim explícito (útil para backfill)
//   FOLGA_DIAS=2               -> dias recentes revisitados após alcançar hoje
//   TAMANHO_PAGINA=100         -> 10 a 500, conforme limite da API
//   ATRASO_MS=350              -> pausa educada entre páginas
//   CONCORRENCIA_ITENS=3       -> compras enriquecidas em paralelo por página
//   SUPABASE_SERVICE_ROLE_KEY  -> obrigatória para gravar dados e cursor
//
// O robô só usa APIs públicas e só normaliza campos explicitamente fornecidos.
// Marca e modelo permanecem nulos quando não estão no item oficial; não são
// deduzidos da descrição nem do fornecedor.

const { buscarBlob, salvarBlob, upsertEmLotes } = require("./supabase_dados");

const BASE_URL = "https://dadosabertos.compras.gov.br/modulo-contratacoes";
const LIMITE_MINUTOS = parseFloat(process.env.LIMITE_MINUTOS || "12");
const DIAS_INICIAIS = parseInt(process.env.DIAS_INICIAIS || "30", 10);
const FOLGA_DIAS = parseInt(process.env.FOLGA_DIAS || "2", 10);
const TAMANHO_PAGINA = Math.min(500, Math.max(10, parseInt(process.env.TAMANHO_PAGINA || "100", 10)));
const ATRASO_MS = parseInt(process.env.ATRASO_MS || "350", 10);
const CONCORRENCIA_ITENS = Math.max(1, parseInt(process.env.CONCORRENCIA_ITENS || "3", 10));
const LIMITE_MS = LIMITE_MINUTOS * 60 * 1000;
const CHAVE_ESTADO = "comprasgov_resultados_estado";
const inicioExecucao = Date.now();

function tempoRestanteMs() {
  return LIMITE_MS - (Date.now() - inicioExecucao);
}

function dormir(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hojeIso() {
  return new Date().toISOString().slice(0, 10);
}

function somarDias(dataIso, dias) {
  const data = new Date(`${dataIso}T00:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

function chaveResultado(resultado) {
  return `${resultado.idCompraItem || ""}:${resultado.sequencialResultado || ""}`;
}

async function buscarJson(url, rotulo, tentativas = 3) {
  let ultimoErro = null;
  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    const controlador = new AbortController();
    const timeout = setTimeout(() => controlador.abort(), 30000);
    try {
      const resposta = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: controlador.signal,
      });
      if (!resposta.ok) {
        ultimoErro = new Error(`${rotulo}: HTTP ${resposta.status}`);
      } else {
        const dados = await resposta.json();
        if (!Array.isArray(dados.resultado)) {
          ultimoErro = new Error(`${rotulo}: formato de resposta inesperado`);
        } else {
          return dados;
        }
      }
    } catch (erro) {
      ultimoErro = erro;
    } finally {
      clearTimeout(timeout);
    }
    if (tentativa < tentativas) await dormir(1000 * tentativa);
  }
  throw ultimoErro || new Error(`${rotulo}: falha desconhecida`);
}

async function buscarResultados(data, pagina) {
  const parametros = new URLSearchParams({
    pagina: String(pagina),
    tamanhoPagina: String(TAMANHO_PAGINA),
    dataResultadoPncpInicial: data,
    dataResultadoPncpFinal: data,
  });
  const url = `${BASE_URL}/3_consultarResultadoItensContratacoes_PNCP_14133?${parametros}`;
  return buscarJson(url, `resultados de ${data}, página ${pagina}`);
}

async function buscarItensDaCompra(idCompra) {
  if (!idCompra) return new Map();
  const parametros = new URLSearchParams({ tipo: "idCompra", codigo: idCompra });
  const url = `${BASE_URL}/2.1_consultarItensContratacoes_PNCP_14133_Id?${parametros}`;
  const dados = await buscarJson(url, `itens da compra ${idCompra}`, 2);
  return new Map((dados.resultado || []).map((item) => [String(item.idCompraItem || ""), item]));
}

async function emMapaComConcorrencia(valores, limite, fn) {
  const saida = new Map();
  let proximo = 0;
  async function trabalhador() {
    while (proximo < valores.length) {
      const indice = proximo;
      proximo += 1;
      const valor = valores[indice];
      try {
        saida.set(valor, await fn(valor));
      } catch (erro) {
        console.log(`[comprasgov-resultados] Item complementar indisponível para ${valor}: ${erro.message}`);
        saida.set(valor, new Map());
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, valores.length) }, trabalhador));
  return saida;
}

function normalizarResultado(resultado, item, coletadoEm) {
  const chave = chaveResultado(resultado);
  if (!resultado.idCompraItem || resultado.sequencialResultado == null) return null;
  const descricaoItem = item ? (item.descricaodetalhada || item.descricaoResumida || "") : "";
  const dado = {
    fonte: "comprasgov_dados_abertos",
    fonteResultado: `${BASE_URL}/3_consultarResultadoItensContratacoes_PNCP_14133`,
    fonteItem: item ? `${BASE_URL}/2.1_consultarItensContratacoes_PNCP_14133_Id` : null,
    coletadoEm,
    compra: {
      id: resultado.idCompra || "",
      idContratacaoPncp: resultado.idContratacaoPNCP || "",
      numeroControlePncp: resultado.numeroControlePNCPCompra || "",
      unidadeCodigo: resultado.unidadeOrgaoCodigoUnidade || "",
      uf: resultado.unidadeOrgaoUfSigla || "",
      cnpjOrgao: resultado.orgaoEntidadeCnpj || "",
    },
    item: {
      id: resultado.idCompraItem,
      numero: resultado.numeroItemPncp ?? null,
      descricao: descricaoItem,
      descricaoResumida: item?.descricaoResumida || "",
      catalogoCodigo: item?.codItemCatalogo ?? null,
      catalogoClasse: item?.codigoClasse ?? null,
      unidadeMedida: item?.unidadeMedida || "",
      marca: null,
      modelo: null,
      marcaModeloStatus: "não informado pela API pública do Compras.gov neste item",
    },
    fornecedor: {
      documento: resultado.niFornecedor || "",
      tipoPessoa: resultado.tipoPessoa || "",
      nome: resultado.nomeRazaoSocialFornecedor || "",
      porte: resultado.porteFornecedorNome || "",
      naturezaJuridica: resultado.naturezaJuridicaNome || "",
      pais: resultado.codigoPais || "",
    },
    resultado: {
      sequencial: resultado.sequencialResultado ?? null,
      classificacao: resultado.ordemClassificacaoSrp ?? null,
      situacao: resultado.situacaoCompraItemResultadoNome || "",
      situacaoId: resultado.situacaoCompraItemResultadoId ?? null,
      data: resultado.dataResultadoPncp || null,
      quantidadeHomologada: resultado.quantidadeHomologada ?? null,
      valorUnitarioHomologado: resultado.valorUnitarioHomologado ?? null,
      valorTotalHomologado: resultado.valorTotalHomologado ?? null,
      percentualDesconto: resultado.percentualDesconto ?? null,
      beneficioMeepp: Boolean(resultado.aplicacaoBeneficioMeepp),
      criterioDesempate: Boolean(resultado.aplicacaoCriterioDesempate),
    },
  };
  return {
    chave,
    id_compra_item: String(resultado.idCompraItem),
    id_compra: resultado.idCompra || null,
    numero_controle_pncp: resultado.numeroControlePNCPCompra || null,
    uf: resultado.unidadeOrgaoUfSigla || null,
    cnpj_fornecedor: resultado.niFornecedor || null,
    data_resultado: resultado.dataResultadoPncp ? String(resultado.dataResultadoPncp).slice(0, 10) : null,
    dado,
    atualizado_em: coletadoEm,
  };
}

async function salvarEstado(estado) {
  await salvarBlob("dados_robo", CHAVE_ESTADO, { ...estado, atualizadoEm: new Date().toISOString() });
}

async function main() {
  const hoje = process.env.DATA_FINAL || hojeIso();
  const estadoAnterior = (await buscarBlob("dados_robo", CHAVE_ESTADO)) || {};
  const inicioPadrao = somarDias(hoje, -DIAS_INICIAIS);
  let data = process.env.DATA_INICIAL || estadoAnterior.proximaData || inicioPadrao;
  let pagina = process.env.DATA_INICIAL ? 1 : (estadoAnterior.proximaPagina || 1);
  const dataFinal = hoje;
  let registrosSalvos = 0;
  let paginasProcessadas = 0;

  console.log(`[comprasgov-resultados] Coletando de ${data} até ${dataFinal}; orçamento ${LIMITE_MINUTOS} min.`);
  while (data <= dataFinal && tempoRestanteMs() > 12000) {
    let resposta;
    try {
      resposta = await buscarResultados(data, pagina);
    } catch (erro) {
      await salvarEstado({ proximaData: data, proximaPagina: pagina, saudeFonte: "indisponivel", ultimoErro: erro.message });
      throw erro;
    }

    const idsCompra = [...new Set((resposta.resultado || []).map((r) => r.idCompra).filter(Boolean))];
    const itensPorCompra = await emMapaComConcorrencia(idsCompra, CONCORRENCIA_ITENS, buscarItensDaCompra);
    const coletadoEm = new Date().toISOString();
    const linhas = (resposta.resultado || [])
      .map((resultado) => normalizarResultado(resultado, itensPorCompra.get(resultado.idCompra)?.get(String(resultado.idCompraItem)), coletadoEm))
      .filter(Boolean);

    if (linhas.length > 0) {
      await upsertEmLotes("comprasgov_resultados", linhas, "chave");
      registrosSalvos += linhas.length;
    }
    paginasProcessadas += 1;
    const totalPaginas = resposta.totalPaginas || 1;
    if (pagina >= totalPaginas) {
      data = somarDias(data, 1);
      pagina = 1;
    } else {
      pagina += 1;
    }
    await salvarEstado({ proximaData: data, proximaPagina: pagina, saudeFonte: "ok", ultimoSucessoEm: coletadoEm });
    await dormir(ATRASO_MS);
  }

  if (data > dataFinal) {
    const reinicio = somarDias(hoje, -FOLGA_DIAS);
    await salvarEstado({ proximaData: reinicio, proximaPagina: 1, saudeFonte: "ok", ultimoSucessoEm: new Date().toISOString() });
    console.log(`[comprasgov-resultados] Janela concluída; próxima execução revisita desde ${reinicio}.`);
  }
  console.log(`[comprasgov-resultados] Concluído: ${paginasProcessadas} página(s), ${registrosSalvos} resultado(s) salvos.`);
}

if (require.main === module) {
  main().catch((erro) => {
    console.error("Erro fatal no robô de resultados do Compras.gov:", erro);
    process.exit(1);
  });
}

module.exports = { chaveResultado, normalizarResultado, somarDias };
