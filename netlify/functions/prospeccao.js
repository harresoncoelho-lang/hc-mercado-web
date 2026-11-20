// Prospecção (Inteligência de Mercado): PCA/PGC, IRP aberta, ata com saldo para adesão e contrato vencendo,
// lidos da tabela prospeccao_itens (carga diária do robô scripts/coletar_prospeccao.js).
//   GET /api/prospeccao?tipo=pca|irp|ata|contrato&uf=AM&palavras=limpeza,papel&catmat=269941&dias=180
//   (Authorization: Bearer <sessão>)
// Resposta: { tipo, linhas:[...], limite, truncado, coletadoEm }.
// Uma subrequisição por chamada (a tela pede uma aba por vez): cabe folgado nos 50 do Cloudflare, e o
// trabalho pesado (varrer PNCP/Compras.gov) já foi feito pelo robô. Lê com o token do PRÓPRIO usuário,
// e a RLS (authenticated) é a barreira. Sem verificarLimiteDiario: a mesma leitura já é possível direto
// pelo PostgREST com a sessão (mesmo raciocínio de sancoes-cnpj.js).
const { cabecalhosPadrao, exigirUsuarioAprovado } = require("./_auth");

const URL_SB = "https://lsqjamqvmrcyrvowndiu.supabase.co";
const ANON = "sb_publishable_yH695cc52QUKYfFEgV5RwQ_0a8GLIeb";
const LIMITE = 200;
const TIPOS = new Set(["pca", "irp", "ata", "contrato"]);
const DIAS = new Set([30, 90, 180, 365]);
const COLUNAS = "id,tipo,fonte,plataforma,uf,orgao_cnpj,orgao_nome,unidade_nome,municipio,objeto,descricao,catmat,quantidade,valor_unitario,valor_total,data_inicio,data_ref,fornecedor_cnpj,fornecedor_nome,saldo,maximo_adesao,adesoes_usadas,adesoes_em,link,coletado_em";
const UFS = new Set("AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split(" "));
// Brasília é UTC-3 fixo (mesma conta de contextos-operacao).
const hojeBrasilia = (agora = Date.now(), dias = 0) => new Date(agora - 3 * 36e5 + dias * 864e5).toISOString().slice(0, 10);

// Mesma normalização do robô (coluna busca): minúsculo, sem acento; e só letras/dígitos/espaço, para o
// termo não carregar sintaxe do PostgREST (vírgula, parêntese, ponto, asterisco) para dentro do or=().
const termo = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

function validar(q = {}) {
  const tipo = String(q.tipo || "");
  if (!TIPOS.has(tipo)) return { erro: "Escolha o tipo: pca, irp, ata ou contrato." };
  const uf = String(q.uf || "").toUpperCase();
  if (uf && !UFS.has(uf)) return { erro: "UF inválida." };
  const palavras = [...new Set(String(q.palavras || "").slice(0, 300).split(",").map(termo).filter((p) => p.length >= 3))].slice(0, 8);
  const catmat = String(q.catmat || "").trim();
  if (catmat && !/^\d{1,12}$/.test(catmat)) return { erro: "CATMAT/CATSER deve ter só dígitos." };
  const dias = Number(q.dias || 180);
  if (!DIAS.has(dias)) return { erro: "Período: 30, 90, 180 ou 365 dias." };
  return { tipo, uf: uf || null, palavras, catmat: catmat || null, dias };
}

// Janela por data_ref: o que vence/acontece de hoje até hoje+dias. Ata é diferente: para adesão interessa a
// ata ainda vigente por pelo menos 30 dias (carona leva tempo), sem teto.
//
// Com palavras, a busca é em três níveis (cada um é uma consulta, na ordem; os de baixo só entram se sobrar lugar):
//   inicio  o nome do item (busca_nome = começo da descrição/objeto) começa com o termo
//   nome    o termo aparece em outro ponto do nome
//   espec   o termo só aparece no resto do texto (especificação): a tela recolhe esse grupo ("papel a4" dentro da ficha da impressora)
const NIVEIS = ["inicio", "nome", "espec"];
function filtroTexto(palavras, nivel) {
  const cond = (coluna, antes, depois) => palavras.map((t) => `${coluna}.ilike.${antes}${t}${depois}`).join(",");
  if (nivel === "inicio") return ["or", `(${cond("busca_nome", "", "*")})`];
  if (nivel === "nome") return ["and", `(or(${cond("busca_nome", "*", "*")}),not.or(${cond("busca_nome", "", "*")}))`];
  return ["and", `(or(${cond("busca", "*", "*")}),not.or(${cond("busca_nome", "*", "*")}))`];
}

function montarConsulta(f, agora = Date.now(), nivel = null, limite = LIMITE + 1) {
  const p = new URLSearchParams({ select: COLUNAS, tipo: `eq.${f.tipo}`, order: "data_ref.asc,valor_total.desc.nullslast", limit: String(limite) });
  if (f.uf) p.set("uf", `eq.${f.uf}`);
  if (f.catmat) p.set("catmat", `eq.${f.catmat}`);
  if (f.palavras.length && !nivel) p.set("or", `(${f.palavras.map((t) => `busca.ilike.*${t}*`).join(",")})`);
  else if (f.palavras.length) p.set(...filtroTexto(f.palavras, nivel));
  if (f.tipo === "ata") p.append("data_ref", `gte.${hojeBrasilia(agora, 30)}`);
  else {
    p.append("data_ref", `gte.${hojeBrasilia(agora)}`);
    p.append("data_ref", `lte.${hojeBrasilia(agora, f.dias)}`);
  }
  return `${URL_SB}/rest/v1/prospeccao_itens?${p}`;
}

exports.handler = async (event) => {
  const headers = { ...cabecalhosPadrao(event), "Cache-Control": "private, max-age=600" };
  const resposta = (status, body) => ({ statusCode: status, headers: status === 200 ? headers : { ...headers, "Cache-Control": "no-store" }, body: JSON.stringify(body) });
  if (event.httpMethod === "OPTIONS") return resposta(204, {});
  if (event.httpMethod !== "GET") return resposta(405, { erro: "Método não permitido." });
  const auth = await exigirUsuarioAprovado(event);
  if (!auth.ok) return resposta(auth.status, { erro: auth.erro });
  const filtro = validar(event.queryStringParameters || {});
  if (filtro.erro) return resposta(400, { erro: filtro.erro });
  try {
    const consultar = async (nivel, limite) => {
      const r = await fetch(montarConsulta(filtro, Date.now(), nivel, limite), {
        headers: { apikey: ANON, Authorization: event.headers?.authorization || event.headers?.Authorization, Accept: "application/json" },
        signal: globalThis.AbortSignal.timeout(10000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const lote = await r.json();
      if (!Array.isArray(lote)) throw new Error("resposta inválida");
      return nivel === "espec" ? lote.map((l) => ({ ...l, so_especificacao: true })) : lote;
    };
    // Sem palavras é uma consulta só. Com palavras, nome primeiro e especificação por último (no máximo 3 subrequisições).
    const linhas = [];
    for (const nivel of filtro.palavras.length ? NIVEIS : [null]) {
      if (linhas.length > LIMITE) break;
      linhas.push(...(await consultar(nivel, LIMITE + 1 - linhas.length)));
    }
    const coletadoEm = linhas.reduce((m, l) => (l.coletado_em > m ? l.coletado_em : m), "") || null;
    return resposta(200, { tipo: filtro.tipo, linhas: linhas.slice(0, LIMITE), limite: LIMITE, truncado: linhas.length > LIMITE, coletadoEm });
  } catch (e) {
    console.warn("prospeccao:", e.message);
    return resposta(503, { erro: "Não foi possível consultar a prospecção agora. Tente de novo em instantes." });
  }
};
exports.validar = validar;
exports.montarConsulta = montarConsulta;
