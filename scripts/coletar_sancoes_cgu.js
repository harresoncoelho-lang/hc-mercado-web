// Robô diário: sanções de empresas do CEIS e do CNEP (CGU), grátis e sem chave.
//   node scripts/coletar_sancoes_cgu.js
//
// Fonte: ZIP diário em dadosabertos-download.cgu.gov.br (ver _historico/pente-fino-pncp/03-sistemas-integrados.md,
// ficha 10). Só o arquivo do dia fica no ar (datas antigas dão 403) e o do dia novo aparece em algum momento da
// madrugada/manhã; por isso o robô tenta o dia de hoje (Brasília) e, se der 403/404, o de ontem.
// CSV: Windows-1252, separador ";", campos entre aspas, CRLF.
//
// LGPD: só pessoa jurídica (CNPJ de 14 dígitos) é gravada. Linhas de pessoa física (CPF, nome) são descartadas
// na leitura e nunca saem da memória do robô. "OBSERVAÇÕES" e "NOME INFORMADO PELO ÓRGÃO" também não são gravados
// (texto livre, pode citar sócio ou servidor).
//
// Histórico: o que sumiu do arquivo do dia fica com fora_da_lista = true (e a data), e volta a false se reaparecer.
// Prazo de guarda (politica-privacidade.html): fora da lista há mais de 5 anos é apagado (RPC sancoes_empresas_expurgar).
// Arquivo já carregado (mesma data ou mais antiga) é pulado: rodar duas vezes no dia é seguro.
// Arquivo com linha inválida (layout quebrado) grava o que leu, mas não marca sumiço naquele dia.
//
// Variáveis (todas opcionais):
//   SUPABASE_SERVICE_ROLE_KEY  obrigatória para gravar (scripts/supabase_dados.js)
//   DATA_ARQUIVO               AAAAMMDD fixo (só esse dia, sem cair para ontem)
//   TENTATIVAS                 3 por arquivo (falha de rede/5xx; 403/404 não repete)
//   PAUSA_TENTATIVA_MS         20000
//   TAMANHO_LOTE_BANCO         500
//   FRACAO_MINIMA              0.5 — se o arquivo novo tiver menos que isso das sanções ativas, não marca sumiço
const zlib = require("node:zlib");
const AdmZip = require("adm-zip");
const { restFetch, upsertEmLotes } = require("./supabase_dados");
const { semCpf } = require("../netlify/functions/_cpf");

const BASE = "https://dadosabertos-download.cgu.gov.br/PortalDaTransparencia/saida";
const CADASTROS = ["CEIS", "CNEP"];
const MAX_BYTES_ZIP = 100 * 1024 * 1024;
const MAX_BYTES_CSV = 4 * MAX_BYTES_ZIP;
const MAX_FUNDAMENTACAO = 1000;
const TABELA = "sancoes_empresas";

const num = (v, padrao) => (Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : padrao);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// AAAAMMDD do dia em Brasília (UTC-3 fixo, sem horário de verão desde 2019), deslocado em dias.
function diaBrasilia(agora = Date.now(), deslocamento = 0) {
  return new Date(agora - 3 * 36e5 + deslocamento * 864e5).toISOString().slice(0, 10).replaceAll("-", "");
}

