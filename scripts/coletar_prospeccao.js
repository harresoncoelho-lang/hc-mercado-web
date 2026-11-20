// Robô diário da Prospecção (Inteligência de Mercado): o que o órgão vai comprar ANTES do edital.
//   node scripts/coletar_prospeccao.js
// Grava a tabela enxuta prospeccao_itens (supabase/prospeccao.sql); a tela lê por /api/prospeccao.
//
// Por que robô e não consulta ao vivo: a busca do PNCP devolve ~3 KB por documento (4.094 atas vigentes só
// no AM = 9 páginas de 1,6 MB) e não filtra fim de vigência; o PCA é por órgão e unidade. Ler e filtrar isso
// numa requisição estoura os 10 ms de CPU e as 50 subrequisições do Cloudflare. Aqui é uma vez por dia.
//
// Fontes (todas grátis, sem login e sem captcha — ver _historico/pente-fino-pncp/02 e 03):
//   contrato  PNCP /api/search tipos_documento=contrato status=vigente ufs=UF; fica o que vence em até
//             DIAS_HORIZONTE dias (empenho fica fora: é compra pontual, não gera nova licitação). Inclui os
//             contratos do Contratos.gov.br, que o PNCP recebe com usuario_nome "Contratos.gov.br".
//   ata       PNCP /api/search tipos_documento=ata status=vigente permite_adesao=true ufs=UF; e, para as atas
//             do Compras.gov, os itens com fornecedor, quantidade, empenhado e máximo de adesão
//             (dadosabertos.compras.gov.br /modulo-arp/2_consultarARPItem, por unidade gerenciadora).
//   irp       PNCP /api/search tipos_documento=irp (nacional: o módulo é de 31/08/2026 e tem poucas IRPs) +
//             /api/pncp/v1/orgaos/{cnpj}/irp/{ano}/{seq}/itens. Só com prazo de manifestação a partir de hoje.
//   pca       por órgão visto nos contratos/atas da UF e só nas unidades da UF: federal pelo PGC do Compras.gov
//             (/modulo-pgc/1_consultarPgcDetalhe, traz o CATMAT e o DFD) e os demais pelo PCA do PNCP
//             (/api/pncp/v1/orgaos/{cnpj}/pca/{ano}/{seq}/itens). Ano atual e o próximo; só data a partir de hoje.
//
// Fonte que falhar no meio não apaga o que já estava gravado dela (a limpeza só roda para fonte completa).
// Rodar duas vezes no dia é seguro: upsert pela chave natural e limpeza por coletado_em.
//
// Variáveis (todas opcionais, menos a chave):
//   SUPABASE_SERVICE_ROLE_KEY  obrigatória para gravar (scripts/supabase_dados.js)
//   PROSPECCAO_UFS             "AM" (lista separada por vírgula)
//   DIAS_HORIZONTE             400 — quanto à frente guardar (contratos vencendo, PCA)
//   PAUSA_MS                   250 entre chamadas às fontes públicas
//   LIMITE_MINUTOS             10 — tamanho da rodada: passou disso, para na próxima unidade e a rodada seguinte retoma
//   TAMANHO_LOTE_BANCO         500
//   ADESOES_POR_RODADA         1500 — teto de consultas a 5_consultarAdesoesItem por rodada (uma por item de ata)
//   ADESOES_VALIDADE_DIAS      3 — adesão consultada há menos que isso não é consultada de novo
//   ITENS_ATA_PNCP_MAX         30 — itens lidos por ata fora do Compras.gov
//   PROSPECCAO_REINICIAR       1 — ignora o progresso do dia e recomeça
//
// Rodadas: o trabalho é dividido em etapas (irp, UF:contrato, UF:ata, UF:pca) e, dentro delas, em unidades (UASG,
// ata, órgão/ano). O progresso do dia fica em dados_robo (chave prospeccao_estado); cada rodada grava as unidades
// que fecha e a seguinte pula o que já foi feito. A limpeza do que não voltou só roda quando a etapa fecha.
const { restFetch, upsertEmLotes, buscarBlob, salvarBlob } = require("./supabase_dados");
const { semCpf } = require("../netlify/functions/_cpf");

const PNCP = "https://pncp.gov.br";
const CG = "https://dadosabertos.compras.gov.br";
// Sem User-Agent de navegador a busca do PNCP reseta a conexão (WAF; ver netlify/functions/pncp-proxy.js).
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const TABELA = "prospeccao_itens";

const num = (v, padrao) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : padrao);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
// A fonte às vezes devolve UTF-8 lido como Windows-1252 ("SAÃšDE", "FUNDAÃ‡ÃƒO"). Cada sequência líder+continuação
// que decodifica como UTF-8 válido volta ao caractere certo; texto já correto ("AÇÃO") não casa e passa intacto.
const CP1252 = { 0x20ac: 0x80, 0x201a: 0x82, 0x192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x2c6: 0x88, 0x2030: 0x89, 0x160: 0x8a, 0x2039: 0x8b, 0x152: 0x8c, 0x17d: 0x8e,
  0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2dc: 0x98, 0x2122: 0x99, 0x161: 0x9a, 0x203a: 0x9b, 0x153: 0x9c, 0x17e: 0x9e, 0x178: 0x9f };
