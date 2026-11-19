// Análise por CNPJ: em que contratações uma empresa disputou, ganhou e perdeu. Núcleo único para:
//   - a função /api/analise-cnpj (Cloudflare grátis: 50 subrequisições, 10 ms de CPU): acha as compras em
//     que o CNPJ teve RESULTADO no PNCP e coleta as primeiras pelos dados abertos do Compras.gov;
//   - o robô da esteira (scripts/analise_cnpj.js): completa as compras pendentes e lê o arquivo semanal de
//     propostas, que é a única fonte grátis das disputas PERDIDAS (todos os participantes, com posição).
// Fontes públicas, sem chave e sem captcha:
//   - PNCP /api/search/suggest?campo=fornecedores (o filtro "Fornecedores/Arrematantes" do portal) e
//     /api/search?fornecedores=<id>: todas as contratações em que o CNPJ teve resultado (vencedor ou reserva);
//   - dados abertos do Compras.gov (modulo-contratacoes) e PNCP /itens e /resultados (via _licitacao_anterior);
//   - repositorio.dados.gov.br/seges/comprasgov/propostas (CSV ";" zipado, semanal, só itens homologados).
// Grava nas tabelas historico_* (compartilhadas com a "Licitação anterior"). CPF nunca entra.
const L = require("./_licitacao_anterior");

const PNCP = "https://pncp.gov.br";
const digitos = (v) => String(v ?? "").replace(/\D/g, "");
const texto = (v, max) => (v === null || v === undefined ? null : String(v).replace(/\s+/g, " ").trim().slice(0, max) || null);
const numero = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const mascarar = (c) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
// 24 meses ≈ 1,2 GB zipados (jan-jun/2026: 39-78 MB por mês); o robô lê mês a mês e retoma na rodada seguinte.
const MESES_JANELA = 24;

// Códigos de situacao_item do arquivo de propostas conferidos contra os dados abertos (2.1, nov/2026):
// 8 = Fracassado; 3, 4, 13 e 14 = Anulado/Revogado/Cancelado. Os demais não sobrescrevem a situação.
const SITUACAO_ITEM = { 8: "Fracassado", 3: "Anulado/Revogado/Cancelado", 4: "Anulado/Revogado/Cancelado", 13: "Anulado/Revogado/Cancelado", 14: "Anulado/Revogado/Cancelado" };
// codigo_modalidade do Compras.gov (o mesmo dos dígitos 7-8 do id da compra).
const MODALIDADES = { 1: "Convite", 2: "Tomada de Preços", 3: "Concorrência", 5: "Pregão", 6: "Dispensa", 7: "Inexigibilidade", 20: "Concurso" };

