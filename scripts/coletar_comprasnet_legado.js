// scripts/coletar_comprasnet_legado.js
// Robô de coleta ampla (Fase 1) do módulo Legado do Compras.gov.br —
// histórico de licitações federais sob a Lei 8.666/93, de 2015 até o ano
// corrente. Não busca vencedor ainda (isso é a Fase 2, robô separado
// enriquecer_comprasnet_legado.js).
//
// Grava em ARQUIVOS LOCAIS dentro de um clone do repositório de dados
// históricos dedicado (não no Supabase — só um cursor de progresso pequeno
// fica no Supabase). O clone, o commit e o push são feitos pelo workflow
// (.github/workflows/coletar-comprasnet-legado.yml), no mesmo padrão do
// passo "Publicar dados privados no painel interno" de
// .github/workflows/atualizar-dados.yml. Este script só lê/escreve arquivos
// em DADOS_HISTORICOS_DIR — nenhuma chamada HTTP ao GitHub. Isso evita de
// uma vez: o teto de ~1 MB da API de Contents pra leitura, o rate limit
// secundário de milhares de escritas arquivo a arquivo, e o controle de sha.
//
// Uso: node scripts/coletar_comprasnet_legado.js
// Variáveis de ambiente:
//   DADOS_HISTORICOS_DIR (obrigatória) - caminho do clone local do repositório
//     de dados históricos (o workflow clona em /tmp/dados-historicos-comprasnet)
//   SUPABASE_SERVICE_ROLE_KEY (obrigatória) - pro cursor de progresso e cache de UASG
//   LIMITE_MINUTOS=12 - orçamento de tempo total do robô
//   ANO_INICIAL=2015 - primeiro ano da janela de coleta
//   ATRASO_MS=250 - pausa entre páginas (educado com a API pública; mesmo
//     valor já usado em scripts/coletar_fornecedores_sicaf.js pra essa mesma
//     API dadosabertos.compras.gov.br)

const fs = require("fs");
const path = require("path");
const { obterMapaUasg } = require("./comprasnet_uasg_cache");
const { buscarBlob, salvarBlob } = require("./supabase_dados");

const LIMITE_MINUTOS = parseFloat(process.env.LIMITE_MINUTOS || "12");
const ANO_INICIAL = parseInt(process.env.ANO_INICIAL || "2015", 10);
const ATRASO_MS = parseInt(process.env.ATRASO_MS || "250", 10);
const LIMITE_MS = LIMITE_MINUTOS * 60 * 1000;
const inicioExecucao = Date.now();
function tempoRestanteMs() {
  return LIMITE_MS - (Date.now() - inicioExecucao);
}
function dormir(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

// --- I/O no clone local do repositório de dados históricos -----------------
// Só arquivo local: leitura/escrita são praticamente instantâneas e não
// precisam de orçamento de tempo próprio (o único orçamento que importa é o
// das chamadas à API do Compras.gov.br, checado no laço de coleta).

function dirDados() {
  const dir = process.env.DADOS_HISTORICOS_DIR;
  if (!dir) {
    throw new Error(
      "DADOS_HISTORICOS_DIR não configurada. Ela deve apontar pro clone local do " +
      "repositório de dados históricos — o workflow " +
      ".github/workflows/coletar-comprasnet-legado.yml clona o repositório antes " +
      "de rodar este script e depois commita/envia o que foi escrito aqui."
    );
  }
  return dir;
}

// Lê um JSON do clone local. Retorna null se o arquivo ainda não existir —
// não é erro, é o caso normal na primeira vez que um ano/UASG é gravado
// (equivalente ao antigo 404 da API de Contents). Também retorna null se o
// conteúdo não for JSON válido (arquivo truncado por alguma escrita
// anterior interrompida) em vez de lançar: um JSON.parse não tratado aqui
// travaria a leitura E a escrita daquele arquivo pra sempre — exatamente o
// tipo de corrupção permanente que motivou trocar a API de Contents pelo
// clone local (ver nota de correção no plano). Tratar como "ausente" deixa
// a próxima gravação bem-sucedida sobrescrever o arquivo corrompido.
async function lerJsonLocal(caminhoRelativo) {
  const caminhoAbsoluto = path.join(dirDados(), caminhoRelativo);
  let texto;
  try {
    texto = await fs.promises.readFile(caminhoAbsoluto, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") return null;
    throw e;
  }
  if (!texto.trim()) return null;
  try {
    return JSON.parse(texto);
  } catch (e) {
    console.log(`[comprasnet-legado] AVISO: ${caminhoRelativo} está corrompido (JSON inválido) — tratando como ausente. ${String((e && e.message) || e)}`);
    return null;
  }
}

// Escreve em arquivo temporário e faz rename por cima do arquivo final.
// rename() é atômico no mesmo filesystem (o clone inteiro fica em
// /tmp/dados-historicos-comprasnet) — se o job for morto no meio (SIGKILL
// por timeout-minutes), o arquivo final nunca fica truncado: ou continua
// com o conteúdo antigo inteiro, ou já tem o conteúdo novo inteiro.
async function escreverJsonLocal(caminhoRelativo, objeto) {
  const caminhoAbsoluto = path.join(dirDados(), caminhoRelativo);
  await fs.promises.mkdir(path.dirname(caminhoAbsoluto), { recursive: true });
  const caminhoTemporario = `${caminhoAbsoluto}.tmp-${process.pid}`;
  await fs.promises.writeFile(caminhoTemporario, JSON.stringify(objeto), "utf8");
  await fs.promises.rename(caminhoTemporario, caminhoAbsoluto);
}

// Guarda de escopo: o repositório de dados históricos é privado hoje, e
// potencialmente público no futuro (a decisão depende de uma tensão de
// licença ainda não resolvida — ver a "Atualização 2026-08-20" em
// docs/superpowers/specs/2026-08-20-comprasnet-legado-integracao-design.md).
// A guarda vale nos dois casos: esta lista é a única fonte da verdade de
// quais campos podem ir pra lá — qualquer objeto que vá ser escrito no
// repositório passa por validarCamposPermitidos() antes. Isso é uma garantia
// estrutural (falha alto e cedo se algum campo fora do escopo da spec
// aparecer), não só "cuidado" ao escrever o código — pedido explícito do
// Harreson antes do primeiro push de dados reais.
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
      `${chavesExtras.join(", ")}. Bloqueado de propósito — este repositório é ` +
      `privado hoje, mas pode virar público, e a lista de campos vale nos dois casos.`
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
  // Infinity, não 1: quando o robô retoma de um cursor salvo (paginaInicial > 1,
  // o caso normal a partir da segunda execução), começar com totalPaginas = 1
  // fazia a condição do laço ser falsa logo na entrada — nenhuma requisição era
  // feita, a função devolvia lista vazia e o main() tratava o ano como completo.
  // A primeira resposta da API corrige o valor real logo abaixo.
  let totalPaginas = Infinity;
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
    await dormir(ATRASO_MS);
  }

  return { registros: novasPorRegistro, proximaPagina: pagina, totalPaginas, interrompidoPorTempo };
}