const CONT = "[\u0080-\u00BF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2013\u2014\u2018-\u201E\u2020-\u2022\u2026\u2030\u2039\u203A\u20AC\u2122]";
const MOJIBAKE = new RegExp(`[\u00C2-\u00DF]${CONT}|[\u00E0-\u00EF]${CONT}{2}|[\u00F0-\u00F4]${CONT}{3}`, "g");
function desfazerMojibake(v) {
  return String(v ?? "").replace(MOJIBAKE, (m) => {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from([...m].map((c) => CP1252[c.charCodeAt(0)] ?? c.charCodeAt(0)))); } catch { return m; }
  });
}
const txt = (v, max = 600) => {
  const s = desfazerMojibake(v).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};
const numero = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const dia = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || "")) ? String(v).slice(0, 10) : null);
const cnpjOuNulo = (v) => (/^\d{14}$/.test(String(v || "").replace(/\D/g, "")) ? String(v).replace(/\D/g, "") : null);
const catmat = (v) => (/^\d{1,12}$/.test(String(v ?? "").trim()) ? String(v).trim() : null);
// Texto de busca: minúsculo e sem acento, para o ILIKE da function casar "cafe" com "CAFÉ". O nome do fornecedor
// fica fora: "papel" casava "X PAPELARIA LTDA" em ata de cadeira (visto no E2E de 19/11/2026).
const normalizar = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const busca = (...partes) => normalizar(semCpf(desfazerMojibake(partes.filter(Boolean).join(" ")), " ")).slice(0, 2000);
// Nome para a busca por texto: começo (90 caracteres) da descrição do item + começo do objeto da compra/demanda. A tela mostra
// primeiro quem casa aqui e recolhe quem só cita o termo mais adiante, na especificação ("papel a4" dentro da ficha da impressora).
const nomeBusca = (descricao, objeto) => [descricao, objeto].map((t) => normalizar(semCpf(desfazerMojibake(t || ""), " ")).slice(0, 90)).filter(Boolean).join(" ");
// Razão social de MEI traz o CPF do titular ("FULANA DE TAL 97048143215"): o CPF sai, o resto é público.
const nomeFornecedor = (v) => txt(semCpf(v, " "), 300);
// Objeto/descrição também: contrato com pessoa física vem com o CPF no objeto ("016.471.242-98", visto no E2E de 19/11/2026).
const livre = (v, max) => txt(semCpf(v), max);

// AAAA-MM-DD de Brasília (UTC-3 fixo), deslocado em dias.
function hojeBrasilia(agora = Date.now(), deslocamento = 0) {
  return new Date(agora - 3 * 36e5 + deslocamento * 864e5).toISOString().slice(0, 10);
}
const dentro = (d, de, ate) => Boolean(d) && d >= de && d <= ate;

// ---------- normalizadores (puros; testados em coletar_prospeccao.test.js) ----------

function linhaContrato(doc, coletadoEm) {
  return {
    id: `contrato:${doc.numero_controle_pncp}`, tipo: "contrato", fonte: "pncp", plataforma: txt(doc.usuario_nome, 120),
    uf: doc.uf, orgao_cnpj: cnpjOuNulo(doc.orgao_cnpj), orgao_nome: txt(doc.orgao_nome, 300),
    unidade_codigo: txt(doc.unidade_codigo, 30), unidade_nome: txt(doc.unidade_nome, 300), municipio: txt(doc.municipio_nome, 120),
    objeto: livre(doc.description, 1000), descricao: null, catmat: null,
    quantidade: null, valor_unitario: null, valor_total: numero(doc.valor_global),
    data_inicio: dia(doc.data_inicio_vigencia), data_ref: dia(doc.data_fim_vigencia),
    // LGPD: fornecedor pessoa física (CPF) não é gravado.
    fornecedor_cnpj: cnpjOuNulo(doc.fornecedor_ni), fornecedor_nome: cnpjOuNulo(doc.fornecedor_ni) ? nomeFornecedor(doc.fornecedor_nome) : null,
    saldo: null, maximo_adesao: null, permite_adesao: null,
    link: `${PNCP}/app${doc.item_url}`, busca: busca(doc.description, doc.orgao_nome), busca_nome: nomeBusca(null, doc.description), coletado_em: coletadoEm,
  };
}

// Contrato que importa: termo inicial/carta-contrato vigente que acaba dentro do horizonte. Empenho não.
function contratoInteressa(doc, hoje, ate) {
  return /^\d{14}-2-\d+\/\d{4}$/.test(String(doc.numero_controle_pncp || "")) && /^\/contratos\//.test(String(doc.item_url || ""))
    && !/empenho/i.test(String(doc.tipo_contrato_nome || "")) && !doc.cancelado && dentro(dia(doc.data_fim_vigencia), hoje, ate);
}