function cnpjValido(c) {
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (n) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = pesos.reduce((s, p, i) => s + Number(c[i]) * p, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
}

// Meses do arquivo de propostas a ler, do mais novo para o mais antigo ("AAAA/MM"). Só a partir de 2022.
function mesesJanela(agora, quantos = MESES_JANELA) {
  const d = new Date(agora);
  const meses = [];
  for (let k = 0; k < quantos; k++) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - k, 1));
    if (x.getUTCFullYear() < 2022) break;
    meses.push(`${x.getUTCFullYear()}/${String(x.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return meses;
}

// Filtro "Fornecedores/Arrematantes" do PNCP: nome ou CNPJ -> [{cnpj, nome, total, ids}]. O índice só acha
// o CNPJ com máscara. Pessoa física (CPF, 11 dígitos) é descartada aqui: nunca sai desta função.
async function sugerirFornecedores(b, termo) {
  const t = /^[\d\s./-]+$/.test(String(termo)) && digitos(termo).length === 14 ? mascarar(digitos(termo)) : String(termo).trim();
  const r = await b.json(`${PNCP}/api/search/suggest?tipos_documento=edital&campo=fornecedores&q=${encodeURIComponent(t.slice(0, 80))}&tam_pagina=20`);
  const porCnpj = new Map();
  for (const it of r?.items || []) {
    const cnpj = digitos(it.ni);
    if (cnpj.length !== 14 || !/^\d{1,12}$/.test(String(it.id || ""))) continue;
    const atual = porCnpj.get(cnpj) || { cnpj, nome: texto(it.nome, 300), total: 0, ids: [] };
    if (!atual.ids.includes(String(it.id))) atual.ids.push(String(it.id));
    atual.total = Math.max(atual.total, Number(it.total) || 0);
    porCnpj.set(cnpj, atual);
  }
  return [...porCnpj.values()].sort((a, b2) => b2.total - a.total);
}

// Contratações em que o fornecedor tem resultado no PNCP, da mais nova para a mais antiga.
async function comprasComResultado(b, ids, maxPaginas) {
  const compras = [];
  let total = 0;
  for (let p = 1; p <= maxPaginas; p++) {
    const q = new URLSearchParams({ tipos_documento: "edital", ordenacao: "-data", pagina: String(p), tam_pagina: "100", status: "todos", fornecedores: ids.join("|") });
    const r = await b.json(`${PNCP}/api/search?${q}`);
    total = Number(r?.total) || total;
    for (const i of r?.items || []) {
      const c = L.compraDaBusca(i);
      if (c && !compras.some((x) => x.id_compra === c.id_compra)) compras.push({ ...c, uf: /^[A-Z]{2}$/.test(String(i.uf || "")) ? i.uf : null });
    }
    if (!r?.items?.length || compras.length >= total) break;
  }
  return { compras, total };
}

// Referência PNCP a partir do número de controle "CNPJ-1-SEQ/ANO".
function refDoControle(controle) {
  const m = /^(\d{14})-\d-(\d+)\/(\d{4})$/.exec(String(controle || ""));
  return m ? { cnpj: m[1], ano: m[3], seq: String(Number(m[2])) } : null;
}
const linkPncpDoControle = (controle) => { const r = refDoControle(controle); return r ? `${PNCP}/app/editais/${r.cnpj}/${r.ano}/${r.seq}` : null; };

// Itens e resultados de uma compra, só dos itens em que o CNPJ aparece (com todos os resultados desses itens,
// para saber o vencedor). maxItensPncp limita as chamadas por item fora do Compras.gov.
async function coletarCompra(b, compra, cnpj, { maxItensPncp = 0 } = {}) {
  const c = { ...compra };
  if (!c._ref) c._ref = refDoControle(c.numero_controle_pncp);
  const lei14133 = L.decifrarIdCompra(c.id_compra)?.lei14133;
  const fonte = (lei14133 && await L.fonteDadosAbertos(b, c)) || (maxItensPncp > 0 ? await L.fontePncp(b, c) : null);
  if (!fonte) return null;
  if (fonte.uf) c.uf = fonte.uf;
  const porChave = new Map(); // o mesmo fornecedor duas vezes no item quebraria o upsert do lote
  const guardar = (p) => porChave.set(`${p.numero_item}|${p.fornecedor_chave}`, { ...(porChave.get(`${p.numero_item}|${p.fornecedor_chave}`) || {}), ...p });
  let parcial = Boolean(fonte.parcial);
  if (fonte.resultados) {
    for (const [n, linhas] of fonte.resultados) {
      if (!linhas.some((r) => digitos(r.niFornecedor) === cnpj)) continue;
      for (const r of linhas) guardar(L.participacaoDoResultado(c.id_compra, n, r));
    }
  } else {
    const comResultado = fonte.itens.filter((it) => it.temResultado);
    for (const it of comResultado.slice(0, maxItensPncp)) {
      const res = await b.json(`${PNCP}/api/pncp/v1/orgaos/${fonte.ref.cnpj}/compras/${fonte.ref.ano}/${fonte.ref.seq}/itens/${it.n}/resultados`);
      const linhas = Array.isArray(res) ? res : [];
      if (linhas.some((r) => digitos(r.niFornecedor) === cnpj)) for (const r of linhas) guardar(L.participacaoDoResultado(c.id_compra, it.n, r));
    }
    if (comResultado.length > maxItensPncp) parcial = true;
  }
  const participacoes = [...porChave.values()];
  const quero = new Set(participacoes.map((p) => p.numero_item));
  // delete devolve true só na 1ª vez: item repetido na fonte entra uma vez (o lote do upsert não aceita repetição).
  const itens = fonte.itens.filter((it) => quero.delete(it.n)).map((it) => ({ id_compra: c.id_compra, numero_item: it.n, catmat: it.catmat, pdm: it.pdm,
    descricao: texto(it.descricao, 600), quantidade: numero(it.quantidade), unidade: texto(it.unidade, 60), valor_estimado: numero(it.valor_estimado),
    situacao_item: texto(it.situacao, 80), tem_resultado: it.temResultado }));
  const { _ref, ...linhaCompra } = c;
  return { compra: linhaCompra, itens, participacoes, parcial };
}

// Filtro do arquivo de propostas para um conjunto de CNPJs. O arquivo vem agrupado por compra (conferido em
// set/2026: 2.194 compras, nenhuma volta): guarda as linhas da compra corrente e, ao trocar de compra, fica
// só com as linhas dos CNPJs pedidos e com o vencedor (classificação 1) dos itens em que eles aparecem.
// shortcut: compra que reaparecer mais adiante no arquivo perde o vencedor do bloco anterior; trocar por
// mapa de vencedores do mês inteiro se o arquivo deixar de vir agrupado.
function criarFiltroCnpjs(cnpjs) {
  const alvos = [...cnpjs];
  let cab = null, idAtual = null, bloco = [];
  const compras = new Map(), itens = new Map(), participacoes = new Map();
  const fechar = () => {
    if (!bloco.length || !bloco.some((l) => alvos.some((c) => l.includes(c)))) { bloco = []; return; }
    const linhas = bloco.map(L.lerLinhaCsv);
    bloco = [];
    const meus = linhas.filter((c) => cnpjs.has(digitos(c[cab.identificacao_participante])) && Number(c[cab.numero_item]) > 0);
    if (!meus.length) return;
    const chaves = new Set(meus.map((c) => Number(c[cab.numero_item])));
    const vencedores = linhas.filter((c) => chaves.has(Number(c[cab.numero_item])) && c[cab.classificacao] === "1");
    for (const c of [...meus, ...vencedores]) guardar(c);
  };
  const guardar = (c) => {
    const id = c[cab.id_compra], n = Number(c[cab.numero_item]);
    if (!/^\d{17}$/.test(id)) return;
    if (!compras.has(id)) {
      const ano = Number(c[cab.ano_compra]) || null;
      compras.set(id, { id_compra: id, numero_controle_pncp: texto(c[cab.numero_controle_pncp], 60), uasg: digitos(c[cab.numero_uasg]) || null, ano,
        numero: c[cab.numero_compra] ? `${c[cab.numero_compra]}/${ano}` : null, modalidade: MODALIDADES[Number(c[cab.codigo_modalidade])] || null,
        plataforma: "Compras.gov.br", objeto: texto(c[cab.objeto], 1000), link_origem: L.linkCompraGov(id), link_pncp: linkPncpDoControle(c[cab.numero_controle_pncp]) });
    }
    const k = `${id}|${n}`;
    if (!itens.has(k)) {
      const situacao = SITUACAO_ITEM[Number(c[cab.situacao_item])];
      itens.set(k, { id_compra: id, numero_item: n, descricao: texto(c[cab.descricao], 600), quantidade: numero(c[cab.quantidade_solicitada]),
        unidade: texto(c[cab.sigla_unidade_fornecimento], 60), situacao_item: situacao || null, tem_resultado: true });
    }
    const uf = String(c[cab.uf] || "").toUpperCase();
    const sp = String(c[cab.situacao_proposta] || "").trim();
    const p = { id_compra: id, numero_item: n, ...L.fornecedor(c[cab.identificacao_participante], c[cab.nome_participante], `p${c[cab.id] || c[cab.classificacao]}`),
      porte: L.PORTES[c[cab.porte_empresa_participante]] || null, uf: /^[A-Z]{2}$/.test(uf) ? uf : null,
      classificacao: Number.isSafeInteger(Number(c[cab.classificacao])) && c[cab.classificacao] !== "" ? Number(c[cab.classificacao]) : null,
      valor_proposta: numero(c[cab.valor_proposta_calculado]), valor_lance: numero(c[cab.valor_lance_calculado]),
      valor_negociado: numero(c[cab.valor_negociado_julgamento_calculado]), situacao_proposta: /^\d{1,3}$/.test(sp) ? sp : null,
      data_resultado: /^\d{4}-\d{2}-\d{2}/.test(String(c[cab.data_hora_alteracao_homologacao] || "")) ? c[cab.data_hora_alteracao_homologacao].slice(0, 10) : null };
    participacoes.set(`${k}|${p.fornecedor_chave}`, p);
  };
  return {
    linha(l) {
      if (!cab) { cab = Object.fromEntries(L.lerLinhaCsv((l.charCodeAt(0) === 0xfeff ? l.slice(1) : l)).map((nome, i) => [nome, i])); return; }
      const i = l.indexOf('";"');
      const id = i < 0 ? "" : l.slice(i + 3, l.indexOf('"', i + 3));
      if (id !== idAtual) { fechar(); idAtual = id; }
      bloco.push(l);
    },
    resultado() {
      fechar();
      // Item fora de faixa (lote "-1") já foi descartado; as chaves estrangeiras pedem compra -> item -> participação.
      return { compras: [...compras.values()], itens: [...itens.values()], participacoes: [...participacoes.values()] };
    },
  };
}

// Grava sem estragar o que já existe: compra e item vindos do arquivo só ENTRAM se ainda não existem (a
// descrição do arquivo é a curta, e o cabeçalho do PNCP/dados abertos é mais rico). A participação mescla
// por coluna (a do arquivo traz posição, valores e situação; a do PNCP, homologado e ordem).
async function gravarDoArquivo(rest, { compras, itens, participacoes }) {
  if (compras.length) await L.upsertPorColunas(rest, "historico_compras", "id_compra", compras, "ignore-duplicates");
  if (itens.length) await L.upsertPorColunas(rest, "historico_itens", "id_compra,numero_item", itens, "ignore-duplicates");
  if (participacoes.length) await L.upsertPorColunas(rest, "historico_participacoes", "id_compra,numero_item,fornecedor_chave", participacoes);
}

module.exports = { cnpjValido, mesesJanela, sugerirFornecedores, comprasComResultado, coletarCompra, criarFiltroCnpjs, gravarDoArquivo,
  refDoControle, linkPncpDoControle, mascarar, SITUACAO_ITEM, MESES_JANELA };
