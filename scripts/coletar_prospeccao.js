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
//   LIMITE_MINUTOS             50 — passou disso, o PCA para e não limpa (fica o da véspera)
//   TAMANHO_LOTE_BANCO         500
const { restFetch, upsertEmLotes } = require("./supabase_dados");
const { semCpf } = require("../netlify/functions/_cpf");

const PNCP = "https://pncp.gov.br";
const CG = "https://dadosabertos.compras.gov.br";
// Sem User-Agent de navegador a busca do PNCP reseta a conexão (WAF; ver netlify/functions/pncp-proxy.js).
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const TABELA = "prospeccao_itens";

const num = (v, padrao) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : padrao);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const txt = (v, max = 600) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};
const numero = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const dia = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || "")) ? String(v).slice(0, 10) : null);
const cnpjOuNulo = (v) => (/^\d{14}$/.test(String(v || "").replace(/\D/g, "")) ? String(v).replace(/\D/g, "") : null);
const catmat = (v) => (/^\d{1,12}$/.test(String(v ?? "").trim()) ? String(v).trim() : null);
// Texto de busca: minúsculo e sem acento, para o ILIKE da function casar "cafe" com "CAFÉ". O nome do fornecedor
// fica fora: "papel" casava "X PAPELARIA LTDA" em ata de cadeira (visto no E2E de 19/11/2026).
const normalizar = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const busca = (...partes) => normalizar(semCpf(partes.filter(Boolean).join(" "), " ")).slice(0, 2000);
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
    link: `${PNCP}/app${doc.item_url}`, busca: busca(doc.description, doc.orgao_nome), coletado_em: coletadoEm,
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
    link: `${PNCP}/app${doc.item_url}`, busca: busca(doc.description, doc.orgao_nome), coletado_em: coletadoEm,
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
    busca: busca(ata.objeto, item.descricaoItem, ata.orgao_nome), coletado_em: coletadoEm,
  };
}

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
    link: `${PNCP}/app/irps/${cnpj}/${ano}/${seq}`, busca: busca(doc.description, item.descricao, doc.orgao_nome), coletado_em: coletadoEm,
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
    busca: busca(item.grupoContratacaoNome, item.descricao, item.classificacaoSuperiorNome, org.nome), coletado_em: coletadoEm,
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
    busca: busca(item.descricaoObjetoDfd, item.tituloProjetoCompra, item.descricaoItemCatalogo, org.nome), coletado_em: coletadoEm,
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

// ---------- coleta por fonte ----------

