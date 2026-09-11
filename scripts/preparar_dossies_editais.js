// Prepara antecipadamente os dossiês dos editais recém-coletados.
// Uso: node scripts/preparar_dossies_editais.js
// Env obrigatórias: DOSSIES_EDITAIS_CHAVE.
// Env opcionais: LICITAPLENA_URL (https://licitaplena.com.br), MAX_DOSSIES_POR_EXECUCAO (12),
// DIAS_PUBLICACAO_DOSSIE (3), CONCORRENCIA_DOSSIES (2), SUPABASE_SERVICE_ROLE_KEY,
// VERSAO_DOSSIE (10) e REPROCESSAR_PARCIAL_APOS_HORAS (24).
//
// O cliente nunca deve precisar iniciar leitura de PDF/IA no clique. Este job chama a
// rota interna, que aproveita o cache persistente e só lê os documentos ainda ausentes.

const fs = require("fs");
const path = require("path");

const URL_SITE = (process.env.LICITAPLENA_URL || "https://licitaplena.com.br").replace(/\/$/, "");
const LIMITE = Math.max(1, Number(process.env.MAX_DOSSIES_POR_EXECUCAO || 12));
const DIAS = Math.max(1, Number(process.env.DIAS_PUBLICACAO_DOSSIE || 3));
const CONCORRENCIA = Math.max(1, Number(process.env.CONCORRENCIA_DOSSIES || 2));
const VERSAO_DOSSIE = Math.max(1, Number(process.env.VERSAO_DOSSIE || 10));
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

async function main() {
  const arquivo = path.join(__dirname, "..", "data", "oportunidades_abertas.json");
  const dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));
  const corte = Date.now() - DIAS * 24 * 60 * 60 * 1000;
  const recentes = (dados.registros || [])
    .filter((r) => r && r.numeroControlePNCP && dataValida(r.publicacao)?.getTime() >= corte)
    .sort((a, b) => dataValida(b.publicacao) - dataValida(a.publicacao));
  const dossies = await buscarDossiesPersistidos(recentes.map((registro) => registro.numeroControlePNCP));
  const candidatos = selecionarCandidatos(recentes, dossies);

  console.log(`[dossiês] ${recentes.length} edital(is) recente(s), ${candidatos.length} pendente(s); limite ${LIMITE}, concorrência ${CONCORRENCIA}.`);
  let indice = 0, gerados = 0, reaproveitados = 0, falhas = 0;
  await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, candidatos.length) }, async () => {
    while (indice < candidatos.length) {
      const atual = candidatos[indice++];
      try {
        const resultado = await prepararUm(atual);
        if (resultado === "reaproveitado") reaproveitados += 1;
        else gerados += 1;
        console.log(`[dossiês] ${resultado}: ${atual.numeroControlePNCP}`);
      } catch (erro) {
        falhas += 1;
        console.warn(`[dossiês] falhou ${atual.numeroControlePNCP}: ${erro.message}`);
      }
    }
  }));
  console.log(`[dossiês] concluído: ${gerados} gerado(s), ${reaproveitados} reaproveitado(s), ${falhas} falha(s).`);
  if (falhas === candidatos.length && candidatos.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((erro) => { console.error(`[dossiês] ${erro.message}`); process.exitCode = 1; });
}

module.exports = { prioridadeDoDossie, selecionarCandidatos };
