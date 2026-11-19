// Robô mensal do SINAPI: baixa a referência mais recente da CAIXA e grava a tabela sinapi_precos
// (supabase/sinapi.sql) com insumos e composições de cada UF pedida, desonerado e não desonerado.
//   node scripts/coletar_sinapi.js
//
// Fonte: página de downloads da CAIXA (caixa.gov.br/sinapi -> Relatórios Mensais -> "Relatórios a partir de 2025").
// Grátis, sem cadastro, sem login, sem captcha. Um ZIP por mês com todas as UFs:
//   https://www.caixa.gov.br/Downloads/sinapi-relatorios-mensais/SINAPI-AAAA-MM-formato-xlsx.zip  (~16 MB)
// Retificação sai com sufixo "_Retificacao01", "_Retificacao02"... (ex.: 2026-01 e 2026-02). Mês ainda não publicado
// responde 302 (redireciona para uma página de erro), por isso a sondagem é HEAD sem seguir redirecionamento.
// Dentro do ZIP, SINAPI_Referência_AAAA_MM.xlsx tem as abas ISD/ICD (insumos sem/com desoneração) e CSD/CCD
// (composições sem/com desoneração), cada UF numa coluna (linha 4 do cabeçalho). ISE/CSE (sem encargos) ficam de fora.
// O xlsx é lido direto do XML (adm-zip, já dependência): sem biblioteca nova.
//
// Rodar de novo é seguro: upsert pela chave (uf, tipo, desonerado, codigo); depois, por UF, apaga o que ficou com
// referência anterior (código que saiu do SINAPI). Preço em branco (sem coleta no mês para a UF) não é gravado.
//
// Variáveis:
//   SUPABASE_SERVICE_ROLE_KEY  obrigatória para gravar (scripts/supabase_dados.js)
//   SINAPI_UFS                 "AM" (lista separada por vírgula)
//   SINAPI_MESES_ATRAS         6 — quantos meses voltar procurando a última referência publicada
//   SINAPI_REFERENCIA          opcional "AAAA-MM" — força um mês (sem sondar)
//   TAMANHO_LOTE_BANCO         500
const AdmZip = require("adm-zip");
const { restFetch, upsertEmLotes } = require("./supabase_dados");

const BASE = "https://www.caixa.gov.br/Downloads/sinapi-relatorios-mensais/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const TABELA = "sinapi_precos";
const UFS = new Set("AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split(" "));
// Aba -> o que ela é. Nomes fixos do arquivo da CAIXA desde 2025.
const ABAS = { ISD: { tipo: "insumo", desonerado: false }, ICD: { tipo: "insumo", desonerado: true }, CSD: { tipo: "composicao", desonerado: false }, CCD: { tipo: "composicao", desonerado: true } };
const PRIMEIRA_LINHA_DADOS = 11;

const num = (v, padrao) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : padrao);
const ENTIDADES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const xmlTexto = (s) => String(s).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTIDADES[e] ?? m);
const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// "AAAA-MM" dos últimos n meses, do mais recente para o mais antigo (mês atual primeiro).
function mesesParaTras(agora, n) {
  const d = new Date(agora), out = [];
  for (let i = 0; i < n; i++) out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  return out;
}
// Nomes a sondar para um mês: retificação mais alta primeiro (ela substitui a original).
const nomesDoMes = (mes) => [3, 2, 1].map((r) => `SINAPI-${mes}-formato-xlsx_Retificacao0${r}.zip`).concat(`SINAPI-${mes}-formato-xlsx.zip`);

async function existe(url) {
  const r = await fetch(url, { method: "HEAD", redirect: "manual", headers: { "user-agent": UA }, signal: globalThis.AbortSignal.timeout(30000) });
  return r.status === 200;
}
async function acharReferencia(agora = Date.now()) {
  const forcado = process.env.SINAPI_REFERENCIA;
  if (forcado) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(forcado)) throw new Error("SINAPI_REFERENCIA deve ser AAAA-MM.");
    for (const nome of nomesDoMes(forcado)) if (await existe(BASE + nome)) return { mes: forcado, url: BASE + nome };
    throw new Error(`SINAPI ${forcado} não encontrado na CAIXA.`);
  }
  for (const mes of mesesParaTras(agora, num(process.env.SINAPI_MESES_ATRAS, 6))) {
    for (const nome of nomesDoMes(mes)) if (await existe(BASE + nome)) return { mes, url: BASE + nome };
  }
  throw new Error("Nenhuma referência SINAPI encontrada nos últimos meses. Confira a página de downloads da CAIXA.");
}