function linhaAta(doc, coletadoEm) {
  return {
    id: `ata:${doc.numero_controle_pncp}`, tipo: "ata", fonte: "pncp", plataforma: txt(doc.usuario_nome, 120),
    uf: doc.uf, orgao_cnpj: cnpjOuNulo(doc.orgao_cnpj), orgao_nome: txt(doc.orgao_nome, 300),
    unidade_codigo: txt(doc.unidade_codigo, 30), unidade_nome: txt(doc.unidade_nome, 300), municipio: txt(doc.municipio_nome, 120),
    objeto: livre(doc.description, 1000), descricao: null, catmat: null,
    quantidade: null, valor_unitario: null, valor_total: numero(doc.valor_global),
    data_inicio: dia(doc.data_inicio_vigencia), data_ref: dia(doc.data_fim_vigencia),
    fornecedor_cnpj: null, fornecedor_nome: null, saldo: null, maximo_adesao: null, permite_adesao: doc.permite_adesao === true,
    link: `${PNCP}/app${doc.item_url}`, busca: busca(doc.description, doc.orgao_nome), busca_nome: nomeBusca(null, doc.description), coletado_em: coletadoEm,
  };
}

// Item de ata do Compras.gov: herda órgão/UF/objeto da ata do PNCP. Saldo = homologado ao fornecedor - empenhado.
function linhaItemAta(item, ata, coletadoEm) {
  const qtd = numero(item.quantidadeHomologadaVencedor ?? item.quantidadeHomologadaItem);
  const empenhada = numero(item.quantidadeEmpenhada) || 0;
  const forn = cnpjOuNulo(item.niFornecedor);
  return {
    ...ata, id: `ata:${item.numeroControlePncpAta}#${item.numeroItem}#${forn || item.classificacaoFornecedor || ""}`, fonte: "comprasgov_arp",
    descricao: livre(item.descricaoItem, 600), catmat: catmat(item.codigoItem),
    quantidade: qtd, valor_unitario: numero(item.valorUnitario), valor_total: numero(item.valorTotal),
    data_inicio: dia(item.dataVigenciaInicial) || ata.data_inicio, data_ref: dia(item.dataVigenciaFinal) || ata.data_ref,
    fornecedor_cnpj: forn, fornecedor_nome: forn ? nomeFornecedor(item.nomeRazaoSocialFornecedor) : null,
    saldo: qtd === null ? null : Math.max(0, qtd - empenhada), maximo_adesao: numero(item.maximoAdesao),
    ata_numero: txt(item.numeroAtaRegistroPreco, 40),
    busca: busca(ata.objeto, item.descricaoItem, ata.orgao_nome), busca_nome: nomeBusca(item.descricaoItem, ata.objeto), coletado_em: coletadoEm,
  };
}

// Item de ata fora do Compras.gov: item da contratação de origem (PNCP) + resultado (fornecedor e valor homologado).
// O PNCP não divulga saldo nem limite de adesão: esses campos ficam nulos e a tela diz isso.
function linhaItemAtaPncp(item, res, ata, coletadoEm) {
  const forn = cnpjOuNulo(res.niFornecedor);
  return {
    ...ata, id: `${ata.id}#${item.numeroItem}#${forn || res.sequencialResultado || ""}`,
    descricao: livre(item.descricao, 600), catmat: catmat(item.catalogoCodigoItem),
    quantidade: numero(res.quantidadeHomologada ?? item.quantidade), valor_unitario: numero(res.valorUnitarioHomologado), valor_total: numero(res.valorTotalHomologado),
    fornecedor_cnpj: forn, fornecedor_nome: forn ? nomeFornecedor(res.nomeRazaoSocialFornecedor) : null,
    busca: busca(ata.objeto, item.descricao, ata.orgao_nome), busca_nome: nomeBusca(item.descricao, ata.objeto), coletado_em: coletadoEm,
  };
}

// Soma do que já foi aprovado de adesão ao item (5_consultarAdesoesItem devolve uma linha por órgão não participante).
const somarAdesoes = (linhas) => (linhas || []).reduce((t, a) => t + (numero(a.quantidadeAprovadaAdesao) || 0), 0);