async function gravarAno(ano, novosRegistros) {
  const caminho = `licitacoes/${ano}.json`;
  const existente = await lerJsonLocal(caminho);
  const mapa = new Map();
  for (const r of (existente && existente.registros) || []) mapa.set(r.idCompra, r);
  for (const r of novosRegistros) if (r.idCompra) mapa.set(r.idCompra, r);
  const registros = Array.from(mapa.values());
  await escreverJsonLocal(caminho, { atualizadoEm: new Date().toISOString(), ano, registros });
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
    // uasg vem de dado externo (String(r.uasg) da API) e é interpolado num
    // caminho de arquivo — só valor numérico entra, pra um valor inesperado
    // não conseguir escapar do diretório uasgs/.
    if (!/^\d+$/.test(uasg)) {
      console.log(`[comprasnet-legado] UASG ignorada por formato inesperado: ${JSON.stringify(uasg)}`);
      continue;
    }
    const caminho = `uasgs/${uasg}.json`;
    const existente = await lerJsonLocal(caminho);
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
    await escreverJsonLocal(caminho, {
      atualizadoEm: new Date().toISOString(),
      codigoUasg: uasg,
      uf: infoUasg.uf || "",
      municipio: infoUasg.municipio || "",
      nomeUasg: infoUasg.nomeUasg || "",
      licitacoes: Array.from(mapa.values()),
    });
    arquivosAtualizados += 1;
  }
  return arquivosAtualizados;
}

async function main() {
  console.log(`Iniciando coleta ComprasNet Legado (Fase 1). Orçamento: ${LIMITE_MINUTOS} min.`);

  // Falha cedo (antes de gastar o orçamento coletando) se o diretório do
  // clone não estiver configurado/existente.
  const dir = dirDados();
  if (!fs.existsSync(dir)) {
    throw new Error(`DADOS_HISTORICOS_DIR aponta pra um diretório inexistente: ${dir}`);
  }
  console.log(`[comprasnet-legado] Gravando no clone local: ${dir}`);

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

  // try/finally: qualquer exceção não tratada na fase de coleta/escrita
  // (erro de rede na API do Compras.gov.br, erro de escrita em disco) precisa
  // deixar o cursor de progresso salvo do jeito que estava — senão o robô
  // perde o progresso do run inteiro ao ser interrompido no meio, e recomeça
  // do zero na próxima execução. O único jeito de ainda perder progresso é o
  // SIGKILL do timeout-minutes do workflow (que não roda o finally); contra
  // isso vale a margem entre o orçamento interno (12 min) e o teto do
  // workflow (20 min), mesma lógica de atualizar-dados.yml.
  try {
    while (anoAtual <= anoFinal && tempoRestanteMs() > 8000) {
      console.log(`[comprasnet-legado] Varrendo ano ${anoAtual}, a partir da página ${paginaAtual}...`);
      const { registros, proximaPagina, interrompidoPorTempo } = await coletarAno(anoAtual, paginaAtual, mapaUasg);

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
  } finally {
    await salvarBlob("dados_robo", "comprasnet_progresso", { anoAtual, paginaAtual, anosCompletos });
  }

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
