// "Gravar pregão no LicitaPlena" (extensao-leitura/pregao-leitor.mjs): recebe o que a página PÚBLICA do pregão
// mostrou na aba do próprio usuário (Compras.gov "Acompanhar Contratação" ou ata do ComprasNet depois do captcha)
// e guarda na base compartilhada pregoes_gravados* (supabase/pregoes_gravados.sql). Dado público e caro de obter
// (captcha a cada abertura): uma vez gravado, qualquer cliente logado lê sem abrir o portal de novo.
//   POST {versao:1, fonte, compra, url, cabecalho, itens[], mensagens[]} -> {ok, compra, propostas, mensagens_novas}
//   GET  ?compra=<17 dígitos>                                            -> {ok, pregao: {...} | null}
// Contrato completo: docs/pregao-gravado.md. Login obrigatório; cota diária só na gravação.
// CPF nunca é aceito: participante sem CNPJ chega como "pf:<n>" com nome "Pessoa física"; CPF em texto é
// mascarado de novo aqui (a extensão já mascara, mas o servidor não confia nela).
const { cabecalhosPadrao, exigirUsuarioLogado, verificarLimiteDiario } = require("./_auth");

const SUPABASE_URL = "https://lsqjamqvmrcyrvowndiu.supabase.co";
const LIMITE_DIARIO = 400; // ~1 gravação por item aberto; um pregão grande tem dezenas de itens
const MAX_CORPO = 2_000_000;
const MAX_ITENS = 300;
const MAX_PROPOSTAS = 1000;
const MAX_MENSAGENS = 3000;
const MAX_LANCES = 500;
const TIPOS = new Set(["recusa", "desclassificacao", "inabilitacao", "convocacao", "habilitacao", "adjudicacao", "aceite", "outro"]);
const ORIGENS_URL = new Set(["cnetmobile.estaleiro.serpro.gov.br", "comprasnet.gov.br", "www.comprasnet.gov.br"]);

function cnpjValido(c) {
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (n) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = pesos.reduce((s, p, i) => s + Number(c[i]) * p, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
}

const semCpf = (s) => s.replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{11}\b/g, "***.***.***-**");