function linhaIrp(doc, item, coletadoEm) {
  const [, cnpj, ano, seq] = String(doc.item_url || "").split("/").slice(1);
  return {
    id: `irp:${doc.numero_controle_pncp}#${item.numeroItem}`, tipo: "irp", fonte: "pncp", plataforma: txt(doc.usuario_nome, 120),
    uf: doc.uf, orgao_cnpj: cnpjOuNulo(doc.orgao_cnpj), orgao_nome: txt(doc.orgao_nome, 300),
    unidade_codigo: txt(doc.unidade_codigo, 30), unidade_nome: txt(doc.unidade_nome, 300), municipio: txt(doc.municipio_nome, 120),
    objeto: livre(doc.description, 1000), descricao: livre(item.descricao, 600), catmat: catmat(item.catalogoCodigoItem),
    quantidade: numero(item.quantidade), valor_unitario: numero(item.valorUnitarioEstimado), valor_total: numero(item.valorTotal),
    data_inicio: dia(doc.data_publicacao_pncp), data_ref: dia(doc.prazo_manifestacao_interesse || doc.data_fim_vigencia),
    fornecedor_cnpj: null, fornecedor_nome: null, saldo: null, maximo_adesao: null, permite_adesao: doc.permite_adesao ?? null,
    link: `${PNCP}/app/irps/${cnpj}/${ano}/${seq}`, busca: busca(doc.description, item.descricao, doc.orgao_nome), busca_nome: nomeBusca(item.descricao, doc.description), coletado_em: coletadoEm,
  };
}

function linhaPcaPncp(item, org, uf, coletadoEm) {
  return {
    id: `pca:${item.cnpj}-${item.anoPca}-${item.sequencialPca}#${item.numeroItem}`, tipo: "pca", fonte: "pncp", plataforma: null,
    uf, orgao_cnpj: cnpjOuNulo(item.cnpj), orgao_nome: txt(org.nome, 300),
    unidade_codigo: txt(item.codigoUnidade, 30), unidade_nome: txt(item.nomeUnidade, 300), municipio: null,
    objeto: livre(item.grupoContratacaoNome, 1000), descricao: livre(item.descricao || item.pdmDescricao || item.classificacaoSuperiorNome, 600),
    catmat: catmat(item.codigoItem), quantidade: numero(item.quantidade), valor_unitario: numero(item.valorUnitario), valor_total: numero(item.valorTotal),
    data_inicio: null, data_ref: dia(item.dataDesejada),
    fornecedor_cnpj: null, fornecedor_nome: null, saldo: null, maximo_adesao: null, permite_adesao: null,
    link: `${PNCP}/app/pca/${item.cnpj}/${item.anoPca}`,
    busca: busca(item.grupoContratacaoNome, item.descricao, item.classificacaoSuperiorNome, org.nome),
    busca_nome: nomeBusca(item.descricao || item.pdmDescricao || item.classificacaoSuperiorNome, item.grupoContratacaoNome), coletado_em: coletadoEm,
  };
}

// PGC (Compras.gov): a mesma demanda federal antes de virar PCA consolidado, com CATMAT e DFD.
function linhaPgc(item, org, uf, coletadoEm) {
  const chave = [item.codigoUasg, item.anoPcaProjetoCompra, item.numeroArtefato, item.ordemDfd, item.codigoItemCatalogo || item.numeroItemPncp].join("-");
  return {
    id: `pca:pgc:${chave}`, tipo: "pca", fonte: "pgc", plataforma: "Compras.gov.br (PGC)",
    uf, orgao_cnpj: cnpjOuNulo(item.orgao), orgao_nome: txt(org.nome, 300),
    unidade_codigo: txt(item.codigoUasg, 30), unidade_nome: txt(item.nomeUasg, 300), municipio: null,
    objeto: livre(item.descricaoObjetoDfd || item.tituloProjetoCompra, 1000),
    descricao: livre(item.descricaoItemCatalogo || item.nomePdmMaterial || item.nomeClasseServico, 600),
    catmat: catmat(item.codigoItemCatalogo), quantidade: numero(item.quantidadeItem), valor_unitario: numero(item.valorUnitarioItem), valor_total: numero(item.valorTotalItem),
    data_inicio: dia(item.dataInicioProcessoCompra), data_ref: dia(item.dataPrevistaFormalizacaoDemanda),
    fornecedor_cnpj: null, fornecedor_nome: null, saldo: null, maximo_adesao: null, permite_adesao: null,
    link: `${PNCP}/app/pca/${item.orgao}/${item.anoPcaProjetoCompra}`,
    busca: busca(item.descricaoObjetoDfd, item.tituloProjetoCompra, item.descricaoItemCatalogo, org.nome),
    busca_nome: nomeBusca(item.descricaoItemCatalogo || item.nomePdmMaterial || item.nomeClasseServico, item.descricaoObjetoDfd || item.tituloProjetoCompra), coletado_em: coletadoEm,
  };
}

// ---------- rede ----------

async function obter(url, { fetch = globalThis.fetch, tentativas = 3, pausaMs = num(process.env.PAUSA_MS, 250) } = {}) {
  for (let t = 1; ; t++) {
    await esperar(pausaMs);
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: globalThis.AbortSignal.timeout(60000) });
      if (r.status === 204 || r.status === 404) return null;
      if (r.ok) return await r.json();
      if (r.status < 500 && r.status !== 429) throw Object.assign(new Error(`HTTP ${r.status}`), { definitivo: true });
      throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      if (e.definitivo || t >= tentativas) throw new Error(`${url.split("?")[0]}: ${e.message}`);
      await esperar(2000 * t);
    }
  }
}

