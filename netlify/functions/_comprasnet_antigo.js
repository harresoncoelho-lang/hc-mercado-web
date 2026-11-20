// ComprasNet antigo (pregões eletrônicos até 2023): páginas PÚBLICAS e SEM captcha do portal comprasnet.gov.br.
// Mapa: _historico/mapa-comprasnet-antigo-20261119.md. Lidas por UASG + número (não precisa do filtro de período):
//   ata4.asp (POST)                    lista -> confirma que o pregão existe e dá a data de realização
//   ata2.asp                           página do pregão -> acha o prgcod
//   FornecedorResultadoDecreto.asp     vencedores por item/grupo: valores, MARCA, fabricante, modelo, descrição ofertada
//   termojulg.asp?Acao=A               adjudicação por item: situação, vencedor, lance, motivo de cancelamento, recurso
// NUNCA abre AtaEletronico.asp: ela só abre com captcha de imagem, e o próprio portal diz que o captcha existe "para
// evitar a consulta por programas automáticos". Essa parte só entra pela extensão, com a pessoa na frente.
// Cortesia com o portal: pausa mínima de 1,5 s entre páginas (inclusive entre pregões), timeout, teto de bytes e
// de páginas por chamada. Tudo em https (o portal serve os dois; o cert é válido). Páginas em ISO-8859-1.
// CPF nunca sai daqui: nome de MEI/pessoa física passa por fornecedor() e o texto livre por semCpf.
const { semCpf } = require("./_cpf");

const BASE = "https://www.comprasnet.gov.br/livre/pregao";
const PAUSA_MINIMA_MS = 1500;
const TIMEOUT_MS = 20000;
const MAX_BYTES = 3 * 1024 * 1024;
const UA = "LicitaPlena/1.0 (leitura de paginas publicas; contato licitaplena.site@gmail.com)";

