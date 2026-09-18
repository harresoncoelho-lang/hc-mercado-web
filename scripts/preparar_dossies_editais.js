// Prepara antecipadamente os dossiês dos editais recém-coletados.
// Uso: node scripts/preparar_dossies_editais.js
// Env obrigatórias: DOSSIES_EDITAIS_CHAVE.
// Env opcionais: LICITAPLENA_URL (https://licitaplena.com.br), MAX_DOSSIES_POR_EXECUCAO (12),
// DIAS_PUBLICACAO_DOSSIE (3), SUPABASE_SERVICE_ROLE_KEY,
// VERSAO_DOSSIE (16) e REPROCESSAR_PARCIAL_APOS_HORAS (24).
//
// O cliente nunca deve precisar iniciar leitura de PDF/IA no clique. Este job chama a
// rota interna, que aproveita o cache persistente e só lê os documentos ainda ausentes.

const fs = require("fs");
const path = require("path");

const URL_SITE = (process.env.LICITAPLENA_URL || "https://licitaplena.com.br").replace(/\/$/, "");
const LIMITE = Math.max(1, Number(process.env.MAX_DOSSIES_POR_EXECUCAO || 12));
const DIAS = Math.max(1, Number(process.env.DIAS_PUBLICACAO_DOSSIE || 3));
const CONCORRENCIA = 1; // Uma etapa por vez respeita o orçamento compartilhado do provedor.
const VERSAO_DOSSIE = Math.max(1, Number(process.env.VERSAO_DOSSIE || 16));
const REPROCESSAR_PARCIAL_APOS_MS = Math.max(1, Number(process.env.REPROCESSAR_PARCIAL_APOS_HORAS || 24)) * 60 * 60 * 1000;
const SUPABASE_URL = "https://lsqjamqvmrcyrvowndiu.supabase.co";

function exigirChave() {
  if (!process.env.DOSSIES_EDITAIS_CHAVE) {
    throw new Error("DOSSIES_EDITAIS_CHAVE não configurada. Defina o mesmo segredo no GitHub Actions e no Netlify.");
  }
  return process.env.DOSSIES_EDITAIS_CHAVE;
}

function dataValida(valor) {
  const data = new Date(valor || 0);
  return Number.isNaN(data.getTime()) ? null : data;
}

function mapearEdital(registro) {
  return {
    objeto: registro.objeto || "",
    orgao: registro.orgao || "",
    uf: registro.uf || "",
    municipio: registro.municipio || "",
    encerramento: registro.encerramento || "",
    publicacao: registro.publicacao || "",
    numeroControlePNCP: registro.numeroControlePNCP || "",
    modalidade: registro.modalidadeNome || "",
    tipo: registro.tipoInstrumentoConvocatorioNome || "",
    amparoLegal: registro.amparoLegal || "",
    modoDisputa: registro.modoDisputaNome || "",
    srp: registro.srp,
    valorEstimado: registro.valorTotalEstimado,
    numero: registro.numeroCompra || "",
    ano: registro.anoCompra || "",
    processo: registro.processo || "",
    uasg: registro.codigoUnidade || "",
  };
}

async function prepararUm(registro) {
  const resposta = await fetch(`${URL_SITE}/.netlify/functions/ia-edital`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-licitaplena-dossies-chave": exigirChave(),
    },
    body: JSON.stringify({ modo: "resumo", edital: mapearEdital(registro) }),
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok || corpo.erro) throw new Error(corpo.erro || `HTTP ${resposta.status}`);
  if (resposta.status === 202 || corpo.emProcessamento) return "pendente";
  return corpo.doCache ? "reaproveitado" : "gerado";
}

function dividirEmLotes(lista, tamanho) {
  const lotes = [];
  for (let indice = 0; indice < lista.length; indice += tamanho) lotes.push(lista.slice(indice, indice + tamanho));
  return lotes;
}

async function buscarDossiesPersistidos(chaves) {
  const chaveServico = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!chaveServico || !chaves.length) return new Map();
  const encontrados = new Map();
  for (const lote of dividirEmLotes(chaves, 100)) {
    const valores = lote.map((valor) => `"${String(valor).replaceAll('"', "")}"`).join(",");
    const filtro = encodeURIComponent(`in.(${valores})`);
    const url = `${SUPABASE_URL}/rest/v1/dossies_editais?numero_controle_pncp=${filtro}&select=numero_controle_pncp,versao,status,atualizado_em`;
    try {
      const resposta = await fetch(url, { headers: { apikey: chaveServico, Authorization: `Bearer ${chaveServico}` } });
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      for (const dossie of await resposta.json()) encontrados.set(dossie.numero_controle_pncp, dossie);
    } catch (erro) {
      // Uma falha momentânea de auditoria não bloqueia a preparação: nesse caso a
      // seleção cai para os recém-publicados, e a Function reaproveita seu próprio cache.
      console.warn(`[dossiês] não foi possível consultar o status persistido: ${erro.message}`);
      return new Map();
    }
  }
  return encontrados;
}

function prioridadeDoDossie(registro, dossie, agora = Date.now()) {
  if (!dossie) return 0; // ainda não foi processado: sempre vem primeiro
  if (Number(dossie.versao || 0) !== VERSAO_DOSSIE) return 1; // regra de extração atualizada
  if (dossie.status === "erro") return 2;
  if (dossie.status === "parcial") {
    const atualizado = dataValida(dossie.atualizado_em)?.getTime() || 0;
    if (agora - atualizado >= REPROCESSAR_PARCIAL_APOS_MS) return 3;
  }
  return null; // pronto, ou parcial ainda dentro da janela de descanso
}