// Todas as páginas da busca do PNCP (500 por página; teto de 40 páginas = 20 mil documentos por consulta).
async function buscarPncp(parametros, op) {
  const itens = [];
  for (let pagina = 1; pagina <= 40; pagina++) {
    const q = new URLSearchParams({ ...parametros, ordenacao: "-data", pagina: String(pagina), tam_pagina: "500" });
    const j = await obter(`${PNCP}/api/search?${q}`, op);
    const lote = j?.items || [];
    itens.push(...lote);
    if (lote.length < 500 || itens.length >= Number(j?.total || 0)) break;
  }
  return itens;
}

// Páginas do Compras.gov dados abertos ({resultado, paginasRestantes}).
async function paginasCompras(caminho, parametros, op, maxPaginas = 40) {
  const todos = [];
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const j = await obter(`${CG}${caminho}?${new URLSearchParams({ ...parametros, pagina: String(pagina), tamanhoPagina: "500" })}`, op);
    todos.push(...(j?.resultado || []));
    if (!j || !(j.paginasRestantes > 0)) break;
  }
  return todos;
}


// ---------- progresso do dia (rodadas) ----------

const CHAVE_ESTADO = "prospeccao_estado";
const venceu = (ctx) => Date.now() > ctx.prazoFinal;

// Progresso gravado em dados_robo: o dia, o instante de corte da limpeza (igual em todas as rodadas do dia), as unidades
// já feitas e o que as etapas seguintes precisam saber das anteriores (órgãos por UF, atas que o Compras.gov cobriu).
async function carregarEstado(hoje, inicio, ler = (chave) => buscarBlob("dados_robo", chave)) {
  const salvo = process.env.PROSPECCAO_REINICIAR ? null : await ler(CHAVE_ESTADO).catch(() => null);
  const base = salvo && salvo.dia === hoje ? salvo : { dia: hoje, coletadoEm: new Date(inicio).toISOString(), feitos: [], orgaos: {}, comItens: {} };
  return { ...base, feitos: new Set(base.feitos), orgaos: base.orgaos || {}, comItens: base.comItens || {} };
}
const estadoSerializavel = (est) => ({ ...est, feitos: [...est.feitos] });

// Roda fn(chave) nas unidades que ainda faltam, até o prazo da rodada. true = todas feitas. Cada unidade fechada
// é gravada no progresso na hora: se a rodada morrer, a próxima recomeça dali.
async function unidades(chaves, est, ctx, fn) {
  for (const k of chaves) {
    if (est.feitos.has(k)) continue;
    if (venceu(ctx)) return false;
    await fn(k);
    est.feitos.add(k);
    await ctx.salvar(est);
  }
  return true;
}

// ---------- coleta por fonte ----------

function anotarOrgao(mapa, d) {
  const cnpj = cnpjOuNulo(d.orgao_cnpj);
  if (!cnpj) return;
  const o = mapa[cnpj] || { nome: d.orgao_nome, esfera: d.esfera_id, unidades: [] };
  if (d.unidade_codigo && !o.unidades.includes(String(d.unidade_codigo))) o.unidades.push(String(d.unidade_codigo));
  mapa[cnpj] = o;
}

async function etapaContrato(uf, est, ctx) {
  const contratos = await buscarPncp({ tipos_documento: "contrato", status: "vigente", ufs: uf }, ctx.op);
  const mapa = (est.orgaos[uf] = est.orgaos[uf] || {});
  contratos.forEach((d) => anotarOrgao(mapa, d));
  const linhas = contratos.filter((d) => d.uf === uf && contratoInteressa(d, ctx.hoje, ctx.ate)).map((d) => linhaContrato(d, ctx.coletadoEm));
  console.log(`${uf} contratos: ${contratos.length} vigentes, ${linhas.length} vencem até ${ctx.ate}`);
  await gravar(linhas, `tipo=eq.contrato&uf=eq.${uf}`, ctx, `${uf} contrato`);
  return true;
}