// ---------- leitura do xlsx (XML) ----------
function textosCompartilhados(xml) {
  return [...String(xml || "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlTexto([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
}
// Nome da aba -> caminho do XML dentro do xlsx (workbook.xml + rels).
function mapaAbas(workbookXml, relsXml) {
  const alvo = Object.fromEntries([...relsXml.matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2].replace(/^\/?(xl\/)?/, "xl/")]));
  return Object.fromEntries([...workbookXml.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map((m) => [xmlTexto(m[1]), alvo[m[2]]]));
}
const coluna = (ref) => ref.replace(/[0-9]+$/, "");
// Linhas da aba: [{ n, celulas: { A: "...", B: "..." } }]. Código de composição vem numa fórmula HYPERLINK(...,104658)
// com valor em cache 0: nesse caso o código sai do último argumento da fórmula.
function* linhasDaAba(xml, compartilhados) {
  for (const r of xml.matchAll(/<row [^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const celulas = {};
    for (const c of r[2].matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, ref, attr, corpo = ""] = c;
      const v = /<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1];
      let valor = v === undefined ? "" : xmlTexto(v);
      if (/t="s"/.test(attr) && v !== undefined) valor = compartilhados[Number(v)] ?? "";
      else if (/t="inlineStr"/.test(attr)) valor = xmlTexto([...corpo.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
      const f = /<f>HYPERLINK\([\s\S]*,\s*(\d+)\)<\/f>/.exec(corpo);
      if (f) valor = f[1];
      if (valor !== "") celulas[coluna(ref)] = valor;
    }
    yield { n: Number(r[1]), celulas };
  }
}
// Linhas da tabela para uma UF. Insumo: A classificação, B código, C descrição, D unidade, E origem, coluna da UF = preço.
// Composição: A grupo, B código, C descrição, D unidade, coluna da UF = custo. A coluna da UF vem da linha 4.
function linhasParaUf(xml, compartilhados, aba, uf, referencia, coletadoEm) {
  const { tipo, desonerado } = ABAS[aba];
  let col = null;
  const out = [];
  for (const { n, celulas } of linhasDaAba(xml, compartilhados)) {
    if (n === 4) col = Object.keys(celulas).find((k) => celulas[k].trim() === uf) || null;
    if (n < PRIMEIRA_LINHA_DADOS) continue;
    if (!col) throw new Error(`Aba ${aba}: coluna da UF ${uf} não encontrada no cabeçalho (linha 4). O layout da CAIXA mudou?`);
    const codigo = String(celulas.B || "").trim(), preco = Number(celulas[col]);
    const descricao = String(celulas.C || "").trim().slice(0, 2000);
    if (!/^[0-9]{1,10}$/.test(codigo) || !descricao || !(preco > 0)) continue;
    out.push({
      uf, tipo, desonerado, codigo, descricao,
      unidade: String(celulas.D || "").trim().slice(0, 30) || null,
      grupo: String(celulas.A || "").trim().slice(0, 200) || null,
      origem: tipo === "insumo" ? String(celulas.E || "").trim().slice(0, 10) || null : null,
      preco: (Math.round(preco * 100) / 100).toFixed(2),
      referencia: `${referencia}-01`, busca: semAcento(descricao).slice(0, 2000), coletado_em: coletadoEm,
    });
  }
  return out;
}
function abrirReferencia(zipBuffer) {
  const entrada = new AdmZip(zipBuffer).getEntries().find((e) => /^SINAPI_Refer.*\.xlsx$/i.test(e.entryName.split("/").pop()));
  if (!entrada) throw new Error("ZIP do SINAPI sem o arquivo SINAPI_Referência_*.xlsx. O formato da CAIXA mudou?");
  const xlsx = new AdmZip(entrada.getData());
  const ler = (caminho) => xlsx.getEntry(caminho)?.getData().toString("utf8") ?? null;
  const abas = mapaAbas(ler("xl/workbook.xml") || "", ler("xl/_rels/workbook.xml.rels") || "");
  for (const a of Object.keys(ABAS)) if (!abas[a]) throw new Error(`Aba ${a} não encontrada no SINAPI_Referência. O formato da CAIXA mudou?`);
  return { compartilhados: textosCompartilhados(ler("xl/sharedStrings.xml")), lerAba: (a) => ler(abas[a]) };
}

async function main() {
  const ufs = String(process.env.SINAPI_UFS || "AM").split(",").map((u) => u.trim().toUpperCase()).filter(Boolean);
  for (const uf of ufs) if (!UFS.has(uf)) throw new Error(`UF inválida em SINAPI_UFS: ${uf}`);
  const lote = num(process.env.TAMANHO_LOTE_BANCO, 500);
  const ref = await acharReferencia();
  console.log(`SINAPI ${ref.mes}: ${ref.url}`);
  const r = await fetch(ref.url, { headers: { "user-agent": UA }, signal: globalThis.AbortSignal.timeout(300000) });
  if (!r.ok) throw new Error(`Download do SINAPI falhou: HTTP ${r.status}`);
  const pacote = abrirReferencia(Buffer.from(await r.arrayBuffer()));
  const coletadoEm = new Date().toISOString();
  for (const uf of ufs) {
    let total = 0;
    for (const aba of Object.keys(ABAS)) {
      const linhas = linhasParaUf(pacote.lerAba(aba), pacote.compartilhados, aba, uf, ref.mes, coletadoEm);
      if (!linhas.length) throw new Error(`Aba ${aba} sem linhas para ${uf}: nada gravado desta aba.`);
      total += await upsertEmLotes(TABELA, linhas, "uf,tipo,desonerado,codigo", lote);
    }
    // Só depois de gravar todas as abas da UF: falha no meio não apaga a referência anterior.
    await restFetch(`${TABELA}?uf=eq.${uf}&referencia=lt.${ref.mes}-01`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    console.log(`${uf}: ${total} linhas gravadas (referência ${ref.mes}).`);
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { mesesParaTras, nomesDoMes, textosCompartilhados, mapaAbas, linhasDaAba, linhasParaUf, semAcento, xmlTexto };