// CSV com aspas: ";" separa, "" é aspa literal, quebra de linha dentro de aspas faz parte do campo.
function lerCsv(texto) {
  const linhas = [];
  let campo = "", linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ";") { linha.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo); campo = "";
      if (linha.length > 1 || linha[0] !== "") linhas.push(linha);
      linha = [];
    } else campo += c;
  }
  if (campo !== "" || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

// "16/12/2021" -> "2021-12-16"; vazio ou inválido -> null.
function dataIso(v) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((v || "").trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}
// "135408,18" -> 135408.18 (milhar com ponto, se vier).
function valorBr(v) {
  const t = (v || "").trim().replace(/\./g, "").replace(",", ".");
  return t && Number.isFinite(Number(t)) ? Number(t) : null;
}
const txt = (v, max = 500) => { const t = (v || "").trim(); return t && t !== "Sem Informação" ? t.slice(0, max) : null; };
// Razão social de MEI traz o CPF do titular ("FULANA DE TAL 97048143215"): o CPF sai, o resto é público.
const nome = (v) => txt(semCpf(v, " ").replace(/\s+/g, " "), 300);

// Bytes do CSV (Windows-1252) -> { linhas (só PJ, prontas para gravar), descartadasPF, invalidas }.
function lerSancoes(bytes, cadastroEsperado, dataCarga) {
  const texto = new TextDecoder("windows-1252").decode(bytes);
  const [cabecalho, ...registros] = lerCsv(texto);
  const col = (nome) => {
    const i = cabecalho.indexOf(nome);
    if (i < 0) throw new Error(`${cadastroEsperado}: coluna "${nome}" ausente (layout da CGU mudou?)`);
    return i;
  };
  const c = {
    cadastro: col("CADASTRO"), codigo: col("CÓDIGO DA SANÇÃO"), tipoPessoa: col("TIPO DE PESSOA"), doc: col("CPF OU CNPJ DO SANCIONADO"),
    nome: col("NOME DO SANCIONADO"), razao: col("RAZÃO SOCIAL - CADASTRO RECEITA"), processo: col("NÚMERO DO PROCESSO"),
    categoria: col("CATEGORIA DA SANÇÃO"), inicio: col("DATA INÍCIO SANÇÃO"), fim: col("DATA FINAL SANÇÃO"), publicacao: col("DATA PUBLICAÇÃO"),
    abrangencia: col("ABRAGÊNCIA DA SANÇÃO"), orgao: col("ÓRGÃO SANCIONADOR"), uf: col("UF ÓRGÃO SANCIONADOR"),
    esfera: col("ESFERA ÓRGÃO SANCIONADOR"), fundamentacao: col("FUNDAMENTAÇÃO LEGAL"),
  };
  const iMulta = cabecalho.indexOf("VALOR DA MULTA");
  const porChave = new Map();
  let descartadasPF = 0, invalidas = 0;
  for (const r of registros) {
    if (r.length < cabecalho.length) { invalidas++; continue; }
    const cnpj = (r[c.doc] || "").replace(/\D/g, "");
    // PF fora já aqui: nada de CPF/nome de pessoa física segue adiante.
    if (r[c.tipoPessoa] !== "J" || cnpj.length !== 14) { descartadasPF++; continue; }
    const codigo = (r[c.codigo] || "").trim();
    if (r[c.cadastro] !== cadastroEsperado || !/^\d{1,40}$/.test(codigo)) { invalidas++; continue; }
    porChave.set(codigo, {
      cadastro: cadastroEsperado,
      codigo_sancao: codigo,
      cnpj,
      razao_social: nome(r[c.razao]) || nome(r[c.nome]),
      tipo_sancao: txt(r[c.categoria], 300),
      orgao_sancionador: txt(r[c.orgao], 300),
      uf_orgao: /^[A-Z]{2}$/.test((r[c.uf] || "").trim()) ? r[c.uf].trim() : null,
      esfera_orgao: txt(r[c.esfera], 60),
      abrangencia: txt(r[c.abrangencia], 300),
      data_inicio: dataIso(r[c.inicio]),
      data_fim: dataIso(r[c.fim]),
      data_publicacao: dataIso(r[c.publicacao]),
      fundamentacao: txt(r[c.fundamentacao], MAX_FUNDAMENTACAO),
      numero_processo: txt(r[c.processo], 200),
      valor_multa: iMulta >= 0 ? valorBr(r[iMulta]) : null,
      data_carga: dataCarga,
      fora_da_lista: false,
      fora_da_lista_em: null,
    });
  }
  return { linhas: [...porChave.values()], descartadasPF, invalidas };
}

// Descompacta com teto no tamanho REAL (o header do ZIP pode mentir: zip-bomb). Exportada para outros robôs.
function inflarComTeto(entrada, max) {
  const dados = entrada.getCompressedData();
  if (entrada.header.method === 0) {
    if (dados.length > max) throw new Error("CSV grande demais");
    return dados;
  }
  if (entrada.header.method !== 8) throw new Error(`compressão ${entrada.header.method} não suportada`);
  let saida;
  try { saida = zlib.inflateRawSync(dados, { maxOutputLength: max }); } catch (e) {
    if (e.code === "ERR_BUFFER_TOO_LARGE" || e instanceof RangeError) throw new Error("CSV grande demais");
    throw e;
  }
  if (saida.length !== entrada.header.size || zlib.crc32(saida) !== entrada.header.crc >>> 0) throw new Error("CSV corrompido (tamanho/CRC não batem com o ZIP)");
  return saida;
}

// ZIP (Buffer) -> bytes do único .csv dentro.
function csvDoZip(buf, max = MAX_BYTES_CSV) {
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) throw new Error("resposta não é ZIP");
  const entradas = new AdmZip(buf).getEntries().filter((e) => !e.isDirectory && /\.csv$/i.test(e.entryName));
  if (entradas.length !== 1) throw new Error(`ZIP com ${entradas.length} CSV (esperado 1)`);
  if (entradas[0].header.size > max) throw new Error("CSV grande demais");
  return inflarComTeto(entradas[0], max);
}