// Itens de uma ata que não está no Compras.gov: itens da contratação de origem + resultado de cada um (fornecedor e valor).
// Ata por fornecedor (doc.fornecedor_ni preenchido) só fica com o resultado dele. memo: a mesma contratação serve várias atas.
async function itensAtaPncp(doc, ata, ctx, memo = new Map()) {
  const [, , cnpj, ano, seq] = String(doc.item_url || "").split("/");
  if (!/^\d{14}$/.test(cnpj || "") || !/^\d{4}$/.test(ano || "") || !/^\d+$/.test(seq || "")) return [];
  const base = `${PNCP}/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${seq}`;
  let pares = memo.get(base);
  if (!pares) {
    const max = num(process.env.ITENS_ATA_PNCP_MAX, 30);
    const itens = ((await obter(`${base}/itens?pagina=1&tamanhoPagina=${Math.min(max, 500)}`, ctx.op)) || []).filter((i) => i.temResultado !== false).slice(0, max);
    pares = [];
    // Resultados de 3 em 3 itens: uma ata de 60 itens leva 20 voltas em vez de 60 (cada chamada ainda respeita PAUSA_MS).
    for (let i = 0; i < itens.length; i += 3) {
      const lote = itens.slice(i, i + 3);
      const resultados = await Promise.all(lote.map((item) => obter(`${base}/itens/${item.numeroItem}/resultados`, ctx.op).catch(() => null)));
      lote.forEach((item, j) => (resultados[j] || []).forEach((res) => pares.push([item, res])));
    }
    memo.set(base, pares);
  }
  const so = cnpjOuNulo(doc.fornecedor_ni);
  return pares.filter(([, r]) => !r.dataCancelamento && (!so || cnpjOuNulo(r.niFornecedor) === so)).map(([i, r]) => linhaItemAtaPncp(i, r, ata, ctx.coletadoEm));
}

async function etapaAta(uf, est, ctx) {
  const atas = (await buscarPncp({ tipos_documento: "ata", status: "vigente", ufs: uf, permite_adesao: "true" }, ctx.op))
    .filter((d) => d.uf === uf && !d.cancelado && dia(d.data_fim_vigencia) >= ctx.hoje);
  const mapa = (est.orgaos[uf] = est.orgaos[uf] || {});
  atas.forEach((d) => anotarOrgao(mapa, d));
  const porAta = new Map(atas.map((d) => [d.numero_controle_pncp, linhaAta(d, ctx.coletadoEm)]));
  const comItens = new Set(est.comItens[uf] || []);
  // Compras.gov: itens com fornecedor, quantidade, empenhado e máximo de adesão, por UASG gerenciadora (código numérico de até 6 dígitos).
  const gerenciadoras = [...new Set(atas.map((d) => String(d.unidade_codigo || "")).filter((c) => /^\d{5,6}$/.test(c)))];
  let ok = await unidades(gerenciadoras.map((u) => `ata:${uf}:cg:${u}`), est, ctx, async (k) => {
    const itens = await paginasCompras("/modulo-arp/2_consultarARPItem", {
      codigoUnidadeGerenciadora: k.split(":")[3], dataVigenciaInicialMin: hojeBrasilia(Date.now(), -730), dataVigenciaInicialMax: ctx.hoje,
    }, ctx.op);
    const linhas = [];
    for (const it of itens) {
      const ata = porAta.get(it.numeroControlePncpAta);
      if (!ata || it.itemExcluido || dia(it.dataVigenciaFinal) < ctx.hoje) continue;
      comItens.add(it.numeroControlePncpAta);
      linhas.push(linhaItemAta(it, ata, ctx.coletadoEm));
    }
    est.comItens[uf] = [...comItens];
    await gravar(linhas, null, ctx, `${uf} ata (Compras.gov)`);
  });
  if (!ok) return false;
  // Resto (fora do Compras.gov, ou UASG sem item vigente): itens e resultados pelo PNCP; sem item, fica a linha da ata.
  const memo = new Map();
  const resto = new Map(atas.filter((d) => !comItens.has(d.numero_controle_pncp)).map((d) => [`ata:${uf}:pncp:${d.numero_controle_pncp}`, d]));
  ok = await unidades([...resto.keys()], est, ctx, async (k) => {
    const d = resto.get(k);
    const ata = porAta.get(d.numero_controle_pncp);
    const itens = await itensAtaPncp(d, ata, ctx, memo);
    await gravar(itens.length ? itens : [ata], null, ctx, `${uf} ata (PNCP${itens.length ? " com itens" : " sem item"})`);
  });
  if (ok) {
    console.log(`${uf} atas com adesão: ${atas.length} (${comItens.size} com itens do Compras.gov, ${gerenciadoras.length} UASGs, ${resto.size} pelo PNCP)`);
    await limpar(`tipo=eq.ata&uf=eq.${uf}`, ctx);
  }
  return ok;
}

async function coletarIrps(ctx) {
  const { hoje, coletadoEm, op } = ctx;
  const docs = (await buscarPncp({ tipos_documento: "irp", status: "todos" }, op))
    .filter((d) => dia(d.prazo_manifestacao_interesse || d.data_fim_vigencia) >= hoje && !d.cancelado);
  const linhas = [];
  for (const d of docs) {
    for (let pagina = 1; pagina <= 20; pagina++) {
      const itens = (await obter(`${PNCP}/api/pncp/v1/orgaos/${d.orgao_cnpj}/irp/${d.ano}/${d.numero_sequencial}/itens?pagina=${pagina}&tamanhoPagina=50`, op)) || [];
      linhas.push(...itens.map((i) => linhaIrp(d, i, coletadoEm)));
      if (itens.length < 50) break;
    }
  }
  console.log(`IRPs abertas (Brasil): ${docs.length}, itens ${linhas.length}`);
  return linhas;
}