// Validação na fronteira: tipo, tamanho e formato de cada campo. Devolve {erro} ou {dados} já normalizado.
function validarPregao(d) {
  const erros = [];
  const falha = (caminho, msg) => { erros.push(`${caminho}: ${msg}`); return null; };
  const texto = (v, caminho, max, obrigatorio = false) => {
    if (v === null || v === undefined || v === "") return obrigatorio ? falha(caminho, "obrigatório") : null;
    if (typeof v !== "string") return falha(caminho, "deve ser texto");
    const t = semCpf(v.replace(/\s+/g, " ").trim());
    if (t.length > max) return falha(caminho, `máximo ${max} caracteres`);
    return t || (obrigatorio ? falha(caminho, "obrigatório") : null);
  };
  const numero = (v, caminho) => {
    if (v === null || v === undefined) return null;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v >= 1e15) return falha(caminho, "número inválido");
    return v;
  };
  const booleano = (v, caminho) => (v === null || v === undefined ? null : typeof v === "boolean" ? v : falha(caminho, "deve ser verdadeiro/falso"));
  const lista = (v, caminho, max) => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) return falha(caminho, "deve ser lista") || [];
    if (v.length > max) return falha(caminho, `máximo ${max}`) || [];
    return v;
  };
  const dataHora = (v, caminho) => {
    if (v === null || v === undefined) return null;
    return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "Z")) ? v : falha(caminho, "data/hora inválida");
  };
  const chave = (v, caminho) => {
    if (typeof v === "string" && /^pf:\d{1,4}$/.test(v)) return v;
    if (typeof v === "string" && cnpjValido(v)) return v;
    return falha(caminho, "fornecedor deve ser CNPJ válido (14 dígitos) ou pf:<n>; CPF não é aceito");
  };
  const mensagem = (m, c) => {
    if (!m || typeof m !== "object") return falha(c, "objeto inválido");
    const tipo = TIPOS.has(m.tipo) ? m.tipo : falha(`${c}.tipo`, "inválido");
    return { fornecedor: m.fornecedor === null || m.fornecedor === undefined ? null : chave(m.fornecedor, `${c}.fornecedor`),
      dataHora: dataHora(m.dataHora, `${c}.dataHora`), autor: texto(m.autor, `${c}.autor`, 40),
      texto: texto(m.texto, `${c}.texto`, 4000, true), tipo, motivo: texto(m.motivo, `${c}.motivo`, 2000) };
  };

  if (!d || typeof d !== "object" || Array.isArray(d)) return { erro: "Pedido inválido." };
  if (d.versao !== 1) falha("versao", "deve ser 1");
  if (!["comprasgov", "comprasnet"].includes(d.fonte)) falha("fonte", "deve ser comprasgov ou comprasnet");
  const compra = typeof d.compra === "string" && /^\d{17}$/.test(d.compra) && Number(d.compra.slice(13)) >= 1990 && Number(d.compra.slice(13)) <= 2100 ? d.compra : falha("compra", "identificador de 17 dígitos (UASG+modalidade+número+ano) inválido");
  let url = null;
  if (d.url !== undefined && d.url !== null) {
    try {
      const u = new URL(d.url);
      if (!ORIGENS_URL.has(u.hostname) || u.username || u.password) throw new Error();
      // Só o identificador da compra fica; nada de token de captcha ou outro parâmetro.
      url = `${u.origin}${u.pathname}${compra && u.searchParams.get("compra") === compra ? `?compra=${compra}` : ""}`.slice(0, 500);
    } catch { falha("url", "deve ser página do Compras.gov ou do ComprasNet"); }
  }
  const cab = d.cabecalho && typeof d.cabecalho === "object" ? d.cabecalho : {};
  const uasg = typeof cab.uasg === "string" && /^\d{6}$/.test(cab.uasg) ? cab.uasg : compra?.slice(0, 6) || null;
  const cabecalho = { uasg, orgao: texto(cab.orgao, "cabecalho.orgao", 300),
    numero: cab.numero === null || cab.numero === undefined ? null : typeof cab.numero === "string" && /^\d{1,5}$/.test(cab.numero) ? cab.numero : falha("cabecalho.numero", "inválido"),
    ano: cab.ano === null || cab.ano === undefined ? null : Number.isInteger(cab.ano) && cab.ano >= 1990 && cab.ano <= 2100 ? cab.ano : falha("cabecalho.ano", "inválido"),
    modalidade: texto(cab.modalidade, "cabecalho.modalidade", 80) };

  const numerosItem = new Set();
  const itens = lista(d.itens, "itens", MAX_ITENS).map((it, i) => {
    const c = `itens[${i}]`;
    if (!it || typeof it !== "object") return falha(c, "objeto inválido");
    const n = Number.isInteger(it.numero) && it.numero >= 1 && it.numero <= 99999 ? it.numero : falha(`${c}.numero`, "inteiro de 1 a 99999");
    if (n !== null && numerosItem.has(n)) falha(`${c}.numero`, "repetido");
    numerosItem.add(n);
    const chaves = new Set();
    const propostas = lista(it.propostas, `${c}.propostas`, MAX_PROPOSTAS).map((p, j) => {
      const cp = `${c}.propostas[${j}]`;
      if (!p || typeof p !== "object") return falha(cp, "objeto inválido");
      const k = chave(p.chave, `${cp}.chave`);
      if (k && chaves.has(k)) falha(`${cp}.chave`, "repetida no item");
      chaves.add(k);
      const pf = k?.startsWith("pf:");
      if (!pf && p.cnpj !== k) falha(`${cp}.cnpj`, "deve ser igual à chave");
      if (pf && p.cnpj !== null && p.cnpj !== undefined) falha(`${cp}.cnpj`, "pessoa física não leva documento");
      const lances = lista(p.lances, `${cp}.lances`, MAX_LANCES).map((l, x) => ({ valor: numero(l?.valor, `${cp}.lances[${x}].valor`),
        dataHora: dataHora(l?.dataHora, `${cp}.lances[${x}].dataHora`), excluido: booleano(l?.excluido, `${cp}.lances[${x}].excluido`) ?? false }));
      return { chave: k, cnpj: pf ? null : k, nome: pf ? "Pessoa física" : texto(p.nome, `${cp}.nome`, 300),
        uf: p.uf === null || p.uf === undefined ? null : typeof p.uf === "string" && /^[A-Z]{2}$/.test(p.uf) ? p.uf : falha(`${cp}.uf`, "sigla inválida"),
        meEpp: booleano(p.meEpp, `${cp}.meEpp`), situacao: texto(p.situacao, `${cp}.situacao`, 120),
        valorOfertado: numero(p.valorOfertado, `${cp}.valorOfertado`), valorNegociado: numero(p.valorNegociado, `${cp}.valorNegociado`),
        valorProposta: numero(p.valorProposta, `${cp}.valorProposta`), valorTotal: numero(p.valorTotal, `${cp}.valorTotal`),
        quantidade: numero(p.quantidade, `${cp}.quantidade`), marca: texto(p.marca, `${cp}.marca`, 200),
        fabricante: texto(p.fabricante, `${cp}.fabricante`, 200), modelo: texto(p.modelo, `${cp}.modelo`, 200), lances,
        chatLido: booleano(p.chatLido, `${cp}.chatLido`) ?? false, propostaLida: booleano(p.propostaLida, `${cp}.propostaLida`) ?? false };
    });
    const mensagens = lista(it.mensagens, `${c}.mensagens`, MAX_MENSAGENS).map((m, j) => mensagem(m, `${c}.mensagens[${j}]`));
    return { numero: n, descricao: texto(it.descricao, `${c}.descricao`, 2000), situacao: texto(it.situacao, `${c}.situacao`, 120),
      quantidade: numero(it.quantidade, `${c}.quantidade`), valorEstimado: numero(it.valorEstimado, `${c}.valorEstimado`),
      unidade: texto(it.unidade, `${c}.unidade`, 60), propostasLidas: booleano(it.propostasLidas, `${c}.propostasLidas`) ?? false, propostas, mensagens };
  });
  const mensagens = lista(d.mensagens, "mensagens", MAX_MENSAGENS).map((m, j) => mensagem(m, `mensagens[${j}]`));
  if (!itens.length && !mensagens.length) falha("itens", "nada para gravar");
  if (erros.length) return { erro: `Pedido inválido: ${erros.slice(0, 5).join("; ")}` };
  return { dados: { versao: 1, fonte: d.fonte, compra, url, cabecalho, itens, mensagens } };
}

