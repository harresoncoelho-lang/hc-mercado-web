// Prepara antecipadamente os dossiês dos editais recém-coletados.
// Uso: node scripts/preparar_dossies_editais.js
// Env obrigatórias: DOSSIES_EDITAIS_CHAVE.
// Env opcionais: LICITAPLENA_URL (https://licitaplena.com.br), MAX_DOSSIES_POR_EXECUCAO (12),
// DIAS_PUBLICACAO_DOSSIE (3), CONCORRENCIA_DOSSIES (2).
//
// O cliente nunca deve precisar iniciar leitura de PDF/IA no clique. Este job chama a
// rota interna, que aproveita o cache persistente e só lê os documentos ainda ausentes.

const fs = require("fs");
const path = require("path");

const URL_SITE = (process.env.LICITAPLENA_URL || "https://licitaplena.com.br").replace(/\/$/, "");
const LIMITE = Math.max(1, Number(process.env.MAX_DOSSIES_POR_EXECUCAO || 12));
const DIAS = Math.max(1, Number(process.env.DIAS_PUBLICACAO_DOSSIE || 3));
const CONCORRENCIA = Math.max(1, Number(process.env.CONCORRENCIA_DOSSIES || 2));

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

async function main() {
  const arquivo = path.join(__dirname, "..", "data", "oportunidades_abertas.json");
  const dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));
  const corte = Date.now() - DIAS * 24 * 60 * 60 * 1000;
  const candidatos = (dados.registros || [])
    .filter((r) => r && r.numeroControlePNCP && dataValida(r.publicacao)?.getTime() >= corte)
    .sort((a, b) => dataValida(b.publicacao) - dataValida(a.publicacao))
    .slice(0, LIMITE);

  console.log(`[dossiês] ${candidatos.length} edital(is) recente(s); limite ${LIMITE}, concorrência ${CONCORRENCIA}.`);
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

main().catch((erro) => { console.error(`[dossiês] ${erro.message}`); process.exitCode = 1; });