// PCA/PGC por órgão e ano (a unidade da rodada). Só as unidades do órgão que estão na UF; só data a partir de hoje.
async function coletarPcaOrgao(uf, cnpj, org, a, ctx) {
  const { op, coletadoEm } = ctx;
  const linhas = [];
  const unidadesPca = (await obter(`${PNCP}/api/pncp/v1/orgaos/${cnpj}/pca/${a}/consolidado/unidades`, op).catch(() => null)) || [];
  for (const u of unidadesPca.filter((x) => org.unidades.includes(String(x.codigoUnidade)))) {
    if (org.esfera === "F") {
      const itens = await paginasCompras("/modulo-pgc/1_consultarPgcDetalhe", { orgao: cnpj, anoPcaProjetoCompra: String(a), codigoUasg: String(u.codigoUnidade) }, op);
      linhas.push(...itens.map((i) => linhaPgc(i, org, uf, coletadoEm)));
      if (itens.length) continue; // PGC vazio: cai no PCA consolidado do PNCP
    }
    for (let pagina = 1; pagina <= 40; pagina++) {
      const itens = (await obter(`${PNCP}/api/pncp/v1/orgaos/${cnpj}/pca/${a}/${u.sequencialPca}/itens?pagina=${pagina}&tamanhoPagina=500`, op)) || [];
      linhas.push(...itens.map((i) => linhaPcaPncp(i, org, uf, coletadoEm)));
      if (itens.length < 500) break;
    }
  }
  return linhas.filter((l) => dentro(l.data_ref, ctx.hoje, ctx.ate));
}

async function etapaPca(uf, est, ctx, orgaosCompletos) {
  const orgaos = est.orgaos[uf] || {};
  const ano = Number(ctx.hoje.slice(0, 4));
  const chaves = Object.keys(orgaos).flatMap((cnpj) => [ano, ano + 1].map((a) => `pca:${uf}:${cnpj}:${a}`));
  const ok = await unidades(chaves, est, ctx, async (k) => {
    const [, , cnpj, a] = k.split(":");
    await gravar(await coletarPcaOrgao(uf, cnpj, orgaos[cnpj], Number(a), ctx), null, ctx, `${uf} pca`);
  });
  // Sem a lista completa de órgãos (contratos/atas ainda não fecharam) não limpa: grava o que veio.
  if (ok && orgaosCompletos && chaves.length) await limpar(`tipo=eq.pca&uf=eq.${uf}`, ctx);
  return ok && orgaosCompletos;
}

// Adesões já usadas: 5_consultarAdesoesItem, uma consulta por item (ata + UASG + item). Só item de ata vigente do Compras.gov
// com limite de adesão, da UF, e no máximo ADESOES_POR_RODADA por rodada: os nunca consultados primeiro, depois os mais velhos.
async function consultarAdesoes(l, op) {
  const numeroItem = String(l.id).split("#")[1];
  let total = 0;
  for (let pagina = 1; pagina <= 5; pagina++) {
    const j = await obter(`${CG}/modulo-arp/5_consultarAdesoesItem?${new URLSearchParams({
      numeroAta: l.ata_numero, unidadeGerenciadora: l.unidade_codigo, numeroItem, pagina: String(pagina), tamanhoPagina: "100",
    })}`, op);
    total += somarAdesoes(j?.resultado);
    if (!j || !(j.paginasRestantes > 0)) break;
  }
  return total;
}

async function etapaAdesoes(uf, ctx) {
  const teto = num(process.env.ADESOES_POR_RODADA, 1500);
  const corte = new Date(Date.parse(ctx.coletadoEm) - num(process.env.ADESOES_VALIDADE_DIAS, 3) * 864e5).toISOString();
  const rotulo = `${uf} adesões consultadas`;
  let feitas = 0;
  while (feitas < teto && !venceu(ctx)) {
    const pendentes = await (await restFetch(`${TABELA}?${new URLSearchParams({
      select: "*", tipo: "eq.ata", uf: `eq.${uf}`, fonte: "eq.comprasgov_arp", maximo_adesao: "gt.0", ata_numero: "not.is.null", data_ref: `gte.${ctx.hoje}`,
      or: `(adesoes_em.is.null,adesoes_em.lt.${corte})`, order: "adesoes_em.asc.nullsfirst,id.asc", limit: String(Math.min(50, teto - feitas)),
    })}`)).json();
    if (!pendentes.length) return true;
    const feitos = [];
    // 2 consultas por vez. 429 (limite do portal) encerra a etapa nesta rodada: o item não é marcado e volta na próxima.
    let limitado = false;
    for (let i = 0; i < pendentes.length && !venceu(ctx) && !limitado; i += 2) {
      await Promise.all(pendentes.slice(i, i + 2).map(async (l) => {
        try { l.adesoes_usadas = await consultarAdesoes(l, ctx.op); } catch (e) {
          if (/HTTP 429/.test(e.message)) { limitado = true; return; }
          // Outra falha em um item não trava a fila: fica marcado como consultado (adesoes_usadas nulo = "não consultada") e volta depois da validade.
          console.warn(`${uf} adesões ${l.id}: ${e.message}`);
        }
        l.adesoes_em = new Date().toISOString();
        feitos.push(l);
      }));
    }
    await upsertEmLotes(TABELA, feitos, "id", num(process.env.TAMANHO_LOTE_BANCO, 500));
    feitas += feitos.length;
    ctx.gravadas[rotulo] = (ctx.gravadas[rotulo] || 0) + feitos.length;
    if (limitado) { console.warn(`${uf} adesões: portal respondeu 429, retoma na próxima rodada`); return false; }
  }
  return false;
}