const ENTIDADES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", agrave: "À", Agrave: "À" };
const decodificar = (s) => String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " "; }
  return ENTIDADES[e] ?? ENTIDADES[e.toLowerCase()] ?? m;
});
const limpar = (s) => decodificar(String(s).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const texto = (v, max) => (v === null || v === undefined ? null : semCpf(String(v), " ").replace(/\s+/g, " ").trim().slice(0, max) || null);
// "R$ 1.471,2000" / "2.800" -> número; "-" ou vazio -> null.
const numeroBr = (s) => {
  const m = /-?\d{1,3}(?:\.\d{3})*(?:,\d+)?|-?\d+(?:,\d+)?/.exec(String(s ?? ""));
  if (!m || /^\s*-\s*$/.test(String(s))) return null;
  const n = Number(m[0].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const dataIso = (s) => { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s || "")); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const perto = (a, b) => a !== null && b !== null && Math.abs(a - b) <= Math.max(0.011, Math.abs(b) * 1e-6);
const digitos = (v) => String(v ?? "").replace(/\D/g, "");

// ---------- listas ----------
// ata4.asp: [{ tipo, numprp, uasg, modalidade, data }]; numprp = número sem zeros + ano (23/2022 -> "232022").
function lerLista(html) {
  const linhas = [];
  for (const m of String(html).matchAll(/<tr[^>]*>(?:(?!<\/tr>)[\s\S])*?Dados_Ata\('([EP])',\s*'(\d+)',\s*'(\d+)',\s*'(\d+)'\)(?:(?!<\/tr>)[\s\S])*<\/tr>/gi)) {
    linhas.push({ tipo: m[1], numprp: m[2], uasg: m[3], modalidade: Number(m[4]), data: dataIso(limpar(m[0])) });
  }
  return linhas;
}
// ata2.asp -> prgcod do pregão (aparece nos links de recursos, anexos e termos).
const lerPrgcod = (html) => /prgcod=(\d{3,12})/i.exec(String(html))?.[1] || null;

// ---------- Resultado por Fornecedor ----------
// -> [{ ni, nome, linhas: [{ numero|null, grupo|null, descricao, unidade, quantidade, criterio, unitario, global, marca, fabricante, modelo, ofertado }] }]
function lerFornecedores(html) {
  const saida = [];
  let atual = null, ultima = null;
  for (const m of String(html).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const corpo = m[1];
    const forn = /<b>\s*([\d./-]{11,18})\s*<\/b>\s*-\s*([^<]*)/i.exec(corpo);
    if (forn && !/<td[^>]*>[\s\S]*<td/i.test(corpo)) {
      atual = { ni: digitos(forn[1]), nome: limpar(forn[2]), linhas: [] };
      saida.push(atual); ultima = null;
      continue;
    }
    if (!atual) continue;
    const tds = [...corpo.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => x[1]);
    if (tds.length === 7 && !/^Item$/i.test(limpar(tds[0])) && !/Total do Fornecedor/i.test(corpo)) {
      const [c0, c1, c2, c3, c4, c5, c6] = tds.map(limpar);
      const grupo = /^Grupo\s+\d+/i.test(c1) ? c1 : null;
      ultima = { numero: /^\d{1,5}$/.test(c0) ? Number(c0) : null, grupo, descricao: c1, unidade: /^-?$/.test(c2) ? null : c2, quantidade: numeroBr(c3),
        criterio: numeroBr(c4), unitario: numeroBr(c5), global: numeroBr(c6), marca: null, fabricante: null, modelo: null, ofertado: null };
      atual.linhas.push(ultima);
      continue;
    }
    if (ultima && tds.length === 1 && /tex5b/.test(corpo)) {
      for (const par of corpo.matchAll(/<span class="tex5b">([\s\S]*?)<\/span>\s*<span class="tex5a">([\s\S]*?)<\/span>/gi)) {
        const rotulo = limpar(par[1]).replace(/:$/, "").toLowerCase(), valor = texto(limpar(par[2]), 600) || null;
        if (rotulo === "marca") ultima.marca = valor;
        else if (rotulo === "fabricante") ultima.fabricante = valor;
        else if (rotulo.startsWith("modelo")) ultima.modelo = valor;
        else if (rotulo.startsWith("descrição detalhada")) ultima.ofertado = valor;
      }
    }
  }
  return saida;
}

// ---------- Termo de adjudicação ----------
// -> [{ numero, grupo, descricao, quantidade, unidade, estimado, situacao, motivo, tem_recurso, ni, nome, lance, qtd_lance }]
function lerTermo(html) {
  const t = limpar(html).replace(/Atenção: Clique em .*$/i, "").replace(/Aguarde!\s*$/i, "");
  const partes = t.split(/\bItem:\s*(\d{1,5})(?:\s*-\s*(Grupo\s+\d+))?\s+Descrição:/);
  const itens = [];
  // partes[0] = cabeçalho; depois triplas (número, grupo, corpo).
  for (let i = 1; i + 2 < partes.length; i += 3) {
    const corpo = partes[i + 2] || "";
    const [antes, eventos = ""] = corpo.split(/Eventos do Item/);
    const sit = /Situação:\s*(.*?)(?=\s*Adjudicado para:|\s*$)/.exec(antes);
    const adj = /Adjudicado para:\s*(.*?)\s*,?\s*pelo melhor lance de\s*R\$\s*([\d.,]+)(?:\s*e a quantidade de\s*([\d.,]+))?/.exec(antes);
    const cnpj = /CNPJ\/CPF:\s*([\d./-]+)/.exec(eventos);
    const motivo = /Motivo:\s*(.+)$/.exec(eventos);
    itens.push({
      numero: Number(partes[i]), grupo: partes[i + 1] || null,
      descricao: texto(/^(.*?)\s*Descrição Complementar:/.exec(corpo)?.[1] ?? corpo.slice(0, 200), 300),
      quantidade: numeroBr(/Quantidade:\s*([\d.,]+)/.exec(antes)?.[1]), unidade: texto(/Unidade de fornecimento:\s*(.*?)\s*(?:Valor|Intervalo|Situação)/.exec(antes)?.[1], 60),
      estimado: numeroBr(/Valor (?:Estimado|Máximo Aceitável|de Referência):\s*R\$\s*([\d.,]+)/.exec(antes)?.[1]),
      situacao: texto(sit?.[1], 80), motivo: texto(motivo?.[1], 1000), tem_recurso: /recurso/i.test(`${sit?.[1] || ""} ${eventos}`),
      ni: cnpj ? digitos(cnpj[1]) : null, nome: adj ? texto(adj[1], 300) : null, lance: adj ? numeroBr(adj[2]) : null, qtd_lance: adj ? numeroBr(adj[3]) : null,
    });
  }
  return itens;
}

// ---------- junção ----------
// termo (por item) + fornecedores (marca, unitário) -> item a item. Valor unitário: o do Resultado por Fornecedor quando
// o item aparece lá; senão o "melhor lance" do termo, que é unitário (conferido: em grupo, a soma lance x qtd bate com o
// total do grupo). Exceção conferida (INPA 13/2022): o termo traz o valor total do item; então lance = global e != unitário.
function juntar(termo, fornecedores) {
  const porItem = new Map();
  for (const f of fornecedores) for (const l of f.linhas) if (l.numero) porItem.set(`${l.numero}|${f.ni}`, { ...l, ni: f.ni, nomeForn: f.nome });
  const itens = new Map();
  for (const it of termo) {
    const f = it.ni ? porItem.get(`${it.numero}|${it.ni}`) : null;
    const q = it.qtd_lance ?? it.quantidade;
    const totais = Boolean(f) && q > 1 && perto(it.lance, f.global) && !perto(it.lance, f.unitario);
    const unitario = f?.unitario ?? (it.lance !== null && q > 0 ? (totais ? it.lance / q : it.lance) : null);
    itens.set(it.numero, { ...it, valor_unitario: unitario === null ? null : Math.round(unitario * 10000) / 10000,
      valor_estimado: it.estimado !== null && it.quantidade > 0 ? Math.round((totais ? it.estimado / it.quantidade : it.estimado) * 10000) / 10000 : null,
      marca: f?.marca ?? null, fabricante: f?.fabricante ?? null, modelo: f?.modelo ?? null, ofertado: texto(f?.ofertado, 600), nomeForn: f?.nomeForn || null });
  }
  return itens;
}

// ---------- rede ----------
class ErroComprasNet extends Error {}
function criarLeitor({ fetchImpl = (...a) => fetch(...a), esperar = (ms) => new Promise((r) => setTimeout(r, ms)), pausaMs = PAUSA_MINIMA_MS, orcamento = 40, agora = Date.now } = {}) {
  const pausa = Math.max(PAUSA_MINIMA_MS, Number(pausaMs) || 0);
  let restante = orcamento, ultimo = null;
  const decodificador = new TextDecoder("windows-1252");
  return {
    get usadas() { return orcamento - restante; },
    async pagina(caminho, opcoes = {}) {
      // Defesa em profundidade: só as páginas deste módulo; a ata com captcha jamais.
      if (/AtaEletronico/i.test(caminho) || !/^\/(ata4|ata2|FornecedorResultadoDecreto|termojulg)\.asp(\?|$)/i.test(caminho)) throw new ErroComprasNet("Página fora da lista permitida.");
      if (restante <= 0) throw new ErroComprasNet("Orçamento de páginas do ComprasNet esgotado.");
      restante -= 1;
      if (ultimo !== null) { const falta = pausa - (agora() - ultimo); if (falta > 0) await esperar(falta); }
      ultimo = agora();
      const r = await fetchImpl(`${BASE}${caminho}`, { ...opcoes, headers: { "User-Agent": UA, Accept: "text/html", ...(opcoes.headers || {}) }, signal: globalThis.AbortSignal.timeout(TIMEOUT_MS) });
      if (!r.ok) throw Object.assign(new ErroComprasNet(`ComprasNet HTTP ${r.status}`), { status: r.status });
      if (Number(r.headers?.get?.("content-length")) > MAX_BYTES) throw new ErroComprasNet("Página grande demais.");
      const buf = await r.arrayBuffer();
      if (buf.byteLength > MAX_BYTES) throw new ErroComprasNet("Página grande demais.");
      return decodificador.decode(buf);
    },
  };
}

// Página pública do pregão (sem captcha): é o "abra o pregão" da tela. Só para pregão eletrônico fora da Lei 14.133.
const linkPregaoAntigo = ({ uasg, numero, ano }) => `${BASE}/ata2.asp?co_no_uasg=${uasg}&numprp=${Number(numero)}${ano}&codigoModalidade=5`;

/**
 * Lê um pregão antigo. ref: { uasg (6 dígitos), numero (como no id: 5 dígitos), ano }.
 * Devolve null se a lista não traz o pregão; lança se uma página falhar (o chamador decide).
 */
async function lerPregaoAntigo(ref, leitor = criarLeitor()) {
  const uasg = digitos(ref.uasg), numero = String(Number(ref.numero)), ano = String(ref.ano);
  if (!/^\d{5,6}$/.test(uasg) || !/^[1-9]\d{0,4}$/.test(numero) || !/^\d{4}$/.test(ano)) throw new ErroComprasNet("Referência de pregão inválida.");
  const numprp = `${numero}${ano}`;
  const corpo = new URLSearchParams({ rdTpPregao: "E", lstSrp: "T", lstICMS: "T", uf: "", co_uasg: uasg, txtlstUasg: "", numprp, dt_ini_sessao: "", dt_fim_sessao: "" });
  const lista = lerLista(await leitor.pagina("/ata4.asp", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: corpo.toString() }));
  const achado = lista.find((l) => l.uasg === uasg && l.numprp === numprp && l.modalidade === 5);
  if (!achado) return null;
  const prgcod = lerPrgcod(await leitor.pagina(`/ata2.asp?co_no_uasg=${uasg}&numprp=${numprp}&codigoModalidade=5`));
  if (!prgcod) return null;
  const fornecedores = lerFornecedores(await leitor.pagina(`/FornecedorResultadoDecreto.asp?prgcod=${prgcod}`));
  const termo = lerTermo(await leitor.pagina(`/termojulg.asp?prgcod=${prgcod}&Acao=A`));
  return { prgcod, data: achado.data, url: linkPregaoAntigo({ uasg, numero, ano }), itens: juntar(termo, fornecedores), fornecedores };
}

module.exports = { lerPregaoAntigo, linkPregaoAntigo, criarLeitor, lerLista, lerPrgcod, lerFornecedores, lerTermo, juntar, numeroBr, ErroComprasNet, PAUSA_MINIMA_MS, BASE, UA };