async function coletarUf(uf, ctx) {
  const { hoje, ate, coletadoEm, op } = ctx;
  const orgaos = new Map(); // cnpj -> { nome, esfera, unidades:Set }
  const anotar = (d) => {
    const cnpj = cnpjOuNulo(d.orgao_cnpj);
    if (!cnpj) return;
    const o = orgaos.get(cnpj) || { nome: d.orgao_nome, esfera: d.esfera_id, unidades: new Set() };
    if (d.unidade_codigo) o.unidades.add(String(d.unidade_codigo));
    orgaos.set(cnpj, o);
  };
  const lotes = {};

  const contratos = await buscarPncp({ tipos_documento: "contrato", status: "vigente", ufs: uf }, op);
  contratos.forEach(anotar);
  lotes.contrato = contratos.filter((d) => d.uf === uf && contratoInteressa(d, hoje, ate)).map((d) => linhaContrato(d, coletadoEm));
  console.log(`${uf} contratos: ${contratos.length} vigentes, ${lotes.contrato.length} vencem até ${ate}`);

  const atas = (await buscarPncp({ tipos_documento: "ata", status: "vigente", ufs: uf, permite_adesao: "true" }, op))
    .filter((d) => d.uf === uf && !d.cancelado && dia(d.data_fim_vigencia) >= hoje);
  atas.forEach(anotar);
  const porAta = new Map(atas.map((d) => [d.numero_controle_pncp, linhaAta(d, coletadoEm)]));
  // Itens só onde a gerenciadora é UASG do Compras.gov (código numérico de até 6 dígitos).
  const gerenciadoras = [...new Set(atas.map((d) => String(d.unidade_codigo || "")).filter((c) => /^\d{5,6}$/.test(c)))];
  const comItens = new Set();
  const itensAta = [];
  for (const uasg of gerenciadoras) {
    const itens = await paginasCompras("/modulo-arp/2_consultarARPItem", {
      codigoUnidadeGerenciadora: uasg, dataVigenciaInicialMin: hojeBrasilia(Date.now(), -730), dataVigenciaInicialMax: hoje,
    }, op);
    for (const it of itens) {
      const ata = porAta.get(it.numeroControlePncpAta);
      if (!ata || it.itemExcluido || dia(it.dataVigenciaFinal) < hoje) continue;
      comItens.add(it.numeroControlePncpAta);
      itensAta.push(linhaItemAta(it, ata, coletadoEm));
    }
  }
  lotes.ata = [...itensAta, ...[...porAta].filter(([k]) => !comItens.has(k)).map(([, v]) => v)];
  console.log(`${uf} atas com adesão: ${atas.length} (${comItens.size} com itens do Compras.gov, ${gerenciadoras.length} UASGs), ${lotes.ata.length} linhas`);

  return { lotes, orgaos };
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

async function coletarPca(uf, orgaos, ctx) {
  const { hoje, ate, coletadoEm, op, prazoFinal } = ctx;
  const ano = Number(hoje.slice(0, 4));
  const linhas = [];
  for (const [cnpj, org] of orgaos) {
    for (const a of [ano, ano + 1]) {
      if (Date.now() > prazoFinal) return { linhas, completo: false };
      const unidades = (await obter(`${PNCP}/api/pncp/v1/orgaos/${cnpj}/pca/${a}/consolidado/unidades`, op).catch(() => null)) || [];
      for (const u of unidades.filter((x) => org.unidades.has(String(x.codigoUnidade)))) {
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
    }
  }
  return { linhas: linhas.filter((l) => dentro(l.data_ref, hoje, ate)), completo: true };
}

// Mesma chave pode vir duas vezes (item repetido no DFD, ata em duas páginas): a última vence.
const semRepetir = (linhas) => [...new Map(linhas.map((l) => [l.id, l])).values()];

async function gravar(linhas, filtroLimpeza, ctx) {
  const unicas = semRepetir(linhas);
  await upsertEmLotes(TABELA, unicas, "id", num(process.env.TAMANHO_LOTE_BANCO, 500));
  if (filtroLimpeza) await restFetch(`${TABELA}?${filtroLimpeza}&coletado_em=lt.${encodeURIComponent(ctx.coletadoEm)}`, { method: "DELETE" });
  return unicas.length;
}

async function main() {
  const inicio = Date.now();
  const hoje = hojeBrasilia(inicio);
  const ctx = {
    hoje, ate: hojeBrasilia(inicio, num(process.env.DIAS_HORIZONTE, 400)), coletadoEm: new Date(inicio).toISOString(), op: {},
    prazoFinal: inicio + num(process.env.LIMITE_MINUTOS, 50) * 60000,
  };
  const ufs = String(process.env.PROSPECCAO_UFS || "AM").split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s));
  const resumo = [];
  let falhas = 0;

  try {
    resumo.push(`irp=${await gravar(await coletarIrps(ctx), "tipo=eq.irp", ctx)}`);
  } catch (e) { falhas++; console.error("IRP falhou (mantidas as da véspera):", e.message); }

  for (const uf of ufs) {
    let orgaos = new Map();
    try {
      const r = await coletarUf(uf, ctx);
      orgaos = r.orgaos;
      for (const tipo of ["contrato", "ata"]) resumo.push(`${uf} ${tipo}=${await gravar(r.lotes[tipo], `tipo=eq.${tipo}&uf=eq.${uf}`, ctx)}`);
    } catch (e) { falhas++; console.error(`${uf} contratos/atas falhou (mantidos os da véspera):`, e.message); }
    try {
      const { linhas, completo } = await coletarPca(uf, orgaos, ctx);
      // Sem a lista de órgãos (fase anterior falhou) ou sem tempo: grava o que veio e não limpa.
      resumo.push(`${uf} pca=${await gravar(linhas, completo && orgaos.size ? `tipo=eq.pca&uf=eq.${uf}` : null, ctx)}${completo ? "" : " (parcial)"} de ${orgaos.size} órgãos`);
    } catch (e) { falhas++; console.error(`${uf} PCA falhou (mantido o da véspera):`, e.message); }
  }
  // O que já passou da data (prazo de IRP, fim de vigência, data desejada) sai da tabela.
  await restFetch(`${TABELA}?data_ref=lt.${hoje}`, { method: "DELETE" });
  console.log(`Prospecção ${hoje}: ${resumo.join("; ")} em ${Math.round((Date.now() - inicio) / 1000)} s`);
  if (falhas) process.exitCode = 1;
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { hojeBrasilia, normalizar, contratoInteressa, linhaContrato, linhaAta, linhaItemAta, linhaIrp, linhaPcaPncp, linhaPgc, semRepetir, obter };