// Mesma chave pode vir duas vezes (item repetido no DFD, ata em duas páginas): a última vence.
const semRepetir = (linhas) => [...new Map(linhas.map((l) => [l.id, l])).values()];

async function gravar(linhas, filtroLimpeza, ctx, rotulo) {
  const unicas = semRepetir(linhas);
  await upsertEmLotes(TABELA, unicas, "id", num(process.env.TAMANHO_LOTE_BANCO, 500));
  if (rotulo) ctx.gravadas[rotulo] = (ctx.gravadas[rotulo] || 0) + unicas.length;
  if (filtroLimpeza) await limpar(filtroLimpeza, ctx);
  return unicas.length;
}
const limpar = (filtro, ctx) => restFetch(`${TABELA}?${filtro}&coletado_em=lt.${encodeURIComponent(ctx.coletadoEm)}`, { method: "DELETE" });

async function main() {
  const inicio = Date.now();
  const hoje = hojeBrasilia(inicio);
  const est = await carregarEstado(hoje, inicio);
  const ctx = {
    hoje, ate: hojeBrasilia(inicio, num(process.env.DIAS_HORIZONTE, 400)), coletadoEm: est.coletadoEm, op: {}, gravadas: {},
    prazoFinal: inicio + num(process.env.LIMITE_MINUTOS, 10) * 60000, salvar: (e) => salvarBlob("dados_robo", CHAVE_ESTADO, estadoSerializavel(e)),
  };
  const ufs = String(process.env.PROSPECCAO_UFS || "AM").split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s));
  const pendentes = [];
  let falhas = 0;

  // fn devolve true quando a etapa fechou; etapa que falha ou não cabe na rodada volta na próxima.
  async function etapa(chave, fn) {
    if (est.feitos.has(chave)) return true;
    if (venceu(ctx)) { pendentes.push(chave); return false; }
    try {
      const ok = await fn();
      if (ok) est.feitos.add(chave); else pendentes.push(chave);
      await ctx.salvar(est);
      return ok;
    } catch (e) {
      falhas++; pendentes.push(chave);
      console.error(`${chave} falhou (mantido o da véspera; retoma na próxima rodada):`, e.message);
      return false;
    }
  }

  await etapa("irp", async () => { await gravar(await coletarIrps(ctx), "tipo=eq.irp", ctx, "irp"); return true; });
  for (const uf of ufs) {
    const contrato = await etapa(`${uf}:contrato`, () => etapaContrato(uf, est, ctx));
    const ata = await etapa(`${uf}:ata`, () => etapaAta(uf, est, ctx));
    await etapa(`${uf}:pca`, () => etapaPca(uf, est, ctx, contrato && ata));
  }
  for (const uf of ufs) {
    if (!est.feitos.has(`${uf}:ata`)) continue;
    try { if (!(await etapaAdesoes(uf, ctx))) pendentes.push(`${uf}:adesoes`); } catch (e) { falhas++; console.error(`${uf} adesões falhou:`, e.message); }
  }
  // O que já passou da data (prazo de IRP, fim de vigência, data desejada) sai da tabela.
  await restFetch(`${TABELA}?data_ref=lt.${hoje}`, { method: "DELETE" });
  const resumo = Object.entries(ctx.gravadas).map(([k, v]) => `${k}=${v}`).join("; ");
  console.log(`Prospecção ${hoje}, rodada de ${Math.round((Date.now() - inicio) / 1000)} s: ${resumo || "nada novo gravado"}. ${pendentes.length ? `Falta: ${pendentes.join(", ")} (a próxima rodada retoma).` : "Dia completo."}`);
  if (falhas) process.exitCode = 1;
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = {
  hojeBrasilia, normalizar, desfazerMojibake, nomeBusca, contratoInteressa, linhaContrato, linhaAta, linhaItemAta, linhaItemAtaPncp, somarAdesoes, linhaIrp, linhaPcaPncp, linhaPgc,
  semRepetir, obter, unidades, carregarEstado, estadoSerializavel, itensAtaPncp, consultarAdesoes,
};