function selecionarCandidatos(registros, dossies, agora = Date.now()) {
  return registros
    .map((registro) => ({ registro, prioridade: prioridadeDoDossie(registro, dossies.get(registro.numeroControlePNCP), agora) }))
    .filter((item) => item.prioridade !== null)
    .sort((a, b) => a.prioridade - b.prioridade || dataValida(b.registro.publicacao) - dataValida(a.registro.publicacao))
    .slice(0, LIMITE)
    .map((item) => item.registro);
}

// As oportunidades vivem no Supabase (tabela oportunidades_abertas); o job não pode depender de
// data/oportunidades_abertas.json: num runner limpo (ex.: job de dossiês do workflow por shard)
// esse arquivo não existe, e em modo shard ele só teria o que aquele shard acabou de coletar.
// Lê só a janela de DIAS (coluna "publicacao" indexada) em páginas de 1000. Sem a chave de serviço
// ou com falha na consulta, cai pro arquivo local, que os workflows antigos ainda hidratam.
async function carregarRecentesDoSupabase(corteMs, { chaveServico = process.env.SUPABASE_SERVICE_ROLE_KEY, buscar = fetch } = {}) {
  if (!chaveServico) return null;
  const corteIso = new Date(corteMs).toISOString().slice(0, 10);
  const registros = [];
  const tamanhoPagina = 1000;
  for (let offset = 0; ; offset += tamanhoPagina) {
    const url = `${SUPABASE_URL}/rest/v1/oportunidades_abertas?select=dado&publicacao=gte.${corteIso}&order=publicacao.desc,chave.asc&limit=${tamanhoPagina}&offset=${offset}`;
    const resposta = await buscar(url, { headers: { apikey: chaveServico, Authorization: `Bearer ${chaveServico}` } });
    if (!resposta.ok) throw new Error(`Supabase oportunidades_abertas HTTP ${resposta.status}`);
    const pagina = await resposta.json();
    for (const linha of pagina) registros.push(linha.dado);
    if (pagina.length < tamanhoPagina) return registros;
  }
}

async function carregarRecentes(corteMs, opcoes = {}) {
  let registros = null;
  try {
    registros = await carregarRecentesDoSupabase(corteMs, opcoes);
  } catch (erro) {
    console.warn(`[dossiês] não foi possível ler as oportunidades do Supabase (${erro.message}); tentando o arquivo local.`);
  }
  if (!registros) {
    const arquivo = opcoes.arquivo || path.join(__dirname, "..", "data", "oportunidades_abertas.json");
    if (!fs.existsSync(arquivo)) throw new Error("sem oportunidades: Supabase indisponível e data/oportunidades_abertas.json não existe neste runner.");
    registros = JSON.parse(fs.readFileSync(arquivo, "utf8")).registros || [];
  }
  return registros
    .filter((r) => r && r.numeroControlePNCP && dataValida(r.publicacao)?.getTime() >= corteMs)
    .sort((a, b) => dataValida(b.publicacao) - dataValida(a.publicacao));
}

async function main() {
  const corte = Date.now() - DIAS * 24 * 60 * 60 * 1000;
  const recentes = await carregarRecentes(corte);
  const dossies = await buscarDossiesPersistidos(recentes.map((registro) => registro.numeroControlePNCP));
  const candidatos = selecionarCandidatos(recentes, dossies);

  console.log(`[dossiês] ${recentes.length} edital(is) recente(s), ${candidatos.length} pendente(s); limite ${LIMITE}, concorrência ${CONCORRENCIA}.`);
  let indice = 0, gerados = 0, reaproveitados = 0, pendentes = 0, falhas = 0, chamadas = 0;
  await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, candidatos.length) }, async () => {
    while (indice < candidatos.length && chamadas < 20) {
      const atual = candidatos[indice++];
      try {
        chamadas++;
        let resultado = await prepararUm(atual);
        // O job existente completa os lotes sem depender de cliques no navegador.
        // O teto encerra esta execução preservando o progresso para o próximo cron.
        while (resultado === "pendente" && chamadas < 20) {
          await new Promise((resolve) => setTimeout(resolve, 65000));
          chamadas++;
          resultado = await prepararUm(atual);
        }
        if (resultado === "reaproveitado") reaproveitados += 1;
        else if (resultado === "pendente") pendentes += 1;
        else gerados += 1;
        console.log(`[dossiês] ${resultado}: ${atual.numeroControlePNCP}`);
      } catch (erro) {
        falhas += 1;
        console.warn(`[dossiês] falhou ${atual.numeroControlePNCP}: ${erro.message}`);
      }
    }
  }));
  console.log(`[dossiês] concluído: ${gerados} gerado(s), ${reaproveitados} reaproveitado(s), ${pendentes} pendente(s), ${falhas} falha(s).`);
  if (falhas === candidatos.length && candidatos.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((erro) => { console.error(`[dossiês] ${erro.message}`); process.exitCode = 1; });
}

module.exports = { prioridadeDoDossie, selecionarCandidatos, prepararUm, carregarRecentes };