// Corpo da resposta com teto: recusa pelo Content-Length e, se o servidor não mandar ou mentir, para de ler no teto.
async function corpoComTeto(r, max) {
  const declarado = Number(r.headers?.get?.("content-length"));
  if (declarado > max) throw new Error("download grande demais");
  if (!r.body?.getReader) { const b = Buffer.from(await r.arrayBuffer()); if (b.length > max) throw new Error("download grande demais"); return b; }
  const leitor = r.body.getReader(), pedacos = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.length;
    if (total > max) { await leitor.cancel().catch(() => {}); throw new Error("download grande demais"); }
    pedacos.push(value);
  }
  return Buffer.concat(pedacos);
}

// Baixa o ZIP do dia; null se a CGU responde 403/404 (arquivo do dia ainda não saiu ou já saiu do ar).
async function baixarZip(cadastro, dia, { fetch = globalThis.fetch, tentativas = 3, pausaMs = 20000 } = {}) {
  const url = `${BASE}/${cadastro.toLowerCase()}/${dia}_${cadastro}.zip`;
  for (let t = 1; ; t++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; LicitaPlena-robo)" }, signal: globalThis.AbortSignal.timeout(180000) });
      if (r.status === 403 || r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await corpoComTeto(r, MAX_BYTES_ZIP);
    } catch (e) {
      if (t >= tentativas) throw new Error(`${url}: ${e.message}`);
      console.warn(`${cadastro} ${dia}: tentativa ${t} falhou (${e.message}); de novo em ${pausaMs} ms`);
      await esperar(pausaMs);
    }
  }
}

// Banco: o que já existe para o cadastro (data mais recente e quantas ativas).
async function estadoAtual(cadastro, rest) {
  const r = await rest(`${TABELA}?cadastro=eq.${cadastro}&select=data_carga&order=data_carga.desc&limit=1`);
  const ultima = (await r.json())[0]?.data_carga || null;
  const r2 = await rest(`${TABELA}?cadastro=eq.${cadastro}&fora_da_lista=eq.false&select=codigo_sancao&limit=1`, { headers: { Prefer: "count=exact", Range: "0-0" } });
  const total = Number((r2.headers.get("content-range") || "").split("/")[1]);
  return { ultima, ativas: Number.isFinite(total) ? total : 0 };
}

