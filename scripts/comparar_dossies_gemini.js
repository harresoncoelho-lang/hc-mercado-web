// Comparação temporária de qualidade: gera com o Gemini editais que já têm dossiê
// do GPT-5.1 e grava os dois lado a lado em comparacao/, SEM gravar no Supabase.
// Uso: EDITAIS="n1,n2" node scripts/comparar_dossies_gemini.js
// Env obrigatórias: GEMINI_API_KEY, SUPABASE_SERVICE_ROLE_KEY, EDITAIS.
// Env opcionais: PAUSA_MS_COMPARACAO (20000), entre chamadas, para respeitar o limite por minuto.

const fs = require("node:fs");
const { ancorasPrazos } = require("../netlify/functions/_resumo_gateway");
const { __test: iaEdital } = require("../netlify/functions/lib/ia-edital");
const { restFetch } = require("./supabase_dados");
const { chamarGemini, montarResultado, CotaEsgotada } = require("./gerar_dossies_gemini");

const PAUSA_MS = Number(process.env.PAUSA_MS_COMPARACAO || 20000);

function contarNaoInformado(valor) {
  if (typeof valor === "string") return valor === "Não informado" ? 1 : 0;
  if (Array.isArray(valor)) return valor.reduce((total, item) => total + contarNaoInformado(item), 0);
  if (valor && typeof valor === "object") return Object.values(valor).reduce((total, item) => total + contarNaoInformado(item), 0);
  return 0;
}

// Campos que um modelo preencheu e o outro deixou "Não informado".
function camposPerdidos(base, outro, caminho = "") {
  if (typeof base === "string") return base !== "Não informado" && outro === "Não informado" ? [caminho] : [];
  if (!base || typeof base !== "object" || Array.isArray(base)) return [];
  return Object.keys(base).flatMap((chave) => camposPerdidos(base[chave], outro?.[chave], caminho ? `${caminho}.${chave}` : chave));
}

function metricas(estrutura, fonte, agora) {
  const e = estrutura || {};
  return {
    naoInformado: contarNaoInformado(e),
    datasAusentes: ancorasPrazos(fonte, e, agora).datasAusentes.length,
    documentosHabilitacao: (e.documentosHabilitacao || []).length,
    declaracoesExigidas: (e.declaracoesExigidas || []).length,
    requisitosProposta: (e.requisitosProposta || []).length,
    sessao: `${e.sessaoPublica?.data} ${e.sessaoPublica?.horario}`,
    limitePropostas: e.prazos?.limiteEnvioPropostas,
    valorEstimado: e.detalhes?.valorEstimado,
    totalItens: e.itens?.totalItens,
    tamanhoResumo: (e.resumoGeral || "").length,
  };
}

async function main() {
  const numeros = (process.env.EDITAIS || "").split(",").map((n) => n.trim()).filter(Boolean);
  fs.mkdirSync("comparacao", { recursive: true });
  const linhas = [];
  for (const numero of numeros) {
    const [linha] = await (await restFetch(`dossies_editais?numero_controle_pncp=eq.${encodeURIComponent(numero)}&select=dossie`)).json();
    const atual = linha?.dossie;
    if (!atual?.textoEdital) { console.log(`[comparação] sem texto salvo: ${numero}`); continue; }
    const agora = Date.parse(atual.geradoEm || "2026-10-01T12:00:00Z");
    const ficha = await iaEdital.buscarFichaCanonica(numero) || { numeroControlePNCP: numero, fonte: "PNCP" };
    const inicio = Date.now();
    let gemini = null, erro = null, modelo = null, uso = null;
    // Sobrecarga do Google é passageira: até 3 tentativas com 60 s de intervalo.
    for (let tentativa = 1; tentativa <= 3 && !gemini; tentativa += 1) {
      try {
        const saida = await chamarGemini(ficha, atual.textoEdital, { apiKey: process.env.GEMINI_API_KEY });
        ({ modelo, uso } = saida);
        gemini = montarResultado(saida.saida, atual.textoEdital, atual.estrutura?.coberturaLeitura, agora);
        erro = null;
      } catch (e) {
        erro = e instanceof CotaEsgotada ? `indisponivel: ${e.message}` : e.message;
        if (!(e instanceof CotaEsgotada)) break;
        await new Promise((r) => setTimeout(r, 60000));
      }
    }
    const segundos = Math.round((Date.now() - inicio) / 1000);
    const resultado = { numero, caracteres: atual.textoEdital.length, segundos, modelo, tokens: uso, erro,
      gpt: metricas(atual.estrutura, atual.textoEdital, agora), gemini: gemini && metricas(gemini.estrutura, atual.textoEdital, agora),
      geminiDeixouSemInformar: gemini ? camposPerdidos(atual.estrutura, gemini.estrutura) : null,
      gptDeixouSemInformar: gemini ? camposPerdidos(gemini.estrutura, atual.estrutura) : null };
    linhas.push(resultado);
    fs.writeFileSync(`comparacao/${numero.replace(/\W+/g, "_")}.json`, JSON.stringify({ ...resultado, estruturaGpt: atual.estrutura, estruturaGemini: gemini?.estrutura || null }, null, 2));
    console.log(JSON.stringify(resultado));
    await new Promise((r) => setTimeout(r, PAUSA_MS));
  }
  fs.writeFileSync("comparacao/resumo.json", JSON.stringify(linhas, null, 2));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