async function rest(caminho, opcoes = {}) {
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, { ...opcoes, signal: globalThis.AbortSignal.timeout(15000),
    headers: { apikey: chave, Authorization: `Bearer ${chave}`, "Content-Type": "application/json", ...(opcoes.headers || {}) } });
  if (!r.ok) throw new Error(`Supabase ${caminho.split("?")[0]} HTTP ${r.status}`);
  return r.json();
}

// Leitura para o cartão "Licitação anterior": sem id de usuário (quem gravou fica só no banco).
async function lerPregao(compra) {
  const [pregoes, propostas, mensagens] = await Promise.all([
    rest(`pregoes_gravados?id_compra=eq.${compra}&select=id_compra,fonte,url,uasg,orgao,numero,ano,modalidade,itens,gravado_em,atualizado_em`),
    rest(`pregoes_gravados_propostas?id_compra=eq.${compra}&select=numero_item,fornecedor_chave,cnpj,nome,uf,me_epp,situacao,valor_ofertado,valor_negociado,valor_proposta,valor_total,quantidade,marca,fabricante,modelo,lances,chat_lido,proposta_lida,atualizado_em&order=numero_item,valor_ofertado.nullslast&limit=20000`),
    rest(`pregoes_gravados_mensagens?id_compra=eq.${compra}&select=numero_item,fornecedor_chave,data_hora,autor,texto,tipo,motivo&order=numero_item,data_hora&limit=20000`),
  ]);
  if (!pregoes.length) return null;
  return { ...pregoes[0], propostas, mensagens };
}

exports.handler = async (event) => {
  const headers = { ...cabecalhosPadrao(event), "Cache-Control": "no-store" };
  const responder = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  if (event.httpMethod === "OPTIONS") return responder(204, {});
  if (!["GET", "POST"].includes(event.httpMethod)) return responder(405, { erro: "Método não permitido." });
  const auth = await exigirUsuarioLogado(event);
  if (!auth.ok) return responder(auth.status, { erro: auth.erro });
  // Sem chave de serviço não há onde gravar nem de onde ler: não há "modo sem banco" útil aqui.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return responder(503, { erro: "Gravação de pregões indisponível neste ambiente." });

  try {
    if (event.httpMethod === "GET") {
      const compra = String(event.queryStringParameters?.compra || "");
      if (!/^\d{17}$/.test(compra)) return responder(400, { erro: "Informe compra com 17 dígitos." });
      return responder(200, { ok: true, pregao: await lerPregao(compra) });
    }
    if (String(event.body || "").length > MAX_CORPO) return responder(413, { erro: "Página grande demais para uma gravação; grave item por item." });
    let corpo;
    try { corpo = JSON.parse(event.body || ""); } catch { return responder(400, { erro: "JSON inválido." }); }
    const v = validarPregao(corpo);
    if (v.erro) return responder(400, { erro: v.erro });
    const limite = await verificarLimiteDiario(auth.userId, "pregao-gravado", LIMITE_DIARIO);
    if (!limite.ok) return responder(limite.status, { erro: limite.erro });
    const r = await rest("rpc/gravar_pregao_gravado", { method: "POST", body: JSON.stringify({ p_dados: v.dados, p_usuario: auth.userId }) });
    return responder(200, { ok: true, compra: v.dados.compra, ...r });
  } catch (e) {
    console.error("pregao-gravado:", e.message);
    return responder(502, { erro: "Não foi possível acessar a base de pregões agora. Tente novamente." });
  }
};

exports.validarPregao = validarPregao;
exports.cnpjValido = cnpjValido;