// Um cadastro: baixa, lê, grava e marca sumiço. Devolve um resumo para o log.
async function coletarCadastro(cadastro, dias, deps) {
  const { rest, upsert, fracaoMinima, tamanhoLote } = deps;
  let dia = null, zip = null;
  for (const d of dias) { zip = await baixarZip(cadastro, d, deps); if (zip) { dia = d; break; } }
  if (!zip) throw new Error(`${cadastro}: nenhum arquivo disponível (${dias.join(", ")})`);
  const dataCarga = `${dia.slice(0, 4)}-${dia.slice(4, 6)}-${dia.slice(6)}`;
  const antes = await estadoAtual(cadastro, rest);
  if (antes.ultima && antes.ultima >= dataCarga) return `${cadastro} ${dataCarga}: já carregado (última carga ${antes.ultima}), nada a fazer`;
  const { linhas, descartadasPF, invalidas } = lerSancoes(csvDoZip(zip), cadastro, dataCarga);
  if (!linhas.length) throw new Error(`${cadastro} ${dataCarga}: arquivo sem nenhuma pessoa jurídica; nada gravado`);
  await upsert(TABELA, linhas, "cadastro,codigo_sancao", tamanhoLote);
  // Linha inválida = arquivo quebrado ou layout mudou: a sanção dela pode estar ali e não ter sido lida.
  if (invalidas) throw new Error(`${cadastro} ${dataCarga}: ${linhas.length} PJ gravadas, ${invalidas} linha(s) inválida(s); sumiço NÃO marcado (conferir o arquivo)`);
  // Arquivo muito menor que o histórico ativo = provável arquivo truncado: grava, mas não marca sumiço.
  if (antes.ativas && linhas.length < antes.ativas * fracaoMinima) {
    throw new Error(`${cadastro} ${dataCarga}: ${linhas.length} PJ contra ${antes.ativas} ativas; sumiço NÃO marcado (conferir o arquivo)`);
  }
  const r = await rest(`${TABELA}?cadastro=eq.${cadastro}&data_carga=lt.${dataCarga}&fora_da_lista=eq.false`, {
    method: "PATCH", headers: { Prefer: "return=minimal,count=exact" },
    body: JSON.stringify({ fora_da_lista: true, fora_da_lista_em: new Date().toISOString() }),
  });
  const sumiram = Number((r.headers.get("content-range") || "").split("/")[1]) || 0;
  return `${cadastro} ${dataCarga}: ${linhas.length} PJ gravadas, ${descartadasPF} PF descartadas, ${invalidas} inválidas, ${sumiram} fora da lista`;
}

async function main(env = process.env, deps = {}) {
  const fixa = env.DATA_ARQUIVO;
  if (fixa && !/^\d{8}$/.test(fixa)) throw new Error("DATA_ARQUIVO deve ser AAAAMMDD");
  const dias = fixa ? [fixa] : [diaBrasilia(), diaBrasilia(Date.now(), -1)];
  const opcoes = {
    rest: restFetch, upsert: upsertEmLotes, fetch: globalThis.fetch,
    tentativas: num(env.TENTATIVAS, 3), pausaMs: num(env.PAUSA_TENTATIVA_MS, 20000),
    tamanhoLote: num(env.TAMANHO_LOTE_BANCO, 500), fracaoMinima: num(env.FRACAO_MINIMA, 0.5), ...deps,
  };
  const erros = [];
  for (const cadastro of CADASTROS) {
    try { console.log(await coletarCadastro(cadastro, dias, opcoes)); } catch (e) { erros.push(e.message); console.error(e.message); }
  }
  // Prazo de guarda: fora da lista há mais de 5 anos sai (a função no banco decide o corte).
  try { console.log(`sanções expurgadas (fora da lista > 5 anos): ${await (await opcoes.rest("rpc/sancoes_empresas_expurgar", { method: "POST", body: "{}" })).json()}`); }
  catch (e) { erros.push(e.message); console.error(e.message); }
  if (erros.length) throw new Error(`${erros.length} etapa(s) com falha`);
}

if (require.main === module) main().catch((e) => { console.error("coletar_sancoes_cgu:", e.message); process.exit(1); });

module.exports = { lerCsv, lerSancoes, csvDoZip, inflarComTeto, corpoComTeto, baixarZip, coletarCadastro, diaBrasilia, dataIso, valorBr, main };
